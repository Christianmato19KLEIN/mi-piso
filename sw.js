/* Mi Piso — service worker: cache-first del shell para funcionar sin conexión. */
const CACHE = 'mipiso-v3';
const SHELL = [
  './', './index.html', './styles.css', './logic.js', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

// Al instalar se piden los ficheros saltándose la caché HTTP del navegador: si no, tras publicar una
// versión nueva el service worker guardaría la anterior (GitHub Pages sirve con 10 minutos de caché).
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const red = fetch(e.request, { cache: 'no-cache' }).then(res => {
        if (res && (res.ok || res.type === 'opaque')) caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
