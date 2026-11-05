/* OpenCloth offline shell: precaches the entry files, then caches same-origin assets on first use. */
const CACHE_NAME = 'opencloth-shell-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

/** Stores a successful response for later offline use. */
function cacheResponse(request, response) {
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => undefined);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          cacheResponse(request, response);
          return response;
        })
        .catch(() => caches.match('/index.html').then(hit => hit || caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) cacheResponse(request, response);
      return response;
    })),
  );
});
