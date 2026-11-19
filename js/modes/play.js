// =====================================================================
// CHẾ ĐỘ ĐÁNH VỚI MÁY + PHÂN TÍCH VÁN
// - Chọn bên, cấp độ (1–8), thế bắt đầu; máy có thể đi theo sách khai cuộc
// - Gợi ý, đi lại, xin thua; hết ván tự lưu
// - Phân tích: engine chấm từng nước, đánh dấu ?! / ? / ?? và gợi ý nước tốt hơn
// =====================================================================
import { revealInList } from '../ui/reveal.js';
import { Position, START_FEN, parseCoordMove, colorOf, RED } from '../core/xiangqi.js';
import { moveToNotation } from '../core/notation.js';
import { Game } from '../core/game.js';
import { engine } from '../engine/client.js';
import { LEVELS } from '../engine/search.js';
import { logActivity } from '../train/progress.js';
import { analyzeGame } from '../engine/analysis.js';
import { renderAfterOpening } from './after-opening.js';

const $ = (id) => document.getElementById(id);
const SIDE = { r: 'Đỏ', b: 'Đen' };

export function initPlay(ctx) {
  // ctx: { view, store, settings, Sound, toast, setController, showScreen, getFreeGame, getOpenings, moveLabel, loadIntoFree, askConfirm }
  const { view, store, Sound, toast } = ctx;
  let game = null;            // Game đang chơi / đang xem
  let cfg = null;             // { side, level, book }
  let state = 'idle';         // 'idle' | 'play' | 'over' | 'analyzing'
  let thinking = false;
  let result = null;          // { winner: 'r'|'b'|null, reason }
  let analysis = null;        // kết quả analyzeGame
  let savedId = null;
  let lastEval = null;        // điểm gần nhất (góc nhìn Đỏ)
  let active = false;         // màn hình Đánh với máy đang hiển thị (đang giữ bàn cờ)
  let aoToken = 0;            // lần mở "Triển khai tiếp?" gần nhất (để bỏ kết quả cũ)
  let aoFen = null;           // thế đang được phân tích
  let aoPreview = false;      // đang xem diễn biến gợi ý trên bàn => tạm khóa đi quân

  // ---------- Chuẩn bị giao diện ----------
  const sel = $('plLevel');
  for (let i = 1; i < LEVELS.length; i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = `${i} — ${LEVELS[i].name}`;
    sel.appendChild(o);
  }
  sel.value = String(store.getJSON('playLevel', 4));
  // Mô tả ngắn từng cấp độ để anh chọn cho đúng sức
  const LEVEL_HINT = (i) => (i <= 2 ? 'Máy còn hay đi sai — hợp để tập triển khai khai cuộc.'
    : i <= 4 ? 'Sức người chơi phong trào — đối thủ luyện tập hằng ngày.'
      : i <= 6 ? 'Khá mạnh — phải tính kỹ đòn chiến thuật mới giữ được thế.'
        : 'Rất mạnh — để thử sức; máy nghĩ lâu hơn (điện thoại yếu có thể chậm).');
  const showLevelHint = () => { $('plLevelHint').textContent = LEVEL_HINT(Number(sel.value)); };
  sel.addEventListener('change', showLevelHint);
  showLevelHint();
  if (store.getJSON('playSide', 'r') === 'b') $('plSideB').checked = true;

  async function showEngineName() {
    $('engineName').textContent = 'Đang khởi động engine…';
    try {
      await engine.init();
      $('engineName').textContent = `Engine: ${engine.name}${engine.isStrong ? '' : ' — chưa có Fairy-Stockfish'}`;
    } catch (e) { $('engineName').textContent = 'Engine lỗi: ' + e.message; }
  }

  // ---------- Sách khai cuộc (từ dữ liệu luyện khai cuộc) ----------
  function bookMove() {
    if (!cfg.book || game.startFen !== new Position(START_FEN).fen()) return null;
    const key = game.moves.slice(0, game.ply).map((m) => m.iccs).join(' ');
    const cands = new Map();
    for (const op of ctx.getOpenings()) {
      if (op.kind !== 'theory') continue;
      const n = op.nodes.get(key);
      if (!n) continue;
      for (const k of n.children) { const c = op.nodes.get(k); cands.set(c.iccs, (cands.get(c.iccs) || 0) + c.weight); }
    }
    if (!cands.size) return null;
    const total = [...cands.values()].reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [m, w] of cands) { r -= w; if (r <= 0) return m; }
    return [...cands.keys()][0];
  }

  // ---------- Bắt đầu ván ----------
  function newGame(startFen, moves = [], side, level, book) {
    cfg = { side, level, book };
    closePlan();
    $('panelPlay').scrollTop = 0; // khung cố định: đưa bảng bên về đầu để thấy trạng thái ván
    game = new Game(startFen);
    for (const iccs of moves) game.play(parseCoordMove(iccs));
    state = 'play'; result = null; analysis = null; savedId = null; lastEval = null;
    active = true;
    ctx.setController(controller);
    ctx.showScreen('play');
    if (view.flipped !== (side === 'b')) view.setFlipped(side === 'b');
    $('playSetup').hidden = true;
    $('playGame').hidden = false;
    $('plTitle').textContent = `Anh (${SIDE[side]}) – Máy cấp ${level}`;
    render();
    maybeEngineMove();
  }

  $('plGo').onclick = () => {
    const side = $('plSideB').checked ? 'b' : 'r';
    const level = Number(sel.value);
    store.setJSON('playLevel', level);
    store.setJSON('playSide', side);
    let fen = START_FEN, moves = [];
    if ($('plStart').value === 'free') {
      const fg = ctx.getFreeGame();
      fen = fg.startFen; moves = fg.moves.slice(0, fg.ply).map((m) => m.iccs);
    }
    newGame(fen, moves, side, level, $('plBook').checked);
  };

  /** Từ chế độ khác (VD hết biến khai cuộc) chuyển sang đánh với máy */
  function startFrom({ startFen, moves, side }) {
    const level = Number(store.getJSON('playLevel', 4));
    newGame(startFen, moves, side, level, false);
    toast(`Đánh tiếp với máy cấp ${level} (${LEVELS[level].name}). Đổi cấp ở màn hình Ván mới.`);
  }

  // ---------- Trạng thái ván ----------
  const userTurn = () => game.pos.turn === cfg.side;
  const atEnd = () => game.ply === game.moves.length;

  function checkOver() {
    const st = game.pos.status({ repetitionRule: ctx.settings.repetitionRule });
    if (st.over) {
      result = { winner: st.winner, reason: st.reason };
      endGame();
      return true;
    }
    return false;
  }

  function endGame() {
    state = 'over';
    thinking = false;
    Sound.end();
    save();
    logActivity(store, 'play');
    render();
  }

  function resultText() {
    if (!result) return '';
    const who = result.winner ? (result.winner === cfg.side ? 'Anh thắng' : 'Máy thắng') : 'Hòa';
    const why = { checkmate: 'chiếu bí', stalemate: 'hết nước đi', repetition: 'lặp thế 3 lần', resign: 'xin thua' }[result.reason] || '';
    return `${who}${why ? ' (' + why + ')' : ''}.`;
  }

  // ---------- Máy đi ----------
  async function maybeEngineMove() {
    if (state !== 'play' || userTurn() || !atEnd() || thinking) return;
    thinking = true;
    render();
    const t0 = Date.now();
    try {
      let mv = bookMove();
      let r = null;
      const history = game.moves.map((m) => m.iccs);
      if (!mv) {
        r = await engine.search(game.startFen, history, { level: cfg.level });
        mv = r.move;
        if (r) lastEval = game.pos.turn === RED ? r.score : -r.score;
      }
      // Chờ tối thiểu một chút cho tự nhiên
      const wait = Math.max(0, 350 - (Date.now() - t0));
      await new Promise((res) => setTimeout(res, wait));
      if (state !== 'play' || !mv || !active) { thinking = false; return; }
      const m = parseCoordMove(mv);
      const e = game.play(m);
      thinking = false;
      if (!e) { toast('Engine trả về nước không hợp lệ: ' + mv); return; }
      if (e.check) Sound.check(); else if (e.captured) Sound.capture(); else Sound.move();
      render({ from: m.from, to: m.to });
      checkOver();
    } catch (err) {
      thinking = false;
      if (err.message !== 'cancelled') toast('Engine lỗi: ' + err.message);
      render();
    }
  }

  // ---------- Bộ điều khiển bàn cờ ----------
  const controller = {
    canPick(s) {
      if (state !== 'play' || thinking || aoPreview || !atEnd() || !userTurn()) return false;
      const p = game.pos.board[s];
      return !!p && colorOf(p) === cfg.side;
    },
    targets(s) { return game.pos.legalMoves(s).map((m) => m.to); },
    onMove(m) {
      const e = game.play(m);
      if (!e) return;
      view.setHint(null);
      if (e.check) Sound.check(); else if (e.captured) Sound.capture(); else Sound.move();
      render(m.dragged ? null : m);
      if (!checkOver()) maybeEngineMove();
    },
  };

  // ---------- Vẽ ----------
  function fmtScore(cp) {
    if (cp === null || cp === undefined) return '±0.0';
    if (Math.abs(cp) > 20000) return cp > 0 ? 'Đỏ thắng' : 'Đen thắng';
    const v = (cp / 100).toFixed(1);
    return (cp > 0 ? '+' : '') + v;
  }

  function render(animate = null) {
    if (!game || !active) return;
    if (aoFen && aoFen !== game.pos.fen()) closePlan(); // đã sang thế khác => phân tích cũ hết hiệu lực
    const pos = game.pos;
    const checkSq = pos.inCheck() ? pos.kingSq(pos.turn) : -1;
    view.render({ board: pos.board, last: game.lastMove(), checkSq, animate });
    // Dòng trạng thái ngay trên bàn cờ: lượt đi, kết quả ván, nhận xét nước đang xem (sau phân tích)
    const st = $('status');
    const overKind = result?.winner === cfg.side ? 'ok' : result?.winner ? 'bad' : 'warn';
    let msg, kind = null;
    const a = analysis && game.ply > 0 ? analysis.moves[game.ply - 1] : null;
    if (state === 'analyzing') msg = 'Đang phân tích ván…';
    else if (a?.cls) { msg = `Nước ${a.ply} ${a.cls.sym} ${a.cls.name} — mất ~${(a.loss / 100).toFixed(1)} điểm`; kind = a.cls.key === 'inaccuracy' ? 'warn' : 'bad'; }
    else if (state === 'over' && atEnd()) { msg = resultText(); kind = overKind; }
    else if (!atEnd()) msg = 'Đang xem lại — bấm ⏭ để về nước cuối';
    else if (thinking) msg = 'Máy đang suy nghĩ…';
    else msg = userTurn() ? `Lượt anh (${SIDE[cfg.side]})${checkSq >= 0 ? ' — đang bị chiếu!' : ''}` : 'Lượt máy';
    st.className = 'status' + (kind ? ' v-' + kind : '') + (checkSq >= 0 && !kind ? ' check' : '');
    st.textContent = msg;
    // Ô kết quả trong bảng: chỉ hiện khi hết ván / đang phân tích (lúc đang đánh thì thanh trên bàn cờ đã đủ)
    $('plStatus').hidden = state === 'play';
    $('plStatus').textContent = state === 'over' ? resultText() + (analysis ? '' : ' Bấm "Phân tích ván" để engine chấm từng nước.') : msg;
    $('plStatus').className = 'feedback ' + (state === 'over' ? overKind : 'info');
    // Điểm thế cờ theo phía anh + thanh ưu thế
    const ue = lastEval === null ? null : (cfg.side === 'r' ? lastEval : -lastEval);
    $('plEval').textContent = ue === null ? 'Điểm: —' : fmtScore(ue);
    $('plEval').className = 'pill' + (ue === null ? '' : ue > 50 ? ' learn' : ue < -50 ? ' bad' : '');
    $('plEvalFill').style.width = (ue === null ? 50 : Math.round(50 + 50 * Math.tanh(ue / 600))) + '%';
    $('plEvalCap').textContent = ue === null ? 'Thanh ưu thế cập nhật khi máy tính nước.' : Math.abs(ue) > 20000 ? (ue > 0 ? 'Anh đang có đòn thắng.' : 'Máy đang có đòn thắng.') : ue > 50 ? `Anh đang hơn khoảng ${(ue / 100).toFixed(1)} điểm.` : ue < -50 ? `Máy đang hơn khoảng ${(-ue / 100).toFixed(1)} điểm.` : 'Thế cờ cân bằng.';
    // Nút theo ngữ cảnh: đang đánh => Gợi ý / Đi lại; hết ván => Phân tích ván là nút chính
    const playing = state === 'play';
    $('plHint').hidden = !playing; $('plUndo').hidden = !playing;
    $('plAnalyze').hidden = playing;
    $('plResign').hidden = !playing;
    $('plHint').disabled = !(playing && userTurn() && !thinking && atEnd());
    $('plUndo').disabled = !(playing && game.moves.length && !thinking);
    $('plResign').disabled = !playing;
    $('plAnalyze').disabled = state === 'analyzing' || game.moves.length < 2;
    $('plAnalyze').textContent = analysis ? 'Phân tích lại' : 'Phân tích ván';
    $('plAnalyze').classList.toggle('primary', !analysis);
    $('plNew').classList.toggle('primary', state === 'over' && !!analysis);
    $('plNew').classList.toggle('ghost', !(state === 'over' && !!analysis));
    $('plPlanBtn').disabled = state === 'analyzing' || thinking || game.pos.status().over;
    renderMoves();
    renderDetail();
  }

  function renderMoves() {
    const ol = $('plMoves');
    ol.innerHTML = '';
    const startBlack = new Position(game.startFen).turn !== RED;
    const off = startBlack ? 1 : 0;
    let cur = null;
    for (let i = 0; i < game.moves.length + off; i += 2) {
      const li = document.createElement('li');
      const no = document.createElement('span'); no.className = 'no'; no.textContent = `${i / 2 + 1}.`;
      li.appendChild(no);
      for (let k = 0; k < 2; k++) {
        const idx = i + k - off;
        const b = document.createElement('button');
        b.className = 'mv ' + (k === 0 ? 'red' : 'black');
        if (idx >= 0 && idx < game.moves.length) {
          const a = analysis?.moves[idx];
          b.textContent = ctx.moveLabel(game.moves[idx]) + (a?.cls ? ' ' + a.cls.sym : '');
          if (a?.cls) b.classList.add('an-' + a.cls.key);
          b.onclick = () => { game.goto(idx + 1); render(); };
          if (idx + 1 === game.ply) { b.classList.add('cur'); cur = b; }
        } else { b.disabled = true; b.textContent = idx < 0 ? '…' : ''; }
        li.appendChild(b);
      }
      ol.appendChild(li);
    }
    revealInList(cur);
  }

  /** Ghi chú cho nước đang xem (sau khi phân tích) */
  function renderDetail() {
    const el = $('plDetail');
    if (!analysis || game.ply === 0) { el.textContent = analysis ? summaryText() : ''; return; }
    const a = analysis.moves[game.ply - 1];
    if (!a) { el.textContent = ''; return; }
    const prev = new Position(game.startFen);
    for (let i = 0; i < game.ply - 1; i++) prev.makeMove(parseCoordMove(game.moves[i].iccs));
    const name = (iccs) => (iccs ? ctx.moveLabel({ vn: moveToNotation(prev, parseCoordMove(iccs)), vnPlus: moveToNotation(prev, parseCoordMove(iccs), { style: 'vn', vnAdvance: '+' }), wxf: moveToNotation(prev, parseCoordMove(iccs), { style: 'wxf' }) }) : '—');
    let t = `Nước ${a.ply}: ${ctx.moveLabel(game.moves[a.ply - 1])}`;
    if (a.cls) t += ` — ${a.cls.name} ${a.cls.sym} (mất khoảng ${(a.loss / 100).toFixed(1)} điểm).\nNước tốt hơn: ${name(a.best)} (điểm ${fmtScore(a.bestScore)} so với ${fmtScore(a.playedScore)}, theo bên đi).`;
    else t += a.played === a.best ? ' — đúng nước engine chọn.' : ` — tốt (chênh ${(a.loss / 100).toFixed(1)}). Engine thích ${name(a.best)}.`;
    el.textContent = t + '\n' + summaryText();
  }

  function summaryText() {
    if (!analysis) return '';
    const cnt = (side, key) => analysis.moves.filter((a, i) => a.cls?.key === key && sideOfPly(i) === side).length;
    const line = (s) => `${SIDE[s]}: ${cnt(s, 'inaccuracy')} không chính xác, ${cnt(s, 'mistake')} sai lầm, ${cnt(s, 'blunder')} hớ`;
    return `Tổng kết — ${line('r')}; ${line('b')}. (Engine: ${analysis.engine})`;
  }
  function sideOfPly(i) {
    const first = new Position(game.startFen).turn;
    return i % 2 === 0 ? first : first === 'r' ? 'b' : 'r';
  }

  // ---------- Nút ----------
  $('plFirst').onclick = () => { game.goto(0); render(); };
  $('plPrev').onclick = () => { game.back(); render(); };
  $('plNext').onclick = () => { const n = game.moves[game.ply]; game.forward(); render(n ? { from: n.from, to: n.to } : null); };
  $('plLast').onclick = () => { game.goto(game.moves.length); render(); maybeEngineMove(); };

  $('plHint').onclick = async () => {
    $('plHint').disabled = true;
    $('plStatus').textContent = 'Máy đang tìm gợi ý…';
    try {
      const r = await engine.search(game.startFen, game.moves.map((m) => m.iccs), { movetime: 1500 });
      if (r.move) {
        view.setHint(parseCoordMove(r.move));
        const n = moveToNotation(game.pos, parseCoordMove(r.move));
        lastEval = game.pos.turn === RED ? r.score : -r.score;
        toast(`Gợi ý: ${ctx.moveLabelVN(n)}`);
      }
    } catch (e) { if (e.message !== 'cancelled') toast('Engine lỗi: ' + e.message); }
    render();
  };

  $('plUndo').onclick = () => {
    if (thinking) return;
    engine.stop();
    // Lùi về lượt gần nhất của anh
    let n = game.moves.length - 1;
    while (n > 0 && sideOfPly(n) !== cfg.side) n--;
    if (sideOfPly(n) !== cfg.side) n = 0;
    game.goto(n);
    game.moves.length = n;
    analysis = null;
    view.setHint(null);
    render();
    maybeEngineMove();
  };

  $('plResign').onclick = async () => {
    if (!(await ctx.askConfirm('Xin thua', 'Anh chắc chắn xin thua ván này?'))) return;
    engine.stop();
    result = { winner: cfg.side === 'r' ? 'b' : 'r', reason: 'resign' };
    endGame();
  };

  $('plNew').onclick = async () => {
    if (state === 'play' && game.moves.length && !(await ctx.askConfirm('Ván mới', 'Bỏ ván đang chơi? Ván sẽ được lưu lại.'))) return;
    engine.stop();
    if (state === 'play' && game.moves.length) save();
    state = 'idle'; thinking = false;
    closePlan();
    view.setHint(null);
    $('playSetup').hidden = false;
    $('playGame').hidden = true;
    $('status').className = 'status'; $('status').textContent = 'Chọn bên, độ mạnh rồi bấm "Bắt đầu"';
    renderSaved();
  };

  $('plAnalyze').onclick = async () => {
    if (state === 'play' && !(await ctx.askConfirm('Phân tích ván', 'Ván chưa kết thúc. Dừng ván để phân tích?'))) return;
    engine.stop();
    const wasState = state === 'play' ? 'over' : state;
    if (state === 'play') result = result || null;
    state = 'analyzing';
    view.setHint(null);
    render();
    const moves = game.moves.map((m) => m.iccs);
    const per = engine.isStrong ? 400 : 600;
    try {
      const res = await analyzeGame((fen, hist) => engine.search(fen, hist, { movetime: per, maxTime: per }), game.startFen, moves, {
        onProgress: (i, n) => { $('plStatus').textContent = `Đang phân tích ${i}/${n}…`; $('status').textContent = `Đang phân tích ${i}/${n}…`; },
      });
      analysis = { ...res, engine: engine.name };
      state = wasState;
      save();
      game.goto(0);
      render();
      toast('Đã phân tích xong. Bấm vào từng nước để xem nhận xét.');
    } catch (e) {
      state = wasState;
      render();
      if (e.message !== 'cancelled') toast('Phân tích lỗi: ' + e.message);
    }
  };

  // ---------- Triển khai tiếp? (phân tích thế đang xem: điểm yếu, kế hoạch, 3 hướng đi của engine) ----------
  function closePlan() { aoToken++; aoFen = null; aoPreview = false; $('plPlanCard').hidden = true; }
  $('plPlanClose').onclick = () => { closePlan(); render(); };
  $('plPlanBtn').onclick = () => {
    if (!game || game.pos.status().over) return;
    const my = ++aoToken;
    aoFen = game.pos.fen();
    aoPreview = false;
    view.setHint(null);
    $('plPlanCard').hidden = false;
    $('plPlanNote').textContent = `Thế sau ${game.ply} nước — nhận xét theo bên anh (${SIDE[cfg.side]}).`;
    renderAfterOpening($('plPlanBox'), {
      fen: aoFen, me: cfg.side, view, label: ctx.moveLabelVN, engine,
      title: 'Triển khai tiếp thế nào?', backLabel: 'Về thế đang xem',
      isActive: () => active && aoToken === my,
      onPreview: (on) => { aoPreview = on; if (!on) render(); },
    });
    $('plPlanCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------- Lưu ván ----------
  function save() {
    const list = store.getJSON('games', []) || [];
    const rec = {
      id: savedId || 'g' + Date.now(),
      date: new Date().toISOString(),
      side: cfg.side, level: cfg.level,
      startFen: game.startFen,
      moves: game.moves.map((m) => m.iccs),
      result, analysis: analysis ? { moves: analysis.moves.map(({ ply, best, bestScore, playedScore, loss, cls }) => ({ ply, best, bestScore, playedScore, loss, cls: cls ? cls.key : null })), engine: analysis.engine } : null,
    };
    savedId = rec.id;
    const i = list.findIndex((g) => g.id === rec.id);
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    store.setJSON('games', list.slice(0, 40));
    renderSaved();
  }

  function renderSaved() {
    const list = store.getJSON('games', []) || [];
    $('savedCount').textContent = list.length ? `${list.length} ván` : '';
    const ol = $('savedList');
    ol.innerHTML = '';
    if (!list.length) { ol.innerHTML = '<li class="muted small">Chưa có ván nào. Ván sẽ tự lưu khi kết thúc.</li>'; return; }
    for (const g of list.slice(0, 15)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'saved-item';
      const d = new Date(g.date);
      const res = g.result ? (g.result.winner ? (g.result.winner === g.side ? 'Thắng' : 'Thua') : 'Hòa') : 'Chưa xong';
      const cls = res === 'Thắng' ? 'learn' : res === 'Thua' ? 'bad' : '';
      b.innerHTML = `<span class="pill ${cls}">${res}</span><span class="si-main">Cầm ${SIDE[g.side]} · cấp ${g.level} · ${g.moves.length} nước${g.analysis ? ' · đã phân tích' : ''}</span><span class="si-date">${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>`;
      b.onclick = () => openSaved(g);
      li.appendChild(b);
      ol.appendChild(li);
    }
  }

  const CLS_BY_KEY = { blunder: { key: 'blunder', sym: '??', name: 'Hớ' }, mistake: { key: 'mistake', sym: '?', name: 'Sai lầm' }, inaccuracy: { key: 'inaccuracy', sym: '?!', name: 'Không chính xác' } };
  function openSaved(g) {
    cfg = { side: g.side, level: g.level, book: false };
    closePlan();
    game = new Game(g.startFen);
    for (const iccs of g.moves) game.play(parseCoordMove(iccs));
    game.goto(0);
    result = g.result; savedId = g.id; lastEval = null;
    analysis = g.analysis ? { moves: g.analysis.moves.map((a, i) => ({ ...a, played: g.moves[i], cls: a.cls ? CLS_BY_KEY[a.cls] : null })), engine: g.analysis.engine } : null;
    state = 'over';
    active = true;
    ctx.setController(controller);
    ctx.showScreen('play');
    if (view.flipped !== (g.side === 'b')) view.setFlipped(g.side === 'b');
    $('playSetup').hidden = true;
    $('playGame').hidden = false;
    $('plTitle').textContent = `Ván đã lưu — cầm ${SIDE[g.side]}, cấp ${g.level}`;
    render();
  }

  function enter() {
    active = true;
    ctx.showScreen('play');
    showEngineName();
    renderSaved();
    if (game && state !== 'idle') { ctx.setController(controller); if (view.flipped !== (cfg.side === 'b')) view.setFlipped(cfg.side === 'b'); render(); maybeEngineMove(); }
    else { $('playSetup').hidden = false; $('playGame').hidden = true; ctx.setController(controller); view.render({ board: new Position().board, last: null, checkSq: -1 }); $('status').className = 'status'; $('status').textContent = 'Chọn bên, độ mạnh rồi bấm "Bắt đầu"'; }
  }
  function leave() { if (!active) return; closePlan(); active = false; engine.stop(); thinking = false; view.setHint(null); ctx.setController(null); }

  return { enter, leave, startFrom, isActive: () => state !== 'idle' };
}
