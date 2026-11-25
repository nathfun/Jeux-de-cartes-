/*
 * Profil du joueur, commun à tous les jeux du Casino (enregistré sur l'appareil) :
 *  - banque unique ; parties réelles (somme apportée puis encaissée) et mode Entraînement (rien ne compte) ;
 *  - expérience et niveaux, avec un titre ;
 *  - bonus quotidien (plus fort si on revient plusieurs jours de suite) ;
 *  - 3 défis du jour, renouvelés à minuit ;
 *  - succès à débloquer ;
 *  - personnalisation (tapis, dos de cartes) débloquée avec les niveaux ;
 *  - notifications, effet « gros gain », vibrations.
 * Les jeux appellent Casino.track(type, données) après chaque main ou tour.
 * Tout est en jetons virtuels : aucun argent réel.
 */
(function () {
  'use strict';
  const KEY = 'casino-profile-v1';
  const AVATARS = ['🎩', '🦊', '🐯', '🦁', '🐼', '🐸', '🦄', '🐙', '🦉', '🐺', '👑', '😎', '🤠', '🧙', '🥷', '🚀'];

  // ---------- Niveaux ----------
  const need = (n) => 50 * n * (n - 1); // XP totale pour atteindre le niveau n (niveau 2 : 100, 10 : 4 500, 20 : 19 000)
  function levelOf(xp) { let n = 1; while (need(n + 1) <= xp) n++; return n; }
  function title(lv) {
    return lv >= 35 ? 'Légende' : lv >= 20 ? 'High Roller' : lv >= 10 ? 'Joueur confirmé' : lv >= 5 ? 'Habitué' : 'Débutant';
  }

  // ---------- Personnalisation ----------
  const FELTS = [
    { id: 'vert', name: 'Vert classique', level: 1, a: '#0f5132', b: '#0a3a24' },
    { id: 'bleu', name: 'Bleu nuit', level: 3, a: '#123a6b', b: '#0b2546' },
    { id: 'rouge', name: 'Rouge velours', level: 6, a: '#6b1220', b: '#460a14' },
    { id: 'violet', name: 'Violet royal', level: 10, a: '#43206b', b: '#2b1446' },
    { id: 'noir', name: 'Noir et or', level: 20, a: '#1c1c1c', b: '#0b0b0b' },
  ];
  const BACKS = [
    { id: 'bleu', name: 'Bleu', level: 1, a: '#1c3d7a', b: '#24519e' },
    { id: 'rouge', name: 'Rouge', level: 4, a: '#7a1c24', b: '#9e2430' },
    { id: 'vert', name: 'Émeraude', level: 8, a: '#145c3a', b: '#1d7a4e' },
    { id: 'or', name: 'Or', level: 15, a: '#8a6a1c', b: '#c9a24a' },
  ];

  // ---------- Défis du jour ----------
  const CHALLENGES = [
    { id: 'bj_wins3', game: 'Blackjack', text: 'Gagne 3 mains de blackjack', target: 3, reward: 400, xp: 60, on: (t, d) => (t === 'bj' && d.net > 0 ? 1 : 0) },
    { id: 'bj_hands15', game: 'Blackjack', text: 'Joue 15 mains de blackjack', target: 15, reward: 300, xp: 50, on: (t) => (t === 'bj' ? 1 : 0) },
    { id: 'bj_double', game: 'Blackjack', text: 'Gagne une main en doublant', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'bj' && d.doubledWin ? 1 : 0) },
    { id: 'bj_natural', game: 'Blackjack', text: 'Obtiens un blackjack', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'bj' && d.blackjack ? 1 : 0) },
    { id: 'pk_hands12', game: 'Poker', text: 'Joue 12 mains de poker', target: 12, reward: 300, xp: 50, on: (t) => (t === 'pk' ? 1 : 0) },
    { id: 'pk_trips', game: 'Poker', text: 'Gagne une main avec un brelan ou mieux', target: 1, reward: 600, xp: 80, on: (t, d) => (t === 'pk' && d.won && d.cat >= 3 ? 1 : 0) },
    { id: 'pk_top3', game: 'Poker', text: 'Termine dans les 3 premiers d\'un tournoi', target: 1, reward: 700, xp: 90, on: (t, d) => (t === 'pk-tourney' && d.place <= 3 ? 1 : 0) },
    { id: 'rl_spins10', game: 'Roulette', text: 'Joue 10 tours de roulette', target: 10, reward: 300, xp: 50, on: (t, d) => (t === 'rl' && d.staked > 0 ? 1 : 0) },
    { id: 'rl_plein', game: 'Roulette', text: 'Touche un plein à la roulette', target: 1, reward: 700, xp: 90, on: (t, d) => (t === 'rl' && d.pleinHit ? 1 : 0) },
    { id: 'rl_win200', game: 'Roulette', text: 'Gagne au moins 200 € en un seul tour', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'rl' && d.net >= 200 ? 1 : 0) },
    { id: 'any_win1000', game: 'Tous les jeux', text: 'Gagne 1 000 € au total aujourd\'hui', target: 1000, reward: 600, xp: 80, on: (t, d) => (['bj', 'rl', 'sl'].includes(t) && d.net > 0 ? d.net : 0) },
    { id: 'sl_spins20', game: 'Machine à sous', text: 'Fais 20 tours de machine à sous', target: 20, reward: 300, xp: 50, on: (t) => (t === 'sl' ? 1 : 0) },
    { id: 'sl_free', game: 'Machine à sous', text: 'Déclenche des tours gratuits', target: 1, reward: 600, xp: 80, on: (t, d) => (t === 'sl' && d.freeTrigger ? 1 : 0) },
    { id: 'sl_x10', game: 'Machine à sous', text: 'Gagne au moins 10 fois ta mise en un tour', target: 1, reward: 600, xp: 80, on: (t, d) => (t === 'sl' && d.bet > 0 && d.net + d.bet >= 10 * d.bet ? 1 : 0) },
  ];

  // ---------- Succès ----------
  const ACHIEVEMENTS = [
    { id: 'first_win', icon: '🌟', name: 'Première victoire', text: 'Gagner une main ou un tour' },
    { id: 'bj_first', icon: '🂡', name: 'Blackjack !', text: 'Obtenir son premier blackjack' },
    { id: 'bj_10', icon: '🃏', name: 'Collectionneur', text: 'Obtenir 10 blackjacks' },
    { id: 'bj_100', icon: '♠️', name: 'Pilier du blackjack', text: 'Jouer 100 mains de blackjack' },
    { id: 'pk_quads', icon: '🎴', name: 'Carré', text: 'Gagner une main de poker avec un carré' },
    { id: 'pk_sflush', icon: '🌈', name: 'Quinte flush', text: 'Gagner avec une quinte flush' },
    { id: 'pk_champion', icon: '🏆', name: 'Champion', text: 'Gagner un tournoi de poker' },
    { id: 'pk_allin', icon: '💥', name: 'Tout ou rien', text: 'Gagner un tapis au poker' },
    { id: 'rl_plein', icon: '🎯', name: 'En plein dans le mille', text: 'Toucher un plein à la roulette' },
    { id: 'rl_zero', icon: '0️⃣', name: 'Ami du zéro', text: 'Gagner une mise sur le 0' },
    { id: 'rl_cashout', icon: '💰', name: 'Savoir s\'arrêter', text: 'Encaisser à la roulette avec +1 000 €' },
    { id: 'big_win', icon: '🤑', name: 'Gros gain', text: 'Gagner 10 fois sa mise en un coup' },
    { id: 'jackpot', icon: '🎰', name: 'Jackpot', text: 'Décrocher le jackpot à la machine à sous' },
    { id: 'friends', icon: '🤝', name: 'Entre potes', text: 'Jouer une partie entre amis' },
    { id: 'daily7', icon: '📅', name: 'Fidèle', text: 'Venir 7 jours d\'affilée' },
    { id: 'challenges10', icon: '✅', name: 'Relevé !', text: 'Terminer 10 défis du jour' },
    { id: 'lvl10', icon: '⭐', name: 'Joueur confirmé', text: 'Atteindre le niveau 10' },
    { id: 'lvl20', icon: '💎', name: 'High Roller', text: 'Atteindre le niveau 20' },
    { id: 'rich25', icon: '🏦', name: 'Grosse banque', text: 'Avoir 25 000 € en banque' },
    { id: 'rich100', icon: '👑', name: 'Millionnaire en herbe', text: 'Avoir 100 000 € en banque' },
  ];

  // ---------- Stockage ----------
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function fresh() {
    let pseudo = '';
    try { pseudo = localStorage.getItem('bj-pseudo') || ''; } catch (e) { /* ignore */ }
    return {
      pseudo, avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], wallet: 5000, xp: 0,
      totals: { hands: 0, wins: 0, bjHands: 0, bjBlackjacks: 0, pkHands: 0, rlSpins: 0, slSpins: 0, biggestWin: 0, challenges: 0 },
      achievements: {}, daily: null, bonus: { last: null, streak: 0 }, rescueAt: 0, sessions: {}, timebank: null,
      equipped: { felt: 'vert', back: 'bleu' }, settings: { music: false, vibrate: true }, createdAt: Date.now(),
    };
  }
  let P = null;
  function load() {
    if (P) return P;
    try { const raw = localStorage.getItem(KEY); if (raw) P = Object.assign(fresh(), JSON.parse(raw)); } catch (e) { /* ignore */ }
    if (!P) P = fresh();
    P.totals = Object.assign(fresh().totals, P.totals);
    if (!P.sessions) P.sessions = {};
    return P;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* ignore */ }
    listeners.forEach((f) => { try { f(P); } catch (e) { /* ignore */ } });
  }
  const listeners = [];

  // Les 3 défis du jour (choisis selon la date, un par jeu si possible)
  function ensureDaily() {
    load();
    const d = today();
    if (P.daily && P.daily.date === d) return P.daily;
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (game) => { const list = CHALLENGES.filter((c) => c.game === game); return list[h % list.length]; };
    const all = ['Blackjack', 'Poker', 'Roulette', 'Machine à sous'];
    const games = all.filter((g, i) => i !== (h >>> 3) % all.length); // 3 jeux sur 4, qui tournent
    const ids = games.map((g) => pick(g).id);
    if (h % 3 === 0) ids[h % 3] = 'any_win1000';
    P.daily = { date: d, list: ids.map((id) => ({ id, progress: 0, done: false, claimed: false })), wonToday: 0 };
    save();
    return P.daily;
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

  // ---------- Expérience, succès ----------
  function addXP(n) {
    load();
    const before = levelOf(P.xp);
    P.xp += Math.round(n);
    const after = levelOf(P.xp);
    if (after > before) {
      const unlocked = FELTS.concat(BACKS).filter((c) => c.level > before && c.level <= after).map((c) => c.name);
      toast('Niveau ' + after + ' !', title(after) + (unlocked.length ? ' — débloqué : ' + unlocked.join(', ') : ''), '⬆️', 'level');
      vibrate([40, 30, 80]);
      if (window.Sfx) Sfx.win();
      if (after >= 10) unlock('lvl10');
      if (after >= 20) unlock('lvl20');
    }
  }
  function unlock(id) {
    load();
    if (P.achievements[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    P.achievements[id] = Date.now();
    toast('Succès débloqué : ' + a.name, a.text + ' (+100 XP)', a.icon, 'achievement');
    vibrate([30, 30, 30, 30, 90]);
    addXP(100);
  }
  function checkWallet() {
    if (P.wallet >= 25000) unlock('rich25');
    if (P.wallet >= 100000) unlock('rich100');
  }

  /**
   * Événements envoyés par les jeux :
   *  bj { net, bet, blackjack, doubledWin }            · pk { won, net, cat, allinWon }
   *  pk-tourney { place, players }                       · rl { staked, net, pleinHit, zeroWin }
   *  rl-cashout { diff }                                 · sl { bet, net, jackpot }
   *  multi { game }
   */
  function track(type, d) {
    if (Casino.training) return; // mode Entraînement : rien ne compte (ni XP, ni défis, ni succès)
    load();
    d = d || {};
    const T = P.totals;
    const isRound = ['bj', 'pk', 'rl', 'sl'].includes(type);
    if (isRound) {
      T.hands++;
      addXP(5);
      if (d.net > 0) {
        T.wins++;
        addXP(Math.min(40, 3 + d.net / 25));
        unlock('first_win');
        if (d.net > T.biggestWin) T.biggestWin = d.net;
      }
    }
    if (type === 'bj') {
      T.bjHands++;
      if (d.blackjack) { T.bjBlackjacks++; unlock('bj_first'); if (T.bjBlackjacks >= 10) unlock('bj_10'); }
      if (T.bjHands >= 100) unlock('bj_100');
    }
    if (type === 'pk') {
      T.pkHands++;
      if (d.won && d.cat === 7) unlock('pk_quads');
      if (d.won && d.cat === 8) unlock('pk_sflush');
      if (d.allinWon) unlock('pk_allin');
    }
    if (type === 'pk-tourney') { addXP(d.place === 1 ? 150 : 40); if (d.place === 1) unlock('pk_champion'); }
    if (type === 'rl') { T.rlSpins++; if (d.pleinHit) unlock('rl_plein'); if (d.zeroWin) unlock('rl_zero'); }
    if (type === 'rl-cashout' && d.diff >= 1000) unlock('rl_cashout');
    if (type === 'sl') { T.slSpins++; if (d.jackpot) unlock('jackpot'); }
    if (type === 'multi') { unlock('friends'); addXP(20); }
    if (isRound && d.bet > 0 && d.net >= d.bet * 9) unlock('big_win');
    // défis du jour
    const daily = ensureDaily();
    daily.list.forEach((c) => {
      if (c.done) return;
      const def = CHALLENGES.find((x) => x.id === c.id);
      const inc = def ? def.on(type, d) : 0;
      if (!inc) return;
      c.progress = Math.min(def.target, c.progress + inc);
      if (c.progress >= def.target) {
        c.done = true;
        toast('Défi du jour réussi !', def.text + ' — récupère ta récompense sur l\'accueil', '✅', 'challenge');
        vibrate([40, 30, 40]);
      }
    });
    checkWallet();
    save();
  }


  // ---------- Banque du temps ----------
  const TIME_PACKS = [
    { id: 'cafe', icon: '☕', name: 'Pause café', minutes: 5, amount: 250 },
    { id: 'repas', icon: '🍔', name: 'Pause repas', minutes: 30, amount: 1000 },
    { id: 'soiree', icon: '🌙', name: 'Soirée', minutes: 120, amount: 3000 },
    { id: 'nuit', icon: '🛌', name: 'Nuit complète', minutes: 480, amount: 8000 },
  ];

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
      rb.onclick = () => { Casino.training = false; opts.onStart('real', cur.stack, true); };
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
      go.onclick = () => {
        const v = Math.floor(Number(inp.value));
        if (!(v >= min)) { note.textContent = 'Il faut apporter au moins ' + fmtE(min) + '.'; return; }
        if (v > P.wallet) { note.textContent = 'Ta banque ne contient que ' + fmtE(P.wallet) + '. Gagne du temps contre de l\'argent sur l\'accueil (banque du temps).'; return; }
        if (!Casino.startSession(opts.game, v)) return;
        Casino.training = false;
        opts.onStart('real', v, false);
      };
      if (wal < min) { go.disabled = true; note.textContent = 'Ta banque est trop basse (' + fmtE(wal) + '). Récupère ton bonus du jour ou passe par la banque du temps sur l\'accueil.'; }
      real.append(row, quick, go, note);
    }
    box.append(train, real);
  }

  // ---------- API ----------
  const Casino = {
    AVATARS, FELTS, BACKS, CHALLENGES, ACHIEVEMENTS, need, levelOf, title,
    get profile() { return load(); },
    onChange(f) { listeners.push(f); },
    wallet() { return load().wallet; },
    setWallet(v) { load(); P.wallet = Math.max(0, Math.round(v * 100) / 100); checkWallet(); save(); },
    addWallet(v) { load(); Casino.setWallet(P.wallet + v); },
    setPseudo(name) {
      load(); P.pseudo = String(name || '').trim().slice(0, 16);
      try { localStorage.setItem('bj-pseudo', P.pseudo); } catch (e) { /* ignore */ }
      save();
    },
    setAvatar(a) { load(); if (AVATARS.includes(a)) { P.avatar = a; save(); } },
    setSetting(k, v) { load(); P.settings[k] = v; save(); },
    save() { load(); save(); },
    // Bonus quotidien : 500 €, +250 € par jour consécutif (jusqu'à 2 000 €)
    bonusInfo() {
      load();
      const d = today();
      if (P.bonus.last === d) return { available: false, streak: P.bonus.streak };
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yd = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
      const streak = P.bonus.last === yd ? P.bonus.streak + 1 : 1;
      return { available: true, streak, amount: Math.min(2000, 500 + 250 * (streak - 1)) };
    },
    claimBonus() {
      const b = Casino.bonusInfo();
      if (!b.available) return 0;
      P.bonus = { last: today(), streak: b.streak };
      P.wallet += b.amount;
      addXP(30);
      if (b.streak >= 7) unlock('daily7');
      checkWallet();
      save();
      vibrate([30, 30, 60]);
      return b.amount;
    },
    daily() { return ensureDaily(); },
    claimChallenge(id) {
      const daily = ensureDaily();
      const c = daily.list.find((x) => x.id === id);
      const def = CHALLENGES.find((x) => x.id === id);
      if (!c || !c.done || c.claimed || !def) return 0;
      c.claimed = true;
      P.wallet += def.reward;
      P.totals.challenges++;
      addXP(def.xp);
      if (P.totals.challenges >= 10) unlock('challenges10');
      checkWallet();
      save();
      return def.reward;
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

    // ---------- Parties réelles : on apporte une somme, on encaisse quand on veut ----------
    training: false,
    TRAIN_BANK: 10000,
    GAMES: { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette', slots: 'Machine à sous' },
    session(game) { return load().sessions[game] || null; },
    sessions() { return Object.assign({}, load().sessions); },
    startSession(game, amount) {
      load();
      amount = Math.floor(amount);
      if (P.sessions[game]) return P.sessions[game];
      if (!(amount > 0) || amount > P.wallet) return null;
      P.wallet -= amount;
      P.sessions[game] = { stack: amount, start: amount, at: Date.now() };
      save();
      return P.sessions[game];
    },
    setStack(game, v) {
      load();
      const ss = P.sessions[game];
      if (!ss) return;
      ss.stack = Math.max(0, Math.round(v * 100) / 100);
      save();
    },
    // Fin de partie : la somme sur la table revient à la banque (rien si tout a été perdu)
    cashOut(game) {
      load();
      const ss = P.sessions[game];
      if (!ss) return null;
      delete P.sessions[game];
      P.wallet += ss.stack;
      const diff = Math.round((ss.stack - ss.start) * 100) / 100;
      if (diff > 0) { P.totals.cashouts = (P.totals.cashouts || 0) + 1; addXP(Math.min(80, 10 + diff / 50)); }
      checkWallet();
      save();
      return { start: ss.start, end: ss.stack, diff };
    },
    modePicker,
    // ---------- Banque du temps : on « achète » de l'argent avec du temps d'attente ----------
    TIME_PACKS,
    timebank() {
      load();
      const t = P.timebank;
      if (!t) return null;
      const pack = TIME_PACKS.find((x) => x.id === t.pack);
      return { pack, start: t.start, end: t.end, left: Math.max(0, t.end - Date.now()), ready: Date.now() >= t.end };
    },
    startTime(id) {
      load();
      const pack = TIME_PACKS.find((x) => x.id === id);
      if (!pack || P.timebank) return false;
      P.timebank = { pack: id, start: Date.now(), end: Date.now() + pack.minutes * 60000 };
      save();
      return true;
    },
    claimTime() {
      const t = Casino.timebank();
      if (!t || !t.ready) return 0;
      P.timebank = null;
      P.wallet += t.pack.amount;
      checkWallet();
      save();
      vibrate([30, 30, 60]);
      return t.pack.amount;
    },
    cancelTime() { load(); P.timebank = null; save(); },
    track, toast, bigWin, vibrate, unlock, applyCosmetics,
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
.cm-badge.real { background: #f2c14e; color: #2a1d00; }`;
    document.head.appendChild(s);
  }

  window.Casino = Casino;
  document.addEventListener('DOMContentLoaded', () => { applyCosmetics(); ensureDaily(); });
  if (document.readyState !== 'loading') { applyCosmetics(); }
})();
