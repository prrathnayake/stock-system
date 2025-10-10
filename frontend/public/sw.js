const SHELL_CACHE = 'rc-shell-v2'
const DATA_CACHE = 'rc-data-v2'
const CORE_ASSETS = ['/', '/index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, DATA_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(DATA_CACHE)
    cache.put(request, response.clone())
    return response
  } catch (err) {
    const cache = await caches.open(DATA_CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const apiHint = ['/stock', '/work-orders', '/serials', '/purchasing', '/rma', '/settings']
  const isApiRequest = apiHint.some((hint) => url.pathname.includes(hint))

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(
        cacheFirst(new Request('/index.html', { cache: 'reload' })).catch(() => caches.match('/index.html'))
      )
      return
    }
    if (url.pathname.startsWith('/assets') || CORE_ASSETS.includes(url.pathname)) {
      event.respondWith(cacheFirst(request))
      return
    }
  }

  if (isApiRequest || url.origin !== self.location.origin) {
    event.respondWith(
      networkFirst(request).catch(async () => {
        const cache = await caches.open(DATA_CACHE)
        const cached = await cache.match(request)
        if (cached) return cached
        throw new Error('Offline and no cached data')
      })
    )
  }
})
