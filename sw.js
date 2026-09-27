/* Service worker — cache all app assets for offline use */
const CACHE = 'kinder-mal-app-v22';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './templates/kuh.svg',
  './templates/schwein.svg',
  './templates/schaf.svg',
  './templates/huhn.svg',
  './templates/traktor.svg',
  './templates/apfel.svg',
  './templates/ball.svg',
  './templates/haus.svg',
  './templates/sonne.svg',
  './templates/blume.svg',
];

function isNetworkFirst(url) {
  try {
    const u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    const path = u.pathname;
    // Strip query for matching; also match root and basename
    const base = path.endsWith('/') ? path : path;
    const name = base.split('/').pop() || '';
    return (
      name === 'index.html' ||
      name === 'styles.css' ||
      name === 'app.js' ||
      path === '/' ||
      path.endsWith('/')
    );
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (isNetworkFirst(req.url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Cache-first for icons and other assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
