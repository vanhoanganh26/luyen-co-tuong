// =====================================================================
// KÝ PHÁP
// 1) Ký pháp Việt Nam: <Quân><cột hoặc t/g/s><dấu><số>
//    Quân: Tg (tướng), S (sĩ), T (tượng), X (xe), P (pháo), M (mã), B (tốt/binh)
//    Dấu (mặc định): "." tiến, "-" bình (đi ngang), "/" thoái (lui)
//    Kiểu dấu "+" : "+" tiến, "-" bình, "/" thoái
//    VD: P2-5, M8.7 (hoặc M8+7), X1.1, T3.5, Xt.1 (xe trước tiến 1), Ps-4 (pháo sau bình 4)
// 2) Ký pháp quốc tế WXF: <K A E H R C P><cột hoặc +/-><+ . -><số>
//    VD: C2.5, H8+7, R1+1, E3+5, +R-1
// Cột đánh số 1–9 từ PHẢI sang TRÁI theo góc nhìn của mỗi bên.
// Quân đi thẳng (xe, pháo, tốt, tướng) khi tiến/thoái: số = số bước;
// quân đi chéo (mã, tượng, sĩ): số = cột đích.
// =====================================================================
import { RED, colorOf, typeOf, rowOf, colOf, parseCoordMove } from './xiangqi.js';

export const VN_LETTER = { k: 'Tg', a: 'S', b: 'T', n: 'M', r: 'X', c: 'P', p: 'B' };
export const WXF_LETTER = { k: 'K', a: 'A', b: 'E', n: 'H', r: 'R', c: 'C', p: 'P' };

/** Số cột (1–9) theo góc nhìn bên `color` */
export const fileNumber = (c, color) => (color === RED ? 9 - c : c + 1);

/**
 * Xác định "nhãn" phân biệt khi có nhiều quân cùng loại trên cùng một cột.
 * Trả về { kind: 'file' } hoặc { kind: 'tandem', index, count, needFile }
 * index = 0 là quân đứng trước nhất (gần phía đối phương nhất).
 */
function tandemInfo(pos, from) {
  const p = pos.board[from];
  const color = colorOf(p), c = colOf(from);
  const same = [];
  for (let r = 0; r < 10; r++) if (pos.board[r * 9 + c] === p) same.push(r);
  if (same.length < 2) return { kind: 'file' };
  // Đỏ: hàng nhỏ hơn là phía trước; Đen: hàng lớn hơn là phía trước
  same.sort((a, b) => (color === RED ? a - b : b - a));
  const index = same.indexOf(rowOf(from));
  // Riêng tốt: nếu còn cột khác cũng có >= 2 tốt thì phải ghi thêm số cột
  let needFile = false;
  if (typeOf(p) === 'p') {
    for (let cc = 0; cc < 9; cc++) {
      if (cc === c) continue;
      let n = 0;
      for (let r = 0; r < 10; r++) if (pos.board[r * 9 + cc] === p) n++;
      if (n >= 2) { needFile = true; break; }
    }
  }
  return { kind: 'tandem', index, count: same.length, needFile };
}

function tandemTag(index, count, style) {
  if (style === 'vn') {
    if (count === 2) return ['t', 's'][index];
    if (count === 3) return ['t', 'g', 's'][index];
    // 4–5 tốt cùng cột (rất hiếm): t, 2, 3, ..., s
    return index === 0 ? 't' : index === count - 1 ? 's' : String(index + 1);
  }
  // WXF: + trước, - sau; 3 quân: + = - (chưa xác minh với tài liệu WXF gốc)
  if (count === 2) return ['+', '-'][index];
  if (count === 3) return ['+', '=', '-'][index];
  return index === 0 ? '+' : index === count - 1 ? '-' : String(index + 1);
}

/**
 * Chuyển nước đi thành ký pháp. `pos` là thế TRƯỚC khi đi.
 * opts.style: 'vn' | 'wxf'; opts.vnAdvance: '.' | '+'
 */
export function moveToNotation(pos, m, opts = {}) {
  const style = opts.style || 'vn';
  const adv = opts.vnAdvance || '.';
  const p = pos.board[m.from];
  if (!p) throw new Error('Không có quân ở ô xuất phát');
  const color = colorOf(p), t = typeOf(p);
  const fr = rowOf(m.from), fc = colOf(m.from), tr = rowOf(m.to), tc = colOf(m.to);

  // Hướng: tiến / bình / thoái
  const forward = color === RED ? fr - tr : tr - fr; // > 0 là tiến
  let dir;
  if (fr === tr) dir = 'flat';
  else dir = forward > 0 ? 'up' : 'down';

  let num;
  const straight = t === 'r' || t === 'c' || t === 'p' || t === 'k';
  if (dir === 'flat' || !straight) num = fileNumber(tc, color);
  else num = Math.abs(forward);

  const signs = style === 'vn'
    ? { up: adv, flat: '-', down: '/' }
    : { up: '+', flat: '.', down: '-' };

  const letter = style === 'vn' ? VN_LETTER[t] : WXF_LETTER[t];
  const info = tandemInfo(pos, m.from);
  let head;
  if (info.kind === 'file') {
    head = letter + fileNumber(fc, color);
  } else {
    const tag = tandemTag(info.index, info.count, style);
    const file = info.needFile ? String(fileNumber(fc, color)) : '';
    head = style === 'vn' ? letter + tag + file : tag + letter + file;
  }
  return head + signs[dir] + num;
}

/** Chuẩn hóa chuỗi ký pháp để so khớp (bỏ khoảng trắng, đổi dấu tương đương) */
function normalize(str, style) {
  let s = String(str).replace(/\s+/g, '').replace(/[＋]/g, '+').replace(/[／\\]/g, '/').replace(/[－–—]/g, '-');
  if (style === 'vn') {
    s = s.replace(/\+/g, '.').replace(/=/g, '-');
  } else {
    s = s.replace(/=/g, '.');
  }
  return s.toLowerCase();
}

/**
 * Đọc ký pháp (VN hoặc WXF) hoặc tọa độ ICCS ("h2e2") thành nước đi hợp lệ trong thế `pos`.
 * Trả về { from, to } hoặc null nếu không khớp / mơ hồ.
 */
export function parseNotation(pos, str, style = 'vn') {
  const coord = parseCoordMove(str, 0);
  if (coord && pos.isLegal(coord)) return coord;
  const target = normalize(str, style);
  const hits = [];
  for (const m of pos.legalMoves()) {
    if (normalize(moveToNotation(pos, m, { style }), style) === target) hits.push(m);
    // WXF: chấp nhận cả dạng "R+" (dấu sau chữ) cho quân tiền/hậu
    else if (style === 'wxf') {
      const n = moveToNotation(pos, m, { style });
      const alt = n.replace(/^([+\-=])([A-Z])/, '$2$1');
      if (normalize(alt, style) === target) hits.push(m);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}
