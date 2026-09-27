// ============================================
// Rem Assistant — Service Worker v4
// ============================================

const CACHE_NAME = 'assistant-rem-v4';
const ASSETS = [
  './manifest.json',
  './characters/rem/character.json',
  './characters/rem/Character.model3.json',
];

// Install — cache aset inti Rem. Aset model lainnya akan di-cache saat diminta.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS).catch(err => {
        console.warn('[SW] Beberapa aset inti gagal di-cache:', err);
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

// Fetch strategy: halaman dan shared network-first, API network-only, aset cache-first.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname === '/assistant/' || url.pathname === '/assistant/index.html') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  if (url.pathname.startsWith('/shared/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cubism.live2d.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
