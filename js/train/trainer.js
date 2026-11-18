// =====================================================================
// GIẢ LẬP KHAI CUỘC — logic thuần (không phụ thuộc giao diện, test được bằng Node)
// - Người luyện cầm một bên (Đỏ đi trước / Đen đi sau)
// - Máy đi nước của đối phương theo cây biến, chọn nhánh ngẫu nhiên có trọng số,
//   ưu tiên nhánh có nút người luyện hay sai và nút đến hạn ôn (SRS)
// - Người luyện phải đi đúng nước lý thuyết: sai lần 1 được thử lại, sai lần 2 thì hiện đáp án
// =====================================================================
import { Position, parseCoordMove, moveToICCS } from '../core/xiangqi.js';
import { review, isDue, newCard } from './srs.js';
import { sideToMoveAt } from './opening-tree.js';

/** Khóa thẻ SRS cho một nút quyết định của người luyện */
/** Trọng số chọn nước đối phương theo hạng (book): bình thường theo book / "chơi lạ" ưu tiên nước yếu */
export const STRANGE_W = { best: 0.6, good: 0.8, ok: 1.5, weak: 3, blunder: 3 };

export const cardKey = (openingId, side, nodeKey) => `${openingId}|${side}|${nodeKey}`;

/**
 * Thống kê các nút quyết định (người luyện phải đi) trong cây con từ `node`.
 * Trả về { total, due, errors, seen }
 */
export function subtreeStats(op, node, side, cards, now = Date.now()) {
  const st = { total: 0, due: 0, errors: 0, seen: 0 };
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.children.length && sideToMoveAt(op, n) === side) {
      st.total++;
      const c = cards[cardKey(op.id, side, n.key)];
      if (isDue(c, now)) st.due++;
      if (c) { st.errors += c.lapses; st.seen += c.seen; }
    }
    for (const k of n.children) stack.push(op.nodes.get(k));
  }
  return st;
}

export class OpeningTrainer {
  /**
   * @param op      khai cuộc đã dựng cây (buildOpening / deserializeOpening)
   * @param opts    { side: 'r'|'b', mode: 'learn'|'test', cards: {}, rng: () => number, now,
   *                 oppStyle: 'book' | 'strange' (book: đối phương chọn nước theo hạng; strange: ưu tiên nước yếu/hớ) }
   */
  constructor(op, opts) {
    this.op = op;
    this.side = opts.side;
    this.mode = opts.mode || 'test';
    this.cards = opts.cards || {};
    this.rng = opts.rng || Math.random;
    this.now = opts.now || (() => Date.now());
    this.oppStyle = opts.oppStyle || 'book';
    this.reset();
  }

  reset() {
    this.pos = new Position(this.op.startFen);
    this.node = this.op.root;
    this.attempts = 0;
    this.path = [];            // [{ node, by: 'user'|'opp', result }]
    this.score = { correct: 0, retry: 0, wrong: 0 };
  }

  /** Bên phải đi ở nút hiện tại */
  turnSide() { return sideToMoveAt(this.op, this.node); }
  isUserTurn() { return !this.isEnd() && this.turnSide() === this.side; }
  isEnd() { return this.node.children.length === 0; }

  /** Các nút con là nước lý thuyết hợp lệ ở thế hiện tại */
  expected() { return this.node.children.map((k) => this.op.nodes.get(k)); }

  /** Nước lý thuyết "chính" để gợi ý (nhánh nặng ký nhất) */
  mainExpected() {
    const ex = this.expected();
    return ex.sort((a, b) => b.weight - a.weight)[0] || null;
  }

  _advance(child, by, result) {
    this.pos.makeMove(parseCoordMove(child.iccs));
    this.node = child;
    this.path.push({ node: child, by, result });
    this.attempts = 0;
  }

  /** Máy chọn và đi nước của đối phương. Trả về nút vừa đi (hoặc null nếu hết biến) */
  opponentMove() {
    if (this.isEnd() || this.isUserTurn()) return null;
    const kids = this.expected();
    const now = this.now();
    const weights = kids.map((k) => {
      const st = subtreeStats(this.op, k, this.side, this.cards, now);
      const errRate = st.seen ? st.errors / st.seen : 0;
      const dueRate = st.total ? st.due / st.total : 0;
      // Trọng số gốc của biến (book: theo hạng nước) × ưu tiên nhánh hay sai × ưu tiên nhánh đến hạn ôn
      const inf = this.op.info?.[k.key];
      const base = inf ? (this.oppStyle === 'strange' ? (STRANGE_W[inf.grade] ?? 1) : inf.w) : Math.max(0.01, k.weight);
      return base * (1 + 3 * errRate) * (1 + dueRate);
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * sum, pick = kids[kids.length - 1];
    for (let i = 0; i < kids.length; i++) { r -= weights[i]; if (r <= 0) { pick = kids[i]; break; } }
    this._advance(pick, 'opp', null);
    return pick;
  }

  /**
   * Người luyện đi nước m ({from,to}).
   * Trả về:
   *  { result: 'illegal' }                      — nước không hợp lệ theo luật
   *  { result: 'correct', node, quality }       — đúng (đã đi trên bàn)
   *  { result: 'retry' }                        — sai lần 1, được thử lại (chưa đi)
   *  { result: 'wrong', node, played }          — sai lần 2: tự đi nước đúng `node`
   */
  userMove(m) {
    if (!this.isUserTurn()) return { result: 'notyourturn' };
    if (!this.pos.isLegal(m)) return { result: 'illegal' };
    const iccs = moveToICCS(m);
    const decisionKey = this.node.key;
    const hit = this.expected().find((k) => k.iccs === iccs);
    if (hit) {
      const quality = this.attempts === 0 ? 5 : 3;
      this._grade(decisionKey, quality);
      if (quality === 5) this.score.correct++; else this.score.retry++;
      this._advance(hit, 'user', quality === 5 ? 'correct' : 'retry-ok');
      return { result: 'correct', node: hit, quality };
    }
    this.attempts++;
    if (this.attempts < 2) return { result: 'retry' };
    // Sai lần 2: ghi nhận, hiện và đi nước đúng
    this._grade(decisionKey, 1);
    this.score.wrong++;
    const right = this.mainExpected();
    const played = { ...m, iccs };
    this._advance(right, 'user', 'wrong');
    return { result: 'wrong', node: right, played };
  }

  /** Bỏ qua (xem đáp án ngay) — tính như sai */
  reveal() {
    if (!this.isUserTurn()) return null;
    this._grade(this.node.key, 1);
    this.score.wrong++;
    const right = this.mainExpected();
    this._advance(right, 'user', 'wrong');
    return right;
  }

  _grade(nodeKey, q) {
    // Chế độ "Học mới" có gợi ý nên không chấm SRS mạnh: chỉ ghi nhận đã xem
    const key = cardKey(this.op.id, this.side, nodeKey);
    const old = this.cards[key] || newCard();
    if (this.mode === 'learn') {
      this.cards[key] = q >= 3 ? { ...old, seen: old.seen + 1, correct: old.correct + 1, due: Math.min(old.due || this.now(), this.now()) } : review(old, 1, this.now());
      return;
    }
    this.cards[key] = review(old, q, this.now());
  }

  /** Biến (line) mà vị trí hiện tại thuộc về — để hiện tên biến và kế hoạch */
  currentLine() {
    const id = this.node.lineIds[0];
    return this.op.lines.find((l) => l.id === id) || null;
  }
}

/** Chọn một khai cuộc + bên để "ôn ngẫu nhiên": ưu tiên nơi có nhiều nút đến hạn */
export function pickReview(openings, cards, rng = Math.random, now = Date.now()) {
  const opts = [];
  for (const op of openings) for (const side of op.sides) {
    const st = subtreeStats(op, op.root, side, cards, now);
    if (!st.total) continue;
    opts.push({ op, side, w: 1 + st.due * 2 + st.errors });
  }
  if (!opts.length) return null;
  const sum = opts.reduce((a, b) => a + b.w, 0);
  let r = rng() * sum;
  for (const o of opts) { r -= o.w; if (r <= 0) return o; }
  return opts[opts.length - 1];
}
