// =====================================================================
// "SAU KHAI CUỘC: TRIỂN KHAI TIẾP THẾ NÀO?" — hiện khi hết biến
// - Đánh giá chung (engine), điểm yếu đối phương để khai thác, điểm cần giữ của mình
// - Hướng triển khai: gợi ý theo 6 yếu tố + 3 hướng đi tốt nhất của engine (kèm diễn biến)
// - Xem từng nước của diễn biến gợi ý ngay trên bàn, có "Vì sao?" cho mỗi nước
// Số liệu engine: data/plans.json (Pikafish, tạo bằng tools/build-plans.mjs);
// thế không có sẵn (biến anh tự soạn) thì nhờ engine trong app chấm trực tiếp.
// =====================================================================
import { Position, parseCoordMove } from '../core/xiangqi.js';
import { moveToNotation } from '../core/notation.js';
import { analyzeAfterOpening, evalWords } from '../train/weakness.js';
import { analyzeMove, PURPOSES } from '../train/move-insight.js';
import { whyHTML, loadInsights, fmtScore } from './why.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SIDE = { r: 'Đỏ', b: 'Đen' };

let plansPromise = null;
export function loadPlans() {
  if (!plansPromise) {
    plansPromise = (async () => {
      if (window.__XQT_PLANS__) return window.__XQT_PLANS__;
      const res = await fetch('data/plans.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })().catch(() => ({ plans: {} }));
  }
  return plansPromise;
}

/**
 * Hiện phân tích vào phần tử `box`.
 * opts: { fen, me, view, label (đổi ký pháp), engine (engine của app), isActive: () => bool, onLeaveBoard }
 */
export async function renderAfterOpening(box, opts) {
  const { fen, me, view, label } = opts;
  const pos = new Position(fen);
  const a = analyzeAfterOpening(fen, me);
  const turnTxt = pos.turn === me ? 'Đến lượt anh đi.' : `Đến lượt ${SIDE[pos.turn]} (đối phương) đi — hãy đoán trước đối phương sẽ làm gì.`;
  box.innerHTML = `<h3 class="ao-h">Sau khai cuộc: triển khai tiếp thế nào?</h3>
    <p class="ao-eval" id="aoEval">Đang lấy đánh giá của engine… ${esc(turnTxt)}</p>
    <h4 class="ao-sub">🎯 Điểm yếu của đối phương để khai thác</h4>
    <ul class="ao-list">${a.opp.length ? a.opp.map((x, i) => `<li class="lv${x.level}" data-o="${i}">${esc(x.text)}</li>`).join('') : '<li>Đối phương chưa lộ điểm yếu rõ — tập trung cải thiện quân của mình.</li>'}</ul>
    <h4 class="ao-sub">🛡 Điểm cần giữ của anh</h4>
    <ul class="ao-list">${a.mine.length ? a.mine.map((x, i) => `<li class="lv${x.level}" data-m="${i}">${esc(x.text)}</li>`).join('') : '<li>Không có điểm yếu đáng kể.</li>'}</ul>
    <h4 class="ao-sub">🧭 Hướng triển khai</h4>
    <ul class="ao-list">${a.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <div id="aoPlans"><p class="muted small">Đang tìm các hướng đi tốt nhất…</p></div>
    <div class="ao-pv" id="aoPv" hidden>
      <div class="row wrap"><button class="btn" id="aoPrev">◂</button><span class="ao-step" id="aoStep"></span><button class="btn" id="aoNext">▸</button><span class="grow"></span><button class="btn" id="aoBack">Về thế cuối biến</button></div>
      <div class="why-body" id="aoWhy"></div>
    </div>
    <p class="muted small">Điểm yếu, điểm cần giữ và gợi ý do app tự rút ra từ hình cờ theo luật (kiểm chứng được trên bàn); các hướng đi là của engine. Đây là gợi ý để luyện tư duy, không phải lời bình của sách.</p>`;

  // Bấm vào một điểm yếu => đánh dấu ô đó trên bàn
  const mark = (s) => { if (s === null || s === undefined) return; view.setHint({ from: s, to: null }); };
  box.querySelectorAll('[data-o]').forEach((li) => { li.onclick = () => mark(a.opp[+li.dataset.o].sq); });
  box.querySelectorAll('[data-m]').forEach((li) => { li.onclick = () => mark(a.mine[+li.dataset.m].sq); });

  // ---- Số liệu engine
  const data = await loadPlans();
  if (!opts.isActive()) return;
  let plan = data.plans?.[fen];
  let src = data.engine ? `${data.engine}, độ sâu ${data.depth}` : '';
  if (!plan && opts.engine) {
    try {
      const r = await opts.engine.search(fen, [], { movetime: 2500 });
      if (!opts.isActive()) return;
      const p = new Position(fen), vn = [];
      for (const m of r.pv.slice(0, 10)) { const mv = parseCoordMove(m); if (!p.isLegal(mv)) break; vn.push(moveToNotation(p, mv)); p.makeMove(mv); }
      plan = { eval: r.score, turn: pos.turn, lines: [{ score: r.score, pv: r.pv.slice(0, vn.length), vn }] };
      src = `${opts.engine.name || 'engine trong app'}, 2,5 giây`;
    } catch { /* engine bận / lỗi: bỏ qua phần số liệu */ }
  }
  const evalEl = box.querySelector('#aoEval');
  if (!plan || !plan.lines?.length) {
    evalEl.textContent = turnTxt;
    box.querySelector('#aoPlans').innerHTML = '<p class="muted small">Chưa có số liệu engine cho thế này.</p>';
    return;
  }
  const mine = (cp) => (plan.turn === me ? cp : -cp);
  evalEl.innerHTML = `<b>Đánh giá:</b> ${esc(fmtScore(mine(plan.eval)))} theo bên anh (${SIDE[me]}) — <b>${esc(evalWords(mine(plan.eval)))}</b>. ${esc(turnTxt)}`;
  const who = plan.turn === me ? 'anh' : 'đối phương';
  box.querySelector('#aoPlans').innerHTML = `<p class="small"><b>Các hướng đi tốt nhất của ${who}</b> (${esc(src)}):</p>`
    + plan.lines.map((l, i) => {
      const ins = analyzeMove(fen, parseCoordMove(l.pv[0]));
      return `<div class="ao-plan"><div><b>Hướng ${i + 1}: ${esc(label(l.vn[0]))}</b> <span class="muted small">(${esc(fmtScore(mine(l.score)))} theo bên anh)</span> — <span class="why-tag">${esc(PURPOSES[ins.main])}</span></div>`
        + `<div class="small">${esc(ins.text)}</div><div class="small muted">Diễn biến: ${esc(l.vn.map(label).join(' '))}</div>`
        + `<button class="btn ao-play" data-i="${i}">Xem từng nước trên bàn ▸</button></div>`;
    }).join('');

  // ---- Xem diễn biến trên bàn
  const ins = await loadInsights();
  let cur = null, fwd = true;
  const show = () => {
    const l = plan.lines[cur.line];
    const p = new Position(fen);
    for (const m of l.pv.slice(0, cur.i)) p.makeMove(parseCoordMove(m));
    const last = cur.i ? parseCoordMove(l.pv[cur.i - 1]) : null;
    view.setHint(null);
    view.render({ board: p.board, last, checkSq: p.inCheck() ? p.kingSq(p.turn) : -1, animate: fwd ? last : null });
    box.querySelector('#aoStep').textContent = cur.i ? `Hướng ${cur.line + 1} — nước ${cur.i}/${l.pv.length}: ${label(l.vn[cur.i - 1])}` : `Hướng ${cur.line + 1} — thế cuối biến`;
    if (cur.i) {
      const q = new Position(fen);
      for (const m of l.pv.slice(0, cur.i - 1)) q.makeMove(parseCoordMove(m));
      box.querySelector('#aoWhy').innerHTML = whyHTML(q.fen(), l.pv[cur.i - 1], ins, label, { title: `${SIDE[q.turn]} đi ${label(l.vn[cur.i - 1])}` });
    } else box.querySelector('#aoWhy').innerHTML = '<p class="small">Bấm ▸ để xem từng nước của hướng này kèm giải thích.</p>';
    box.querySelector('#aoPrev').disabled = cur.i === 0;
    box.querySelector('#aoNext').disabled = cur.i >= l.pv.length;
  };
  box.querySelectorAll('.ao-play').forEach((b) => {
    b.onclick = () => { cur = { line: +b.dataset.i, i: 1 }; box.querySelector('#aoPv').hidden = false; show(); box.querySelector('#aoPv').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  });
  box.querySelector('#aoPrev').onclick = () => { if (cur && cur.i > 0) { cur.i--; fwd = false; show(); } };
  box.querySelector('#aoNext').onclick = () => { if (cur && cur.i < plan.lines[cur.line].pv.length) { cur.i++; fwd = true; show(); } };
  box.querySelector('#aoBack').onclick = () => { if (cur) { cur.i = 0; fwd = false; show(); } };
}
