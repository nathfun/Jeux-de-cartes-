// Service worker : réseau d'abord (pour toujours avoir la dernière version), cache en secours hors ligne.
const CACHE = 'casino-v74';
const CORE = [
  './', './index.html', './manifest.webmanifest', './pwa.js', './firebase-config.js', './sounds.js', './casino-rules.js', './news.js', './profile.js', './social.js', './account.js', './gate.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './blackjack/', './blackjack/index.html', './blackjack/style.css', './blackjack/strategy.js',
  './blackjack/count.js', './blackjack/sidebets.js', './blackjack/app.js', './blackjack/coach-chat.js',
  './blackjack/net.js', './blackjack/multi.js',
  './poker/', './poker/index.html', './poker/style.css', './poker/eval.js', './poker/engine.js',
  './poker/coach.js', './poker/bots.js', './poker/app.js', './poker/multi.js', './poker/tourney.js',
  './roulette/', './roulette/index.html', './roulette/style.css', './roulette/bets.js', './roulette/wheel.js',
  './roulette/app.js', './roulette/multi.js',
  './crash/', './crash/index.html', './crash/style.css', './crash/engine.js', './crash/scene.js', './crash/app.js',
  './plinko/', './plinko/index.html', './plinko/style.css', './plinko/engine.js', './plinko/scene.js', './plinko/app.js',
  './trader/', './trader/index.html', './trader/style.css', './trader/engine.js', './trader/scene.js', './trader/app.js',
  './mines/', './mines/index.html', './mines/style.css', './mines/engine.js', './mines/app.js',
  './gold/', './gold/index.html', './gold/style.css', './gold/engine.js', './gold/app.js', './slots/machines.html',
  './cartes/', './cartes/index.html', './cartes/app.js',
  './loto/', './loto/index.html', './loto/style.css', './loto/engine.js', './loto/app.js', './loto/salle.html', './loto/salle.css', './loto/multi.js',
  './slots/', './slots/index.html', './slots/style.css', './slots/engine.js', './slots/app.js',
  './partie.html', './partie.js', './apprendre.html', './games.css',
  './courses/', './courses/index.html', './courses/style.css', './courses/app.js',
  './heist/', './heist/index.html', './heist/style.css', './heist/engine.js', './heist/app.js',
  './boosters/', './boosters/index.html', './boosters/style.css', './boosters/app.js',
  './roue/', './roue/index.html', './roue/style.css', './roue/app.js',
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

// Clic sur une notification (invitation) : ouvre ou ramène l'app sur la bonne page
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

// Notification envoyée par le serveur du Casino (coffre plein, bonus, ami qui te dépasse…)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Lucky Lounge', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Lucky Lounge', {
    body: d.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: d.tag || 'casino', renotify: true, data: { url: d.url || './' },
  }));
});
