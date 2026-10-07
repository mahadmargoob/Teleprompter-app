importScripts('./version.js');

const CACHE = 'promptcam-' + self.APP_VERSION;
const ASSETS = ['./', './index.html', './app.js', './version.js', './manifest.json', './icon-180.png', './icon-512.png'];

// Each version gets its own complete cache, fetched fresh in one go. If any
// file fails the install fails and the previous version keeps running, so the
// page and its script can never be from two different builds.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('promptcam-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks for this when the user taps "Reload" on the update notice.
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE)
      .then(c => c.match(req, {ignoreSearch: true}))
      .then(hit => hit || fetch(req).catch(() =>
        req.mode === 'navigate'
          ? caches.open(CACHE).then(c => c.match('./index.html'))
          : new Response('Offline', {status: 503})
      ))
  );
});
