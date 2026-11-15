// =====================================================================
// LÕI LUYỆN THẾ CỜ (trung cuộc, tàn cuộc, cờ thế cổ) — không phụ thuộc giao diện, test được bằng Node
// - PuzzleSession: người luyện đi theo lời giải; đối phương đi theo lời giải (sách / engine soạn sẵn)
//   Sai 1 lần: thử lại. Sai lần 2: hiện nước đúng và đi luôn nước đúng.
//   Nước khác cũng thắng (trường alts do engine chấm lúc soạn): chấp nhận, tính hoàn thành.
// - Gợi ý 3 mức: (1) chủ đề / ý chính  (2) quân cần đi  (3) nước đi
// - Đo được quân, kiểm tra mục tiêu khi đánh tiếp với máy
// =====================================================================
import { Position, parseCoordMove, moveToICCS, colorOf, rowOf, RED, BLACK } from '../core/xiangqi.js';

export const VALUE = { r: 9, c: 4.5, n: 4, b: 2, a: 2, p: 1, k: 0 };

/** Tổng giá trị quân của một bên (tốt qua sông tính 2) */
export function material(pos, color) {
  let s = 0;
  pos.board.forEach((p, i) => {
    if (!p || colorOf(p) !== color) return;
    const t = p.toLowerCase();
    if (t === 'p') s += (color === RED ? rowOf(i) <= 4 : rowOf(i) >= 5) ? 2 : 1;
    else s += VALUE[t];
  });
  return s;
}
export const matDiff = (pos, color) => material(pos, color) - material(pos, color === RED ? BLACK : RED);

/** Bên còn quân tấn công được không (xe, mã, pháo, tốt qua sông/chưa qua sông) */
export function hasAttackers(pos, color) {
  return pos.board.some((p) => p && colorOf(p) === color && 'rncp'.includes(p.toLowerCase()));
}

export class PuzzleSession {
  /**
   * item: { fen, side:'r'|'b', solution:[iccs...], alts?:[[iccs...]...], themes?, hintText? }
   * Lời giải xen kẽ: phần tử chẵn là nước người luyện, lẻ là nước đối phương.
   */
  constructor(item) {
    this.item = item;
    this.pos = new Position(item.fen);
    this.side = item.side || (this.pos.turn === RED ? 'r' : 'b');
    this.ply = 0;
    this.attempts = 0;      // số lần sai ở nước hiện tại
    this.mistakes = 0;      // số nước phải xem đáp án
    this.retries = 0;       // tổng số lần sai (kể cả sai rồi sửa được)
    this.hintLevel = 0;     // mức gợi ý cao nhất đã dùng ở nước hiện tại
    this.hintsUsed = 0;
    this.state = 'play';    // 'play' | 'solved'
    this.byAlt = false;     // hoàn thành bằng nước khác (cũng đúng)
    this.played = [];       // các nước đã đi (iccs)
  }
  get total() { return this.item.solution.length; }
  isUserTurn() { return this.state === 'play' && this.pos.turn === (this.side === 'r' ? RED : BLACK); }
  expected() { return this.item.solution[this.ply] || null; }

  _apply(iccs) {
    const m = parseCoordMove(iccs);
    const rec = this.pos.makeMove(m);
    this.played.push(iccs);
    this.ply++;
    this.attempts = 0; this.hintLevel = 0;
    if (this.ply >= this.total) this.state = 'solved';
    return { ...m, rec };
  }

  /** Người luyện đi nước m ({from,to}). */
  userMove(m) {
    if (!this.isUserTurn()) return { result: 'notyourturn' };
    if (!this.pos.isLegal(m)) return { result: 'illegal' };
    const iccs = moveToICCS(m);
    if (iccs === this.expected()) { const r = this._apply(iccs); return { result: 'correct', move: r, solved: this.state === 'solved' }; }
    const alts = this.item.alts?.[this.ply] || [];
    if (alts.includes(iccs)) {
      const r = this._apply(iccs);
      this.state = 'solved'; this.byAlt = true;
      return { result: 'alt', move: r, solved: true };
    }
    this.attempts++; this.retries++;
    if (this.attempts < 2) return { result: 'retry', played: iccs };
    // Sai lần 2: đi nước đúng
    const correct = this.expected();
    this.mistakes++;
    const r = this._apply(correct);
    return { result: 'wrong', played: iccs, correct, move: r, solved: this.state === 'solved' };
  }

  /** Đối phương đi theo lời giải */
  opponentMove() {
    if (this.state !== 'play' || this.isUserTurn()) return null;
    const iccs = this.expected();
    if (!iccs) { this.state = 'solved'; return null; }
    return this._apply(iccs);
  }

  /** Gợi ý mức 1–3 cho nước hiện tại */
  hint(level) {
    const iccs = this.expected();
    if (!iccs || !this.isUserTurn()) return null;
    this.hintLevel = Math.max(this.hintLevel, level);
    this.hintsUsed++;
    const m = parseCoordMove(iccs);
    if (level === 1) return { level, text: this.item.hintText || (this.item.themes?.length ? 'Chủ đề: ' + this.item.themes.join(', ') : 'Tìm nước mạnh nhất.') };
    if (level === 2) return { level, from: m.from };
    return { level, from: m.from, to: m.to, iccs };
  }

  /** Chất lượng (0–5) cho SRS */
  quality() {
    if (this.state !== 'solved') return 1;
    if (this.mistakes) return 1;
    if (this.retries || this.hintsUsed > 1) return 3;
    if (this.hintsUsed) return 4;
    return 5;
  }
}

/** Kiểm tra mục tiêu khi đánh tiếp với máy */
export function goalStatus(pos, goal, userColor, { plies = 0, startMat = 0, maxPlies = 120 } = {}) {
  const st = pos.status({ repetitionRule: 'draw' });
  const userWon = st.over && st.winner === userColor;
  const userLost = st.over && st.winner && st.winner !== userColor;
  // Luật 60 nước: 120 nửa nước liền không ăn quân => hòa (giống Pikafish dùng khi kiểm định)
  if (!st.over && pos.halfmove >= 120) {
    if (goal === 'draw') return { done: true, success: true, text: '60 nước không ăn quân — hòa theo luật, giữ hòa thành công.' };
    if (goal === 'win' || goal === 'mate') return { done: true, success: false, text: '60 nước không ăn quân — hòa theo luật, chưa đạt mục tiêu thắng.' };
  }
  if (goal === 'win' || goal === 'mate') {
    if (userWon) return { done: true, success: true, text: 'Đạt mục tiêu: chiếu bí / đối phương hết nước.' };
    if (userLost) return { done: true, success: false, text: 'Anh bị chiếu bí.' };
    if (st.over) return { done: true, success: false, text: 'Hòa do lặp thế — chưa đạt mục tiêu thắng.' };
    if (plies >= maxPlies) return { done: true, success: false, text: `Quá ${maxPlies / 2} nước chưa thắng — chưa đạt.` };
    return { done: false };
  }
  if (goal === 'draw') {
    if (userLost) return { done: true, success: false, text: 'Anh bị chiếu bí — chưa giữ được hòa.' };
    if (userWon) return { done: true, success: true, text: 'Anh còn thắng được — vượt mục tiêu!' };
    if (st.over) return { done: true, success: true, text: 'Hòa do lặp thế — giữ hòa thành công.' };
    const opp = userColor === RED ? BLACK : RED;
    if (!hasAttackers(pos, opp)) return { done: true, success: true, text: 'Đối phương hết quân tấn công — giữ hòa thành công.' };
    if (plies >= maxPlies) return { done: true, success: true, text: `Trụ vững ${maxPlies / 2} nước — giữ hòa thành công.` };
    return { done: false };
  }
  if (goal === 'material') {
    if (userWon) return { done: true, success: true, text: 'Chiếu bí — đạt mục tiêu.' };
    if (userLost) return { done: true, success: false, text: 'Anh bị chiếu bí.' };
    return { done: false, gain: matDiff(pos, userColor) - startMat };
  }
  return { done: st.over };
}
