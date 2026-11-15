// =====================================================================
// TIẾN ĐỘ LUYỆN TẬP — tính toán thuần (không phụ thuộc giao diện, test được bằng Node)
// - Nhật ký ngày luyện: store 'activity' = { 'YYYY-MM-DD': { open, mid, end, play } }
// - Chuỗi ngày luyện liên tiếp
// - Tỉ lệ đúng theo khai cuộc, các nút (nước) hay sai nhất
// - Thống kê thế cờ theo chủ đề / nhóm, số thế đến hạn ôn
// =====================================================================
import { isDue } from './srs.js';
import { sideToMoveAt } from './opening-tree.js';

const DAY = 86400000;

/** Ngày theo giờ máy, dạng YYYY-MM-DD */
export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ghi một lần luyện vào nhật ký. kind: 'open' | 'mid' | 'end' | 'play' */
export function logActivity(store, kind, n = 1, now = Date.now()) {
  const a = store.getJSON('activity', {}) || {};
  const k = dayKey(now);
  a[k] = a[k] || {};
  a[k][kind] = (a[k][kind] || 0) + n;
  store.setJSON('activity', a);
  return a;
}

/** Chuỗi ngày luyện liên tiếp tính đến hôm nay (hôm nay chưa luyện thì tính tới hôm qua) */
export function streak(activity, now = Date.now()) {
  const has = (t) => {
    const v = activity?.[dayKey(t)];
    return !!v && Object.values(v).some((x) => x > 0);
  };
  let t = now;
  if (!has(t)) t -= DAY;
  let n = 0;
  while (has(t)) { n++; t -= DAY; }
  return { days: n, today: has(now) };
}

/** Các ngày trong `days` ngày gần nhất (cũ -> mới) kèm số lần luyện */
export function recentDays(activity, days = 28, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = now - i * DAY;
    const v = activity?.[dayKey(t)] || {};
    out.push({ day: dayKey(t), count: Object.values(v).reduce((a, b) => a + b, 0) });
  }
  return out;
}

/** Thống kê từng khai cuộc: số nút đã luyện, tỉ lệ đúng, số nút đến hạn ôn, số lần quên */
export function openingStats(openings, cards, now = Date.now()) {
  return openings.map((op) => {
    let seen = 0, correct = 0, due = 0, lapses = 0, nodes = 0;
    for (const side of op.sides) {
      for (const n of op.nodes.values()) {
        const c = cards[`${op.id}|${side}|${n.key}`];
        if (!c) continue;
        nodes++; seen += c.seen; correct += c.correct; lapses += c.lapses || 0;
        if (isDue(c, now)) due++;
      }
    }
    return { id: op.id, name: op.name, kind: op.kind, seen, correct, acc: seen ? correct / seen : null, due, lapses, nodes };
  });
}

/** Các nước hay sai nhất (theo số lần quên), kèm khai cuộc, bên cầm và tên biến chứa nước đó */
export function worstNodes(openings, cards, limit = 8) {
  const rows = [];
  for (const op of openings) {
    for (const side of op.sides) {
      for (const n of op.nodes.values()) {
        const c = cards[`${op.id}|${side}|${n.key}`];
        if (!c || !c.lapses || !n.children.length || sideToMoveAt(op, n) !== side) continue;
        // Nước đúng tại nút này (nước lý thuyết đầu tiên) và biến chứa nó
        const next = op.nodes.get(n.children[0]);
        const line = op.lines.find((l) => (next?.lineIds || []).includes(l.id)) || op.lines.find((l) => (n.lineIds || []).includes(l.id));
        const ply = (n.ply || 0) + 1;
        rows.push({ opId: op.id, opName: op.name, side, key: n.key, ply, move: next?.vn || '', lineName: line?.name || '', lapses: c.lapses, acc: c.seen ? c.correct / c.seen : 0 });
      }
    }
  }
  rows.sort((a, b) => b.lapses - a.lapses || a.acc - b.acc);
  return rows.slice(0, limit);
}

/** Thống kê thế cờ: đến hạn ôn, đã làm / đã đạt theo nhóm (chủ đề trung cuộc, nhóm tàn cuộc) */
export function positionStats(items, posCards, posProgress, groupOf, now = Date.now()) {
  const groups = new Map();
  let due = 0, done = 0, tried = 0;
  for (const x of items) {
    const c = posCards[x.id], p = posProgress[x.id];
    if (c && isDue(c, now)) due++;
    if (p) { tried++; if (p.solved) done++; }
    for (const g of groupOf(x)) {
      const s = groups.get(g) || { group: g, total: 0, tried: 0, solved: 0 };
      s.total++;
      if (p) { s.tried++; if (p.solved) s.solved++; }
      groups.set(g, s);
    }
  }
  return { total: items.length, due, done, tried, groups: [...groups.values()].sort((a, b) => b.total - a.total) };
}
