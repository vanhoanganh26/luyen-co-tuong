// =====================================================================
// CÂY KHAI CUỘC
// Dữ liệu soạn theo từng "biến" (line): một chuỗi ký pháp VN, chú thích đặt trong {...}
//   VD: "P2-5 {Chiếm trung lộ} M8.7 M2.3 X9-8"
// Hàm buildOpening() kiểm từng nước bằng bộ luật, rồi gộp các biến có chung
// phần đầu thành một cây. Mỗi nút có `key` = chuỗi nước ICCS từ gốc (ổn định
// giữa các lần build) để lưu tiến độ SRS theo từng nút.
// Dùng chung cho script kiểm định (Node) và app (trình duyệt).
// =====================================================================
import { Position, START_FEN, moveToICCS } from '../core/xiangqi.js';
import { parseNotation, moveToNotation } from '../core/notation.js';

/** Tách chuỗi biến thành [{ san, comment }] — bỏ số thứ tự "1." "12..." */
export function tokenizeLine(text) {
  const out = [];
  const re = /\{([^}]*)\}|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      if (out.length) out[out.length - 1].comment = (out[out.length - 1].comment ? out[out.length - 1].comment + ' ' : '') + m[1].trim();
      else out.push({ san: null, comment: m[1].trim() }); // chú thích trước nước đầu tiên
      continue;
    }
    let tok = m[2].replace(/^\d+\.+/, ''); // "1.P2-5" -> "P2-5", "3..." -> ""
    if (!tok || /^\d+\.*$/.test(tok) || tok === '...') continue;
    out.push({ san: tok, comment: '' });
  }
  return out;
}

/**
 * Kiểm một biến. Trả về { ok, plies:[{iccs, vn, comment, fenAfter}], error }
 * Dừng ở nước sai đầu tiên (nước sai bị loại, phần sau không dùng).
 */
export function checkLine(text, startFen = START_FEN) {
  const pos = new Position(startFen);
  const toks = tokenizeLine(text);
  const plies = [];
  let intro = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.san === null) { intro = t.comment; continue; }
    const m = parseNotation(pos, t.san, 'vn');
    if (!m) {
      return { ok: false, plies, intro, error: { index: plies.length + 1, token: t.san, fen: pos.fen(), reason: 'Nước không hợp lệ hoặc không đọc được' } };
    }
    const vn = moveToNotation(pos, m, { style: 'vn' });
    pos.makeMove(m);
    plies.push({ iccs: moveToICCS(m), vn, comment: t.comment || '', fenAfter: pos.fen() });
  }
  return { ok: true, plies, intro, error: null };
}

/**
 * Dựng cây từ dữ liệu 1 khai cuộc.
 * opening: { id, name, group, kind, sides, summary, source, startFen?, lines:[{id,name,moves,plan,weight,source?}] }
 * Kết quả: { ...meta, root, nodes: Map(key -> node), lines:[...kèm trạng thái kiểm định] }
 * node: { key, ply, iccs, vn, comments:[], children:[keys], weight, lineIds:[], end:boolean }
 */
export function buildOpening(opening) {
  const startFen = opening.startFen || START_FEN;
  const nodes = new Map();
  const root = { key: '', ply: 0, iccs: null, vn: null, comments: [], children: [], weight: 0, lineIds: [], end: false };
  nodes.set('', root);
  const lines = [];
  for (const line of opening.lines || []) {
    const res = checkLine(line.moves, startFen);
    const weight = line.weight ?? 1;
    let parent = root;
    parent.weight += weight;
    parent.lineIds.push(line.id);
    for (const p of res.plies) {
      const key = parent.key ? parent.key + ' ' + p.iccs : p.iccs;
      let node = nodes.get(key);
      if (!node) {
        node = { key, ply: parent.ply + 1, iccs: p.iccs, vn: p.vn, comments: [], children: [], weight: 0, lineIds: [], end: false, fen: p.fenAfter };
        nodes.set(key, node);
        parent.children.push(key);
      }
      node.weight += weight;
      node.lineIds.push(line.id);
      if (p.comment && !node.comments.includes(p.comment)) node.comments.push(p.comment);
      parent = node;
    }
    if (res.plies.length) parent.end = true;
    lines.push({
      id: line.id, name: line.name, plan: line.plan || '', weight, intro: res.intro || line.intro || '',
      moves: line.moves, // chuỗi gốc (để sửa biến ngay trong app)
      source: line.source || opening.source || 'chưa ghi nguồn',
      plies: res.plies.length,
      lastKey: parent.key,
      verification: {
        rules: res.ok ? 'đạt' : 'lỗi',
        rulesError: res.error,
        engine: line.engine || 'chưa kiểm định',
      },
    });
  }
  return {
    id: opening.id, name: opening.name, group: opening.group, kind: opening.kind || 'theory',
    sides: opening.sides || ['r', 'b'], summary: opening.summary || '', source: opening.source || '',
    startFen, root, nodes, lines,
    definingPlies: opening.definingPlies, custom: !!opening.custom,
  };
}

/** Chuyển cây sang JSON thuần (để ghi file) và ngược lại */
export function serializeOpening(op) {
  // Bỏ FEN từng nút cho file nhẹ (app tự dựng lại thế cờ khi cần)
  return { ...op, root: undefined, nodes: [...op.nodes.values()].map(({ fen, ...n }) => n) };
}
export function deserializeOpening(data) {
  const nodes = new Map(data.nodes.map((n) => [n.key, n]));
  return { ...data, nodes, root: nodes.get('') };
}

/** Bên đi nước tại nút (nút gốc: bên đi đầu theo FEN) */
export function sideToMoveAt(op, node) {
  const first = new Position(op.startFen).turn;
  return node.ply % 2 === 0 ? first : (first === 'r' ? 'b' : 'r');
}

/** Biến chứa nút (biến đầu tiên đi qua nút) — để lấy kế hoạch trung cuộc */
export function lineOf(op, node) {
  const id = node.lineIds[0];
  return op.lines.find((l) => l.id === id) || null;
}
