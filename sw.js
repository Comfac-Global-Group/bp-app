const CACHE_NAME = 'bplog-dev'; /* CI_INJECT_CACHE */
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
];
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.5.31/dist/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/idb@8/build/umd.js',
  'https://cdn.jsdelivr.net/npm/exifr/dist/full.umd.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...SHELL_ASSETS, ...CDN_ASSETS]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function networkFirst(req) {
  try {
    const networkRes = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(req, networkRes.clone());
    return networkRes;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const networkRes = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  await cache.put(req, networkRes.clone());
  return networkRes;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShell = url.origin === location.origin && SHELL_ASSETS.some(path => {
    const p = path.replace(/^\.\//, '');
    return url.pathname.endsWith(p) || (p === '' && url.pathname === '/');
  });
  const isCdn = CDN_ASSETS.includes(url.href);

  if (isShell) {
    e.respondWith(networkFirst(e.request));
  } else if (isCdn) {
    e.respondWith(cacheFirst(e.request));
  } else {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  }
});
