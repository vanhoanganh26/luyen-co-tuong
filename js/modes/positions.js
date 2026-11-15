// =====================================================================
// CHẾ ĐỘ THẾ CỜ: TRUNG CUỘC (giải đòn) và TÀN CUỘC (lý thuyết + cờ thế cổ)
// - Danh sách: lọc chủ đề / nhóm, độ khó, nút "Cần ôn" (SRS theo từng thế)
// - Trung cuộc & cờ thế cổ: đi đúng lời giải; sai 1 lần được thử lại, sai lần 2 hiện nước đúng.
//   Gợi ý 3 mức: chủ đề -> quân cần đi -> nước đi. Giải xong có thể "Đánh với máy" tiếp.
// - Tàn cuộc lý thuyết: đánh với máy mức mạnh; đạt mục tiêu (thắng / giữ hòa) thì tính hoàn thành.
// =====================================================================
import { Position, parseCoordMove, moveToICCS, colorOf, RED, BLACK } from '../core/xiangqi.js';
import { PuzzleSession, goalStatus, matDiff } from '../train/positions.js';
import { review, isDue, newCard } from '../train/srs.js';
import { logActivity } from '../train/progress.js';
import { engine } from '../engine/client.js';

const $ = (id) => document.getElementById(id);
const SIDE = { r: 'Đỏ', b: 'Đen' };
const STARS = (d) => '★'.repeat(d) + '☆'.repeat(3 - d);
const FIGHT_MS = 2500;          // thời gian nghĩ mặc định khi đánh tàn cuộc (đủ sức, Skill 20)
const DRAW_PLIES = 80;          // giữ hòa: trụ 40 nước
const WIN_PLIES = 120;          // thắng: tối đa 60 nước

export function initPositions(ctx) {
  // ctx: { view, store, settings, Sound, toast, showScreen, setController, moveLabelOf, loadIntoFree, startPlay }
  const { view, store, Sound, toast } = ctx;
  let data = null;
  let tab = 'mid';                       // 'mid' | 'end'
  let kindFilter = 'all';                // tàn cuộc: 'all' | 'end' | 'classic'
  let cards = store.getJSON('posCards', {}) || {};
  let progress = store.getJSON('posProgress', {}) || {};
  let cur = null;                        // thế đang luyện
  let ses = null;                        // PuzzleSession (trung cuộc / cờ thế cổ)
  let fight = null;                      // { pos, moves, goal, userColor, startMat, thinking }
  let busy = false;
  let hintStep = 0;
  let prevFlip = false;
  let active = false;
  let listOrder = [];                    // thứ tự đang hiển thị (để "Thế tiếp")

  const save = () => { store.setJSON('posCards', cards); store.setJSON('posProgress', progress); };
  const allItems = () => (data ? [...data.puzzles, ...data.endgames, ...data.classics] : []);

  // ---------- Nạp dữ liệu ----------
  async function load() {
    try {
      let d = window.__XQT_POSITIONS__;
      if (!d) {
        const res = await fetch('data/positions.built.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        d = await res.json();
      }
      data = d;
    } catch (e) {
      $('psNote').textContent = 'Không tải được dữ liệu thế cờ (' + e.message + ').';
    }
  }

  // ---------- Danh sách ----------
  function itemsOfTab() {
    if (!data) return [];
    if (tab === 'mid') return data.puzzles;
    const all = [...data.endgames, ...data.classics];
    return kindFilter === 'all' ? all : all.filter((x) => x.kind === kindFilter);
  }
  function themeOf(x) { return x.kind === 'mid' ? x.themes.map((t) => t.replace(/\d+ nước/, 'N nước')) : [x.kind === 'classic' ? 'Cờ thế cổ' : x.group, x.result === 'win' ? 'Thắng' : 'Hòa']; }

  function renderKinds() {
    const box = $('psKinds');
    box.innerHTML = '';
    const opts = tab === 'mid' ? [['all', 'Tất cả thế trung cuộc']] : [['all', 'Tất cả'], ['end', 'Lý thuyết'], ['classic', 'Cờ thế cổ']];
    for (const [k, label] of opts) {
      const b = document.createElement('button');
      b.className = 'chip' + (kindFilter === k || opts.length === 1 ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { kindFilter = k; renderList(); };
      box.appendChild(b);
    }
    // Bộ lọc chủ đề
    const sel = $('psTheme');
    const prev = sel.value;
    const themes = new Set();
    for (const x of itemsOfTab()) themeOf(x).forEach((t) => themes.add(t));
    sel.innerHTML = '<option value="">Mọi chủ đề</option>' + [...themes].sort((a, b) => a.localeCompare(b, 'vi')).map((t) => `<option>${t}</option>`).join('');
    if ([...themes].includes(prev)) sel.value = prev;
  }

  function filtered() {
    const th = $('psTheme').value, lv = Number($('psLevel').value);
    return itemsOfTab().filter((x) => (!th || themeOf(x).includes(th)) && (!lv || x.difficulty === lv));
  }

  function dueList() {
    const now = Date.now();
    return itemsOfTab().filter((x) => cards[x.id] && isDue(cards[x.id], now));
  }

  function renderList() {
    renderKinds();
    const list = $('psList');
    list.innerHTML = '';
    if (!data) return;
    const items = filtered();
    listOrder = items;
    const done = itemsOfTab().filter((x) => progress[x.id]?.solved).length;
    const due = dueList().length;
    $('psDue').textContent = due ? String(due) : '';
    $('psNote').textContent = tab === 'mid'
      ? `${data.puzzles.length} thế trung cuộc sinh bằng engine (đã kiểm định: nước đáp án vượt rõ nước thứ hai). Anh đã giải ${done}. Đang hiện ${items.length} thế.`
      : `${data.endgames.length} thế tàn cuộc lý thuyết (engine xác nhận kết quả) + ${data.classics.length} thế cờ cổ (Bách cục tượng kỳ). Anh đã hoàn thành ${done}. Đang hiện ${items.length} thế.`;
    for (const x of items) {
      const p = progress[x.id];
      const b = document.createElement('button');
      b.className = 'op-card ps-card' + (p?.solved ? ' done' : p ? ' fail' : '');
      const title = x.kind === 'mid' ? `${x.id.toUpperCase()} · ${SIDE[x.side]} đi` : x.name;
      const tags = themeOf(x).map((t) => `<span class="tg${t === 'Thắng' ? ' win' : t === 'Hòa' ? ' draw' : ''}">${t}</span>`).join('');
      const st = p ? (p.solved ? `<b>✓ đã ${x.kind === 'end' ? 'hoàn thành' : 'giải'}${p.won ? ', thắng máy' : ''}</b>` : 'chưa đạt — làm lại') : 'chưa làm';
      b.innerHTML = `<span class="op-name"></span><span class="tagrow">${tags}</span><span class="op-meta">${STARS(x.difficulty)} · ${st}</span>`;
      b.querySelector('.op-name').textContent = title;
      b.onclick = () => start(x);
      list.appendChild(b);
    }
    if (!items.length) list.innerHTML = '<p class="muted">Không có thế nào khớp bộ lọc.</p>';
  }

  $('psTheme').onchange = () => renderList();
  $('psLevel').onchange = () => renderList();
  $('psReview').onclick = () => {
    const due = dueList();
    const pool = due.length ? due : itemsOfTab().filter((x) => !progress[x.id]?.solved);
    if (!pool.length) { toast('Anh đã hoàn thành hết — chọn một thế bất kỳ để làm lại.'); return; }
    if (!due.length) toast('Chưa có thế đến hạn ôn — chọn ngẫu nhiên một thế chưa làm.');
    start(pool[Math.floor(Math.random() * pool.length)]);
  };

  function enter(which) {
    leave();
    tab = which; kindFilter = 'all';
    ctx.showScreen(which === 'mid' ? 'mid' : 'end');
    if (!data) load().then(renderList); else renderList();
  }

  // ---------- Luyện một thế ----------
  const userColor = () => (cur.side === 'r' ? RED : BLACK);
  const label = (pos, iccs) => ctx.moveLabelOf(pos, parseCoordMove(iccs));

  function start(x) {
    cur = x; hintStep = 0; busy = false; fight = null;
    ses = x.kind === 'end' ? null : new PuzzleSession({ ...x, hintText: hintTextOf(x) });
    active = true;
    prevFlip = view.flipped;
    ctx.setController(controller);
    ctx.showScreen('pos');
    if (view.flipped !== (x.side === 'b')) view.setFlipped(x.side === 'b');
    $('pzTitle').textContent = x.kind === 'mid' ? `Trung cuộc ${x.id.toUpperCase()}` : x.name;
    $('pzKind').textContent = { mid: 'Trung cuộc', end: 'Tàn cuộc', classic: 'Cờ thế cổ' }[x.kind];
    $('pzMeta').textContent = `${STARS(x.difficulty)} · ${themeOf(x).join(' · ')}`;
    $('pzSource').textContent = 'Nguồn: ' + x.source + (x.verification ? ` · Kiểm định: ${x.verification.engine}${x.verification.note ? ' — ' + x.verification.note : ''}` : '');
    $('pzMethod').textContent = '';
    if (x.kind === 'mid') {
      $('pzGoal').textContent = `${SIDE[x.side]} đi — ${x.goal === 'mate' ? `chiếu bí trong ${(x.solution.length + 1) / 2} nước` : 'tìm đòn được quân'}.`;
      feedback('info', 'Tìm nước tốt nhất. Đi sai được thử lại 1 lần.');
    } else if (x.kind === 'classic') {
      $('pzGoal').textContent = `${SIDE[x.side]} đi trước — ${x.result === 'win' ? 'thắng' : 'hòa'} (theo sách).`;
      feedback('info', `Đi theo lời giải của sách (${(x.solution.length + 1) >> 1} nước của ${SIDE[x.side]}). Máy đi nước của đối phương theo sách.`);
    } else {
      $('pzGoal').textContent = `Anh cầm ${SIDE[x.side]} — mục tiêu: ${x.result === 'win' ? `thắng (chiếu bí trong ${WIN_PLIES / 2} nước)` : `giữ hòa (trụ ${DRAW_PLIES / 2} nước hoặc lặp thế)`}.`;
      feedback('info', `Đánh với máy đủ sức (${((cur.fightMovetime || FIGHT_MS) / 1000).toFixed(1)} giây/nước)${cur.appNote ? '. Lưu ý: ' + cur.appNote : ''}. Bấm "Gợi ý" để xem phương pháp và nước máy đề nghị.`);
      startFight(x.fen, x.result === 'win' ? 'win' : 'draw');
    }
    updateButtons();
    render();
  }

  function hintTextOf(x) {
    if (x.kind === 'classic') return 'Cờ thế cổ: thường phải chiếu liên tục hoặc thí quân để giữ tiên.';
    const t = x.themes.filter((s) => !/^Chiếu bí/.test(s));
    const mate = x.themes.find((s) => /^Chiếu bí/.test(s));
    return [mate ? `${mate}.` : 'Có đòn được quân.', t.length ? `Chủ đề: ${t.join(', ')}.` : ''].join(' ');
  }

  // ---------- Bộ điều khiển bàn cờ ----------
  const curPos = () => (fight ? fight.pos : ses.pos);
  const controller = {
    canPick(s) {
      if (busy) return false;
      const pos = curPos();
      const p = pos.board[s];
      if (fight) return !fight.over && !fight.thinking && pos.turn === userColor() && !!p && colorOf(p) === pos.turn;
      return ses.isUserTurn() && !!p && colorOf(p) === pos.turn;
    },
    targets(s) { return curPos().legalMoves(s).map((m) => m.to); },
    onMove(m) { fight ? fightUserMove(m) : puzzleUserMove(m); },
  };

  function render(animate = null) {
    const pos = curPos();
    const last = pos.history[pos.history.length - 1];
    view.render({ board: pos.board, last: last ? { from: last.from, to: last.to } : null, checkSq: pos.inCheck() ? pos.kingSq(pos.turn) : -1, animate });
    const el = $('status');
    el.className = 'status';
    el.textContent = fight
      ? (fight.over ? 'Đã kết thúc' : fight.thinking ? 'Máy đang nghĩ…' : `Lượt: ${SIDE[pos.turn === RED ? 'r' : 'b']}`)
      : ses.state === 'solved' ? 'Đã giải xong' : `Lượt: ${SIDE[pos.turn === RED ? 'r' : 'b']}`;
    // Nước đã đi
    const p = new Position(cur.fen);
    const played = fight ? fight.moves : ses.played;
    $('pzMoves').textContent = played.map((iccs) => { const v = label(p, iccs); p.makeMove(parseCoordMove(iccs)); return v; }).join('  ');
  }

  function feedback(kind, html) { const el = $('pzFeedback'); el.className = 'feedback ' + kind; el.innerHTML = html; }

  function updateButtons() {
    const solved = ses ? ses.state === 'solved' : fight?.over;
    $('pzHint').disabled = !!solved;
    $('pzHint').textContent = `Gợi ý (${Math.min(hintStep + 1, 3)}/3)`;
    $('pzShow').disabled = !!solved;
    $('pzFight').hidden = cur.kind === 'end' ? !fight?.over : !!(fight && !fight.over) || !!(ses && ses.state === 'solved' && !ses.pos.hasLegalMove()); // đã chiếu bí thì không cần đánh tiếp
    $('pzFight').textContent = cur.kind === 'end' ? 'Xem engine đánh mẫu'
      : fight?.over ? 'Mở ván để phân tích' : (cur.kind === 'classic' && cur.result === 'draw' ? 'Đánh tiếp giữ hòa' : 'Đánh tiếp tới thắng');
    $('pzShow').hidden = cur.kind === 'end' || !!fight;
  }

  // ---------- Trung cuộc / cờ thế cổ ----------
  function puzzleUserMove(m) {
    const before = ses.pos.clone();
    const r = ses.userMove(m);
    if (r.result === 'illegal' || r.result === 'notyourturn') { Sound.error(); return; }
    view.setHint(null);
    if (r.result === 'retry') {
      Sound.error();
      feedback('warn', `Chưa đúng (${label(before, r.played)}). Anh thử lại một lần nữa.`);
      render();
      return;
    }
    hintStep = 0;
    if (r.result === 'wrong') {
      Sound.error();
      feedback('bad', `Sai 2 lần. Nước đúng là <b>${label(before, r.correct)}</b>.`);
      compareWrong(before, r.played, r.correct);
    } else {
      soundFor(r.move.rec);
      feedback('ok', r.result === 'alt' ? 'Nước này cũng thắng (engine chấp nhận) — tính hoàn thành!' : 'Đúng!');
    }
    render(m.dragged ? null : r.move);
    afterUser();
  }

  function afterUser() {
    if (ses.state === 'solved') return finishPuzzle();
    busy = true;
    const mine = ses;
    setTimeout(() => {
      if (ses !== mine) return; // đã rời thế này
      const mv = ses.opponentMove();
      busy = false;
      if (mv) { soundFor(mv.rec); render(mv); }
      if (ses.state === 'solved') finishPuzzle();
      updateButtons();
    }, 450);
  }

  async function compareWrong(pos, played, correct) {
    // Điểm engine của nước anh so với nước đúng (chạy nền, không bắt buộc)
    try {
      await engine.init();
      const base = cur.fen;
      const hist = [...ses.played.slice(0, -1)];
      const a = await engine.search(base, [...hist, played], { movetime: 700, maxTime: 700 });
      const b = await engine.search(base, [...hist, correct], { movetime: 700, maxTime: 700 });
      const fmt = (s) => { const v = Math.max(-2000, Math.min(2000, -s)); return (v > 0 ? '+' : '') + (v / 100).toFixed(1); };
      const el = $('pzFeedback');
      if (el.classList.contains('bad')) el.innerHTML += `<br><span class="small">Engine (góc nhìn ${SIDE[cur.side]}): nước anh ${fmt(a.score)}, nước đúng ${fmt(b.score)}.</span>`;
    } catch { /* bỏ qua */ }
  }

  function finishPuzzle() {
    const q = ses.quality();
    record(q >= 3, q);
    const extra = ses.mistakes ? ' (có nước phải xem đáp án)' : ses.retries || ses.hintsUsed ? ' (có thử lại / gợi ý)' : ' — giải ngay lần đầu!';
    const ok = q >= 3;
    if (cur.kind === 'classic') {
      $('pzMethod').textContent = cur.note || '';
      feedback(ok ? 'ok' : 'warn', `Hết lời giải của sách — kết quả: ${cur.result === 'win' ? 'thắng' : 'hòa'}.${extra}`);
    } else {
      feedback(ok ? 'ok' : 'warn', `${ok ? 'Hoàn thành' : 'Chưa đạt'}${extra}. Lời giải: ${cur.solutionVn}.`);
    }
    updateButtons();
    render();
  }

  function record(solved, q) {
    const p = progress[cur.id] || { tries: 0 };
    p.tries++;
    p.solved = p.solved || solved;
    p.last = solved ? 'ok' : 'fail';
    p.ts = Date.now();
    progress[cur.id] = p;
    cards[cur.id] = review(cards[cur.id] || newCard(), q);
    save();
    logActivity(store, cur.kind === 'mid' ? 'mid' : 'end');
  }

  // ---------- Đánh với máy (tàn cuộc) ----------
  /** Đánh với máy từ thế `fen` (+ các nước `prefix` đã đi). goal: 'win' | 'draw' */
  function startFight(fen, goal, prefix = []) {
    const pos = new Position(fen);
    for (const iccs of prefix) pos.makeMove(parseCoordMove(iccs));
    fight = { pos, moves: prefix.slice(), base: prefix.length, goal, startMat: matDiff(pos, userColor()), thinking: false, over: false, hints: 0 };
    if (checkFight()) return;
    if (pos.turn !== userColor()) engineMove();
  }

  function fightUserMove(m) {
    const rec = fight.pos.makeMove(m);
    fight.moves.push(moveToICCS(m));
    view.setHint(null);
    soundFor(rec);
    render(m.dragged ? null : m);
    if (!checkFight()) engineMove();
  }

  async function engineMove() {
    fight.thinking = true;
    render();
    const f = fight;
    try {
      await engine.init();
      // Thế nào kiểm định thấy máy cấp này yếu thì dùng thời gian nghĩ riêng (fightMovetime)
      // Tàn cuộc: máy chơi đủ sức (không giảm Skill), thời gian nghĩ theo kết quả kiểm tra từng thế (fightMovetime)
      const r = await engine.search(cur.fen, f.moves, { movetime: cur.fightMovetime || FIGHT_MS });
      if (fight !== f || !active) return;
      if (r.move) {
        const m = parseCoordMove(r.move);
        const rec = f.pos.makeMove(m);
        f.moves.push(r.move);
        soundFor(rec);
        f.thinking = false;
        render(m);
      }
    } catch (e) {
      if (e.message !== 'cancelled') toast('Engine lỗi: ' + e.message);
    }
    f.thinking = false;
    if (fight === f) { checkFight(); render(); }
  }

  function checkFight() {
    const maxPlies = fight.goal === 'win' ? WIN_PLIES : DRAW_PLIES;
    const st = goalStatus(fight.pos, fight.goal, userColor(), { plies: fight.moves.length - (fight.base || 0), maxPlies });
    if (!st.done) return false;
    fight.over = true;
    Sound.end();
    if (cur.kind === 'end') {
      const q = st.success ? (fight.hints ? 3 : 5) : 1;
      record(st.success, q);
      $('pzMethod').textContent = 'Phương pháp: ' + cur.method;
    } else {
      // Trung cuộc / cờ thế cổ: đánh tiếp sau lời giải — ghi riêng "đã thắng máy" (không đổi lịch ôn SRS)
      const p = progress[cur.id] || { tries: 0 };
      if (st.success) p.won = true;
      progress[cur.id] = p; save();
    }
    feedback(st.success ? 'ok' : 'bad', st.text);
    updateButtons();
    return true;
  }

  async function fightHint() {
    hintStep++;
    fight.hints++;
    $('pzMethod').textContent = cur.method ? 'Phương pháp: ' + cur.method : 'Gợi ý: giữ thế công, đổi quân khi đang hơn quân, tránh để đối phương phản kích vào tướng.';
    if (hintStep >= 2) {
      try {
        busy = true;
        feedback('info', 'Đang hỏi engine…');
        await engine.init();
        const r = await engine.search(cur.fen, fight.moves, { movetime: 1500 });
        busy = false;
        if (r.move) {
          const m = parseCoordMove(r.move);
          view.setHint(hintStep >= 3 ? m : { from: m.from });
          feedback('info', hintStep >= 3 ? `Engine đề nghị: <b>${label(fight.pos, r.move)}</b>.` : 'Quân nên đi đã được đánh dấu.');
        }
      } catch { busy = false; }
    } else feedback('info', 'Gợi ý 1: đọc phương pháp bên dưới.');
    updateButtons();
  }

  // ---------- Nút ----------
  $('pzHint').onclick = () => {
    if (fight) return fightHint();
    hintStep = Math.min(3, hintStep + 1);
    const h = ses.hint(hintStep);
    if (!h) return;
    if (h.level === 1) feedback('info', 'Gợi ý 1: ' + h.text);
    else if (h.level === 2) { view.setHint({ from: h.from }); feedback('info', 'Gợi ý 2: quân cần đi đã được đánh dấu.'); }
    else { view.setHint({ from: h.from, to: h.to }); feedback('info', `Gợi ý 3: nước đi là <b>${label(ses.pos, h.iccs)}</b>.`); }
    updateButtons();
  };
  $('pzShow').onclick = () => {
    if (!ses || ses.state === 'solved') return;
    // Đi hết lời giải còn lại, tính là chưa đạt
    ses.mistakes++;
    while (ses.state === 'play') { const iccs = ses.expected(); ses._apply(iccs); }
    feedback('warn', 'Lời giải: ' + (cur.solutionVn || ''));
    finishPuzzle();
  };
  $('pzRetry').onclick = () => start(cur);
  $('pzFight').onclick = () => {
    if (cur.kind === 'end') {
      // Xem ván engine tự đánh mẫu ở Bàn cờ (xem lại từng nước)
      exitTo(() => ctx.loadIntoFree({ startFen: cur.fen, title: cur.name + ' — engine đánh mẫu', plan: 'Phương pháp: ' + cur.method, moves: cur.sample, ply: 0 }));
      return;
    }
    if (fight && fight.over) {
      // Đã đánh xong: mở ván ở chế độ Đánh với máy để phân tích / lưu
      const fen = cur.fen, moves = fight.moves.slice(), side = cur.side;
      exitTo(() => ctx.startPlay({ startFen: fen, moves, side }));
      return;
    }
    // Đánh tiếp ngay tại đây từ thế hiện tại, máy đủ sức; đạt mục tiêu thì tính hoàn thành
    const goal = cur.kind === 'classic' && cur.result === 'draw' ? 'draw' : 'win';
    const prefix = ses ? ses.played.slice() : [];
    ses = null; hintStep = 0;
    view.setHint(null);
    startFight(cur.fen, goal, prefix);
    $('pzGoal').textContent = `Đánh tiếp với máy — mục tiêu: ${goal === 'win' ? `thắng (trong ${WIN_PLIES / 2} nước)` : `giữ hòa (${DRAW_PLIES / 2} nước)`}.`;
    feedback('info', `Máy đủ sức, ${(FIGHT_MS / 1000).toFixed(1)} giây/nước. Bấm "Gợi ý" nếu cần.`);
    updateButtons();
    render();
  };
  $('pzNext').onclick = () => {
    const i = listOrder.findIndex((x) => x.id === cur.id);
    const next = listOrder[i + 1] || listOrder.find((x) => !progress[x.id]?.solved) || listOrder[0];
    if (next) start(next);
  };
  $('pzExit').onclick = () => exitTo(() => enter(tab));

  function exitTo(fn) { leave(); fn(); }

  function leave() {
    if (!active) return;
    active = false;
    if (fight?.thinking) engine.stop();
    fight = null; ses = null; busy = false;
    view.setHint(null);
    if (view.flipped !== prevFlip) view.setFlipped(prevFlip);
    ctx.setController(null);
  }

  function soundFor(rec) {
    if (!rec) return Sound.move();
    if (rec.check) Sound.check(); else if (rec.captured) Sound.capture(); else Sound.move();
  }

  // Móc cho bộ kiểm thử giao diện (tools/ui-positions.cjs)
  window.__XQT_TEST_CUR__ = () => cur && { id: cur.id, solution: cur.solution || [] };
  window.__XQT_TEST_STATE__ = () => ses && { ply: ses.ply, state: ses.state, userTurn: ses.isUserTurn(), busy, turn: ses.pos.turn, side: ses.side };
  window.__XQT_TEST_ANY__ = () => { const pos = fight ? fight.pos : ses?.pos; const m = pos?.legalMoves()[0]; return m ? moveToICCS(m) : null; };
  window.__XQT_TEST_FIGHT__ = () => fight && { moves: fight.moves.length, base: fight.base, over: fight.over, thinking: fight.thinking };
  window.__XQT_TEST_WRONG__ = () => {
    if (!ses || !ses.isUserTurn()) return null;
    const ok = new Set([ses.expected(), ...(cur.alts?.[ses.ply] || [])]);
    const m = ses.pos.legalMoves().find((x) => !ok.has(moveToICCS(x)));
    return m ? moveToICCS(m) : null;
  };

  /** Cho màn hình Tổng quan */
  async function reviewTab(which) { if (!data) await load(); enter(which); $('psReview').click(); }
  async function getData() { if (!data) await load(); return data; }
  return { load, enter, leave, isActive: () => active, tab: () => tab, renderList, reviewTab, getData,
    getCards: () => cards, getProgress: () => progress, themeOf };
}
