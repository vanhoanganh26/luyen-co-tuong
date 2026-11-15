// =====================================================================
// PHÂN TÍCH SAU KHAI CUỘC: điểm yếu của đối phương, điểm cần giữ của mình, hướng triển khai
// Tất cả rút ra từ hình cờ theo luật (kiểm chứng được trên bàn); số liệu engine ghép thêm ở giao diện.
// =====================================================================
import { Position, RED, BLACK, rowOf, colOf, sq, colorOf, typeOf, opposite } from '../core/xiangqi.js';
import { fileNumber } from '../core/notation.js';
import { attacksFrom, attackersOf, isEndangered, mobility, label, valueAt } from './move-insight.js';
import { readPosition, planAdvice } from './position-factors.js';

const START = new Position().board;
const sideName = (c) => (c === RED ? 'Đỏ' : 'Đen');

/** Lời đánh giá theo điểm engine (cp, góc nhìn bên `me`) */
export function evalWords(cp) {
  if (cp > 20000) return 'thắng (có đòn chiếu bí)';
  if (cp < -20000) return 'thua (đối phương có đòn chiếu bí)';
  const a = Math.abs(cp), who = cp > 0 ? 'anh' : 'đối phương';
  if (a < 40) return 'cân bằng';
  if (a < 120) return `${who} nhỉnh hơn một chút`;
  if (a < 300) return `${who} ưu thế rõ`;
  return `${who} ưu thế lớn`;
}

/** Lý do một quân kém hoạt động */
function whyInactive(pos, s) {
  const B = pos.board, p = B[s], t = typeOf(p), c = colorOf(p), r = rowOf(s), cc = colOf(s);
  if (START[s] === p && t === 'r') return 'xe chưa ra khỏi vị trí xuất phát';
  if (START[s] === p && t === 'n') return 'mã chưa lên';
  if (t === 'n') {
    const legs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dr, dc]) => { const rr = r + dr, x = cc + dc; return rr >= 0 && rr < 10 && x >= 0 && x < 9 && B[sq(rr, x)]; }).length;
    if (legs >= 2) return `mã bị cản chân ${legs} phía`;
  }
  if (t === 'c' && mobility(pos, s) <= 3) return 'pháo bị vây, ít đường đi và thiếu ngòi tấn công';
  if (t === 'r') return 'xe bị chặn, ít đường hoạt động';
  return 'ít ô đi được';
}

/** Các quân của bên `me` có thể nhắm (khống chế) ô s chỉ sau 1 nước đi */
function reachers(pos, s, me) {
  const out = new Set();
  for (const m of pos.pseudoMoves(me)) {
    if (m.to === s) continue;
    const q = pos.clone(); q.turn = me;
    q._do(m);
    if (attacksFrom(q.board, m.to).includes(s) && !isEndangered(q.board, m.to)) out.add(m.from);
  }
  return [...out];
}

/** Quân của bên `victim` bị ghim vào tướng bởi xe/pháo của bên kia */
function pins(B, victim) {
  const out = [];
  const k = (() => { for (let s = 0; s < 90; s++) if (B[s] === (victim === RED ? 'K' : 'k')) return s; return -1; })();
  if (k < 0) return out;
  const kr = rowOf(k), kc = colOf(k);
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const between = [];
    let r = kr + dr, c = kc + dc;
    while (r >= 0 && r < 10 && c >= 0 && c < 9) {
      const s = sq(r, c), p = B[s];
      if (p) {
        if (colorOf(p) !== victim && between.length) {
          const t = typeOf(p);
          // Xe: đúng 1 quân chắn là quân mình => bị ghim. Pháo: đúng 2 quân chắn, quân sát tướng là quân mình => quân kia đi thì thành chiếu
          if (t === 'r' && between.length === 1 && colorOf(B[between[0]]) === victim) out.push({ s: between[0], by: s });
          if (t === 'c' && between.length === 2 && between.every((x) => colorOf(B[x]) === victim)) out.push({ s: between[0], by: s, cannon: true }, { s: between[1], by: s, cannon: true });
          break;
        }
        between.push(s);
        if (between.length > 2) break;
      }
      r += dr; c += dc;
    }
  }
  return out;
}

/** Đếm lực lượng phòng thủ / tấn công theo 2 cánh (cột 0–3 và 5–8) ở nửa sân của bên `def` */
function flanks(B, def) {
  const atk = opposite(def), res = { L: { d: 0, a: 0 }, R: { d: 0, a: 0 } };
  for (let s = 0; s < 90; s++) {
    const p = B[s]; if (!p || typeOf(p) === 'k') continue;
    const c = colOf(s), r = rowOf(s);
    if (c === 4) continue;
    const side = c < 4 ? 'L' : 'R';
    const inDefHalf = def === RED ? r >= 5 : r <= 4;
    if (colorOf(p) === def && inDefHalf) res[side].d += 'ab'.includes(typeOf(p)) ? 1 : 1.5;
    if (colorOf(p) === atk && 'rnc'.includes(typeOf(p))) res[side].a += 1;
  }
  return res;
}

/**
 * Phân tích thế cờ cho bên `me` (bên anh cầm).
 * Trả về { opp: [{text, sq, level}], mine: [...], focus: text, tips: [...] }
 */
export function analyzeAfterOpening(fen, me) {
  const pos = new Position(fen);
  const B = pos.board, opp = opposite(me);
  const f = readPosition(fen);
  const oppW = [], mine = [];
  const push = (arr, text, s, level = 1) => { if (!arr.some((x) => x.text === text)) arr.push({ text, sq: s, level }); };

  // 1) Quân đối phương đang gặp nguy / không được bảo vệ
  for (let s = 0; s < 90; s++) {
    const p = B[s];
    if (!p || colorOf(p) !== opp || typeOf(p) === 'k') continue;
    if (isEndangered(B, s)) push(oppW, `${label(B, s, me)} đang bị dọa ăn mà bảo vệ không đủ — mục tiêu số một.`, s, 3);
    else if (!attackersOf(B, s, opp).length && valueAt(B, s) >= 1) {
      // Chỉ nêu quân không được bảo vệ mà quân mình nhắm tới được ngay ở nước sau
      const by = reachers(pos, s, me);
      if (by.length) push(oppW, `${label(B, s, me)} không có quân bảo vệ — ${by.slice(0, 2).map((x) => label(B, x)).join(' hoặc ')} của anh có thể nhắm tới ngay nước sau.`, s, valueAt(B, s) >= 4 ? 2 : 1);
    }
  }
  // 2) Quân bị ghim
  for (const pin of pins(B, opp)) push(oppW, pin.cannon
    ? `${label(B, pin.s, me)} đứng trên đường pháo nhắm tướng: nếu một trong hai quân chắn rời đi, ${label(B, pin.by)} sẽ chiếu.`
    : `${label(B, pin.s, me)} bị ${label(B, pin.by)} ghim vào tướng — không đi được, có thể dồn thêm quân tấn công nó.`, pin.s, 2);
  // 3) Quân kém hoạt động nhất của đối phương
  const worst = f.activity.worst[opp];
  if (worst !== undefined) push(oppW, `Quân kém hoạt động nhất của ${sideName(opp)}: ${label(B, worst, me)} (${whyInactive(pos, worst)}). Giữ cho quân này bị kẹt càng lâu càng tốt.`, worst, 1);
  // 4) Cung tướng đối phương
  const defs = (c) => { let a = 0, b = 0; for (let s = 0; s < 90; s++) if (B[s] && colorOf(B[s]) === c) { if (typeOf(B[s]) === 'a') a++; if (typeOf(B[s]) === 'b') b++; } return { a, b }; };
  const od = defs(opp);
  if (od.a < 2 || od.b < 2) push(oppW, `Cung ${sideName(opp)} thiếu quân phòng thủ (${od.a}/2 sĩ, ${od.b}/2 tượng) — tấn công vào cánh thiếu sĩ/tượng sẽ hiệu quả.`, pos.kingSq(opp), 2);
  const kOpp = pos.kingSq(opp);
  if (colOf(kOpp) !== 4) push(oppW, `Tướng ${sideName(opp)} đã rời trung tâm (cột ${fileNumber(colOf(kOpp), opp)}) — cột đó và đường chéo cung là chỗ dễ tổn thương.`, kOpp, 1);
  if (f.king.v === me) {
    push(oppW, `An toàn tướng nghiêng về anh: ${f.king.why}`, kOpp, 1);
  }
  // 5) Cánh yếu
  const fl = flanks(B, opp);
  const weakSide = fl.L.d + 1.5 <= fl.R.d ? 'L' : fl.R.d + 1.5 <= fl.L.d ? 'R' : null;
  if (weakSide) {
    const cols = weakSide === 'L' ? [0, 3] : [5, 8];
    const nums = cols.map((c) => fileNumber(c, opp)).sort((a, b) => a - b);
    push(oppW, `Cánh cột ${nums[0]}–${nums[1]} của ${sideName(opp)} ít quân phòng thủ hơn cánh còn lại${fl[weakSide].a ? ` (anh đang có ${fl[weakSide].a} quân xe/mã/pháo ở cánh này)` : ''} — nên dồn quân sang đây.`, null, 2);
  }
  // 6) Điểm cần giữ của mình
  for (let s = 0; s < 90; s++) {
    const p = B[s];
    if (p && colorOf(p) === me && typeOf(p) !== 'k' && isEndangered(B, s)) push(mine, `${label(B, s)} của anh đang bị dọa — xử lý trước khi tấn công.`, s, 3);
  }
  for (const pin of pins(B, me)) push(mine, `${label(B, pin.s)} của anh đang bị ghim — cẩn thận khi di chuyển.`, pin.s, 2);
  const myWorst = f.activity.worst[me];
  if (myWorst !== undefined) push(mine, `Quân kém hoạt động nhất của anh: ${label(B, myWorst)} (${whyInactive(pos, myWorst)}) — cải thiện quân này là kế hoạch an toàn.`, myWorst, 1);
  const md = defs(me);
  if (md.a < 2 || md.b < 2) push(mine, `Cung của anh thiếu ${2 - md.a ? (2 - md.a) + ' sĩ ' : ''}${2 - md.b ? (2 - md.b) + ' tượng' : ''} — hạn chế mở thêm đường vào cung.`, pos.kingSq(me), 2);

  oppW.sort((a, b) => b.level - a.level);
  mine.sort((a, b) => b.level - a.level);
  const tips = planAdvice(f, me);
  return { opp: oppW.slice(0, 6), mine: mine.slice(0, 4), tips, factors: f, turn: pos.turn };
}

