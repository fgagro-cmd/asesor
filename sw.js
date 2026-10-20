// Service worker: la app funciona sin conexión (caché primero, se actualiza en segundo plano).
// Al cambiar cualquier fichero de la app, sube VERSION para que los móviles recojan la nueva versión.
const VERSION = 'v1.0.0';
const CACHE = 'asesor-' + VERSION;
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'logic.js', 'maestros.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'vendor/html2canvas.min.js', 'vendor/xlsx.mini.min.js',
  'vendor/fonts/fraunces-latin-400-normal.woff2', 'vendor/fonts/fraunces-latin-600-normal.woff2',
  'vendor/fonts/inter-latin-400-normal.woff2', 'vendor/fonts/inter-latin-600-normal.woff2', 'vendor/fonts/inter-latin-700-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-500-normal.woff2', 'vendor/fonts/ibm-plex-mono-latin-600-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('asesor-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request)
        .then((r) => {
          if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
          return r;
        })
        .catch(() => null);
      return hit || net.then((r) => r || caches.match('index.html'));
    })
  );
});
