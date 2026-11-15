// =====================================================================
// VÁN CỜ: quản lý danh sách nước đi + vị trí đang xem (lùi/tiến)
// =====================================================================
import { Position, START_FEN, moveToICCS } from './xiangqi.js';
import { moveToNotation } from './notation.js';

export class Game {
  constructor(startFen = START_FEN) {
    this.reset(startFen);
  }

  reset(startFen = START_FEN) {
    this.startFen = new Position(startFen).fen(); // kiểm tra FEN hợp lệ
    this.moves = [];   // [{ from, to, iccs, vn, wxf, check, captured, piece, comment? }]
    this.ply = 0;      // số nước đang hiển thị (0 = thế ban đầu)
    this.pos = new Position(this.startFen);
  }

  /** Đi nước mới tại vị trí đang xem. Nếu đang xem quá khứ thì cắt bỏ phần sau. */
  play(m) {
    if (!this.pos.isLegal(m)) return null;
    if (this.ply < this.moves.length) this.moves.length = this.ply;
    const vn = moveToNotation(this.pos, m, { style: 'vn' });
    const vnPlus = moveToNotation(this.pos, m, { style: 'vn', vnAdvance: '+' });
    const wxf = moveToNotation(this.pos, m, { style: 'wxf' });
    const rec = this.pos.makeMove(m);
    const entry = { from: m.from, to: m.to, iccs: moveToICCS(m), vn, vnPlus, wxf, check: rec.check, captured: rec.captured, piece: rec.piece };
    this.moves.push(entry);
    this.ply++;
    return entry;
  }

  /** Nhảy tới nước thứ `ply` (0..moves.length) */
  goto(ply) {
    ply = Math.max(0, Math.min(this.moves.length, ply));
    while (this.ply > ply) { this.pos.undo(); this.ply--; }
    while (this.ply < ply) { this.pos.makeMove(this.moves[this.ply]); this.ply++; }
    return this.ply;
  }
  back() { return this.goto(this.ply - 1); }
  forward() { return this.goto(this.ply + 1); }

  /** Nước vừa đi tới vị trí đang xem (để tô sáng) */
  lastMove() { return this.ply > 0 ? this.moves[this.ply - 1] : null; }

  /** Dữ liệu tuần tự hóa để lưu */
  toJSON() {
    const comments = this.moves.map((m) => m.comment || '');
    return { startFen: this.startFen, moves: this.moves.map((m) => m.iccs), ply: this.ply, comments: comments.some(Boolean) ? comments : undefined, title: this.title, plan: this.plan };
  }

  static fromJSON(data) {
    const g = new Game(data.startFen || START_FEN);
    for (const iccs of data.moves || []) {
      const f = 'abcdefghi';
      const m = {
        from: (9 - Number(iccs[1])) * 9 + f.indexOf(iccs[0]),
        to: (9 - Number(iccs[3])) * 9 + f.indexOf(iccs[2]),
      };
      const e = g.play(m);
      if (!e) break; // dữ liệu hỏng thì dừng ở nước hợp lệ cuối
      if (data.comments && data.comments[g.moves.length - 1]) e.comment = data.comments[g.moves.length - 1];
    }
    g.title = data.title;
    g.plan = data.plan;
    g.goto(data.ply ?? g.moves.length);
    return g;
  }
}
