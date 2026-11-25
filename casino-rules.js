/*
 * Règles du Casino, partagées par l'app (mode sans serveur) et par le serveur (functions/) :
 * niveaux, défis du jour, succès, bonus, banque du temps, parties réelles, prix entre amis.
 * Toutes les fonctions travaillent sur un objet profil P et ajoutent leurs notifications à N
 * (tableau de { kind, title, text, icon }), affichées ensuite par l'app.
 */
(function (root) {
  'use strict';
  const AVATARS = ['🎩', '🦊', '🐯', '🦁', '🐼', '🐸', '🦄', '🐙', '🦉', '🐺', '👑', '😎', '🤠', '🧙', '🥷', '🚀'];
  const need = (n) => 50 * n * (n - 1); // XP totale pour atteindre le niveau n (niveau 2 : 100, 10 : 4 500, 20 : 19 000)
  function levelOf(xp) { let n = 1; while (need(n + 1) <= xp) n++; return n; }
  function title(lv) {
    return lv >= 35 ? 'Légende' : lv >= 20 ? 'High Roller' : lv >= 10 ? 'Joueur confirmé' : lv >= 5 ? 'Habitué' : 'Débutant';
  }
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

  const TIME_PACKS = [
    // plus l'attente est longue, plus chaque minute rapporte : enchaîner les petites pauses n'est jamais plus rentable
    { id: 'cafe', icon: '☕', name: 'Pause café', minutes: 5, amount: 100 },       // 20 €/min
    { id: 'repas', icon: '🍔', name: 'Pause repas', minutes: 30, amount: 1000 },   // 33 €/min
    { id: 'soiree', icon: '🌙', name: 'Soirée', minutes: 120, amount: 4500 },      // 37,5 €/min
    { id: 'nuit', icon: '🛌', name: 'Nuit complète', minutes: 480, amount: 20000 }, // 41,7 €/min
  ];

  const START_WALLET = 10000;
  const GAMES = { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette', slots: 'Machine à sous' };
  const pad = (n) => String(n).padStart(2, '0');
  // Date du jour (et de la veille) à l'heure de Paris : les défis et le bonus changent à minuit
  function dayOf(ms) {
    try {
      const p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
      return p.slice(0, 10);
    } catch (e) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  }
  const today = (now) => dayOf(now);
  const yesterday = (now) => dayOf(now - 86400000);

  function fresh(now) {
    return {
      pseudo: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], wallet: START_WALLET, xp: 0,
      totals: { hands: 0, wins: 0, bjHands: 0, bjBlackjacks: 0, pkHands: 0, rlSpins: 0, slSpins: 0, biggestWin: 0, challenges: 0 },
      achievements: {}, daily: null, bonus: { last: null, streak: 0 }, sessions: {}, timebank: null, prizes: {}, createdAt: now || Date.now(),
    };
  }
  function normalize(P, now) {
    const f = fresh(now);
    P = Object.assign(f, P || {});
    P.totals = Object.assign(fresh(now).totals, P.totals || {});
    P.achievements = P.achievements || {};
    P.sessions = P.sessions || {};
    P.prizes = P.prizes || {};
    P.bonus = P.bonus || { last: null, streak: 0 };
    return P;
  }

  function addXP(P, n, N) {
    const before = levelOf(P.xp);
    P.xp += Math.round(n);
    const after = levelOf(P.xp);
    if (after > before) {
      const unlocked = FELTS.concat(BACKS).filter((c) => c.level > before && c.level <= after).map((c) => c.name);
      N.push({ kind: 'level', title: 'Niveau ' + after + ' !', text: title(after) + (unlocked.length ? ' — débloqué : ' + unlocked.join(', ') : ''), icon: '⬆️' });
      if (after >= 10) unlock(P, 'lvl10', N);
      if (after >= 20) unlock(P, 'lvl20', N);
    }
  }
  function unlock(P, id, N) {
    if (P.achievements[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    P.achievements[id] = Date.now();
    N.push({ kind: 'achievement', title: 'Succès débloqué : ' + a.name, text: a.text + ' (+100 XP)', icon: a.icon });
    addXP(P, 100, N);
  }
  function checkWallet(P, N) {
    if (P.wallet >= 25000) unlock(P, 'rich25', N);
    if (P.wallet >= 100000) unlock(P, 'rich100', N);
  }

  // Les 3 défis du jour (choisis selon la date ; 3 jeux sur 4, qui tournent)
  function ensureDaily(P, now) {
    const d = today(now);
    if (P.daily && P.daily.date === d) return P.daily;
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (game) => { const list = CHALLENGES.filter((c) => c.game === game); return list[h % list.length]; };
    const all = ['Blackjack', 'Poker', 'Roulette', 'Machine à sous'];
    const games = all.filter((g, i) => i !== (h >>> 3) % all.length);
    const ids = games.map((g) => pick(g).id);
    if (h % 3 === 0) ids[h % 3] = 'any_win1000';
    P.daily = { date: d, list: ids.map((id) => ({ id, progress: 0, done: false, claimed: false })) };
    return P.daily;
  }

  /**
   * Événements de jeu (parties réelles uniquement) :
   *  bj { net, bet, blackjack, doubledWin } · pk { won, net, cat, allinWon } · pk-tourney { place, players }
   *  rl { staked, net, pleinHit, zeroWin } · rl-cashout { diff } · sl { bet, net, jackpot, freeTrigger } · multi { game }
   */
  function track(P, type, d, now, N) {
    d = d || {};
    const T = P.totals;
    const isRound = ['bj', 'pk', 'rl', 'sl'].includes(type);
    if (isRound) {
      T.hands++;
      addXP(P, 5, N);
      if (d.net > 0) {
        T.wins++;
        addXP(P, Math.min(40, 3 + d.net / 25), N);
        unlock(P, 'first_win', N);
        if (d.net > T.biggestWin) T.biggestWin = d.net;
      }
    }
    if (type === 'bj') {
      T.bjHands++;
      if (d.blackjack) { T.bjBlackjacks++; unlock(P, 'bj_first', N); if (T.bjBlackjacks >= 10) unlock(P, 'bj_10', N); }
      if (T.bjHands >= 100) unlock(P, 'bj_100', N);
    }
    if (type === 'pk') {
      T.pkHands++;
      if (d.won && d.cat === 7) unlock(P, 'pk_quads', N);
      if (d.won && d.cat === 8) unlock(P, 'pk_sflush', N);
      if (d.allinWon) unlock(P, 'pk_allin', N);
    }
    if (type === 'pk-tourney') { addXP(P, d.place === 1 ? 150 : 40, N); if (d.place === 1) unlock(P, 'pk_champion', N); }
    if (type === 'rl') { T.rlSpins++; if (d.pleinHit) unlock(P, 'rl_plein', N); if (d.zeroWin) unlock(P, 'rl_zero', N); }
    if (type === 'rl-cashout' && d.diff >= 1000) unlock(P, 'rl_cashout', N);
    if (type === 'sl') { T.slSpins++; if (d.jackpot) unlock(P, 'jackpot', N); }
    if (type === 'multi') { unlock(P, 'friends', N); addXP(P, 20, N); }
    if (isRound && d.bet > 0 && d.net >= d.bet * 9) unlock(P, 'big_win', N);
    const daily = ensureDaily(P, now);
    daily.list.forEach((c) => {
      if (c.done) return;
      const def = CHALLENGES.find((x) => x.id === c.id);
      const inc = def ? def.on(type, d) : 0;
      if (!inc) return;
      c.progress = Math.min(def.target, c.progress + inc);
      if (c.progress >= def.target) {
        c.done = true;
        N.push({ kind: 'challenge', title: 'Défi du jour réussi !', text: def.text + ' — récupère ta récompense sur l\'accueil', icon: '✅' });
      }
    });
    checkWallet(P, N);
  }

  // Bonus quotidien : 500 €, +250 € par jour consécutif (jusqu'à 2 000 €)
  function bonusInfo(P, now) {
    if (P.bonus.last === today(now)) return { available: false, streak: P.bonus.streak };
    const streak = P.bonus.last === yesterday(now) ? P.bonus.streak + 1 : 1;
    return { available: true, streak, amount: Math.min(2000, 500 + 250 * (streak - 1)) };
  }
  function claimBonus(P, now, N) {
    const b = bonusInfo(P, now);
    if (!b.available) return 0;
    P.bonus = { last: today(now), streak: b.streak };
    P.wallet += b.amount;
    addXP(P, 30, N);
    if (b.streak >= 7) unlock(P, 'daily7', N);
    checkWallet(P, N);
    return b.amount;
  }
  function claimChallenge(P, id, now, N) {
    const daily = ensureDaily(P, now);
    const c = daily.list.find((x) => x.id === id);
    const def = CHALLENGES.find((x) => x.id === id);
    if (!c || !c.done || c.claimed || !def) return 0;
    c.claimed = true;
    P.wallet += def.reward;
    P.totals.challenges++;
    addXP(P, def.xp, N);
    if (P.totals.challenges >= 10) unlock(P, 'challenges10', N);
    checkWallet(P, N);
    return def.reward;
  }

  // Banque du temps
  function timeInfo(P, now) {
    const t = P.timebank;
    if (!t) return null;
    const pack = TIME_PACKS.find((x) => x.id === t.pack);
    if (!pack) return null;
    return { pack, start: t.start, end: t.end, left: Math.max(0, t.end - now), ready: now >= t.end };
  }
  function startTime(P, id, now) {
    const pack = TIME_PACKS.find((x) => x.id === id);
    if (!pack || P.timebank) return false;
    P.timebank = { pack: id, start: now, end: now + pack.minutes * 60000 };
    return true;
  }
  function claimTime(P, now, N) {
    const t = timeInfo(P, now);
    if (!t || !t.ready) return 0;
    P.timebank = null;
    P.wallet += t.pack.amount;
    checkWallet(P, N);
    return t.pack.amount;
  }

  // Parties réelles : on apporte une somme de la banque, on encaisse quand on veut
  function startSession(P, game, amount, now) {
    amount = Math.floor(amount);
    if (!GAMES[game]) return null;
    if (P.sessions[game]) return P.sessions[game];
    if (!(amount > 0) || amount > P.wallet) return null;
    P.wallet -= amount;
    P.sessions[game] = { stack: amount, start: amount, at: now };
    return P.sessions[game];
  }
  function cashOut(P, game, N) {
    const ss = P.sessions[game];
    if (!ss) return null;
    delete P.sessions[game];
    P.wallet += ss.stack;
    const diff = Math.round((ss.stack - ss.start) * 100) / 100;
    if (diff > 0) { P.totals.cashouts = (P.totals.cashouts || 0) + 1; addXP(P, Math.min(80, 10 + diff / 50), N); }
    checkWallet(P, N);
    return { start: ss.start, end: ss.stack, diff };
  }

  // Entre amis : 1er +500 €, 2e +200 € ; à deux joueurs, le gagnant +300 €
  function prizeFor(place, players) {
    if (players >= 3) return place === 1 ? 500 : place === 2 ? 200 : 0;
    if (players === 2) return place === 1 ? 300 : 0;
    return 0;
  }
  function prizeText(players) {
    return players >= 3 ? '1er : +500 €, 2e : +200 € sur ta banque' : players === 2 ? 'Le gagnant : +300 € sur sa banque' : 'Il faut au moins 2 joueurs pour gagner un prix';
  }
  function applyPrize(P, key, place, players, now, N) {
    if (P.prizes[key]) return 0;
    const v = prizeFor(place, players);
    P.prizes[key] = now;
    const keys = Object.keys(P.prizes).sort((a, b) => P.prizes[a] - P.prizes[b]);
    while (keys.length > 60) delete P.prizes[keys.shift()];
    unlock(P, 'friends', N);
    if (v > 0) {
      P.wallet += v;
      P.totals.multiWins = (P.totals.multiWins || 0) + (place === 1 ? 1 : 0);
      addXP(P, place === 1 ? 120 : 50, N);
      checkWallet(P, N);
    } else addXP(P, 20, N);
    return v;
  }

  // Profil public (classement entre amis)
  function publicProfile(P, code) {
    return {
      pseudo: P.pseudo || 'Joueur', avatar: P.avatar, xp: P.xp, level: levelOf(P.xp), wallet: Math.round(P.wallet),
      biggestWin: Math.round(P.totals.biggestWin || 0), hands: P.totals.hands, achievements: Object.keys(P.achievements).length,
      code: code || null, updatedAt: Date.now(),
    };
  }

  const api = {
    AVATARS, FELTS, BACKS, CHALLENGES, ACHIEVEMENTS, TIME_PACKS, START_WALLET, GAMES,
    need, levelOf, title, today, fresh, normalize, addXP, unlock, checkWallet, ensureDaily, track,
    bonusInfo, claimBonus, claimChallenge, timeInfo, startTime, claimTime, startSession, cashOut,
    prizeFor, prizeText, applyPrize, publicProfile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CasinoRules = api;
})(typeof window !== 'undefined' ? window : this);
