/**
 * Service Worker — 离线缓存策略
 * 缓存静态资源，IndexedDB 数据本身就在本地无需 SW 处理
 */

const CACHE_NAME = 'ocr-shelf-v2';

const PRE_CACHE = [
  './',
  './index.html',
  './src/css/style.css',
  './src/js/db.js',
  './src/js/camera.js',
  './src/js/ocr.js',
  './src/js/shelf.js',
  './src/js/export.js',
  './src/js/app.js',
  './manifest.json',
  './src/icons/icon-192.png',
  './src/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/sql.js@1.10/dist/sql-wasm.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
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

// 请求拦截：缓存优先
self.addEventListener('fetch', (e) => {
  // 跳过 chrome-extension 等非 http(s) 请求
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      // 后台更新缓存
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
