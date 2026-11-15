// =====================================================================
// TAB "TƯ DUY": Bài học tư duy + Đọc thế trận
// - Bài học: nguyên tắc + ví dụ là thế cờ thật trong các biến lý thuyết đã kiểm định
// - Đọc thế trận: anh tự chấm 6 yếu tố và chọn nước kế hoạch, rồi so với đánh giá tự động + engine
// =====================================================================
import { Position, parseCoordMove } from '../core/xiangqi.js';
import { readPosition, planAdvice, FACTORS } from '../train/position-factors.js';
import { LESSONS } from '../train/lessons.js';
import { logActivity } from '../train/progress.js';
import { whyHTML, loadInsights, fmtScore } from './why.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const VERD = { r: 'Đỏ hơn', '=': 'Ngang nhau', b: 'Đen hơn' };

export function initThink(ctx) {
  // ctx: { view, store, Sound, toast, showScreen, setController, moveLabelVN, getOpenings }
  const { view, store, Sound } = ctx;
  let cur = null; // { kind:'lesson', lesson, i } | { kind:'read', item, answers, move, graded }
  const lock = { canPick: () => false, targets: () => [], onMove: () => {} };

  // ---------- Dữ liệu ----------
  function lineRef(id) {
    for (const op of ctx.getOpenings()) { const l = op.lines.find((x) => x.id === id); if (l) return { op, line: l }; }
    return null;
  }
  function posAt(ref, ply) {
    const keys = ref.line.lastKey.split(' ');
    const n = ply === 'end' ? keys.length : ply - 1;
    const p = new Position(ref.op.startFen);
    for (const k of keys.slice(0, n)) p.makeMove(parseCoordMove(k));
    return { pos: p, move: ply === 'end' ? null : keys[ply - 1], lastMove: n ? keys[n - 1] : null };
  }
  const readStats = () => store.getJSON('readStats', {}) || {};

  // ---------- Danh sách ----------
  async function renderList() {
    $('thLessons').innerHTML = LESSONS.map((l, i) => `<button class="th-card" data-l="${i}"><b>${esc(l.title)}</b><span class="muted small">${l.examples.length} ví dụ trên bàn cờ</span></button>`).join('');
    $('thLessons').querySelectorAll('[data-l]').forEach((b) => { b.onclick = () => openLesson(LESSONS[+b.dataset.l], 0); });
    const data = await loadInsights();
    const items = data.positions || [];
    const st = readStats();
    const done = items.filter((x) => st[x.id]).length;
    $('thReadNote').textContent = items.length
      ? `${items.length} thế cờ lấy từ các biến lý thuyết (giữa biến và hết biến). Đã làm ${done}/${items.length}.`
      : 'Chưa có dữ liệu thế cờ (cần chạy tools/build-insights.mjs).';
    $('thReads').innerHTML = items.map((x, i) => {
      const s = st[x.id];
      const mark = s ? `<span class="pill ${s.score >= 6 ? 'learn' : 'test'}">${s.score}/7</span>` : '';
      return `<button class="th-card" data-r="${i}"><b>${esc(x.opening)}</b><span class="muted small">${esc(x.line)} · ${x.where} · ${x.turn === 'r' ? 'Đỏ' : 'Đen'} đi</span>${mark}</button>`;
    }).join('');
    $('thReads').querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => openRead(items[+b.dataset.r]); });
    $('thRandom').onclick = () => {
      const fresh = items.filter((x) => !st[x.id]);
      const pool = fresh.length ? fresh : items;
      if (pool.length) openRead(pool[Math.floor(Math.random() * pool.length)]);
    };
  }

  function enter() { leave(); ctx.showScreen('think'); renderList(); }
  function leave() { if (cur) { cur = null; view.setHint(null); ctx.setController(null); } }

  // ---------- Bài học ----------
  async function openLesson(lesson, i) {
    if (!ctx.getOpenings().length) { ctx.toast('Đang tải dữ liệu khai cuộc…'); return; }
    cur = { kind: 'lesson', lesson, i };
    ctx.setController(lock);
    ctx.showScreen('thinkpos');
    const ex = lesson.examples[i];
    const ref = lineRef(ex.line);
    const { pos, move, lastMove } = posAt(ref, ex.ply);
    if (view.flipped !== (pos.turn === 'b')) view.setFlipped(pos.turn === 'b');
    view.render({ board: pos.board, last: lastMove ? parseCoordMove(lastMove) : null, checkSq: pos.inCheck() ? pos.kingSq(pos.turn) : -1 });
    view.setHint(move ? parseCoordMove(move) : null);
    $('thTitle').textContent = lesson.title;
    $('thPill').textContent = `Ví dụ ${i + 1}/${lesson.examples.length}`;
    $('thBody').innerHTML = lesson.body.map((p) => `<p>${p}</p>`).join('');
    $('status').textContent = `${ref.op.name} — ${ref.line.name}`;
    let exHtml = `<p class="muted small">Thế cờ trong biến "${esc(ref.line.name)}" (${esc(ref.op.name)}), ${ex.ply === 'end' ? 'hết biến' : 'trước nước ' + ex.ply}.</p>`;
    if (ex.note) exHtml += `<p class="comment">${esc(ex.note)}</p>`;
    $('thExample').innerHTML = exHtml;
    $('thQuiz').hidden = true;
    $('thResult').innerHTML = '';
    if (move) {
      const data = await loadInsights();
      if (cur?.lesson !== lesson || cur.i !== i) return;
      $('thResult').innerHTML = `<div class="why-body">${whyHTML(pos.fen(), move, data, ctx.moveLabelVN, { title: 'Nước được đánh dấu trên bàn:' })}</div>`;
    } else {
      $('thResult').innerHTML = factorTable(readPosition(pos.fen()), ex.factor === 'all' ? null : ex.factor, pos.turn);
    }
    $('thPrev').disabled = i === 0;
    $('thNext').textContent = i < lesson.examples.length - 1 ? 'Ví dụ tiếp ▸' : (LESSONS.indexOf(lesson) < LESSONS.length - 1 ? 'Bài tiếp ▸' : 'Xong');
    $('thPrev').onclick = () => openLesson(lesson, i - 1);
    $('thNext').onclick = () => {
      if (i < lesson.examples.length - 1) return openLesson(lesson, i + 1);
      logActivity(store, 'mid');
      const k = LESSONS.indexOf(lesson);
      if (k < LESSONS.length - 1) openLesson(LESSONS[k + 1], 0); else enter();
    };
    $('thNav').hidden = false;
  }

  function factorTable(f, only, me) {
    const rows = FACTORS.filter((x) => !only || x.id === only).map((x) => `<tr><th>${x.name}</th><td><span class="verd v-${f[x.id].v === '=' ? 'eq' : f[x.id].v}">${VERD[f[x.id].v]}</span><div class="small">${esc(f[x.id].why)}</div></td></tr>`).join('');
    const tips = planAdvice(f, me).map((t) => `<li>${esc(t)}</li>`).join('');
    return `<table class="factor-tbl">${rows}</table><p class="small"><b>Gợi ý kế hoạch cho bên ${me === 'r' ? 'Đỏ' : 'Đen'} (đang đến lượt):</b></p><ul class="why-list small">${tips}</ul>`;
  }

  // ---------- Đọc thế trận ----------
  function openRead(item) {
    cur = { kind: 'read', item, answers: {}, move: null, graded: false };
    ctx.setController(lock);
    ctx.showScreen('thinkpos');
    const pos = new Position(item.fen);
    if (view.flipped !== (pos.turn === 'b')) view.setFlipped(pos.turn === 'b');
    view.setHint(null);
    view.render({ board: pos.board, last: null, checkSq: pos.inCheck() ? pos.kingSq(pos.turn) : -1 });
    $('status').textContent = `Đến lượt ${pos.turn === 'r' ? 'Đỏ' : 'Đen'} — đọc thế trận`;
    $('thTitle').textContent = 'Đọc thế trận';
    $('thPill').textContent = `${item.turn === 'r' ? 'Đỏ' : 'Đen'} đi`;
    $('thBody').innerHTML = `<p class="muted small">${esc(item.opening)} — ${esc(item.line)} (${item.where}, sau ${item.ply} nước).</p><p>Bước 1: tự chấm 6 yếu tố. Bước 2: chọn nước kế hoạch. Rồi bấm <b>Chấm điểm</b>.</p>`;
    $('thExample').innerHTML = '';
    $('thResult').innerHTML = '';
    $('thNav').hidden = true;
    const box = $('thQuiz');
    box.hidden = false;
    // Thứ tự nước ngẫu nhiên để không đoán theo vị trí
    const opts = item.options.map((o, i) => ({ ...o, i })).sort(() => Math.random() - 0.5);
    box.innerHTML = FACTORS.map((x) => `<div class="fq"><div class="fq-name">${x.name} <span class="muted small" title="${esc(x.hint)}">ⓘ</span></div><div class="seg seg3" data-f="${x.id}">${['r', '=', 'b'].map((v) => `<button type="button" data-v="${v}">${VERD[v]}</button>`).join('')}</div></div>`).join('')
      + `<div class="fq-name" style="margin-top:8px">Nước kế hoạch tốt nhất cho ${item.turn === 'r' ? 'Đỏ' : 'Đen'}:</div><div class="quiz" id="thMoves">${opts.map((o) => `<button type="button" class="btn quiz-opt" data-i="${o.i}">${esc(ctx.moveLabelVN(o.vn))}</button>`).join('')}</div>`
      + '<div class="row wrap"><button type="button" class="btn primary" id="thGrade">Chấm điểm</button><button type="button" class="btn" id="thBack">Về danh sách</button></div>';
    box.querySelectorAll('.seg3').forEach((seg) => seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { if (cur.graded) return; cur.answers[seg.dataset.f] = b.dataset.v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
    }));
    box.querySelectorAll('#thMoves .quiz-opt').forEach((b) => {
      b.onclick = () => {
        if (cur.graded) return;
        cur.move = +b.dataset.i;
        box.querySelectorAll('#thMoves .quiz-opt').forEach((x) => x.classList.toggle('on', x === b));
        view.setHint(parseCoordMove(item.options[cur.move].iccs));
      };
    });
    $('thGrade').onclick = () => grade();
    $('thBack').onclick = () => enter();
  }

  function grade() {
    const c = cur;
    if (!c || c.kind !== 'read' || c.graded) return;
    if (c.move === null) { ctx.toast('Anh chọn một nước kế hoạch trước đã.'); return; }
    c.graded = true;
    const item = c.item;
    const f = readPosition(item.fen);
    let score = 0;
    const box = $('thQuiz');
    box.querySelectorAll('.seg3').forEach((seg) => {
      const id = seg.dataset.f, right = f[id].v;
      if (c.answers[id] === right) score++;
      seg.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
        if (b.dataset.v === right) b.classList.add('right');
        else if (b.dataset.v === c.answers[id]) b.classList.add('wrong');
      });
    });
    const chosen = item.options[c.move];
    if (chosen.best) score++;
    box.querySelectorAll('#thMoves .quiz-opt').forEach((b) => {
      const o = item.options[+b.dataset.i];
      b.disabled = true;
      b.innerHTML = `${esc(ctx.moveLabelVN(o.vn))} <span class="small">${o.best ? '— tốt nhất' : `— kém ${(o.loss / 100).toFixed(1)}`}</span>`;
      if (o.best) b.classList.add('right'); else if (+b.dataset.i === c.move) b.classList.add('wrong');
    });
    const best = item.options.find((o) => o.best);
    view.setHint(parseCoordMove(best.iccs));
    chosen.best ? Sound.move() : Sound.error();
    const st = readStats();
    st[item.id] = { score, at: Date.now() };
    store.setJSON('readStats', st);
    logActivity(store, 'mid');
    const side = item.turn === 'r' ? 'Đỏ' : 'Đen';
    $('thResult').innerHTML = `<div class="feedback ${score >= 6 ? 'ok' : score >= 4 ? 'warn' : 'bad'}">Anh được <b>${score}/7</b> (6 yếu tố + nước kế hoạch).</div>`
      + factorTable(f, null, item.turn)
      + `<p><b>Engine:</b> ${fmtScore(item.eval)} theo bên ${side}. Nước tốt nhất <b>${esc(ctx.moveLabelVN(best.vn))}</b>; diễn biến chính: ${esc(item.pv.map(ctx.moveLabelVN).join(' '))}.</p>`
      + item.options.map((o) => `<p class="small"><b>${esc(ctx.moveLabelVN(o.vn))}</b>${o.best ? ' (tốt nhất)' : ` (kém ${(o.loss / 100).toFixed(1)})`}: ${esc(o.why)}</p>`).join('')
      + `<p class="muted small">Nguồn: ${esc(item.source)}. Đánh giá 6 yếu tố do app tính theo quy tắc đếm cố định — là gợi ý để luyện cách nhìn, không thay cho engine.</p>`;
    $('thResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('thExit').onclick = () => enter();
  return { enter, leave, renderList, isOpen: () => !!cur };
}
