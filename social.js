/*
 * Le Casino entre amis : profils publics, codes amis, classement, défis entre amis, réactions.
 *
 * Données en ligne (Firebase) :
 *   profiles/<uid>      profil public (pseudo, avatar, niveau, portefeuille…), écrit par son seul propriétaire
 *   friendcodes/<code>  code ami à 6 caractères → uid
 *   challenges/<code>   défi : meta { game, rounds, bank, seed, by } + results/<uid> { name, avatar, score }
 * Avec « ?backend=local » dans l'adresse, tout est simulé dans le navigateur (tests).
 *
 * Défis entre amis : tout le monde joue avec la même graine de hasard, donc les mêmes numéros
 * à la roulette et le même sabot au blackjack. Le meilleur solde final gagne.
 */
(function () {
  'use strict';
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = (n) => Array.from({ length: n }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

  // Générateur pseudo-aléatoire à graine (mulberry32) : mêmes tirages pour tous les joueurs d'un défi
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Branchements ----------
  async function firebaseBackend() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.databaseURL) return null;
    const [appMod, authMod, dbMod] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-database.js')]);
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    if (auth.authStateReady) await auth.authStateReady();
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
    const d = dbMod.getDatabase(app);
    const R = (p) => dbMod.ref(d, p);
    return {
      get uid() { return auth.currentUser ? auth.currentUser.uid : null; }, // suit la connexion au compte
      get: async (p) => (await dbMod.get(R(p))).val(),
      set: (p, v) => dbMod.set(R(p), v),
      update: (p, v) => dbMod.update(R(p), v),
      remove: (p) => dbMod.remove(R(p)),
      on: (p, cb) => dbMod.onValue(R(p), (snap) => cb(snap.val()), () => {}),
      createOnce: async (p, v) => {
        try {
          if ((await dbMod.get(R(p))).exists()) return false; // déjà pris (les règles refuseraient l'écriture)
          return (await dbMod.runTransaction(R(p), (cur) => (cur ? undefined : v))).committed;
        } catch (e) { return false; }
      },
    };
  }
  function localBackend() {
    let uid = null;
    try { uid = sessionStorage.getItem('bj-local-me'); if (!uid) { uid = 'L' + code(7); sessionStorage.setItem('bj-local-me', uid); } } catch (e) { uid = 'L' + code(7); }
    const k = (p) => 'social:' + p;
    const read = (p) => { try { return JSON.parse(localStorage.getItem(k(p))); } catch (e) { return null; } };
    return {
      uid,
      get: async (p) => {
        const direct = read(p);
        if (direct != null) return direct;
        // lecture d'un dossier (ex. challenges/X/results)
        const out = {}; let any = false;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.startsWith(k(p) + '/')) { const rest = key.slice(k(p).length + 1); if (!rest.includes('/')) { out[rest] = read(p + '/' + rest); any = true; } }
        }
        return any ? out : null;
      },
      set: async (p, v) => { localStorage.setItem(k(p), JSON.stringify(v)); },
      remove: async (p) => {
        const pre = k(p);
        for (let i = localStorage.length - 1; i >= 0; i--) { const key = localStorage.key(i); if (key === pre || key.startsWith(pre + '/')) localStorage.removeItem(key); }
      },
      on(p, cb) { // pas de temps réel en local : on relit régulièrement
        let last = null;
        const tick = async () => { const v = await this.get(p); const j = JSON.stringify(v); if (j !== last) { last = j; cb(v); } };
        tick(); const t = setInterval(tick, 1500);
        return () => clearInterval(t);
      },
      createOnce: async (p, v) => { if (read(p)) return false; localStorage.setItem(k(p), JSON.stringify(v)); return true; },
    };
  }

  let ready = null;
  function backend() {
    if (!ready) {
      ready = (async () => {
        if (/[?&]backend=local\b/.test(location.search)) return localBackend();
        try { return await firebaseBackend(); } catch (e) { return null; }
      })();
    }
    return ready;
  }

  // ---------- Profil public et amis ----------
  const P = () => Casino.profile;
  function friends() { const p = P(); p.friends = p.friends || {}; return p.friends; }

  async function myCode() {
    const b = await backend();
    if (!b) return null;
    const p = P();
    if (p.friendCode && p.friendCodeUid === b.uid) return p.friendCode;
    for (let t = 0; t < 8; t++) {
      const c = code(6);
      if (await b.createOnce('friendcodes/' + c, b.uid)) {
        p.friendCode = c; p.friendCodeUid = b.uid;
        Casino.save(); // enregistre le profil
        return c;
      }
    }
    return null;
  }

  let lastPub = null;
  let lastExtra = '';
  async function publish() {
    const b = await backend();
    if (!b) return false;
    const p = P();
    // Avec le serveur du Casino, c'est lui qui écrit le profil public (impossible d'y mettre une fausse banque)
    if (window.Casino && Casino.server) {
      const key = (p.friendCode || '') + '|' + (p.pseudo || '');
      if (key !== lastPub) { lastPub = key; await Casino.call('profile.set', { code: p.friendCode || undefined, pseudo: p.pseudo }); }
      // le serveur écrit la banque et le niveau ; l'appareil ajoute l'apparence et la vitrine du profil public
      const extra = {
        frame: Casino.equipped ? Casino.equipped('frame') : 'none', card: publicCard(p),
        pokerWeek: Casino.pokerWeek ? Casino.pokerWeek() : null, pokerWeekPrev: p.pokerWeekPrev || null,
        titleName: (() => { const t = Casino.itemOf && Casino.itemOf('title', Casino.equipped('title')); return t && t.id ? t.name : null; })(),
      };
      const sig = JSON.stringify(extra);
      if (sig !== lastExtra && b.update) { lastExtra = sig; await b.update('profiles/' + b.uid, extra).catch(() => {}); }
      return true;
    }
    await b.set('profiles/' + b.uid, {
      pseudo: p.pseudo || 'Joueur', avatar: p.avatar, xp: p.xp, level: Casino.levelOf(p.xp), wallet: Math.round(p.wallet),
      biggestWin: Math.round(p.totals.biggestWin || 0), hands: p.totals.hands, achievements: Object.keys(p.achievements).length,
      code: p.friendCode || null, updatedAt: Date.now(),
      frame: Casino.equipped ? Casino.equipped('frame') : 'none',
      pokerWeek: Casino.pokerWeek ? Casino.pokerWeek() : null, pokerWeekPrev: p.pokerWeekPrev || null,
      titleName: (() => { const t = Casino.itemOf && Casino.itemOf('title', Casino.equipped('title')); return t && t.id ? t.name : null; })(),
      card: publicCard(p),
      monthNet: p.season && Casino.seasonOf && p.season.id === Casino.seasonOf(Date.now()) ? Math.round(p.season.net || 0) : 0, month: Casino.seasonOf ? Casino.seasonOf(Date.now()) : null,
    });
    return true;
  }

  // ---------- Profil public ----------
  // Ce que les amis voient : statistiques, objets équipés, succès récents, parties entre amis
  function publicCard(p) {
    const T = p.totals || {};
    const counts = { blackjack: T.bjHands || 0, poker: T.pkHands || 0, roulette: T.rlSpins || 0, slots: T.slSpins || 0, crash: T.crRounds || 0, plinko: T.plBalls || 0, trader: T.trTrades || 0, mines: T.mnRounds || 0 };
    const fav = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const ach = Object.entries(p.achievements || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
    const eq = {};
    ['frame', 'rocket', 'ball', 'theme', 'felt', 'back', 'chips', 'effect', 'title'].forEach((k) => { try { eq[k] = Casino.equipped(k); } catch (e) { /* ignore */ } });
    const owned = Object.keys(p.owned || {}).length;
    return {
      since: p.createdAt || null, hands: T.hands || 0, wins: T.wins || 0, biggestWin: Math.round(T.biggestWin || 0), multiWins: T.multiWins || 0,
      streak: (p.bonus && p.bonus.streak) || 0, fav: counts[fav] ? fav : null, counts, ach, eq, owned,
      season: p.season ? { id: p.season.id, xp: p.season.xp || 0 } : null,
      hist: (p.multiHist || []).slice(0, 10),
    };
  }
  const GAME_LABEL = { blackjack: '🂡 Blackjack', poker: '♠ Poker', roulette: '🎡 Roulette', slots: '🎰 Machine à sous', crash: '🚀 Rocket Crash', plinko: '🔮 Plinko', trader: '📈 Bourse Flash', mines: '💎 Mines' };
  let profStyled = false;
  function profStyle() {
    if (profStyled) return; profStyled = true;
    const s = document.createElement('style');
    s.textContent = `
.pp-ov { position: fixed; inset: 0; z-index: 80; background: rgba(3,6,12,.75); backdrop-filter: blur(4px); display: grid; place-items: center; padding: 16px; overflow-y: auto; animation: pp-f .2s ease-out both; }
.pp { position: relative; width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; border-radius: 24px; color: #f3f4f6; font: 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: radial-gradient(ellipse at 50% 0%, #3a2c0c 0%, #161a22 55%, #0d1117 100%); border: 1px solid rgba(242,193,78,.45); box-shadow: 0 30px 80px rgba(0,0,0,.6); animation: pp-in .45s cubic-bezier(.2,.9,.3,1.2) both; }
.pp-close { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(255,255,255,.08); color: #fff; font-size: 1.1rem; cursor: pointer; z-index: 2; }
.pp-head { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 1.4rem 1rem .8rem; gap: .25rem; }
.pp-av { width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; font-size: 48px; background: rgba(255,255,255,.06); border: 3px solid #f2c14e; box-shadow: 0 0 30px rgba(242,193,78,.35); animation: pp-float 3s ease-in-out infinite; }
.pp-name { font-size: 1.5rem; font-weight: 900; margin-top: .3rem; }
.pp-title { color: #f2c14e; font-weight: 700; font-size: .9rem; }
.pp-lvl { width: 70%; height: 8px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; margin-top: .4rem; } .pp-lvl i { display: block; height: 100%; background: linear-gradient(90deg, #f2c14e, #4fc3f7); border-radius: 999px; }
.pp-sub { font-size: .8rem; opacity: .7; }
.pp-badges { display: flex; gap: .35rem; flex-wrap: wrap; justify-content: center; margin-top: .4rem; } .pp-badges span { font-size: .75rem; font-weight: 700; padding: .2rem .6rem; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); }
.pp-sec { margin: 0 1rem 1rem; padding: .8rem .9rem; border-radius: 16px; background: rgba(0,0,0,.28); border: 1px solid rgba(255,255,255,.07); }
.pp-sec h3 { margin: 0 0 .55rem; font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: rgba(243,244,246,.65); }
.pp-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .45rem; }
.pp-stats div { text-align: center; background: rgba(255,255,255,.04); border-radius: 12px; padding: .45rem .2rem; } .pp-stats b { display: block; font-size: 1.1rem; font-variant-numeric: tabular-nums; } .pp-stats small { font-size: .68rem; opacity: .65; }
.pp-items { display: flex; gap: .4rem; flex-wrap: wrap; } .pp-items span { font-size: .8rem; padding: .3rem .6rem; border-radius: 10px; background: rgba(255,255,255,.06); }
.pp-ach { display: flex; gap: .4rem; flex-wrap: wrap; } .pp-ach span { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: rgba(242,193,78,.1); border: 1px solid rgba(242,193,78,.35); }
.pp-hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
.pp-hist li { display: grid; grid-template-columns: auto 1fr auto; gap: .5rem; align-items: center; background: rgba(255,255,255,.04); border-radius: 10px; padding: .35rem .6rem; } .pp-hist .w { color: #3fb950; font-weight: 800; }
.pp-games { display: flex; flex-direction: column; gap: .3rem; font-size: .82rem; } .pp-games div { display: grid; grid-template-columns: 9.5em 1fr auto; gap: .5rem; align-items: center; } .pp-games .pp-bar { display: block; background: rgba(255,255,255,.06); border-radius: 999px; } .pp-games i { display: block; height: 7px; border-radius: 999px; background: linear-gradient(90deg, #f2c14e, #4fc3f7); }
@keyframes pp-f { from { opacity: 0; } } @keyframes pp-in { from { opacity: 0; transform: translateY(24px) scale(.96); } } @keyframes pp-float { 50% { transform: translateY(-5px); } }
@media (prefers-reduced-motion: reduce) { .pp, .pp-av, .pp-ov { animation: none; } }`;
    document.head.appendChild(s);
  }
  /** Affiche le profil public d'un joueur (uid) ; row = ligne du classement si on l'a déjà. */
  async function showProfile(uid, row) {
    profStyle();
    const b = await backend();
    let pr = row && row.card ? row : null;
    if (!pr && b) { pr = await b.get('profiles/' + uid).catch(() => null); if (pr) { const w = await b.get('bank/' + uid + '/wallet').catch(() => null); if (typeof w === 'number') pr.wallet = Math.round(w); } }
    const me = b && uid === b.uid;
    if (me) pr = Object.assign({}, pr || {}, { pseudo: P().pseudo || 'Joueur', avatar: P().avatar, xp: P().xp, level: Casino.levelOf(P().xp), card: publicCard(P()), achievements: Object.keys(P().achievements).length, frame: Casino.equipped('frame') });
    if (!pr) { if (window.Casino) Casino.toast('Profil introuvable', 'Ce joueur n\'a pas encore de profil public.', '👤'); return; }
    const c = pr.card || {};
    const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
    const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const ov = el('div', 'pp-ov'); const box = el('div', 'pp'); ov.appendChild(box);
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    const x = el('button', 'pp-close', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer'); x.onclick = close; box.appendChild(x);
    // en-tête
    const h = el('div', 'pp-head');
    const av = el('div', 'pp-av fr-' + (pr.frame || 'none'), pr.avatar || '🎩');
    const lv = pr.level || Casino.levelOf(pr.xp || 0), cur = Casino.need(lv), nxt = Casino.need(lv + 1);
    const bar = el('div', 'pp-lvl'); const fill = el('i'); fill.style.width = Math.max(4, Math.min(100, Math.round(((pr.xp || 0) - cur) / Math.max(1, nxt - cur) * 100))) + '%'; bar.appendChild(fill);
    h.append(av, el('div', 'pp-name', (pr.pseudo || 'Joueur') + (me ? ' (toi)' : '')), el('div', 'pp-title', pr.titleName || Casino.title(lv)), bar,
      el('div', 'pp-sub', 'Niveau ' + lv + ' · ' + fmt(pr.xp) + ' XP' + (c.since ? ' · membre depuis ' + new Date(c.since).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '')));
    const badges = el('div', 'pp-badges');
    if (c.season && Casino.seasonTier) { const t = Casino.seasonTier(c.season.xp); if (t) badges.appendChild(el('span', '', (t.icon || '🏅') + ' Saison : ' + t.name)); }
    if (c.streak > 1) badges.appendChild(el('span', '', '🔥 ' + c.streak + ' jours d\'affilée'));
    if (pr.pokerWeek && pr.pokerWeek.pts) badges.appendChild(el('span', '', '♚ ' + pr.pokerWeek.pts + ' pts au tournoi de la semaine'));
    if (c.fav) badges.appendChild(el('span', '', '❤️ ' + (GAME_LABEL[c.fav] || c.fav)));
    if (badges.children.length) h.appendChild(badges);
    box.appendChild(h);
    // statistiques
    const sec = (title) => { const s = el('div', 'pp-sec'); s.appendChild(el('h3', '', title)); box.appendChild(s); return s; };
    const st = el('div', 'pp-stats');
    [[fmt(pr.wallet) + ' €', 'Banque'], [fmt(c.hands || pr.hands), 'Mains et tours'], [(c.hands ? Math.round((c.wins || 0) / c.hands * 100) : 0) + ' %', 'Gagnés'],
      ['+' + fmt(c.biggestWin || pr.biggestWin) + ' €', 'Plus gros gain'], [(pr.achievements || 0) + ' / ' + Casino.ACHIEVEMENTS.length, 'Succès'], [fmt(c.multiWins), 'Victoires entre amis']]
      .forEach(([v, l]) => { const d = el('div'); d.append(el('b', '', v), el('small', '', l)); st.appendChild(d); });
    sec('Statistiques').appendChild(st);
    // jeux préférés
    if (c.counts) {
      const top = Object.entries(c.counts).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (top.length) {
        const g = el('div', 'pp-games'), max = top[0][1];
        top.forEach(([k, n]) => { const r = el('div'); const bar2 = el('i'); bar2.style.width = Math.max(6, Math.round(n / max * 100)) + '%'; const wrap = el('span', 'pp-bar'); wrap.appendChild(bar2); r.append(el('span', '', GAME_LABEL[k] || k), wrap, el('small', '', fmt(n))); g.appendChild(r); });
        sec('Jeux préférés').appendChild(g);
      }
    }
    // vitrine : objets équipés
    if (c.eq && window.Casino && Casino.itemOf) {
      const it = el('div', 'pp-items');
      Object.entries(c.eq).forEach(([k, id]) => { const o = Casino.itemOf(k, id); if (o && (o.price || o.exclusive) && o.name) it.appendChild(el('span', '', (Casino.SHOP_LABELS[k] || k) + ' : ' + o.name)); });
      if (!it.children.length) it.appendChild(el('span', '', 'Objets de départ'));
      const s = sec('Vitrine · ' + (c.owned || 0) + ' objet' + ((c.owned || 0) > 1 ? 's' : '') + ' possédé' + ((c.owned || 0) > 1 ? 's' : '')); s.appendChild(it);
    }
    // succès récents
    if (c.ach && c.ach.length) {
      const a = el('div', 'pp-ach');
      c.ach.forEach((id) => { const d = Casino.ACHIEVEMENTS.find((q) => q.id === id); if (d) { const s2 = el('span', '', d.icon); s2.title = d.name + ' : ' + d.text; a.appendChild(s2); } });
      sec('Succès récents').appendChild(a);
    }
    // historique entre amis
    const hs = sec('Parties entre amis');
    if (c.hist && c.hist.length) {
      const ul = el('ul', 'pp-hist');
      c.hist.forEach((m) => {
        const li = el('li');
        li.append(el('span', '', m.place === 1 ? '🥇' : m.place === 2 ? '🥈' : m.place === 3 ? '🥉' : m.place + 'e'),
          el('span', '', (GAME_LABEL[m.game] || m.game) + ' · ' + m.players + ' joueurs · ' + new Date(m.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
          el('span', m.prize ? 'w' : '', m.prize ? '+' + fmt(m.prize) + ' €' : '–'));
        ul.appendChild(li);
      });
      hs.appendChild(ul);
    } else hs.appendChild(el('p', 'pp-sub', 'Aucune partie entre amis terminée pour l\'instant.'));
    document.body.appendChild(ov);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  async function addFriendByCode(c) {
    const b = await backend();
    if (!b) return { error: 'offline' };
    c = String(c || '').trim().toUpperCase();
    const uid = await b.get('friendcodes/' + c);
    if (!uid) return { error: 'unknown' };
    if (uid === b.uid) return { error: 'self' };
    friends()[uid] = Date.now();
    Casino.save();
    return { uid };
  }
  /** Les joueurs croisés à une table deviennent des amis automatiquement. */
  function addFriendUid(uid) {
    if (!uid || friends()[uid]) return;
    backend().then((b) => {
      if (!b || uid === b.uid) return;
      friends()[uid] = Date.now();
      Casino.save();
    });
  }
  function removeFriend(uid) { delete friends()[uid]; Casino.save(); }

  async function leaderboard() {
    const b = await backend();
    if (!b) return null;
    await publish();
    const ids = [b.uid].concat(Object.keys(friends()));
    const rows = await Promise.all(ids.map(async (u) => {
      const pr = await b.get('profiles/' + u);
      if (!pr) return null;
      // la banque affichée vient de bank/<uid>, protégée par les règles (le profil, lui, est écrit par le joueur)
      const w = await b.get('bank/' + u + '/wallet').catch(() => null);
      if (typeof w === 'number') pr.wallet = Math.round(w);
      return Object.assign({ uid: u, me: u === b.uid }, pr);
    }));
    return rows.filter(Boolean);
  }

  // ---------- Défis entre amis ----------
  async function createChallenge(game) {
    const b = await backend();
    if (!b) return null;
    const meta = { game, rounds: 10, bank: 1000, seed: Math.floor(Math.random() * 2 ** 31), by: P().pseudo || 'Un ami', at: Date.now() };
    for (let t = 0; t < 8; t++) {
      const c = code(5);
      if (await b.createOnce('challenges/' + c + '/meta', meta)) {
        const p = P(); p.myChallenges = (p.myChallenges || []).concat([c]).slice(-10);
        Casino.save();
        return c;
      }
    }
    return null;
  }
  async function getChallenge(c) {
    const b = await backend();
    if (!b) return null;
    const meta = await b.get('challenges/' + c + '/meta');
    if (!meta) return null;
    const results = (await b.get('challenges/' + c + '/results')) || {};
    return { code: c, meta, results, uid: b.uid };
  }
  async function submitChallenge(c, score) {
    const b = await backend();
    if (!b) return false;
    const old = await b.get('challenges/' + c + '/results/' + b.uid);
    if (old && old.score >= score) return true; // on garde le meilleur résultat
    await b.set('challenges/' + c + '/results/' + b.uid, { name: P().pseudo || 'Joueur', avatar: P().avatar, score: Math.round(score * 100) / 100, at: Date.now() });
    return true;
  }
  function challengeLink(c, game) {
    // racine du Casino : le dossier qui contient blackjack/, poker/, roulette/
    const path = location.pathname;
    const m = /^(.*\/)(blackjack|poker|roulette|slots)\/[^/]*$/.exec(path);
    const root = m ? m[1] : path.replace(/[^/]*$/, '');
    const u = new URL(root + game + '/index.html', location.href);
    if (/[?&]backend=local\b/.test(location.search)) u.searchParams.set('backend', 'local');
    u.searchParams.set('defi', c);
    return u.toString();
  }

  /** Fenêtre de résultat d'un défi (classement des amis). */
  function showChallengeResult(ch, myScore) {
    const rows = Object.entries(ch.results || {}).map(([u, r]) => Object.assign({ me: u === ch.uid }, r)).sort((a, b) => b.score - a.score);
    const o = document.createElement('div');
    o.className = 'defi-overlay';
    const box = document.createElement('div'); box.className = 'defi-box';
    const myRank = rows.findIndex((r) => r.me) + 1;
    const h = document.createElement('h2'); h.textContent = myRank === 1 ? '🏆 Tu mènes le défi !' : '🎯 Défi terminé';
    const p = document.createElement('p'); p.textContent = 'Ton solde final : ' + Math.round(myScore).toLocaleString('fr-FR') + ' € (départ ' + ch.meta.bank + ' €). ' + (myRank ? 'Tu es ' + (myRank === 1 ? '1er' : myRank + 'e') + ' sur ' + rows.length + '.' : '');
    const ol = document.createElement('ol');
    rows.forEach((r) => {
      const li = document.createElement('li'); if (r.me) li.className = 'me';
      li.textContent = (r.avatar || '🎩') + ' ' + (r.me ? 'Toi' : r.name) + ' — ' + Math.round(r.score).toLocaleString('fr-FR') + ' €';
      ol.appendChild(li);
    });
    const link = challengeLink(ch.code, ch.meta.game);
    const share = document.createElement('button'); share.textContent = 'Défier d\'autres amis';
    share.addEventListener('click', () => shareLink(link, 'Bats mon score à ce défi du Casino ! Code ' + ch.code));
    const close = document.createElement('button'); close.textContent = 'Fermer'; close.className = 'ghost';
    close.addEventListener('click', () => o.remove());
    const row = document.createElement('div'); row.className = 'defi-actions'; row.append(share, close);
    box.append(h, p, ol, row);
    o.appendChild(box);
    document.body.appendChild(o);
    if (myRank === 1 && window.Sfx) Sfx.win();
  }
  async function shareLink(url, text) {
    if (navigator.share) { try { await navigator.share({ title: 'Défi du Casino', text, url }); return; } catch (e) { /* annulé */ } }
    try { await navigator.clipboard.writeText(text + ' — ' + url); Casino.toast('Lien copié', 'Envoie-le à tes amis', '🔗'); } catch (e) { Casino.toast('Lien du défi', url, '🔗'); }
  }

  // ---------- Réactions à table ----------
  const EMOJIS = ['😂', '🔥', '😱', '👏', '😡', '🍀', '🤑', '😎'];
  const QUICK = ['Bien joué !', 'Allez !', 'Bonne chance !', 'Aïe…', 'GG', 'On en refait une ?', 'Trop fort 😎', 'Je reviens'];
  /** Ajoute une barre de réactions ; onSend(emoji) envoie la réaction par le chat de la table. */
  function reactionBar(container, onSend) {
    const bar = document.createElement('div');
    bar.className = 'reaction-bar';
    bar.setAttribute('aria-label', 'Réactions rapides');
    EMOJIS.forEach((e) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', 'Réagir ' + e);
      b.addEventListener('click', () => onSend(e));
      bar.appendChild(b);
    });
    container.appendChild(bar);
    // messages rapides : un appui, ils s'affichent chez tout le monde
    const q = document.createElement('div');
    q.className = 'quick-bar';
    QUICK.forEach((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
      b.addEventListener('click', () => onSend(t));
      q.appendChild(b);
    });
    container.appendChild(q);
  }
  const seen = new Set();
  /** Affiche une réaction qui s'envole au-dessus de la page (une fois par message). */
  function floatReaction(msg) {
    const id = msg.uid + ':' + msg.ts;
    if (seen.has(id) || Date.now() - msg.ts > 8000) { seen.add(id); return; }
    seen.add(id);
    const el = document.createElement('div');
    el.className = 'reaction-float';
    el.style.left = 15 + Math.random() * 70 + '%';
    const e = document.createElement('span'); e.textContent = msg.text;
    const n = document.createElement('small'); n.textContent = msg.name || '';
    el.append(e, n);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  const isReaction = (m) => m && m.reaction && (EMOJIS.includes(m.text) || QUICK.includes(m.text));



  // ---------- Multijoueur : parties ouvertes ----------
  // lobby/<jeu>_<code> (partie publique, code visible) ou lobby/<jeu>_<clé> (privée : le code reste secret)
  const TABLE_PATHS = { blackjack: 'tables/', poker: 'ptables/', roulette: 'rtables/' };
  const LOCAL_NS = { blackjack: '', poker: 'p', roulette: 'r' };
  const lobbyLast = {};
  async function lobbyBeat(game, code, info) {
    const key = info.pub ? game + '_' + code : info.lk ? game + '_' + info.lk : null;
    if (!key) return;
    const t = Date.now(), sig = JSON.stringify(info);
    if (lobbyLast[key] && t - lobbyLast[key].t < 25000 && lobbyLast[key].sig === sig) return;
    lobbyLast[key] = { t, sig };
    const b = await backend();
    if (!b || !b.uid) return;
    const e = { uid: b.uid, game, name: String(info.name || 'Table').slice(0, 30), host: String(info.host || P().pseudo || 'Joueur').slice(0, 20),
      players: info.players | 0, max: info.max | 0, pub: !!info.pub, at: t };
    if (info.live) e.live = true;
    if (info.pub) e.code = code;
    b.set('lobby/' + key, e).catch(() => {});
  }
  async function lobbyRemove(game, code, info) {
    const key = info && info.pub ? game + '_' + code : info && info.lk ? game + '_' + info.lk : null;
    const b = await backend();
    if (b && key) b.remove('lobby/' + key).catch(() => {});
  }
  /** Parties ouvertes (signal reçu il y a moins de 2 min 30). */
  /** Parties ouvertes ; null si la liste est illisible (règles Firebase pas à jour, ou hors ligne). */
  async function lobbyList() {
    const b = await backend();
    if (!b) return null;
    let all;
    try { all = (await b.get('lobby')) || {}; } catch (e) { return null; }
    return Object.entries(all).map(([key, v]) => Object.assign({ key }, v)).filter((e) => e && e.game && Date.now() - e.at < 150000)
      .sort((x, y) => (y.pub - x.pub) || (y.at - x.at));
  }
  /** Trouve le jeu d'une table à partir de son code. */
  async function findTable(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) return null;
    if (/[?&]backend=local\b/.test(location.search)) {
      for (const g of Object.keys(LOCAL_NS)) { if (localStorage.getItem(LOCAL_NS[g] + 'bj-t-' + code)) return g; }
      return null;
    }
    const b = await backend();
    if (!b) return null;
    for (const g of Object.keys(TABLE_PATHS)) { if (await b.get(TABLE_PATHS[g] + code).catch(() => null)) return g; }
    return null;
  }
  // Adresse de l'accueil, onglet Multijoueur (retour depuis une table)
  function hubLink(tab) {
    const m = /^(.*\/)(blackjack|poker|roulette|slots)\/[^/]*$/.exec(location.pathname);
    const root = m ? m[1] : location.pathname.replace(/[^/]*$/, '');
    const u = new URL(root + 'index.html', location.href);
    if (/[?&]backend=local\b/.test(location.search)) u.searchParams.set('backend', 'local');
    if (tab) u.hash = tab;
    return u.toString();
  }


  // ---------- Salle d'attente d'une table ----------
  /**
   * Affiche la salle d'attente en haut de la table tant que l'hôte n'a pas lancé la partie.
   * o = { container, started, players: [{ uid, name, ready }], me, hostUid, onReady(on), onStart(), minPlayers }
   */
  function waitingRoom(o) {
    let el = document.getElementById('wait-room');
    if (o.started) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'wait-room'; el.className = 'wait-room'; o.container.prepend(el); }
    const isHost = o.me === o.hostUid, mine = o.players.find((p) => p.uid === o.me);
    const ready = o.players.filter((p) => p.ready || p.uid === o.hostUid).length;
    el.innerHTML = '';
    const h = document.createElement('div'); h.className = 'wr-title'; h.textContent = '🕐 Salle d\'attente · ' + ready + ' / ' + o.players.length + ' prêt' + (ready > 1 ? 's' : '');
    const ul = document.createElement('ul');
    o.players.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = (p.uid === o.hostUid ? '👑 ' : '') + p.name + (p.uid === o.me ? ' (toi)' : '');
      const st = document.createElement('span'); st.textContent = p.uid === o.hostUid ? 'Hôte' : p.ready ? '✅ Prêt' : '⏳ Pas prêt';
      li.appendChild(st); ul.appendChild(li);
    });
    if (!o.players.length) { const li = document.createElement('li'); li.textContent = 'Personne pour l\'instant : invite tes amis avec le code.'; ul.appendChild(li); }
    const row = document.createElement('div'); row.className = 'wr-btns';
    if (isHost) {
      const go = document.createElement('button'); go.type = 'button'; go.className = 'wr-go';
      const enough = o.players.length >= (o.minPlayers || 1);
      go.textContent = enough ? '🚀 Lancer la partie' : 'Il faut au moins ' + o.minPlayers + ' joueurs';
      go.disabled = !enough;
      go.addEventListener('click', () => { go.disabled = true; o.onStart(); });
      row.appendChild(go);
    } else if (mine) {
      const r = document.createElement('button'); r.type = 'button'; r.className = mine.ready ? '' : 'wr-go';
      r.textContent = mine.ready ? 'Je ne suis plus prêt' : '✅ Je suis prêt';
      r.addEventListener('click', () => o.onReady(!mine.ready));
      row.appendChild(r);
    }
    const tip = document.createElement('p'); tip.className = 'wr-tip';
    tip.textContent = isHost ? 'Tes amis indiquent quand ils sont prêts ; tu lances la partie quand tout le monde est là.' : mine ? 'L\'hôte lance la partie quand tout le monde est prêt.' : 'Installe-toi à la table, puis indique que tu es prêt.';
    el.append(h, ul, row, tip);
  }

  // ---------- Invitations à une table ----------
  const GAME_NAMES = { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette' };
  function tableLink(game, code) {
    const m = /^(.*\/)(blackjack|poker|roulette|slots)\/[^/]*$/.exec(location.pathname);
    const root = m ? m[1] : location.pathname.replace(/[^/]*$/, '');
    const u = new URL(root + game + '/index.html', location.href);
    if (code) u.searchParams.set('table', code);
    if (/[?&]backend=local\b/.test(location.search)) u.searchParams.set('backend', 'local');
    return u.toString();
  }
  /** Envoie une invitation à un ami (elle apparaît sur son écran, où qu'il soit dans le Casino). */
  async function sendInvite(toUid, game, code) {
    const b = await backend();
    if (!b || !toUid || !code) return false;
    const id = Date.now().toString(36) + code;
    await b.set('invites/' + toUid + '/' + id, { from: b.uid, name: (P().pseudo || 'Un ami').slice(0, 20), avatar: P().avatar || '🎩', game, code, at: Date.now() });
    return true;
  }
  /** Fenêtre « Inviter » d'une table : chaque ami en un clic, ou le lien à partager. */
  async function inviteDialog(game, code) {
    const old = document.querySelector('.invite-dlg'); if (old) old.remove();
    const ov = document.createElement('div'); ov.className = 'invite-dlg';
    const box = document.createElement('div'); box.className = 'id-box';
    const h = document.createElement('h3'); h.textContent = 'Inviter à ta table de ' + GAME_NAMES[game];
    const c = document.createElement('p'); c.className = 'id-code'; c.innerHTML = 'Code de la table : <b></b>'; c.querySelector('b').textContent = code;
    const list = document.createElement('div'); list.className = 'id-list'; list.textContent = 'Chargement de tes amis…';
    const share = document.createElement('button'); share.type = 'button'; share.className = 'id-share'; share.textContent = '🔗 Partager le lien (WhatsApp, SMS…)';
    share.onclick = () => shareLink(tableLink(game, code), 'Rejoins ma table de ' + GAME_NAMES[game] + ' au Casino ! Code : ' + code);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'id-close'; close.textContent = 'Fermer';
    close.onclick = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    box.append(h, c, list, share, close);
    ov.appendChild(box);
    document.body.appendChild(ov);
    const rows = ((await leaderboard().catch(() => null)) || []).filter((r) => !r.me);
    list.innerHTML = '';
    if (!rows.length) { list.textContent = 'Tu n\'as pas encore d\'amis dans le Casino : ajoute-les avec leur code ami sur l\'accueil, ou partage le lien.'; return; }
    rows.forEach((r) => {
      const row = document.createElement('div'); row.className = 'id-row';
      const n = document.createElement('span'); n.textContent = (r.avatar || '🎩') + ' ' + (r.pseudo || 'Joueur');
      const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = 'Inviter';
      bt.onclick = async () => { bt.disabled = true; bt.textContent = '…'; const ok = await sendInvite(r.uid, game, code).catch(() => false); bt.textContent = ok ? 'Invité ✔' : 'Échec'; };
      row.append(n, bt); list.appendChild(row);
    });
  }
  // Invitation demandée depuis l'accueil (?invite=<uid>) : envoyée dès que la table est créée
  let pendingInvite = null;
  try {
    const q = new URLSearchParams(location.search).get('invite');
    if (q) sessionStorage.setItem('casino-invite-to', q);
    pendingInvite = sessionStorage.getItem('casino-invite-to');
  } catch (e) { /* ignore */ }
  async function tableReady(game, code) {
    if (!pendingInvite || !code) return;
    const to = pendingInvite; pendingInvite = null;
    try { sessionStorage.removeItem('casino-invite-to'); } catch (e) { /* ignore */ }
    const b = await backend();
    const prof = b ? await b.get('profiles/' + to).catch(() => null) : null;
    if (await sendInvite(to, game, code).catch(() => false) && window.Casino) Casino.toast('Invitation envoyée', (prof && prof.pseudo ? prof.pseudo : 'Ton ami') + ' est invité à ta table (code ' + code + ').', '📨');
  }
  const wantsTable = () => !!pendingInvite;
  // Réception : une carte s'affiche, où qu'on soit dans le Casino
  const shownInv = new Set();
  async function listenInvites() {
    const b = await backend();
    if (!b || !b.uid || !b.on) return;
    let current = b.uid, stop = null;
    const start = () => {
      if (stop) stop();
      current = b.uid;
      stop = b.on('invites/' + current, (all) => {
        Object.entries(all || {}).forEach(([id, inv]) => {
          if (!inv || shownInv.has(id)) return;
          shownInv.add(id);
          if (Date.now() - inv.at > 15 * 60000) { b.remove('invites/' + current + '/' + id).catch(() => {}); return; }
          inviteCard(b, current, id, inv);
        });
      });
    };
    start();
    setInterval(() => { if (b.uid && b.uid !== current) start(); }, 3000); // connexion à un autre compte
  }
  // Notifications du système (app en arrière-plan) : invitations, tables
  async function enableNotifications() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
  }
  async function notify(title, body, url) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return false;
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) await reg.showNotification(title, { body, icon: new URL('icons/icon-192.png', tableLink('blackjack').replace(/blackjack\/index\.html.*$/, '')).href, data: { url }, tag: 'casino-' + (url || title) });
      else new Notification(title, { body });
      return true;
    } catch (e) { return false; }
  }
  function inviteCard(b, uid, id, inv) {
    notify((inv.name || 'Un ami') + ' t\'invite !', 'Table de ' + (GAME_NAMES[inv.game] || 'jeu') + ' · code ' + inv.code, tableLink(inv.game, inv.code));
    const el = document.createElement('div'); el.className = 'invite-card';
    const t = document.createElement('div');
    const strong = document.createElement('b'); strong.textContent = (inv.avatar || '🎩') + ' ' + (inv.name || 'Un ami');
    t.append(strong, ' t\'invite à sa table de ' + (GAME_NAMES[inv.game] || 'jeu') + ' !');
    const go = document.createElement('button'); go.type = 'button'; go.className = 'ic-go'; go.textContent = 'Rejoindre';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Plus tard';
    const done = () => { el.remove(); b.remove('invites/' + uid + '/' + id).catch(() => {}); };
    go.onclick = () => { done(); location.href = tableLink(inv.game, inv.code); };
    no.onclick = done;
    const row = document.createElement('div'); row.className = 'ic-btns'; row.append(go, no);
    el.append(t, row);
    document.body.appendChild(el);
    if (window.Sfx) Sfx.chips();
    if (window.Casino) Casino.vibrate([40, 30, 40]);
  }

  const style = document.createElement('style');
  style.textContent = `
.invite-dlg { position: fixed; inset: 0; z-index: 97; background: rgba(0,0,0,.7); display: grid; place-items: center; padding: 16px; }
.id-box { background: #1a2129; color: #e8ecef; border: 2px solid #f2c14e; border-radius: 16px; padding: 1rem 1.1rem; width: min(420px, 100%); max-height: 85vh; overflow: auto; font: 15px system-ui, sans-serif; display: flex; flex-direction: column; gap: .6rem; }
.id-box h3 { margin: 0; color: #f2c14e; }
.id-code { margin: 0; } .id-code b { letter-spacing: .15em; color: #f2c14e; font-size: 1.15rem; }
.id-list { display: flex; flex-direction: column; gap: .35rem; font-size: .92rem; }
.id-row { display: flex; justify-content: space-between; align-items: center; gap: .5rem; background: #141a21; border-radius: 10px; padding: .4rem .6rem; }
.id-box button { font: inherit; border-radius: 10px; border: 1px solid #3a4652; background: #2b3540; color: #e8ecef; padding: .45rem .8rem; cursor: pointer; }
.id-box .id-share { background: #f2c14e; color: #222; border: 0; font-weight: 700; }
.invite-card { position: fixed; left: 50%; bottom: max(14px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 96; width: min(420px, calc(100vw - 24px));
  background: #1a2129; color: #e8ecef; border: 2px solid #3fb950; border-radius: 14px; padding: .7rem .9rem; box-shadow: 0 10px 30px rgba(0,0,0,.6); font: 15px system-ui, sans-serif; animation: ct-in .45s cubic-bezier(.2,.9,.3,1.3) both; }
.ic-btns { display: flex; gap: .5rem; margin-top: .5rem; }
.ic-btns button { font: inherit; flex: 1; border-radius: 10px; border: 1px solid #3a4652; background: #2b3540; color: #e8ecef; padding: .45rem; cursor: pointer; }
.ic-btns .ic-go { background: #3fb950; border-color: #3fb950; color: #06210d; font-weight: 700; }
.quick-bar { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: .4rem; }
.quick-bar button { font: inherit; font-size: .8rem; background: #141a21; color: #e8ecef; border: 1px solid #2a333d; border-radius: 999px; padding: .2rem .6rem; cursor: pointer; }
.reaction-float small { display: block; }
.wait-room { background: rgba(0,0,0,.45); border: 2px solid #f2c14e; border-radius: 14px; padding: .8rem 1rem; margin-bottom: .6rem; color: #e8ecef; font: 15px system-ui, sans-serif; }
.wr-title { font-weight: 800; color: #f2c14e; margin-bottom: .4rem; }
.wait-room ul { list-style: none; margin: 0 0 .6rem; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
.wait-room li { display: flex; justify-content: space-between; background: rgba(255,255,255,.06); border-radius: 8px; padding: .35rem .6rem; }
.wr-btns { display: flex; gap: .5rem; } .wr-btns button { font: inherit; font-weight: 700; flex: 1; border-radius: 10px; border: 1px solid #3a4652; background: #2b3540; color: #e8ecef; padding: .6rem; cursor: pointer; }
.wr-btns .wr-go { background: #f2c14e; color: #222; border-color: #f2c14e; } .wr-btns button:disabled { opacity: .6; }
.wr-tip { margin: .5rem 0 0; font-size: .82rem; opacity: .75; }
.reaction-bar { display: flex; gap: .25rem; flex-wrap: wrap; margin-top: .5rem; }
.reaction-bar button { font-size: 1.25rem; background: #141a21; border: 1px solid #2a333d; border-radius: 10px; padding: .15rem .35rem; cursor: pointer; }
.reaction-bar button:active { transform: scale(1.2); }
.reaction-float { position: fixed; bottom: 18%; z-index: 90; display: flex; flex-direction: column; align-items: center; pointer-events: none; animation: rf 3s ease-out forwards; }
.reaction-float span { font-size: 3rem; filter: drop-shadow(0 4px 8px rgba(0,0,0,.5)); }
.reaction-float small { color: #fff; font: 700 12px system-ui, sans-serif; background: rgba(0,0,0,.55); padding: 1px 6px; border-radius: 6px; }
@keyframes rf { 0% { transform: translateY(40px) scale(.4); opacity: 0; } 15% { transform: translateY(0) scale(1.15); opacity: 1; } 100% { transform: translateY(-45vh) scale(1); opacity: 0; } }
.defi-overlay { position: fixed; inset: 0; z-index: 95; background: rgba(5,8,12,.82); display: grid; place-items: center; padding: 16px; }
.defi-box { background: #1a2129; color: #e8ecef; border: 2px solid #f2c14e; border-radius: 16px; padding: 1.2rem; width: min(440px, 100%); font: 15px system-ui, sans-serif; }
.defi-box h2 { margin: 0 0 .4rem; color: #f2c14e; }
.defi-box ol { padding-left: 1.4rem; display: flex; flex-direction: column; gap: .3rem; }
.defi-box li.me { color: #f2c14e; font-weight: 700; }
.defi-actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .8rem; }
.defi-actions button { font: inherit; font-weight: 600; background: #f2c14e; color: #222; border: 0; border-radius: 8px; padding: .5rem .9rem; cursor: pointer; }
.defi-actions button.ghost { background: transparent; color: #e8ecef; border: 1px solid #2a333d; }
@media (prefers-reduced-motion: reduce) { .reaction-float { animation-duration: 1.5s; } }`;
  document.head.appendChild(style);

  window.Social = {
    rng, backend, myCode, publish, lobbyBeat, lobbyRemove, lobbyList, findTable, hubLink, sendInvite, inviteDialog, tableReady, tableLink, wantsTable, listenInvites, friends, addFriendByCode, addFriendUid, removeFriend, leaderboard,
    createChallenge, getChallenge, submitChallenge, challengeLink, showChallengeResult, shareLink,
    showProfile, reactionBar, floatReaction, isReaction, EMOJIS, QUICK, waitingRoom, enableNotifications, notify,
  };
  if (window.Casino) setTimeout(() => { listenInvites().catch(() => {}); }, 1200);
})();
