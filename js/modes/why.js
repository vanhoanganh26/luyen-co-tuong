// =====================================================================
// "VÌ SAO?" — giải thích một nước đi: ý nghĩa (tự rút từ hình cờ) + số liệu engine
// (nếu bỏ lượt thì sao, nước khác) lấy từ data/insights.json đã kiểm định sẵn.
// =====================================================================
import { Position, parseCoordMove } from '../core/xiangqi.js';
import { analyzeMove, PURPOSES } from '../train/move-insight.js';

let insightsPromise = null;
/** Nạp dữ liệu engine (một lần). Không có cũng không sao — phần ý nghĩa vẫn hiện. */
export function loadInsights() {
  if (!insightsPromise) {
    insightsPromise = (async () => {
      if (window.__XQT_INSIGHTS__) return window.__XQT_INSIGHTS__;
      const res = await fetch('data/insights.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })().catch(() => ({ moves: {}, positions: [] }));
  }
  return insightsPromise;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const fmtScore = (cp) => (Math.abs(cp) > 20000 ? (cp > 0 ? 'thắng' : 'thua') : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1));

/**
 * HTML giải thích nước `iccs` đi từ thế `fen`.
 * data: kết quả loadInsights(); label: hàm đổi ký pháp theo cài đặt
 */
export function whyHTML(fen, iccs, data, label = (x) => x, { title = '' } = {}) {
  const ins = analyzeMove(fen, parseCoordMove(iccs));
  const rec = data?.moves?.[fen + '|' + iccs];
  const side = new Position(fen).turn === 'r' ? 'Đỏ' : 'Đen';
  let h = title ? `<p class="why-title">${esc(title)}</p>` : '';
  h += `<p><span class="why-tag">${esc(PURPOSES[ins.main])}</span></p><ul class="why-list">`;
  for (const t of ins.tags) h += `<li>${esc(t.text)}</li>`;
  h += '</ul>';
  if (rec) {
    const th = rec.threat;
    if (th && th.loss >= 60) {
      // Mô tả đòn đe dọa tính lại ngay trên thế "bỏ lượt" (luôn khớp phiên bản phân tích mới nhất)
      try { th.what = analyzeMove(fen.replace(/ ([wb]) /, (_, x) => (x === 'w' ? ' b ' : ' w ')), parseCoordMove(th.iccs)).tags.slice(0, 2).map((x) => x.text); } catch { /* giữ mô tả cũ */ }
      const what = th.what?.length ? ' — ' + esc(th.what.map((x) => x[0].toLowerCase() + x.slice(1)).join('; ')) : '';
      const size = th.loss > 20000 ? 'thua cờ' : `thiệt khoảng <b>${(th.loss / 100).toFixed(1)}</b>`;
      // ≥ 1.5: có đòn cụ thể (cấp bách); 0.6–1.5: chủ yếu là mất nhịp, nhường tiên thủ cho đối phương
      h += th.loss >= 150
        ? `<p class="why-if"><b>Nếu không đi nước này</b> (bỏ lượt), đối phương có đòn <b>${esc(label(th.vn))}</b>${what}; ${side} ${size}. Đây là nước <b>cấp bách</b>.</p>`
        : `<p class="why-if"><b>Nếu bỏ lượt</b>, đối phương được đi thêm <b>${esc(label(th.vn))}</b>${what} và giành tiên thủ; ${side} ${size}. Nước này chủ yếu để <b>không mất nhịp</b>.</p>`;
    } else if (th) {
      h += `<p class="why-if">Nếu bỏ lượt, đối phương chưa có đòn gì đáng kể (chênh ${(th.loss / 100).toFixed(1)}) — nước này mang tính <b>xây dựng thế trận</b> hơn là đỡ đòn.</p>`;
    }
    const alts = rec.alts || [];
    // Chênh dưới 0,1 điểm: coi như ngang nhau (tránh câu "hơn khoảng 0.0")
    if (rec.best) h += Math.abs(rec.best.diff) < 10
      ? `<p class="why-alt">Engine coi <b>${esc(label(rec.best.vn))}</b> tốt ngang nước này — cả hai đều đi được.</p>`
      : `<p class="why-alt">Engine ưa <b>${esc(label(rec.best.vn))}</b> hơn khoảng ${(rec.best.diff / 100).toFixed(1)}.</p>`;
    else h += '<p class="why-alt">Engine cũng chọn đúng nước này là tốt nhất.</p>';
    if (alts.length) h += `<p class="why-alt muted small">Nước khác: ${alts.map((a) => `${esc(label(a.vn))} (${Math.abs(a.diff) < 10 ? 'ngang' : `${a.diff >= 0 ? 'kém' : 'hơn'} ${(Math.abs(a.diff) / 100).toFixed(1)}`})`).join(', ')}. Điểm sau nước sách: ${fmtScore(rec.eval)} theo bên ${side}.</p>`;
    h += `<p class="muted small">Số liệu: ${esc(data.engine || 'engine')}, độ sâu ${data.depth || '?'}. Phần ý nghĩa do app rút ra từ hình cờ.</p>`;
  } else {
    h += '<p class="muted small">Phần ý nghĩa do app rút ra từ hình cờ (chưa có số liệu engine cho nước này).</p>';
  }
  return h;
}
