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
  const SERVER = !!(window.CASINO_SERVER && cfg && cfg.databaseURL && !/[?&]backend=local\b/.test(location.search) && !window.claude);
  // Réglages propres à l'appareil (jamais envoyés au serveur comme argent)
  const LOCAL_KEYS = ['equipped', 'settings', 'friends', 'friendCode', 'friendCodeUid', 'myChallenges', 'savedAt'];

  // ---------- Stockage ----------
  let P = null;
  function localDefaults() { return { equipped: { felt: 'vert', back: 'bleu' }, settings: { music: false, vibrate: true } }; }
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
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* ignore */ }
    listeners.forEach((f) => { try { f(P); } catch (e) { /* ignore */ } });
  }

  // ---------- Serveur ----------
  let fbp = null;
  function firebase() {
    if (!fbp) {
      fbp = (async () => {
        if (!cfg || !cfg.databaseURL) return null;
        const [appMod, authMod, dbMod, fnMod] = await Promise.all(['app', 'auth', 'database', 'functions'].map((m) => import(FB + 'firebase-' + m + '.js')));
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
        const auth = authMod.getAuth(app);
        if (auth.authStateReady) await auth.authStateReady();
        if (!auth.currentUser) await authMod.signInAnonymously(auth);
        const fns = fnMod.getFunctions(app, 'europe-west1');
        return { app, auth, authMod, dbMod, db: dbMod.getDatabase(app), fn: fnMod.httpsCallable(fns, 'casino') };
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
      coin.textContent = ['🪙', '💰', '💎', '⭐'][k % 4];
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
    box.append(train, real);
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
    call, sync, firebase,
    get profile() { return load(); },
    onChange(f) { listeners.push(f); },
    wallet() { return load().wallet; },
    // Mode sans serveur uniquement (les jeux ne touchent jamais la banque directement avec le serveur)
    setWallet(v) { if (SERVER) return; local((N) => { P.wallet = Math.max(0, Math.round(v * 100) / 100); R.checkWallet(P, N); }); },
    addWallet(v) { if (SERVER) return; Casino.setWallet(load().wallet + v); },
    setPseudo(name) {
      load(); P.pseudo = String(name || '').trim().slice(0, 16);
      try { localStorage.setItem('bj-pseudo', P.pseudo); } catch (e) { /* ignore */ }
      save();
      if (SERVER) call('profile.set', { pseudo: P.pseudo });
    },
    setAvatar(a) { load(); if (AVATARS.includes(a)) { P.avatar = a; save(); if (SERVER) call('profile.set', { avatar: a }); } },
    setFriendCode(code) { if (SERVER) call('profile.set', { code }); },
    setSetting(k, v) { load(); P.settings[k] = v; save(); },
    save() { load(); save(); },
    bonusInfo() { return R.bonusInfo(load(), Date.now()); },
    async claimBonus() {
      if (SERVER) { const r = await call('bonus.claim'); return r.amount || 0; }
      return local((N) => R.claimBonus(P, Date.now(), N));
    },
    daily() { load(); if (!SERVER) R.ensureDaily(P, Date.now()); return P.daily || { list: [] }; },
    async claimChallenge(id) {
      if (SERVER) { const r = await call('challenge.claim', { id }); return r.amount || 0; }
      return local((N) => R.claimChallenge(P, id, Date.now(), N));
    },
    equip(kind, id) {
      load();
      const list = kind === 'felt' ? FELTS : BACKS;
      const item = list.find((x) => x.id === id);
      if (!item || levelOf(P.xp) < item.level) return false;
      P.equipped[kind] = id;
      save();
      applyCosmetics();
      return true;
    },
    // ---------- Parties réelles ----------
    training: false,
    TRAIN_BANK: 10000,
    session(game) { return load().sessions[game] || null; },
    sessions() { return Object.assign({}, load().sessions); },
    /** Commence (ou reprend) une partie réelle : { session, resumed, … } ou { error } */
    async startSession(game, amount) {
      if (SERVER) { const r = await call('session.start', { game, amount }); return r; }
      load();
      if (P.sessions[game]) return { session: P.sessions[game], resumed: true };
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
      const v = local((N) => R.applyPrize(P, key, place, players, Date.now(), N));
      if (v > 0) setTimeout(() => bigWin(v, place === 1 ? 'VICTOIRE ENTRE AMIS !' : '2e PLACE !'), 2200);
      return v;
    },
    showRanking,
    // ---------- Banque du temps ----------
    timebank() { return R.timeInfo(load(), Date.now()); },
    async startTime(id) {
      if (SERVER) return !(await call('time.start', { pack: id })).error;
      return local(() => R.startTime(P, id, Date.now()));
    },
    async claimTime() {
      if (SERVER) { const r = await call('time.claim'); if (r.amount) vibrate([30, 30, 60]); return r.amount || 0; }
      return local((N) => R.claimTime(P, Date.now(), N));
    },
    async cancelTime() {
      if (SERVER) { await call('time.cancel'); return; }
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
    },
    resetLocal() { P = Object.assign(localDefaults(), R.normalize(null, Date.now())); P.pseudo = ''; save(); if (SERVER) sync(); },
    unlock(id) { if (!SERVER) local((N) => R.unlock(P, id, N)); },
    toast, bigWin, vibrate, applyCosmetics,
  };

  // Couleurs du tapis et du dos des cartes choisies par le joueur
  function applyCosmetics() {
    load();
    const f = FELTS.find((x) => x.id === P.equipped.felt) || FELTS[0];
    const b = BACKS.find((x) => x.id === P.equipped.back) || BACKS[0];
    const r = document.documentElement.style;
    r.setProperty('--felt', f.a); r.setProperty('--felt-dark', f.b);
    r.setProperty('--back1', b.a); r.setProperty('--back2', b.b);
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
.cm-picker { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: .8rem; margin: .8rem 0; }
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
})();
