// =====================================================================
// PHÂN TÍCH VÁN: chấm từng nước bằng engine, đánh dấu nước kém
//   Chênh lệch (centipawn) giữa nước tốt nhất và nước đã đi:
//   >= 300: Hớ (??)   120–299: Sai lầm (?)   50–119: Không chính xác (?!)
// Hàm dùng chung cho app (qua EngineClient) và script kiểm định (Node, gọi Engine trực tiếp)
// =====================================================================
export const CLASS = [
  { key: 'blunder', min: 300, sym: '??', name: 'Hớ' },
  { key: 'mistake', min: 120, sym: '?', name: 'Sai lầm' },
  { key: 'inaccuracy', min: 50, sym: '?!', name: 'Không chính xác' },
];

/** Giới hạn điểm chiếu bí để phép trừ không bị quá lớn */
export const clampScore = (s) => Math.max(-2000, Math.min(2000, s));

export function classify(loss) {
  for (const c of CLASS) if (loss >= c.min) return c;
  return null;
}

/**
 * searchFn(fen, history) => Promise<{ move, score, pv }>  (score: góc nhìn bên đi)
 * Trả về mảng theo từng nước: { ply, played, best, bestScore, playedScore, loss, cls, pv }
 * bestScore / playedScore đều theo góc nhìn bên đi nước đó.
 */
export async function analyzeGame(searchFn, startFen, moves, { onProgress, isOver } = {}) {
  const evals = [];
  for (let i = 0; i <= moves.length; i++) {
    const r = await searchFn(startFen, moves.slice(0, i));
    evals.push(r);
    onProgress?.(i + 1, moves.length + 1);
  }
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const best = evals[i];
    const after = evals[i + 1];
    const bestScore = clampScore(best.score);
    // Thế sau nước đi: điểm theo bên kia, đổi dấu; nếu hết nước đi thì bên vừa đi thắng
    const playedScore = after.move === null ? 2000 : clampScore(-after.score);
    const same = best.move === moves[i];
    const loss = same ? 0 : Math.max(0, bestScore - playedScore);
    out.push({ ply: i + 1, played: moves[i], best: best.move, bestScore, playedScore, loss, cls: classify(loss), pv: best.pv || [] });
  }
  return { moves: out, finalScore: evals[evals.length - 1].score };
}
