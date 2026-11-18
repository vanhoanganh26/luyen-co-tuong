// =====================================================================
// ENGINE CLIENT — giao diện chung cho app, ẩn đi engine cụ thể bên dưới
//   - 'js'  : engine JavaScript dự phòng chạy trong Web Worker (luôn có)
//   - 'fsf' : Fairy-Stockfish WASM (khi có file trong thư mục engine/)
// Dùng: const r = await engine.search(fenGốc, [nước ICCS...], { level } | { movetime, depth })
// Kết quả: { move, score (cp, góc nhìn bên đi), depth, pv, mate, engine }
// =====================================================================
import { LEVELS } from './search.js';
import { fsfAvailable, FsfBackend } from './fsf-backend.js';

/** Tạo worker cho engine JS: bình thường dùng module worker; bản xem thử 1 file dùng mã nhúng */
function makeJsWorker() {
  if (self.__XQT_WORKER_SRC__) {
    const url = URL.createObjectURL(new Blob([self.__XQT_WORKER_SRC__], { type: 'text/javascript' }));
    return new Worker(url);
  }
  return new Worker(new URL('./js-worker.js', import.meta.url), { type: 'module' });
}

class JsBackend {
  constructor() { this.name = 'Engine JS (dự phòng)'; this.worker = null; this.seq = 0; this.pending = new Map(); }
  async init() { this._spawn(); }
  _spawn() {
    this.worker = makeJsWorker();
    this.worker.onmessage = (e) => {
      const { id, type } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      if (type === 'info') p.onInfo?.(e.data.info);
      else if (type === 'done') { this.pending.delete(id); p.resolve(e.data.result); }
      else if (type === 'error') { this.pending.delete(id); p.reject(new Error(e.data.error)); }
    };
    this.worker.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'Lỗi engine')); this.pending.clear(); };
  }
  search(fen, history, opts) {
    const id = ++this.seq;
    const { onInfo, ...rest } = opts;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onInfo });
      this.worker.postMessage({ id, fen, history, opts: rest });
    });
  }
  /** Dừng ngay: engine JS chạy đồng bộ trong worker nên phải hủy worker rồi tạo lại */
  stop() {
    this.worker?.terminate();
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
    this._spawn();
  }
}

export class EngineClient {
  constructor() { this.backend = null; this.fallback = null; this.ready = null; this.info = ''; this.useNnue = true; }

  /** Thiết bị yếu (thường là điện thoại) */
  static isWeakDevice() {
    const n = self.navigator || {};
    return /Android|iPhone|iPad|Mobile/i.test(n.userAgent || '') || (n.hardwareConcurrency || 4) <= 2 || (n.deviceMemory || 8) <= 2;
  }

  /** Khởi động: ưu tiên Fairy-Stockfish nếu dùng được, không thì engine JS */
  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.fallback = new JsBackend();
      await this.fallback.init();
      this.backend = this.fallback;
      try {
        const av = await fsfAvailable();
        if (av.ok) {
          const f = new FsfBackend();
          await f.init({ useNnue: this.useNnue });
          this.backend = f;
        } else this.info = av.reason;
      } catch (e) { this.info = 'Fairy-Stockfish lỗi: ' + e.message; }
      return this.backend.name;
    })();
    return this.ready;
  }

  get name() { return this.backend ? this.backend.name : 'đang khởi động'; }
  get isStrong() { return this.backend && this.backend !== this.fallback; }

  /**
   * Tìm nước / chấm điểm.
   * opts.level (1–8): cấp độ chơi. Hoặc opts.movetime / opts.depth cho phân tích.
   * Thiết bị yếu: thời gian suy nghĩ bị giới hạn bởi opts.maxTime (mặc định 6 giây).
   */
  async search(fen, history = [], opts = {}) {
    await this.init();
    // Máy yếu (ít nhân / ít RAM, thường là điện thoại) => giới hạn 4 giây mỗi nước
    const weak = EngineClient.isWeakDevice();
    const maxTime = opts.maxTime ?? (weak ? 4000 : 6000);
    let o;
    if (opts.level) {
      const L = LEVELS[opts.level];
      if (this.isStrong) {
        // Fairy-Stockfish: cấp 1–8 tương ứng Skill Level 0–20
        o = { movetime: Math.min(maxTime, L.movetime), skill: Math.round(((opts.level - 1) / 7) * 20) };
      } else o = { depth: L.depth, movetime: Math.min(maxTime, L.movetime), noise: L.noise };
    } else o = { depth: opts.depth, movetime: Math.min(maxTime, opts.movetime ?? 800) };
    o.onInfo = opts.onInfo;
    if (opts.multipv) o.multipv = opts.multipv; // chỉ Fairy-Stockfish hỗ trợ; engine JS bỏ qua
    // Xếp hàng: mỗi lúc chỉ một lệnh tìm chạy trên engine (Fairy-Stockfish không chạy song song được).
    // VD: đang phân tích "Triển khai tiếp?" mà máy cần đi thì nước của máy chờ phân tích xong.
    const backend = this.backend;
    const run = (this._queue || Promise.resolve()).then(() => backend.search(fen, history, o));
    this._queue = run.catch(() => {});
    const r = await run;
    return { ...r, engine: backend.name };
  }

  stop() { this.backend?.stop(); }
}

export const engine = new EngineClient();
