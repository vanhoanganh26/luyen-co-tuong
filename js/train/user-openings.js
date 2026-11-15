// =====================================================================
// CHỈNH SỬA KHAI CUỘC CỦA NGƯỜI DÙNG (lớp phủ lên dữ liệu gốc)
// Dữ liệu gốc (data/openings.built.json) không bị sửa. Mọi thay đổi của anh Thắng lưu riêng:
//   edits = {
//     lines:  { [idKhaiCuộc]: { [idBiến]: { deleted } | { name, plan, moves, engineCheck } } },
//     added:  { [idKhaiCuộc]: [ { id, name, plan, moves, engineCheck } ] },   // biến thêm vào khai cuộc có sẵn
//     custom: [ { id, name, group, kind, sides, summary, lines: [...] } ],    // khai cuộc tự tạo
//   }
// Khi nạp app: ghép dữ liệu gốc + chỉnh sửa rồi dựng lại cây (buildOpening).
// Tiến độ SRS gắn theo đường đi nước (không theo id biến) nên không bị mất khi sửa.
// =====================================================================
import { buildOpening, deserializeOpening } from './opening-tree.js';

export const emptyEdits = () => ({ lines: {}, added: {}, custom: [] });

export function normalizeEdits(e) {
  const x = e && typeof e === 'object' ? e : {};
  return { lines: x.lines || {}, added: x.added || {}, custom: Array.isArray(x.custom) ? x.custom : [] };
}

const rawLine = (l) => ({ id: l.id, name: l.name, plan: l.plan, weight: l.weight, moves: l.moves, source: l.source, engineCheck: l.engineCheck });
const metaOf = (b) => ({ id: b.id, name: b.name, group: b.group, kind: b.kind, sides: b.sides, summary: b.summary, source: b.source, startFen: b.startFen, definingPlies: b.definingPlies });

/** Gắn kết quả "Kiểm tra bằng engine" làm trong app vào verification của biến */
function applyEngineCheck(line, check) {
  if (!check) { line.verification.engine = 'chưa kiểm định'; return; }
  line.verification.engine = check.status;
  line.verification.engineFlags = check.flagged || [];
  line.verification.engineFinal = check.final;
  line.verification.engineLoss = check.losses || [];
  line.verification.engineNote = check.note || '';
}

/**
 * baseSerialized: mảng khai cuộc dạng JSON (như trong openings.built.json)
 * Trả về mảng khai cuộc đã dựng cây, kèm cờ line.userEdited / line.userAdded, op.custom
 */
export function applyEdits(baseSerialized, editsRaw) {
  const edits = normalizeEdits(editsRaw);
  const out = [];
  for (const b of baseSerialized) {
    const le = edits.lines[b.id] || {};
    const add = edits.added[b.id] || [];
    if (!Object.keys(le).length && !add.length) { out.push(deserializeOpening(b)); continue; }
    const srcLines = [];
    for (const l of b.lines) {
      const e = le[l.id];
      if (e?.deleted) continue;
      srcLines.push(e ? { ...rawLine(l), ...e, userEdited: true } : rawLine(l));
    }
    for (const a of add) srcLines.push({ ...a, userAdded: true });
    const op = buildOpening({ ...metaOf(b), lines: srcLines });
    op.lines.forEach((l, i) => {
      const src = srcLines[i];
      l.userEdited = !!src.userEdited; l.userAdded = !!src.userAdded;
      const old = b.lines.find((x) => x.id === l.id);
      if (!src.userEdited && !src.userAdded && old) l.verification = old.verification; // biến gốc giữ kết quả kiểm định
      else applyEngineCheck(l, src.engineCheck);
    });
    op.hasEdits = true;
    out.push(op);
  }
  for (const c of edits.custom) {
    if (!c.lines?.length) continue;
    const op = buildOpening({ ...c, custom: true, kind: 'theory', group: c.group || 'Khai cuộc của tôi' });
    op.custom = true;
    op.lines.forEach((l, i) => { l.userAdded = true; applyEngineCheck(l, c.lines[i].engineCheck); });
    out.push(op);
  }
  return out;
}

/** Ghi một biến đã sửa / thêm vào edits. Trả về edits mới (không sửa đối tượng cũ) */
export function saveLine(editsRaw, op, lineId, data, asNew = false) {
  const e = JSON.parse(JSON.stringify(normalizeEdits(editsRaw)));
  const id = asNew || !lineId ? 'u' + Date.now().toString(36) : lineId;
  const rec = { id, name: data.name, plan: data.plan || '', moves: data.moves, weight: data.weight ?? 1, engineCheck: data.engineCheck || null, source: data.source || 'Anh Thắng soạn trong app' };
  if (op.custom) {
    let c = e.custom.find((x) => x.id === op.id);
    if (!c) { c = { id: op.id, name: op.name, group: op.group || 'Khai cuộc của tôi', sides: op.sides, summary: op.summary || '', source: 'Khai cuộc anh Thắng tự tạo', startFen: op.startFen, lines: [] }; e.custom.push(c); }
    const i = c.lines.findIndex((l) => l.id === id);
    if (i >= 0) c.lines[i] = rec; else c.lines.push(rec);
    return { edits: e, id };
  }
  const added = (e.added[op.id] = e.added[op.id] || []);
  const ai = added.findIndex((l) => l.id === id);
  if (ai >= 0) added[ai] = rec;
  else if (!asNew && lineId && !lineId.startsWith('u')) {
    (e.lines[op.id] = e.lines[op.id] || {})[id] = { name: rec.name, plan: rec.plan, moves: rec.moves, engineCheck: rec.engineCheck, source: 'Anh Thắng sửa trong app (gốc: ' + (data.originalSource || 'dữ liệu app') + ')' };
  } else added.push(rec);
  return { edits: e, id };
}

/** Xóa một biến (biến gốc: ẩn đi; biến tự thêm: xóa hẳn) */
export function deleteLine(editsRaw, op, lineId) {
  const e = JSON.parse(JSON.stringify(normalizeEdits(editsRaw)));
  if (op.custom) {
    const c = e.custom.find((x) => x.id === op.id);
    if (c) c.lines = c.lines.filter((l) => l.id !== lineId);
    e.custom = e.custom.filter((x) => x.lines.length);
    return e;
  }
  if (e.added[op.id]?.some((l) => l.id === lineId)) e.added[op.id] = e.added[op.id].filter((l) => l.id !== lineId);
  else (e.lines[op.id] = e.lines[op.id] || {})[lineId] = { deleted: true };
  return e;
}

/** Bỏ mọi chỉnh sửa của một khai cuộc gốc (hoặc xóa khai cuộc tự tạo) */
export function resetOpening(editsRaw, op) {
  const e = JSON.parse(JSON.stringify(normalizeEdits(editsRaw)));
  if (op.custom) e.custom = e.custom.filter((x) => x.id !== op.id);
  else { delete e.lines[op.id]; delete e.added[op.id]; }
  return e;
}
