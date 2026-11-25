// Service worker : réseau d'abord (pour toujours avoir la dernière version), cache en secours hors ligne.
const CACHE = 'jeux-de-cartes-v3';
const CORE = [
  './', './index.html', './manifest.webmanifest', './pwa.js', './firebase-config.js', './sounds.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './blackjack/', './blackjack/index.html', './blackjack/style.css', './blackjack/strategy.js',
  './blackjack/count.js', './blackjack/sidebets.js', './blackjack/app.js', './blackjack/coach-chat.js',
  './blackjack/net.js', './blackjack/multi.js',
  './poker/', './poker/index.html', './poker/style.css', './poker/eval.js', './poker/engine.js',
  './poker/coach.js', './poker/bots.js', './poker/app.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Firebase : jamais en cache
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
