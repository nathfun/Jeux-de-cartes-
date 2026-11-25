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
  const SERVER = ONLINE && !!window.CASINO_SERVER;
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
        const [appMod, authMod, dbMod, fnMod] = await Promise.all(['app', 'auth', 'database'].concat(SERVER ? ['functions'] : []).map((m) => import(FB + 'firebase-' + m + '.js')));
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
        const auth = authMod.getAuth(app);
        if (auth.authStateReady) await auth.authStateReady();
        if (!auth.currentUser) await authMod.signInAnonymously(auth);
        const fn = SERVER ? fnMod.httpsCallable(fnMod.getFunctions(app, 'europe-west1'), 'casino') : null;
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
      const res = (await f.fn({ op, data: data || {} })).data;
      applyServer(res);
      return res.result || {};
    } catch (e) {
      const msg = e && e.code === 'functions/failed-precondition' ? e.message : (e && e.code === 'functions/unavailable') || /network|internet|fetch/i.test(String(e && e.message)) ? 'Pas de connexion au serveur.' : errText(e);
      return { error: msg };
    }
  }
  let syncing = null;
  function sync() {
    if (!syncing) syncing = call('sync', { pseudo: load().pseudo }).finally(() => { setTimeout(() => { syncing = null; }, 2000); });
    return syncing;
  }

  // ---------- Banque protégée par les règles de la base (sans serveur payant) ----------
  const BONUS_GAP = 6 * 3600000; // les règles imposent 6 h entre deux bonus
  const GAIN_CAP = 100000;       // et au plus 100 000 € de gains encaissés par 24 h
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
      return { error: 'Opération refusée par la banque.' };
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
    o.addEventListener('click', () => o.remove());
    setTimeout(() => o.classList.add('out'), 3600);
    setTimeout(() => o.remove(), 4200);
  }


  // ---------- Choix du mode avant une partie solo ----------
  /**
   * Affiche dans `box` le choix entre Entraînement (crédit illimité, aides) et Partie réelle
   * (somme apportée de la banque, sans aides, compte pour la progression).
   * opts : { game, min, suggest, realNote, onStart(mode, amount, resumed) }
   */
  function modePicker(box, opts) {
    injectStyle();
    load();
    // Mode Apprentissage (choisi sur l'accueil) : on joue tout de suite, crédit illimité et aides
    if (Casino.learn) {
      box.innerHTML = '';
      Casino.training = true;
      setTimeout(() => opts.onStart('train', Casino.TRAIN_BANK, false), 0);
      return;
    }
    // Partie réelle déjà en cours dans ce jeu : on la reprend directement
    if (P.sessions[opts.game] && !opts.noAutoResume) {
      box.innerHTML = '';
      const p0 = document.createElement('p'); p0.className = 'muted'; p0.textContent = 'Reprise de ta partie…'; box.appendChild(p0);
      Casino.startSession(opts.game, P.sessions[opts.game].stack).then((r) => {
        if (!r || r.error) { opts.noAutoResume = true; modePicker(box, opts); return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, true, r);
      });
      return;
    }
    const fmtE = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
    box.innerHTML = '';
    box.className = 'cm-picker';
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const train = mk('div', 'cm-card cm-train');
    train.append(mk('div', 'cm-title', '🎓 Entraînement'),
      mk('p', '', 'Crédit illimité et toutes les aides pour apprendre. Ne compte pas pour les niveaux, les défis et les succès.'));
    const tb = mk('button', 'cm-btn', 'S\'entraîner');
    tb.type = 'button';
    tb.onclick = () => { Casino.training = true; opts.onStart('train', Casino.TRAIN_BANK, false); };
    train.appendChild(tb);

    const real = mk('div', 'cm-card cm-real');
    real.append(mk('div', 'cm-title', '💰 Partie réelle'));
    const cur = P.sessions[opts.game];
    if (cur) {
      real.append(mk('p', '', 'Tu as une partie en cours : ' + fmtE(cur.stack) + ' sur la table (apporté : ' + fmtE(cur.start) + ').'));
      const rb = mk('button', 'cm-btn gold', 'Reprendre la partie');
      rb.type = 'button';
      rb.onclick = async () => {
        rb.disabled = true;
        const r = await Casino.startSession(opts.game, cur.stack);
        rb.disabled = false;
        if (!r || r.error) { real.appendChild(mk('p', 'cm-note', (r && r.error) || 'Impossible de reprendre.')); return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, true, r);
      };
      real.appendChild(rb);
    } else {
      real.append(mk('p', '', 'Tu apportes une somme de ta banque, sans aides : c\'est là que tu vois si tu as bien appris. Gains, XP, défis et succès comptent. Tu encaisses quand tu veux ; si tu perds tout, c\'est perdu.' + (opts.realNote ? ' ' + opts.realNote : '')));
      const min = opts.min || 1;
      const wal = P.wallet;
      const row = mk('div', 'cm-amount');
      const lab = mk('label', '', 'Somme apportée ');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = min; inp.max = Math.max(min, Math.floor(wal)); inp.step = 1;
      inp.value = Math.max(min, Math.min(Math.floor(wal), opts.suggest || 500));
      lab.appendChild(inp);
      row.append(lab, mk('span', 'cm-bank', 'Banque : ' + fmtE(wal)));
      const quick = mk('div', 'cm-quick');
      [100, 500, 1000, 2500].filter((v) => v >= min && v <= wal).forEach((v) => {
        const q = mk('button', 'cm-q', fmtE(v)); q.type = 'button'; q.onclick = () => { inp.value = v; }; quick.appendChild(q);
      });
      if (wal >= min) { const q = mk('button', 'cm-q', 'Tout'); q.type = 'button'; q.onclick = () => { inp.value = Math.floor(wal); }; quick.appendChild(q); }
      const note = mk('p', 'cm-note');
      const go = mk('button', 'cm-btn gold', 'Jouer pour de vrai');
      go.type = 'button';
      go.onclick = async () => {
        const v = Math.floor(Number(inp.value));
        if (!(v >= min)) { note.textContent = 'Il faut apporter au moins ' + fmtE(min) + '.'; return; }
        if (v > P.wallet) { note.textContent = 'Ta banque ne contient que ' + fmtE(P.wallet) + '. Gagne du temps contre de l\'argent sur l\'accueil (banque du temps).'; return; }
        go.disabled = true;
        note.textContent = '';
        const r = await Casino.startSession(opts.game, v);
        go.disabled = false;
        if (!r || r.error) { note.textContent = (r && r.error) || 'Impossible de commencer.'; return; }
        Casino.training = false;
        opts.onStart('real', r.session.stack, !!r.resumed, r);
      };
      if (wal < min) { go.disabled = true; note.textContent = 'Ta banque est trop basse (' + fmtE(wal) + '). Récupère ton bonus du jour ou passe par la banque du temps sur l\'accueil.'; }
      real.append(row, quick, go, note);
    }
    const learnTip = mk('p', 'cm-learn-tip', 'Envie d\'apprendre d\'abord ? Active le mode 🎓 Apprentissage sur l\'accueil : crédit illimité, aides et conseils.');
    real.appendChild(learnTip);
    box.append(real);
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
        const r = await bankOp('gain', def.reward, () => ({ x: def.reward }), (N) => R.claimChallenge(P, id, Date.now(), N));
        return r.ok ? def.reward : 0;
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
    TRAIN_BANK: 10000,
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
    timebank() { return R.timeInfo(load(), Date.now()); },
    async startTime(id) {
      if (SERVER) return !(await call('time.start', { pack: id })).error;
      if (BANK) return !(await bankOp('tstart', 0, (o) => { if (o.tb) return false; o.tb = { p: id, s: { '.sv': 'timestamp' } }; }, () => R.startTime(P, id, Date.now()))).error;
      return local(() => R.startTime(P, id, Date.now()));
    },
    async claimTime() {
      if (SERVER) { const r = await call('time.claim'); if (r.amount) vibrate([30, 30, 60]); return r.amount || 0; }
      if (BANK) {
        const t = R.timeInfo(load(), Date.now());
        if (!t || !t.ready) return 0;
        const r = await bankOp('tclaim', t.pack.amount, (o) => { delete o.tb; }, (N) => R.claimTime(P, Date.now(), N));
        if (r.ok) vibrate([30, 30, 60]);
        return r.ok ? t.pack.amount : 0;
      }
      return local((N) => R.claimTime(P, Date.now(), N));
    },
    async cancelTime() {
      if (SERVER) { await call('time.cancel'); return; }
      if (BANK) { await bankOp('spend', 0, (o) => { delete o.tb; }, () => { P.timebank = null; }); return; }
      local(() => { P.timebank = null; });
    },
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
.cm-badge.real { background: #f2c14e; color: #2a1d00; }`;
    document.head.appendChild(s);
  }

  window.Casino = Casino;
  document.addEventListener('DOMContentLoaded', () => { applyCosmetics(); });
  if (document.readyState !== 'loading') { applyCosmetics(); }
  if (SERVER) sync().catch(() => {}); else { load(); R.ensureDaily(P, Date.now()); }
  if (BANK) bankInit();
})();
