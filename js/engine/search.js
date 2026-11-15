// =====================================================================
// ENGINE DỰ PHÒNG (JavaScript thuần) — tìm kiếm alpha-beta cho cờ tướng
// Dùng khi chưa có Fairy-Stockfish. Chạy được trong Web Worker và trong Node (kiểm định dữ liệu).
// Kỹ thuật: iterative deepening, PVS, bảng chuyển vị (Zobrist), null-move, killer/history,
// giảm độ sâu nước muộn (LMR), quiescence (chuỗi ăn quân), mở rộng khi bị chiếu.
// Đánh giá: vật chất + bảng vị trí (PST). Điểm tính theo centipawn, góc nhìn bên đang đi.
// Biểu diễn riêng (mảng số nguyên) để chạy nhanh hơn lớp Position của phần luật.
// =====================================================================

// Mã quân: 0 trống; Đỏ 1..7, Đen 9..15 (= loại + 8)
const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
const BLACK_BIT = 8;
const CHAR2CODE = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7, k: 9, a: 10, b: 11, n: 12, r: 13, c: 14, p: 15, H: 4, E: 3, h: 12, e: 11 };
const FILES = 'abcdefghi';

export const MATE = 30000;
const INF = 32000;

// Giá trị quân (centipawn)
const VALUE = [0, 0, 200, 200, 420, 900, 450, 100];

// ---------- Bảng vị trí (PST), viết theo góc nhìn Đỏ: hàng 0 = đáy Đen, hàng 9 = đáy Đỏ ----------
const PST_P = [
  [9, 9, 9, 11, 13, 11, 9, 9, 9],
  [39, 49, 69, 84, 89, 84, 69, 49, 39],
  [39, 49, 64, 74, 74, 74, 64, 49, 39],
  [39, 46, 54, 59, 61, 59, 54, 46, 39],
  [29, 37, 41, 54, 59, 54, 41, 37, 29],
  [7, 0, 13, 0, 16, 0, 13, 0, 7],
  [7, 0, 7, 0, 15, 0, 7, 0, 7],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];
const PST_R = [
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [-2, 10, 6, 14, 12, 14, 6, 10, -2],
];
const PST_N = [
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [2, 6, 8, 6, 10, 6, 8, 6, 2],
  [4, 2, 8, 8, 4, 8, 8, 2, 4],
  [0, 2, 4, 4, -2, 4, 4, 2, 0],
  [0, -4, 0, 0, 0, 0, 0, -4, 0],
];
const PST_C = [
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 4, 6, 16, 6, 4, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0],
];
const PST_A = Array.from({ length: 10 }, (_, r) => Array.from({ length: 9 }, (_, c) => (r === 8 && c === 4 ? 6 : 0)));
const PST_B = Array.from({ length: 10 }, (_, r) => Array.from({ length: 9 }, (_, c) => (r === 7 && c === 4 ? 6 : r === 9 && (c === 2 || c === 6) ? 0 : r === 5 ? -4 : 0)));
const PST_K = Array.from({ length: 10 }, (_, r) => Array.from({ length: 9 }, (_, c) => (r === 9 ? (c === 4 ? 6 : 2) : r === 8 ? -8 : -20)));
const PSTS = [null, PST_K, PST_A, PST_B, PST_N, PST_R, PST_C, PST_P];

// PSQ[code][sq] = giá trị (vật chất + vị trí) theo góc nhìn của chính quân đó
const PSQ = Array.from({ length: 16 }, () => new Int16Array(90));
for (let t = 1; t <= 7; t++) {
  for (let sq = 0; sq < 90; sq++) {
    const r = (sq / 9) | 0, c = sq % 9;
    PSQ[t][sq] = VALUE[t] + PSTS[t][r][c];
    PSQ[t + BLACK_BIT][sq] = VALUE[t] + PSTS[t][9 - r][8 - c]; // lật cho Đen
  }
}

// ---------- Zobrist (2 khóa 32 bit) ----------
let seed = 0x9e3779b9;
const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
const ZL = Array.from({ length: 16 }, () => Uint32Array.from({ length: 90 }, rnd32));
const ZH = Array.from({ length: 16 }, () => Uint32Array.from({ length: 90 }, rnd32));
const ZSIDE_L = rnd32(), ZSIDE_H = rnd32();

// ---------- Hình học ----------
const inB = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (sq, black) => { const r = (sq / 9) | 0, c = sq % 9; return c >= 3 && c <= 5 && (black ? r <= 2 : r >= 7); };
const ownSide = (sq, black) => { const r = (sq / 9) | 0; return black ? r <= 4 : r >= 5; };

// Bảng nước đi tính sẵn
const KING_MOVES = [], ADV_MOVES = [], KING_P = [[], []], ADV_P = [[], []], ELE_MOVES = [], HORSE_MOVES = [], PAWN_MOVES = [[], []];
for (let sq = 0; sq < 90; sq++) {
  const r = (sq / 9) | 0, c = sq % 9;
  KING_MOVES[sq] = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([a, b]) => inB(r + a, c + b)).map(([a, b]) => (r + a) * 9 + c + b);
  ADV_MOVES[sq] = [[-1, -1], [-1, 1], [1, -1], [1, 1]].filter(([a, b]) => inB(r + a, c + b)).map(([a, b]) => (r + a) * 9 + c + b);
  ELE_MOVES[sq] = [[-2, -2], [-2, 2], [2, -2], [2, 2]].filter(([a, b]) => inB(r + a, c + b)).map(([a, b]) => [(r + a) * 9 + c + b, (r + a / 2) * 9 + c + b / 2]);
  HORSE_MOVES[sq] = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]
    .filter(([a, b]) => inB(r + a, c + b)).map(([a, b, la, lb]) => [(r + a) * 9 + c + b, (r + la) * 9 + c + lb]);
  for (const black of [0, 1]) {
    const f = black ? 1 : -1, out = [];
    if (inB(r + f, c)) out.push((r + f) * 9 + c);
    const crossed = black ? r >= 5 : r <= 4;
    if (crossed) { if (c > 0) out.push(sq - 1); if (c < 8) out.push(sq + 1); }
    PAWN_MOVES[black][sq] = out;
  }
}
for (let sq = 0; sq < 90; sq++) for (const bl of [0, 1]) {
  KING_P[bl][sq] = KING_MOVES[sq].filter((x) => inPalace(x, bl));
  ADV_P[bl][sq] = ADV_MOVES[sq].filter((x) => inPalace(x, bl));
}
// Mã tấn công ngược: từ ô bị tấn công tìm vị trí mã + chân mã (chân tính phía con mã)
const HORSE_ATTACKERS = [];
for (let sq = 0; sq < 90; sq++) {
  const r = (sq / 9) | 0, c = sq % 9, out = [];
  for (const [a, b] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) {
    const hr = r - a, hc = c - b;
    if (!inB(hr, hc)) continue;
    const lr = hr + (Math.abs(a) === 2 ? a / 2 : 0), lc = hc + (Math.abs(b) === 2 ? b / 2 : 0);
    out.push([hr * 9 + hc, lr * 9 + lc]);
  }
  HORSE_ATTACKERS[sq] = out;
}
// Tia theo 4 hướng
const RAYS = [];
for (let sq = 0; sq < 90; sq++) {
  const r = (sq / 9) | 0, c = sq % 9;
  RAYS[sq] = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([a, b]) => { const out = []; let rr = r + a, cc = c + b; while (inB(rr, cc)) { out.push(rr * 9 + cc); rr += a; cc += b; } return out; });
}

export const moveFrom = (m) => m >> 7;
export const moveTo = (m) => m & 127;
const mk = (f, t) => (f << 7) | t;
export function moveToIccs(m) {
  const f = m >> 7, t = m & 127;
  return FILES[f % 9] + (9 - ((f / 9) | 0)) + FILES[t % 9] + (9 - ((t / 9) | 0));
}
export function iccsToMove(s) {
  const sqOf = (x, y) => (9 - Number(y)) * 9 + FILES.indexOf(x);
  return mk(sqOf(s[0], s[1]), sqOf(s[2], s[3]));
}

// =====================================================================
export class Engine {
  constructor({ ttBits = 18 } = {}) {
    this.board = new Int8Array(90);
    this.ttSize = 1 << ttBits;
    this.ttMask = this.ttSize - 1;
    this.ttKey = new Uint32Array(this.ttSize);
    this.ttMove = new Int32Array(this.ttSize);
    this.ttScore = new Int16Array(this.ttSize);
    this.ttDepth = new Int8Array(this.ttSize);
    this.ttFlag = new Uint8Array(this.ttSize);
    this.history = new Int32Array(128 * 128);
    this.killers = Array.from({ length: 128 }, () => [0, 0]);
    this.moveBuf = Array.from({ length: 128 }, () => new Int32Array(160));
    this.scoreBuf = Array.from({ length: 128 }, () => new Int32Array(160));
  }

  // ---------- Nạp thế ----------
  setFen(fen, history = []) {
    const [rows, side] = fen.trim().split(/\s+/);
    this.board.fill(0);
    rows.split('/').forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { c += Number(ch); continue; }
        this.board[r * 9 + c] = CHAR2CODE[ch];
        c++;
      }
    });
    this.black = (side || 'w').toLowerCase() === 'b' ? 1 : 0;
    this._recompute();
    this.stackHash = [];   // lịch sử khóa để phát hiện lặp
    this.undoStack = [];
    for (const iccs of history) this.make(iccsToMove(iccs));
    // Lịch sử ván trước thế này chỉ dùng để phát hiện lặp
    this.rootPly = this.stackHash.length;
  }

  _recompute() {
    let sR = 0, sB = 0, hl = 0, hh = 0;
    this.kingSq = [-1, -1];
    for (let sq = 0; sq < 90; sq++) {
      const p = this.board[sq];
      if (!p) continue;
      if (p & BLACK_BIT) sB += PSQ[p][sq]; else sR += PSQ[p][sq];
      hl ^= ZL[p][sq]; hh ^= ZH[p][sq];
      if ((p & 7) === K) this.kingSq[p & BLACK_BIT ? 1 : 0] = sq;
    }
    if (this.black) { hl ^= ZSIDE_L; hh ^= ZSIDE_H; }
    this.mat = [sR, sB];
    this.hl = hl >>> 0; this.hh = hh >>> 0;
  }

  // ---------- Sinh nước (giả hợp lệ) ----------
  gen(buf, capturesOnly = false) {
    const b = this.board, me = this.black, myBit = me ? BLACK_BIT : 0;
    let n = 0;
    const own = (q) => q && ((q & BLACK_BIT) === myBit);
    for (let sq = 0; sq < 90; sq++) {
      const p = b[sq];
      if (!p || (p & BLACK_BIT) !== myBit) continue;
      const t = p & 7;
      if (t === R || t === C) {
        for (const ray of RAYS[sq]) {
          let screen = false;
          for (const to of ray) {
            const q = b[to];
            if (t === R) {
              if (!q) { if (!capturesOnly) buf[n++] = mk(sq, to); continue; }
              if (!own(q)) buf[n++] = mk(sq, to);
              break;
            } else {
              if (!screen) { if (!q) { if (!capturesOnly) buf[n++] = mk(sq, to); } else screen = true; }
              else if (q) { if (!own(q)) buf[n++] = mk(sq, to); break; }
            }
          }
        }
        continue;
      }
      let targets;
      if (t === N) {
        for (const [to, leg] of HORSE_MOVES[sq]) {
          if (b[leg]) continue;
          const q = b[to];
          if (q ? !own(q) : !capturesOnly) buf[n++] = mk(sq, to);
        }
        continue;
      }
      if (t === B) {
        for (const [to, eye] of ELE_MOVES[sq]) {
          if (b[eye] || !ownSide(to, me)) continue;
          const q = b[to];
          if (q ? !own(q) : !capturesOnly) buf[n++] = mk(sq, to);
        }
        continue;
      }
      if (t === K) targets = KING_P[me][sq];
      else if (t === A) targets = ADV_P[me][sq];
      else targets = PAWN_MOVES[me][sq];
      for (const to of targets) {
        const q = b[to];
        if (q ? !own(q) : !capturesOnly) buf[n++] = mk(sq, to);
      }
    }
    return n;
  }

  /** Ô `sq` có bị bên `byBlack` tấn công không (dùng cho ô tướng, gồm cả lộ mặt tướng) */
  attacked(sq, byBlack) {
    const b = this.board, bit = byBlack ? BLACK_BIT : 0;
    const rr = bit | R, cc = bit | C, kk = bit | K, nn = bit | N, pp = bit | P;
    for (let d = 0; d < 4; d++) {
      let screen = false;
      for (const to of RAYS[sq][d]) {
        const q = b[to];
        if (!q) continue;
        if (!screen) { if (q === rr || (q === kk && d < 2)) return true; screen = true; }
        else { if (q === cc) return true; break; }
      }
    }
    for (const [h, leg] of HORSE_ATTACKERS[sq]) if (b[h] === nn && !b[leg]) return true;
    const r = (sq / 9) | 0, c = sq % 9;
    if (byBlack) {
      if (r > 0 && b[sq - 9] === pp) return true;
      if (r >= 5) { if (c > 0 && b[sq - 1] === pp) return true; if (c < 8 && b[sq + 1] === pp) return true; }
    } else {
      if (r < 9 && b[sq + 9] === pp) return true;
      if (r <= 4) { if (c > 0 && b[sq - 1] === pp) return true; if (c < 8 && b[sq + 1] === pp) return true; }
    }
    return false;
  }
  inCheck() { return this.attacked(this.kingSq[this.black], !this.black); }

  // ---------- Đi / hoàn nước ----------
  make(m) {
    const f = m >> 7, t = m & 127, b = this.board;
    const p = b[f], cap = b[t];
    const side = p & BLACK_BIT ? 1 : 0;
    this.stackHash.push(this.hl ^ (this.hh * 31));
    this.undoStack.push(cap, this.hl, this.hh);
    this.mat[side] += PSQ[p][t] - PSQ[p][f];
    this.hl ^= ZL[p][f] ^ ZL[p][t] ^ ZSIDE_L;
    this.hh ^= ZH[p][f] ^ ZH[p][t] ^ ZSIDE_H;
    if (cap) { this.mat[1 - side] -= PSQ[cap][t]; this.hl ^= ZL[cap][t]; this.hh ^= ZH[cap][t]; }
    this.hl >>>= 0; this.hh >>>= 0;
    b[t] = p; b[f] = 0;
    if ((p & 7) === K) this.kingSq[side] = t;
    this.black ^= 1;
    return cap;
  }
  unmake(m) {
    const f = m >> 7, t = m & 127, b = this.board;
    const hh = this.undoStack.pop(), hl = this.undoStack.pop(), cap = this.undoStack.pop();
    this.stackHash.pop();
    const p = b[t];
    const side = p & BLACK_BIT ? 1 : 0;
    this.black ^= 1;
    b[f] = p; b[t] = cap;
    this.mat[side] -= PSQ[p][t] - PSQ[p][f];
    if (cap) this.mat[1 - side] += PSQ[cap][t];
    if ((p & 7) === K) this.kingSq[side] = f;
    this.hl = hl; this.hh = hh;
  }
  /** Nước giả hợp lệ có hợp lệ thật không */
  legalAfterMake() { return !this.attacked(this.kingSq[this.black ^ 1], this.black === 1); }

  legalMoves() {
    const buf = new Int32Array(160), out = [];
    const n = this.gen(buf);
    for (let i = 0; i < n; i++) { this.make(buf[i]); if (this.legalAfterMake()) out.push(buf[i]); this.unmake(buf[i]); }
    return out;
  }

  evaluate() { return (this.black ? this.mat[1] - this.mat[0] : this.mat[0] - this.mat[1]) + 10; } // +10: lợi thế đi trước

  /** Lặp thế trong đường đi hiện tại / lịch sử ván */
  isRepetition() {
    const key = this.hl ^ (this.hh * 31);
    const s = this.stackHash;
    for (let i = s.length - 2; i >= 0 && i >= s.length - 40; i -= 2) if (s[i] === key) return true;
    return false;
  }

  // ---------- Tìm kiếm ----------
  _timeUp() {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }

  quiesce(alpha, beta, ply) {
    if (this._timeUp()) return 0;
    const inCheck = this.inCheck();
    let best = -INF;
    if (!inCheck) {
      const stand = this.evaluate();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      best = stand;
    }
    if (ply >= 100) return this.evaluate();
    const buf = this.moveBuf[ply], sc = this.scoreBuf[ply];
    const n = this.gen(buf, !inCheck);
    for (let i = 0; i < n; i++) { const m = buf[i]; sc[i] = (this.board[m & 127] ? PSQ[this.board[m & 127]][m & 127] * 16 : 0) - (this.board[m >> 7] & 7); }
    let legal = 0;
    for (let i = 0; i < n; i++) {
      let bi = i; for (let j = i + 1; j < n; j++) if (sc[j] > sc[bi]) bi = j;
      const m = buf[bi]; buf[bi] = buf[i]; buf[i] = m; const s0 = sc[bi]; sc[bi] = sc[i]; sc[i] = s0;
      this.make(m);
      if (!this.legalAfterMake()) { this.unmake(m); continue; }
      legal++;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.unmake(m);
      if (this.stopped) return 0;
      if (score > best) { best = score; if (score > alpha) { alpha = score; if (score >= beta) break; } }
    }
    if (inCheck && !legal) return -MATE + ply; // bị chiếu và hết nước
    return best;
  }

  search(depth, alpha, beta, ply, allowNull = true) {
    if (ply > 0 && this.isRepetition()) return 0;
    const inCheck = this.inCheck();
    if (inCheck) depth++; // mở rộng khi bị chiếu
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    if (this._timeUp()) return 0;
    if (ply >= 100) return this.evaluate();

    // Bảng chuyển vị
    const idx = this.hl & this.ttMask, key = this.hh;
    let ttMove = 0;
    if (this.ttKey[idx] === key) {
      ttMove = this.ttMove[idx];
      if (ply > 0 && this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
        const fl = this.ttFlag[idx];
        if (fl === 0 || (fl === 1 && s >= beta) || (fl === 2 && s <= alpha)) return s;
      }
    }
    const pv = beta - alpha > 1;

    // Null move: bỏ lượt, nếu vẫn >= beta thì cắt (không dùng khi bị chiếu / ít quân)
    if (allowNull && !pv && !inCheck && depth >= 3 && this.mat[this.black] > 1600 + 10000 * 0) {
      const stat = this.evaluate();
      if (stat >= beta) {
        this.black ^= 1; this.hl ^= ZSIDE_L; this.hh ^= ZSIDE_H; this.stackHash.push(-1);
        const s = -this.search(depth - 3, -beta, -beta + 1, ply + 1, false);
        this.stackHash.pop(); this.black ^= 1; this.hl ^= ZSIDE_L; this.hh ^= ZSIDE_H;
        this.hl >>>= 0; this.hh >>>= 0;
        if (this.stopped) return 0;
        if (s >= beta) return s;
      }
    }

    const buf = this.moveBuf[ply], sc = this.scoreBuf[ply];
    const n = this.gen(buf);
    const kl = this.killers[ply];
    for (let i = 0; i < n; i++) {
      const m = buf[i], cap = this.board[m & 127];
      sc[i] = m === ttMove ? 1 << 30
        : cap ? (1 << 24) + PSQ[cap][m & 127] * 16 - (this.board[m >> 7] & 7)
          : m === kl[0] ? (1 << 23) : m === kl[1] ? (1 << 22) : this.history[(m >> 7) * 128 + (m & 127)];
    }
    let best = -INF, bestMove = 0, legal = 0, flag = 2;
    for (let i = 0; i < n; i++) {
      let bi = i; for (let j = i + 1; j < n; j++) if (sc[j] > sc[bi]) bi = j;
      const m = buf[bi]; buf[bi] = buf[i]; buf[i] = m; const s0 = sc[bi]; sc[bi] = sc[i]; sc[i] = s0;
      const isCap = this.board[m & 127] !== 0;
      this.make(m);
      if (!this.legalAfterMake()) { this.unmake(m); continue; }
      legal++;
      let score;
      if (legal === 1) score = -this.search(depth - 1, -beta, -alpha, ply + 1);
      else {
        // LMR: nước yên lặng xếp sau được tìm nông hơn trước
        let r = 0;
        if (depth >= 3 && legal > 3 && !isCap && !inCheck && s0 < (1 << 22)) r = legal > 8 ? 2 : 1;
        score = -this.search(depth - 1 - r, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && r) score = -this.search(depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta) score = -this.search(depth - 1, -beta, -alpha, ply + 1);
      }
      this.unmake(m);
      if (this.stopped) return 0;
      if (score > best) {
        best = score; bestMove = m;
        if (ply === 0) { this.rootBest = m; this.rootScore = score; }
        if (score > alpha) {
          alpha = score; flag = 0;
          if (score >= beta) {
            flag = 1;
            if (!isCap) {
              if (kl[0] !== m) { kl[1] = kl[0]; kl[0] = m; }
              this.history[(m >> 7) * 128 + (m & 127)] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (!legal) return -MATE + ply; // cờ tướng: hết nước đi (bị bí hoặc khốn) đều thua
    // Lưu bảng chuyển vị
    let st = best;
    if (st > MATE - 200) st += ply; else if (st < -MATE + 200) st -= ply;
    this.ttKey[idx] = key; this.ttMove[idx] = bestMove; this.ttScore[idx] = st; this.ttDepth[idx] = depth; this.ttFlag[idx] = flag;
    return best;
  }

  /** Lấy biến chính từ bảng chuyển vị */
  pv(maxLen = 12) {
    const out = [], made = [];
    for (let i = 0; i < maxLen; i++) {
      const idx = this.hl & this.ttMask;
      if (this.ttKey[idx] !== this.hh) break;
      const m = this.ttMove[idx];
      if (!m || !this.legalMoves().includes(m)) break;
      out.push(moveToIccs(m)); this.make(m); made.push(m);
      if (this.isRepetition()) break;
    }
    while (made.length) this.unmake(made.pop());
    return out;
  }

  /**
   * Tìm nước tốt nhất.
   * opts: { depth (tối đa), movetime (ms), noise (cp, làm yếu máy ở cấp thấp), onInfo(info) }
   * Trả về { move (ICCS), score (cp, góc nhìn bên đi), depth, pv, nodes, mate }
   */
  go({ depth = 64, movetime = 1000, noise = 0, onInfo = null, rng = Math.random } = {}) {
    this.nodes = 0; this.stopped = false;
    this.deadline = Date.now() + movetime;
    this.history.fill(0);
    for (const k of this.killers) { k[0] = 0; k[1] = 0; }
    const legal = this.legalMoves();
    if (!legal.length) return { move: null, score: -MATE, depth: 0, pv: [], nodes: 0, mate: 0 };
    // Cấp thấp: chấm từng nước ở độ sâu nhỏ rồi cộng nhiễu ngẫu nhiên
    if (noise > 0) {
      const d = Math.max(0, depth - 1);
      let best = null;
      for (const m of legal) {
        this.make(m);
        const s = -this.search(d, -INF, INF, 1);
        this.unmake(m);
        const v = s + (rng() * 2 - 1) * noise;
        if (!best || v > best.v) best = { m, s, v };
        if (this.stopped) break;
      }
      return { move: moveToIccs(best.m), score: best.s, depth: d + 1, pv: [moveToIccs(best.m)], nodes: this.nodes, mate: 0 };
    }
    let result = { move: moveToIccs(legal[0]), score: 0, depth: 0, pv: [moveToIccs(legal[0])], nodes: 0 };
    for (let d = 1; d <= depth; d++) {
      this.rootBest = 0;
      // Cửa sổ khát vọng quanh điểm lần trước
      let a = d > 3 ? result.score - 60 : -INF, b = d > 3 ? result.score + 60 : INF;
      let s = this.search(d, a, b, 0);
      if (!this.stopped && (s <= a || s >= b)) s = this.search(d, -INF, INF, 0);
      if (this.stopped && d > 1) break;
      if (this.rootBest) {
        result = { move: moveToIccs(this.rootBest), score: s, depth: d, pv: this.pv(), nodes: this.nodes };
        result.mate = Math.abs(s) > MATE - 200 ? Math.sign(s) * Math.ceil((MATE - Math.abs(s)) / 2) : 0;
        onInfo?.(result);
        if (result.mate) break;
      }
      if (Date.now() > this.deadline - movetime * 0.45) break; // không đủ thời gian cho vòng sau
    }
    result.nodes = this.nodes;
    return result;
  }
}

/** Cấp độ máy (1 dễ … 8 mạnh nhất của engine JS) */
export const LEVELS = [
  null,
  { name: 'Mới tập', depth: 1, movetime: 300, noise: 250 },
  { name: 'Dễ', depth: 2, movetime: 400, noise: 140 },
  { name: 'Khá dễ', depth: 2, movetime: 500, noise: 70 },
  { name: 'Trung bình', depth: 3, movetime: 700, noise: 30 },
  { name: 'Khá', depth: 5, movetime: 1000, noise: 0 },
  { name: 'Mạnh', depth: 7, movetime: 2000, noise: 0 },
  { name: 'Rất mạnh', depth: 10, movetime: 3500, noise: 0 },
  { name: 'Tối đa', depth: 30, movetime: 6000, noise: 0 },
];
