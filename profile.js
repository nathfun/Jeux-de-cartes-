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
  let lastWallet = null, txReason = null;
  const bootAt = Date.now();
  // Page restaurée depuis le cache du navigateur (bouton retour), autre onglet, retour sur l'app :
  // on relit le profil enregistré pour ne jamais réécrire une vieille copie par-dessus (ex. une partie du Parrain en cours)
  function reloadFromStorage() {
    if (!P) return;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (!raw) return;
    let saved = null; try { saved = JSON.parse(raw); } catch (e) { return; }
    if (!saved || (saved.savedAt || 0) <= (P.savedAt || 0) && JSON.stringify(saved.run || null) === JSON.stringify(P.run || null)) return;
    P = null; load();
    listeners.forEach((f) => { try { f(P); } catch (e) { /* ignore */ } });
  }
  if (typeof window !== 'undefined') {
    // page de jeu restaurée par le bouton retour : la main affichée peut être périmée, on recharge pour repartir de l'état du serveur
    window.addEventListener('pageshow', (e) => { if (!e.persisted) return; if (document.querySelector('.cm-host, .run-hud')) location.reload(); else reloadFromStorage(); });
    window.addEventListener('storage', (e) => { if (e.key === KEY) reloadFromStorage(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reloadFromStorage(); });
  }
  let knownStamp = 0;
  function load() {
    if (P) return P;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
    knownStamp = (raw && raw.savedAt) || 0;
    P = Object.assign(localDefaults(), R.normalize(raw, Date.now()), raw ? pick(raw, LOCAL_KEYS) : {});
    if (P._econMigrated) { delete P._econMigrated; setTimeout(() => { try { save(); } catch (e) { /* ignore */ } }, 0); }
    if (!raw || !raw.pseudo) { try { P.pseudo = P.pseudo || localStorage.getItem('bj-pseudo') || ''; } catch (e) { /* ignore */ } }
    if (lastWallet === null) lastWallet = Math.round((P.wallet || 0) * 100) / 100;
    return P;
  }
  function pick(o, keys) { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  const listeners = [];
  const TX_LABEL = { 'shop.buy': 'achat en boutique', 'vip.buy': 'pass VIP', 'box.open': 'coffre mystère' };
  function txBanner(delta, why) {
    injectStyle();
    const c = container(), el = document.createElement('div');
    el.className = 'casino-tx ' + (delta > 0 ? 'plus' : 'minus');
    const amt = Math.abs(delta).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    el.textContent = (delta > 0 ? '+' + amt + ' jetons' : '−' + amt + ' jetons') + (why ? ' · ' + why : '');
    c.insertBefore(el, c.firstChild);
    setTimeout(() => el.classList.add('out'), 3000);
    setTimeout(() => el.remove(), 3500);
  }
  /** Fenêtre de confirmation (achats) : renvoie une promesse vrai / faux. */
  function confirmBox(opts) {
    injectStyle();
    return new Promise((resolve) => {
      const o = document.createElement('div'); o.className = 'casino-confirm';
      const b = document.createElement('div'); b.className = 'ccf-box';
      if (opts.icon) { const i = document.createElement('div'); i.className = 'ccf-icon'; i.textContent = opts.icon; b.appendChild(i); }
      const t = document.createElement('h3'); t.textContent = opts.title || 'Confirmer ?'; b.appendChild(t);
      if (opts.text) { const p = document.createElement('p'); p.textContent = opts.text; b.appendChild(p); }
      if (typeof opts.price === 'number') {
        const w = typeof opts.from === 'number' ? opts.from : load().wallet || 0, u = ' ' + (opts.unit || 'jetons'), row = document.createElement('div'); row.className = 'ccf-bank';
        row.innerHTML = '<span></span><b></b>';
        row.querySelector('span').textContent = opts.fromLabel || 'Tes jetons';
        row.querySelector('b').textContent = Math.round(w).toLocaleString('fr-FR') + u + ' → ' + Math.round(w - opts.price).toLocaleString('fr-FR') + u;
        b.appendChild(row);
      }
      const btns = document.createElement('div'); btns.className = 'ccf-btns';
      const no = document.createElement('button'); no.type = 'button'; no.className = 'ccf-no'; no.textContent = opts.cancel || 'Annuler';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'ccf-ok'; ok.textContent = opts.ok || 'Confirmer';
      btns.append(no, ok); b.appendChild(btns); o.appendChild(b);
      const done = (v) => { o.remove(); resolve(v); };
      no.onclick = () => done(false); ok.onclick = () => done(true);
      o.onclick = (e) => { if (e.target === o) done(false); };
      document.body.appendChild(o); ok.focus();
    });
  }
  // Une autre page a enregistré le profil depuis qu'on l'a lu ? On garde son état de jeu (partie, tables, argent…)
  const GAME_KEYS = ['run', 'sessions', 'wallet', 'xp', 'totals', 'bestPalier', 'lastRun', 'achievements', 'daily', 'bonus', 'vipUntil', 'owned', 'season'];
  function storedProfile() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save(keepStamp) {
    if (!keepStamp) {
      const st = storedProfile();
      if (st && (st.savedAt || 0) > knownStamp) GAME_KEYS.forEach((k) => { if (st[k] !== undefined) P[k] = st[k]; });
      P.savedAt = Math.max(Date.now(), (st && st.savedAt || 0) + 1);
    }
    knownStamp = P.savedAt || 0;
    // historique de la banque : dernière valeur de chaque jour (31 jours)
    if (typeof P.wallet === 'number') {
      P.bankHist = P.bankHist || {};
      P.bankHist[R.today(Date.now())] = Math.round(P.wallet);
      const days = Object.keys(P.bankHist).sort();
      while (days.length > 31) delete P.bankHist[days.shift()];
    }
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* ignore */ }
    try { document.documentElement.classList.toggle("is-vip", R.isVip(P, Date.now())); } catch (e) { /* ignore */ }
    // bandeau de transaction : chaque mouvement de la banque est annoncé en haut de l'écran
    const w = Math.round((P.wallet || 0) * 100) / 100;
    if (lastWallet !== null && txReason && Math.abs(w - lastWallet) >= 0.5 && Date.now() - bootAt > 2500 && typeof document !== 'undefined') { try { txBanner(w - lastWallet, txReason); } catch (e) { /* ignore */ } }
    lastWallet = w; txReason = null;
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
  // Pendant une animation de jeu (roue qui tourne, rouleaux, tirage…), les annonces attendent la fin : pas de spoiler
  let holding = false, held = [], holdTimer = null;
  function showNotes(notes) {
    if (holding) { held = held.concat(notes || []); return; }
    (notes || []).forEach((n) => {
      toast(n.title, n.text, n.icon, n.kind);
      if (n.kind === 'salon' || n.kind === 'vip') celebrate(n);
      if (n.kind === 'level') { vibrate([40, 30, 80]); if (window.Sfx) Sfx.win(); }
      else if (n.kind === 'achievement') { vibrate([30, 30, 30, 30, 90]); if (window.Sfx && Sfx.chime) Sfx.chime(); }
      else if (n.kind === 'challenge') { vibrate([40, 30, 40]); if (window.Sfx && Sfx.chime) Sfx.chime(); }
      else if (n.kind === 'gold' && window.Sfx && Sfx.chime) Sfx.chime();
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
        if (j.maintenance) showMaint(j.error);
        if (!r.ok) return { error: j.error === 'Opération inconnue.' ? 'Le serveur du Casino n\'est pas à jour pour cette fonction : l\'administrateur doit lancer la mise à jour du NAS (sudo sh /volume1/docker/casino/update.sh).' : j.error || 'Erreur du serveur (' + r.status + ').' };
        res = j;
      } else res = (await f.fn({ op, data: data || {} })).data;
      // coffre : seul le prix est annoncé (le contenu reste une surprise jusqu'à l'ouverture)
      txReason = op === 'box.open' ? null : TX_LABEL[op] || null;
      applyServer(res);
      try { runWatch(res.result || {}); } catch (e) { /* ignore */ }
      return res.result || {};
    } catch (e) {
      const msg = e && e.code === 'functions/failed-precondition' ? e.message : (e && e.code === 'functions/unavailable') || /network|internet|fetch/i.test(String(e && e.message)) ? 'Pas de connexion au serveur.' : errText(e);
      return { error: msg };
    }
  }
  // ---------- Maintenance : bandeau en haut de l'écran ----------
  function showMaint(text) {
    if (typeof document === 'undefined') return;
    injectStyle();
    let b = document.getElementById('casino-maint');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'casino-maint'; document.body.appendChild(b); }
    b.textContent = text;
  }
  if (SERVER && API && typeof fetch !== 'undefined') {
    fetch(API + '/api/info').then((r) => r.json()).then((j) => {
      if (j && j.maintenance && j.maintenance.on) showMaint('🛠️ ' + (j.maintenance.msg || 'Le Casino est en maintenance : reviens dans quelques minutes, tes parties sont gardées.'));
      // serveur pas à jour : ses règles (paliers, mises…) diffèrent de celles de l'app
      else if (j && j.rules !== R.RULES_VERSION) { Casino.serverOutdated = true; showMaint('⏳ Mise à jour du serveur en cours : certains jeux peuvent afficher d\'anciennes règles quelques minutes.'); }
    }).catch(() => {});
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
    const st = storedProfile();
    if (st && (st.savedAt || 0) > knownStamp) { P = null; load(); } // une autre page a joué entre-temps : on repart de son état
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
  let leavingPage = false;
  function toast(title, text, icon, kind) {
    if (leavingPage) return; // on quitte la page : pas d'annonce en double
    const c = container();
    // pas de doublon, et 2 annonces au plus à l'écran (les plus anciennes s'effacent)
    const dup = Array.from(c.querySelectorAll('.casino-toast')).find((x) => x.dataset.t === title + '|' + (text || ''));
    if (dup) return;
    const all = c.querySelectorAll('.casino-toast');
    if (all.length >= 2) all[0].remove();
    const el = document.createElement('div');
    el.className = 'casino-toast ' + (kind || '');
    el.dataset.t = title + '|' + (text || '');
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


  // ---------- Carte Légende (album, boosters, marché) ----------
  let cotesCache = null;
  /** Dessine une carte Légende. opts : { size: 'mini' | 'big', locked, count, cote, fact } */
  function cardEl(id, opts) {
    injectStyle();
    opts = opts || {};
    const c = R.COL_BY_ID[id]; const d = document.createElement('div');
    if (!c) return d;
    const cat = R.COL_CATS[c.cat], rar = R.RARITY[c.rarity];
    d.className = 'lg-card r-' + c.rarity + (opts.size === 'big' ? ' big' : '') + (opts.locked ? ' locked' : '');
    d.style.setProperty('--rc', rar.color); d.style.setProperty('--ca', cat.a); d.style.setProperty('--cb', cat.b);
    const top = document.createElement('div'); top.className = 'lg-top';
    const n = document.createElement('span'); n.textContent = '#' + String(c.n).padStart(3, '0');
    const ct = document.createElement('span'); ct.textContent = cat.icon + ' ' + cat.name;
    top.append(n, ct);
    const art = document.createElement('div'); art.className = 'lg-art'; art.textContent = opts.locked ? '?' : c.icon;
    const nm = document.createElement('div'); nm.className = 'lg-name'; nm.textContent = c.name;
    const rr = document.createElement('div'); rr.className = 'lg-rar'; rr.textContent = rar.name;
    d.append(top, art, nm, rr);
    if (opts.fact && !opts.locked) { const f = document.createElement('div'); f.className = 'lg-fact'; f.textContent = c.fact; d.appendChild(f); }
    if (opts.cote) { const v = document.createElement('div'); v.className = 'lg-cote'; v.textContent = 'Cote ' + Math.round(opts.cote).toLocaleString('fr-FR') + ' €'; d.appendChild(v); }
    if (opts.count > 1) { const b = document.createElement('span'); b.className = 'lg-count'; b.textContent = '×' + opts.count; d.appendChild(b); }
    if (c.rarity === 'legendaire' || c.rarity === 'mythique' || c.rarity === 'ultime') { const h = document.createElement('i'); h.className = 'lg-holo'; d.appendChild(h); }
    return d;
  }

  // ---------- Grande annonce : nouveau salon, bienvenue au club VIP ----------
  function celebrate(n) {
    injectStyle();
    const o = document.createElement('div'); o.className = 'casino-celebrate' + (n.kind === 'vip' ? ' vip' : '');
    const box = document.createElement('div'); box.className = 'cc-box';
    const rays = document.createElement('div'); rays.className = 'cc-rays';
    const ic = document.createElement('div'); ic.className = 'cc-icon'; ic.textContent = n.icon || '🥂';
    const t = document.createElement('div'); t.className = 'cc-title'; t.textContent = n.title;
    const p = document.createElement('div'); p.className = 'cc-text'; p.textContent = n.text || '';
    box.append(rays, ic, t, p);
    if (n.max) { const m = document.createElement('div'); m.className = 'cc-max'; m.textContent = 'Mise max : ' + n.max + ' €'; box.appendChild(m); }
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'cc-ok'; ok.textContent = 'Génial !';
    box.appendChild(ok); o.appendChild(box);
    for (let i = 0; i < 26; i++) { const c = document.createElement('i'); c.textContent = ['✨', '🥂', '⭐', '💎', '👑'][i % 5]; c.style.left = (Math.random() * 100) + '%'; c.style.animationDelay = (Math.random() * 1.2) + 's'; o.appendChild(c); }
    const close = () => { o.classList.add('out'); setTimeout(() => o.remove(), 350); };
    o.addEventListener('click', close);
    document.body.appendChild(o);
    vibrate([60, 40, 60, 40, 160]);
    if (window.Sfx) { Sfx.win(); setTimeout(() => Sfx.win(), 400); }
  }

  // Bandeau « Partie réelle » des jeux : on y ajoute le salon et la mise maximale
  function salonPill() {
    const b = document.getElementById('mode-badge');
    if (!b || b.dataset.salonWatch) return;
    b.dataset.salonWatch = '1';
    const put = () => {
      const real = b.classList.contains('real') && !b.hidden;
      let pill = b.querySelector('.salon-pill');
      if (!real) { if (pill) pill.remove(); return; }
      const txt = Casino.salonText();
      if (pill && pill.textContent === txt) return;
      if (!pill) { pill = document.createElement('span'); pill.className = 'salon-pill'; b.appendChild(pill); }
      pill.textContent = txt;
    };
    new MutationObserver(put).observe(b, { attributes: true, childList: true, characterData: true, subtree: true });
    put();
  }
  if (typeof document !== 'undefined') {
    setTimeout(() => { try { if (Casino.pushState() === 'on' && Date.now() - (load().settings.pushAt || 0) > 86400000) Casino.pushEnable(); } catch (e) { /* ignore */ } }, 5000);
    const boot = () => {
      injectStyle(); salonPill();
      try { document.documentElement.classList.toggle('is-vip', R.isVip(load(), Date.now())); } catch (e) { /* ignore */ }
      // VIP : quelques paillettes dorées dans le décor
      if (!document.querySelector('.vip-sparkles') && document.body) {
        const sp = document.createElement('div'); sp.className = 'vip-sparkles'; sp.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 18; i++) { const d = document.createElement('i'); d.style.left = Math.random() * 100 + '%'; d.style.top = Math.random() * 100 + '%'; d.style.animationDelay = (-Math.random() * 5) + 's'; d.style.animationDuration = (3.5 + Math.random() * 3) + 's'; sp.appendChild(d); }
        document.body.prepend(sp);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  }

  function vibrate(pattern) {
    load();
    if (P.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  }

  // Effet « gros gain » : montant qui défile, pièces qui tombent
  // ---------- Partage d'un gros gain (image + lien d'invitation) ----------
  const SITE = (() => { try { const src = (document.currentScript && document.currentScript.src) || ''; return src ? src.replace(/profile\.js(\?.*)?$/, '') : location.href.replace(/[^/]*$/, ''); } catch (e) { return location.href.replace(/[^/]*$/, ''); } })();
  const GAME_ICON = { blackjack: '🂡', poker: '♠', roulette: '🎡', slots: '🎰', crash: '🚀', plinko: '🔮', trader: '📈', mines: '💎', loto: '🎱', gold: '⛏️' };
  function gameHere() { const m = /\/(blackjack|poker|roulette|slots|crash|plinko|trader|mines|loto|gold)\//.exec(location.pathname); return m ? m[1] : null; }
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

  function bigWin(amount, label, unit) {
    unit = unit || ' €';
    injectStyle();
    const o = document.createElement('div');
    o.className = 'casino-bigwin';
    const box = document.createElement('div'); box.className = 'cb-box';
    const t = document.createElement('div'); t.className = 'cb-title'; t.textContent = label || 'GROS GAIN !';
    const v = document.createElement('div'); v.className = 'cb-amount'; v.textContent = '+0' + unit;
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
      v.textContent = '+' + Math.round(amount * (1 - Math.pow(1 - u, 3))).toLocaleString('fr-FR') + unit;
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
    loto: { icon: '🎱', deco: ['🎱', '🍀', '✨', '⭐'], name: 'Loto Express', tag: 'Coche tes numéros… et regarde les boules tomber !', a: '#facc15', b: '#22c55e', bg: 'radial-gradient(ellipse at 50% 0%, #14532d 0%, #052e16 55%, #020a05 100%)', pills: ['1 à 8 numéros sur 30', 'Jusqu\'à ×3 500', '10 boules tirées'] },
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
  const autoSat = {};
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
      const sec0 = box.closest('section'); if (sec0) sec0.style.visibility = 'hidden';
      runHud();
      Casino.startSession(opts.game, P.sessions[opts.game].stack).then((r) => {
        if (sec0) sec0.style.visibility = '';
        if (!r || r.error) { opts.noAutoResume = true; modePicker(box, opts); return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, true, r);
      });
      return;
    }
    box.innerHTML = '';
    box.className = 'cm-picker';
    const card = mk('div', 'cm-launcher'); applyTheme(card, opts.game);
    card.appendChild(gameHero(opts.game));
    const panel = mk('div', 'cm-panel');
    const cur = P.sessions[opts.game];
    // Pas de journée du Parrain en cours, ou jeu pas encore débloqué : retour à l'accueil
    const lockMsg = !R.runActive(P) ? ['Aucune journée en cours', 'Les jeux se jouent pendant une partie du Parrain : lance-la depuis le lobby (ou passe par 🎓 Apprentissage pour t\'entraîner).']
      : !cur && !R.isUnlocked(P, opts.game) ? ['🔒 Se débloque au palier ' + (R.RUN.UNLOCK[opts.game] || '?'), 'Continue de rembourser la dette pour ouvrir ce jeu.'] : null;
    // Le Parrain : en arrivant sur un jeu, on s'assoit tout de suite avec toute la caisse, sans afficher l'écran de lancement
    if (!lockMsg && !cur && !autoSat[opts.game] && R.runTotal(P) >= R.gameMin(P, opts.game)) {
      autoSat[opts.game] = true;
      box.innerHTML = '';
      runHud();
      const sec = box.closest('section'); if (sec) sec.style.visibility = 'hidden';
      Casino.startSession(opts.game, R.runTotal(P), true).then((r) => {
        if (sec) sec.style.visibility = '';
        if (!r || r.error) { modePicker(box, opts); return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, !!r.resumed, r);
      });
      return;
    }
    if (lockMsg && !cur) {
      panel.append(mk('div', 'cm-label', lockMsg[0]), mk('p', 'cm-sub', lockMsg[1]));
      const back = mk('a', 'cm-cta', R.runActive(P) ? '← Retour à la partie' : '← Retour au lobby'); back.href = R.runActive(P) ? '../partie.html' : '../index.html';
      panel.appendChild(back);
      card.appendChild(panel); box.append(card);
      return;
    }
    runHud();
    const min = R.gameMin(P, opts.game);
    const wal = P.run ? P.run.cash : 0;
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
      // Le Parrain : on s'installe toujours avec toute la caisse (l'argent des autres jeux suit)
      const tot = R.runTotal(P);
      const go = mk('button', 'cm-cta', '▶ Jouer avec toute ma caisse'); go.type = 'button';
      const start = async () => {
        go.disabled = true; note.textContent = '';
        const r = await Casino.startSession(opts.game, tot, true);
        go.disabled = false;
        if (!r || r.error) { note.textContent = (r && r.error) || 'Impossible de commencer.'; return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, !!r.resumed, r);
        launchFx(opts.game, 'Bonne chance !', fmtE(r.session.stack) + ' sur la table');
      };
      go.onclick = start;
      panel.append(mk('div', 'cm-label', 'Ta caisse'), mk('div', 'cm-big', fmtE(tot)), mk('div', 'cm-sub', 'Mises de ' + fmtE(min) + ' à ' + fmtE(R.maxBet(P, Date.now())) + ' à ce palier'), go, note);
      const back = mk('a', 'cm-back', '← Retour à la partie'); back.href = '../partie.html'; panel.appendChild(back);
      if (tot < min) { go.disabled = true; note.textContent = 'Ta caisse est trop basse (' + fmtE(tot) + ') pour la mise minimale de ce jeu (' + fmtE(min) + ').'; }
      // en arrivant sur le jeu : on s'assoit directement (pas après « Encaisser et quitter »)
      else if (!autoSat[opts.game]) { autoSat[opts.game] = true; box.append(card); card.appendChild(panel); start(); return; }
    }
    panel.appendChild(mk('p', 'cm-learn-tip', '🕴️ Le Parrain, palier ' + P.run.palier + ' : tu joues avec toute ta caisse, elle te suit d\'un jeu à l\'autre. Plus rien pour miser nulle part = banqueroute.' + (opts.realNote ? ' ' + opts.realNote : '')));
    card.appendChild(panel);
    box.append(card);
  }


  // ---------- Le Parrain : bandeau de la journée sur les pages de jeu ----------
  let hudTimer = null, hudEl = null, endShown = false, hudLast = null;
  const fmtClock = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function runHud() {
    if (typeof document === 'undefined' || !R.runActive(load())) return;
    injectStyle();
    if (!hudEl) {
      hudEl = document.createElement('a'); hudEl.className = 'run-hud'; hudEl.href = '../partie.html'; hudEl.title = 'Retour à la partie';
      document.body.appendChild(hudEl);
      document.body.style.paddingBottom = 'calc(64px + env(safe-area-inset-bottom))';
    }
    const draw = () => {
      const p = load(), r = p.run;
      if (!r || r.status !== 'playing') { hudEl.hidden = true; return; }
      if (holding && hudEl.childElementCount) { const t = hudEl.querySelector('.rh-t'); if (t) t.textContent = '⏱ ' + fmtClock(r.dayEnd - Date.now()); return; }
      hudEl.hidden = false;
      const left = r.dayEnd - Date.now(), tot = R.runTotal(p), pc = Math.min(100, tot / r.quota * 100);
      hudEl.classList.toggle('late', left < 60000);
      hudEl.classList.toggle('ok', tot >= r.quota);
      hudEl.innerHTML = '';
      const a = mk('span', 'rh-p', 'P' + r.palier), b = mk('span', 'rh-t', '⏱ ' + fmtClock(left));
      const c = mk('span', 'rh-q'); const bar = mk('i'); bar.style.width = pc + '%'; c.append(bar, mk('b', '', fmtE(Math.floor(tot)) + ' / ' + fmtE(r.quota)));
      hudEl.append(a, b, c);
      // la caisse bouge : petit éclair vert (gain) ou rouge (perte)
      if (hudLast !== null && Math.abs(tot - hudLast) >= 1) {
        const up = tot > hudLast, d = mk('span', 'rh-delta ' + (up ? 'up' : 'down'), (up ? '+' : '−') + fmtE(Math.round(Math.abs(tot - hudLast))));
        document.body.appendChild(d); setTimeout(() => d.remove(), 1500); hudEl.classList.remove('flash-up', 'flash-down'); void hudEl.offsetWidth; hudEl.classList.add(up ? 'flash-up' : 'flash-down');
        if (up && window.Sfx && Sfx.coins && tot - hudLast >= 1) Sfx.coins();
      }
      hudLast = tot;
      if (left <= 0 && !endShown) { endShown = true; Casino.runTick(); }
    };
    draw();
    clearInterval(hudTimer); hudTimer = setInterval(draw, 500);
    Casino.onChange(draw);
  }
  /** Réponse du serveur : fin de journée, banqueroute, table perdue → écran par-dessus le jeu. */
  function runWatch(res) {
    if (typeof document === 'undefined' || !(hudEl || document.querySelector('.cm-host'))) return;
    if (!res.dayOver) return;
    const over = res.dayOver === 'over';
    const warn = res.dayOver === 'warn';
    const show = () => runOverlay(over ? '🕴️ La mafia est passée…' : warn ? '💢 Avertissement du parrain' : '🔔 La journée est terminée', over ? 'Ta partie est finie. Retourne à la partie pour le bilan.' : warn ? 'Tu perds une vie, mais la partie continue. Retourne à la partie pour la suite.' : 'Le parrain fait les comptes. Retourne à la partie pour la suite.');
    // pendant une animation (roue, bille, cartes…) : l'annonce attend la fin, pour ne pas gâcher le résultat
    if (holding) { pendingOver = show; return; }
    setTimeout(() => { if (holding) pendingOver = show; else show(); }, over ? 4500 : 0);
  }
  let pendingOver = null;
  function runOverlay(title, text) {
    if (document.querySelector('.run-over')) return;
    injectStyle();
    const ov = mk('div', 'run-over'), box = mk('div', 'ro-box');
    const go = mk('a', 'cm-cta', 'Retour à la partie'); go.href = '../partie.html';
    box.append(mk('div', 'ro-title', title), mk('p', '', text), go);
    ov.appendChild(box); document.body.appendChild(ov);
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
    /** Caisse de la partie du Parrain (euros), utilisée par les jeux. */
    wallet() { const p = load(); return Math.round(((p.run && p.run.status !== 'over' ? p.run.cash : 0) || 0) * 100) / 100; },
    /** Jetons du compte (style, VIP, multijoueur). */
    jetons() { return Math.round((load().wallet || 0) * 100) / 100; },
    get run() { return load().run || null; },
    async runCall(op, data) {
      if (SERVER) return call(op, data);
      if (BANK) return { error: 'Le Parrain demande le serveur du Casino.' };
      const now = Date.now();
      return local((N) => {
        const t = R.runTick(P, now, N);
        if (t && op !== 'sync') return { dayOver: t.over ? 'over' : t.warned ? 'warn' : 'shop', run: P.run };
        const r = op === 'run.start' ? R.runStart(P, now, N) : op === 'run.end' ? R.runEndDay(P, now, N, 'closed') : op === 'run.buy' ? R.runBuy(P, data.id)
          : op === 'run.next' ? R.runNext(P, now, N) : op === 'run.abandon' ? R.runOver(P, now, N, 'abandon') : op === 'run.seen' ? ((P.run || {}).seen = true, {}) : {};
        if (r && r.over) r.dayOver = 'over';
        return Object.assign({ run: P.run }, r);
      });
    },
    runTick() { return Casino.runCall('sync').then((r) => { const p = load(); if (p.run && p.run.status !== 'playing') runWatch({ dayOver: p.run.status === 'over' ? 'over' : p.run.status === 'shop' ? 'shop' : 'warn' }); return r; }); },
    runHud,
    // ----- Tables multijoueur en jetons -----
    async mtSit(game, table, amount) {
      if (SERVER) return call('mt.sit', { game, table, amount });
      return local(() => { if (amount > P.wallet) return { error: 'Pas assez de jetons.' }; if (P.mt && P.mt.table !== table) return { error: 'Tu as encore des jetons sur une autre table.' }; P.wallet -= amount; P.mt = P.mt ? Object.assign(P.mt, { amount: P.mt.amount + amount }) : { game, table, amount, at: Date.now() }; return { mt: P.mt }; });
    },
    async mtLeave(chips) {
      if (SERVER) return call('mt.leave', {});
      return local(() => { if (!P.mt) return { payout: 0, none: true }; const brought = P.mt.amount, payout = Math.floor(Math.min(chips == null ? brought : chips, brought * R.MT.CAP)); P.wallet += payout; P.mt = null; return { payout, brought, net: payout - brought }; });
    },
    get mt() { return load().mt || null; },
    // ----- Coffres mystères et prix de la boutique -----
    boxInfo() { return R.boxInfo(load(), Date.now()); },
    async openBox(paid) {
      const price = paid ? R.boxInfo(load(), Date.now()).price : 0;
      const r = SERVER ? await call('box.open', { paid: !!paid }) : await local((N) => { const x = R.openBox(P, !!paid, Date.now(), (n) => Math.floor(Math.random() * n), N); return x; });
      if (r && !r.error && price && typeof document !== 'undefined') { try { txBanner(-price, 'coffre mystère'); } catch (e) { /* ignore */ } }
      return r;
    },
    priceOf(kind, id) { return R.priceOf(load(), kind, id, Date.now()); },
    inPromo(kind, id) { return R.inPromo(kind, id, Date.now()); },
    VIP_DISCOUNT: R.VIP_DISCOUNT, SHOP_PROMO: R.SHOP_PROMO,
    // ----- Poker entre amis : droit d'entrée et cagnotte -----
    async pkBuyIn(table) { if (SERVER) return call('pk.buyin', { table }); return { free: true }; },
    async pkRefund() { if (SERVER) return call('pk.refund', {}); return { refund: 0 }; },
    async pkClaim(table) { if (SERVER) { const r = await call('pk.claim', { table }); if (r && r.amount) Casino.toast('Cagnotte du poker', '+' + r.amount.toLocaleString('fr-FR') + ' jetons', '♠', 'gold'); return r; } return { amount: 0 }; },
    MT: R.MT,
    /** Combien de jetons apporter à la table ? (renvoie le nombre, ou null si on annule) */
    buyInDialog(game) {
      injectStyle();
      const w = Math.floor(load().wallet || 0), min = R.MT.MIN;
      return new Promise((resolve) => {
        const o = document.createElement('div'); o.className = 'casino-confirm';
        const b = document.createElement('div'); b.className = 'ccf-box';
        const ic = document.createElement('div'); ic.className = 'ccf-icon'; ic.textContent = game === 'roulette' ? '🎡' : '🂡'; b.appendChild(ic);
        const t = document.createElement('h3'); t.textContent = 'Combien de jetons apportes-tu ?'; b.appendChild(t);
        const p = document.createElement('p'); p.textContent = w < min ? 'Il te faut au moins ' + min + ' jetons pour t\'asseoir (tu en as ' + w + '). Récupère ton bonus du jour ou tes défis !' : 'Tu en as ' + w.toLocaleString('fr-FR') + '. Tu repars avec ce qu\'il te reste sur la table quand tu la quittes.';
        b.appendChild(p);
        const row = document.createElement('div'); row.className = 'ccf-btns'; row.style.flexWrap = 'wrap';
        const close = (v) => { o.remove(); resolve(v); };
        R.MT.PRESETS.filter((v) => v <= w).concat(w >= min && !R.MT.PRESETS.includes(w) ? [w] : []).forEach((v) => {
          const x = document.createElement('button'); x.type = 'button'; x.className = 'ccf-ok'; x.textContent = (v === w ? 'Tout · ' : '') + v.toLocaleString('fr-FR') + ' 🪙';
          x.onclick = () => close(v); row.appendChild(x);
        });
        const no = document.createElement('button'); no.type = 'button'; no.className = 'ccf-no'; no.textContent = 'Annuler'; no.onclick = () => close(null);
        row.appendChild(no);
        b.appendChild(row); o.appendChild(b); document.body.appendChild(o);
      });
    },
    /** Retient les annonces (et le bandeau du quota) jusqu'à la fin de l'animation en cours. */
    hold() { holding = true; clearTimeout(holdTimer); holdTimer = setTimeout(() => Casino.release(), 20000); },
    release() { clearTimeout(holdTimer); if (!holding) return; holding = false; const n = held; held = []; showNotes(n); listeners.forEach((f) => { try { f(load()); } catch (e) { /* ignore */ } }); if (pendingOver) { const f = pendingOver; pendingOver = null; setTimeout(f, 2500); } },
    get holding() { return holding; },
    /** Ouvre un booster du Parrain (serveur, ou mêmes règles dans le navigateur sans serveur). */
    async openPack(series) {
      if (SERVER) return call('bo.open', { series });
      return local(() => { const ss = P.sessions.boosters; if (!ss) return { error: 'Aucune somme sur la table.' }; return R.openPack(P, ss, series, (n) => Math.floor(Math.random() * n)); });
    },
    SERIES: R.SERIES, packPrice() { return R.packPrice(load()); }, seriesOpen(id) { return R.seriesOpen(load(), id); },
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
    owns(kind, id) { const it = R.itemOf(kind, id); return !!it && ((!it.price && !it.card && !it.exclusive && !it.daily && !it.vipOnly) || !!(load().owned || {})[kind + ':' + id]); },
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
      if (SERVER) { const r = await call('shop.buy', { kind, id }); return r.error ? r : { ok: true, price: r.price }; }
      const chk = R.buyItem(JSON.parse(JSON.stringify(P)), kind, id, []);
      if (chk.error) return chk;
      if (BANK) { const r = await bankOp('spend', -it.price, null, (N) => R.buyItem(P, kind, id, N)); return r.error ? r : { ok: true, price: it.price }; }
      const r = local((N) => R.buyItem(P, kind, id, N));
      return r.error ? r : { ok: true, price: r.price };
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
    async startSession(game, amount, all) {
      if (SERVER) { const r = await call('session.start', { game, amount, all: !!all }); return r; }
      if (all && !BANK && R.runActive(load())) {
        // sans serveur : même règle, l'argent des autres jeux revient dans la caisse puis on prend tout
        local((N) => { Object.keys(P.sessions).filter((g) => g !== game).forEach((g) => R.cashOut(P, g, N)); });
        amount = load().run.cash;
      }
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
      const r = await Casino.cashOutRaw(game, extra);
      // Le Parrain : « Encaisser et quitter » ramène directement à la partie (tous les jeux disponibles)
      if (r && !r.error && load().run && load().run.status !== 'over' && typeof location !== 'undefined' && document.querySelector('.cm-host, .run-hud')) {
        Casino.training = false;
        leavingPage = true;
        document.documentElement.classList.add('cm-leaving');
        setTimeout(() => { location.href = '../partie.html' + (/[?&]backend=local/.test(location.search) ? '?backend=local' : ''); }, 120);
        return Object.assign({}, r, { leaving: true });
      }
      return r;
    },
    async cashOutRaw(game, extra) {
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
        // duels en cours entre joueurs de cette table : réglés tout de suite par le serveur
        if (info && info.table) call('duel.settle', { game: info.game, table: info.table }).then((d) => { if (d.settled && d.settled.length) setTimeout(() => call('deals.list'), 2500); }).catch(() => {});
        if (r.amount > 0) setTimeout(() => bigWin(r.amount, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !', ' jetons'), 2200);
        return r.amount || 0;
      }
      if (BANK) {
        if (load().prizes[key]) return 0;
        const amt = R.prizeFor(place, players);
        if (!amt) { local((N) => R.applyPrize(P, key, place, players, Date.now(), N)); return 0; }
        const r = await bankOp('gain', amt, () => ({ x: amt }), (N) => R.applyPrize(P, key, place, players, Date.now(), N));
        if (r.ok) setTimeout(() => bigWin(amt, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !', ' jetons'), 2200);
        return r.ok ? amt : 0;
      }
      const v = local((N) => R.applyPrize(P, key, place, players, Date.now(), N));
      if (v > 0) setTimeout(() => bigWin(v, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !', ' jetons'), 2200);
      return v;
    },
    showRanking, celebrate, confirm: confirmBox,
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
    // ---------- Salons (selon le niveau) et pass VIP ----------
    vip() { return R.vipOf(load()); },
    VIP: R.VIP, VIP_PASS: R.VIP_PASS, VIP_PERKS: R.VIP_PERKS, WHEEL: R.WHEEL,
    /** Mise maximale par coup : salon (×2 avec le pass VIP) en partie réelle, 500 € en apprentissage. */
    maxBet() { return Casino.training ? 500 : R.maxBet(load(), Date.now()); },
    betFactor() { const p = load(); return Casino.training ? 1 : R.palierFactor(p.run ? p.run.palier : 1) * (R.isVip(p, Date.now()) ? R.RUN.VIP_BET : 1); },
    minBet(game) { return Casino.training ? 1 : R.gameMin(load(), game || 'roulette'); },
    isVip() { return R.isVip(load(), Date.now()); },
    vipUntil() { return R.isVip(load(), Date.now()) ? load().vipUntil : 0; },
    /** Texte court : « 🥈 Salon Argent · max 100 € » (+ couronne si VIP). */
    salonText() { const p = load(), r = p.run; return (R.isVip(p, Date.now()) ? '👑 ' : '') + (r && r.status !== 'over' ? '🕴️ Palier ' + r.palier + ' · ' : '') + 'mises ' + R.gameMin(p, 'blackjack') + ' à ' + R.maxBet(p, Date.now()).toLocaleString('fr-FR') + ' €'; },
    async buyVip(pass) {
      if (SERVER) { const r = await call('vip.buy', { pass }); return r.error ? r : Object.assign({ ok: true }, r); }
      if (BANK) return { error: 'Le pass VIP demande le serveur du Casino.' };
      const r = local((N) => R.buyVip(P, pass, Date.now(), N));
      return r.error ? r : Object.assign({ ok: true }, r);
    },
    // ---------- Notifications push (rappels envoyés par le serveur, même app fermée) ----------
    pushSupported() { return !!(API && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window); },
    pushState() {
      if (!Casino.pushSupported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      return Notification.permission === 'granted' && load().settings.push ? 'on' : 'off';
    },
    pushPrefs() { return Object.assign({ chest: true, bonus: true, friends: true, social: true }, load().settings.pushPrefs || {}); },
    async pushEnable(opts) {
      opts = opts || {};
      if (!Casino.pushSupported()) return { error: 'Les notifications ne sont pas disponibles ici (sur iPhone : ajoute d\'abord l\'app à l\'écran d\'accueil, puis ouvre-la depuis l\'icône).' };
      let perm = Notification.permission;
      if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
      if (perm !== 'granted') return { error: 'Notifications refusées : réautorise-les dans les réglages du navigateur pour ce site.' };
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const k = await (await fetch(API + '/api/push-key')).json();
          const raw = atob(k.key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - k.key.length % 4) % 4));
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
        }
        const prefs = Object.assign(Casino.pushPrefs(), opts.prefs || {});
        const r = await call('push.sub', { sub: sub.toJSON(), prefs, friends: Object.keys(load().friends || {}), test: !!opts.test });
        if (r.error) return r;
        load(); P.settings.push = true; P.settings.pushPrefs = prefs; P.settings.pushAt = Date.now(); save();
        return { ok: true };
      } catch (e) { return { error: 'Impossible d\'activer les notifications : ' + (e && e.message || e) }; }
    },
    async pushDisable() {
      try {
        const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
        if (sub) { await call('push.unsub', { sub: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      } catch (e) { /* ignore */ }
      load(); P.settings.push = false; save();
    },
    // ---------- Entre joueurs : marché, échanges, duels (serveur uniquement) ----------
    async deal(op, data) { if (!SERVER) return { error: 'Le marché, les échanges et les duels demandent le serveur du Casino.' }; return call(op, data || {}); },
    LOTO: R.LOTO, lotoPackCost: R.lotoPackCost,
    tradeable: R.tradeable, MARKET_FEE: R.MARKET_FEE, MARKET_FEE_VIP: R.MARKET_FEE_VIP,
    // ---------- Cartes Légendes ----------
    COLLECTION: R.COLLECTION, COL_CATS: R.COL_CATS, COL_BY_ID: R.COL_BY_ID, COTE_BASE: R.COTE_BASE,
    colCount(id) { return (load().col || {})[id] || 0; },
    countOf(key) { return R.countOf(load(), key); },
    rarityOfKey: R.rarityOfKey, instantPrice: R.instantPrice,
    /** Cotes de toutes les cartes (le serveur les calcule d'après le marché ; sinon la cote de départ). */
    async cotes(force) {
      if (SERVER) { if (!force && cotesCache && Date.now() - cotesCache.at < 120000) return cotesCache.data; const r = await call('col.cotes'); if (!r.error) cotesCache = { at: Date.now(), data: r.cotes }; return (cotesCache && cotesCache.data) || {}; }
      const out = {}; R.COLLECTION.forEach((c) => { const k = 'col:' + c.id; out[k] = { cote: R.COTE_BASE[c.rarity], trend: 0, sales: 0, circ: 0, instant: R.instantPrice(k) }; }); return out;
    },
    async sellInstant(key, n) {
      if (SERVER) { const r = await call('col.sell', { item: key, n: n || 1 }); cotesCache = null; return r; }
      if (BANK) return { error: 'Demande le serveur du Casino.' };
      return local(() => R.instantSell(P, key, null, n || 1));
    },
    cardEl,
    // ---------- Boosters de cartes ----------
    RARITY: R.RARITY, RARITY_ORDER: R.RARITY_ORDER,
    boosters() { return R.boosterInfo(load(), Date.now()); },
    async openBooster(source) {
      if (SERVER) return call('booster.open', { source });
      if (BANK) return { error: 'Les boosters demandent le serveur du Casino.' };
      return local((N) => R.openBooster(P, source, Date.now(), (n) => Math.floor(Math.random() * n), N));
    },
    async craftCard(kind, id) {
      if (SERVER) return call('card.craft', { kind, id });
      if (BANK) return { error: 'Demande le serveur du Casino.' };
      return local(() => R.craftCard(P, kind, id, Date.now()));
    },
    wheel() { return R.wheelInfo(load(), Date.now()); },
    async spinWheel() {
      if (SERVER) return call('wheel.spin');
      if (BANK) return { error: 'La roue demande le serveur du Casino.' };
      const r = local((N) => R.spinWheel(P, Date.now(), (n) => Math.floor(Math.random() * n), N));
      return r || { error: 'Plus de tour de roue aujourd\'hui.' };
    },
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
    const ringCss = (R.SHOP.frame || []).filter((f) => f.ring).map((f) => '.fr-' + f.id + '{border-color:' + f.ring + ' !important;box-shadow:0 0 0 2px ' + f.ring + ',0 0 16px ' + f.glow + ' !important;' + (f.anim === 'hue' ? 'animation:fr-hue 4s linear infinite;' : f.anim === 'pulse' ? 'animation:fr-pulse 1.8s ease-in-out infinite;' : '') + '}').join('');
    s.textContent = ringCss + `
.cm-leaving body > *:not(.run-hud) { visibility: hidden !important; }
/* finitions communes : arrivée en fondu, appui sur les boutons */
@keyframes cm-pagein { from { opacity: 0; transform: translateY(6px); } }
body > main, body > header { animation: cm-pagein .35s ease-out both; }
button:not(:disabled):active, a.cm-cta:active, .game:active { scale: .97; transition: scale .06s; }
.rh-delta { position: fixed; z-index: 71; left: 50%; margin-left: 60px; bottom: calc(52px + env(safe-area-inset-bottom)); font-weight: 900; font-size: .9rem; pointer-events: none; animation: cm-delta 1.4s ease-out forwards; text-shadow: 0 2px 6px rgba(0,0,0,.8); }
.rh-delta.up { color: #4ade80; } .rh-delta.down { color: #f87171; }
@keyframes cm-delta { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-26px); opacity: 0; } }
.run-hud.flash-up { animation: cm-hudup .7s ease-out; } .run-hud.flash-down { animation: cm-huddown .7s ease-out; }
@keyframes cm-hudup { 30% { box-shadow: 0 0 0 3px rgba(74,222,128,.8), 0 0 24px rgba(74,222,128,.6); } }
@keyframes cm-huddown { 30% { box-shadow: 0 0 0 3px rgba(248,113,113,.8), 0 0 24px rgba(248,113,113,.5); } }
@media (prefers-reduced-motion: reduce) { body > main, body > header { animation: none; } }
/* ===== Habillage premium des membres VIP (toutes les pages) ===== */
html.is-vip body { background-color: #0b0906; }
html.is-vip body::before { content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(1100px 420px at 50% -160px, rgba(250,204,21,.18), transparent 70%), radial-gradient(700px 500px at 100% 100%, rgba(180,120,20,.10), transparent 70%), radial-gradient(600px 500px at 0% 80%, rgba(250,204,21,.06), transparent 70%); }
html.is-vip body::after { content: ''; position: fixed; left: 0; right: 0; top: 0; height: 3px; z-index: 300; pointer-events: none;
  background: linear-gradient(90deg, transparent, #b8860b, #fde68a, #fff7d1, #fde68a, #b8860b, transparent); background-size: 200% 100%; animation: vip-line 4s linear infinite; box-shadow: 0 0 12px rgba(250,204,21,.6); }
@keyframes vip-line { to { background-position: -200% 0; } }
html.is-vip .panel, html.is-vip .card, html.is-vip .cm-card, html.is-vip .pp, html.is-vip .ro-box, html.is-vip .full .box {
  border-color: rgba(212,175,55,.65) !important; box-shadow: 0 0 0 1px rgba(250,204,21,.12), 0 12px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,236,170,.12) !important; }
html.is-vip .panel h2, html.is-vip .card h2 { color: #fde68a; text-shadow: 0 0 18px rgba(250,204,21,.35), 0 1px 0 rgba(0,0,0,.6); }
@keyframes vip-text { 50% { background-position: 100% 0; } }
html.is-vip .run-hud { border-color: #d4af37 !important; box-shadow: 0 0 22px rgba(250,204,21,.35) !important; }
html.is-vip .run-hud .rh-p::before { content: '👑 '; }
html.is-vip .cm-cta, html.is-vip .cta, html.is-vip .dt-cta, html.is-vip .bonus-btn { background: linear-gradient(135deg, #fff3c4, #fbbf24 35%, #b8860b 70%, #fde68a) !important; color: #1c1300 !important; box-shadow: 0 8px 26px rgba(212,175,55,.45), inset 0 1px 0 rgba(255,255,255,.6) !important; }
html.is-vip .vip-sparkles { position: fixed; inset: 0; pointer-events: none; z-index: -1; overflow: hidden; }
html:not(.is-vip) .vip-sparkles { display: none; }
html.is-vip .vip-sparkles i { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: #fde68a; box-shadow: 0 0 8px #facc15; opacity: 0; animation: vip-spark 5s ease-in-out infinite; }
@keyframes vip-spark { 0%, 100% { opacity: 0; transform: scale(.4); } 50% { opacity: .9; transform: scale(1.3) translateY(-12px); } }
@media (prefers-reduced-motion: reduce) { html.is-vip body::after, html.is-vip .panel h2, html.is-vip .card h2, html.is-vip .vip-sparkles i { animation: none !important; } }

#casino-maint { position: fixed; top: 0; left: 0; right: 0; z-index: 300; padding: max(.5rem, env(safe-area-inset-top)) 16px .5rem; text-align: center; font: 800 .9rem/1.3 system-ui, sans-serif; color: #1c1300; background: linear-gradient(90deg, #fde047, #f59e0b); box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.run-hud { position: fixed; z-index: 70; left: 50%; transform: translateX(-50%); bottom: max(10px, env(safe-area-inset-bottom)); display: flex; align-items: center; gap: .5rem; padding: .35rem .7rem; border-radius: 999px;
  background: rgba(12,10,8,.92); border: 1px solid rgba(250,204,21,.45); color: #fde68a; font: 700 .82rem/1.2 system-ui, sans-serif; text-decoration: none; box-shadow: 0 8px 24px rgba(0,0,0,.5); white-space: nowrap; max-width: calc(100vw - 32px); }
.run-hud[hidden] { display: none; }
.run-hud .rh-p { background: #facc15; color: #1c1300; border-radius: 999px; padding: .05rem .45rem; }
.run-hud .rh-t { font-variant-numeric: tabular-nums; }
.run-hud.late .rh-t { color: #f87171; animation: rh-blink 1s steps(2) infinite; }
.run-hud .rh-q { position: relative; min-width: 120px; padding: .1rem .5rem; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; text-align: center; font-variant-numeric: tabular-nums; }
.run-hud .rh-q i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #b45309, #f59e0b); opacity: .55; }
.run-hud.ok .rh-q i { background: linear-gradient(90deg, #15803d, #22c55e); }
.run-hud .rh-q b { position: relative; color: #fff; }
@keyframes rh-blink { 50% { opacity: .35; } }
.run-over { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.82); backdrop-filter: blur(4px); }
.run-over .ro-box { width: min(420px, 100%); text-align: center; background: #15110c; border: 2px solid #facc15; border-radius: 20px; padding: 1.4rem 1.2rem; color: #f5f0e6; font-family: system-ui, sans-serif; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
.run-over .ro-title { font-size: 1.5rem; font-weight: 900; color: #facc15; margin-bottom: .4rem; }
a.cm-cta { display: block; text-align: center; text-decoration: none; }
.cm-back { display: block; text-align: center; margin-top: .7rem; color: #9aa5b1; font-size: .9rem; }
.run-over .cm-cta { display: inline-block; text-decoration: none; margin-top: .6rem; padding: .9rem 1.4rem; color: #1c1300; background: linear-gradient(135deg, #fde047, #f59e0b); box-shadow: 0 8px 24px rgba(245,158,11,.4); }
@keyframes fr-hue { to { filter: hue-rotate(360deg); } } @keyframes fr-pulse { 50% { filter: brightness(1.45) saturate(1.3); } }

.lg-card { position: relative; width: 112px; height: 160px; border-radius: 12px; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; color: #fff; font: 12px system-ui, sans-serif; overflow: hidden;
  background: linear-gradient(160deg, var(--ca), var(--cb) 70%); border: 3px solid var(--rc); box-shadow: 0 6px 16px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.12); }
.lg-card .lg-top { width: 100%; display: flex; justify-content: space-between; font-size: .62em; opacity: .85; font-weight: 700; }
.lg-card .lg-art { flex: 1; display: grid; place-items: center; font-size: 3.1em; line-height: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,.5)); width: 100%; margin: 2px 0; border-radius: 8px; background: radial-gradient(circle at 50% 40%, rgba(255,255,255,.22), transparent 65%); }
.lg-card .lg-name { font-weight: 900; font-size: 1em; text-align: center; line-height: 1.1; text-shadow: 0 1px 3px #000; }
.lg-card .lg-rar { font-size: .62em; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; color: var(--rc); background: rgba(0,0,0,.45); border-radius: 999px; padding: 1px 7px; margin-top: 3px; }
.lg-card .lg-fact { font-size: .78em; line-height: 1.3; text-align: center; margin-top: 6px; background: rgba(0,0,0,.35); border-radius: 8px; padding: 6px; }
.lg-card .lg-cote { font-size: .78em; font-weight: 800; color: #fde68a; margin-top: 4px; }
.lg-card .lg-count { position: absolute; top: 18px; right: 4px; background: #f2c14e; color: #2a1d00; font-weight: 900; font-size: .75em; border-radius: 999px; padding: 1px 6px; }
.lg-card.xs { width: 84px; height: 120px; font-size: 9px; padding: 4px; border-width: 2px; } .lg-card.xs .lg-count { top: 13px; }
.lg-card.big { width: 250px; height: 380px; font-size: 17px; padding: 12px; border-width: 4px; }
.lg-card.big .lg-art { font-size: 4.4em; flex: 0 0 150px; }
.lg-card.locked { filter: grayscale(1) brightness(.55); }
.lg-card.locked .lg-art { font-size: 2.6em; color: rgba(255,255,255,.5); }
.lg-card .lg-holo { position: absolute; inset: -50%; background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,.35) 48%, rgba(255,200,255,.25) 52%, transparent 60%); animation: lg-holo 3.2s linear infinite; pointer-events: none; }
.lg-card.r-mythique { box-shadow: 0 0 22px var(--rc), 0 6px 16px rgba(0,0,0,.45); }
.lg-card.r-ultime { border-color: #22d3ee; box-shadow: 0 0 26px #22d3ee, 0 0 10px #f472b6, 0 6px 16px rgba(0,0,0,.45); animation: fr-hue 4s linear infinite; }
@keyframes lg-holo { from { transform: translateX(-35%) rotate(0deg); } to { transform: translateX(35%) rotate(0deg); } }
.casino-celebrate { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; background: radial-gradient(circle at 50% 45%, rgba(40,30,8,.92), rgba(0,0,0,.92)); overflow: hidden; animation: cc-fade .35s both; font: 15px system-ui, sans-serif; color: #f8f3e6; }
.casino-celebrate.out { animation: cc-fade .35s reverse both; }
.casino-celebrate .cc-box { position: relative; text-align: center; padding: 1.6rem 1.4rem; max-width: 340px; }
.casino-celebrate .cc-rays { position: absolute; left: 50%; top: 2.6rem; width: 340px; height: 340px; margin: -170px 0 0 -170px; background: repeating-conic-gradient(rgba(245,197,66,.22) 0 10deg, transparent 10deg 20deg); border-radius: 50%; animation: cc-spin 9s linear infinite; mask: radial-gradient(circle, #000 20%, transparent 70%); -webkit-mask: radial-gradient(circle, #000 20%, transparent 70%); z-index: -1; }
.casino-celebrate .cc-icon { font-size: 5rem; animation: cc-pop .8s cubic-bezier(.2,1.6,.4,1) both; filter: drop-shadow(0 0 22px rgba(245,197,66,.8)); }
.casino-celebrate .cc-title { font-size: 1.6rem; font-weight: 900; margin-top: .4rem; background: linear-gradient(90deg, #fde68a, #f5c542, #fff7d6, #f5c542); -webkit-background-clip: text; background-clip: text; color: transparent; animation: cc-up .6s .25s both; }
.casino-celebrate .cc-text { margin-top: .5rem; color: #e7dcc0; animation: cc-up .6s .4s both; }
.casino-celebrate .cc-max { display: inline-block; margin-top: .8rem; padding: .35rem .9rem; border-radius: 999px; border: 1px solid #f5c542; color: #f5c542; font-weight: 800; animation: cc-up .6s .55s both; }
.casino-celebrate .cc-ok { display: block; margin: 1.2rem auto 0; font: inherit; font-weight: 800; padding: .65rem 1.6rem; border: 0; border-radius: 999px; background: linear-gradient(180deg, #fde68a, #f5c542); color: #2a1d00; cursor: pointer; animation: cc-up .6s .7s both; }
.casino-celebrate > i { position: absolute; top: -40px; font-style: normal; font-size: 1.4rem; animation: cc-fall 3.2s linear infinite; }
@keyframes cc-fade { from { opacity: 0; } } @keyframes cc-spin { to { transform: rotate(360deg); } }
@keyframes cc-pop { from { transform: scale(.2) rotate(-25deg); opacity: 0; } } @keyframes cc-up { from { transform: translateY(14px); opacity: 0; } }
@keyframes cc-fall { to { transform: translateY(110vh) rotate(300deg); } }
.salon-pill { display: inline-block; margin-left: .5rem; padding: .05rem .5rem; border-radius: 999px; background: rgba(245,197,66,.15); border: 1px solid rgba(245,197,66,.6); color: #f5c542; font-weight: 700; font-size: .85em; white-space: nowrap; }
.casino-tx { align-self: center; font-weight: 800; font-size: 14px; padding: .5rem 1rem; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.5); animation: ct-in .4s cubic-bezier(.2,.9,.3,1.3) both; font-family: system-ui, sans-serif; text-align: center; }
.casino-tx.plus { background: #14532d; color: #bbf7d0; border: 2px solid #22c55e; } .casino-tx.minus { background: #450a0a; color: #fecaca; border: 2px solid #ef4444; }
.casino-tx.out { opacity: 0; transform: translateY(-10px); transition: .4s; }
.casino-confirm { position: fixed; inset: 0; z-index: 140; background: rgba(0,0,0,.72); display: grid; place-items: center; padding: 1rem; animation: cc-fade .2s both; font-family: system-ui, sans-serif; }
.casino-confirm .ccf-box { background: #161c24; color: #e8ecef; border: 1px solid #2f3a47; border-radius: 18px; padding: 1.2rem; width: min(360px, 100%); text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,.6); animation: cc-pop .3s cubic-bezier(.2,1.4,.4,1) both; }
.casino-confirm .ccf-icon { font-size: 2.6rem; } .casino-confirm h3 { margin: .3rem 0 .4rem; font-size: 1.15rem; } .casino-confirm p { margin: 0 0 .6rem; color: #b6c0cc; font-size: .92rem; line-height: 1.4; }
.casino-confirm .ccf-bank { display: flex; justify-content: space-between; gap: .5rem; background: #0d1117; border-radius: 10px; padding: .5rem .7rem; margin: .4rem 0 .8rem; font-size: .9rem; } .casino-confirm .ccf-bank b { color: #f2c14e; }
.casino-confirm .ccf-btns { display: flex; gap: .5rem; } .casino-confirm button { flex: 1; font: inherit; font-weight: 800; border-radius: 999px; padding: .65rem; cursor: pointer; }
.casino-confirm .ccf-no { background: transparent; color: #e8ecef; border: 1px solid #3a4655; } .casino-confirm .ccf-ok { background: linear-gradient(135deg, #f2c14e, #e89a2c); color: #222; border: 0; }
#casino-toasts { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); z-index: 150; display: flex; flex-direction: column; gap: .5rem; width: min(420px, calc(100vw - 24px)); pointer-events: none; }
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
