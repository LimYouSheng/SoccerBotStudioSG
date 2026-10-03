/* Static demo shell only. No provider requests or live customer data are cached. */
const APP_PREFIX = 'sbs-staff-' + new URL(self.registration.scope).pathname + '-';
const CACHE = APP_PREFIX + '20261003-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(APP_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(new URL('./index.html', self.registration.scope).href, copy)));
        return response;
      }
      return caches.match(new URL('./index.html', self.registration.scope).href).then(cached => cached || response);
    }).catch(() => caches.match(new URL('./index.html', self.registration.scope).href)));
    return;
  }
  if (!ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
