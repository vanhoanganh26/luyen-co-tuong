// =====================================================================
// ỨNG DỤNG CHÍNH: bàn cờ tự do + luyện khai cuộc
// Nối các phần: luật (core) <-> bàn cờ (ui) <-> lưu trữ (storage)
// =====================================================================
import { Position, START_FEN, RED, colorOf } from './core/xiangqi.js';
import { parseNotation } from './core/notation.js';
import { Game } from './core/game.js';
import { BoardView } from './ui/board-view.js';
import { Sound } from './ui/sound.js';
import { store } from './storage/storage.js';
import { initOpenings } from './modes/openings.js';
import { initPlay } from './modes/play.js';
import { initEditor } from './modes/editor.js';
import { initPositions } from './modes/positions.js';
import { initOverview } from './modes/overview.js';
import { moveToNotation } from './core/notation.js';
import { engine, EngineClient } from './engine/client.js';

export const APP_VERSION = '0.6.0';

const $ = (id) => document.getElementById(id);

// ---------- Cài đặt ----------
const DEFAULTS = {
  pieceStyle: 'han',     // 'han' | 'viet'
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
    if (gameOver()) return false;
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

// ---------- Hiển thị ----------
const SIDE = { r: 'Đỏ', b: 'Đen' };

function moveLabel(e) {
  if (settings.notation === 'wxf') return e.wxf;
  return settings.vnAdvance === '+' ? e.vnPlus : e.vn;
}

function refresh(animate = null) {
  if (ctl) return; // đang luyện: bàn cờ do chế độ luyện vẽ
  const pos = game.pos;
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
  curBtn?.scrollIntoView({ block: 'nearest' });
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
  bindSel('setPieces', 'pieceStyle', () => view.setPieceStyle(settings.pieceStyle));
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
};
function updatePlaceholder() {
  const eg = settings.notation === 'wxf' ? 'C2.5, H8+7' : settings.vnAdvance === '+' ? 'P2-5, M8+7' : 'P2-5, M8.7';
  $('moveText').placeholder = `Nhập nước, VD: ${eg}`;
}

// ---------- Chuyển màn hình ----------
let positionsUI = null; // gán sau khi khởi tạo các chế độ
function showScreen(name) {
  // name: 'home' | 'free' | 'openings' | 'train' | 'play' | 'edit' | 'mid' | 'end' (danh sách thế cờ) | 'pos' (đang giải)
  const listScreen = name === 'mid' || name === 'end';
  $('screenHome').hidden = name !== 'home';
  $('screenOpenings').hidden = name !== 'openings';
  $('screenPositions').hidden = !listScreen;
  $('screenBoard').hidden = name === 'openings' || listScreen || name === 'home';
  $('panelPos').hidden = name !== 'pos';
  $('panelFree').hidden = name !== 'free';
  $('panelTrain').hidden = name !== 'train';
  $('panelPlay').hidden = name !== 'play';
  $('panelEdit').hidden = name !== 'edit';
  document.body.classList.toggle('training', name === 'train' || name === 'play' || name === 'edit' || name === 'pos');
  const posTab = positionsUI ? positionsUI.tab() : null;
  $('tabMid').setAttribute('aria-selected', String(name === 'mid' || (name === 'pos' && posTab === 'mid')));
  $('tabEnd').setAttribute('aria-selected', String(name === 'end' || (name === 'pos' && posTab === 'end')));
  $('tabFree').setAttribute('aria-selected', String(name === 'free'));
  $('tabHome').setAttribute('aria-selected', String(name === 'home'));
  document.querySelector('.tab[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('tabOpen').setAttribute('aria-selected', String(name === 'openings' || name === 'train' || name === 'edit'));
  $('tabPlay').setAttribute('aria-selected', String(name === 'play'));
  if (name === 'free') { view.clearSelection(); if (view.flipped !== flipped) view.setFlipped(flipped); refresh(); }
  window.scrollTo({ top: 0 });
}
function leaveModes() {
  if (editorUI.isOpen()) editorUI.close();
  if (openingsUI.isTraining()) openingsUI.exit(false);
  playUI.leave();
  positionsUI.leave();
}
$('tabFree').onclick = () => { leaveModes(); showScreen('free'); };
$('tabHome').onclick = () => overviewUI.enter();
$('tabOpen').onclick = () => { leaveModes(); showScreen('openings'); openingsUI.renderList(); };
$('tabPlay').onclick = () => { if (editorUI.isOpen()) editorUI.close(); if (openingsUI.isTraining()) openingsUI.exit(false); positionsUI.leave(); playUI.enter(); };
$('tabMid').onclick = () => { leaveModes(); positionsUI.enter('mid'); };
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
view.pieceStyle = settings.pieceStyle;
view.showLegal = settings.showLegal;
view.flipped = flipped;
view._drawGrid();
updatePlaceholder();
refresh();
const overviewUI = initOverview({
  store, toast, askConfirm, showScreen, leaveModes, moveLabelVN,
  openings: () => openingsUI, positions: () => positionsUI,
});
// Mở app vào màn hình Tổng quan; vẽ lại khi dữ liệu khai cuộc / thế cờ tải xong
overviewUI.enter();
Promise.all([openingsUI.load(), positionsUI.load()]).then(() => { if (!$('screenHome').hidden) overviewUI.render(); });

// Service worker: chỉ đăng ký khi chạy qua http(s) (GitHub Pages / máy chủ thử)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.__XQT_PREVIEW__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(async () => {
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
