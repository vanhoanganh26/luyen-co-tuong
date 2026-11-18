// =====================================================================
// BỘ KHAI CUỘC CỦA ANH + BÀI LUYỆN HÔM NAY + PHÂN TÍCH VÁN SO VỚI BOOK
// Logic thuần (không DOM), dùng chung cho app và test Node.
// =====================================================================
import { Position, parseCoordMove, moveToICCS } from '../core/xiangqi.js';
import { parseNotation, moveToNotation } from '../core/notation.js';
import { sideToMoveAt } from './opening-tree.js';
import { linePlan, lineKey, isDue, reachOf } from './line-plan.js';

export const DAILY_REVIEWS = 5;   // tối đa số biến ôn mỗi ngày
const SIDE = { r: 'Đỏ', b: 'Đen' };

/**
 * Các chương thuộc bộ khai cuộc của anh.
 * repertoire = { r: [id khai cuộc gốc], b: [...] } ; chapters = các chương book (op.bookOf, op.bookSide)
 */
export function repertoireChapters(chapters, repertoire) {
  const out = [];
  for (const side of ['r', 'b']) {
    for (const id of repertoire?.[side] || []) {
      const op = chapters.find((c) => c.bookOf === id && c.bookSide === side);
      if (op) out.push({ op, side });
    }
  }
  return out;
}

/**
 * Bài luyện hôm nay: tối đa DAILY_REVIEWS biến đến hạn ôn (Kiểm tra) + 1 biến mới (Học mới, xem đích đến trước).
 * Trả về { items: [{ op, side, lineId, kind: 'review'|'new' }], dueTotal }
 */
export function buildDaily(repChapters, progress, now = Date.now()) {
  const due = [];
  let fresh = null;
  for (const { op, side } of repChapters) {
    const plan = linePlan(op, side);
    for (const id of [...plan.order, ...plan.optional]) {
      const p = progress[lineKey(op.id, side, id)];
      if (isDue(p, now)) due.push({ op, side, lineId: id, kind: 'review', due: p.due, mastered: p.mastered });
    }
    if (!fresh) {
      const id = plan.order.find((x) => !progress[lineKey(op.id, side, x)]?.runs);
      if (id) fresh = { op, side, lineId: id, kind: 'new' };
    }
  }
  // Biến đang học dở (chưa thuộc) ôn trước, rồi biến đã thuộc quá hạn lâu nhất
  due.sort((a, b) => (a.mastered - b.mastered) || (a.due - b.due));
  const items = due.slice(0, DAILY_REVIEWS);
  if (fresh) items.push(fresh);
  return { items, dueTotal: due.length };
}

/** Tách biên bản dán vào thành danh sách nước (bỏ số thứ tự "1." , dấu phẩy, chú thích {…}) */
export function splitGameText(text) {
  return String(text || '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[,;]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .map((t) => t.replace(/^\d+\.(?=\S)/, '')); // "1.P2-5" -> "P2-5"
}

/** Đọc biên bản -> { moves: [iccs], vn: [ký pháp], error? } */
export function parseGame(text, startFen) {
  const pos = new Position(startFen);
  const moves = [], vn = [];
  for (const tok of splitGameText(text)) {
    let m = null;
    if (/^[a-i]\d[a-i]\d$/i.test(tok)) { const c = parseCoordMove(tok.toLowerCase()); if (pos.isLegal(c)) m = c; }
    if (!m) { try { m = parseNotation(pos, tok); } catch { m = null; } }
    if (!m || !pos.isLegal(m)) return { moves, vn, error: `Nước thứ ${moves.length + 1} ("${tok}") không đọc được hoặc không hợp lệ.` };
    vn.push(moveToNotation(pos, m));
    moves.push(moveToICCS(m));
    pos.makeMove(m);
  }
  return { moves, vn };
}

/**
 * So ván với book: đi theo cây của từng chương (đúng bên anh cầm), lấy chương theo book được lâu nhất.
 * Trả về { op, side, ply (số nước còn trong book), node (nút cuối trong book),
 *          leave: { ply, by: 'me'|'opp', vn, bookMoves: [{ vn, grade? }] } | null, endOfBook: bool }
 */
export function compareWithBook(chapters, moves, side, preferIds = []) {
  let best = null;
  for (const op of chapters) {
    if ((op.bookSide || op.sides[0]) !== side) continue;
    let node = op.root, ply = 0;
    for (const m of moves) {
      const next = node.children.map((k) => op.nodes.get(k)).find((c) => c.iccs === m);
      if (!next) break;
      node = next; ply++;
    }
    const pref = preferIds.includes(op.bookOf) ? 0.5 : 0; // bằng nhau thì ưu tiên chương trong bộ của anh
    if (!best || ply + pref > best.score) best = { op, side, ply, node, score: ply + pref };
  }
  if (!best) return null;
  const { op, ply, node } = best;
  const res = { op, side, ply, node, leave: null, endOfBook: false };
  if (ply < moves.length) {
    if (!node.children.length) res.endOfBook = true;
    else {
      const mover = sideToMoveAt(op, node);
      res.leave = {
        ply: ply + 1, by: mover === side ? 'me' : 'opp', iccs: moves[ply],
        bookMoves: node.children.map((k) => op.nodes.get(k)).map((c) => ({ vn: c.vn, iccs: c.iccs, grade: op.info?.[c.key]?.grade || null })),
      };
    }
  }
  return res;
}

/** Biến nên học để khỏi rời book ở nút `node`: biến hay gặp nhất đi qua nút đó (hoặc qua nước book ở nút đó) */
export function lineThrough(op, side, node) {
  const ids = new Set(node.lineIds);
  const cands = op.lines.filter((l) => ids.has(l.id));
  if (!cands.length) return null;
  const memo = new Map();
  return cands.map((l) => ({ l, r: reachOf(op, side, l, memo) - (l.alt ? 0.0001 : 0) })).sort((a, b) => b.r - a.r)[0].l;
}

export { SIDE };
