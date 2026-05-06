// ============================================
// CuciMoney+ — Service Worker v6
// ============================================

const CACHE_NAME = 'cucimoney-v6';
const ASSETS = [
  './index.html',
  './manifest.json',
];

// Install — cache assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — hapus semua cache versi lama
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first untuk index.html agar update kode langsung aktif,
//         network-first untuk /shared/, cache-first untuk asset statis lain.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // index.html — selalu coba network dulu supaya kode terbaru langsung dipakai
  if (url.pathname === '/' || url.pathname.endsWith('/cucimoney/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // /shared/ — selalu network-first
  if (url.pathname.startsWith('/shared/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Asset lain (manifest, icon) — cache-first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
