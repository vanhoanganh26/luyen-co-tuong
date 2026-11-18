// =====================================================================
// HỌC THEO BIẾN — chia một khai cuộc (book hoặc lý thuyết) thành các nhóm và biến để chọn học
//   - Nhóm = các nước ở chỗ RẼ NHÁNH ĐẦU TIÊN của cây (VD Đỏ P2-5 thì Đen đáp M8.7 / M2.3 / P8-5…)
//   - Biến = một đường từ đầu ván tới cuối (một "line" của dữ liệu)
//   - Thứ tự học: mạnh + phổ biến trước — chính biến lý thuyết, rồi nước Mạnh nhất/Tốt nhiều ván
//     cao thủ, cuối cùng nước Yếu/Hớ (học cách trừng phạt)
//   - "Thuộc" một biến = đi đúng hết (chế độ Kiểm tra, không thử lại, không sai) 2 lần liên tiếp
// Logic thuần, dùng chung cho app và test Node.
// =====================================================================
import { sideToMoveAt } from './opening-tree.js';

export const MASTER_STREAK = 2;
const GRADE_ORDER = { best: 0, good: 1, ok: 2, weak: 3, blunder: 4 };
const SIDE = { r: 'Đỏ', b: 'Đen' };

/** Khóa lưu tiến độ một biến */
export const lineKey = (opId, side, lineId) => `${opId}|${side}|${lineId}`;

/** Các nút trên đường đi của một biến (không gồm gốc) */
export function lineNodes(op, line) {
  const keys = line.lastKey ? line.lastKey.split(' ') : [];
  const out = [];
  for (let i = 1; i <= keys.length; i++) out.push(op.nodes.get(keys.slice(0, i).join(' ')));
  return out;
}

/** Nước "rẽ khỏi chính biến" của một biến book (nước đối phương có kind khác 'spine') */
function deviation(op, line) {
  if (!op.info) return null;
  for (const n of lineNodes(op, line)) {
    const inf = op.info[n.key];
    if (inf && inf.kind !== 'spine') return { node: n, info: inf };
  }
  return null;
}

/** Điểm ưu tiên (càng nhỏ càng học trước) */
function lineRank(op, line) {
  const dev = deviation(op, line);
  if (!dev) return [0, -(line.weight || 1), 0, 0];
  return [1 + GRADE_ORDER[dev.info.grade], -(dev.info.games || 0), dev.node.ply, 0];
}
const cmpRank = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/**
 * Lập kế hoạch học cho khai cuộc `op` khi anh cầm `side`.
 * Trả về { branch (nút rẽ nhánh), groups: [{ key, vn, mover, info, label, lines: [{ line, rank, link }] }], order: [lineId] }
 */
export function linePlan(op, side) {
  // Tìm chỗ rẽ nhánh đầu tiên (đi theo đường duy nhất từ gốc)
  let node = op.root;
  while (node.children.length === 1) node = op.nodes.get(node.children[0]);
  const usable = (l) => l.verification?.rules !== 'lỗi' && l.plies > 0;
  const lines = op.lines.filter(usable);
  const groups = [];
  if (!node.children.length) {
    groups.push({ key: node.key, vn: null, mover: null, info: null, label: 'Biến chính', lines: lines.map((line) => ({ line, rank: lineRank(op, line) })) });
  } else {
    const mover = sideToMoveAt(op, node);
    for (const ck of node.children) {
      const c = op.nodes.get(ck);
      const ls = lines.filter((l) => c.lineIds.includes(l.id)).map((line) => {
        const last = op.nodes.get(line.lastKey);
        const inf = op.info?.[line.lastKey];
        // Biến chỉ để "chuyển sang chương khác" (kết thúc ngay tại nước rẽ)
        const link = inf?.link && !inf.link.same && inf.kind !== 'spine' ? inf.link : null;
        return { line, rank: lineRank(op, line), link, lastPly: last?.ply };
      }).sort((a, b) => cmpRank(a.rank, b.rank));
      if (!ls.length) continue;
      const info = op.info?.[c.key] || null;
      const who = mover === side ? 'Anh đi' : `${SIDE[mover]} đáp`;
      groups.push({ key: c.key, vn: c.vn, mover, info, label: `${who} ${c.vn}`, lines: ls, weight: c.weight });
    }
    // Nhóm: chính biến trước, rồi theo hạng + số ván cao thủ
    const gRank = (g) => {
      if (!g.info) return [0, -(g.weight || 0), 0];
      return [g.info.kind === 'spine' ? 0 : 1 + GRADE_ORDER[g.info.grade], -(g.info.games || 0), 0];
    };
    groups.sort((a, b) => cmpRank(gRank(a), gRank(b)));
  }
  const order = groups.flatMap((g) => g.lines.filter((x) => !x.link).map((x) => x.line.id));
  return { branch: node, groups, order };
}

/** Cập nhật tiến độ một biến sau một lượt luyện. run: { mode, wrong, retry } */
export function recordRun(prog, run, now = Date.now()) {
  const p = { runs: 0, streak: 0, mastered: false, ...(prog || {}) };
  p.runs++;
  p.last = now;
  const perfect = run.mode === 'test' && !run.wrong && !run.retry;
  p.streak = perfect ? p.streak + 1 : (run.mode === 'test' ? 0 : p.streak);
  if (p.streak >= MASTER_STREAK) p.mastered = true;
  if (run.mode === 'test' && run.wrong) p.mastered = false; // sai lại thì bỏ dấu thuộc, học lại
  return p;
}

/** Biến nên học tiếp: biến chưa thuộc đầu tiên theo thứ tự (ưu tiên cùng nhóm với biến vừa học) */
export function nextLine(plan, progress, op, side, afterLineId = null) {
  const done = (id) => progress[lineKey(op.id, side, id)]?.mastered;
  if (afterLineId) {
    const g = plan.groups.find((x) => x.lines.some((y) => y.line.id === afterLineId));
    const inGroup = g?.lines.find((y) => !y.link && !done(y.line.id));
    if (inGroup) return inGroup.line.id;
  }
  return plan.order.find((id) => !done(id)) || null;
}

/**
 * "Mở rộng dần" trong một nhóm: các biến đã thuộc + 1 biến mới (biến chưa thuộc đầu tiên).
 * Trả về { lines: [id], focus: id|null }
 */
export function groupSet(group, progress, op, side) {
  const real = group.lines.filter((x) => !x.link);
  const mastered = real.filter((x) => progress[lineKey(op.id, side, x.line.id)]?.mastered).map((x) => x.line.id);
  const fresh = real.find((x) => !mastered.includes(x.line.id));
  return { lines: fresh ? [...mastered, fresh.line.id] : mastered, focus: fresh ? fresh.line.id : null };
}
