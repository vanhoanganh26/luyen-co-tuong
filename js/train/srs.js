// =====================================================================
// LẶP LẠI NGẮT QUÃNG (SRS) — thuật toán kiểu SM-2, tính riêng cho từng nút
// Mỗi thẻ: { ef, interval (ngày), reps, due (mốc ms), lapses, seen, correct }
// Chất lượng trả lời q (0–5):
//   5 = đúng ngay lần đầu, 3 = đúng ở lần thử thứ 2, 1 = sai cả 2 lần
// =====================================================================
const DAY = 24 * 60 * 60 * 1000;

export function newCard() {
  return { ef: 2.5, interval: 0, reps: 0, due: 0, lapses: 0, seen: 0, correct: 0 };
}

/** Cập nhật thẻ sau một lần trả lời (trả về thẻ mới, không sửa thẻ cũ) */
export function review(card, q, now = Date.now()) {
  const c = { ...(card || newCard()) };
  c.seen++;
  if (q >= 4) c.correct++;
  if (q < 3) {
    // Quên: học lại từ đầu, ôn lại sau 10 phút
    c.reps = 0;
    c.lapses++;
    c.interval = 0;
    c.due = now + 10 * 60 * 1000;
  } else {
    c.reps++;
    if (c.reps === 1) c.interval = 1;
    else if (c.reps === 2) c.interval = 3;
    else c.interval = Math.round(c.interval * c.ef);
    // Đúng ở lần thử 2 (q = 3): giãn ngắn hơn
    if (q === 3) c.interval = Math.max(1, Math.round(c.interval * 0.6));
    c.due = now + c.interval * DAY;
  }
  c.ef = Math.max(1.3, c.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return c;
}

export const isDue = (card, now = Date.now()) => !card || card.due <= now;
export const accuracy = (card) => (card && card.seen ? card.correct / card.seen : null);
