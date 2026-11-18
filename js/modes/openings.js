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
import { renderAfterOpening } from './after-opening.js';
import { deserializeOpening, sideToMoveAt } from '../train/opening-tree.js';
import { linePlan, lineKey, recordRun, nextLine, groupSet, MASTER_STREAK, isDue, dayOf } from '../train/line-plan.js';
import { repertoireChapters, buildDaily, parseGame, compareWithBook, lineThrough } from '../train/daily.js';

/** Tên hạng nước trong book (khớp tools/build-book.mjs) */
export const GRADE_NAME = { best: 'Mạnh nhất', good: 'Tốt', ok: 'Chơi được', weak: 'Yếu', blunder: 'Hớ' };
const GRADE_ORDER = { best: 0, good: 1, ok: 2, weak: 3, blunder: 4 };

const $ = (id) => document.getElementById(id);
const SIDE_NAME = { r: 'Đỏ (đi trước)', b: 'Đen (đi sau)' };

export function initOpenings(ctx) {
  // ctx: { view, store, settings, Sound, toast, setController, showScreen, loadIntoFree, moveLabel }
  const { view, store, Sound, toast } = ctx;
  let openings = [];
  let cards = store.getJSON('srs', {}) || {};
  let filter = 'book';
  let bookChapters = [];         // các chương book (data/book.built.json)
  let bookMeta = null;
  let lineProg = store.getJSON('lineProgress', {}) || {};   // tiến độ "Học theo biến"
  const saveLineProg = () => store.setJSON('lineProgress', lineProg);
  let session = null;            // { kind: 'line'|'group'|'daily', op, side, lineId?, groupKey?, queue?, idx? } khi đang học theo biến
  let keymoves = null;           // nước then chốt / tương đương (data/keymoves.json)
  let repertoire = store.getJSON('repertoire', { r: [], b: [] }) || { r: [], b: [] };
  let goalPending = false;       // đang xem "đích đến" trước khi học biến mới
  if (repertoire.r?.length || repertoire.b?.length) filter = 'rep';
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
    openings = [...applyEdits(baseData.openings, edits), ...bookChapters];
    const all = openings.flatMap((o) => o.lines);
    const mine = all.filter((l) => l.userEdited || l.userAdded).length;
    $('opNote').textContent = `${openings.length} mẫu khai cuộc, ${all.length} biến${mine ? ` (${mine} biến anh soạn/sửa)` : ''}. ` + verifySummary(openings);
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
      // Book xếp hạng (không bắt buộc: thiếu file thì app vẫn chạy với dữ liệu cũ)
      try {
        let book = window.__XQT_BOOK__;
        if (!book) { const rb = await fetch('data/book.built.json'); if (rb.ok) book = await rb.json(); }
        if (book) {
          bookMeta = book;
          // Cầm Đỏ trước, cầm Đen sau (giữ thứ tự khai cuộc trong từng bên)
          const order = (c) => (c.bookSide === 'r' ? 0 : 1);
          bookChapters = [...book.chapters].sort((a, b) => order(a) - order(b)).map((c) => {
            const op = deserializeOpening(c);
            op.group = `Book cầm ${c.bookSide === 'r' ? 'Đỏ' : 'Đen'} · ${c.group}`;
            return op;
          });
        }
      } catch (e) { console.warn('Không tải được book:', e); }
      if (!bookChapters.length && filter === 'book') filter = 'all';
      // Nước then chốt / tương đương (không bắt buộc)
      try {
        let km = window.__XQT_KEYMOVES__;
        if (!km) { const rk = await fetch('data/keymoves.json'); if (rk.ok) km = await rk.json(); }
        keymoves = km?.pos || null;
      } catch (e) { console.warn('Không tải được keymoves:', e); }
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
    if (filter === 'rep' && !(repertoire.r.length || repertoire.b.length)) filter = 'book';
    document.querySelectorAll('#screenOpenings .chip').forEach((x) => x.classList.toggle('on', x.dataset.filter === filter));
    $('opRepCard').hidden = !bookChapters.length;
    if (bookChapters.length) renderRepCard();
    const list = $('opList');
    list.innerHTML = '';
    const groups = new Map();
    for (const op of openings) {
      if (filter === 'rep') { if (!inRep(op)) continue; }
      else if (filter !== 'all' && op.kind !== filter) continue;
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
        b.className = 'op-card' + (op.kind === 'trap' ? ' trap' : op.kind === 'book' ? ' book' : '');
        const sides = op.sides.map((s) => (s === 'r' ? 'Đỏ' : 'Đen')).join(' / ');
        b.innerHTML = `<span class="op-name"></span>
          <span class="op-meta">${op.kind === 'book' ? `${op.lines.length} nhánh (${op.lines.filter((l) => l.alt).length} nhánh đối phương đi khác) · cầm ${sides}` : `${op.lines.length} biến · cầm ${sides}${engStat(op)}`}</span>
          <span class="op-stat">${st.started ? `Đúng ${Math.round((st.acc || 0) * 100)}%` : 'Chưa luyện'}${st.due ? ` · <b>${st.due} cần ôn</b>` : ''}</span>`;
        b.querySelector('.op-name').textContent = (inRep(op) ? '★ ' : '') + op.name;
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
    const pick = pickReview(openings.filter((o) => o.kind === 'theory' || o.kind === 'book'), cards);
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
    const isBook = op.kind === 'book';
    $('opOppGroup').hidden = !isBook;
    $('opBookBox').hidden = !isBook;
    $('opLinesBox').hidden = isBook;
    if (isBook) {
      (store.getJSON('lastOpp', 'book') === 'strange' ? $('opOppStrange') : $('opOppBook')).checked = true;
      renderBookTree(op, '');
    }
    renderPlan(op, currentSide(op));
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

  // ---------- Học theo biến ----------
  function currentSide(op) {
    const v = document.querySelector('input[name="opSide"]:checked')?.value;
    return op.sides.includes(v) ? v : op.sides[0];
  }
  ['opSideR', 'opSideB'].forEach((id) => $(id).addEventListener('change', () => { if (selected) renderPlan(selected, currentSide(selected)); }));

  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  /** Tên ngắn của biến (bỏ hậu tố hạng vì đã có huy hiệu) */
  const shortName = (l) => l.name.replace(/ — (Mạnh nhất|Tốt|Chơi được|Yếu|Hớ)$/, '');
  function progOf(op, side, id) { return lineProg[lineKey(op.id, side, id)] || null; }
  function stateHTML(p) {
    if (!p) return '<span class="pl-st new" title="Chưa học">•</span>';
    const due = isDue(p);
    if (p.mastered) return due ? '<span class="pl-st due" title="Đã thuộc — đến hạn ôn">✓ ôn</span>' : '<span class="pl-st done" title="Đã thuộc">✓</span>';
    return `<span class="pl-st doing" title="Nhớ đúng ${p.streak}/${MASTER_STREAK} ngày${due ? ' — đến hạn kiểm tra' : ''}">${p.streak}/${MASTER_STREAK}</span>`;
  }
  const pct = (x) => (x >= 0.995 ? '' : x >= 0.1 ? `≈${Math.round(x * 100)}% gặp` : x >= 0.01 ? `≈${(x * 100).toFixed(0)}% gặp` : '<1% gặp');
  $('opKeyOnly').checked = !!store.getJSON('keyOnly', false);
  $('opKeyOnly').onchange = () => store.setJSON('keyOnly', $('opKeyOnly').checked);

  function renderPlan(op, side) {
    const box = $('opPlan');
    const plan = linePlan(op, side);
    const real = plan.order.length;
    const done = plan.order.filter((id) => progOf(op, side, id)?.mastered).length;
    const nxt = nextLine(plan, lineProg, op, side);
    const nxtLine = nxt && op.lines.find((l) => l.id === nxt);
    const nxtGroup = nxt && plan.groups.find((g) => g.lines.some((x) => x.line.id === nxt));
    let html = `<p class="small">Đã thuộc <b>${done}/${real}</b> biến chính${plan.optional.length ? ` (+ ${plan.optional.length} biến tùy chọn, ít gặp)` : ''}. Thuộc = đi đúng hết ở ${MASTER_STREAK} ngày khác nhau (Kiểm tra, không gợi ý). Lần đầu học: xem đích đến rồi học có gợi ý. Thứ tự: hay gặp trước.</p>`;
    if (nxtLine) html += `<button type="button" class="btn primary plan-next" data-learn="${esc(nxt)}">▶ Học tiếp: ${esc(shortName(nxtLine))}</button>`;
    else if (real) html += '<p class="small"><b>Anh đã thuộc mọi biến của chương này.</b> Dùng "Luyện tổng hợp" để ôn.</p>';
    if (plan.branch.key) {
      const keys = plan.branch.key.split(' ');
      html += `<p class="muted small">Các biến chung phần đầu: ${keys.map((_, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + ctx.moveLabelVN(op.nodes.get(keys.slice(0, i + 1).join(' ')).vn)).join(' ')} — rồi rẽ nhánh:</p>`;
    }
    for (const g of plan.groups) {
      const gl = g.lines.filter((x) => !x.link && !x.optional);
      const gAll = g.lines.filter((x) => !x.link);
      const gDone = gl.filter((x) => progOf(op, side, x.line.id)?.mastered).length;
      const inf = g.info;
      const badge = inf ? `<span class="gr gr-${inf.grade}">${GRADE_NAME[inf.grade]}</span>` : '';
      const games = inf?.games ? ` <span class="small">${inf.games} ván cao thủ</span>` : '';
      const onlyLink = !gAll.length && g.lines[0]?.link;
      html += `<details class="plan-group"${g === nxtGroup ? ' open' : ''}><summary><b>${esc(g.vn ? g.label.replace(g.vn, ctx.moveLabelVN(g.vn)) : g.label)}</b> ${badge}${games}<span class="pl-reach">${g.reach !== undefined ? pct(g.reach) : ''}</span><span class="grow"></span><span class="small muted">${onlyLink ? '→ chương khác' : `thuộc ${gDone}/${gl.length}`}</span></summary>`;
      if (onlyLink) {
        html += `<p class="small">Nước này dẫn sang chương <b>${esc(g.lines[0].link.name)}</b>.</p><button type="button" class="btn small-btn" data-open="${esc(g.lines[0].link.id)}">Mở chương "${esc(g.lines[0].link.name)}" ▸</button>`;
      } else {
        html += '<ol class="plan-lines">';
        const SHOW = 8;
        let shown = 0, hidden = 0;
        for (const x of g.lines) {
          // Hiện 8 biến quan trọng nhất (+ biến đang học), còn lại ẩn sau nút "Xem thêm"
          const more = shown >= SHOW && x.line.id !== nxt;
          if (more) hidden++; else shown++;
          const cls = more ? ' more' : '';
          if (x.link) {
            html += `<li class="plan-line link${cls}"${more ? ' hidden' : ''}><span class="pl-st">→</span><span>${esc(shortName(x.line))}</span><span class="grow"></span><button type="button" class="btn small-btn" data-open="${esc(x.link.id)}">Mở chương ▸</button></li>`;
            continue;
          }
          const dev = x.rank[0] > 0 ? Object.keys(GRADE_NAME)[x.rank[0] - 1] : null;
          const p = progOf(op, side, x.line.id);
          html += `<li class="plan-line${cls}${p?.mastered ? ' done' : ''}${x.line.id === nxt ? ' cur' : ''}"${more ? ' hidden' : ''}>${stateHTML(p)}<span class="pl-name">${esc(shortName(x.line))}${dev ? ` <span class="gr gr-${dev}">${GRADE_NAME[dev]}</span>` : ' <span class="gr gr-main">Chính biến</span>'}${-x.rank[1] > 0 && dev ? ` <span class="small muted">${-x.rank[1]} ván</span>` : ''}${x.optional ? ' <span class="small muted">· tùy chọn</span>' : ''} <span class="pl-reach">${pct(x.reach ?? 1)}</span></span><span class="grow"></span><button type="button" class="btn small-btn" data-learn="${esc(x.line.id)}">Học</button></li>`;
        }
        html += '</ol>';
        if (hidden) html += `<button type="button" class="btn small-btn plan-more">Xem thêm ${hidden} biến (nước ít quan trọng hơn) ▾</button> `;
        if (gl.length > 1) {
          const gs = groupSet({ ...g, lines: g.lines.filter((x) => !x.optional) }, lineProg, op, side);
          const label = gs.lines.length > 1 ? `Ôn nhóm: ${gs.lines.length - (gs.focus ? 1 : 0)} biến đã thuộc${gs.focus ? ' + 1 biến mới' : ''}` : '';
          if (label) html += `<button type="button" class="btn small-btn" data-group="${esc(g.key)}">${label} ▸</button>`;
        }
      }
      html += '</details>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.plan-more').forEach((b) => { b.onclick = () => { b.parentElement.querySelectorAll('.plan-line.more').forEach((li) => { li.hidden = false; }); b.remove(); }; });
    box.querySelectorAll('[data-learn]').forEach((b) => { b.onclick = () => { $('dlgOpening').close('plan'); startLine(op, side, b.dataset.learn); }; });
    box.querySelectorAll('[data-group]').forEach((b) => { b.onclick = () => { $('dlgOpening').close('plan'); startGroup(op, side, b.dataset.group); }; });
    box.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = () => {
        const t = openings.find((o) => (o.kind === op.kind && (o.bookOf || o.id) === b.dataset.open && (o.kind !== 'book' || o.bookSide === side)));
        if (t) openDialog(t);
      };
    });
  }

  /** Học một biến: máy chỉ đi đúng biến đó. Lần đầu: xem đích đến rồi học có gợi ý; các lần sau: Kiểm tra */
  function runLine(op, side, lineId) {
    const p = progOf(op, side, lineId);
    const mode = p && p.runs ? 'test' : 'learn';
    start(op, side, mode, 'book', { lines: [lineId], focusLine: lineId, goal: mode === 'learn' });
    const l = op.lines.find((x) => x.id === lineId);
    toast(`${mode === 'learn' ? 'Học mới (có gợi ý)' : 'Kiểm tra'}: ${l ? shortName(l) : ''}`);
  }
  function startLine(op, side, lineId) {
    session = { kind: 'line', op, side, lineId };
    runLine(op, side, lineId);
  }

  // ---------- A3: Bài luyện hôm nay ----------
  function repChapters() { return repertoireChapters(bookChapters, repertoire); }
  function todayPlan() {
    const prio = (store.getJSON('priorityLines', []) || []).filter((x) => !lineProg[lineKey(x.opId, x.side, x.lineId)]?.runs);
    const d = buildDaily(repChapters(), lineProg);
    // Biến rút ra từ ván của anh (Phân tích ván) được học trước biến mới theo lộ trình
    for (const x of prio.slice(0, 1)) {
      const op = openings.find((o) => o.id === x.opId);
      if (op && !d.items.some((i) => i.op === op && i.lineId === x.lineId)) d.items.splice(d.items.findIndex((i) => i.kind === 'new') >= 0 ? d.items.findIndex((i) => i.kind === 'new') : d.items.length, 0, { op, side: x.side, lineId: x.lineId, kind: 'new', fromGame: true });
    }
    return d;
  }
  function startDaily() {
    if (!bookChapters.length) { toast('Đang tải dữ liệu khai cuộc…'); return; }
    if (!repChapters().length) { toast('Hãy chọn bộ khai cuộc của anh trước.'); openRepDialog(); return; }
    const d = todayPlan();
    if (!d.items.length) { toast('Hôm nay không còn biến nào phải ôn hay học mới trong bộ của anh. Tuyệt!'); return; }
    session = { kind: 'daily', queue: d.items, idx: 0 };
    runDailyItem();
  }
  function runDailyItem() {
    const it = session.queue[session.idx];
    Object.assign(session, { op: it.op, side: it.side, lineId: it.lineId });
    runLine(it.op, it.side, it.lineId);
  }
  function renderRepCard() {
    const reps = repChapters();
    const names = (side) => reps.filter((x) => x.side === side).map((x) => x.op.name).join('; ') || '—';
    $('opRepSum').innerHTML = reps.length
      ? `<b>Cầm Đỏ:</b> ${names('r')}<br><b>Cầm Đen:</b> ${names('b')}`
      : 'Chưa chọn. Hãy chọn 1 hệ cầm Đỏ và 1–2 phương án cầm Đen — app chỉ đưa các chương đó vào bài luyện hằng ngày.';
    if (!reps.length) { $('opDailySum').textContent = ''; return; }
    let learned = 0, total = 0, mastered = 0;
    for (const { op, side } of reps) {
      const plan = linePlan(op, side);
      total += plan.order.length;
      for (const id of plan.order) { const p = progOf(op, side, id); if (p?.runs) learned++; if (p?.mastered) mastered++; }
    }
    const d = todayPlan();
    const rev = d.items.filter((i) => i.kind === 'review').length;
    const neu = d.items.filter((i) => i.kind === 'new').length;
    $('opDailySum').textContent = `Bài hôm nay: ${rev} biến ôn${d.dueTotal > rev ? ` (còn ${d.dueTotal - rev} biến đến hạn để mai)` : ''} + ${neu} biến mới. Lộ trình: đã học ${learned}/${total}, thuộc ${mastered}/${total} biến.`;
  }
  $('btnDaily').onclick = () => startDaily();

  // ---------- A1: Bộ khai cuộc của anh ----------
  function openRepDialog() {
    const theoryIds = [];
    for (const c of bookChapters) if (!theoryIds.includes(c.bookOf)) theoryIds.push(c.bookOf);
    for (const side of ['r', 'b']) {
      const box = $(side === 'r' ? 'repR' : 'repB');
      box.innerHTML = theoryIds.map((id) => {
        const c = bookChapters.find((x) => x.bookOf === id && x.bookSide === side);
        if (!c) return '';
        const on = repertoire[side]?.includes(id) ? ' checked' : '';
        return `<label><input type="checkbox" data-side="${side}" value="${esc(id)}"${on}><span>${esc(c.name)}</span></label>`;
      }).join('');
    }
    const count = () => {
      let pos = 0;
      for (const el of document.querySelectorAll('#dlgRep input:checked')) {
        const c = bookChapters.find((x) => x.bookOf === el.value && x.bookSide === el.dataset.side);
        if (c) pos += [...c.nodes.values()].filter((n) => n.children.length && sideToMoveAt(c, n) === el.dataset.side).length;
      }
      $('repCount').textContent = pos ? `Khoảng ${pos} thế anh phải tự đi (gồm cả biến tùy chọn).` : 'Chưa chọn chương nào.';
    };
    document.querySelectorAll('#dlgRep input').forEach((el) => { el.onchange = count; });
    count();
    $('dlgRep').showModal();
  }
  $('btnRepPick').onclick = openRepDialog;
  $('dlgRep').addEventListener('close', () => {
    if ($('dlgRep').returnValue !== 'save') return;
    repertoire = { r: [], b: [] };
    for (const el of document.querySelectorAll('#dlgRep input:checked')) repertoire[el.dataset.side].push(el.value);
    store.setJSON('repertoire', repertoire);
    toast('Đã lưu bộ khai cuộc của anh.');
    if (filter === 'book' && (repertoire.r.length || repertoire.b.length)) filter = 'rep';
    renderList();
  });
  const inRep = (op) => op.kind === 'book' && repertoire[op.bookSide]?.includes(op.bookOf);

  // ---------- B3: Phân tích ván của anh so với book ----------
  $('btnGame').onclick = () => { $('gameResult').innerHTML = ''; $('dlgGame').showModal(); };
  $('gameFromFree').onclick = () => {
    const g = ctx.getFreeGame?.();
    if (!g || !g.moves.length) { toast('Bàn cờ tự do chưa có nước nào.'); return; }
    if (g.startFen.split(' ')[0] !== op0Fen().split(' ')[0]) { toast('Ván ở Bàn cờ không bắt đầu từ thế khởi đầu.'); return; }
    $('gameText').value = g.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + m.vn).join(' ');
  };
  const op0Fen = () => bookChapters[0]?.startFen || 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  $('gameRun').onclick = async () => {
    const box = $('gameResult');
    const side = document.querySelector('input[name="gameSide"]:checked').value;
    const g = parseGame($('gameText').value, op0Fen());
    if (!g.moves.length) { box.innerHTML = `<p class="err">${esc(g.error || 'Chưa có nước nào.')}</p>`; return; }
    const repIds = repertoire[side] || [];
    const r = compareWithBook(bookChapters, g.moves, side, repIds);
    if (!r) { box.innerHTML = '<p class="err">Chưa có book cho bên này.</p>'; return; }
    const label = (i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + ctx.moveLabelVN(g.vn[i]);
    const movesHTML = g.vn.map((_, i) => `<span class="${i < r.ply ? 'in-book' : i === r.ply ? 'out-book' : ''}">${label(i)}</span>`).join(' ');
    let html = `${g.error ? `<p class="err">${esc(g.error)} (chỉ phân tích phần đọc được)</p>` : ''}<p class="moves-line">${movesHTML}</p>`;
    html += `<p class="small">Chương gần nhất: <b>${esc(r.op.name)}</b> (book cầm ${side === 'r' ? 'Đỏ' : 'Đen'}${inRep(r.op) ? ', trong bộ của anh' : ''}). Ván đi đúng book <b>${r.ply}</b> nước.</p>`;
    let learn = null;
    if (r.leave) {
      const bookTxt = r.leave.bookMoves.map((b) => `<b>${ctx.moveLabelVN(b.vn)}</b>${b.grade ? ` (${GRADE_NAME[b.grade]})` : ''}`).join(', ');
      const who = r.leave.by === 'me' ? 'Anh' : 'Đối thủ';
      html += `<p>${who} rời book ở nước <b>${label(r.ply)}</b>. Book có: ${bookTxt}.</p><p class="small muted" id="gameEng">Đang nhờ engine chấm…</p>`;
      learn = lineThrough(r.op, side, r.node);
    } else if (r.endOfBook) html += `<p>Ván đi hết biến book (${r.ply} nước) rồi mới rẽ — phần khai cuộc tốt! Phần sau là trung cuộc.</p>`;
    else html += '<p>Toàn bộ các nước trong ván đều nằm trong book.</p>';
    html += '<div class="row wrap">';
    if (learn) html += `<button type="button" class="btn primary" id="gameLearn">Học biến này: ${esc(shortName(learn))} ▸</button>`;
    html += '<button type="button" class="btn" id="gameView">Xem ván trên bàn cờ</button></div>';
    box.innerHTML = html;
    $('gameView').onclick = () => {
      $('dlgGame').close();
      ctx.loadIntoFree({ startFen: op0Fen(), moves: g.moves, ply: Math.min(g.moves.length, r.ply + 1), title: 'Ván của anh (so với book)' });
    };
    if (learn) {
      $('gameLearn').onclick = () => {
        // Đưa vào danh sách ưu tiên của bài luyện hằng ngày rồi học ngay
        const prio = (store.getJSON('priorityLines', []) || []).filter((x) => !(x.opId === r.op.id && x.lineId === learn.id));
        prio.unshift({ opId: r.op.id, side, lineId: learn.id });
        store.setJSON('priorityLines', prio.slice(0, 10));
        $('dlgGame').close();
        startLine(r.op, side, learn.id);
      };
    }
    // Engine: nước trong ván so với nước book (điểm theo bên anh)
    if (r.leave) {
      try {
        const before = g.moves.slice(0, r.ply);
        const fmt = (cp) => (Math.abs(cp) > 20000 ? (cp > 0 ? 'thắng' : 'thua') : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1));
        const meSign = (plyAfter) => ((plyAfter % 2 === 0) === (side === 'r') ? 1 : -1); // điểm trả về theo bên đi tiếp
        const a = await engine.search(op0Fen(), [...before, r.leave.iccs], { movetime: 900 });
        const b = await engine.search(op0Fen(), [...before, r.leave.bookMoves[0].iccs], { movetime: 900 });
        const n = r.ply + 1;
        const sa = a.score * meSign(n), sb = b.score * meSign(n);
        const el = document.getElementById('gameEng');
        if (el) el.textContent = `Engine (${engine.name}), điểm theo bên anh: nước trong ván ${label(r.ply)} = ${fmt(sa)}; nước book ${ctx.moveLabelVN(r.leave.bookMoves[0].vn)} = ${fmt(sb)}.` +
          (r.leave.by === 'opp' && sa > sb + 30 ? ' Đối thủ rời book bằng nước kém — anh có cơ hội ăn lời.' : '') +
          (r.leave.by === 'me' && sb > sa + 30 ? ' Anh rời book bằng nước kém hơn — nên học biến bên dưới.' : '');
      } catch (e) {
        const el = document.getElementById('gameEng');
        if (el) el.textContent = 'Engine chưa chấm được: ' + e.message;
      }
    }
  };

  /** Ôn cả nhóm, mở rộng dần: các biến đã thuộc + 1 biến mới */
  function startGroup(op, side, groupKey) {
    const plan = linePlan(op, side);
    const g = plan.groups.find((x) => x.key === groupKey);
    if (!g) return;
    const gs = groupSet(g, lineProg, op, side);
    session = { kind: 'group', op, side, groupKey, focus: gs.focus };
    start(op, side, 'test', 'book', { lines: gs.lines, focusLine: gs.focus });
  }

  // ---------- Cây book: duyệt các nước, đối phương xếp từ mạnh đến yếu ----------
  function renderBookTree(op, nodeKey) {
    const box = $('opBook');
    const node = op.nodes.get(nodeKey) || op.root;
    const keys = node.key ? node.key.split(' ') : [];
    const SIDE = { r: 'Đỏ', b: 'Đen' };
    const me = op.bookSide || op.sides[0];
    const turn = sideToMoveAt(op, node);
    // Đường đi (bấm để quay lại)
    const crumbs = ['<button type="button" class="crumb" data-k="">Đầu ván</button>'];
    for (let i = 1; i <= keys.length; i++) {
      const n = op.nodes.get(keys.slice(0, i).join(' '));
      crumbs.push(`<button type="button" class="crumb" data-k="${n.key}">${i % 2 === 1 ? Math.ceil(i / 2) + '.' : ''}${ctx.moveLabelVN(n.vn)}</button>`);
    }
    const kids = node.children.map((k) => op.nodes.get(k));
    const inf = (n) => op.info?.[n.key];
    kids.sort((a, b) => {
      const ia = inf(a), ib = inf(b);
      if (ia && ib) return (GRADE_ORDER[ia.grade] - GRADE_ORDER[ib.grade]) || (ia.loss - ib.loss);
      return b.weight - a.weight;
    });
    const fmt = (cp) => (Math.abs(cp) >= 20000 ? (cp > 0 ? 'thắng' : 'thua') : (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1));
    let head;
    if (!kids.length) head = '<p class="small"><b>Hết nhánh.</b></p>';
    else if (turn === me) head = `<p class="small"><b>Lượt anh (${SIDE[me]})</b> — nước nên đi:</p>`;
    else head = `<p class="small"><b>Lượt ${SIDE[turn]} (đối phương)</b> — ${kids.length} nước${kids.length > 1 ? ', xếp từ mạnh đến yếu' : ''}:</p>`;
    const rows = kids.map((n) => {
      const i = inf(n);
      const badge = i ? `<span class="gr gr-${i.grade}">${GRADE_NAME[i.grade]}</span>` : '';
      const loss = i ? `<span class="muted small">${i.loss <= 5 ? 'ngang nước tốt nhất' : 'kém ' + (i.loss / 100).toFixed(1)}</span>` : '';
      const games = i?.games ? `<span class="small">${i.games} ván cao thủ</span>` : '';
      const link = i?.link ? `<span class="small muted">→ ${i.link.same ? 'về chính biến' : i.link.name}</span>` : '';
      const nAlt = n.lineIds.length;
      return `<button type="button" class="book-move" data-k="${n.key}"><b>${ctx.moveLabelVN(n.vn)}</b> ${badge} ${loss} ${games} ${link}<span class="grow"></span><span class="muted small">${nAlt} nhánh ▸</span></button>`;
    }).join('');
    const note = node.comments?.length ? `<p class="small comment">${node.comments.join(' ').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</p>` : '';
    box.innerHTML = `<div class="crumbs">${crumbs.join('<span class="muted">›</span>')}</div>${note}${head}<div class="book-moves">${rows}</div>
      <div class="row wrap"><button type="button" class="btn small-btn" id="opBookView">Xem thế này trên bàn cờ</button>
      ${node.key ? '<button type="button" class="btn small-btn" id="opBookUp">◂ Lùi 1 nước</button>' : ''}
      ${op.info?.[node.key]?.link && !op.info[node.key].link.same ? `<button type="button" class="btn small-btn primary" id="opBookLink">Mở chương "${op.info[node.key].link.name}" ▸</button>` : ''}</div>
      <p class="muted small">Hạng do Pikafish chấm (${bookMeta?.depth ? 'độ sâu ' + bookMeta.depth.branch : ''}): Mạnh nhất ≤ 0,15 · Tốt ≤ 0,4 · Chơi được ≤ 0,75 · Yếu ≤ 1,8 · Hớ &gt; 1,8 điểm so với nước tốt nhất. Số ván cao thủ theo ECCO (xqbase.com); không ghi số là chưa có số liệu.</p>`;
    box.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => renderBookTree(op, b.dataset.k); });
    const lk = box.querySelector('#opBookLink');
    if (lk) lk.onclick = () => {
      const target = openings.find((o) => o.kind === 'book' && o.bookOf === op.info[node.key].link.id && o.bookSide === me);
      if (target) { openDialog(target); renderBookTree(target, node.key.split(' ').filter((_, i, a) => target.nodes.has(a.slice(0, i + 1).join(' '))).join(' ')); }
    };
    const up = box.querySelector('#opBookUp');
    if (up) up.onclick = () => renderBookTree(op, keys.slice(0, -1).join(' '));
    box.querySelector('#opBookView').onclick = () => {
      const nodes = keys.map((_, i) => op.nodes.get(keys.slice(0, i + 1).join(' ')));
      $('dlgOpening').close('view');
      ctx.loadIntoFree({ startFen: op.startFen, moves: keys, comments: nodes.map((n) => n.comments.join(' ')), ply: keys.length,
        title: `${op.name} (book cầm ${SIDE[me]})` });
    };
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
    const opp = selected.kind === 'book' ? (document.querySelector('input[name="opOpp"]:checked')?.value || 'book') : 'book';
    if (selected.kind === 'book') store.setJSON('lastOpp', opp);
    start(selected, side, mode, opp);
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
  function start(op, side, mode, oppStyle = 'book', scope = null) {
    if (!scope) session = null; // luyện tổng hợp: thoát "Học theo biến"
    lastCfg = { op, side, mode, oppStyle, scope };
    busy = false;
    $('trNextLine').hidden = true;
    purpose = mode === 'purpose';
    // Chế độ "Đoán ý đồ" không chấm lịch ôn (SRS) — dùng bộ thẻ tạm
    trainer = new OpeningTrainer(op, { side, mode: purpose ? 'learn' : mode, cards: purpose ? {} : cards, oppStyle, keymoves,
      keyOnly: mode === 'test' && !!store.getJSON('keyOnly', false), ...(scope || {}) });
    $('trMode').title = '';
    quizScore = { right: 0, total: 0 };
    loadInsights();
    prevFlip = view.flipped;
    ctx.setController(controller);
    ctx.showScreen('train');
    if (view.flipped !== (side === 'b')) view.setFlipped(side === 'b');
    $('trName').textContent = op.name;
    const sessTxt = !session ? '' : session.kind === 'line' ? ' · 1 biến' : session.kind === 'group' ? ' · ôn nhóm' : ` · bài hôm nay ${session.idx + 1}/${session.queue.length}`;
    $('trMode').textContent = (mode === 'learn' ? 'Học mới' : purpose ? 'Đoán ý đồ' : 'Kiểm tra') + (op.kind === 'book' && oppStyle === 'strange' ? ' · đối phương chơi lạ' : '') + (mode === 'test' && store.getJSON('keyOnly', false) ? ' · chỉ nước then chốt' : '') + sessTxt;
    $('trMode').className = 'pill ' + (mode === 'test' ? 'test' : 'learn');
    $('trReveal').hidden = purpose;
    $('trQuiz').hidden = true;
    clearWhy();
    $('trEnd').hidden = true;
    $('trGoal').hidden = true;
    goalPending = false;
    setFeedback('', '');
    $('trComment').textContent = '';
    update();
    if (scope?.goal) return showGoal(op, side, scope.lines[0]);
    step();
  }

  // ---------- B1: xem "đích đến" (thế cuối biến + kế hoạch) trước khi học biến mới ----------
  function showGoal(op, side, lineId) {
    const t = trainer;
    const line = op.lines.find((l) => l.id === lineId);
    if (!line) return step();
    goalPending = true;
    busy = true;
    const keys = line.lastKey.split(' ');
    const p = new Position(op.startFen);
    for (const k of keys) p.makeMove(parseCoordMove(k));
    view.render({ board: p.board, last: parseCoordMove(keys[keys.length - 1]), checkSq: -1 });
    view.setHint(null);
    $('status').textContent = `Đích đến: thế sau ${keys.length} nước`;
    $('trGoal').hidden = false;
    const moves = keys.map((_, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + ctx.moveLabelVN(op.nodes.get(keys.slice(0, i + 1).join(' ')).vn)).join(' ');
    $('trGoalPlan').innerHTML = `<span class="muted small">Toàn biến: ${moves}</span>${line.plan ? '<br>Kế hoạch (soạn sẵn): ' + line.plan.replace(/[<>&]/g, '') : ''}`;
    renderAfterOpening($('trGoalBox'), {
      fen: p.fen(), me: side, view, label: ctx.moveLabelVN, engine,
      title: 'Thế cuối biến: triển khai tiếp thế nào?', backLabel: 'Về thế cuối biến',
      isActive: () => trainer === t && goalPending,
    });
    setFeedback('info', 'Xem đích đến trước — biết mình muốn đi tới đâu thì nhớ đường đi dễ hơn nhiều.');
    $('trGoalGo').onclick = () => {
      if (trainer !== t) return;
      goalPending = false; busy = false;
      $('trGoal').hidden = true;
      $('trGoalBox').innerHTML = '';
      setFeedback('', '');
      update();
      step();
    };
  }

  function setFeedback(kind, html) {
    const el = $('trFeedback');
    el.className = 'feedback ' + kind;
    el.innerHTML = html;
  }

  function nodeNote(n) {
    const c = n && n.comments.length ? n.comments.join(' ') : '';
    const op = trainer?.op;
    const inf = op?.info?.[n?.key];
    if (c.includes('【')) return c;
    if (!inf) {
      // Nhánh phụ của book: nước đối phương là nước tốt nhất theo engine
      const oppMove = op?.kind === 'book' && n && n.ply % 2 === (op.bookSide === 'r' ? 0 : 1);
      const altOnly = oppMove && n.lineIds.every((id) => op.lines.find((l) => l.id === id)?.alt);
      return altOnly ? `【Đáp tốt nhất theo Pikafish】 ${c}`.trim() : c;
    }
    // Nước chính biến của đối phương: thêm hạng + số ván cao thủ
    const games = inf.games ? ` · ${inf.games} ván cao thủ (ECCO)` : '';
    return `【${GRADE_NAME[inf.grade]}${games}】 ${c}`.trim();
  }

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
      // "Chỉ hỏi nước then chốt": nước thường app tự đi (chỉ ở chế độ Kiểm tra)
      if (t.mode === 'test' && t.keyOnly && !t.isKey()) {
        busy = true;
        setTimeout(() => {
          if (trainer !== t) return;
          const n = t.autoMove();
          busy = false;
          if (n) { Sound.move(); update(parseCoordMove(n.iccs)); $('trComment').textContent = `App tự đi nước thường: ${ctx.moveLabelVN(n.vn)}.`; }
          step();
        }, 450);
        return;
      }
      const keyTag = t.isKey() ? ' <span class="gr gr-key">⭐ Nước then chốt — phải nhớ đúng</span>' : '';
      if (t.mode === 'learn') {
        const ex = t.mainExpected();
        const alt = t.expected().length > 1 ? ` (lý thuyết còn ${t.expected().length - 1} nước khác cũng đúng)` : '';
        setFeedback('info', `Lượt anh. ${t.op.kind === 'book' ? 'Nước nên đi' : 'Nước lý thuyết'}: <b>${ctx.moveLabelVN(ex.vn)}</b>${alt}${keyTag}`);
        // Giữ lại nhận xét nước vừa đi của máy (hạng nước, số ván cao thủ) rồi mới tới gợi ý của anh
        const prev = t.path.length && t.path[t.path.length - 1].by === 'opp' ? $('trComment').textContent : '';
        $('trComment').textContent = [prev, nodeNote(ex)].filter(Boolean).join('\n');
        showWhy(ex, 'đi');
      } else if (!$('trFeedback').textContent || keyTag) {
        setFeedback('info', 'Lượt anh. Đi nước theo lý thuyết.' + keyTag);
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
    showAnalysis(t);
    if (purpose) {
      $('trSummary').innerHTML = `<b>${line ? line.name : 'Biến'}</b>: anh đoán đúng ý đồ ${quizScore.right}/${quizScore.total} nước.`;
      $('trPlan').textContent = line && line.plan ? 'Kế hoạch trung cuộc (soạn sẵn): ' + line.plan : '';
      setFeedback(quizScore.right === quizScore.total ? 'ok' : 'warn', 'Hết biến. Xem lại các nước đoán sai bằng nút "Luyện lại".' + AO_LINK);
      Sound.end();
      return;
    }
    $('trSummary').innerHTML = `<b>${line ? line.name : 'Biến'}</b>: đúng ngay ${t.score.correct}/${total}, đúng ở lần 2: ${t.score.retry}, sai: ${t.score.wrong}.`;
    $('trPlan').textContent = line && line.plan ? 'Kế hoạch trung cuộc (soạn sẵn): ' + line.plan : '';
    let planMsg = '';
    if (session && line) {
      // Ghi tiến độ "Học theo biến" cho biến vừa đi hết
      const k = lineKey(session.op.id, session.side, line.id);
      const before = lineProg[k];
      const p = recordRun(before, { mode: t.mode, wrong: t.score.wrong, retry: t.score.retry });
      lineProg[k] = p; saveLineProg();
      const plan = linePlan(session.op, session.side);
      const nid = nextLine(plan, lineProg, session.op, session.side, line.id);
      const nl = nid && session.op.lines.find((x) => x.id === nid);
      const days = `${p.streak}/${MASTER_STREAK} ngày`;
      if (p.mastered && !before?.mastered) planMsg = `<br><b>✓ Đã thuộc biến này</b> (nhớ đúng ở ${MASTER_STREAK} ngày khác nhau). App sẽ hẹn ôn lại sau vài ngày.`;
      else if (p.mastered) planMsg = `<br>Biến đã thuộc — ôn đạt. Lần ôn sau: ${new Date(p.due).toLocaleDateString('vi-VN')}.`;
      else if (t.mode === 'learn') planMsg = `<br>Lần sau là <b>Kiểm tra</b> (không gợi ý). Thuộc = đi đúng hết ở ${MASTER_STREAK} ngày khác nhau.`;
      else if (!t.score.wrong && !t.score.retry) planMsg = `<br>Đúng hết! Đã nhớ đúng <b>${days}</b>${p.streak < MASTER_STREAK ? ' — kiểm tra lại vào ngày mai để tính là thuộc (nhớ lâu, không phải nhớ tạm).' : '.'}`;
      else planMsg = `<br>Còn nước chưa chắc — chuỗi nhớ đúng về 0. Luyện lại nhé.`;
      if (session.kind === 'daily') {
        const left = session.queue.length - session.idx - 1;
        $('trNextLine').hidden = left <= 0;
        $('trNextLine').textContent = `Tiếp bài hôm nay (${session.idx + 2}/${session.queue.length}) ▸`;
        if (left <= 0) {
          planMsg += '<br><b>🎉 Xong bài luyện hôm nay!</b> Nên bấm "Đánh tiếp với máy" để thử đánh tiếp từ cuối biến vừa học.';
          logActivity(store, 'daily');
        }
        $('trAgain').textContent = 'Luyện lại biến này';
      } else {
        $('trNextLine').hidden = !(nl && (p.mastered || session.kind === 'group' || t.mode === 'test'));
        $('trNextLine').textContent = nl ? `Biến tiếp theo: ${shortName(nl)} ▸` : 'Biến tiếp theo ▸';
        $('trAgain').textContent = session.kind === 'group' ? 'Ôn nhóm lần nữa' : p.mastered ? 'Luyện lại biến này' : 'Luyện lại (Kiểm tra)';
      }
    } else $('trAgain').textContent = 'Luyện tiếp';
    setFeedback(t.score.wrong ? 'warn' : 'ok', (t.score.wrong ? 'Hết biến. Những nước sai sẽ được đưa vào lịch ôn sớm.' : 'Hết biến — anh đi đúng hết!') + planMsg + AO_LINK);
    Sound.end();
  }

  // Nút nhảy tới phần phân tích (nằm ở thẻ "Hết biến" bên dưới)
  const AO_LINK = '<br><button type="button" class="btn primary ao-jump" onclick="document.getElementById(\'trEnd\').scrollIntoView({behavior:\'smooth\',block:\'start\'})">▸ Xem phân tích: triển khai tiếp thế nào?</button>';
  /** Phân tích "sau khai cuộc" ở thế cuối biến */
  function showAnalysis(t) {
    const box = $('trAnalysis');
    renderAfterOpening(box, {
      fen: t.pos.fen(), me: t.side, view, label: ctx.moveLabelVN, engine,
      isActive: () => trainer === t && !$('trEnd').hidden,
    });
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
      } else if (res.result === 'equiv') {
        // Nước tương đương: tính đúng, app đi nước book để tiếp tục biến
        Sound.move();
        const before = t.path.slice(0, -1).map((p) => p.node.iccs);
        const prevPos = new Position(t.op.startFen);
        for (const iccs of before) prevPos.makeMove(parseCoordMove(iccs));
        const mine = ctx.moveLabelVN(moveToNotation(prevPos, res.played));
        setFeedback('ok', `<b>${mine}</b> cũng tốt — kém nước tốt nhất không đáng kể (Pikafish). Book đi <b>${ctx.moveLabelVN(res.node.vn)}</b>; app đi nước book để tiếp tục biến.`);
        $('trComment').textContent = nodeNote(res.node);
        update(parseCoordMove(res.node.iccs));
        showWhy(res.node, 'book đi');
        saveCards();
        setTimeout(step, 1200);
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
  $('trRestart').onclick = () => (session ? $('trAgain').onclick() : lastCfg && start(lastCfg.op, lastCfg.side, lastCfg.mode, lastCfg.oppStyle));
  $('trAgain').onclick = () => {
    if (session?.kind === 'line' || session?.kind === 'daily') return runLine(session.op, session.side, session.lineId);
    if (session?.kind === 'group') return startGroup(session.op, session.side, session.groupKey);
    if (lastCfg) start(lastCfg.op, lastCfg.side, lastCfg.mode, lastCfg.oppStyle);
  };
  $('trNextLine').onclick = () => {
    if (!session) return;
    if (session.kind === 'daily') {
      if (session.idx + 1 < session.queue.length) { session.idx++; runDailyItem(); }
      return;
    }
    const plan = linePlan(session.op, session.side);
    const id = nextLine(plan, lineProg, session.op, session.side, session.lineId);
    if (id) startLine(session.op, session.side, id);
  };
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
    getCards: () => cards, startReview, trainById, startDaily, ready: () => openings.length > 0 };
}

/**
 * Tóm tắt kiểm định theo từng nhóm (biến lý thuyết / diễn biến bẫy cổ điển),
 * ghi đúng tên engine đã chấm mỗi nhóm (lấy từ dữ liệu, không ghi cứng).
 */
export function verifySummary(openings) {
  const groups = [
    { kind: 'theory', label: 'biến lý thuyết', ok: 'đạt', bad: 'cần xem lại' },
    // Bẫy cổ điển cố ý có nước hớ của bên mắc bẫy nên engine hay gắn cờ — chỉ để tham khảo
    { kind: 'trap', label: 'diễn biến bẫy cổ điển', ok: 'hợp lý', bad: 'bị engine gắn cờ' },
  ];
  const parts = [];
  for (const g of groups) {
    const lines = openings.filter((o) => (g.kind === 'trap' ? o.kind === 'trap' : o.kind !== 'trap' && o.kind !== 'book')).flatMap((o) => o.lines);
    if (!lines.length) continue;
    const checked = lines.filter((l) => l.verification?.engine && l.verification.engine !== 'chưa kiểm định');
    const ok = checked.filter((l) => l.verification.engine === 'đạt').length;
    const names = [...new Set(checked.map((l) => l.verification.engineName).filter(Boolean))];
    const by = names.length ? names.join(' + ') : 'engine';
    const unchecked = lines.length - checked.length;
    parts.push(`${lines.length} ${g.label}: ${by} chấm ${ok} ${g.ok}, ${checked.length - ok} ${g.bad}${unchecked ? `, ${unchecked} chưa kiểm định` : ''}`);
  }
  const book = openings.filter((o) => o.kind === 'book');
  if (book.length) parts.unshift(`Book: ${book.length} chương, ${book.reduce((a, o) => a + o.lines.filter((l) => l.alt).length, 0)} nhánh đối phương đi khác (Pikafish chấm, xếp hạng)`);
  return parts.join(' · ') + '.';
}
