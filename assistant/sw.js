// ============================================
// Assistant — Service Worker v3
// ============================================

const CACHE_NAME = 'assistant-v3';
const ASSETS = [
  './manifest.json',
  './LiveroiD_A-Y02.model3.json',
  './LiveroiD_A-Y02.moc3',
  './LiveroiD_A-Y02.physics3.json',
  './LiveroiD_A-Y02.cdi3.json',
  './blush.exp3.json',
  './browLink.exp3.json',
  './cool.exp3.json',
  './worried.exp3.json',
  './LiveroiD_A-Y02.8192/texture_00.png',
];

// Install — cache semua assets termasuk model Live2D
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS).catch(err => {
        console.warn('[SW] Beberapa asset gagal di-cache:', err);
      })
    )
  );
  self.skipWaiting();
});

// Activate — hapus cache lama
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - index.html  → network first (update kode langsung aktif)
// - /shared/    → network first
// - /api/       → network only
// - CDN         → cache first (pixi, live2d — mahal di-refetch)
// - model files → cache first (besar)
// - lainnya     → cache first, fallback network
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // index.html — network first agar perubahan kode langsung aktif
  if (url.pathname === '/assistant/' || url.pathname === '/assistant/index.html') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // /shared/ — network first
  if (url.pathname.startsWith('/shared/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // /api/ — network only, jangan cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // CDN (pixi, live2d) — cache first
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cubism.live2d.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // Semua lainnya (model files, icons, dll) — cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});
