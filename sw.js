/**
 * Service Worker — 离线缓存策略
 */

const CACHE_NAME = 'ocr-shelf-v6';

const PRE_CACHE = [
  './',
  './index.html',
  './src/css/style.css',
  './src/js/db.js',
  './src/js/auth.js',
  './src/js/camera.js',
  './src/js/ocr.js',
  './src/js/shelf.js',
  './src/js/export.js',
  './src/js/import.js',
  './src/js/qrcode.js',
  './src/js/scanner.js',
  './src/js/custom-select.js',
  './src/js/app.js',
  './manifest.json',
  './src/icons/icon-192.png',
  './src/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/sql.js@1.10/dist/sql-wasm.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
];

// 安装：预缓存
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 请求拦截：缓存优先，但跳过 API 请求
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http')) return;

  // API 请求绝不缓存
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});
