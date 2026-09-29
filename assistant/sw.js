// ============================================
// Rem Assistant — Service Worker v4.1
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

// File kode dari susunan lama (sebelum digabung jadi tools/core/character/ui.js).
// Salinannya di cache dibuang saat SW baru aktif. Tidak menyentuh cache model & audio.
const STALE_CODE = new Set([
  '/assistant/finance-bridge.js',
  '/assistant/js/tool-registry.js', '/assistant/js/tool-finance.js',
  '/assistant/js/config.js', '/assistant/js/state.js', '/assistant/js/ecosystem-context.js',
  '/assistant/js/live2d.js', '/assistant/js/bubbles.js', '/assistant/js/animation.js',
  '/assistant/js/apps-panel.js', '/assistant/js/resizer.js', '/assistant/js/chat-ui.js',
  '/assistant/js/tts-player.js', '/assistant/js/main.js',
]);
const isStaleCode = (pathname) =>
  STALE_CODE.has(pathname) ||
  /^\/assistant\/js\/(core|data|character|ui|chat|audio|tools)\//.test(pathname);  // subfolder lama

async function cleanupStaleCode() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const reqs = await cache.keys();
    await Promise.all(reqs.filter(r => isStaleCode(new URL(r.url).pathname)).map(r => cache.delete(r)));
  } catch (err) {
    console.warn('[SW] Gagal membersihkan cache kode lama:', err);
  }
}

// Activate — hapus cache lama + salinan kode lama
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ),
    cleanupStaleCode(),
  ]));
  self.clients.claim();
});

// Fetch strategy: halaman, kode app (.js/.css/.html) dan shared network-first, API network-only, aset cache-first.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname === '/assistant/' || url.pathname === '/assistant/index.html') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Kode app sendiri (.js / .css / .html di /assistant/, kecuali folder characters):
  // network-first supaya update langsung terpakai; salinan terakhir disimpan untuk fallback offline.
  if (
    url.origin === self.location.origin &&
    url.pathname.startsWith('/assistant/') &&
    !url.pathname.startsWith('/assistant/characters/') &&
    /\.(js|css|html)$/.test(url.pathname)
  ) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
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
