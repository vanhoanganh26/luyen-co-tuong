// =====================================================================
// LÕI LUẬT CỜ TƯỚNG
// - Bàn cờ 9 cột x 10 hàng, lưu trong mảng 90 ô: sq = hàng * 9 + cột
// - Hàng 0 ở trên cùng (phía Đen), hàng 9 ở dưới cùng (phía Đỏ)
// - Cột 0 = cột "a" (bên trái nhìn từ phía Đỏ), cột 8 = cột "i"
// - Quân cờ dùng chữ FEN: Đỏ viết HOA, Đen viết thường
//   k = tướng, a = sĩ, b = tượng, n = mã, r = xe, c = pháo, p = tốt
// Module này không phụ thuộc trình duyệt => chạy được cả trong Node (test)
// =====================================================================

export const RED = 'r';
export const BLACK = 'b';
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export const ROWS = 10;
export const COLS = 9;

export const sq = (r, c) => r * 9 + c;
export const rowOf = (s) => (s / 9) | 0;
export const colOf = (s) => s % 9;
const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;

/** Màu của quân: 'r' (Đỏ), 'b' (Đen) hoặc null nếu ô trống */
export function colorOf(p) {
  if (!p) return null;
  return p === p.toUpperCase() ? RED : BLACK;
}
/** Loại quân (chữ thường): k a b n r c p */
export const typeOf = (p) => p.toLowerCase();
export const opposite = (color) => (color === RED ? BLACK : RED);

/** Ô (r,c) có nằm trong cung của bên `color` không */
export function inPalace(r, c, color) {
  if (c < 3 || c > 5 || r < 0 || r > 9) return false;
  return color === RED ? r >= 7 : r <= 2;
}
/** Ô hàng r có thuộc nửa sân của bên `color` không (Đỏ: hàng 5–9) */
export const ownSide = (r, color) => (color === RED ? r >= 5 : r <= 4);

// Các hướng đi
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
// Mã: [dr, dc, chânR, chânC] — "chân mã" là ô kề theo hướng đi dài
const HORSE = [
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
  [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
];

/** Chuyển ký tự FEN (chấp nhận cả h = mã, e = tượng) về dạng chuẩn */
function normalizePieceChar(ch) {
  const map = { h: 'n', e: 'b', H: 'N', E: 'B' };
  return map[ch] || ch;
}
const VALID = new Set('kabnrcpKABNRCP'.split(''));

export class Position {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  // ------------------------------------------------------------------
  // FEN
  // ------------------------------------------------------------------
  /** Nạp thế cờ từ FEN cờ tướng (UCCI/WXF). Ném lỗi nếu FEN sai. */
  load(fen) {
    const parts = String(fen).trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== 10) throw new Error('FEN phải có 10 hàng');
    const board = new Array(90).fill(null);
    rows.forEach((row, r) => {
      let c = 0;
      for (const raw of row) {
        if (/[1-9]/.test(raw)) { c += Number(raw); continue; }
        const ch = normalizePieceChar(raw);
        if (!VALID.has(ch)) throw new Error(`Ký tự quân không hợp lệ: "${raw}"`);
        if (c > 8) throw new Error(`Hàng ${r + 1} quá 9 cột`);
        board[sq(r, c)] = ch;
        c++;
      }
      if (c !== 9) throw new Error(`Hàng ${r + 1} phải đủ 9 cột (đang là ${c})`);
    });
    const side = (parts[1] || 'w').toLowerCase();
    this.board = board;
    this.turn = side === 'b' ? BLACK : RED; // 'w' hoặc 'r' = Đỏ đi
    this.halfmove = Number(parts[4]) || 0;
    this.fullmove = Number(parts[5]) || 1;
    this.validate();
    this.history = [];          // ngăn xếp để lùi nước
    this.keys = [this.key()];   // lịch sử thế cờ để phát hiện lặp
  }

  /** Kiểm tra thế cờ có hợp lệ cơ bản (đủ tướng, quân đứng đúng vùng) */
  validate() {
    let rk = 0, bk = 0;
    for (let s = 0; s < 90; s++) {
      const p = this.board[s];
      if (!p) continue;
      const r = rowOf(s), c = colOf(s), col = colorOf(p), t = typeOf(p);
      if (t === 'k') { col === RED ? rk++ : bk++; }
      if ((t === 'k' || t === 'a') && !inPalace(r, c, col))
        throw new Error(`${t === 'k' ? 'Tướng' : 'Sĩ'} đứng ngoài cung`);
      if (t === 'b' && !ownSide(r, col)) throw new Error('Tượng không được qua sông');
    }
    if (rk !== 1 || bk !== 1) throw new Error('Mỗi bên phải có đúng 1 tướng');
  }

  /** Xuất FEN của thế cờ hiện tại */
  fen() {
    const rows = [];
    for (let r = 0; r < 10; r++) {
      let s = '', empty = 0;
      for (let c = 0; c < 9; c++) {
        const p = this.board[sq(r, c)];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p;
      }
      if (empty) s += empty;
      rows.push(s);
    }
    return `${rows.join('/')} ${this.turn === RED ? 'w' : 'b'} - - ${this.halfmove} ${this.fullmove}`;
  }

  /** Khóa thế cờ (bàn + lượt đi) dùng để so lặp thế */
  key() {
    let k = '';
    for (let i = 0; i < 90; i++) k += this.board[i] || '.';
    return k + this.turn;
  }

  clone() {
    const p = Object.create(Position.prototype);
    p.board = this.board.slice();
    p.turn = this.turn;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.history = this.history.slice();
    p.keys = this.keys.slice();
    return p;
  }

  kingSq(color) {
    const k = color === RED ? 'K' : 'k';
    // Tướng chỉ ở trong cung -> chỉ cần dò 9 ô
    const rows = color === RED ? [7, 8, 9] : [0, 1, 2];
    for (const r of rows) for (let c = 3; c <= 5; c++) if (this.board[sq(r, c)] === k) return sq(r, c);
    return -1;
  }

  // ------------------------------------------------------------------
  // KIỂM TRA BỊ TẤN CÔNG / CHIẾU
  // ------------------------------------------------------------------
  /**
   * Ô `t` có bị bên `by` tấn công không.
   * Dùng cho ô tướng: gồm cả luật "tướng không đối mặt" (tướng địch chiếu theo cột).
   */
  isAttacked(t, by) {
    const b = this.board;
    const r = rowOf(t), c = colOf(t);
    const R = by === RED ? 'R' : 'r', C = by === RED ? 'C' : 'c', K = by === RED ? 'K' : 'k';
    const N = by === RED ? 'N' : 'n', P = by === RED ? 'P' : 'p';

    // 1) Đường thẳng: xe, tướng đối mặt (chỉ theo cột), pháo (qua đúng 1 ngòi)
    for (const [dr, dc] of ORTH) {
      let rr = r + dr, cc = c + dc, screen = false;
      while (inBoard(rr, cc)) {
        const p = b[sq(rr, cc)];
        if (p) {
          if (!screen) {
            if (p === R || (p === K && dc === 0)) return true;
            screen = true;
          } else {
            if (p === C) return true;
            break;
          }
        }
        rr += dr; cc += dc;
      }
    }
    // 2) Mã: dò ngược từ ô bị tấn công về vị trí mã; chân mã tính theo phía con mã
    for (const [dr, dc] of HORSE) {
      const hr = r - dr, hc = c - dc;
      if (!inBoard(hr, hc) || b[sq(hr, hc)] !== N) continue;
      const lr = hr + (Math.abs(dr) === 2 ? dr / 2 : 0);
      const lc = hc + (Math.abs(dc) === 2 ? dc / 2 : 0);
      if (!b[sq(lr, lc)]) return true;
    }
    // 3) Tốt
    if (by === RED) {
      if (inBoard(r + 1, c) && b[sq(r + 1, c)] === P) return true; // tốt Đỏ đi lên (hàng giảm)
      if (r <= 4) { // tốt Đỏ đã qua sông mới ăn ngang
        if (c > 0 && b[sq(r, c - 1)] === P) return true;
        if (c < 8 && b[sq(r, c + 1)] === P) return true;
      }
    } else {
      if (inBoard(r - 1, c) && b[sq(r - 1, c)] === P) return true;
      if (r >= 5) {
        if (c > 0 && b[sq(r, c - 1)] === P) return true;
        if (c < 8 && b[sq(r, c + 1)] === P) return true;
      }
    }
    // Sĩ, tượng không thể chiếu tướng đối phương (bị giới hạn vùng) => bỏ qua
    return false;
  }

  /** Bên `color` có đang bị chiếu không (gồm cả lộ mặt tướng) */
  inCheck(color = this.turn) {
    return this.isAttacked(this.kingSq(color), opposite(color));
  }

  // ------------------------------------------------------------------
  // SINH NƯỚC ĐI
  // ------------------------------------------------------------------
  /** Sinh nước "giả hợp lệ" (chưa xét tướng bị chiếu) cho bên `color` */
  pseudoMoves(color = this.turn) {
    const b = this.board, moves = [];
    const add = (from, r, c) => {
      const to = sq(r, c), q = b[to];
      if (!q || colorOf(q) !== color) moves.push({ from, to });
    };
    for (let s = 0; s < 90; s++) {
      const p = b[s];
      if (!p || colorOf(p) !== color) continue;
      const r = rowOf(s), c = colOf(s);
      switch (typeOf(p)) {
        case 'k': // Tướng: 1 bước ngang/dọc trong cung
          for (const [dr, dc] of ORTH) if (inPalace(r + dr, c + dc, color)) add(s, r + dr, c + dc);
          break;
        case 'a': // Sĩ: 1 bước chéo trong cung
          for (const [dr, dc] of DIAG) if (inPalace(r + dr, c + dc, color)) add(s, r + dr, c + dc);
          break;
        case 'b': // Tượng: 2 bước chéo, không bị chặn mắt, không qua sông
          for (const [dr, dc] of DIAG) {
            const rr = r + 2 * dr, cc = c + 2 * dc;
            if (!inBoard(rr, cc) || !ownSide(rr, color)) continue;
            if (b[sq(r + dr, c + dc)]) continue; // mắt tượng bị chặn
            add(s, rr, cc);
          }
          break;
        case 'n': // Mã: hình chữ "nhật", bị cản chân
          for (const [dr, dc, lr, lc] of HORSE) {
            const rr = r + dr, cc = c + dc;
            if (!inBoard(rr, cc)) continue;
            if (b[sq(r + lr, c + lc)]) continue; // cản chân mã
            add(s, rr, cc);
          }
          break;
        case 'r': // Xe: đi thẳng không giới hạn
          for (const [dr, dc] of ORTH) {
            let rr = r + dr, cc = c + dc;
            while (inBoard(rr, cc)) {
              const q = b[sq(rr, cc)];
              if (!q) moves.push({ from: s, to: sq(rr, cc) });
              else { if (colorOf(q) !== color) moves.push({ from: s, to: sq(rr, cc) }); break; }
              rr += dr; cc += dc;
            }
          }
          break;
        case 'c': // Pháo: đi như xe, ăn quân phải nhảy qua đúng 1 ngòi
          for (const [dr, dc] of ORTH) {
            let rr = r + dr, cc = c + dc, screen = false;
            while (inBoard(rr, cc)) {
              const q = b[sq(rr, cc)];
              if (!screen) {
                if (!q) moves.push({ from: s, to: sq(rr, cc) });
                else screen = true;
              } else if (q) {
                if (colorOf(q) !== color) moves.push({ from: s, to: sq(rr, cc) });
                break;
              }
              rr += dr; cc += dc;
            }
          }
          break;
        case 'p': { // Tốt: tiến 1; qua sông mới được đi ngang; không lùi
          const fwd = color === RED ? -1 : 1;
          if (inBoard(r + fwd, c)) add(s, r + fwd, c);
          if (!ownSide(r, color)) {
            if (c > 0) add(s, r, c - 1);
            if (c < 8) add(s, r, c + 1);
          }
          break;
        }
      }
    }
    return moves;
  }

  // Đi/hoàn nước "nhẹ", chỉ dùng nội bộ khi kiểm tra hợp lệ
  _do(m) {
    const cap = this.board[m.to];
    this.board[m.to] = this.board[m.from];
    this.board[m.from] = null;
    return cap;
  }
  _undo(m, cap) {
    this.board[m.from] = this.board[m.to];
    this.board[m.to] = cap;
  }

  /** Nước giả hợp lệ `m` có hợp lệ thật không (không để tướng mình bị chiếu/lộ mặt) */
  _safe(m, color) {
    const cap = this._do(m);
    const ok = !this.isAttacked(this.kingSq(color), opposite(color));
    this._undo(m, cap);
    return ok;
  }

  /** Danh sách nước hợp lệ của bên đang đi (hoặc chỉ của quân ở ô `from`) */
  legalMoves(from = null) {
    const color = this.turn;
    let ms = this.pseudoMoves(color);
    if (from !== null) ms = ms.filter((m) => m.from === from);
    return ms.filter((m) => this._safe(m, color));
  }

  hasLegalMove() {
    const color = this.turn;
    for (const m of this.pseudoMoves(color)) if (this._safe(m, color)) return true;
    return false;
  }

  isLegal(m) {
    return this.legalMoves(m.from).some((x) => x.to === m.to);
  }

  // ------------------------------------------------------------------
  // ĐI QUÂN / LÙI QUÂN
  // ------------------------------------------------------------------
  /** Đi nước m (giả định đã hợp lệ). Trả về bản ghi nước đi. */
  makeMove(m) {
    const piece = this.board[m.from];
    const captured = this._do(m);
    const rec = {
      from: m.from, to: m.to, piece, captured,
      prevHalf: this.halfmove, prevFull: this.fullmove,
    };
    this.halfmove = captured ? 0 : this.halfmove + 1;
    if (this.turn === BLACK) this.fullmove++;
    this.turn = opposite(this.turn);
    rec.check = this.inCheck(this.turn); // nước này có chiếu không
    this.history.push(rec);
    this.keys.push(this.key());
    return rec;
  }

  /** Lùi 1 nước */
  undo() {
    const rec = this.history.pop();
    if (!rec) return null;
    this.keys.pop();
    this.turn = opposite(this.turn);
    this._undo(rec, rec.captured);
    this.halfmove = rec.prevHalf;
    this.fullmove = rec.prevFull;
    return rec;
  }

  // ------------------------------------------------------------------
  // TRẠNG THÁI VÁN
  // ------------------------------------------------------------------
  /** Số lần thế hiện tại đã xuất hiện (tính cả lần này) */
  repetitionCount() {
    const k = this.keys[this.keys.length - 1];
    let n = 0;
    for (const x of this.keys) if (x === k) n++;
    return n;
  }

  /**
   * Phân tích chu kỳ lặp: trong đoạn từ lần xuất hiện trước của thế hiện tại đến nay,
   * bên nào nước nào cũng chiếu => "chiếu mãi" (bản đơn giản hóa).
   * Trả về 'r' | 'b' | null (bên chiếu mãi).
   */
  perpetualChecker() {
    const k = this.keys[this.keys.length - 1];
    let start = -1;
    for (let i = this.keys.length - 2; i >= 0; i--) if (this.keys[i] === k) { start = i; break; }
    if (start < 0) return null;
    // Nước thứ i trong history dẫn từ keys[i] sang keys[i+1]
    const seg = this.history.slice(start);
    const bySide = { r: [], b: [] };
    for (const rec of seg) bySide[colorOf(rec.piece)].push(rec.check);
    const allCheck = (arr) => arr.length > 0 && arr.every(Boolean);
    const rc = allCheck(bySide.r), bc = allCheck(bySide.b);
    if (rc && !bc) return RED;
    if (bc && !rc) return BLACK;
    return null; // cả hai cùng chiếu mãi hoặc không ai => coi như lặp thông thường
  }

  /**
   * Trạng thái ván:
   * { over, winner: 'r'|'b'|null, reason, inCheck, repetition, perpetual }
   * - Hết nước đi: bên đang đi THUA (dù bị chiếu bí hay bị "khốn" không còn nước).
   * - Lặp thế >= 3 lần: tùy chọn repetitionRule = 'warn' (chỉ cảnh báo) | 'draw' (xử hòa).
   */
  status({ repetitionRule = 'warn' } = {}) {
    const check = this.inCheck();
    const res = { over: false, winner: null, reason: null, inCheck: check, repetition: this.repetitionCount(), perpetual: null };
    if (!this.hasLegalMove()) {
      res.over = true;
      res.winner = opposite(this.turn);
      res.reason = check ? 'checkmate' : 'stalemate';
      return res;
    }
    if (res.repetition >= 3) {
      res.perpetual = this.perpetualChecker();
      if (repetitionRule === 'draw') {
        res.over = true;
        res.reason = 'repetition';
      }
    }
    return res;
  }
}

// ---------------------------------------------------------------------
// Tọa độ dạng chữ: ICCS (hàng 0–9 từ dưới lên, VD "h2e2")
// và UCI của Fairy-Stockfish (hàng 1–10, VD "h3e3")
// ---------------------------------------------------------------------
const FILES = 'abcdefghi';
export function squareName(s, base = 0) {
  return FILES[colOf(s)] + (9 - rowOf(s) + base);
}
export function moveToICCS(m) { return squareName(m.from) + squareName(m.to); }
export function moveToUCI(m) { return squareName(m.from, 1) + squareName(m.to, 1); }

function parseSquare(str, base) {
  const m = /^([a-i])(\d{1,2})$/.exec(str);
  if (!m) return -1;
  const rank = Number(m[2]) - base;
  if (rank < 0 || rank > 9) return -1;
  return sq(9 - rank, FILES.indexOf(m[1]));
}
/** Đọc nước dạng tọa độ. base = 0 (ICCS) hoặc 1 (UCI) */
export function parseCoordMove(str, base = 0) {
  const m = /^([a-i]\d{1,2})([a-i]\d{1,2})$/.exec(String(str).trim().toLowerCase());
  if (!m) return null;
  const from = parseSquare(m[1], base), to = parseSquare(m[2], base);
  if (from < 0 || to < 0) return null;
  return { from, to };
}

/** Perft: đếm số nút ở độ sâu `depth` — công cụ chuẩn để kiểm tra bộ sinh nước */
export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.legalMoves();
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const cap = pos._do(m);
    pos.turn = opposite(pos.turn);
    n += perft(pos, depth - 1);
    pos.turn = opposite(pos.turn);
    pos._undo(m, cap);
  }
  return n;
}
