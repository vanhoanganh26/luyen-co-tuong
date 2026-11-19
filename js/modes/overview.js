// =====================================================================
// MÀN HÌNH TỔNG QUAN (màn hình chính): cần ôn hôm nay, chuỗi ngày luyện, tỉ lệ đúng,
// nước hay sai nhất, xuất / nhập dữ liệu
// =====================================================================
import { streak, recentDays, openingStats, worstNodes, positionStats, dayKey } from '../train/progress.js';

const $ = (id) => document.getElementById(id);
const pct = (x) => (x == null ? '–' : Math.round(x * 100) + '%');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initOverview(ctx) {
  // ctx: { store, toast, askConfirm, showScreen, openings: () => openingsUI, positions: () => positionsUI, leaveModes }
  const { store, toast } = ctx;

  async function render() {
    const now = Date.now();
    const oUI = ctx.openings(), pUI = ctx.positions();
    $('hmDate').textContent = new Date(now).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });

    // ---- Bài luyện hôm nay (theo bộ khai cuộc của anh) ----
    if (oUI.ready() && oUI.dailyLabel) $('hmDaily').textContent = oUI.dailyLabel();
    // Người dùng mới (chưa chọn bộ khai cuộc): hiện màn chào 3 bước thay cho nút bài luyện
    const noRep = oUI.ready() && oUI.hasRep && !oUI.hasRep();
    $('hmStart').hidden = !noRep;
    $('hmDaily').hidden = !!noRep;

    // ---- Khai cuộc ----
    const openings = oUI.ready() ? oUI.getOpenings() : [];
    const cards = oUI.getCards();
    const ostats = openingStats(openings, cards, now);
    const dueOpen = ostats.reduce((a, s) => a + s.due, 0);
    const startedOps = ostats.filter((s) => s.seen > 0);
    $('hmNOpen').textContent = openings.length ? dueOpen : '…';
    $('hmSOpen').textContent = startedOps.length ? `${startedOps.length}/${openings.length} khai cuộc đã luyện` : 'chưa luyện';

    // ---- Thế cờ ----
    let pdata = null;
    try { pdata = await pUI.getData(); } catch { /* chưa tải được */ }
    const pc = pUI.getCards(), pp = pUI.getProgress();
    const mid = pdata ? positionStats(pdata.puzzles, pc, pp, pUI.themeOf, now) : null;
    const end = pdata ? positionStats([...pdata.endgames, ...pdata.classics], pc, pp, pUI.themeOf, now) : null;
    $('hmNMid').textContent = mid ? mid.due : '…';
    $('hmSMid').textContent = mid ? `đã giải ${mid.done}/${mid.total}` : '';
    $('hmNEnd').textContent = end ? end.due : '…';
    $('hmSEnd').textContent = end ? `hoàn thành ${end.done}/${end.total}` : '';
    const totalDue = dueOpen + (mid?.due || 0) + (end?.due || 0);
    $('hmDueNote').textContent = totalDue
      ? 'Bấm vào từng ô để ôn. Thứ tự ôn ưu tiên nước / thế anh hay sai (lặp lại ngắt quãng kiểu SM-2).'
      : (startedOps.length || mid?.tried || end?.tried)
        ? 'Hôm nay không còn gì đến hạn ôn. Bấm vào ô để luyện thêm nội dung mới.'
        : 'Chưa có gì để ôn — bắt đầu bằng một khai cuộc, một thế trung cuộc hoặc tàn cuộc.';

    // ---- Chuỗi ngày ----
    const act = store.getJSON('activity', {}) || {};
    const st = streak(act, now);
    $('hmStreak').textContent = st.days;
    $('hmToday').textContent = st.today ? 'Hôm nay đã luyện ✓' : 'Hôm nay chưa luyện';
    $('hmToday').className = 'pill ' + (st.today ? 'learn' : 'test');
    const days = recentDays(act, 28, now);
    const max = Math.max(1, ...days.map((d) => d.count));
    $('hmHeat').innerHTML = days.map((d) => {
      const lv = d.count === 0 ? 0 : Math.min(4, 1 + Math.floor((d.count / max) * 3.999));
      return `<span class="hc l${lv}${d.day === dayKey(now) ? ' today' : ''}" title="${d.day}: ${d.count} lần"></span>`;
    }).join('');
    const sum = (k) => Object.values(act).reduce((a, v) => a + (v[k] || 0), 0);
    $('hmTotals').textContent = `Tổng: ${sum('open')} nước khai cuộc · ${sum('mid')} thế trung cuộc · ${sum('end')} thế tàn cuộc · ${sum('play')} ván với máy.`;
    const ps = store.getJSON('purposeStats', null), rs = store.getJSON('readStats', {}) || {};
    const rv = Object.values(rs);
    const think = [];
    if (ps?.total) think.push(`Đoán ý đồ: đúng ${ps.right}/${ps.total} (${Math.round((100 * ps.right) / ps.total)}%)`);
    if (rv.length) think.push(`Đọc thế trận: ${rv.length} thế, trung bình ${(rv.reduce((a, x) => a + x.score, 0) / rv.length).toFixed(1)}/7`);
    if (think.length) $('hmTotals').textContent += ' ' + think.join(' · ') + '.';

    // ---- Tỉ lệ đúng theo khai cuộc ----
    const rows = startedOps.sort((a, b) => (a.acc ?? 1) - (b.acc ?? 1));
    $('hmOpenings').innerHTML = rows.length
      ? rows.map((s) => bar(s.name, s.acc, `${pct(s.acc)} · ${s.nodes} nước${s.due ? ` · ${s.due} cần ôn` : ''}`, `data-op="${esc(s.id)}"`)).join('')
      : '<li class="muted small">Chưa luyện khai cuộc nào.</li>';
    $('hmOpenings').querySelectorAll('[data-op]').forEach((li) => {
      li.onclick = () => { ctx.leaveModes(); oUI.trainById(li.dataset.op); };
    });

    // ---- Thế cờ theo chủ đề ----
    const groups = [...(mid?.groups || []).map((g) => ({ ...g, k: 'Trung cuộc' })), ...(end?.groups || []).filter((g) => !['Thắng', 'Hòa'].includes(g.group)).map((g) => ({ ...g, k: 'Tàn cuộc' }))]
      .filter((g) => g.tried);
    $('hmPositions').innerHTML = groups.length
      ? groups.map((g) => bar(`${g.k}: ${g.group}`, g.solved / g.total, `${g.solved}/${g.total} đạt`)).join('')
      : '<li class="muted small">Chưa làm thế cờ nào.</li>';

    // ---- Nước hay sai nhất ----
    const worst = worstNodes(openings, cards, 8);
    $('hmWorst').innerHTML = worst.length
      ? worst.map((w, i) => `<li><button class="worst-item" data-i="${i}"><span class="w-name">${esc(w.opName)}</span><span class="muted small">${esc(w.lineName)} · nước ${w.ply} (${w.side === 'r' ? 'Đỏ' : 'Đen'}): ${esc(ctx.moveLabelVN(w.move))} · sai ${w.lapses} lần</span></button></li>`).join('')
      : '<li class="muted small">Chưa có nước nào bị sai — tốt lắm!</li>';
    $('hmWorst').querySelectorAll('.worst-item').forEach((b) => {
      const w = worst[+b.dataset.i];
      b.onclick = () => { ctx.leaveModes(); oUI.trainById(w.opId, w.side, 'test'); };
    });

    const last = store.getJSON('lastExport', null);
    $('hmDataNote').textContent = last ? `Lần xuất gần nhất: ${new Date(last).toLocaleString('vi-VN')}.` : 'Chưa xuất lần nào.';
  }

  function bar(label, value, right, attrs = '') {
    const w = value == null ? 0 : Math.round(value * 100);
    const cls = value == null ? '' : value >= 0.85 ? 'good' : value >= 0.6 ? 'mid' : 'low';
    return `<li class="bar-row${attrs ? ' clickable' : ''}" ${attrs}><span class="bar-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill ${cls}" style="width:${w}%"></span></span><span class="bar-val small">${esc(right)}</span></li>`;
  }

  // ---- Ô "Cần ôn" ----
  $('hmDueOpen').onclick = () => {
    const oUI = ctx.openings();
    if (!oUI.ready()) { toast('Đang tải dữ liệu khai cuộc…'); return; }
    ctx.leaveModes(); oUI.startReview();
  };
  $('hmDueMid').onclick = () => { ctx.leaveModes(); ctx.positions().reviewTab('mid'); };
  $('hmDueEnd').onclick = () => { ctx.leaveModes(); ctx.positions().reviewTab('end'); };

  // ---- Xuất / nhập dữ liệu ----
  function exportData() {
    // Trang xem thử trên claude.ai chạy trong khung bị chặn tải file
    if (window.__XQT_PREVIEW__ && window.self !== window.top) { toast('Bản xem thử trên claude.ai không tải file được — hãy xuất từ app chạy trên máy hoặc GitHub Pages.'); return; }
    store.setJSON('lastExport', Date.now());
    const data = store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `luyen-co-tuong-${dayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Đã xuất dữ liệu — file nằm trong thư mục Tải về.');
    render();
  }
  function pickImport() { $('importFile').value = ''; $('importFile').click(); }
  $('importFile').addEventListener('change', async () => {
    const f = $('importFile').files[0];
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { toast('File không đọc được (không phải JSON).'); return; }
    if (!obj || obj.app !== 'xiangqi-trainer') { toast('File không phải dữ liệu của app Luyện Cờ Tướng.'); return; }
    const keys = Object.keys(obj.data || {});
    const when = obj.exportedAt ? new Date(obj.exportedAt).toLocaleString('vi-VN') : 'không rõ';
    const ok = await ctx.askConfirm('Nhập dữ liệu',
      `File xuất lúc ${when}, gồm ${keys.length} mục (tiến độ, ván đã lưu, biến tự soạn, cài đặt…). Các mục trùng trên máy này sẽ được thay bằng dữ liệu trong file. Tiếp tục?`);
    if (!ok) return;
    try {
      ctx.store.importAll(obj);
      toast('Đã nhập dữ liệu — đang tải lại app…');
      setTimeout(() => location.reload(), 800);
    } catch (e) { toast('Nhập lỗi: ' + e.message); }
  });
  $('hmExport').onclick = exportData;
  $('hmImport').onclick = pickImport;
  $('setExport').onclick = exportData;
  $('setImport').onclick = () => { $('dlgSettings').close(); pickImport(); };

  function enter() { ctx.leaveModes(); ctx.showScreen('home'); render(); }
  return { enter, render };
}
