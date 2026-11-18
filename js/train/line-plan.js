// =====================================================================
// HỌC THEO BIẾN — chia một khai cuộc (book hoặc lý thuyết) thành các nhóm và biến để chọn học
//   - Nhóm = các nước ở chỗ RẼ NHÁNH ĐẦU TIÊN của cây (VD Đỏ P2-5 thì Đen đáp M8.7 / M2.3 / P8-5…)
//   - Biến = một đường từ đầu ván tới cuối (một "line" của dữ liệu)
//   - Thứ tự học: mạnh + phổ biến trước — chính biến lý thuyết, rồi nước Mạnh nhất/Tốt nhiều ván
//     cao thủ, cuối cùng nước Yếu/Hớ (học cách trừng phạt)
//   - "Thuộc" một biến = đi đúng hết (chế độ Kiểm tra, không thử lại, không sai) ở 2 NGÀY KHÁC NHAU liên tiếp
//     (nhớ giãn cách, không phải nhớ ngắn hạn); sau đó ôn lại theo lịch 3 – 7 – 15 – 30 – 60 ngày
//   - Xác suất gặp: tích tỉ lệ của nước đối phương dọc đường đi (theo số ván cao thủ nếu có, không thì
//     theo hạng nước / trọng số biến). Biến hiếm gặp (< 3%) là "tùy chọn".
// Logic thuần, dùng chung cho app và test Node.
// =====================================================================
import { sideToMoveAt } from './opening-tree.js';

export const MASTER_STREAK = 2;
export const OPTIONAL_REACH = 0.03;
export const REVIEW_DAYS = [3, 7, 15, 30, 60];
const DAY = 86400000;
/** Khóa ngày theo giờ máy (YYYY-MM-DD) */
export function dayOf(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
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

/** Tỉ lệ đối phương chọn từng nước ở một nút: theo số ván cao thủ nếu có, không thì theo hạng / trọng số */
export function childShares(op, node) {
  const kids = node.children.map((k) => op.nodes.get(k));
  const infs = kids.map((k) => op.info?.[k.key] || null);
  const games = infs.map((i) => i?.games || 0);
  const maxG = Math.max(0, ...games);
  let base;
  if (maxG > 0) {
    // nước không có số liệu: coi như ít gặp (≈ 1/4 nước ít ván nhất có số liệu, theo hạng)
    const minG = Math.min(...games.filter((g) => g > 0));
    base = infs.map((i, j) => (games[j] > 0 ? games[j] : Math.max(1, minG / 4) * ((i?.w || 1) / 3)));
  } else if (infs.some(Boolean)) base = infs.map((i) => i?.w || 1);
  else base = kids.map((k) => Math.max(0.01, k.weight));
  const sum = base.reduce((a, b) => a + b, 0) || 1;
  return new Map(kids.map((k, j) => [k.key, base[j] / sum]));
}

/** Xác suất gặp một biến khi anh cầm `side` (tích tỉ lệ ở các lượt đối phương có nhiều lựa chọn) */
export function reachOf(op, side, line, memo = new Map()) {
  let p = 1;
  for (const n of lineNodes(op, line)) {
    const parentKey = n.key.split(' ').slice(0, -1).join(' ');
    const parent = op.nodes.get(parentKey);
    if (!parent || parent.children.length < 2 || sideToMoveAt(op, parent) === side) continue;
    if (!memo.has(parentKey)) memo.set(parentKey, childShares(op, parent));
    p *= memo.get(parentKey).get(n.key) ?? 0;
  }
  return p;
}

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
  const memo = new Map();
  if (!node.children.length) {
    groups.push({ key: node.key, vn: null, mover: null, info: null, label: 'Biến chính', reach: 1,
      lines: lines.map((line) => ({ line, rank: lineRank(op, line), reach: reachOf(op, side, line, memo), optional: false })).sort((a, b) => b.reach - a.reach) });
  } else {
    const mover = sideToMoveAt(op, node);
    for (const ck of node.children) {
      const c = op.nodes.get(ck);
      const ls = lines.filter((l) => c.lineIds.includes(l.id)).map((line) => {
        const last = op.nodes.get(line.lastKey);
        const inf = op.info?.[line.lastKey];
        // Biến chỉ để "chuyển sang chương khác" (kết thúc ngay tại nước rẽ)
        const link = inf?.link && !inf.link.same && inf.kind !== 'spine' ? inf.link : null;
        const reach = reachOf(op, side, line, memo);
        return { line, rank: lineRank(op, line), link, lastPly: last?.ply, reach, optional: !link && lineRank(op, line)[0] > 0 && reach < OPTIONAL_REACH };
      }).sort((a, b) => (a.optional - b.optional) || ((a.rank[0] > 0) - (b.rank[0] > 0)) || (b.reach - a.reach) || cmpRank(a.rank, b.rank));
      // (chính biến lý thuyết luôn học trước, rồi tới biến hay gặp)
      if (!ls.length) continue;
      const info = op.info?.[c.key] || null;
      const who = mover === side ? 'Anh đi' : `${SIDE[mover]} đáp`;
      const share = mover === side ? 1 : (memo.get('__b') || memo.set('__b', childShares(op, node)).get('__b')).get(c.key);
      groups.push({ key: c.key, vn: c.vn, mover, info, label: `${who} ${c.vn}`, lines: ls, weight: c.weight, reach: share });
    }
    // Nhóm: chính biến trước, rồi theo hạng + số ván cao thủ
    const gRank = (g) => {
      if (!g.info) return [0, -(g.weight || 0), 0];
      return [g.info.kind === 'spine' ? 0 : 1 + GRADE_ORDER[g.info.grade], -(g.info.games || 0), 0];
    };
    // Nhóm hay gặp trước (xác suất ở chỗ rẽ nhánh); bằng nhau thì theo hạng
    groups.sort((a, b) => (b.reach - a.reach) || cmpRank(gRank(a), gRank(b)));
  }
  const order = groups.flatMap((g) => g.lines.filter((x) => !x.link && !x.optional).map((x) => x.line.id));
  const optional = groups.flatMap((g) => g.lines.filter((x) => x.optional).map((x) => x.line.id));
  return { branch: node, groups, order, optional };
}

/**
 * Cập nhật tiến độ một biến sau một lượt luyện. run: { mode, wrong, retry }
 * - Lượt Kiểm tra đúng hết: tính 1 "ngày nhớ đúng" (nhiều lượt cùng ngày chỉ tính 1)
 * - Đủ MASTER_STREAK ngày liên tiếp nhớ đúng (không xen lượt sai) => thuộc; ôn lại theo REVIEW_DAYS
 * - Kiểm tra mà sai: chuỗi về 0, bỏ dấu thuộc, ôn lại ngay
 */
export function recordRun(prog, run, now = Date.now()) {
  const p = { runs: 0, streak: 0, mastered: false, reviews: 0, ...(prog || {}) };
  const today = dayOf(now);
  p.runs++;
  p.last = now;
  const perfect = run.mode === 'test' && !run.wrong && !run.retry;
  if (perfect) {
    if (p.okDay !== today) { p.streak++; p.okDay = today; }
    if (p.mastered) { p.reviews++; }
    if (p.streak >= MASTER_STREAK) p.mastered = true;
    // Chưa thuộc: hẹn ngày mai kiểm tra lại; đã thuộc: giãn dần
    p.due = p.mastered ? now + REVIEW_DAYS[Math.min(p.reviews, REVIEW_DAYS.length - 1)] * DAY : now + DAY * 0.5;
  } else if (run.mode === 'test') {
    p.streak = 0; p.okDay = null;
    if (run.wrong) p.mastered = false;
    p.due = now;
  } else {
    p.due = Math.min(p.due ?? now, now); // vừa học có gợi ý: kiểm tra được ngay
  }
  return p;
}

/** Biến đã học (có tiến độ) và đến hạn ôn */
export function isDue(p, now = Date.now()) { return !!p && p.runs > 0 && (p.due ?? 0) <= now; }

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
