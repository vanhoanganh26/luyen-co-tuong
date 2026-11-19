// =====================================================================
// ỨNG DỤNG CHÍNH: bàn cờ tự do + luyện khai cuộc
// Nối các phần: luật (core) <-> bàn cờ (ui) <-> lưu trữ (storage)
// =====================================================================
import { revealInList } from './ui/reveal.js';
import { Position, START_FEN, RED, colorOf } from './core/xiangqi.js';
import { parseNotation } from './core/notation.js';
import { Game } from './core/game.js';
import { BoardView } from './ui/board-view.js';
import { BOARD_THEMES, PIECE_SETS, PIECE_STYLES } from './ui/board-themes.js';
import { Sound } from './ui/sound.js';
import { store } from './storage/storage.js';
import { initOpenings } from './modes/openings.js';
import { initPlay } from './modes/play.js';
import { initEditor } from './modes/editor.js';
import { initPositions } from './modes/positions.js';
import { initOverview } from './modes/overview.js';
import { initThink } from './modes/think.js';
import { moveToNotation } from './core/notation.js';
import { engine, EngineClient } from './engine/client.js';
import { renderAfterOpening } from './modes/after-opening.js';

export const APP_VERSION = '0.11.5';

const $ = (id) => document.getElementById(id);

// ---------- Cài đặt ----------
const DEFAULTS = {
  pieceStyle: 'han',     // 'han' | 'thuphap' | 'viet' | 'icon'
  boardTheme: 'theo',    // xem BOARD_THEMES trong js/ui/board-themes.js ('theo' = theo giao diện sáng/tối)
  pieceSet: 'theo',      // xem PIECE_SETS
  notation: 'vn',        // 'vn' | 'wxf'
  vnAdvance: '.',        // '.' | '+'
  repetitionRule: 'warn',// 'warn' | 'draw'
  theme: 'auto',         // 'auto' | 'light' | 'dark'
  showLegal: true,
  sound: true,
  nnue: 'auto',          // 'auto' | 'on' | 'off' — tải mạng NNUE cho Fairy-Stockfish
};
const settings = { ...DEFAULTS, ...(store.getJSON('settings') || {}) };
const saveSettings = () => store.setJSON('settings', settings);
// 0.11: bộ màu mới Ngọc ngà / Sơn mài — chuyển bàn & quân về "Theo giao diện" một lần (anh vẫn đổi lại được trong Cài đặt)
if (settings.lookVer !== 2) { settings.boardTheme = 'theo'; settings.pieceSet = 'theo'; settings.lookVer = 2; saveSettings(); }

// ---------- Ván cờ ----------
let game;
try {
  const saved = store.getJSON('currentGame');
  game = saved ? Game.fromJSON(saved) : new Game();
} catch { game = new Game(); }
let flipped = !!store.getJSON('flipped', false);
const saveGame = () => store.setJSON('currentGame', game.toJSON());

// ---------- Bàn cờ ----------
// `ctl` = bộ điều khiển đang chiếm bàn cờ (VD: chế độ luyện khai cuộc); null = bàn tự do
let ctl = null;
const view = new BoardView($('board'), {
  canPick: (s) => {
    if (ctl) return ctl.canPick(s);
    if (gameOver() || freeAo.preview) return false;
    const p = game.pos.board[s];
    return !!p && colorOf(p) === game.pos.turn;
  },
  getLegalTargets: (s) => (ctl ? ctl.targets(s) : game.pos.legalMoves(s).map((m) => m.to)),
  onMove: (m) => (ctl ? ctl.onMove(m) : playMove(m, !m.dragged)),
});

function gameOver() {
  return game.pos.status({ repetitionRule: settings.repetitionRule }).over;
}

function playMove(m, animate = true) {
  if (game.ply < game.moves.length) toast('Đã tạo diễn biến mới từ nước này');
  const entry = game.play(m);
  if (!entry) { Sound.error(); return false; }
  saveGame();
  const st = game.pos.status({ repetitionRule: settings.repetitionRule });
  if (st.over) Sound.end();
  else if (entry.check) Sound.check();
  else if (entry.captured) Sound.capture();
  else Sound.move();
  refresh(animate ? { from: m.from, to: m.to } : null);
  return true;
}

// ---------- Bàn tự do: "Phân tích thế này: triển khai tiếp thế nào?" ----------
// Nhận xét theo bên ở phía dưới bàn (lật bàn để xem cho bên kia).
const freeAo = { token: 0, fen: null, preview: false };
function closeFreePlan() { freeAo.token++; freeAo.fen = null; freeAo.preview = false; $('freePlanCard').hidden = true; }
$('freePlanClose').onclick = () => { closeFreePlan(); refresh(); };
$('freePlanBtn').onclick = () => {
  if (ctl || game.pos.status().over) return;
  const my = ++freeAo.token;
  freeAo.fen = game.pos.fen();
  freeAo.preview = false;
  const me = view.flipped ? 'b' : 'r';
  view.clearSelection();
  $('freePlanCard').hidden = false;
  $('freePlanNote').textContent = `Nhận xét theo bên ${SIDE[me]} (bên ở dưới bàn — lật bàn rồi bấm lại để xem cho bên kia).`;
  renderAfterOpening($('freePlanBox'), {
    fen: freeAo.fen, me, view, label: moveLabelVN, engine,
    title: 'Triển khai tiếp thế nào?', backLabel: 'Về thế đang xem',
    isActive: () => !ctl && freeAo.token === my && !$('panelFree').hidden,
    onPreview: (on) => { freeAo.preview = on; if (!on) refresh(); },
  });
  $('freePlanCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ---------- Hiển thị ----------
const SIDE = { r: 'Đỏ', b: 'Đen' };

function moveLabel(e) {
  if (settings.notation === 'wxf') return e.wxf;
  return settings.vnAdvance === '+' ? e.vnPlus : e.vn;
}

function refresh(animate = null) {
  if (ctl) return; // đang luyện: bàn cờ do chế độ luyện vẽ
  const pos = game.pos;
  if (freeAo.fen && freeAo.fen !== pos.fen()) closeFreePlan(); // đã sang thế khác
  $('freePlanBtn').disabled = pos.status().over;
  const st = pos.status({ repetitionRule: settings.repetitionRule });
  const checkSq = st.inCheck ? pos.kingSq(pos.turn) : -1;
  view.render({ board: pos.board, last: game.lastMove(), checkSq, animate });
  view.setInteractive(!st.over);

  // Dòng trạng thái
  const el = $('status');
  el.className = 'status';
  let text;
  if (st.over) {
    el.classList.add('over');
    if (st.reason === 'checkmate') text = `${SIDE[pos.turn]} bị chiếu bí — ${SIDE[st.winner]} thắng`;
    else if (st.reason === 'stalemate') text = `${SIDE[pos.turn]} hết nước đi — ${SIDE[st.winner]} thắng`;
    else text = 'Lặp thế 3 lần — xử hòa';
  } else if (st.repetition >= 3) {
    el.classList.add('warn');
    text = st.perpetual
      ? `Lặp thế lần ${st.repetition}: ${SIDE[st.perpetual]} đang chiếu mãi — phải đổi nước`
      : `Lặp thế lần ${st.repetition} — nên đổi nước (hoặc bật "Xử hòa" trong Cài đặt)`;
  } else if (st.inCheck) {
    el.classList.add('check');
    text = `${SIDE[pos.turn]} đang bị chiếu!`;
  } else {
    text = `Lượt: ${SIDE[pos.turn]}`;
  }
  el.textContent = text;

  renderMoves();
  renderComment();
  $('btnStart').disabled = $('btnBack').disabled = game.ply === 0;
  $('btnFwd').disabled = $('btnEnd').disabled = game.ply === game.moves.length;
}

function renderMoves() {
  const ol = $('moves');
  ol.innerHTML = '';
  const moves = game.moves;
  $('moveCount').textContent = `${moves.length} nước`;
  if (!moves.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="empty">Chưa có nước nào. Chạm vào quân để đi, hoặc nhập ký pháp bên dưới.</span>';
    ol.appendChild(li);
    return;
  }
  // Nếu thế đầu là lượt Đen thì hiệp 1 bỏ trống ô Đỏ
  const startBlack = new Position(game.startFen).turn !== RED;
  const offset = startBlack ? 1 : 0;
  const total = moves.length + offset;
  let curBtn = null;
  for (let i = 0; i < total; i += 2) {
    const li = document.createElement('li');
    const no = document.createElement('span');
    no.className = 'no';
    no.textContent = `${i / 2 + 1}.`;
    li.appendChild(no);
    for (let k = 0; k < 2; k++) {
      const idx = i + k - offset;
      const b = document.createElement('button');
      b.className = 'mv ' + (k === 0 ? 'red' : 'black');
      if (idx >= 0 && idx < moves.length) {
        const e = moves[idx];
        b.textContent = moveLabel(e);
        if (e.check) { b.classList.add('chk'); b.title = 'Chiếu tướng'; }
        b.addEventListener('click', () => { game.goto(idx + 1); saveGame(); refresh(); });
        if (idx + 1 === game.ply) { b.classList.add('cur'); curBtn = b; }
      } else { b.disabled = true; b.textContent = idx < 0 ? '…' : ''; }
      li.appendChild(b);
    }
    ol.appendChild(li);
  }
  revealInList(curBtn);
}

/** Chú thích của nước đang xem (khi xem lại một biến khai cuộc) */
function renderComment() {
  const card = $('freeCommentCard');
  if (!game.title) { card.hidden = true; $('soonCard').hidden = false; return; }
  card.hidden = false;
  $('soonCard').hidden = true;
  $('freeTitle').textContent = game.title;
  const e = game.lastMove();
  let txt = e ? (e.comment || 'Không có chú thích cho nước này.') : 'Bấm ▶ để xem từng nước.';
  if (game.ply === game.moves.length && game.plan) txt += (e && e.comment ? ' ' : '') + '\nKế hoạch: ' + game.plan;
  $('freeComment').textContent = txt;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Giao diện sáng/tối, âm thanh ----------
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  // Màu thanh trạng thái hệ điều hành (điện thoại) theo nền app
  const dark = isDarkNow();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', dark ? '#12100e' : '#f6f4ef'); m.removeAttribute('media'); });
  if (typeof applyLook === 'function' && view) applyLook(); // bàn & quân "theo giao diện"
}
function applySound() {
  Sound.setEnabled(settings.sound);
  $('btnSound').classList.toggle('off', !settings.sound);
}
function isDarkNow() {
  if (settings.theme !== 'auto') return settings.theme === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// ---------- Nút bấm ----------
function navigate(fn) { fn(); saveGame(); view.clearSelection(); refresh(); }
$('btnStart').onclick = () => navigate(() => game.goto(0));
$('btnBack').onclick = () => navigate(() => game.back());
$('btnFwd').onclick = () => {
  const next = game.moves[game.ply];
  if (!next) return;
  game.forward(); saveGame(); view.clearSelection();
  refresh({ from: next.from, to: next.to }); // tiến 1 nước có hiệu ứng trượt quân
};
$('btnEnd').onclick = () => navigate(() => game.goto(game.moves.length));
$('btnFlip').onclick = () => { flipped = !flipped; store.setJSON('flipped', flipped); view.setFlipped(flipped); };
$('btnSound').onclick = () => { settings.sound = !settings.sound; saveSettings(); applySound(); toast(settings.sound ? 'Đã bật âm thanh' : 'Đã tắt âm thanh'); };
$('btnTheme').onclick = () => { settings.theme = isDarkNow() ? 'light' : 'dark'; saveSettings(); applyTheme(); };
$('btnNew').onclick = async () => {
  if (ctl) { toast('Đang luyện — bấm "Về danh sách" để thoát trước.'); return; }
  if (game.moves.length && !(await askConfirm('Ván mới', 'Bắt đầu ván mới? Biên bản hiện tại sẽ bị xóa.'))) return;
  game = new Game(START_FEN); saveGame(); view.clearSelection();
  showScreen('free');
  toast('Đã bắt đầu ván mới');
};

/** Hộp xác nhận trong trang (không dùng window.confirm để chạy được ở mọi nơi) */
function askConfirm(title, text) {
  const d = $('dlgConfirm');
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true });
    d.returnValue = '';
    d.showModal();
    $('confirmYes').focus();
  });
}

// Nhập nước bằng ký pháp
$('moveForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inp = $('moveText');
  const txt = inp.value.trim();
  if (!txt) return;
  if (gameOver()) { toast('Ván đã kết thúc'); return; }
  const m = parseNotation(game.pos, txt, settings.notation);
  if (!m) { Sound.error(); toast(`Không hiểu hoặc không hợp lệ: "${txt}"`); return; }
  if (playMove(m)) inp.value = '';
});

// ---------- Hộp thoại FEN ----------
const dlgFen = $('dlgFen');
$('btnFen').onclick = () => {
  if (ctl) { toast('Đang luyện khai cuộc — FEN dùng cho bàn tự do.'); return; } $('fenText').value = game.pos.fen(); $('fenErr').textContent = ''; dlgFen.showModal(); };
$('fenCancel').onclick = () => dlgFen.close();
$('fenStart').onclick = () => { $('fenText').value = START_FEN; };
$('fenEmpty').onclick = () => { $('fenText').value = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1'; $('fenErr').textContent = 'Lưu ý: hai tướng đang đối mặt — chỉ để làm mẫu, hãy sửa FEN trước khi nạp.'; };
$('fenCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('fenText').value); toast('Đã sao chép FEN'); }
  catch { $('fenText').select(); document.execCommand?.('copy'); toast('Đã chọn FEN — nhấn giữ để sao chép'); }
};
$('fenLoad').onclick = () => {
  try {
    const g = new Game($('fenText').value);
    game = g; saveGame(); view.clearSelection(); dlgFen.close(); showScreen('free');
    toast('Đã nạp thế cờ');
  } catch (e) { $('fenErr').textContent = 'FEN không hợp lệ: ' + e.message; }
};

// ---------- Hộp thoại Cài đặt ----------
const dlgSet = $('dlgSettings');
const bindSel = (id, key, after) => {
  const s = $(id);
  s.value = String(settings[key]);
  s.onchange = () => { settings[key] = s.value; saveSettings(); after?.(); };
};
const bindChk = (id, key, after) => {
  const s = $(id);
  s.checked = !!settings[key];
  s.onchange = () => { settings[key] = s.checked; saveSettings(); after?.(); };
};
$('btnSettings').onclick = () => {
  fillLook();
  bindSel('setBoard', 'boardTheme', applyLook);
  bindSel('setPieceSet', 'pieceSet', applyLook);
  bindSel('setPieces', 'pieceStyle', applyLook);
  bindSel('setNotation', 'notation', () => { renderMoves(); updatePlaceholder(); });
  bindSel('setAdvance', 'vnAdvance', () => { renderMoves(); updatePlaceholder(); });
  bindSel('setRepeat', 'repetitionRule', () => refresh());
  bindSel('setTheme', 'theme', applyTheme);
  bindSel('setNnue', 'nnue', () => toast('Đổi cài đặt NNUE: tải lại trang để áp dụng.'));
  bindChk('setLegal', 'showLegal', () => view.setShowLegal(settings.showLegal));
  bindChk('setSound', 'sound', applySound);
  $('storageNote').textContent = store.adapter.persistent
    ? `Phiên bản ${APP_VERSION}. Cài đặt và ván đang chơi được lưu trên máy này.`
    : `Phiên bản ${APP_VERSION}. Trình duyệt đang chặn lưu trữ — dữ liệu chỉ giữ trong phiên này.`;
  dlgSet.showModal();
  applyLook();
};

// ---------- Giao diện bàn & quân (kèm bàn xem thử trong Cài đặt) ----------
let preview = null;
function fillLook() {
  const opts = (list) => list.map((x) => `<option value="${x.id}">${x.name}</option>`).join('');
  $('setBoard').innerHTML = opts(BOARD_THEMES);
  $('setPieceSet').innerHTML = opts(PIECE_SETS);
  $('setPieces').innerHTML = opts(PIECE_STYLES);
}
/** Kiểu bàn / quân thực dùng: "theo" => Ngọc ngà (sáng) hoặc Sơn mài (tối) */
const resolveLook = (id) => (id === 'theo' ? (isDarkNow() ? 'sonmai' : 'ngocnga') : id);
function lookOf(v) {
  const bt = resolveLook(settings.boardTheme), ps = resolveLook(settings.pieceSet);
  v.boardTheme = bt; v.pieceSet = ps; v.pieceStyle = settings.pieceStyle;
  if (v.svg) { v.setBoardTheme(bt); v.setPieceSet(ps); v.setPieceStyle(settings.pieceStyle); }
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (settings.theme === 'auto') applyTheme(); });
function applyLook() {
  // Giá trị cũ không còn trong danh sách => về mặc định
  if (!BOARD_THEMES.some((x) => x.id === settings.boardTheme)) settings.boardTheme = 'theo';
  if (!PIECE_SETS.some((x) => x.id === settings.pieceSet)) settings.pieceSet = 'theo';
  if (!PIECE_STYLES.some((x) => x.id === settings.pieceStyle)) settings.pieceStyle = 'han';
  lookOf(view);
  if (dlgSet.open) {
    if (!preview) {
      preview = new BoardView($('setPreview'), { canPick: () => false, getLegalTargets: () => [], onMove: () => {} });
      preview.setInteractive(false);
    }
    lookOf(preview);
    // Thế xem thử: thế khởi đầu
    const b = new Game().pos.board.slice();
    preview.render({ board: b, last: null, checkSq: -1 });
  }
}
function updatePlaceholder() {
  const eg = settings.notation === 'wxf' ? 'C2.5, H8+7' : settings.vnAdvance === '+' ? 'P2-5, M8+7' : 'P2-5, M8.7';
  $('moveText').placeholder = `Nhập nước, VD: ${eg}`;
}

// ---------- Chuyển màn hình ----------
let positionsUI = null; // gán sau khi khởi tạo các chế độ
let thinkUI = null;
function showScreen(name) {
  // name: 'home' | 'free' | 'openings' | 'train' | 'play' | 'edit' | 'mid' | 'end' (danh sách thế cờ) | 'pos' (đang giải)
  const listScreen = name === 'mid' || name === 'end';
  closeFreePlan(); // đổi màn hình => đóng phân tích của bàn tự do
  $('screenHome').hidden = name !== 'home';
  $('screenOpenings').hidden = name !== 'openings';
  $('screenThink').hidden = name !== 'think';
  $('panelThink').hidden = name !== 'thinkpos';
  $('tabThink').setAttribute('aria-selected', String(name === 'think' || name === 'thinkpos'));
  $('screenPositions').hidden = !listScreen;
  $('screenBoard').hidden = name === 'openings' || listScreen || name === 'home' || name === 'think';
  $('panelPos').hidden = name !== 'pos';
  $('panelFree').hidden = name !== 'free';
  $('panelTrain').hidden = name !== 'train';
  $('panelPlay').hidden = name !== 'play';
  $('panelEdit').hidden = name !== 'edit';
  document.body.classList.toggle('training', name === 'train' || name === 'play' || name === 'edit' || name === 'pos' || name === 'thinkpos');
  const posTab = positionsUI ? positionsUI.tab() : null;
  $('tabMid').setAttribute('aria-selected', String(name === 'mid' || (name === 'pos' && posTab === 'mid')));
  $('tabEnd').setAttribute('aria-selected', String(name === 'end' || (name === 'pos' && posTab === 'end')));
  $('tabFree').setAttribute('aria-selected', String(name === 'free'));
  $('tabHome').setAttribute('aria-selected', String(name === 'home'));
  document.querySelector('.tab[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('tabOpen').setAttribute('aria-selected', String(name === 'openings' || name === 'train' || name === 'edit'));
  $('tabPlay').setAttribute('aria-selected', String(name === 'play'));
  if (name === 'free') { view.clearSelection(); if (view.flipped !== flipped) view.setFlipped(flipped); refresh(); }
  // Nhóm "Luyện thế" (Trung cuộc / Tàn cuộc / Tư duy) và lớp theo màn hình cho CSS
  const inPos = ['mid', 'end', 'think', 'pos', 'thinkpos'].includes(name);
  $('tabPosGrp').setAttribute('aria-selected', String(inPos));
  if (name === 'mid' || name === 'end' || name === 'think') store.setJSON('lastPosTab', name);
  document.body.classList.toggle('grp-pos', name === 'mid' || name === 'end' || name === 'think');
  document.body.className = document.body.className.replace(/\bscr-\S+/g, '').trim();
  document.body.classList.add('scr-' + name);
  // Màn có bàn cờ: "khung cố định" — trang không cuộn, bàn cờ đứng yên, chỉ bảng bên cuộn bên trong
  document.body.classList.toggle('board-mode', !$('screenBoard').hidden);
  document.querySelectorAll('#screenBoard > .panel').forEach((p) => { p.scrollTop = 0; });
  setChrome();
  window.scrollTo({ top: 0 });
}
/** Chiều cao thanh trên + hàng tab (CSS dùng để tính cỡ bàn cờ vừa khít màn hình) */
function setChrome() {
  // Điện thoại: thanh điều hướng nằm ở đáy (trừ chiều cao); máy tính: cột bên trái (không trừ)
  const tabs = document.querySelector('.tabs');
  const top = document.querySelector('.topbar').offsetHeight;
  const bottomNav = window.matchMedia('(max-width: 899px)').matches && tabs ? tabs.offsetHeight : 0;
  document.documentElement.style.setProperty('--top-h', top + 'px');
  document.documentElement.style.setProperty('--chrome', (top + bottomNav) + 'px');
}
window.addEventListener('resize', setChrome);
window.addEventListener('orientationchange', () => setTimeout(setChrome, 300));
function leaveModes() {
  if (editorUI.isOpen()) editorUI.close();
  if (openingsUI.isTraining()) openingsUI.exit(false);
  playUI.leave();
  positionsUI.leave();
  thinkUI?.leave();
}
$('tabFree').onclick = () => { leaveModes(); showScreen('free'); };
$('tabHome').onclick = () => overviewUI.enter();
$('tabOpen').onclick = () => { leaveModes(); showScreen('openings'); openingsUI.renderList(); };
$('tabPlay').onclick = () => { if (editorUI.isOpen()) editorUI.close(); if (openingsUI.isTraining()) openingsUI.exit(false); positionsUI.leave(); playUI.enter(); };
$('tabMid').onclick = () => { leaveModes(); positionsUI.enter('mid'); };
// Điện thoại: mục "Luyện thế" mở lại phần đã dùng gần nhất (Trung cuộc / Tàn cuộc / Tư duy)
$('tabPosGrp').onclick = () => ({ mid: $('tabMid'), end: $('tabEnd'), think: $('tabThink') }[store.getJSON('lastPosTab', 'mid')] || $('tabMid')).click();
// Menu "Thêm" (điện thoại): Bàn cờ tự do, phân tích ván, cài đặt, dữ liệu
const dlgMore = $('dlgMore');
$('tabMore').onclick = () => dlgMore.showModal();
const fromMore = (fn) => () => { dlgMore.close(); fn(); };
$('moreFree').onclick = fromMore(() => $('tabFree').click());
$('moreGame').onclick = fromMore(() => $('btnGame').click());
$('moreSettings').onclick = fromMore(() => $('btnSettings').click());
$('moreExport').onclick = fromMore(() => $('hmExport').click());
$('moreImport').onclick = fromMore(() => $('hmImport').click());
$('tabEnd').onclick = () => { leaveModes(); positionsUI.enter('end'); };

/** Nạp một biến / thế cờ vào bàn tự do (xem lại có chú thích) */
function loadIntoFree(data) {
  try {
    game = Game.fromJSON(data);
    saveGame();
    showScreen('free');
  } catch (e) { toast('Không nạp được: ' + e.message); }
}

const setController = (c) => { ctl = c; view.clearSelection(); if (!c) refresh(); };
const moveLabelVN = (vn) => (settings.vnAdvance === '+' ? vn.replace('.', '+') : vn);
/** Ký pháp của nước m trong thế pos theo cài đặt hiển thị */
const moveLabelOf = (pos, m) => moveLabel({ vn: moveToNotation(pos, m), vnPlus: moveToNotation(pos, m, { style: 'vn', vnAdvance: '+' }), wxf: moveToNotation(pos, m, { style: 'wxf' }) });
const editorUI = initEditor({ view, toast, Sound, setController, showScreen, moveLabel, moveLabelOf, askConfirm });
const openingsUI = initOpenings({
  editor: editorUI, askConfirm,
  view, store, settings, Sound, toast, showScreen, loadIntoFree, setController, moveLabelVN,
  startPlay: (o) => playUI.startFrom(o),
  getFreeGame: () => game,
});
const playUI = initPlay({
  view, store, settings, Sound, toast, showScreen, setController, moveLabel, moveLabelVN, loadIntoFree, askConfirm,
  getFreeGame: () => game,
  getOpenings: () => openingsUI.getOpenings(),
});
positionsUI = initPositions({
  view, store, settings, Sound, toast, showScreen, setController, moveLabelOf, loadIntoFree,
  startPlay: (o) => playUI.startFrom(o),
});

thinkUI = initThink({
  view, store, Sound, toast, showScreen, setController, moveLabelVN,
  getOpenings: () => (openingsUI.ready() ? openingsUI.getOpenings() : []),
});
$('tabThink').onclick = () => { leaveModes(); thinkUI.enter(); };

// ---------- Phím tắt (máy tính) ----------
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
  if (ctl) { if (e.key === 'Escape') view.clearSelection(); return; }
  // (Khi đang soạn biến, phím tắt điều hướng của bàn tự do bị tắt)
  if (e.key === 'ArrowLeft') { $('btnBack').click(); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { $('btnFwd').click(); e.preventDefault(); }
  else if (e.key === 'Home') $('btnStart').click();
  else if (e.key === 'End') $('btnEnd').click();
  else if (e.key === 'f' || e.key === 'F') $('btnFlip').click();
  else if (e.key === 'Escape') view.clearSelection();
});

// ---------- Khởi động ----------
engine.useNnue = settings.nnue === 'on' || (settings.nnue === 'auto' && !EngineClient.isWeakDevice());
applyTheme();
applySound();
applyLook();
view.showLegal = settings.showLegal;
view.flipped = flipped;
view._drawGrid();
updatePlaceholder();
refresh();
const overviewUI = initOverview({
  store, toast, askConfirm, showScreen, leaveModes, moveLabelVN,
  openings: () => openingsUI, positions: () => positionsUI,
});
// Bài luyện hôm nay (khai cuộc) từ màn hình Tổng quan
// Màn chào: chưa có bộ khai cuộc => mở hộp chọn bộ ngay trên màn Hôm nay
$('hmStartPick').onclick = () => {
  if (!openingsUI.ready()) { toast('Đang tải dữ liệu khai cuộc…'); return; }
  $('btnRepPick').click();
  $('dlgRep').addEventListener('close', () => { if (!$('screenHome').hidden) overviewUI.render(); }, { once: true });
};
$('hmDaily').onclick = () => {
  if (!openingsUI.ready()) { toast('Đang tải dữ liệu khai cuộc…'); return; }
  leaveModes(); showScreen('openings'); openingsUI.renderList(); openingsUI.startDaily();
};
// Mở app vào màn hình Tổng quan; vẽ lại khi dữ liệu khai cuộc / thế cờ tải xong
overviewUI.enter();
Promise.all([openingsUI.load(), positionsUI.load()]).then(() => { if (!$('screenHome').hidden) overviewUI.render(); });

// Service worker: chỉ đăng ký khi chạy qua http(s) (GitHub Pages / máy chủ thử)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.__XQT_PREVIEW__) {
  window.addEventListener('load', () => {
    // Có bản mới: service worker mới nắm quyền => tải lại trang 1 lần để dùng ngay bản mới
    // (lần cài đầu tiên cũng phát sự kiện này — khi đó trang chưa có SW cũ nên bỏ qua)
    let prevController = navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const had = !!prevController;
      prevController = navigator.serviceWorker.controller;
      if (!had || reloading) return;
      reloading = true;
      toast('Đã có bản mới — đang tải lại app…');
      setTimeout(() => location.reload(), 900);
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(async (reg) => {
      // App cài trên điện thoại thường chạy nền lâu: mỗi lần mở lại thì kiểm tra bản mới
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      // Có file Fairy-Stockfish mà trang chưa "cross-origin isolated" => tải lại 1 lần để service worker gắn header
      if (self.crossOriginIsolated) return;
      try {
        const r = await fetch('engine/stockfish.js', { method: 'HEAD', cache: 'no-store' });
        if (r.ok && !sessionStorage.getItem('xqtCoiReload')) {
          sessionStorage.setItem('xqtCoiReload', '1');
          await navigator.serviceWorker.ready;
          location.reload();
        }
      } catch { /* không có engine: bỏ qua */ }
    }).catch((e) => console.warn('SW lỗi:', e));
  });
}

// Mở cho bảng điều khiển trình duyệt để thử nhanh
window.xqt = { game: () => game, settings, store };
window.xqtFlipped = () => view.flipped;
