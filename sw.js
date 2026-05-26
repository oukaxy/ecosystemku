// EcosystemKu Dashboard — Service Worker
// Scope dibatasi ke root '/' saja (tidak intercept subdirektori app lain)
// Strategy: network-first untuk semua request dashboard

const CACHE_NAME = 'ecosystemku-dashboard-v2';

// File yang di-cache untuk offline
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Hapus cache lama
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Jangan intercept request ke subdirektori app lain
  // Hanya handle request ke root dashboard
  const isAppSubdir = /^\/(daily-os|ide-ku|kronik|cucimoney|linkku|assistant|vault|shared|api)\//.test(url.pathname);
  if (isAppSubdir) return;

  // Jangan intercept request ke CDN eksternal (JSZip, Google, fonts)
  if (url.origin !== self.location.origin) return;

  // Network-first untuk index.html (selalu ambil terbaru)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first untuk asset statis (manifest, icons)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
