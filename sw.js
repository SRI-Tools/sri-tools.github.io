// Service worker: файлы приложения доступны без сети.
// Сначала сеть (чтобы обновления приходили сразу), при её отсутствии — сохранённая копия.

const CACHE = 'app-v76';
const PERSONAL = 'app-personal'; // манифест с названием после входа (offline.js)
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'api.js', 'auth.js', 'config.js', 'format.js',
  'picker.js', 'scanner.js', 'offline.js', 'labels.js', 'users.js', 'inventory.js', 'inventory/shared.js', 'inventory/cards.js', 'inventory/item-form.js', 'inventory/stock-form.js',
  'inventory/directories.js', 'inventory/kit-rules.js', 'clients.js', 'background.js',
  'inventory.css', 'clients.css', 'core-loader.js', 'core/kits.js', 'core/prices.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/zxing-wasm/reader.js', 'vendor/zxing-wasm/zxing_reader.wasm', 'vendor/qrcode.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PERSONAL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Манифест: после входа — версия с названием из кэша этого устройства.
  if (url.pathname.endsWith('/manifest.webmanifest')) {
    e.respondWith(caches.open(PERSONAL)
      .then((c) => c.match(new URL('manifest.webmanifest', self.registration.scope).href))
      .then((hit) => hit || fetch(e.request, { cache: 'no-cache' }).catch(() => caches.match(e.request, { ignoreSearch: true }))));
    return;
  }
  e.respondWith(
    // no-cache: всегда сверяемся с сервером, чтобы не получать устаревшие файлы из HTTP-кэша.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('index.html')))
  );
});
