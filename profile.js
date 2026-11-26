/*
 * Profil du joueur, commun à tous les jeux du Casino :
 *  - banque unique ; parties réelles (somme apportée puis encaissée) et mode Entraînement (rien ne compte) ;
 *  - expérience et niveaux, bonus quotidien, défis du jour, succès, banque du temps, prix entre amis ;
 *  - personnalisation (tapis, dos de cartes), notifications, effet « gros gain », vibrations.
 *
 * Deux façons de fonctionner :
 *  - avec le serveur (Firebase + Cloud Functions, window.CASINO_SERVER = true) : la banque et tous les tirages
 *    des parties réelles sont gérés par le serveur (functions/), impossible de tricher depuis le navigateur ;
 *  - sans serveur (tests, ?backend=local) : tout est calculé dans le navigateur avec les mêmes règles (casino-rules.js).
 * Tout est en jetons virtuels : aucun argent réel.
 */
(function () {
  'use strict';
  const R = window.CasinoRules;
  const KEY = 'casino-profile-v1';
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const { AVATARS, FELTS, BACKS, CHALLENGES, ACHIEVEMENTS, TIME_PACKS, need, levelOf, title } = R;
  const cfg = window.FIREBASE_CONFIG;
  const ONLINE = !!(cfg && cfg.databaseURL && !/[?&]backend=local\b/.test(location.search) && !window.claude);
  // Serveur du Casino : sur ton NAS / un hébergeur (window.CASINO_API = adresse https) ou Cloud Functions (CASINO_SERVER)
  const API = String(window.CASINO_API || '').replace(/\/+$/, '');
  const SERVER = ONLINE && (!!window.CASINO_SERVER || !!API);
  // Sans serveur payant : la banque est rangée dans Firebase (bank/<uid>) et les règles de la base
  // n'acceptent que les mouvements d'argent plausibles (voir database.rules.json)
  const BANK = ONLINE && !SERVER;
  // Réglages propres à l'appareil (jamais envoyés au serveur comme argent)
  const LOCAL_KEYS = ['equipped', 'settings', 'friends', 'friendCode', 'friendCodeUid', 'myChallenges', 'savedAt', 'adminSeen', 'pokerWeek', 'pokerWeekPrev', 'weekAwarded'];

  // ---------- Stockage ----------
  let P = null;
  function localDefaults() { return { equipped: Object.assign({}, R.DEFAULT_EQUIP), settings: { music: false, vibrate: true } }; }
  function load() {
    if (P) return P;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
    P = Object.assign(localDefaults(), R.normalize(raw, Date.now()), raw ? pick(raw, LOCAL_KEYS) : {});
    if (P._econMigrated) { delete P._econMigrated; setTimeout(() => { try { save(); } catch (e) { /* ignore */ } }, 0); }
    if (!raw || !raw.pseudo) { try { P.pseudo = P.pseudo || localStorage.getItem('bj-pseudo') || ''; } catch (e) { /* ignore */ } }
    return P;
  }
  function pick(o, keys) { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  const listeners = [];
  function save(keepStamp) {
    if (!keepStamp) P.savedAt = Date.now();
    // historique de la banque : dernière valeur de chaque jour (31 jours)
    if (typeof P.wallet === 'number') {
      P.bankHist = P.bankHist || {};
      P.bankHist[R.today(Date.now())] = Math.round(P.wallet);
      const days = Object.keys(P.bankHist).sort();
      while (days.length > 31) delete P.bankHist[days.shift()];
    }
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* ignore */ }
    listeners.forEach((f) => { try { f(P); } catch (e) { /* ignore */ } });
  }

  // ---------- Serveur ----------
  let fbp = null;
  function firebase() {
    if (!fbp) {
      fbp = (async () => {
        if (!cfg || !cfg.databaseURL) return null;
        const [appMod, authMod, dbMod, fnMod] = await Promise.all(['app', 'auth', 'database'].concat(SERVER && !API ? ['functions'] : []).map((m) => import(FB + 'firebase-' + m + '.js')));
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
        const auth = authMod.getAuth(app);
        if (auth.authStateReady) await auth.authStateReady();
        if (!auth.currentUser) await authMod.signInAnonymously(auth);
        const fn = SERVER && !API ? fnMod.httpsCallable(fnMod.getFunctions(app, 'europe-west1'), 'casino') : null;
        return { app, auth, authMod, dbMod, db: dbMod.getDatabase(app), fn };
      })();
      fbp.catch(() => { fbp = null; });
    }
    return fbp;
  }
  // Applique la réponse du serveur : profil à jour + notifications
  function applyServer(res) {
    load();
    if (res && res.player) {
      const keep = pick(P, LOCAL_KEYS);
      P = Object.assign(localDefaults(), R.normalize(res.player, Date.now()), keep);
      save(true);
    }
    showNotes(res && res.notes);
  }
  function showNotes(notes) {
    (notes || []).forEach((n) => {
      toast(n.title, n.text, n.icon, n.kind);
      if (n.kind === 'level') { vibrate([40, 30, 80]); if (window.Sfx) Sfx.win(); }
      else if (n.kind === 'achievement') vibrate([30, 30, 30, 30, 90]);
      else if (n.kind === 'challenge') vibrate([40, 30, 40]);
    });
  }
  const errText = (e) => (e && e.message ? String(e.message).replace(/^.*?:\s*/, '') : 'Le serveur ne répond pas.');
  /** Opération sur le serveur : renvoie result, ou { error } (message pour le joueur). */
  async function call(op, data) {
    if (!SERVER) return { error: 'Serveur non configuré.' };
    try {
      const f = await firebase();
      if (!f) return { error: 'Serveur injoignable.' };
      let res;
      if (API) {
        // serveur du NAS : le jeton du compte prouve qui joue, le serveur décide de tout le reste
        const u = f.auth.currentUser;
        if (!u) return { error: 'Connexion requise.' };
        const send = async (force) => fetch(API + '/api/casino', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await u.getIdToken(force)) },
          body: JSON.stringify({ op, data: data || {} }),
        });
        let r = await send(false);
        if (r.status === 401) r = await send(true); // jeton expiré : on le renouvelle une fois
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { error: j.error || 'Erreur du serveur (' + r.status + ').' };
        res = j;
      } else res = (await f.fn({ op, data: data || {} })).data;
      applyServer(res);
      return res.result || {};
    } catch (e) {
      const msg = e && e.code === 'functions/failed-precondition' ? e.message : (e && e.code === 'functions/unavailable') || /network|internet|fetch/i.test(String(e && e.message)) ? 'Pas de connexion au serveur.' : errText(e);
      return { error: msg };
    }
  }
  let syncing = null;
  function sync() {
    const acc = (() => { try { return JSON.parse(localStorage.getItem('casino-account')) || {}; } catch (e) { return {}; } })();
    if (!syncing) syncing = call('sync', { pseudo: load().pseudo || acc.pseudo || '' }).finally(() => { setTimeout(() => { syncing = null; }, 2000); });
    return syncing;
  }

  // ---------- Banque protégée par les règles de la base (sans serveur payant) ----------
  const BONUS_GAP = 6 * 3600000; // les règles imposent 6 h entre deux bonus
  const GAIN_CAP = 10000;        // et au plus 10 000 € de gains encaissés par 24 h
  let bank = null, bankUid = null, bankUnsub = null, offset = 0, bankReady = null;
  const packMs = (id) => { const p = TIME_PACKS.find((x) => x.id === id); return p ? p.minutes * 60000 : 0; };
  function bankInit() {
    bankReady = (async () => {
      const f = await firebase();
      if (!f) return;
      f.dbMod.onValue(f.dbMod.ref(f.db, '.info/serverTimeOffset'), (snap) => { offset = snap.val() || 0; });
      f.authMod.onAuthStateChanged(f.auth, (u) => { if (u && u.uid !== bankUid) attach(f, u.uid); });
      if (f.auth.currentUser) await attach(f, f.auth.currentUser.uid);
    })().catch(() => {});
    return bankReady;
  }
  async function attach(f, uid) {
    if (bankUnsub) bankUnsub();
    bankUid = uid; bank = null;
    const ref = f.dbMod.ref(f.db, 'bank/' + uid);
    // première visite : la banque est créée à 10 000 € (seul montant accepté par les règles)
    const first = await f.dbMod.get(ref).catch(() => null);
    if (first && !first.exists()) {
      await f.dbMod.runTransaction(ref, (cur) => (cur ? undefined : { wallet: R.START_WALLET, why: 'new', at: f.dbMod.serverTimestamp(), x: 0 }), { applyLocally: false }).catch(() => {});
    }
    if (bankUid !== uid) return; // le joueur a changé de compte entre-temps
    await new Promise((resolve) => {
      bankUnsub = f.dbMod.onValue(ref, (snap) => { bank = snap.val(); if (bank) reconcile(); resolve(); }, () => resolve());
    });
  }
  // La banque en ligne fait foi : banque, parties en cours, banque du temps, date du dernier bonus
  function reconcile() {
    load();
    P.wallet = bank.wallet;
    P.timebank = bank.tb ? { pack: bank.tb.p, start: bank.tb.s - offset, end: bank.tb.s - offset + packMs(bank.tb.p) + 3000 } : null;
    P.bonusAt = bank.bonus ? bank.bonus - offset : 0;
    const ses = bank.ses || {};
    Object.keys(ses).forEach((g) => { if (!P.sessions[g]) P.sessions[g] = { stack: ses[g], start: ses[g], at: Date.now() }; else P.sessions[g].start = ses[g]; });
    Object.keys(P.sessions).forEach((g) => { if (!(g in ses)) delete P.sessions[g]; });
    save(true);
  }
  // Sans connexion, Firebase attend indéfiniment : on abandonne au bout de 12 s
  function bankTx(why, delta, mutate) {
    return Promise.race([
      bankTx0(why, delta, mutate).catch(() => ({ error: 'Banque injoignable : vérifie ta connexion.' })),
      new Promise((r) => setTimeout(() => r({ error: 'Pas de connexion : les parties réelles ont besoin d\'internet (l\'entraînement marche hors ligne).' }), 12000)),
    ]);
  }
  async function bankTx0(why, delta, mutate) {
    await (bankReady || bankInit());
    const f = await firebase();
    if (!f || !bankUid) return { error: 'Banque injoignable : vérifie ta connexion.' };
    let refused = null, x = 0;
    try {
      const res = await f.dbMod.runTransaction(f.dbMod.ref(f.db, 'bank/' + bankUid), (cur) => {
        refused = null;
        if (!cur) return {}; // cache vide : Firebase relit la vraie valeur et rappelle la fonction
        const o = JSON.parse(JSON.stringify(cur));
        o.wallet = Math.round((cur.wallet + delta) * 100) / 100;
        if (o.wallet < 0) { refused = 'Pas assez d\'argent dans ta banque.'; return; }
        o.why = why; o.at = f.dbMod.serverTimestamp(); delete o.g;
        const r = mutate ? mutate(o, cur) : null;
        if (r === false) { refused = refused || 'Opération impossible.'; return; }
        x = (r && r.x) || 0;
        o.x = x;
        if (x > 0 || cur.gw) {
          const t = Date.now() + offset;
          if (cur.gw && t - cur.gw.d < 86400000 - 60000) o.gw = { d: cur.gw.d, s: cur.gw.s + x };
          else if (!cur.gw || t - cur.gw.d >= 86400000 + 60000) o.gw = { d: f.dbMod.serverTimestamp(), s: x };
          else { refused = 'Réessaie dans une minute.'; return; }
          if (o.gw.s > GAIN_CAP) { refused = 'Plafond de ' + GAIN_CAP.toLocaleString('fr-FR') + ' € de gains encaissés sur 24 h atteint : garde ta partie et encaisse plus tard.'; return; }
        }
        return o;
      }, { applyLocally: false });
      if (!res.committed) return { error: refused || 'Opération refusée.' };
      return { ok: true, wallet: res.snapshot.val().wallet };
    } catch (e) {
      // compte bloqué par l'administrateur, ou règles de la base pas à jour
      const banned = await f.dbMod.get(f.dbMod.ref(f.db, 'banned/' + bankUid)).then((v) => v.exists()).catch(() => false);
      if (banned) return { error: 'Ton compte a été bloqué par l\'administrateur du Casino.' };
      return { error: 'Opération refusée par la banque (' + ((e && e.code) || 'erreur') + '). Si ça continue, l\'administrateur doit recoller database.rules.json dans Firebase (Règles → Publier).' };
    }
  }
  // Mouvement d'argent validé en ligne, puis appliqué au profil (XP, défis…) avec la banque officielle
  async function bankOp(why, delta, mutate, localFn) {
    const t = await bankTx(why, delta, mutate);
    if (t.error) { if (bank) reconcile(); return t; }
    const out = localFn ? local(localFn) : null;
    P.wallet = t.wallet;
    save(true);
    return { ok: true, out };
  }

  // Mode sans serveur : les mêmes règles appliquées localement
  function local(fn) {
    load();
    const N = [];
    const out = fn(N);
    save();
    showNotes(N);
    return out;
  }

  // ---------- Notifications ----------
  function container() {
    let c = document.getElementById('casino-toasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'casino-toasts';
      c.setAttribute('role', 'status');
      document.body.appendChild(c);
      injectStyle();
    }
    return c;
  }
  function toast(title, text, icon, kind) {
    const c = container();
    const el = document.createElement('div');
    el.className = 'casino-toast ' + (kind || '');
    const i = document.createElement('span'); i.className = 'ct-icon'; i.textContent = icon || '⭐';
    const b = document.createElement('div');
    const t = document.createElement('b'); t.textContent = title;
    const p = document.createElement('div'); p.textContent = text || '';
    b.append(t, p);
    el.append(i, b);
    c.appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  function vibrate(pattern) {
    load();
    if (P.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  }

  // Effet « gros gain » : montant qui défile, pièces qui tombent
  // ---------- Partage d'un gros gain (image + lien d'invitation) ----------
  const SITE = (() => { try { const src = (document.currentScript && document.currentScript.src) || ''; return src ? src.replace(/profile\.js(\?.*)?$/, '') : location.href.replace(/[^/]*$/, ''); } catch (e) { return location.href.replace(/[^/]*$/, ''); } })();
  const GAME_ICON = { blackjack: '🂡', poker: '♠', roulette: '🎡', slots: '🎰', crash: '🚀', plinko: '🔮', trader: '📈', mines: '💎' };
  function gameHere() { const m = /\/(blackjack|poker|roulette|slots|crash|plinko|trader|mines)\//.exec(location.pathname); return m ? m[1] : null; }
  function loadImg(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
  async function winCard(o, noIcon) {
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const bg = x.createRadialGradient(W / 2, 260, 60, W / 2, 600, 1100); bg.addColorStop(0, '#3b1a78'); bg.addColorStop(.55, '#140f3d'); bg.addColorStop(1, '#07091a');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    // pluie de pièces / étoiles
    const fx = R.itemOf('effect', Casino.equipped ? Casino.equipped('effect') : 'pieces') || R.SHOP.effect[0];
    x.globalAlpha = .35; x.font = '56px serif'; x.textAlign = 'center';
    // décor sur les bords seulement, pour ne pas gêner le texte
    for (let k = 0; k < 16; k++) { const left = k % 2 === 0; x.fillText(fx.emojis[k % fx.emojis.length], left ? 60 + (k * 37) % 70 : W - 60 - (k * 41) % 70, 90 + k * 78); }
    x.globalAlpha = 1;
    const icon = noIcon ? null : await loadImg(SITE + 'icons/icon-192.png');
    if (icon) { x.save(); x.beginPath(); x.roundRect ? x.roundRect(W / 2 - 110, 120, 220, 220, 56) : x.rect(W / 2 - 110, 120, 220, 220); x.clip(); x.drawImage(icon, W / 2 - 110, 120, 220, 220); x.restore(); }
    const grad = (y0, y1) => { const g = x.createLinearGradient(140, y0, W - 140, y1); g.addColorStop(0, '#f2c14e'); g.addColorStop(.55, '#f472b6'); g.addColorStop(1, '#22d3ee'); return g; };
    x.fillStyle = grad(0, 0); x.font = '900 72px system-ui, sans-serif'; x.fillText('Lucky Lounge', W / 2, 430);
    x.fillStyle = '#e5e7eb'; x.font = '600 44px system-ui, sans-serif';
    x.fillText((o.icon ? o.icon + '  ' : '') + (o.game || ''), W / 2, 560);
    x.fillStyle = '#fff'; x.font = '900 86px system-ui, sans-serif'; x.fillText(o.title || 'GROS GAIN !', W / 2, 680, W - 120);
    x.shadowColor = 'rgba(242,193,78,.8)'; x.shadowBlur = 40; x.fillStyle = '#f2c14e'; x.font = '900 170px system-ui, sans-serif';
    x.fillText('+' + Math.round(o.amount).toLocaleString('fr-FR') + ' €', W / 2, 880, W - 80); x.shadowBlur = 0;
    x.fillStyle = '#cbd5e1'; x.font = '600 44px system-ui, sans-serif';
    x.fillText((P.avatar || '🎩') + '  ' + (P.pseudo || 'Un joueur') + ' · niveau ' + levelOf(P.xp), W / 2, 990);
    x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.roundRect ? x.roundRect(110, 1080, W - 220, 170, 40) : x.rect(110, 1080, W - 220, 170); x.fill();
    x.fillStyle = '#fff'; x.font = '800 48px system-ui, sans-serif'; x.fillText('Viens jouer avec moi !', W / 2, 1155);
    x.fillStyle = '#a5b4fc'; x.font = '600 34px system-ui, sans-serif'; x.fillText('Le casino entre amis · 100 % fun, 0 € réel', W / 2, 1210);
    // une image d'une autre origine « salit » le dessin : on le refait sans l'icône
    try { x.getImageData(0, 0, 1, 1); } catch (e) { return winCard(o, true); }
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  async function shareWin(o) {
    const code = P.friendCode;
    const url = SITE + 'index.html' + (code ? '?ref=' + code : '');
    const text = (o.title || 'Gros gain') + ' : +' + Math.round(o.amount).toLocaleString('fr-FR') + ' € sur Lucky Lounge 🎰' + (code ? ' — rejoins-moi, +2 000 € offerts pour toi et moi !' : '');
    try {
      const blob = await winCard(o);
      const file = blob && new File([blob], 'lucky-lounge-gain.png', { type: 'image/png' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: text + ' ' + url }); return; }
      if (navigator.share) { await navigator.share({ title: 'Lucky Lounge', text, url }); return; }
      if (blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lucky-lounge-gain.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
      try { await navigator.clipboard.writeText(text + ' ' + url); toast('Image enregistrée', 'Le lien est copié : colle-le avec l\'image dans ta conversation.', '📤'); } catch (e) { /* ignore */ }
    } catch (e) { /* partage annulé */ }
  }

  function bigWin(amount, label) {
    injectStyle();
    const o = document.createElement('div');
    o.className = 'casino-bigwin';
    const box = document.createElement('div'); box.className = 'cb-box';
    const t = document.createElement('div'); t.className = 'cb-title'; t.textContent = label || 'GROS GAIN !';
    const v = document.createElement('div'); v.className = 'cb-amount'; v.textContent = '+0 €';
    box.append(t, v);
    o.appendChild(box);
    for (let k = 0; k < 28; k++) {
      const coin = document.createElement('span');
      coin.className = 'cb-coin';
      const fx = R.itemOf('effect', Casino.equipped ? Casino.equipped('effect') : 'pieces') || R.SHOP.effect[0];
      coin.textContent = fx.emojis[k % fx.emojis.length];
      coin.style.left = Math.random() * 100 + '%';
      coin.style.animationDelay = Math.random() * 1.2 + 's';
      coin.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
      o.appendChild(coin);
    }
    document.body.appendChild(o);
    vibrate([60, 40, 60, 40, 120]);
    if (window.Sfx) { Sfx.win(); setTimeout(() => Sfx.win(), 350); setTimeout(() => Sfx.win(), 700); }
    const t0 = performance.now(), D = 1600;
    (function step(t) {
      const u = Math.min(1, (t - t0) / D);
      v.textContent = '+' + Math.round(amount * (1 - Math.pow(1 - u, 3))).toLocaleString('fr-FR') + ' €';
      if (u < 1) requestAnimationFrame(step);
    })(t0);
    // bouton « Partager » : une image du gain + ton lien d'invitation
    const g = gameHere();
    const sh = document.createElement('button'); sh.type = 'button'; sh.className = 'cb-share'; sh.textContent = '📤 Partager ce gain';
    let kept = false;
    sh.addEventListener('click', (e) => { e.stopPropagation(); kept = true; o.classList.remove('out'); sh.disabled = true; sh.textContent = 'Préparation…';
      shareWin({ amount, title: label || 'GROS GAIN !', game: g ? R.GAMES[g] : '', icon: g ? GAME_ICON[g] : '🎰' }).finally(() => { sh.disabled = false; sh.textContent = '📤 Partager ce gain'; setTimeout(() => o.remove(), 1500); }); });
    box.appendChild(sh);
    o.addEventListener('click', () => o.remove());
    setTimeout(() => { if (!kept) o.classList.add('out'); }, 5200);
    setTimeout(() => { if (!kept) o.remove(); }, 5800);
  }


  // ---------- Choix du mode avant une partie solo ----------
  /**
   * Affiche dans `box` le choix entre Entraînement (crédit illimité, aides) et Partie réelle
   * (somme apportée de la banque, sans aides, compte pour la progression).
   * opts : { game, min, suggest, realNote, onStart(mode, amount, resumed) }
   */
  // ---------- Écran de lancement des jeux ----------
  // Chaque jeu a son ambiance : icône, couleurs, accroche et points forts
  const LAUNCH = {
    blackjack: { icon: '🂡', deco: ['♠', '♥', '♦', '♣'], name: 'Blackjack', tag: 'Approche-toi de 21 sans dépasser… et bats le croupier.', a: '#2ecc71', b: '#f2c14e', bg: 'radial-gradient(ellipse at 50% 0%, #1f6b45 0%, #0d2a1d 60%, #07140e 100%)', pills: ['6 jeux de cartes', 'Croupier reste à 17', 'Paye 3 pour 2'] },
    poker: { icon: '♠', deco: ['A♠', 'K♥', '🂮', '♣'], name: 'Poker Texas Hold\'em', tag: 'Tournoi contre des bots : le dernier avec des jetons gagne.', a: '#4fc3f7', b: '#f2c14e', bg: 'radial-gradient(ellipse at 50% 0%, #1c4a63 0%, #0d1f2c 60%, #070f16 100%)', pills: ['No-Limit', 'Blindes qui montent', 'Jusqu\'à 6 joueurs'] },
    roulette: { icon: '🎡', deco: ['🔴', '⚫', '🟢', '🪙'], name: 'Roulette européenne', tag: 'Faites vos jeux… rien ne va plus !', a: '#ef4444', b: '#f2c14e', bg: 'radial-gradient(ellipse at 50% 0%, #6b1d1d 0%, #2a0d0d 60%, #140606 100%)', pills: ['Un seul zéro', 'Règles françaises', 'Paye jusqu\'à 35×'] },
    slots: { icon: '🎰', deco: ['7️⃣', '💎', '🍒', '⭐'], name: 'Casino Royal', tag: '5 rouleaux, 10 lignes, tours gratuits et jackpot.', a: '#c084fc', b: '#f2c14e', bg: 'radial-gradient(ellipse at 50% 0%, #4c1d6b 0%, #1d0d2a 60%, #0e0614 100%)', pills: ['Jokers', 'Tours gratuits ×2', 'Jackpot 5000×'] },
    crash: { icon: '🚀', deco: ['✦', '✧', '🌙', '⭐'], name: 'Rocket Crash', tag: 'Retire ta mise avant que la fusée n\'explose !', a: '#8b5cf6', b: '#22d3ee', bg: 'radial-gradient(ellipse at 50% 0%, #2a1a6e 0%, #0b1440 55%, #050816 100%)', pills: ['Retrait auto', 'RTP 97 %', 'Équité vérifiable'] },
    plinko: { icon: '🔮', deco: ['●', '•', '◦', '✦'], name: 'Plinko', tag: 'Lâche des billes et vise les cases du bord.', a: '#f472b6', b: '#a78bfa', bg: 'radial-gradient(ellipse at 50% 0%, #3b1a6e 0%, #0b1440 55%, #050816 100%)', pills: ['Jusqu\'à ×1 000', '3 niveaux de risque', 'Mode auto'] },
    gold: { icon: '🤠', deco: ['🟡', '🧨', '⛏️', '💰'], name: 'Ruée vers l\'Or', tag: 'Fais exploser la mine et décroche le Filon !', a: '#f59e0b', b: '#fde047', bg: 'radial-gradient(ellipse at 50% 0%, #6b3a12 0%, #2a160a 60%, #120904 100%)', pills: ['243 façons de gagner', 'Bonus Le Filon', 'Jackpot 1 000×'] },
    mines: { icon: '💎', deco: ['💣', '💎', '✦', '⭐'], name: 'Mines', tag: 'Retourne des diamants… et encaisse avant la mine !', a: '#38bdf8', b: '#f472b6', bg: 'radial-gradient(ellipse at 50% 0%, #123a5c 0%, #0b1440 55%, #050816 100%)', pills: ['1 à 24 mines', 'Jusqu\'à ×24 000', 'RTP 97 %'] },
    trader: { icon: '📈', deco: ['▲', '▼', '💹', '₿'], name: 'Bourse Flash', tag: 'Achète, vends, et clôture au bon moment.', a: '#34d399', b: '#22d3ee', bg: 'radial-gradient(ellipse at 50% 0%, #0f3b4a 0%, #0b1440 55%, #050816 100%)', pills: ['Effet de levier', 'Krachs et envolées', '3 actions en direct'] },
  };
  const themeOf = (g) => LAUNCH[g] || { icon: '🎲', deco: ['✦'], name: (R.GAMES[g] || 'Jeu'), tag: '', a: '#f2c14e', b: '#4fc3f7', bg: '#10151c', pills: [] };
  const fmtE = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** En-tête animé du jeu (icône flottante, titre, accroche, points forts). */
  function gameHero(game, over) {
    injectStyle();
    const t = Object.assign({}, themeOf(game), over || {});
    const h = mk('div', 'cm-hero');
    const art = mk('div', 'cm-art');
    t.deco.forEach((d, i) => { const x = mk('span', 'cm-deco d' + i, d); art.appendChild(x); });
    art.append(mk('span', 'cm-ring'), mk('span', 'cm-icon', t.icon));
    const pills = mk('div', 'cm-pills'); t.pills.forEach((p) => pills.appendChild(mk('span', '', p)));
    h.append(art, mk('div', 'cm-name', t.name), mk('div', 'cm-tag', t.tag), pills);
    return h;
  }
  function applyTheme(el, game) {
    const t = themeOf(game);
    el.style.setProperty('--cm-a', t.a); el.style.setProperty('--cm-b', t.b); el.style.setProperty('--cm-bg', t.bg);
  }

  // Écran « Entre amis » (créer / rejoindre une table) avec la même ambiance que l'écran de lancement
  const MULTI_PILLS = { blackjack: ['Jusqu\'à 5 places', 'Classement final', '+50 € au 1er'], poker: ['Cartes secrètes', 'Spectateurs', '+50 € au 1er'], roulette: ['Même roue pour tous', 'Chacun mise', '+50 € au 1er'] };
  function styleLobby(el, game, o) {
    if (!el || el.dataset.cmStyled) return;
    injectStyle();
    el.dataset.cmStyled = '1';
    el.classList.add('cm-mlobby');
    applyTheme(el, game);
    el.querySelectorAll(':scope > h2, :scope > p.muted').forEach((x) => { x.classList.add('cm-hide'); });
    el.prepend(gameHero(game, { name: themeOf(game).name.replace(/ (européenne|Texas Hold'em)$/, '') + ' entre amis', tag: 'Crée ta table ou rejoins celle de tes amis avec son code.', pills: MULTI_PILLS[game] || [] }));
    // carte « Rejoindre » : pseudo + code
    const join = el.querySelector(o.join), pseudo = o.pseudo && el.querySelector(o.pseudo);
    const card = mk('div', 'cm-joincard');
    card.appendChild(mk('h3', '', 'Rejoindre une table'));
    const pr = pseudo && pseudo.closest('.row');
    if (join) join.parentNode.insertBefore(card, join);
    if (pr) card.appendChild(pr);
    if (join) { card.appendChild(join); const ci = join.querySelector('input'); if (ci) ci.placeholder = 'CODE'; }
    card.appendChild(mk('p', 'cm-join-tip', 'Demande le code à 4 lettres à ton ami, ou choisis une partie dans l\'onglet Multijoueur de l\'accueil.'));
    const create = el.querySelector('.create-form');
    if (create) { const h = create.querySelector('h3'); if (h) h.textContent = 'Créer une table'; const sb = create.querySelector('button[type="submit"]'); if (sb) { sb.classList.remove('primary'); sb.classList.add('cm-cta'); sb.textContent = '▶ Créer la table'; } }
  }

  /** Animation de lancement d'une partie, par-dessus le jeu (n'attend rien : le jeu démarre en dessous). */
  function launchFx(game, label, sub) {
    injectStyle();
    const t = themeOf(game);
    const old = document.querySelector('.cm-launch'); if (old) old.remove();
    const ov = mk('div', 'cm-launch'); applyTheme(ov, game);
    const burst = mk('div', 'cm-burst');
    for (let i = 0; i < 18; i++) {
      const c = mk('i', '', i % 3 ? '' : t.deco[i % t.deco.length]);
      const ang = (i / 18) * Math.PI * 2, dist = 120 + Math.random() * 120;
      c.style.setProperty('--x', Math.round(Math.cos(ang) * dist) + 'px'); c.style.setProperty('--y', Math.round(Math.sin(ang) * dist) + 'px');
      c.style.animationDelay = (Math.random() * 0.12) + 's';
      burst.appendChild(c);
    }
    ov.append(burst, mk('div', 'cm-l-icon', t.icon), mk('div', 'cm-l-title', label || 'Bonne chance !'), mk('div', 'cm-l-sub', sub || t.name));
    document.body.appendChild(ov);
    if (window.Sfx) { try { Sfx.chips(); setTimeout(() => Sfx.chips(), 160); } catch (e) { /* ignore */ } }
    vibrate([15, 40, 25]);
    const ms = reducedMotion() ? 700 : 1450;
    setTimeout(() => ov.classList.add('out'), ms - 380);
    setTimeout(() => ov.remove(), ms);
  }

  /**
   * Écran de lancement d'un jeu solo : partie réelle avec une somme apportée de la banque
   * (ou reprise d'une partie en cours). En mode Apprentissage (choisi sur l'accueil), le jeu démarre tout de suite.
   * opts : { game, min, suggest, realNote, onStart(mode, amount, resumed) }
   */
  function modePicker(box, opts) {
    injectStyle();
    load();
    const host = box.parentNode;
    if (host && host.classList) { host.classList.add('cm-host'); applyTheme(host, opts.game); }
    // Mode Apprentissage (choisi sur l'accueil) : on joue tout de suite, crédit illimité et aides
    if (Casino.learn) {
      box.innerHTML = '';
      Casino.training = true;
      setTimeout(() => { opts.onStart('train', Casino.TRAIN_BANK, false); launchFx(opts.game, '🎓 Apprentissage', 'Crédit illimité · aides et conseils'); }, 0);
      return;
    }
    // Partie réelle déjà en cours dans ce jeu : on la reprend directement
    if (P.sessions[opts.game] && !opts.noAutoResume) {
      box.innerHTML = '';
      box.appendChild(mk('p', 'cm-wait', 'Reprise de ta partie…'));
      Casino.startSession(opts.game, P.sessions[opts.game].stack).then((r) => {
        if (!r || r.error) { opts.noAutoResume = true; modePicker(box, opts); return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, true, r);
        launchFx(opts.game, 'Partie reprise', fmtE(r.session.stack) + ' sur la table');
      });
      return;
    }
    box.innerHTML = '';
    box.className = 'cm-picker';
    const card = mk('div', 'cm-launcher'); applyTheme(card, opts.game);
    card.appendChild(gameHero(opts.game));
    const panel = mk('div', 'cm-panel');
    const cur = P.sessions[opts.game];
    const min = opts.min || 1;
    const wal = P.wallet;
    const note = mk('p', 'cm-note');
    if (cur) {
      panel.append(mk('div', 'cm-label', 'Partie en cours'), mk('div', 'cm-big', fmtE(cur.stack)), mk('div', 'cm-sub', 'sur la table · apporté : ' + fmtE(cur.start)));
      const rb = mk('button', 'cm-cta', '▶ Reprendre la partie'); rb.type = 'button';
      rb.onclick = async () => {
        rb.disabled = true;
        const r = await Casino.startSession(opts.game, cur.stack);
        rb.disabled = false;
        if (!r || r.error) { note.textContent = (r && r.error) || 'Impossible de reprendre.'; return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, true, r);
        launchFx(opts.game, 'Partie reprise', fmtE(r.session.stack) + ' sur la table');
      };
      panel.append(rb, note);
    } else {
      const maxV = Math.max(min, Math.floor(wal));
      let val = Math.max(min, Math.min(Math.floor(wal), opts.suggest || 500));
      panel.appendChild(mk('div', 'cm-label', 'Combien apportes-tu à la table ?'));
      const big = mk('div', 'cm-big'); const amount = mk('span', 'cm-amt'); big.append(amount, mk('span', 'cm-eur', ' €'));
      const after = mk('div', 'cm-sub');
      const range = document.createElement('input'); range.type = 'range'; range.className = 'cm-range'; range.min = min; range.max = maxV; range.step = 1; range.setAttribute('aria-label', 'Somme apportée');
      const exact = document.createElement('input'); exact.type = 'number'; exact.className = 'cm-exact'; exact.min = min; exact.max = maxV; exact.step = 1; exact.setAttribute('aria-label', 'Somme exacte');
      const chips = mk('div', 'cm-chips');
      const show = (v, bump) => {
        val = Math.max(min, Math.min(maxV, Math.floor(v) || min));
        amount.textContent = val.toLocaleString('fr-FR');
        range.value = val; if (document.activeElement !== exact) exact.value = val;
        range.style.setProperty('--p', ((val - min) / Math.max(1, maxV - min) * 100) + '%');
        after.textContent = 'Banque : ' + fmtE(wal) + '  →  il te restera ' + fmtE(wal - val);
        chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === val));
        if (bump) { big.classList.remove('bump'); void big.offsetWidth; big.classList.add('bump'); }
      };
      [[10, 'c1'], [50, 'c2'], [100, 'c3'], [250, 'c4']].filter(([v]) => v >= min && v <= wal).forEach(([v, c]) => {
        const q = mk('button', 'cm-chip ' + c); q.type = 'button'; q.dataset.v = v;
        q.append(mk('b', '', v >= 1000 ? String(v / 1000).replace('.', ',') + 'k' : String(v)));
        q.onclick = () => { show(v, true); if (window.Sfx) Sfx.chips(); };
        chips.appendChild(q);
      });
      if (wal >= min) { const q = mk('button', 'cm-chip c5'); q.type = 'button'; q.dataset.v = Math.floor(wal); q.append(mk('b', '', 'Tout')); q.onclick = () => { show(wal, true); if (window.Sfx) Sfx.chips(); }; chips.appendChild(q); }
      range.oninput = () => show(range.value);
      exact.oninput = () => { if (exact.value !== '') show(exact.value); };
      exact.onchange = () => show(exact.value || min);
      const go = mk('button', 'cm-cta', '▶ Lancer la partie'); go.type = 'button';
      go.onclick = async () => {
        if (!(val >= min)) { note.textContent = 'Il faut apporter au moins ' + fmtE(min) + '.'; return; }
        if (val > P.wallet) { note.textContent = 'Ta banque ne contient que ' + fmtE(P.wallet) + '. Gagne du temps contre de l\'argent sur l\'accueil (banque du temps).'; return; }
        go.disabled = true; note.textContent = '';
        const r = await Casino.startSession(opts.game, val);
        go.disabled = false;
        if (!r || r.error) { note.textContent = (r && r.error) || 'Impossible de commencer.'; return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, !!r.resumed, r);
        launchFx(opts.game, 'Bonne chance !', fmtE(r.session.stack) + ' sur la table');
      };
      const exactRow = mk('div', 'cm-exact-row'); exactRow.append(mk('span', '', 'Somme exacte'), exact);
      panel.append(big, range, chips, after, exactRow, go, note);
      if (wal < min) { go.disabled = true; range.disabled = true; note.textContent = 'Ta banque est trop basse (' + fmtE(wal) + '). Récupère ton bonus du jour ou passe par la banque du temps sur l\'accueil.'; }
      show(val);
    }
    panel.appendChild(mk('p', 'cm-learn-tip', '💰 Partie réelle, sans aides : gains, XP, défis et succès comptent.' + (opts.realNote ? ' ' + opts.realNote : '') + ' Pour apprendre sans risque, active 🎓 Apprentissage sur l\'accueil.'));
    card.appendChild(panel);
    box.append(card);
  }

  // Classement de fin de partie (utilisé par le blackjack entre amis)
  function showRanking(o) {
    injectStyle();
    const old = document.querySelector('.casino-rank'); if (old) old.remove();
    const ov = document.createElement('div'); ov.className = 'casino-rank';
    const box = document.createElement('div'); box.className = 'cr-box';
    const t = document.createElement('div'); t.className = 'cr-title'; t.textContent = o.title;
    const sub = document.createElement('div'); sub.className = 'cr-sub'; sub.textContent = o.subtitle || '';
    const ol = document.createElement('ol'); ol.className = 'cr-list';
    o.rows.forEach((r, i) => {
      const li = document.createElement('li'); if (r.me) li.className = 'me';
      const n = document.createElement('span'); n.textContent = ['🥇', '🥈', '🥉'][i] ? ['🥇', '🥈', '🥉'][i] + ' ' + r.name : (i + 1) + '. ' + r.name;
      const v = document.createElement('b'); v.textContent = r.value;
      const pz = Casino.prizeFor(i + 1, o.rows.length);
      li.append(n, v);
      if (pz) { const z = document.createElement('small'); z.textContent = '+' + pz + ' € banque'; li.appendChild(z); }
      ol.appendChild(li);
    });
    const row = document.createElement('div'); row.className = 'cr-btns';
    if (o.againLabel && o.onAgain) { const a = document.createElement('button'); a.type = 'button'; a.className = 'cm-btn gold'; a.textContent = o.againLabel; a.onclick = () => { ov.remove(); o.onAgain(); }; row.appendChild(a); }
    const c = document.createElement('button'); c.type = 'button'; c.className = 'cm-btn'; c.textContent = 'Fermer'; c.onclick = () => ov.remove(); row.appendChild(c);
    box.append(t, sub, ol, row);
    ov.appendChild(box);
    document.body.appendChild(ov);
  }



  // ---------- API ----------
  const Casino = {
    AVATARS, FELTS, BACKS, CHALLENGES, ACHIEVEMENTS, TIME_PACKS, GAMES: R.GAMES, need, levelOf, title,
    server: SERVER,
    bank: BANK,
    call, sync, firebase,
    get profile() { return load(); },
    onChange(f) { listeners.push(f); },
    wallet() { return load().wallet; },
    // Mode sans serveur uniquement (les jeux ne touchent jamais la banque directement avec le serveur)
    setWallet(v) { if (SERVER) return; if (BANK) return Casino.addWallet(v - load().wallet); local((N) => { P.wallet = Math.max(0, Math.round(v * 100) / 100); R.checkWallet(P, N); }); },
    addWallet(v) {
      if (SERVER) return;
      if (BANK) return bankOp(v < 0 ? 'spend' : 'gain', v, () => ({ x: v > 0 ? v : 0 }), () => { P.wallet += v; });
      Casino.setWallet(load().wallet + v);
    },
    setPseudo(name) {
      load(); P.pseudo = String(name || '').trim().slice(0, 16);
      try { localStorage.setItem('bj-pseudo', P.pseudo); } catch (e) { /* ignore */ }
      save();
      if (SERVER) call('profile.set', { pseudo: P.pseudo });
    },
    setAvatar(a) { load(); if (AVATARS.includes(a) || R.canUse(P, 'avatar', a)) { P.avatar = a; save(); if (SERVER) call('profile.set', { avatar: a }); } },
    /** Parrainage : lie ce compte (nouveau joueur) au code ami de son parrain. */
    async refLink(code) { if (!SERVER) return { error: 'Le parrainage a besoin du serveur du Casino.' }; return call('ref.link', { code }); },
    REF_BONUS: R.REF_BONUS, REF_MIN_HANDS: R.REF_MIN_HANDS, REF_MAX: R.REF_MAX,
    setFriendCode(code) { if (SERVER) call('profile.set', { code }); },
    setSetting(k, v) { load(); P.settings[k] = v; save(); },
    save() { load(); save(); },
    bonusInfo() {
      const b = R.bonusInfo(load(), Date.now());
      if (BANK && b.available && P.bonusAt && Date.now() - P.bonusAt < BONUS_GAP) return { available: false, streak: P.bonus.streak, wait: BONUS_GAP - (Date.now() - P.bonusAt) };
      return b;
    },
    async claimBonus() {
      if (SERVER) { const r = await call('bonus.claim'); return r.amount || 0; }
      if (BANK) {
        const b = Casino.bonusInfo();
        if (!b.available) return 0;
        const r = await bankOp('bonus', b.amount, (o) => { o.bonus = { '.sv': 'timestamp' }; }, (N) => R.claimBonus(P, Date.now(), N));
        return r.ok ? b.amount : 0;
      }
      return local((N) => R.claimBonus(P, Date.now(), N));
    },
    daily() { load(); if (!SERVER) R.ensureDaily(P, Date.now()); return P.daily || { list: [] }; },
    async claimChallenge(id) {
      if (SERVER) { const r = await call('challenge.claim', { id }); return r.amount || 0; }
      if (BANK) {
        const c = (Casino.daily().list || []).find((x) => x.id === id);
        const def = CHALLENGES.find((x) => x.id === id);
        if (!c || !c.done || c.claimed || !def) return 0;
        const r = await bankOp('gain', R.challengeReward(def, load()), () => ({ x: R.challengeReward(def, load()) }), (N) => R.claimChallenge(P, id, Date.now(), N));
        return r.ok ? R.challengeReward(def, load()) : 0;
      }
      return local((N) => R.claimChallenge(P, id, Date.now(), N));
    },
    // ---------- Boutique et cosmétiques ----------
    SHOP: R.SHOP, SHOP_LABELS: R.SHOP_LABELS, unlocksAt: R.unlocksAt, itemOf: R.itemOf,
    weekOf: R.weekOf,
    /** Tournoi de poker de la semaine : points selon la place d'une partie de poker entre amis. */
    pokerWeekAdd(place, players) {
      if (SERVER || !(players >= 2)) return 0;
      load();
      const w = R.ensureWeek(P, Date.now()), pts = R.weekPoints(place);
      w.pts += pts; w.games++;
      save();
      return pts;
    },
    pokerWeek() { load(); return R.ensureWeek(P, Date.now()); },
    /** Fin de semaine : le 1er des amis (points de la semaine passée) reçoit le titre exclusif, une seule fois. */
    checkWeek(rows) {
      load(); R.ensureWeek(P, Date.now());
      const prev = P.pokerWeekPrev;
      if (!prev || !prev.pts || (P.weekAwarded || {})[prev.id]) return false;
      if (R.weekOf(Date.now()) === prev.id) return false;
      const others = (rows || []).filter((r) => !r.me).map((r) => (r.pokerWeek && r.pokerWeek.id === prev.id ? r.pokerWeek.pts : r.pokerWeekPrev && r.pokerWeekPrev.id === prev.id ? r.pokerWeekPrev.pts : 0));
      P.weekAwarded = Object.assign({}, P.weekAwarded, { [prev.id]: true });
      if (prev.pts >= Math.max(0, ...others) && others.some((x) => x > 0)) {
        P.owned = P.owned || {}; P.owned['title:roi_semaine'] = Date.now();
        local((N) => R.unlock(P, 'week_king', N));
        toast('Roi du poker de la semaine !', 'Tu termines 1er avec ' + prev.pts + ' points : titre exclusif débloqué.', '♚', 'gold');
        return true;
      }
      save();
      return false;
    },
    SEASON_TIERS: R.SEASON_TIERS, seasonOf: R.seasonOf, seasonTier: R.seasonTier, seasonName: R.seasonName,
    canUse(kind, id) { return R.canUse(load(), kind, id); },
    owns(kind, id) { const it = R.itemOf(kind, id); return !!it && (!it.price || !!(load().owned || {})[kind + ':' + id]); },
    equipped(kind) { load(); P.equipped = Object.assign({}, R.DEFAULT_EQUIP, P.equipped); const id = P.equipped[kind]; return R.canUse(P, kind, id) ? id : R.DEFAULT_EQUIP[kind]; },
    equip(kind, id) {
      load();
      if (kind === 'avatar') { Casino.setAvatar(id); return true; }
      if (!R.canUse(P, kind, id)) return false;
      P.equipped = Object.assign({}, R.DEFAULT_EQUIP, P.equipped, { [kind]: id });
      save();
      applyCosmetics();
      return true;
    },
    /** Achat à la boutique, payé avec la banque. { ok, price } ou { error } */
    async buy(kind, id) {
      load();
      const it = R.itemOf(kind, id);
      if (!it) return { error: 'Objet introuvable.' };
      if (SERVER) { const r = await call('shop.buy', { kind, id }); return r.error ? r : { ok: true, price: it.price }; }
      const chk = R.buyItem(JSON.parse(JSON.stringify(P)), kind, id, []);
      if (chk.error) return chk;
      if (BANK) { const r = await bankOp('spend', -it.price, null, (N) => R.buyItem(P, kind, id, N)); return r.error ? r : { ok: true, price: it.price }; }
      const r = local((N) => R.buyItem(P, kind, id, N));
      return r.error ? r : { ok: true, price: it.price };
    },
    // ---------- Parties réelles ----------
    training: false,
    // Mode Apprentissage choisi sur l'accueil : tous les jeux en crédit illimité avec les aides
    get learn() { try { return localStorage.getItem('casino-learn') === '1'; } catch (e) { return false; } },
    setLearn(on) { try { localStorage.setItem('casino-learn', on ? '1' : '0'); } catch (e) { /* ignore */ } listeners.forEach((f) => { try { f(load()); } catch (e) { /* ignore */ } }); },
    TRAIN_BANK: 1000,
    session(game) { return load().sessions[game] || null; },
    sessions() { return Object.assign({}, load().sessions); },
    /** Commence (ou reprend) une partie réelle : { session, resumed, … } ou { error } */
    async startSession(game, amount) {
      if (SERVER) { const r = await call('session.start', { game, amount }); return r; }
      load();
      if (P.sessions[game]) return { session: P.sessions[game], resumed: true };
      if (BANK) {
        amount = Math.floor(amount);
        if (!(amount > 0) || amount > P.wallet) return { error: 'Ta banque ne contient pas assez d\'argent.' };
        const r = await bankOp('start', -amount, (o) => { o.g = game; o.ses = Object.assign({}, o.ses, { [game]: amount }); }, () => R.startSession(P, game, amount, Date.now()));
        return r.error ? r : { session: P.sessions[game] };
      }
      const s = local(() => R.startSession(P, game, amount, Date.now()));
      return s ? { session: s } : { error: 'Ta banque ne contient pas assez d\'argent.' };
    },
    // Sans serveur : la somme sur la table est enregistrée par le jeu
    setStack(game, v) {
      if (SERVER) return;
      load();
      const ss = P.sessions[game];
      if (!ss) return;
      ss.stack = Math.max(0, Math.round(v * 100) / 100);
      save();
    },
    /** Encaisse : la somme sur la table revient à la banque. { start, end, diff } ou { error } */
    async cashOut(game, extra) {
      if (SERVER) { const r = await call('session.cashout', { game }); return r.error ? r : r.cash; }
      if (BANK) {
        const ss0 = load().sessions[game];
        if (!ss0) return { error: 'Aucune partie en cours.' };
        const ss = Object.assign({}, ss0);
        const r = await bankOp('cash', ss.stack, (o, cur) => {
          const stake = cur.ses && cur.ses[game];
          if (stake == null) return false;
          o.g = game;
          o.ses = Object.assign({}, o.ses); delete o.ses[game];
          const x = (o.wallet - cur.wallet) - stake;
          return { x: x > 0 ? x : 0 };
        }, (N) => {
          P.sessions[game] = ss; // la banque en ligne a pu déjà retirer la partie : on la remet le temps du calcul
          const c = R.cashOut(P, game, N);
          if (c && extra && extra.track) R.track(P, extra.track.type, extra.track.data, Date.now(), N);
          return c;
        });
        return r.error ? r : { start: ss.start, end: ss.stack, diff: Math.round((ss.stack - ss.start) * 100) / 100 };
      }
      return local((N) => {
        const ss = P.sessions[game];
        const r = R.cashOut(P, game, N);
        if (r && extra && extra.track) R.track(P, extra.track.type, extra.track.data, Date.now(), N);
        return r;
      });
    },
    modePicker,
    shareWin,
    winCard,
    gameHero,
    styleLobby,
    launchFx,
    // ---------- Entre amis ----------
    prizeFor: R.prizeFor,
    prizeText: R.prizeText,
    /** Prix de fin de partie (une seule fois) ; avec le serveur, il vérifie la table lui-même. */
    async multiPrize(key, place, players, info) {
      if (SERVER) {
        const r = await call('multi.prize', info || {});
        if (r.amount > 0) setTimeout(() => bigWin(r.amount, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !'), 2200);
        return r.amount || 0;
      }
      if (BANK) {
        if (load().prizes[key]) return 0;
        const amt = R.prizeFor(place, players);
        if (!amt) { local((N) => R.applyPrize(P, key, place, players, Date.now(), N)); return 0; }
        const r = await bankOp('gain', amt, () => ({ x: amt }), (N) => R.applyPrize(P, key, place, players, Date.now(), N));
        if (r.ok) setTimeout(() => bigWin(amt, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !'), 2200);
        return r.ok ? amt : 0;
      }
      const v = local((N) => R.applyPrize(P, key, place, players, Date.now(), N));
      if (v > 0) setTimeout(() => bigWin(v, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !'), 2200);
      return v;
    },
    showRanking,
    // ---------- Banque du temps ----------
    // ---------- Coffre (se remplit tout seul) et aide de secours ----------
    chest() { return R.chestInfo(load(), Date.now()); },
    async claimChest() {
      if (SERVER) { const r = await call('chest.claim'); if (r.amount) vibrate([30, 30, 60]); return r.amount || 0; }
      if (BANK) {
        const c = R.chestInfo(load(), Date.now()); if (c.amount < 1) return 0;
        const r = await bankOp('gain', c.amount, () => ({ x: c.amount }), (N) => { const v = R.claimChest(P, Date.now(), N); P.wallet -= v; });
        return r.ok ? c.amount : 0;
      }
      return local((N) => R.claimChest(P, Date.now(), N));
    },
    rescue() { return R.rescueInfo(load(), Date.now()); },
    async claimRescue() {
      if (SERVER) { const r = await call('rescue.claim'); return r.amount || 0; }
      if (BANK) {
        if (!R.rescueInfo(load(), Date.now()).available) return 0;
        const r = await bankOp('gain', R.RESCUE_AMOUNT, () => ({ x: R.RESCUE_AMOUNT }), () => { const v = R.claimRescue(P, Date.now()); P.wallet -= v; });
        return r.ok ? R.RESCUE_AMOUNT : 0;
      }
      return local(() => R.claimRescue(P, Date.now()));
    },
    // ---------- Salons VIP : mise maximale selon le niveau ----------
    vip() { return R.vipOf(load()); },
    VIP: R.VIP,
    /** Mise maximale par coup : salon VIP en partie réelle, tout est permis en apprentissage. */
    maxBet() { return Casino.training ? 500 : R.maxBet(load()); },
    dailyOffer() { return R.dailyOffer(Date.now()); },
    challengeReward(def) { return R.challengeReward(def, load()); },
    // ---------- Progression (mode sans serveur ; avec le serveur, c'est lui qui compte) ----------
    track(type, d) {
      if (Casino.training || SERVER) return;
      local((N) => R.track(P, type, d, Date.now(), N));
    },
    // ---------- Compte (account.js) : seuls les réglages de l'appareil sont sauvegardés avec le serveur ----------
    exportSave() { load(); return JSON.parse(JSON.stringify(SERVER ? pick(P, LOCAL_KEYS.concat(['pseudo', 'avatar'])) : P)); },
    importSave(data) {
      if (!data || typeof data !== 'object') return;
      load();
      P = SERVER ? Object.assign(P, pick(data, LOCAL_KEYS)) : Object.assign(localDefaults(), R.normalize(data, Date.now()), pick(data, LOCAL_KEYS));
      try { if (P.pseudo) localStorage.setItem('bj-pseudo', P.pseudo); } catch (e) { /* ignore */ }
      save(true);
      applyCosmetics();
      if (SERVER) sync();
      if (BANK && bank) reconcile();
    },
    resetLocal() { P = Object.assign(localDefaults(), R.normalize(null, Date.now())); P.pseudo = ''; save(); if (SERVER) sync(); },
    unlock(id) { if (!SERVER) local((N) => R.unlock(P, id, N)); },
    toast, bigWin, vibrate, applyCosmetics,
  };

  // Couleurs du tapis et du dos des cartes choisies par le joueur
  function applyCosmetics() {
    load();
    const f = R.itemOf('felt', Casino.equipped('felt')) || FELTS[0];
    const b = R.itemOf('back', Casino.equipped('back')) || BACKS[0];
    const r = document.documentElement.style;
    r.setProperty('--felt', f.a); r.setProperty('--felt-dark', f.b);
    r.setProperty('--back1', b.a); r.setProperty('--back2', b.b);
    // thème de l'app et apparence des jetons (choisis à la boutique)
    const th = R.itemOf('theme', Casino.equipped('theme')) || R.SHOP.theme[0];
    const ch = R.itemOf('chips', Casino.equipped('chips')) || R.SHOP.chips[0];
    let st = document.getElementById('casino-skin');
    if (!st) { st = document.createElement('style'); st.id = 'casino-skin'; (document.head || document.documentElement).appendChild(st); }
    let css = '';
    if (th.id !== 'classique') css += ':root{--bg:' + th.bg + ';--panel:' + th.panel + ';--panel-border:' + th.border + ';--border:' + th.border + ';--gold:' + th.accent + '}body:not(.crash-page){background-color:' + th.bg + '}';
    if (ch.filter && ch.filter !== 'none') css += '.chip,.chip-on,.mini-chip,.spot-chip,#quick button,.round{filter:' + ch.filter + '}' + (ch.anim ? '@keyframes chipHue{to{filter:hue-rotate(360deg) saturate(2.5)}}.chip,.chip-on,.spot-chip{animation:chipHue 6s linear infinite}' : '');
    st.textContent = css;
  }
  let styled = false;
  function injectStyle() {
    if (styled) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = `
#casino-toasts { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); z-index: 100; display: flex; flex-direction: column; gap: .5rem; width: min(420px, calc(100vw - 24px)); pointer-events: none; }
.casino-toast { display: flex; gap: .7rem; align-items: center; background: #1a2129; color: #e8ecef; border: 2px solid #f2c14e; border-radius: 14px; padding: .6rem .8rem; box-shadow: 0 10px 30px rgba(0,0,0,.55); animation: ct-in .45s cubic-bezier(.2,.9,.3,1.3) both; font: 14px system-ui, sans-serif; }
.casino-toast.out { animation: ct-out .5s ease-in forwards; }
.casino-toast .ct-icon { font-size: 1.8rem; }
.casino-toast b { color: #f2c14e; display: block; }
.casino-toast.level { border-color: #4fc3f7; } .casino-toast.level b { color: #4fc3f7; }
.casino-toast.challenge { border-color: #3fb950; } .casino-toast.challenge b { color: #3fb950; }
@keyframes ct-in { from { transform: translateY(-30px) scale(.8); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes ct-out { to { transform: translateY(-20px); opacity: 0; } }
.casino-bigwin { position: fixed; inset: 0; z-index: 99; display: grid; place-items: center; background: radial-gradient(circle, rgba(60,40,0,.75), rgba(0,0,0,.85)); overflow: hidden; animation: cb-in .3s ease-out both; cursor: pointer; }
.casino-bigwin.out { animation: cb-out .6s ease-in forwards; }
.cb-box { text-align: center; animation: cb-zoom .7s cubic-bezier(.2,.9,.3,1.5) both; }
.cb-title { font: 900 clamp(2.2rem, 9vw, 4.5rem) system-ui, sans-serif; color: #f2c14e; text-shadow: 0 0 30px rgba(242,193,78,.8), 0 4px 0 #8a6a1c; letter-spacing: .04em; animation: cb-pulse .8s ease-in-out infinite; }
.cb-amount { font: 800 clamp(1.8rem, 7vw, 3.4rem) system-ui, sans-serif; color: #fff; font-variant-numeric: tabular-nums; margin-top: .3rem; }
.cb-coin { position: absolute; top: -40px; font-size: 1.8rem; animation-name: cb-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
@keyframes cb-in { from { opacity: 0; } } @keyframes cb-out { to { opacity: 0; } }
@keyframes cb-zoom { from { transform: scale(0) rotate(-8deg); } to { transform: none; } }
@keyframes cb-pulse { 50% { transform: scale(1.06); } }
@keyframes cb-fall { to { transform: translateY(110vh) rotate(540deg); } }
@media (prefers-reduced-motion: reduce) { .cb-coin { display: none; } .cb-title { animation: none; } }
.cm-learn-tip { font-size: .8rem !important; opacity: .7 !important; margin-top: .3rem !important; }
.cm-picker { display: grid; grid-template-columns: minmax(0, 520px); justify-content: center; gap: .8rem; margin: .8rem 0; }
.cm-card { background: rgba(0,0,0,.25); border: 2px solid #3a4652; border-radius: 14px; padding: .9rem 1rem; display: flex; flex-direction: column; gap: .5rem; }
.cm-card p { margin: 0; font-size: .9rem; line-height: 1.45; opacity: .9; }
.cm-real { border-color: #f2c14e; }
.cm-title { font-weight: 800; font-size: 1.15rem; }
.cm-btn { font: inherit; font-weight: 700; border-radius: 10px; padding: .6rem 1rem; border: 0; cursor: pointer; background: #4fc3f7; color: #06202c; margin-top: auto; }
.cm-btn.gold { background: #f2c14e; color: #2a1d00; }
.cm-btn:disabled { opacity: .5; cursor: not-allowed; }
.cm-amount { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-wrap: wrap; }
.cm-amount input { width: 7.5em; font: inherit; padding: .35rem .5rem; border-radius: 8px; border: 1px solid #556; background: #0d1117; color: #fff; }
.cm-bank { font-size: .85rem; opacity: .8; }
.cm-quick { display: flex; gap: .35rem; flex-wrap: wrap; }
.cm-q { font: inherit; font-size: .82rem; padding: .25rem .55rem; border-radius: 999px; border: 1px solid #f2c14e; background: transparent; color: #f2c14e; cursor: pointer; }
.cm-note { color: #ffb4a8; font-size: .85rem; min-height: 0; }
.cm-badge { display: inline-block; font-size: .75rem; font-weight: 700; padding: .15rem .55rem; border-radius: 999px; background: #4fc3f7; color: #06202c; vertical-align: middle; }
.casino-rank { position: fixed; inset: 0; z-index: 98; display: grid; place-items: center; background: rgba(0,0,0,.75); padding: 16px; }
.cr-box { background: #1a2129; color: #e8ecef; border: 2px solid #f2c14e; border-radius: 18px; padding: 1.2rem 1.3rem; width: min(440px, 100%); font: 15px system-ui, sans-serif; animation: cb-zoom .5s cubic-bezier(.2,.9,.3,1.3) both; }
.cr-title { font-size: 1.5rem; font-weight: 900; color: #f2c14e; text-align: center; }
.cr-sub { text-align: center; opacity: .85; margin: .3rem 0 .8rem; }
.cr-list { list-style: none; padding: 0; margin: 0 0 1rem; display: flex; flex-direction: column; gap: .35rem; }
.cr-list li { display: grid; grid-template-columns: 1fr auto; gap: .1rem .6rem; background: #141a21; border-radius: 10px; padding: .45rem .7rem; }
.cr-list li.me { outline: 2px solid #4fc3f7; }
.cr-list small { grid-column: 1 / -1; color: #3fb950; font-weight: 700; }
.cr-btns { display: flex; gap: .5rem; justify-content: center; }
.cm-badge.real { background: #f2c14e; color: #2a1d00; }
.cb-share { pointer-events: auto; margin-top: 1rem; font: 800 1rem system-ui, sans-serif; border: 0; border-radius: 999px; padding: .7rem 1.3rem; cursor: pointer; color: #1a1200; background: linear-gradient(90deg, #f2c14e, #f472b6); box-shadow: 0 8px 24px rgba(0,0,0,.4); animation: cb-zoom .5s .8s cubic-bezier(.2,.9,.3,1.3) both; }
.cb-share:disabled { opacity: .7; }
/* ---------- Écran de lancement ---------- */
.cm-host { position: relative; display: flex; flex-direction: column; gap: .8rem; }
.cm-host > .setup-grid { order: 3; width: 100%; max-width: 920px; margin: 0 auto; background: rgba(0,0,0,.2); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: .7rem .9rem; }
.cm-solo-hero { grid-template-columns: minmax(0, 1fr) !important; margin-bottom: .8rem; width: 100%; }
.cm-solo-hero .cm-hero { padding: 1.1rem 1rem 1rem; }
.cm-solo-hero .cm-art { width: 110px; height: 110px; } .cm-solo-hero .cm-icon { font-size: 56px; }
.cm-host > h2, .cm-host > p.muted, .cm-host > p:not([class]) { display: none; }
.cm-host.setup, .cm-host.panel, .cm-host.glass { background: transparent; border: 0; box-shadow: none; padding: 0; max-width: none; backdrop-filter: none; }
.cm-picker { display: block; margin: 0; }
.cm-launcher { --cm-a: #f2c14e; --cm-b: #4fc3f7; position: relative; overflow: hidden; border-radius: 24px; background: var(--cm-bg, #10151c); border: 1px solid color-mix(in srgb, var(--cm-a) 45%, transparent);
  box-shadow: 0 24px 60px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.03) inset; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); color: #f3f4f6; font-family: inherit; animation: cm-in .6s cubic-bezier(.2,.9,.3,1.15) both; max-width: 920px; margin: 0 auto; }
@media (max-width: 760px) { .cm-launcher { grid-template-columns: minmax(0, 1fr); } }
.cm-launcher::before { content: ''; position: absolute; inset: -40%; background: conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--cm-a) 18%, transparent), transparent 30%, color-mix(in srgb, var(--cm-b) 14%, transparent), transparent 60%); animation: cm-spin 14s linear infinite; pointer-events: none; }
.cm-hero { position: relative; padding: 1.6rem 1.4rem 1.4rem; display: flex; flex-direction: column; align-items: center; text-align: center; gap: .55rem; }
.cm-art { position: relative; width: 150px; height: 150px; display: grid; place-items: center; margin-bottom: .3rem; }
.cm-icon { font-size: 76px; line-height: 1; filter: drop-shadow(0 10px 24px color-mix(in srgb, var(--cm-a) 60%, transparent)); animation: cm-float 3.2s ease-in-out infinite; z-index: 1; }
.cm-ring { position: absolute; inset: 8px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--cm-a) 60%, transparent); box-shadow: 0 0 30px color-mix(in srgb, var(--cm-a) 40%, transparent), inset 0 0 30px color-mix(in srgb, var(--cm-b) 25%, transparent); animation: cm-pulse 2.6s ease-in-out infinite; }
.cm-deco { position: absolute; font-size: 22px; opacity: .8; color: var(--cm-b); animation: cm-orbit 7s linear infinite; }
.cm-deco.d0 { top: 0; left: 8px; } .cm-deco.d1 { top: 6px; right: 0; animation-delay: -1.7s; color: var(--cm-a); } .cm-deco.d2 { bottom: 2px; left: 0; animation-delay: -3.4s; } .cm-deco.d3 { bottom: 8px; right: 6px; animation-delay: -5.1s; color: var(--cm-a); }
.cm-name { font-size: clamp(1.6rem, 4vw, 2.1rem); font-weight: 900; letter-spacing: -.01em; background: linear-gradient(90deg, var(--cm-a), var(--cm-b)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cm-tag { color: rgba(243,244,246,.82); max-width: 30ch; line-height: 1.4; }
.cm-pills { display: flex; flex-wrap: wrap; gap: .35rem; justify-content: center; margin-top: .3rem; }
.cm-pills span { font-size: .75rem; font-weight: 700; padding: .25rem .65rem; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
.cm-panel { position: relative; margin: .8rem; padding: 1.2rem 1.2rem 1rem; border-radius: 18px; background: rgba(5,8,16,.55); border: 1px solid rgba(255,255,255,.08); backdrop-filter: blur(8px); display: flex; flex-direction: column; gap: .7rem; }
.cm-label { font-size: .78rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: rgba(243,244,246,.7); }
.cm-big { font-size: clamp(2.4rem, 7vw, 3.2rem); font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 0 26px color-mix(in srgb, var(--cm-a) 55%, transparent); }
.cm-big.bump { animation: cm-bump .35s cubic-bezier(.2,.9,.3,1.4); }
.cm-eur { font-size: .5em; opacity: .75; }
.cm-sub { font-size: .85rem; color: rgba(243,244,246,.72); font-variant-numeric: tabular-nums; white-space: pre-wrap; }
.cm-range { -webkit-appearance: none; appearance: none; width: 100%; height: 10px; border-radius: 999px; outline: none; cursor: pointer;
  background: linear-gradient(90deg, var(--cm-a), var(--cm-b)) 0 / var(--p, 50%) 100% no-repeat, rgba(255,255,255,.1); }
.cm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px; border-radius: 50%; background: #fff; border: 4px solid var(--cm-a); box-shadow: 0 0 16px color-mix(in srgb, var(--cm-a) 70%, transparent); }
.cm-range::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 4px solid var(--cm-a); }
.cm-chips { display: flex; gap: .5rem; flex-wrap: wrap; }
.cm-chip { --c: #c62828; --d: #7f1d1d; position: relative; width: 56px; height: 56px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; display: grid; place-items: center; color: #fff; font: inherit; font-weight: 900;
  background: radial-gradient(circle, transparent 0 63%, var(--c) 64%), repeating-conic-gradient(from -11deg, #f8fafc 0 22deg, var(--c) 22deg 60deg);
  box-shadow: 0 3px 0 var(--d), 0 6px 12px rgba(0,0,0,.45), inset 0 0 0 2px rgba(0,0,0,.15); transition: transform .18s cubic-bezier(.2,.9,.3,1.4), box-shadow .18s; }
.cm-chip b { width: 62%; height: 62%; border-radius: 50%; display: grid; place-items: center; font-size: .72rem; letter-spacing: -.02em; line-height: 1;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--c) 70%, #fff), var(--c) 70%); box-shadow: 0 0 0 2px rgba(255,255,255,.85), inset 0 -2px 3px rgba(0,0,0,.25); text-shadow: 0 1px 2px rgba(0,0,0,.45); }
.cm-chip:hover { transform: translateY(-3px); }
.cm-chip.on { transform: translateY(-6px); box-shadow: 0 3px 0 var(--d), 0 10px 18px rgba(0,0,0,.5), 0 0 0 3px #fff, 0 0 24px var(--c); }
.cm-chip.c1 { --c: #1d4ed8; --d: #1e3a8a; } .cm-chip.c2 { --c: #dc2626; --d: #7f1d1d; } .cm-chip.c3 { --c: #15803d; --d: #14532d; } .cm-chip.c4 { --c: #7c3aed; --d: #4c1d95; } .cm-chip.c5 { --c: #b7791f; --d: #78350f; }
@media (max-width: 480px) { .cm-chips { gap: .35rem; justify-content: space-between; } .cm-chip { width: 50px; height: 50px; } .cm-chip b { font-size: .66rem; } .cm-panel { margin: .5rem; padding: 1rem .9rem .9rem; } }
.cm-exact-row { display: flex; align-items: center; justify-content: space-between; gap: .5rem; font-size: .82rem; color: rgba(243,244,246,.7); }
.cm-exact { width: 8em; font: inherit; font-weight: 700; padding: .35rem .55rem; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(0,0,0,.35); color: #fff; }
.cm-cta { position: relative; overflow: hidden; font: inherit; font-size: 1.15rem; font-weight: 900; letter-spacing: .04em; border: 0; border-radius: 16px; padding: 1rem; cursor: pointer; color: #0b0b14;
  background: linear-gradient(135deg, var(--cm-a), var(--cm-b)); box-shadow: 0 10px 30px color-mix(in srgb, var(--cm-a) 45%, transparent); transition: transform .1s, filter .2s; animation: cm-glow 2.4s ease-in-out infinite; }
.cm-cta::after { content: ''; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.55), transparent); transform: skewX(-20deg); animation: cm-shine 2.8s ease-in-out infinite; }
.cm-cta:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); } .cm-cta:active:not(:disabled) { transform: scale(.98); }
.cm-cta:disabled { opacity: .5; cursor: not-allowed; animation: none; }
.cm-wait { text-align: center; opacity: .8; padding: 2rem; }
.cm-panel .cm-learn-tip { font-size: .78rem !important; opacity: .65 !important; margin: 0 !important; line-height: 1.4; }
.cm-panel .cm-note:empty { display: none; }
/* Animation de lancement */
.cm-launch { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .4rem; background: var(--cm-bg, #10151c); color: #fff; animation: cm-fade .25s ease-out both; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.cm-launch.out { animation: cm-out .38s ease-in both; }
.cm-l-icon { font-size: 110px; line-height: 1; animation: cm-zoom .7s cubic-bezier(.2,.9,.3,1.5) both; filter: drop-shadow(0 0 40px var(--cm-a)); }
.cm-l-title { font-size: clamp(1.8rem, 6vw, 2.8rem); font-weight: 900; background: linear-gradient(90deg, var(--cm-a), var(--cm-b)); -webkit-background-clip: text; background-clip: text; color: transparent; animation: cm-up .5s .15s ease-out both; }
.cm-l-sub { opacity: .8; font-weight: 700; animation: cm-up .5s .25s ease-out both; }
.cm-burst { position: absolute; left: 50%; top: 45%; width: 0; height: 0; }
.cm-burst i { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; font-style: normal; font-size: 18px; display: grid; place-items: center;
  background: radial-gradient(circle, var(--cm-a), transparent 70%); animation: cm-fly .9s cubic-bezier(.1,.8,.3,1) both; }
.cm-burst i:nth-child(even) { background: radial-gradient(circle, var(--cm-b), transparent 70%); }
.cm-burst i:not(:empty) { background: none; color: var(--cm-a); }

/* ---------- Écran « Entre amis » ---------- */
.cm-mlobby { --cm-a: #f2c14e; --cm-b: #4fc3f7; position: relative; overflow: hidden; display: grid !important; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 1rem; align-items: start;
  background: var(--cm-bg) !important; border: 1px solid color-mix(in srgb, var(--cm-a) 45%, transparent) !important; border-radius: 24px !important; padding: 0 1rem 1rem !important; max-width: 980px !important; margin: 0 auto;
  box-shadow: 0 24px 60px rgba(0,0,0,.45); color: #f3f4f6; animation: cm-in .6s cubic-bezier(.2,.9,.3,1.15) both; }
.cm-mlobby[hidden] { display: none !important; }
.cm-mlobby::before { content: ''; position: absolute; inset: -40%; background: conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--cm-a) 16%, transparent), transparent 30%, color-mix(in srgb, var(--cm-b) 12%, transparent), transparent 60%); animation: cm-spin 16s linear infinite; pointer-events: none; }
.cm-mlobby > * { position: relative; grid-column: 1; min-width: 0; }
.cm-mlobby > .cm-hero { grid-column: 1 / -1; padding-bottom: .4rem; }
.cm-mlobby > .create-form { grid-column: 2; grid-row: 2 / span 8; }
.cm-mlobby .cm-hide { display: none !important; }
@media (max-width: 760px) { .cm-mlobby { grid-template-columns: minmax(0, 1fr); } .cm-mlobby > .create-form { grid-column: 1; grid-row: auto; } }
.cm-joincard, .cm-mlobby .create-form { background: rgba(5,8,16,.55) !important; border: 1px solid rgba(255,255,255,.09); border-radius: 18px !important; padding: 1rem 1.1rem !important; backdrop-filter: blur(8px); display: flex; flex-direction: column; gap: .7rem; }
.cm-joincard h3, .cm-mlobby .create-form h3 { margin: 0; font-size: .78rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: rgba(243,244,246,.72); }
.cm-joincard .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.cm-joincard label { font-size: .85rem; color: rgba(243,244,246,.8); }
.cm-mlobby input:not([type]), .cm-mlobby input[type="text"], .cm-mlobby select { font: inherit; color: #fff; background: rgba(0,0,0,.35) !important; border: 1px solid rgba(255,255,255,.14) !important; border-radius: 12px !important; padding: .6rem .75rem !important; transition: border-color .15s, box-shadow .15s; min-width: 0; }
.cm-mlobby input:focus, .cm-mlobby select:focus { outline: none; border-color: var(--cm-a) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cm-a) 30%, transparent); }
.cm-joincard form { display: flex; gap: .5rem; }
.cm-joincard form input { flex: 1; font-size: 1.2rem !important; font-weight: 900; letter-spacing: .3em; text-transform: uppercase; text-align: center; }
.cm-joincard form button { border: 0; border-radius: 12px; padding: .6rem 1.1rem; font-weight: 900; color: #0b0b14; background: linear-gradient(135deg, var(--cm-b), var(--cm-a)); cursor: pointer; }
.cm-join-tip { margin: 0; font-size: .78rem; opacity: .6; line-height: 1.4; }
.cm-mlobby .setup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .6rem; }
.cm-mlobby .create-form label { display: flex; flex-direction: column; gap: .3rem; font-size: .82rem; color: rgba(243,244,246,.78); }
.cm-mlobby .create-form label:has(> input[type="checkbox"]) { flex-direction: row; align-items: center; gap: .6rem; cursor: pointer; }
.cm-mlobby input[type="checkbox"] { -webkit-appearance: none; appearance: none; flex: none; width: 40px; height: 22px; border-radius: 999px; background: rgba(255,255,255,.15); position: relative; cursor: pointer; transition: background .2s; margin: 0; }
.cm-mlobby input[type="checkbox"]::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s cubic-bezier(.2,.9,.3,1.4); box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.cm-mlobby input[type="checkbox"]:checked { background: linear-gradient(90deg, var(--cm-a), var(--cm-b)); }
.cm-mlobby input[type="checkbox"]:checked::after { transform: translateX(18px); }
.cm-mlobby .prize-note { margin: 0; font-size: .78rem !important; line-height: 1.45; padding: .55rem .7rem; border-radius: 12px; background: color-mix(in srgb, var(--cm-a) 10%, transparent); border: 1px solid color-mix(in srgb, var(--cm-a) 30%, transparent); color: rgba(243,244,246,.85) !important; }
.cm-mlobby .create-form .cm-cta { margin-top: .2rem; width: 100%; }
.cm-mlobby .create-form label:not(:has(> input[type="checkbox"])) { align-items: stretch; text-align: left; }
.cm-mlobby .create-form select { width: 100%; }
.cm-joincard form input::placeholder { letter-spacing: .2em; font-weight: 700; color: rgba(255,255,255,.35); }
.cm-mlobby .warn { color: #fecaca !important; margin: 0; } .cm-mlobby .warn:empty { display: none; }
.cm-mlobby .table-list { list-style: none; padding: 0; margin: 0; }
@keyframes cm-in { from { opacity: 0; transform: translateY(18px) scale(.97); } }
@keyframes cm-spin { to { transform: rotate(360deg); } }
@keyframes cm-float { 50% { transform: translateY(-10px) rotate(-4deg); } }
@keyframes cm-pulse { 50% { transform: scale(1.06); opacity: .7; } }
@keyframes cm-orbit { 0% { transform: translate(0,0) rotate(0); } 50% { transform: translate(6px,-8px) rotate(20deg); } 100% { transform: translate(0,0) rotate(0); } }
@keyframes cm-bump { 40% { transform: scale(1.12); } }
@keyframes cm-glow { 50% { box-shadow: 0 10px 40px color-mix(in srgb, var(--cm-b) 55%, transparent); } }
@keyframes cm-shine { 0%, 55% { left: -60%; } 100% { left: 130%; } }
@keyframes cm-fade { from { opacity: 0; } }
@keyframes cm-out { to { opacity: 0; transform: scale(1.08); } }
@keyframes cm-zoom { 0% { transform: scale(.2) rotate(-25deg); opacity: 0; } 70% { transform: scale(1.15) rotate(6deg); opacity: 1; } 100% { transform: none; } }
@keyframes cm-up { from { opacity: 0; transform: translateY(14px); } }
@keyframes cm-fly { 0% { transform: translate(0,0) scale(.3); opacity: 1; } 100% { transform: translate(var(--x), var(--y)) scale(1.1); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .cm-launcher, .cm-launcher::before, .cm-icon, .cm-ring, .cm-deco, .cm-cta, .cm-cta::after, .cm-l-icon, .cm-burst i { animation: none !important; } }
`;
    document.head.appendChild(s);
  }

  window.Casino = Casino;
  document.addEventListener('DOMContentLoaded', () => { applyCosmetics(); });
  if (document.readyState !== 'loading') { applyCosmetics(); }
  if (SERVER) sync().catch(() => {}); else { load(); R.ensureDaily(P, Date.now()); }
  if (BANK) bankInit();
})();
