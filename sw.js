/* Mi Piso — service worker: cache-first del shell para funcionar sin conexión. */
const CACHE = 'mipiso-v1';
const SHELL = [
  './', './index.html', './styles.css', './logic.js', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const red = fetch(e.request).then(res => {
        if (res && (res.ok || res.type === 'opaque')) caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
