// =====================================================================
// ĐỌC THẾ TRẬN — chấm 6 yếu tố của một thế cờ (tự động, kiểm chứng được trên bàn cờ)
//   1. Vật chất   2. An toàn tướng   3. Hoạt động của quân
//   4. Tuyến then chốt   5. Tốt qua sông   6. Điểm yếu (quân đang gặp nguy)
// Mỗi yếu tố: điểm Đỏ, điểm Đen, kết luận ('r' Đỏ hơn | 'b' Đen hơn | '=' cân bằng) và lời giải thích.
// =====================================================================
import { Position, RED, BLACK, rowOf, colOf, sq, colorOf, typeOf, inPalace } from '../core/xiangqi.js';
import { valueAt, attacksFrom, isEndangered, mobility, label } from './move-insight.js';

export const FACTORS = [
  { id: 'material', name: 'Vật chất', hint: 'Đếm quân: xe 9, pháo 4.5, mã 4, sĩ/tượng 2, tốt 1 (qua sông 2).' },
  { id: 'king', name: 'An toàn tướng', hint: 'Còn bao nhiêu sĩ tượng? Có bao nhiêu quân địch đang khống chế cung?' },
  { id: 'activity', name: 'Hoạt động của quân', hint: 'Tổng số ô đi được của xe, mã, pháo. Quân nào đang kém hoạt động nhất?' },
  { id: 'lines', name: 'Tuyến then chốt', hint: 'Xe tuần hà / qua hà, xe trên cột thông, pháo trung lộ nhắm tướng.' },
  { id: 'pawns', name: 'Tốt qua sông', hint: 'Tốt đã qua sông đi ngang được, càng gần cung càng nguy hiểm.' },
  { id: 'weak', name: 'Điểm yếu', hint: 'Quân bị dọa ăn mà không được bảo vệ đủ.' },
];

const side = (c) => (c === RED ? 'Đỏ' : 'Đen');
const crossed = (r, color) => (color === RED ? r <= 4 : r >= 5);

function verdict(r, b, eps) { return r - b >= eps ? 'r' : b - r >= eps ? 'b' : '='; }

export function readPosition(fen) {
  const pos = new Position(fen);
  const B = pos.board;
  const pieces = { r: [], b: [] };
  for (let s = 0; s < 90; s++) if (B[s]) pieces[colorOf(B[s])].push(s);
  const out = {};

  // 1) Vật chất
  const mat = (c) => pieces[c].filter((s) => typeOf(B[s]) !== 'k').reduce((a, s) => a + valueAt(B, s), 0);
  const mR = mat(RED), mB = mat(BLACK);
  out.material = { r: mR, b: mB, v: verdict(mR, mB, 1), why: `Đỏ ${fmt(mR)} – Đen ${fmt(mB)} điểm quân.` };

  // 2) An toàn tướng: số sĩ tượng − 1,5 × số quân địch khống chế cung
  const palace = (c) => { const out2 = []; for (let r = 0; r < 10; r++) for (let cc = 3; cc <= 5; cc++) if (inPalace(r, cc, c)) out2.push(sq(r, cc)); return out2; };
  const kingInfo = (c) => {
    const def = pieces[c].filter((s) => 'ab'.includes(typeOf(B[s]))).length;
    const enemy = c === RED ? BLACK : RED;
    const pal = palace(c);
    const attackers = pieces[enemy].filter((s) => 'rncp'.includes(typeOf(B[s])) && attacksFrom(B, s).some((x) => pal.includes(x)));
    return { def, attackers, score: def - 1.5 * attackers.length };
  };
  const kR = kingInfo(RED), kB = kingInfo(BLACK);
  out.king = {
    r: kR.score, b: kB.score, v: verdict(kR.score, kB.score, 1.5),
    why: `Đỏ: ${kR.def} sĩ tượng, ${kR.attackers.length} quân Đen nhắm vào cung${kR.attackers.length ? ' (' + kR.attackers.map((s) => label(B, s)).join(', ') + ')' : ''}. `
      + `Đen: ${kB.def} sĩ tượng, ${kB.attackers.length} quân Đỏ nhắm vào cung${kB.attackers.length ? ' (' + kB.attackers.map((s) => label(B, s)).join(', ') + ')' : ''}.`,
  };

  // 3) Hoạt động: tổng số ô đi của xe/mã/pháo; quân kém nhất
  const act = (c) => {
    const ps = pieces[c].filter((s) => 'rnc'.includes(typeOf(B[s])));
    const mob = ps.map((s) => ({ s, n: mobility(pos, s) }));
    const total = mob.reduce((a, x) => a + x.n, 0);
    // Quân kém nhất: ít ô đi nhất so với "mức thường" của loại quân đó
    const norm = { r: 10, n: 4, c: 8 };
    const worst = mob.slice().sort((x, y) => x.n / norm[typeOf(B[x.s])] - y.n / norm[typeOf(B[y.s])])[0];
    return { total, worst };
  };
  const aR = act(RED), aB = act(BLACK);
  const worstTxt = (a) => (a.worst ? `${label(B, a.worst.s)} (${a.worst.n} ô)` : '—');
  out.activity = {
    r: aR.total, b: aB.total, v: verdict(aR.total, aB.total, Math.max(4, 0.15 * Math.max(aR.total, aB.total))),
    why: `Số ô đi của xe-mã-pháo: Đỏ ${aR.total}, Đen ${aB.total}. Quân kém hoạt động nhất — Đỏ: ${worstTxt(aR)}; Đen: ${worstTxt(aB)}.`,
    worst: { r: aR.worst?.s, b: aB.worst?.s },
  };

  // 4) Tuyến then chốt
  const lines = (c) => {
    let score = 0; const notes = [];
    const enemyK = pos.kingSq(c === RED ? BLACK : RED);
    for (const s of pieces[c]) {
      const t = typeOf(B[s]), r = rowOf(s), cc = colOf(s);
      if (t === 'r') {
        if (crossed(r, c)) { score += 2; notes.push(`${label(B, s)} qua hà`); }
        else if (r === (c === RED ? 5 : 4)) { score += 1; notes.push(`${label(B, s)} tuần hà`); }
        // cột thông: phía trước xe không có quân mình
        let open = true;
        for (let rr = r + (c === RED ? -1 : 1); rr >= 0 && rr < 10; rr += c === RED ? -1 : 1) {
          const q = B[sq(rr, cc)];
          if (q) { if (colorOf(q) === c) open = false; break; }
        }
        if (open && !crossed(r, c)) { score += 1; notes.push(`${label(B, s)} trên cột thông`); }
      }
      if (t === 'c' && cc === colOf(enemyK)) {
        let between = 0;
        const step = rowOf(enemyK) > r ? 1 : -1;
        for (let rr = r + step; rr !== rowOf(enemyK); rr += step) if (B[sq(rr, cc)]) between++;
        if (between <= 2) { score += 1; notes.push(`${label(B, s)} nhắm thẳng cột tướng`); }
      }
    }
    return { score, notes };
  };
  const lR = lines(RED), lB = lines(BLACK);
  out.lines = {
    r: lR.score, b: lB.score, v: verdict(lR.score, lB.score, 2),
    why: `Đỏ: ${lR.notes.join(', ') || 'chưa chiếm tuyến nào'}. Đen: ${lB.notes.join(', ') || 'chưa chiếm tuyến nào'}.`,
  };

  // 5) Tốt qua sông (tốt càng tiến sâu càng có giá trị)
  const pawns = (c) => pieces[c].filter((s) => typeOf(B[s]) === 'p' && crossed(rowOf(s), c));
  const pScore = (c) => pawns(c).reduce((a, s) => a + 1 + (c === RED ? (4 - rowOf(s)) : (rowOf(s) - 5)) * 0.25, 0);
  const pR = pScore(RED), pB = pScore(BLACK);
  out.pawns = { r: pR, b: pB, v: verdict(pR, pB, 1), why: `Tốt đã qua sông: Đỏ ${pawns(RED).length}, Đen ${pawns(BLACK).length}.` };

  // 6) Điểm yếu: quân đang gặp nguy (ít điểm yếu hơn là tốt hơn)
  const weak = (c) => pieces[c].filter((s) => isEndangered(B, s));
  const wR = weak(RED), wB = weak(BLACK);
  out.weak = {
    r: -wR.length, b: -wB.length, v: verdict(-wR.reduce((a, s) => a + valueAt(B, s), 0), -wB.reduce((a, s) => a + valueAt(B, s), 0), 1),
    why: `Quân đang gặp nguy — Đỏ: ${wR.map((s) => label(B, s)).join(', ') || 'không có'}; Đen: ${wB.map((s) => label(B, s)).join(', ') || 'không có'}.`,
  };
  out.turn = pos.turn;
  out.turnText = `Đến lượt ${side(pos.turn)}`;
  return out;
}

function fmt(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }

/** Lời khuyên kế hoạch tổng quát dựa trên 6 yếu tố, nhìn từ bên `me` */
export function planAdvice(f, me) {
  const op = me === RED ? BLACK : RED, tips = [];
  const better = (k) => f[k].v === me, worse = (k) => f[k].v === op;
  const diff = me === RED ? f.material.r - f.material.b : f.material.b - f.material.r;
  if (Math.abs(diff) < 2 && f.material.v !== '=') tips.push('Chênh lệch vật chất nhỏ (khoảng một tốt) → thế trận và độ hoạt động quan trọng hơn con số.');
  if (better('material') && diff >= 2) tips.push('Đang hơn quân → ưu tiên đổi quân, đơn giản hóa về tàn cuộc; tránh mạo hiểm.');
  if (worse('material') && diff <= -2) tips.push('Đang kém quân → giữ thế phức tạp, tránh đổi quân, tìm cơ hội phản công vào tướng.');
  if (worse('weak')) tips.push('Có quân đang gặp nguy → xử lý trước (tránh, bảo vệ hoặc phản đòn) rồi mới tính chuyện khác.');
  if (better('weak')) tips.push('Đối phương có quân đang gặp nguy → tìm cách ăn hoặc tăng sức ép lên quân đó.');
  if (worse('king')) tips.push('Cung tướng mình đang bị nhắm → củng cố sĩ tượng hoặc đổi bớt quân tấn công của địch.');
  if (better('king')) tips.push('Cung tướng đối phương đang bị nhắm nhiều hơn cung mình → dồn thêm quân (xe, pháo, mã) vào cánh có tướng địch.');
  if (worse('activity')) tips.push('Quân mình kém hoạt động hơn → cải thiện quân kém nhất trước (thường là xe chưa ra hoặc mã bị cản chân).');
  if (worse('lines')) tips.push('Đối phương đang chiếm tuyến then chốt → tranh cột thông, đưa xe ra tuần hà hoặc đổi xe của địch.');
  if (better('pawns')) tips.push('Có tốt qua sông → phối hợp tốt với xe/mã, đẩy tốt áp sát cung khi an toàn.');
  if (!tips.length) tips.push('Thế trận cân bằng → cải thiện quân kém hoạt động nhất, tranh tuyến then chốt, giữ an toàn cung.');
  return tips;
}
