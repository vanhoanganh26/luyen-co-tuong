// Web Worker chạy engine JavaScript (để giao diện không bị đơ khi máy suy nghĩ)
// Nhận: { id, fen, history:[iccs...], opts:{ depth, movetime, noise } }
// Gửi:  { id, type:'info', info } trong lúc tìm  |  { id, type:'done', result } khi xong
import { Engine } from './search.js';

const engine = new Engine({ ttBits: 18 });

self.onmessage = (e) => {
  const { id, fen, history, opts } = e.data;
  try {
    engine.setFen(fen, history || []);
    const result = engine.go({ ...opts, onInfo: (info) => self.postMessage({ id, type: 'info', info }) });
    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err && err.message || err) });
  }
};
