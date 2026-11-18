// =====================================================================
// BỘ CHUYỂN FAIRY-STOCKFISH (WASM, biến thể xiangqi) — giao tiếp theo giao thức UCI
// Cần các file của gói npm "fairy-stockfish-nnue.wasm" đặt trong thư mục engine/
// (stockfish.js, stockfish.wasm, stockfish.worker.js). Bản này dùng đa luồng nên
// trang phải ở chế độ cross-origin isolated (service worker của app tự bật COOP/COEP).
// Engine tự chạy trong các Web Worker riêng (pthreads) nên giao diện không bị đơ.
// LƯU Ý: chưa được thử với file thật — sẽ kiểm tra khi anh Thắng chép file engine vào.
// =====================================================================
import { Position, parseCoordMove, moveToICCS, squareName } from '../core/xiangqi.js';

const ENGINE_URL = 'engine/stockfish.js';

/** Kiểm tra có file engine và trình duyệt đủ điều kiện chạy không */
export async function fsfAvailable() {
  if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) return { ok: false, reason: 'Trang chưa ở chế độ cross-origin isolated (cần tải lại trang sau khi cài service worker)' };
  try {
    const r = await fetch(ENGINE_URL); // GET để service worker trả từ cache khi offline
    if (!r.ok) return { ok: false, reason: 'Chưa có file engine/stockfish.js' };
  } catch { return { ok: false, reason: 'Không đọc được thư mục engine' }; }
  return { ok: true };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Không tải được ' + src));
    document.head.appendChild(s);
  });
}

// Đổi giữa ICCS (hàng 0–9) và UCI của Fairy-Stockfish (hàng 1–10)
const iccsToUci = (m) => squareName(parseCoordMove(m).from, 1) + squareName(parseCoordMove(m).to, 1);
const uciToIccs = (u) => moveToICCS(parseCoordMove(u, 1));

export class FsfBackend {
  constructor() { this.name = 'Fairy-Stockfish'; this.sf = null; this.listeners = new Set(); }

  /** useNnue: có tải mạng NNUE (engine/xiangqi.nnue, ~11 MB) hay không */
  async init({ useNnue = true } = {}) {
    if (!self.Stockfish) await loadScript(ENGINE_URL);
    this.sf = await self.Stockfish();
    this.sf.addMessageListener((line) => { for (const l of this.listeners) l(line); });
    await this._cmd('uci', (l) => l === 'uciok');
    this.sf.postMessage('setoption name UCI_Variant value xiangqi');
    this.sf.postMessage(`setoption name Threads value ${Math.min(4, navigator.hardwareConcurrency || 2)}`);
    this.sf.postMessage('setoption name Hash value 64');
    // Mạng NNUE cho cờ tướng (engine/xiangqi.nnue) nếu có — mạnh và chính xác hơn đánh giá cổ điển
    if (useNnue) try {
      const r = await fetch('engine/xiangqi.nnue');
      if (r.ok && this.sf.FS) {
        this.sf.FS.writeFile('/xiangqi.nnue', new Uint8Array(await r.arrayBuffer()));
        this.sf.postMessage('setoption name EvalFile value /xiangqi.nnue');
        this.sf.postMessage('setoption name Use NNUE value true');
        this.name = 'Fairy-Stockfish (NNUE)';
      }
    } catch { /* không có NNUE: dùng đánh giá cổ điển */ }
    await this._cmd('isready', (l) => l === 'readyok');
  }

  _cmd(cmd, until) {
    return new Promise((resolve) => {
      const fn = (line) => { if (until(line)) { this.listeners.delete(fn); resolve(line); } };
      this.listeners.add(fn);
      this.sf.postMessage(cmd);
    });
  }

  /**
   * opts: { movetime, depth, skill (0–20), multipv (số hướng đi, mặc định 1), onInfo }
   * Trả về cùng định dạng engine JS: { move (ICCS), score (cp, góc nhìn bên đi), depth, pv, mate }
   * + lines: [{ score, pv, mate }] khi multipv > 1 (xếp theo thứ hạng của engine)
   */
  async search(fen, history, opts = {}) {
    // Fairy-Stockfish nhận FEN thế gốc + danh sách nước (để tự phát hiện lặp)
    const start = new Position(fen);
    const moves = (history || []).map(iccsToUci).join(' ');
    // Lịch sử đã được áp vào `fen`? Ở app ta luôn gửi FEN thế gốc + history.
    this.sf.postMessage(`setoption name Skill Level value ${opts.skill ?? 20}`);
    const multi = Math.max(1, Math.min(5, opts.multipv || 1));
    this.sf.postMessage(`setoption name MultiPV value ${multi}`);
    const lines = [];
    this.sf.postMessage(`position fen ${start.fen()}${moves ? ' moves ' + moves : ''}`);
    let last = { move: null, score: 0, depth: 0, pv: [], mate: 0 };
    const done = new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const d = / depth (\d+)/.exec(line), cp = / score cp (-?\d+)/.exec(line), mt = / score mate (-?\d+)/.exec(line);
          const pv = line.split(' pv ')[1].trim().split(/\s+/).map(uciToIccs);
          const k = / multipv (\d+)/.exec(line);
          const rank = k ? +k[1] : 1;
          const info = { move: pv[0], depth: d ? +d[1] : 0, pv, mate: mt ? +mt[1] : 0, score: mt ? Math.sign(+mt[1]) * (30000 - Math.abs(+mt[1]) * 2) : cp ? +cp[1] : 0 };
          lines[rank - 1] = { score: info.score, pv: info.pv, mate: info.mate };
          if (rank === 1) { last = info; opts.onInfo?.(last); }
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(fn);
          const bm = line.split(/\s+/)[1];
          if (bm && bm !== '(none)') last.move = uciToIccs(bm);
          else last.move = null;
          if (multi > 1) last.lines = lines.filter(Boolean);
          resolve(last);
        }
      };
      this.listeners.add(fn);
    });
    this.sf.postMessage(opts.depth && !opts.movetime ? `go depth ${opts.depth}` : `go movetime ${opts.movetime || 1000}`);
    return done;
  }

  stop() { this.sf?.postMessage('stop'); }
}
