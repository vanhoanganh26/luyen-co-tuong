// =====================================================================
// SERVICE WORKER — cache toàn bộ app để chạy offline sau lần tải đầu.
// Khi phát hành bản mới: tăng CACHE_VERSION để máy người dùng tải lại.
// Ngoài ra: tự gắn header COOP/COEP vào mọi phản hồi để trang ở chế độ
// "cross-origin isolated" — điều kiện để chạy Fairy-Stockfish đa luồng
// trên GitHub Pages (nơi không tự đặt header được).
// File engine (thư mục engine/) được cache tự động ở lần dùng đầu tiên.
// =====================================================================
const CACHE_VERSION = 'xqt-v0.11.4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/core/xiangqi.js',
  './js/core/notation.js',
  './js/core/game.js',
  './js/ui/board-themes.js',
  './js/ui/board-view.js',
  './fonts/lxgw-wenkai-tc-quan-co.woff2',
  './js/ui/sound.js',
  './js/ui/reveal.js',
  './js/storage/storage.js',
  './js/train/srs.js',
  './js/train/opening-tree.js',
  './js/train/trainer.js',
  './js/train/user-openings.js',
  './js/train/positions.js',
  './js/train/progress.js',
  './js/train/move-insight.js',
  './js/train/position-factors.js',
  './js/train/lessons.js',
  './js/train/weakness.js',
  './js/modes/after-opening.js',
  './js/modes/why.js',
  './js/modes/think.js',
  './js/modes/overview.js',
  './js/modes/positions.js',
  './js/modes/editor.js',
  './js/modes/openings.js',
  './js/modes/play.js',
  './js/engine/search.js',
  './js/engine/js-worker.js',
  './js/engine/client.js',
  './js/engine/fsf-backend.js',
  './js/engine/analysis.js',
  './data/openings.built.json',
  './data/positions.built.json',
  './data/insights.json',
  './data/plans.json',
  './data/book.built.json',
  './data/keymoves.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// File engine Fairy-Stockfish: có thì cache luôn để chạy offline, thiếu thì bỏ qua.
// Mạng NNUE (~11 MB) KHÔNG tải sẵn: chỉ được cache khi người dùng bật NNUE và app tải nó lần đầu.
const ENGINE_FILES = ['./engine/stockfish.js', './engine/stockfish.wasm', './engine/stockfish.worker.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' = luôn lấy bản mới từ máy chủ, không dùng bản cũ trong bộ nhớ đệm HTTP của trình duyệt
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))
        .then(() => Promise.allSettled(ENGINE_FILES.map((f) => c.add(new Request(f, { cache: 'reload' }))))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Gắn header cách ly (COOP/COEP) vào phản hồi cùng nguồn */
function withIsolation(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Chiến lược: lấy từ cache trước (nhanh, offline); không có thì tải mạng rồi lưu vào cache
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return withIsolation(hit);
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return withIsolation(res);
      }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html').then(withIsolation) : Response.error()));
    })
  );
});
