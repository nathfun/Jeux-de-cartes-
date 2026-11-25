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
  async function publish() {
    const b = await backend();
    if (!b) return false;
    const p = P();
    // Avec le serveur du Casino, c'est lui qui écrit le profil public (impossible d'y mettre une fausse banque)
    if (window.Casino && Casino.server) {
      const key = (p.friendCode || '') + '|' + (p.pseudo || '');
      if (key === lastPub) return true; // le serveur republie déjà le profil après chaque partie
      lastPub = key;
      await Casino.call('profile.set', { code: p.friendCode || undefined, pseudo: p.pseudo });
      return true;
    }
    await b.set('profiles/' + b.uid, {
      pseudo: p.pseudo || 'Joueur', avatar: p.avatar, xp: p.xp, level: Casino.levelOf(p.xp), wallet: Math.round(p.wallet),
      biggestWin: Math.round(p.totals.biggestWin || 0), hands: p.totals.hands, achievements: Object.keys(p.achievements).length,
      code: p.friendCode || null, updatedAt: Date.now(),
    });
    return true;
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
  const isReaction = (m) => m && m.reaction && EMOJIS.includes(m.text);

  const style = document.createElement('style');
  style.textContent = `
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
    rng, backend, myCode, publish, friends, addFriendByCode, addFriendUid, removeFriend, leaderboard,
    createChallenge, getChallenge, submitChallenge, challengeLink, showChallengeResult, shareLink,
    reactionBar, floatReaction, isReaction, EMOJIS,
  };
})();
