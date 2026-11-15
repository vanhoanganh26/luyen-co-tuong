// =====================================================================
// PHÂN TÍCH Ý NGHĨA NƯỚC ĐI (tự động, chỉ dựa trên luật & hình cờ — không cần engine)
// Với mỗi nước, tìm ra các "dấu hiệu" kiểm chứng được trên bàn cờ:
//   ăn quân, chiếu, ra quân, tranh trung lộ, tạo đe dọa, bảo vệ / tránh đòn / chặn,
//   mở đường cho quân khác, củng cố cung, xe tuần hà / qua hà, tốt qua sông…
// Kết quả dùng cho: chú thích "Vì sao?", câu hỏi "Đoán ý đồ", bài học tư duy.
// Phần "nếu không đi thì sao" cần engine — xem tools/build-insights.mjs.
// =====================================================================
import { Position, START_FEN, RED, BLACK, rowOf, colOf, sq, colorOf, typeOf, opposite, inPalace } from '../core/xiangqi.js';
import { fileNumber } from '../core/notation.js';

export const VALUE = { r: 9, c: 4.5, n: 4, b: 2, a: 2, p: 1, k: 100 };
export const NAME = { r: 'xe', c: 'pháo', n: 'mã', b: 'tượng', a: 'sĩ', p: 'tốt', k: 'tướng' };

/** Các nhóm mục đích (dùng cho câu hỏi trắc nghiệm) */
export const PURPOSES = {
  an: 'Ăn quân / đổi quân',
  tancong: 'Tấn công, tạo đe dọa',
  phongthu: 'Phòng thủ: bảo vệ, tránh đòn, chặn đường',
  trunglo: 'Tranh giành trung lộ',
  raquan: 'Ra quân (phát triển quân)',
  modung: 'Mở đường cho quân khác',
  cungco: 'Củng cố cung tướng',
  hoatdong: 'Đưa quân tới vị trí hoạt động hơn',
};
// Thứ tự ưu tiên khi chọn "mục đích chính"
const PRIORITY = ['an', 'tancong', 'phongthu', 'trunglo', 'raquan', 'modung', 'cungco', 'hoatdong'];
// Đe dọa nhỏ (chỉ nhắm một con tốt) xếp sau ra quân / trung lộ khi chọn mục đích chính
const MAIN_ORDER = ['an', 'tancong', 'phongthu', 'trunglo', 'raquan', 'tancong-nho', 'modung', 'cungco', 'hoatdong'];

const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const crossed = (r, color) => (color === RED ? r <= 4 : r >= 5);
const ownSide = (r, color) => !crossed(r, color);
const START_BOARD = new Position(START_FEN).board;

/** Giá trị quân (tốt qua sông tính 2) */
export function valueAt(board, s) {
  const p = board[s];
  if (!p) return 0;
  const t = typeOf(p);
  return t === 'p' && crossed(rowOf(s), colorOf(p)) ? 2 : VALUE[t];
}

/** Tên quân kèm cột theo cách đếm của bên đó, VD "mã 3", "pháo 8 Đen" */
export function label(board, s, viewer = null) {
  const p = board[s], color = colorOf(p);
  const name = NAME[typeOf(p)] + ' ' + fileNumber(colOf(s), color);
  return viewer && viewer !== color ? name + (color === RED ? ' Đỏ' : ' Đen') : name;
}

/** Các ô mà quân ở ô s "khống chế" (ăn được nếu là quân địch / bảo vệ nếu là quân mình) */
export function attacksFrom(board, s) {
  const p = board[s];
  if (!p) return [];
  const color = colorOf(p), r = rowOf(s), c = colOf(s), out = [];
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  switch (typeOf(p)) {
    case 'r':
      for (const [dr, dc] of ORTH) {
        let rr = r + dr, cc = c + dc;
        while (inBoard(rr, cc)) { out.push(sq(rr, cc)); if (board[sq(rr, cc)]) break; rr += dr; cc += dc; }
      }
      break;
    case 'c':
      for (const [dr, dc] of ORTH) {
        let rr = r + dr, cc = c + dc, screen = false;
        while (inBoard(rr, cc)) {
          if (board[sq(rr, cc)]) { if (screen) { out.push(sq(rr, cc)); break; } screen = true; }
          rr += dr; cc += dc;
        }
      }
      break;
    case 'n':
      for (const [dr, dc] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]) {
        const rr = r + dr, cc = c + dc;
        if (!inBoard(rr, cc)) continue;
        const lr = r + (Math.abs(dr) === 2 ? dr / 2 : 0), lc = c + (Math.abs(dc) === 2 ? dc / 2 : 0);
        if (!board[sq(lr, lc)]) out.push(sq(rr, cc));
      }
      break;
    case 'b':
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const rr = r + 2 * dr, cc = c + 2 * dc;
        if (inBoard(rr, cc) && ownSide(rr, color) && !board[sq(r + dr, c + dc)]) out.push(sq(rr, cc));
      }
      break;
    case 'a':
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (inPalace(r + dr, c + dc, color)) out.push(sq(r + dr, c + dc));
      break;
    case 'k':
      for (const [dr, dc] of ORTH) if (inPalace(r + dr, c + dc, color)) out.push(sq(r + dr, c + dc));
      break;
    case 'p': {
      const f = color === RED ? -1 : 1;
      if (inBoard(r + f, c)) out.push(sq(r + f, c));
      if (crossed(r, color)) { if (c > 0) out.push(sq(r, c - 1)); if (c < 8) out.push(sq(r, c + 1)); }
      break;
    }
  }
  return out;
}

/** Các ô có quân màu `color` khống chế ô t */
export function attackersOf(board, t, color) {
  const out = [];
  for (let s = 0; s < 90; s++) if (board[s] && colorOf(board[s]) === color && attacksFrom(board, s).includes(t)) out.push(s);
  return out;
}

/** Quân ở ô s có đang gặp nguy không (bị dọa ăn mà bảo vệ không đủ) */
export function isEndangered(board, s) {
  const p = board[s];
  if (!p || typeOf(p) === 'k') return false;
  const color = colorOf(p);
  const att = attackersOf(board, s, opposite(color));
  if (!att.length) return false;
  const def = attackersOf(board, s, color);
  if (!def.length) return true;
  return Math.min(...att.map((a) => valueAt(board, a))) < valueAt(board, s);
}

/** Số ô đi được (thô) của quân ở ô s — đo độ hoạt động */
export function mobility(pos, s) {
  const p = pos.board[s];
  if (!p) return 0;
  return pos.pseudoMoves(colorOf(p)).filter((m) => m.from === s).length;
}

/**
 * Phân tích một nước đi.
 * @param {string} fen   thế cờ trước nước đi
 * @param {{from,to}} m  nước đi (đã hợp lệ)
 * @returns {{ tags:[{cat,text}], main, cats:[], text }}
 */
export function analyzeMove(fen, m) {
  const before = new Position(fen);
  const B = before.board;
  const piece = B[m.from], color = colorOf(piece), enemy = opposite(color), t = typeOf(piece);
  const after = before.clone();
  const rec = after.makeMove(m);
  const A = after.board;
  const toR = rowOf(m.to), toC = colOf(m.to), fromR = rowOf(m.from);
  const me = label(B, m.from);
  const tags = [];
  const add = (cat, text, minor = false) => { if (!tags.some((x) => x.text === text)) tags.push({ cat, text, minor }); };

  // 1) Ăn quân / đổi quân
  if (rec.captured) {
    const capName = NAME[typeOf(rec.captured)];
    const recapture = attackersOf(A, m.to, enemy).length > 0;
    const cv = VALUE[typeOf(rec.captured)], mv = VALUE[t];
    if (!recapture) add('an', `Ăn ${capName} (đối phương không ăn lại được)`);
    else if (cv > mv + 0.5) add('an', `Ăn ${capName} — dù bị ăn lại vẫn lời quân (${capName} giá trị hơn ${NAME[t]})`);
    else if (cv >= mv - 0.5) add('an', `Đổi quân: ${me} ăn ${capName}, đối phương có thể ăn lại`);
    else add('an', `Ăn ${capName}, chấp nhận để đối phương ăn lại ${NAME[t]}`);
  }
  // 2) Chiếu
  if (rec.check) add('tancong', 'Chiếu tướng, buộc đối phương phải đỡ');

  // 3) Ra quân: quân rời vị trí xuất phát lần đầu (chỉ xét khi thế bắt đầu là thế chuẩn)
  const fromStart = START_BOARD[m.from] === piece;
  if (fromStart && 'rnc'.includes(t) && !rec.captured) {
    if (t === 'r') add('raquan', 'Ra xe sớm — xe là quân mạnh nhất, càng sớm tham chiến càng tốt');
    if (t === 'n') add('raquan', 'Lên mã, đưa quân vào trận');
    if (t === 'c' && toC !== 4) add('raquan', 'Đưa pháo vào vị trí tác chiến');
  }

  // 4) Trung lộ
  if (t === 'c' && toC === 4 && colOf(m.from) !== 4) add('trunglo', 'Pháo vào trung lộ (pháo đầu): nhắm tốt giữa và cột tướng');
  const centerSquares = [];
  for (let r = 0; r < 10; r++) { const s = sq(r, 4); if (A[s] && typeOf(A[s]) === 'p') centerSquares.push(s); }
  for (const s of centerSquares) {
    const own = colorOf(A[s]) === color;
    const nowCover = attacksFrom(A, m.to).includes(s), wasCover = B[m.from] && attacksFrom(B, m.from).includes(s);
    if (nowCover && !wasCover && !(t === 'c' && toC === 4 && !own)) add('trunglo', own ? 'Bảo vệ tốt giữa của mình' : 'Nhắm vào tốt giữa của đối phương');
  }
  if (t === 'n' && toC >= 3 && toC <= 5 && (color === RED ? toR < fromR : toR > fromR) && !fromStart) add('trunglo', 'Mã tiến vào khu trung tâm');

  // 5) Đe dọa mới (cả đe dọa trực tiếp và đe dọa "mở" nhờ quân khác)
  const threatened = (board, col) => {
    const set = new Map();
    for (let s = 0; s < 90; s++) {
      if (!board[s] || colorOf(board[s]) !== col) continue;
      for (const x of attacksFrom(board, s)) if (board[x] && colorOf(board[x]) !== col && typeOf(board[x]) !== 'k') {
        if (!set.has(x)) set.set(x, []);
        set.get(x).push(s);
      }
    }
    return set;
  };
  const thrB = threatened(B, color), thrA = threatened(A, color);
  for (const [x, who] of thrA) {
    if (thrB.has(x) && thrB.get(x).length >= who.length) continue;
    // Đáng gọi là đe dọa: quân bị nhắm không được bảo vệ, hoặc có giá trị cao hơn quân nhắm
    const defended = attackersOf(A, x, enemy).length > 0;
    const minAtt = Math.min(...who.map((s) => valueAt(A, s)));
    if (!defended || valueAt(A, x) > minAtt + 0.5) {
      const by = who.includes(m.to) ? '' : ` (nhờ ${label(A, who[0])} được mở đường)`;
      const isPawn = typeOf(A[x]) === 'p';
      if (isPawn && colOf(x) === 4 && tags.some((g) => g.cat === 'trunglo')) continue; // đã nói "nhắm tốt giữa"
      add('tancong', `Đe dọa ăn ${label(A, x, color)}${by}`, isPawn);
    }
  }

  // 6) Phòng thủ: tránh đòn, chặn đường, bảo vệ quân đang bị nhắm
  if (isEndangered(B, m.from) && !rec.captured) add('phongthu', `Tránh đòn: ${me} đang bị dọa ăn`);
  for (let s = 0; s < 90; s++) {
    if (s === m.to || !A[s] || colorOf(A[s]) !== color) continue;
    const s0 = s; // quân không di chuyển nên ô trước = ô sau
    if (isEndangered(B, s0) && !isEndangered(A, s)) {
      if (rec.captured && attackersOf(B, s0, enemy).includes(m.to)) { add('phongthu', `Ăn luôn quân đang dọa ${label(A, s)}`); continue; }
      const viaBlock = attackersOf(A, s, enemy).length < attackersOf(B, s0, enemy).length;
      add('phongthu', viaBlock ? `Chặn đường tấn công vào ${label(A, s)}` : `Bảo vệ ${label(A, s)} đang bị dọa`);
    }
  }
  if (before.inCheck(color)) add('phongthu', 'Đỡ chiếu');

  // 7) Mở đường cho quân khác (độ hoạt động tăng rõ)
  for (let s = 0; s < 90; s++) {
    if (s === m.to || !A[s] || colorOf(A[s]) !== color || !'rnc'.includes(typeOf(A[s]))) continue;
    const gain = mobility(after, s) - mobility(before, s);
    if (gain >= 2) add('modung', `Mở đường cho ${label(A, s)} (thêm ${gain} ô đi)`);
  }

  // 8) Củng cố cung
  if ((t === 'a' || t === 'b') && !rec.captured) add('cungco', t === 'a' ? 'Lên sĩ củng cố cung tướng' : 'Lên tượng, liên kết phòng thủ cung');
  if (t === 'k') add('cungco', 'Điều chỉnh vị trí tướng cho an toàn');

  // 9) Hoạt động: xe tuần hà / qua hà, tốt qua sông, quân tăng mạnh số ô đi
  if (t === 'r') {
    const bank = color === RED ? 5 : 4;
    if (toR === bank && rowOf(m.from) !== bank) add('hoatdong', 'Xe tuần hà: đứng ở bờ sông, khống chế cả hàng ngang');
    else if (crossed(toR, color) && !crossed(fromR, color)) add('hoatdong', 'Xe qua hà, xâm nhập trận địa đối phương');
  }
  if (t === 'p' && crossed(toR, color) && !crossed(fromR, color)) add('hoatdong', 'Tốt qua sông: được đi ngang, sức tấn công tăng gấp đôi');
  if (t === 'p' && colOf(m.from) === 4 && !rec.captured) add('trunglo', 'Tiến tốt giữa: tranh không gian trung lộ, mở đường cho pháo / mã giữa');
  if (t === 'p' && !crossed(toR, color) && colOf(m.from) !== 4) {
    // tốt 3/7 tiến thường để thông chân mã — đã được bắt ở mục 7; ở đây ghi thêm nếu chặn tốt địch
    const ahead = sq(toR + (color === RED ? -1 : 1), toC);
    if (inBoard(rowOf(ahead), toC) && A[ahead] && typeOf(A[ahead]) === 'p' && colorOf(A[ahead]) === enemy) add('hoatdong', 'Tốt đối đầu tốt địch, giành không gian');
  }
  const mobGain = mobility(after, m.to) - mobility(before, m.from);
  if (!tags.length && mobGain >= 3) add('hoatdong', `${me[0].toUpperCase() + me.slice(1)} chuyển tới vị trí hoạt động hơn (thêm ${mobGain} ô đi)`);
  if (!tags.length) add('hoatdong', 'Điều chỉnh thế trận, chờ thời cơ');

  // Bỏ câu trùng ý: đã "bảo vệ tốt 5 đang bị dọa" thì không cần "bảo vệ tốt giữa"
  if (tags.some((g) => g.cat === 'phongthu' && /tốt 5\b/.test(g.text))) {
    const i = tags.findIndex((g) => g.text === 'Bảo vệ tốt giữa của mình');
    if (i >= 0) tags.splice(i, 1);
  }
  const cats = [...new Set(tags.map((x) => x.cat))];
  const key = (g) => (g.cat === 'tancong' && g.minor ? 'tancong-nho' : g.cat);
  const keys = tags.map(key);
  const main = (MAIN_ORDER.find((k) => keys.includes(k)) || 'hoatdong').replace('-nho', '');
  tags.sort((a, b) => PRIORITY.indexOf(a.cat) - PRIORITY.indexOf(b.cat));
  return { tags, cats, main, text: tags.map((x) => x.text).join('. ') + '.' };
}

/**
 * Câu hỏi "Đoán ý đồ": 1 đáp án đúng (mục đích chính) + 3 đáp án nhiễu không thuộc nước này.
 * rnd: hàm ngẫu nhiên [0,1) (để test cố định được)
 */
export function purposeQuiz(insight, rnd = Math.random) {
  const wrong = Object.keys(PURPOSES).filter((c) => !insight.cats.includes(c));
  for (let i = wrong.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [wrong[i], wrong[j]] = [wrong[j], wrong[i]]; }
  const options = [insight.main, ...wrong.slice(0, 3)];
  for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
  return { options: options.map((c) => ({ cat: c, text: PURPOSES[c] })), answer: insight.main, alsoTrue: insight.cats };
}

