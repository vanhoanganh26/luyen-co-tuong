// =====================================================================
// LỚP LƯU TRỮ
// Ứng dụng chỉ làm việc với `Store`. Bên dưới là một "adapter" có thể thay thế:
//   - LocalAdapter: localStorage (mặc định), tự rơi về bộ nhớ tạm nếu bị chặn
//   - Sau này: SheetAdapter (đồng bộ Google Sheet), IndexedDBAdapter...
// Mọi adapter chỉ cần 4 hàm: get(key), set(key, value), remove(key), keys()
// (giá trị là chuỗi; Store lo phần JSON).
// =====================================================================

export class MemoryAdapter {
  constructor() { this.map = new Map(); }
  get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  set(k, v) { this.map.set(k, v); }
  remove(k) { this.map.delete(k); }
  keys() { return [...this.map.keys()]; }
}

export class LocalAdapter {
  constructor() {
    this.fallback = new MemoryAdapter();
    try {
      const t = '__xqt_test__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      this.ls = window.localStorage;
    } catch { this.ls = null; } // chế độ riêng tư / bị chặn => dùng bộ nhớ tạm
  }
  get(k) { try { return this.ls ? this.ls.getItem(k) : this.fallback.get(k); } catch { return this.fallback.get(k); } }
  set(k, v) { try { this.ls ? this.ls.setItem(k, v) : this.fallback.set(k, v); } catch { this.fallback.set(k, v); } }
  remove(k) { try { this.ls ? this.ls.removeItem(k) : this.fallback.remove(k); } catch { this.fallback.remove(k); } }
  keys() {
    try {
      if (!this.ls) return this.fallback.keys();
      const out = [];
      for (let i = 0; i < this.ls.length; i++) out.push(this.ls.key(i));
      return out;
    } catch { return this.fallback.keys(); }
  }
  get persistent() { return !!this.ls; }
}

export const SCHEMA_VERSION = 1;

export class Store {
  constructor(adapter, prefix = 'xqt:') {
    this.adapter = adapter;
    this.prefix = prefix;
  }
  getJSON(key, def = null) {
    const raw = this.adapter.get(this.prefix + key);
    if (raw == null) return def;
    try { return JSON.parse(raw); } catch { return def; }
  }
  setJSON(key, value) { this.adapter.set(this.prefix + key, JSON.stringify(value)); }
  remove(key) { this.adapter.remove(this.prefix + key); }

  /** Xuất toàn bộ dữ liệu app thành 1 object (dùng cho nút Xuất JSON ở GĐ5) */
  exportAll() {
    const data = {};
    for (const k of this.adapter.keys()) {
      if (!k || !k.startsWith(this.prefix)) continue;
      data[k.slice(this.prefix.length)] = this.getJSON(k.slice(this.prefix.length));
    }
    return { app: 'xiangqi-trainer', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
  }
  /** Nhập dữ liệu đã xuất (ghi đè các khóa trùng) */
  importAll(obj) {
    if (!obj || obj.app !== 'xiangqi-trainer' || typeof obj.data !== 'object') throw new Error('File không đúng định dạng');
    for (const [k, v] of Object.entries(obj.data)) this.setJSON(k, v);
  }
}

export const store = new Store(new LocalAdapter());
