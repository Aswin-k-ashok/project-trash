// Bump the version whenever this file's caching rules change; `activate`
// deletes every cache with a different name.
const CACHE_NAME = 'bin-there-v2';
const APP_SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  '/icons/icon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

function cacheIfOk(cacheKey, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Leave writes, other origins (map tiles, Nominatim, Supabase) and the
  // future same-origin API to the browser. None of them should be cached here.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Page loads go to the network first so a new deploy shows up on the next
  // reload. The cached shell is only the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => cacheIfOk('/', response))
        .catch(() =>
          caches.match('/').then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Everything else is a static file. Vite puts a content hash in built asset
  // names, so serving them from the cache can never return stale code.
  event.respondWith(
    caches
      .match(request)
      .then(
        (cached) =>
          cached || fetch(request).then((response) => cacheIfOk(request, response))
      )
  );
});
