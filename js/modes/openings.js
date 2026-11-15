// =====================================================================
// CHẾ ĐỘ LUYỆN KHAI CUỘC (giao diện)
// - Màn hình danh sách: lọc Lý thuyết / Bẫy cổ điển, "Ôn ngẫu nhiên"
// - Hộp thoại: chọn bên (Đỏ đi trước / Đen đi sau), chế độ Học mới / Kiểm tra, xem các biến
// - Màn hình luyện: dùng chung bàn cờ; máy đi nước đối phương theo cây biến
// =====================================================================
import { applyEdits, saveLine, deleteLine, resetOpening, normalizeEdits } from '../train/user-openings.js';
import { OpeningTrainer, subtreeStats, pickReview } from '../train/trainer.js';
import { accuracy } from '../train/srs.js';
import { logActivity } from '../train/progress.js';
import { parseCoordMove, colorOf, Position, moveToICCS } from '../core/xiangqi.js';
import { moveToNotation } from '../core/notation.js';
import { engine } from '../engine/client.js';
import { analyzeMove, purposeQuiz } from '../train/move-insight.js';
import { whyHTML, loadInsights } from './why.js';

const $ = (id) => document.getElementById(id);
const SIDE_NAME = { r: 'Đỏ (đi trước)', b: 'Đen (đi sau)' };

export function initOpenings(ctx) {
  // ctx: { view, store, settings, Sound, toast, setController, showScreen, loadIntoFree, moveLabel }
  const { view, store, Sound, toast } = ctx;
  let openings = [];
  let cards = store.getJSON('srs', {}) || {};
  let filter = 'all';
  let trainer = null;
  let busy = false;              // đang chờ máy đi
  let lastCfg = null;            // { op, side, mode } của lần luyện gần nhất
  let selected = null;           // khai cuộc đang mở trong hộp thoại
  let prevFlip = false;
  let baseData = null;           // dữ liệu gốc (JSON)
  let edits = normalizeEdits(store.getJSON('openingEdits', null));

  // Mỗi lần trả lời một nước = một lần luyện (ghi nhật ký ngày luyện)
  const saveCards = () => { store.setJSON('srs', cards); logActivity(store, 'open'); };
  const saveEdits = () => store.setJSON('openingEdits', edits);

  /** Ghép dữ liệu gốc + chỉnh sửa của anh rồi dựng lại cây */
  function rebuild() {
    openings = applyEdits(baseData.openings, edits);
    const all = openings.flatMap((o) => o.lines);
    const ok = all.filter((l) => l.verification?.engine === 'đạt').length;
    const checked = all.filter((l) => l.verification?.engine && l.verification.engine !== 'chưa kiểm định').length;
    const mine = all.filter((l) => l.userEdited || l.userAdded).length;
    $('opNote').textContent = `${openings.length} mẫu khai cuộc, ${all.length} biến${mine ? ` (${mine} biến anh soạn/sửa)` : ''}. Fairy-Stockfish đã chấm ${checked} biến: ${ok} đạt, ${checked - ok} cần xem lại.`;
  }

  // ---------- Nạp dữ liệu ----------
  async function load() {
    try {
      let data = window.__XQT_OPENINGS__;
      if (!data) {
        const res = await fetch('data/openings.built.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
      }
      baseData = data;
      try { rebuild(); } catch (e) {
        // Chỉnh sửa hỏng (hiếm) => bỏ qua để app vẫn chạy
        console.warn('Bỏ qua chỉnh sửa lỗi:', e); edits = normalizeEdits(null); rebuild();
      }
      renderList();
    } catch (e) {
      $('opNote').textContent = 'Không tải được dữ liệu khai cuộc (' + e.message + '). Hãy mở app qua địa chỉ web (http/https), không mở trực tiếp file.';
    }
  }

  // ---------- Danh sách ----------
  function statsOf(op) {
    const now = Date.now();
    let due = 0, total = 0, seen = 0, correct = 0;
    for (const side of op.sides) {
      const st = subtreeStats(op, op.root, side, cards, now);
      total += st.total;
      // Chỉ tính "đến hạn" cho nút đã từng luyện (nút mới chưa học không tính là nợ)
      for (const n of op.nodes.values()) {
        const c = cards[`${op.id}|${side}|${n.key}`];
        if (!c) continue;
        seen += c.seen; correct += c.correct;
        if (c.due <= now) due++;
      }
    }
    return { due, total, acc: seen ? correct / seen : null, started: seen > 0 };
  }

  function engStat(op) {
    const ls = op.lines.filter((l) => l.verification?.engine && l.verification.engine !== 'chưa kiểm định');
    if (!ls.length) return '';
    return ` · engine đạt ${ls.filter((l) => l.verification.engine === 'đạt').length}/${op.lines.length}`;
  }

  function renderList() {
    const list = $('opList');
    list.innerHTML = '';
    const groups = new Map();
    for (const op of openings) {
      if (filter !== 'all' && op.kind !== filter) continue;
      if (!groups.has(op.group)) groups.set(op.group, []);
      groups.get(op.group).push(op);
    }
    let dueAll = 0;
    for (const op of openings) dueAll += statsOf(op).due;
    $('dueBadge').textContent = dueAll ? dueAll : '';
    for (const [g, ops] of groups) {
      const sec = document.createElement('section');
      sec.className = 'op-group';
      const h = document.createElement('h3');
      h.textContent = g;
      sec.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'op-grid';
      for (const op of ops) {
        const st = statsOf(op);
        const b = document.createElement('button');
        b.className = 'op-card' + (op.kind === 'trap' ? ' trap' : '');
        const sides = op.sides.map((s) => (s === 'r' ? 'Đỏ' : 'Đen')).join(' / ');
        b.innerHTML = `<span class="op-name"></span>
          <span class="op-meta">${op.lines.length} biến · cầm ${sides}${engStat(op)}</span>
          <span class="op-stat">${st.started ? `Đúng ${Math.round((st.acc || 0) * 100)}%` : 'Chưa luyện'}${st.due ? ` · <b>${st.due} cần ôn</b>` : ''}</span>`;
        b.querySelector('.op-name').textContent = op.name;
        b.onclick = () => openDialog(op);
        grid.appendChild(b);
      }
      sec.appendChild(grid);
      list.appendChild(sec);
    }
  }

  document.querySelectorAll('#screenOpenings .chip').forEach((c) => {
    c.onclick = () => {
      document.querySelectorAll('#screenOpenings .chip').forEach((x) => x.classList.toggle('on', x === c));
      filter = c.dataset.filter;
      renderList();
    };
  });

  $('btnReview').onclick = () => startReview();

  function startReview() {
    if (!openings.length) return;
    const pick = pickReview(openings.filter((o) => o.kind === 'theory'), cards);
    if (!pick) return;
    start(pick.op, pick.side, 'test');
    toast(`Ôn: ${pick.op.name} — anh cầm ${pick.side === 'r' ? 'Đỏ' : 'Đen'}`);
  }

  // ---------- Hộp thoại chọn cách luyện ----------
  function openDialog(op) {
    selected = op;
    $('opTitle').textContent = op.name;
    $('opSummary').textContent = op.summary;
    $('opSource').textContent = 'Nguồn: ' + op.source;
    const r = $('opSideR'), b = $('opSideB');
    r.disabled = !op.sides.includes('r');
    b.disabled = !op.sides.includes('b');
    const lastSide = store.getJSON('lastSide', 'r');
    (op.sides.includes(lastSide) ? (lastSide === 'r' ? r : b) : (op.sides[0] === 'r' ? r : b)).checked = true;
    const lastMode = store.getJSON('lastMode', 'learn');
    ({ test: $('opModeTest'), purpose: $('opModePurpose') }[lastMode] || $('opModeLearn')).checked = true;
    $('opLineCount').textContent = op.lines.length;
    const ol = $('opLines');
    ol.innerHTML = '';
    for (const l of op.lines) {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'line-head';
      const name = document.createElement('b');
      name.textContent = l.name;
      if (l.userAdded || l.userEdited) {
        const tg = document.createElement('span');
        tg.className = 'tag user';
        tg.textContent = l.userAdded ? 'anh thêm' : 'anh sửa';
        name.appendChild(tg);
      }
      const acts = document.createElement('div');
      acts.className = 'line-actions';
      const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small-btn'; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
      mk('Xem', () => { $('dlgOpening').close('view'); showLine(op, l); });
      mk('Sửa', () => { $('dlgOpening').close('edit'); editLine(op, l); });
      mk('Xóa', () => removeLine(op, l));
      head.append(name, acts);
      const mv = document.createElement('p');
      mv.className = 'line-moves';
      mv.textContent = lineText(op, l);
      li.append(head, mv);
      const v = l.verification || {};
      if (v.engine && v.engine !== 'chưa kiểm định') {
        const e = document.createElement('p');
        e.className = 'small ' + (v.engine === 'đạt' ? 'eng-ok' : 'eng-flag');
        const fin = v.engineFinal !== undefined ? ` Cuối biến: Đỏ ${(v.engineFinal > 0 ? '+' : '') + (v.engineFinal / 100).toFixed(1)}.` : '';
        e.textContent = v.engine === 'đạt'
          ? `Engine: đạt (không nước nào mất quá 0.8).${v.engineNote ? ' Lưu ý: ' + v.engineNote + '.' : ''}${fin}`
          : `Engine: cần xem lại — ${[...(v.engineFlags || []).map((x) => `nước ${x.ply} ${ctx.moveLabelVN(x.vn)} mất ${(x.loss / 100).toFixed(1)}`), v.engineNote].filter(Boolean).join('; ')}.${fin}`;
        li.appendChild(e);
      }
      if (!(v.engine && v.engine !== 'chưa kiểm định') && v.warnings?.length) {
        const w = document.createElement('p');
        w.className = 'muted small';
        w.textContent = 'Cần xem lại: ' + l.verification.warnings.join('; ');
        li.appendChild(w);
      }
      ol.appendChild(li);
    }
    $('opReset').hidden = !(op.hasEdits || op.custom);
    $('opReset').textContent = op.custom ? 'Xóa khai cuộc này' : 'Khôi phục dữ liệu gốc';
    $('opStart').disabled = !op.lines.length;
    $('dlgOpening').returnValue = '';
    if (!$('dlgOpening').open) $('dlgOpening').showModal();
  }

  // ---------- Thêm / sửa / xóa biến ----------
  function afterEdit(opId) {
    rebuild();
    ctx.showScreen('openings');
    renderList();
    const op = openings.find((o) => o.id === opId);
    if (op) { openDialog(op); $('opLinesBox').open = true; }
  }

  function editLine(op, line) {
    ctx.editor.open({
      op, line,
      onSave: (data, asNew) => {
        const r = saveLine(edits, op, line ? line.id : null, data, asNew);
        edits = r.edits; saveEdits();
        setTimeout(() => afterEdit(op.id), 0);
        return true;
      },
      onCancel: () => afterEdit(op.id),
    });
  }

  async function removeLine(op, line) {
    const msg = line.userAdded ? `Xóa hẳn biến "${line.name}"?` : `Ẩn biến "${line.name}" khỏi khai cuộc? (Có thể khôi phục bằng "Khôi phục dữ liệu gốc".)`;
    $('dlgOpening').close('del');
    if (await ctx.askConfirm('Xóa biến', msg)) {
      edits = deleteLine(edits, op, line.id); saveEdits();
      toast('Đã xóa biến.');
    }
    afterEdit(op.id);
  }

  $('opAddLine').onclick = () => { const op = selected; $('dlgOpening').close('edit'); editLine(op, null); };
  $('opReset').onclick = async () => {
    const op = selected;
    $('dlgOpening').close('reset');
    const msg = op.custom ? `Xóa khai cuộc "${op.name}" và mọi biến trong đó?` : `Bỏ mọi biến anh đã thêm/sửa/xóa trong "${op.name}" và trở về dữ liệu gốc?`;
    if (await ctx.askConfirm(op.custom ? 'Xóa khai cuộc' : 'Khôi phục dữ liệu gốc', msg)) {
      edits = resetOpening(edits, op); saveEdits();
      toast('Đã cập nhật.');
      if (op.custom) { rebuild(); renderList(); return; }
    }
    afterEdit(op.id);
  };

  // Khai cuộc mới do anh tự tạo
  $('btnNewOpening').onclick = () => { $('noName').value = ''; $('noSummary').value = ''; $('noErr').textContent = ''; $('dlgNewOp').returnValue = ''; $('dlgNewOp').showModal(); };
  $('dlgNewOp').addEventListener('close', () => {
    if ($('dlgNewOp').returnValue !== 'ok') return;
    const name = $('noName').value.trim() || 'Khai cuộc của tôi';
    const sides = [$('noSideR').checked && 'r', $('noSideB').checked && 'b'].filter(Boolean);
    const op = {
      id: 'my-' + Date.now().toString(36), name, group: 'Khai cuộc của tôi', kind: 'theory',
      sides: sides.length ? sides : ['r', 'b'], summary: $('noSummary').value.trim(), source: 'Khai cuộc anh Thắng tự tạo',
      startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1', custom: true, lines: [],
    };
    editLine(op, null);
  });

  $('dlgOpening').addEventListener('close', () => {
    if ($('dlgOpening').returnValue !== 'start' || !selected) return;
    const side = document.querySelector('input[name="opSide"]:checked')?.value || selected.sides[0];
    const mode = document.querySelector('input[name="opMode"]:checked')?.value || 'learn';
    store.setJSON('lastSide', side);
    store.setJSON('lastMode', mode);
    start(selected, side, mode);
  });

  /** Chuỗi nước của một biến: lấy theo đường đi trong cây tới lá */
  function pathNodes(op, line) {
    const keys = line.lastKey ? line.lastKey.split(' ') : [];
    const out = [];
    for (let i = 1; i <= keys.length; i++) out.push(op.nodes.get(keys.slice(0, i).join(' ')));
    return out;
  }
  function lineText(op, line) {
    return pathNodes(op, line).map((n, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + ctx.moveLabelVN(n.vn)).join(' ');
  }

  /** Nạp một biến vào bàn tự do để xem lại từng nước kèm chú thích */
  function showLine(op, line) {
    const nodes = pathNodes(op, line);
    ctx.loadIntoFree({
      startFen: op.startFen,
      moves: nodes.map((n) => n.iccs),
      comments: nodes.map((n) => n.comments.join(' ')),
      ply: 0,
      title: `${op.name} — ${line.name}`,
      plan: line.plan,
    });
  }

  // ---------- Luyện ----------
  function start(op, side, mode) {
    lastCfg = { op, side, mode };
    purpose = mode === 'purpose';
    // Chế độ "Đoán ý đồ" không chấm lịch ôn (SRS) — dùng bộ thẻ tạm
    trainer = new OpeningTrainer(op, { side, mode: purpose ? 'learn' : mode, cards: purpose ? {} : cards });
    quizScore = { right: 0, total: 0 };
    loadInsights();
    prevFlip = view.flipped;
    ctx.setController(controller);
    ctx.showScreen('train');
    if (view.flipped !== (side === 'b')) view.setFlipped(side === 'b');
    $('trName').textContent = op.name;
    $('trMode').textContent = mode === 'learn' ? 'Học mới' : purpose ? 'Đoán ý đồ' : 'Kiểm tra';
    $('trMode').className = 'pill ' + (mode === 'test' ? 'test' : 'learn');
    $('trReveal').hidden = purpose;
    $('trQuiz').hidden = true;
    clearWhy();
    $('trEnd').hidden = true;
    setFeedback('', '');
    $('trComment').textContent = '';
    update();
    step();
  }

  function setFeedback(kind, html) {
    const el = $('trFeedback');
    el.className = 'feedback ' + kind;
    el.innerHTML = html;
  }

  function nodeNote(n) { return n && n.comments.length ? n.comments.join(' ') : ''; }

  // ---------- "Vì sao?" ----------
  let purpose = false, quizScore = { right: 0, total: 0 };
  /** Thế cờ TRƯỚC nước của nút n */
  function fenBefore(op, n) {
    const p = new Position(op.startFen);
    const keys = n.key.split(' ');
    for (const mv of keys.slice(0, -1)) p.makeMove(parseCoordMove(mv));
    return p.fen();
  }
  function clearWhy() { $('trWhy').hidden = true; $('trWhyBody').innerHTML = ''; }
  async function showWhy(n, prefix) {
    const t = trainer;
    if (!n || !t) return clearWhy();
    const fen = fenBefore(t.op, n);
    $('trWhySum').textContent = `Vì sao ${prefix ? prefix + ' ' : ''}${ctx.moveLabelVN(n.vn)}?`;
    $('trWhy').hidden = false;
    const data = await loadInsights();
    if (trainer !== t) return;
    $('trWhyBody').innerHTML = whyHTML(fen, n.iccs, data, ctx.moveLabelVN);
  }
  $('trWhy').open = !!store.getJSON('whyOpen', true);
  $('trWhy').addEventListener('toggle', () => store.setJSON('whyOpen', $('trWhy').open));

  // ---------- "Đoán ý đồ": hỏi mục đích của nước lý thuyết bên anh ----------
  function askPurpose() {
    const t = trainer;
    const ex = t.mainExpected();
    const ins = analyzeMove(fenBefore(t.op, ex), parseCoordMove(ex.iccs));
    const q = purposeQuiz(ins);
    view.setHint(parseCoordMove(ex.iccs));
    clearWhy();
    $('trComment').textContent = '';
    setFeedback('info', `Nước lý thuyết tiếp theo của anh là <b>${ctx.moveLabelVN(ex.vn)}</b> (đã đánh dấu trên bàn). Nước này nhằm mục đích <b>chính</b> gì?`);
    const box = $('trQuiz');
    box.hidden = false;
    box.innerHTML = q.options.map((o, i) => `<button class="btn quiz-opt" data-i="${i}">${o.text}</button>`).join('');
    box.querySelectorAll('.quiz-opt').forEach((b) => {
      b.onclick = () => {
        const pick = q.options[+b.dataset.i];
        const ok = pick.cat === q.answer;
        quizScore.total++; if (ok) quizScore.right++;
        logActivity(store, 'open');
        const stats = store.getJSON('purposeStats', { right: 0, total: 0 });
        stats.total++; if (ok) stats.right++;
        store.setJSON('purposeStats', stats);
        box.querySelectorAll('.quiz-opt').forEach((x) => {
          const o = q.options[+x.dataset.i];
          x.disabled = true;
          if (o.cat === q.answer) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        ok ? Sound.move() : Sound.error();
        setFeedback(ok ? 'ok' : 'bad', (ok ? 'Đúng! ' : 'Chưa đúng. ') + `Mục đích chính của <b>${ctx.moveLabelVN(ex.vn)}</b>: ${ins.tags.filter((x) => x.cat === q.answer).map((x) => x.text).join('; ')}. <span class="muted small">(Đúng ${quizScore.right}/${quizScore.total} câu trong lượt này.)</span>`);
        // Đi nước lý thuyết rồi hiện giải thích đầy đủ
        const res = t.userMove(parseCoordMove(ex.iccs));
        update(parseCoordMove(ex.iccs));
        showWhy(res.node || ex);
        if (!t.isEnd()) $('status').textContent = 'Đọc giải thích rồi bấm "Tiếp tục"';
        const next = document.createElement('button');
        next.className = 'btn primary quiz-next';
        next.textContent = 'Tiếp tục ▸';
        next.onclick = () => { box.hidden = true; step(); };
        box.appendChild(next);
        next.focus();
      };
    });
  }

  function update(animate = null) {
    const t = trainer;
    const pos = t.pos;
    const checkSq = pos.inCheck() ? pos.kingSq(pos.turn) : -1;
    const last = t.path.length ? parseCoordMove(t.path[t.path.length - 1].node.iccs) : null;
    view.render({ board: pos.board, last, checkSq, animate });
    // Gợi ý ở chế độ Học mới
    if (t.mode === 'learn' && !purpose && t.isUserTurn()) {
      const ex = t.mainExpected();
      view.setHint(parseCoordMove(ex.iccs));
    } else view.setHint(null);
    const st = $('status');
    st.className = 'status' + (checkSq >= 0 ? ' check' : '');
    st.textContent = t.isEnd() ? 'Hết biến' : t.isUserTurn() ? `Lượt anh (${t.side === 'r' ? 'Đỏ' : 'Đen'})${checkSq >= 0 ? ' — đang bị chiếu!' : ''}` : 'Máy đang đi…';
    const line = t.currentLine();
    const done = t.path.filter((p) => p.by === 'user').length;
    // Cảnh báo nếu nước vừa đi bị engine gắn cờ trong biến này
    const loss = line?.verification?.engineLoss?.[t.path.length - 1];
    const warnEl = document.getElementById('trEngineWarn');
    const thr = line?.verification?.engineThreshold || 80;
    if (warnEl) warnEl.textContent = loss > thr ? `⚠ Engine đánh giá nước vừa đi mất khoảng ${(loss / 100).toFixed(1)} điểm — biến này đang được gắn cờ "cần xem lại".` : '';
    const scoreTxt = purpose ? (quizScore.total ? ` · đoán đúng ${quizScore.right}/${quizScore.total}` : '') : (done ? ` · đúng ${t.score.correct}/${done}` : '');
    $('trMeta').textContent = `Anh cầm ${SIDE_NAME[t.side]} · ${line ? line.name : ''} · nước ${t.path.length}${scoreTxt}`;
    $('trMoves').textContent = t.path.map((p, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + ctx.moveLabelVN(p.node.vn) + (p.result === 'wrong' ? '✗' : '')).join(' ');
  }

  /** Bước tiếp theo: máy đi nếu đến lượt máy, báo hết biến nếu hết */
  function step() {
    const t = trainer;
    if (t.isEnd()) return finish();
    if (t.isUserTurn()) {
      if (purpose) { askPurpose(); return; }
      if (t.mode === 'learn') {
        const ex = t.mainExpected();
        const alt = t.expected().length > 1 ? ` (lý thuyết còn ${t.expected().length - 1} nước khác cũng đúng)` : '';
        setFeedback('info', `Lượt anh. Nước lý thuyết: <b>${ctx.moveLabelVN(ex.vn)}</b>${alt}`);
        $('trComment').textContent = nodeNote(ex);
        showWhy(ex, 'đi');
      } else if (!$('trFeedback').textContent) {
        setFeedback('info', 'Lượt anh. Đi nước theo lý thuyết.');
      }
      return;
    }
    busy = true;
    setTimeout(() => {
      if (!trainer || trainer !== t) return;
      const n = t.opponentMove();
      busy = false;
      if (!n) return;
      Sound.move();
      update(parseCoordMove(n.iccs));
      const note = nodeNote(n);
      $('trComment').textContent = note ? `Máy đi ${ctx.moveLabelVN(n.vn)}: ${note}` : `Máy đi ${ctx.moveLabelVN(n.vn)}.`;
      showWhy(n, 'máy đi');
      step();
    }, t.path.length === 0 ? 350 : 650);
  }

  function finish() {
    const t = trainer;
    view.setHint(null);
    saveCards();
    const line = t.currentLine();
    const total = t.score.correct + t.score.retry + t.score.wrong;
    $('trEnd').hidden = false;
    $('trReveal').hidden = true;
    $('trQuiz').hidden = true;
    if (purpose) {
      $('trSummary').innerHTML = `<b>${line ? line.name : 'Biến'}</b>: anh đoán đúng ý đồ ${quizScore.right}/${quizScore.total} nước.`;
      $('trPlan').textContent = line && line.plan ? 'Kế hoạch trung cuộc: ' + line.plan : '';
      setFeedback(quizScore.right === quizScore.total ? 'ok' : 'warn', 'Hết biến. Xem lại các nước đoán sai bằng nút "Luyện lại".');
      Sound.end();
      return;
    }
    $('trSummary').innerHTML = `<b>${line ? line.name : 'Biến'}</b>: đúng ngay ${t.score.correct}/${total}, đúng ở lần 2: ${t.score.retry}, sai: ${t.score.wrong}.`;
    $('trPlan').textContent = line && line.plan ? 'Kế hoạch trung cuộc: ' + line.plan : '';
    setFeedback(t.score.wrong ? 'warn' : 'ok', t.score.wrong ? 'Hết biến. Những nước sai sẽ được đưa vào lịch ôn sớm.' : 'Hết biến — anh đi đúng hết!');
    Sound.end();
  }

  // Bộ điều khiển bàn cờ khi đang luyện
  const controller = {
    canPick(s) {
      if (!trainer || busy || purpose || !trainer.isUserTurn()) return false;
      const p = trainer.pos.board[s];
      return !!p && colorOf(p) === trainer.side;
    },
    targets(s) { return trainer.pos.legalMoves(s).map((m) => m.to); },
    onMove(m) {
      const t = trainer;
      const res = t.userMove(m);
      if (res.result === 'correct') {
        Sound.move();
        const note = nodeNote(res.node);
        setFeedback('ok', res.quality === 5 ? `Đúng: <b>${ctx.moveLabelVN(res.node.vn)}</b>` : `Đúng ở lần thử thứ hai: <b>${ctx.moveLabelVN(res.node.vn)}</b>`);
        $('trComment').textContent = note;
        update(m.dragged ? null : m);
        showWhy(res.node);
        saveCards();
        step();
      } else if (res.result === 'retry') {
        Sound.error();
        setFeedback('warn', 'Chưa đúng nước lý thuyết. Anh thử lại một lần nữa.');
        update();
      } else if (res.result === 'wrong') {
        Sound.error();
        const note = nodeNote(res.node);
        const before = t.path.slice(0, -1).map((p) => p.node.iccs);
        const prevPos = new Position(t.op.startFen);
        for (const iccs of before) prevPos.makeMove(parseCoordMove(iccs));
        const mine = ctx.moveLabelVN(moveToNotation(prevPos, res.played));
        setFeedback('bad', `Anh đi <b>${mine}</b>. Nước đúng là <b>${ctx.moveLabelVN(res.node.vn)}</b>. ${note ? 'Lý do: ' + note : 'Đây là nước theo biến lý thuyết.'}<br><span class="muted small" id="trEngineCmp">Đang nhờ engine so sánh hai nước…</span>`);
        update(parseCoordMove(res.node.iccs));
        showWhy(res.node, 'phải đi');
        saveCards();
        compareMoves(t, before, res.played.iccs, res.node.iccs, mine, ctx.moveLabelVN(res.node.vn));
        setTimeout(step, 1800);
      } else {
        update();
      }
    },
  };

  /** Engine chấm thế sau nước anh đi và sau nước đúng (điểm theo góc nhìn bên anh) */
  async function compareMoves(t, before, mineIccs, rightIccs, mineName, rightName) {
    try {
      const fmt = (cp) => (Math.abs(cp) > 20000 ? (cp > 0 ? 'thắng' : 'thua') : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1));
      const a = await engine.search(t.op.startFen, [...before, mineIccs], { movetime: 700 });
      const b = await engine.search(t.op.startFen, [...before, rightIccs], { movetime: 700 });
      const el = document.getElementById('trEngineCmp');
      if (!el || trainer !== t) return;
      const sa = -a.score, sb = -b.score; // đổi về góc nhìn bên anh
      el.textContent = `Engine (${engine.name}): ${mineName} = ${fmt(sa)}, ${rightName} = ${fmt(sb)} (điểm theo bên anh, 1.0 ≈ một tốt).`;
    } catch (e) {
      const el = document.getElementById('trEngineCmp');
      if (el && e.message !== 'cancelled') el.textContent = 'Engine chưa chấm được: ' + e.message;
    }
  }

  $('trReveal').onclick = () => {
    if (!trainer || !trainer.isUserTurn()) return;
    const n = trainer.reveal();
    setFeedback('bad', `Nước đúng là <b>${ctx.moveLabelVN(n.vn)}</b>.`);
    $('trComment').textContent = nodeNote(n);
    update(parseCoordMove(n.iccs));
    showWhy(n, 'phải đi');
    saveCards();
    setTimeout(step, 1200);
  };
  $('trRestart').onclick = () => lastCfg && start(lastCfg.op, lastCfg.side, lastCfg.mode);
  $('trAgain').onclick = () => lastCfg && start(lastCfg.op, lastCfg.side, lastCfg.mode);
  $('trNextReview').onclick = () => startReview();
  $('trExit').onclick = () => exit();
  $('trToPlay').onclick = () => {
    const t = trainer;
    exit(false);
    ctx.startPlay({ startFen: t.op.startFen, moves: t.path.map((p) => p.node.iccs), side: t.side });
  };
  $('trToFree').onclick = () => {
    const t = trainer;
    exit(false);
    ctx.loadIntoFree({ startFen: t.op.startFen, moves: t.path.map((p) => p.node.iccs), ply: t.path.length, title: `Từ ${t.op.name}` });
    toast('Đã chuyển sang bàn tự do — anh đi tiếp cho cả hai bên.');
  };

  function exit(toList = true) {
    trainer = null;
    busy = false;
    view.setHint(null);
    ctx.setController(null);
    if (view.flipped !== prevFlip) view.setFlipped(prevFlip);
    if (toList) { ctx.showScreen('openings'); renderList(); }
  }

  /** Cho màn hình Tổng quan: luyện một khai cuộc theo id */
  function trainById(opId, side, mode = 'test') {
    const op = openings.find((o) => o.id === opId);
    if (op) start(op, side || op.sides[0], mode);
  }
  return { load, renderList, isTraining: () => !!trainer, exit, getOpenings: () => openings, getEdits: () => edits,
    getCards: () => cards, startReview, trainById, ready: () => openings.length > 0 };
}
