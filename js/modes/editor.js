// =====================================================================
// SOẠN / SỬA BIẾN KHAI CUỘC NGAY TRONG APP
// - Đi quân cho cả hai bên trên bàn cờ để ghi biến; bấm vào nước bất kỳ để quay lại và đi nhánh khác
// - Viết chú thích cho từng nước, tên biến, kế hoạch trung cuộc
// - "Kiểm tra bằng engine": chấm từng nước, nước nào kém quá 0.8 thì đánh dấu
// - Lưu (ghi đè) hoặc Lưu thành biến mới
// =====================================================================
import { Game } from '../core/game.js';
import { parseCoordMove, colorOf, RED, Position } from '../core/xiangqi.js';
import { checkLine } from '../train/opening-tree.js';
import { engine } from '../engine/client.js';
import { analyzeGame } from '../engine/analysis.js';

const $ = (id) => document.getElementById(id);
const THRESHOLD = 80; // ngưỡng khi chấm bằng Fairy-Stockfish trong app (dữ liệu chấm bằng Pikafish mang ngưỡng riêng)

export function initEditor(ctx) {
  // ctx: { view, toast, Sound, setController, showScreen, moveLabel, askConfirm }
  const { view, toast, Sound } = ctx;
  let game = null;
  let cur = null;        // { op, line, onSave(data, asNew), onCancel }
  let check = null;      // kết quả kiểm tra engine của phiên soạn hiện tại
  let checking = false;
  let dirty = false;
  const thr = () => check?.threshold || THRESHOLD;

  /** Mở trình soạn. line = null để soạn biến mới. */
  function open({ op, line, onSave, onCancel, title }) {
    cur = { op, line, onSave, onCancel };
    game = new Game(op.startFen);
    check = line?.verification?.engine && line.verification.engine !== 'chưa kiểm định'
      ? { status: line.verification.engine, flagged: line.verification.engineFlags || [], losses: line.verification.engineLoss || [], final: line.verification.engineFinal, threshold: line.verification.engineThreshold || THRESHOLD }
      : null;
    if (line?.moves) {
      const r = checkLine(line.moves, op.startFen);
      for (const p of r.plies) {
        const e = game.play(parseCoordMove(p.iccs));
        if (e) e.comment = p.comment || '';
      }
      game.goto(game.moves.length);
    }
    dirty = false;
    $('edTitle').textContent = title || (line ? 'Sửa biến' : 'Biến mới');
    $('edOpening').textContent = op.name;
    $('edName').value = line?.name || '';
    $('edPlan').value = line?.plan || '';
    $('edSaveNew').hidden = !line;
    ctx.setController(controller);
    ctx.showScreen('edit');
    render();
  }

  const controller = {
    canPick(s) {
      if (checking) return false;
      const p = game.pos.board[s];
      return !!p && colorOf(p) === game.pos.turn;
    },
    targets(s) { return game.pos.legalMoves(s).map((m) => m.to); },
    onMove(m) {
      const cut = game.ply < game.moves.length;
      const e = game.play(m);
      if (!e) return;
      e.comment = '';
      if (cut) toast('Đã bỏ các nước sau nước đang chọn và đi nhánh mới.');
      dirty = true; check = null;
      Sound.move();
      render(m.dragged ? null : m);
    },
  };

  function render(animate = null) {
    const pos = game.pos;
    const checkSq = pos.inCheck() ? pos.kingSq(pos.turn) : -1;
    view.render({ board: pos.board, last: game.lastMove(), checkSq, animate });
    $('status').className = 'status';
    $('status').textContent = `Đang soạn biến — lượt ${pos.turn === RED ? 'Đỏ' : 'Đen'} (đi quân cho cả hai bên)`;
    // Danh sách nước
    const ol = $('edMoves');
    ol.innerHTML = '';
    const startBlack = new Position(game.startFen).turn !== RED;
    const off = startBlack ? 1 : 0;
    let curBtn = null;
    if (!game.moves.length) ol.innerHTML = '<li><span class="empty">Chưa có nước nào. Đi quân trên bàn cờ để ghi biến.</span></li>';
    for (let i = 0; i < game.moves.length + off; i += 2) {
      const li = document.createElement('li');
      const no = document.createElement('span'); no.className = 'no'; no.textContent = `${i / 2 + 1}.`;
      li.appendChild(no);
      for (let k = 0; k < 2; k++) {
        const idx = i + k - off;
        const b = document.createElement('button');
        b.className = 'mv ' + (k === 0 ? 'red' : 'black');
        if (idx >= 0 && idx < game.moves.length) {
          const e = game.moves[idx];
          const loss = check?.losses?.[idx];
          b.textContent = ctx.moveLabel(e) + (e.comment ? ' ✎' : '') + (loss > thr() ? ' ?' : '');
          if (loss > thr()) b.classList.add(loss >= 300 ? 'an-blunder' : 'an-mistake');
          b.title = e.comment || '';
          b.onclick = () => { game.goto(idx + 1); render(); };
          if (idx + 1 === game.ply) { b.classList.add('cur'); curBtn = b; }
        } else { b.disabled = true; b.textContent = idx < 0 ? '…' : ''; }
        li.appendChild(b);
      }
      ol.appendChild(li);
    }
    curBtn?.scrollIntoView({ block: 'nearest' });
    // Chú thích của nước đang chọn
    const e = game.lastMove();
    $('edComment').disabled = !e;
    $('edComment').value = e ? e.comment || '' : '';
    $('edComment').placeholder = e ? `Ý đồ của nước ${ctx.moveLabel(e)}…` : 'Chọn một nước để viết chú thích';
    $('edCount').textContent = `${game.moves.length} nửa nước (${Math.ceil(game.moves.length / 2)} hiệp)`;
    // Kết quả engine
    const el = $('edEngine');
    if (checking) return;
    if (!check) { el.className = 'small muted'; el.textContent = 'Chưa kiểm tra bằng engine.'; return; }
    const fl = check.flagged || [];
    el.className = 'small ' + (check.status === 'đạt' ? 'eng-ok' : 'eng-flag');
    const fin = check.final !== undefined ? ` Cuối biến: Đỏ ${(check.final > 0 ? '+' : '') + (check.final / 100).toFixed(1)}.` : '';
    el.textContent = check.status === 'đạt'
      ? `Engine: đạt — không nước nào kém quá 0.8.${fin}`
      : `Engine: cần xem lại — ${fl.map((x) => `nước ${x.ply} ${x.vn} kém ${(x.loss / 100).toFixed(1)}${x.bestVn ? ' (nên đi ' + x.bestVn + ')' : ''}`).join('; ')}.${fin}`;
  }

  // ---------- Nút ----------
  $('edComment').addEventListener('input', () => {
    const e = game?.lastMove();
    if (e) { e.comment = $('edComment').value.replace(/[{}]/g, ''); dirty = true; }
  });
  // Không vẽ lại danh sách khi rời ô chú thích (tránh mất cú bấm vào nước khác); chỉ cập nhật dấu ✎
  $('edComment').addEventListener('change', () => {
    const b = document.querySelector('#edMoves .mv.cur');
    const e = game?.lastMove();
    if (b && e) b.textContent = ctx.moveLabel(e) + (e.comment ? ' ✎' : '') + (check?.losses?.[game.ply - 1] > thr() ? ' ?' : '');
  });
  $('edName').addEventListener('input', () => { dirty = true; });
  $('edPlan').addEventListener('input', () => { dirty = true; });
  $('edFirst').onclick = () => { game.goto(0); render(); };
  $('edPrev').onclick = () => { game.back(); render(); };
  $('edNext').onclick = () => { const n = game.moves[game.ply]; game.forward(); render(n ? { from: n.from, to: n.to } : null); };
  $('edLast').onclick = () => { game.goto(game.moves.length); render(); };
  $('edCut').onclick = async () => {
    if (game.ply === game.moves.length) { toast('Đang ở nước cuối — không có nước nào phía sau.'); return; }
    if (!(await ctx.askConfirm('Xóa các nước sau', `Xóa ${game.moves.length - game.ply} nửa nước sau nước đang chọn?`))) return;
    game.moves.length = game.ply; dirty = true; check = null; render();
  };

  $('edCheck').onclick = async () => {
    if (game.moves.length < 2 || checking) return;
    checking = true;
    $('edEngine').className = 'small muted';
    const moves = game.moves.map((m) => m.iccs);
    try {
      await engine.init();
      const res = await analyzeGame((fen, hist) => engine.search(fen, hist, { movetime: 500, maxTime: 500 }), game.startFen, moves, {
        onProgress: (i, n) => { $('edEngine').textContent = `Engine (${engine.name}) đang chấm ${i}/${n}…`; },
      });
      const losses = res.moves.map((a) => a.loss);
      const flagged = [];
      const pos = new Position(game.startFen);
      res.moves.forEach((a, i) => {
        if (a.loss > THRESHOLD) {
          const bestVn = a.best ? (() => { const q = pos.clone(); return ctx.moveLabelOf(q, parseCoordMove(a.best)); })() : '';
          flagged.push({ ply: i + 1, vn: ctx.moveLabel(game.moves[i]), loss: a.loss, best: a.best, bestVn });
        }
        pos.makeMove(parseCoordMove(moves[i]));
      });
      const last = res.finalScore;
      const final = Math.max(-2000, Math.min(2000, pos.turn === RED ? last : -last));
      check = { status: flagged.length ? 'cần xem lại' : 'đạt', flagged, losses, final, engine: engine.name };
    } catch (e) {
      if (e.message !== 'cancelled') toast('Engine lỗi: ' + e.message);
    }
    checking = false;
    render();
  };

  /** Chuỗi ký pháp VN kèm chú thích {…} để lưu */
  function movesString() {
    return game.moves.map((m) => m.vn + (m.comment ? ` {${m.comment.trim()}}` : '')).join(' ');
  }

  async function save(asNew) {
    const name = $('edName').value.trim();
    if (!name) { toast('Anh đặt tên cho biến trước khi lưu.'); $('edName').focus(); return; }
    if (game.moves.length < 2) { toast('Biến cần ít nhất 2 nửa nước.'); return; }
    const data = {
      name, plan: $('edPlan').value.trim(), moves: movesString(),
      engineCheck: check ? { ...check } : null,
      originalSource: cur.line?.source,
    };
    const ok = await cur.onSave(data, asNew);
    if (ok !== false) { dirty = false; close(); toast(asNew ? 'Đã lưu thành biến mới.' : 'Đã lưu biến.'); }
  }
  $('edSave').onclick = () => save(false);
  $('edSaveNew').onclick = () => save(true);
  $('edCancel').onclick = async () => {
    if (dirty && !(await ctx.askConfirm('Bỏ thay đổi', 'Thoát mà không lưu các thay đổi?'))) return;
    const c = cur; close(); c?.onCancel?.();
  };

  function close() {
    if (checking) engine.stop();
    checking = false;
    ctx.setController(null);
    const c = cur; cur = null; game = null;
    c && ctx.afterClose?.();
  }

  return { open, isOpen: () => !!cur, close };
}
