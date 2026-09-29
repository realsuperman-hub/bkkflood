/* BKKFLOOD service worker: offline shell + last-known data + web-push notifications.
   Bump VERSION when caching rules change. */
const VERSION = 'v1';
const SHELL = `bkk-shell-${VERSION}`;
const RUN = `bkk-run-${VERSION}`;
const TILES = `bkk-tiles-${VERSION}`;
const MAX_TILES = 400;
const KEEP = [SHELL, RUN, TILES];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/logo.svg', '/manifest.webmanifest', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, cacheName, timeoutMs = 5000) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone());
    if (limit) trim(cache, limit);
  }
  return res;
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length > limit) await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page loads: always try the network first so a new deploy shows up immediately; fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      networkFirst(new Request('/'), SHELL, 4000).catch(() => caches.match('/')),
    );
    return;
  }

  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
      e.respondWith(cacheFirst(req, RUN)); // content-hashed → safe to keep forever
    } else if (url.pathname.startsWith('/data/')) {
      e.respondWith(networkFirst(req, RUN, 4000)); // live snapshots: newest when online, last-known when offline
    }
    return;
  }

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(cacheFirst(req, TILES, MAX_TILES)); // tiles you have viewed still draw when the signal drops
  } else if (/(^|\.)open-meteo\.com$/.test(url.hostname)) {
    e.respondWith(networkFirst(req, RUN, 6000));
  }
});

/* ---------- web push (FCM data messages) ---------- */
self.addEventListener('push', (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    p = {};
  }
  // FCM wraps custom fields in `data`; tolerate a flat payload too
  const d = { ...(p.notification || {}), ...(p.data || p) };
  e.waitUntil(
    self.registration.showNotification(d.title || 'BKKFLOOD', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: d.tag || 'bkkflood',
      renotify: true,
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          w.focus();
          return 'navigate' in w ? w.navigate(target) : undefined;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
