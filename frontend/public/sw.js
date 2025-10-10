// very small offline cache (MVP)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('rc-cache-v1').then(cache => cache.addAll(['/']))
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
