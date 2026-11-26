/*
 * Mode « Entre amis » : une table partagée en ligne (5 places).
 * Chaque joueur choisit une ou plusieurs places, mise (avec paris annexes) et joue à son tour.
 * L'état de la table est un document partagé ; chaque action est appliquée en
 * « transaction » (net.js) pour que deux joueurs ne s'écrasent pas.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DECKS = 6;
  const SEATS = 5;
  const START_BANKROLL = 1000;
  const CARD_MS = 700;        // temps d'animation compté par carte distribuée, ajouté aux minuteurs
  const L = Strategy.ACTION_LABELS;

  let net = null;           // couche réseau (voir net.js)
  let me = null;            // id du joueur
  let canWrite = true;
  const names = {};         // id -> nom affiché (profils claude.ai)

  let tableId = null;
  let state = null;         // dernier état reçu
  let unsubTable = null, unsubChat = null, unsubLobby = null;
  let working = false;      // une action est en cours d'envoi
  let stopPresence = null;  // arrête le signal de présence à la table

  // ----- Animation : les cartes reçues sont révélées une par une -----
  const ctx = { shown: new Map(), counter: HiLo.create(), cardsLeft: () => (state ? state.shoe.length : DECKS * 52), enhc: () => !!(state && state.settings.noHole) };
  const revealed = new Set();
  let holeFlipped = false;
  let shownRound = -1;
  let queue = [];
  let ticking = false;
  let firstSnap = true;
  let hintKey = null;

  const value = (cards) => Strategy.handValue(cards);
  const isBJ = (cards) => cards.length === 2 && value(cards).total === 21;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function delay() {
    const v = parseFloat($('opt-speed').value) || 1;
    return 650 / v;
  }

  // ================= Logique de jeu (fonctions pures sur l'état) =================
  function newShoe() {
    const s = [];
    for (let d = 0; d < DECKS; d++) for (const su of SUITS) for (const r of RANKS) s.push(r + su);
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s;
  }
  function draw(st) {
    if (!st.shoe.length) { st.shoe = newShoe(); st.rcBase = 0; st.shuffles++; }
    const raw = st.shoe.pop();
    st.cardSeq++;
    return { rank: raw.slice(0, -1), suit: raw.slice(-1), id: st.cardSeq };
  }
  function emptySeat() { return { owner: null, bet: 0, pp: 0, t213: 0, hands: [], side: '' }; }

  // Réglages choisis par l'hôte à la création de la table
  // Une manche est en cours (assurance ou jeu) : mises et places figées
  const inPlay = (st) => st.phase === 'playing' || st.phase === 'insurance';
  // La carte cachée du croupier reste face cachée pendant l'assurance et le jeu
  const holeHidden = inPlay;
  function defaultSettings() { return { coach: true, sides: true, bankroll: START_BANKROLL, turnTime: 20, betTime: 15, noHole: true, hands: 20 }; }
  const now = () => Date.now();
  // Démarre le minuteur des mises s'il ne tourne pas déjà
  function armBetTimer(st, extraMs) {
    if (st.phase === 'playing' || st.phase === 'insurance') return;
    if (!st.betDeadline || extraMs) st.betDeadline = now() + st.settings.betTime * 1000 + (extraMs || 0);
  }
  const startMoney = (st) => (st.settings && st.settings.bankroll) || START_BANKROLL;

  function initialState(name, settings) {
    const seats = [];
    for (let i = 0; i < SEATS; i++) seats.push(emptySeat());
    return {
      name, creator: me, createdAt: Date.now(), updatedAt: Date.now(),
      phase: 'betting', shoe: newShoe(), cardSeq: 0, rcBase: 0, shuffles: 0, started: false,
      seats, dealer: [], turn: null, turnAt: 0, players: {}, round: 0,
      settings: Object.assign(defaultSettings(), settings || {}),
      msg: 'Choisissez vos places et vos mises.',
    };
  }

  // Firebase supprime les listes vides : on remet la structure attendue
  function normalize(st) {
    st.shoe = st.shoe || [];
    st.dealer = st.dealer || [];
    st.players = st.players || {};
    st.seats = st.seats || [];
    for (let i = 0; i < SEATS; i++) {
      const s = st.seats[i] || emptySeat();
      s.owner = s.owner || null;
      s.hands = (s.hands || []).map((h) => Object.assign(h, { cards: h.cards || [] }));
      s.side = s.side || '';
      st.seats[i] = s;
    }
    st.turn = st.turn || null;
    st.settings = Object.assign(defaultSettings(), st.settings || {});
    return st;
  }

  // Pseudo choisi par le joueur (app indépendante, sans compte)
  function myName() {
    try { return (localStorage.getItem('bj-pseudo') || (window.Casino && Casino.profile.pseudo) || '').trim().slice(0, 16); } catch (e) { return ''; }
  }

  function player(st, uid) {
    if (!st.players[uid]) st.players[uid] = { bankroll: startMoney(st) };
    return st.players[uid];
  }

  function seatHasHands(seat) { return seat.hands && seat.hands.length > 0; }

  function opSit(st, i) {
    const seat = st.seats[i];
    if (seat.owner || st.gameEnd) return false;
    const p = player(st, me);
    if (p.out) return false; // éliminé : il regarde la fin de la partie
    if (myName()) p.name = myName();
    st.seats[i] = emptySeat();
    st.seats[i].owner = me;
    st.seats[i].bet = 10;
    armBetTimer(st);
  }
  function opLeave(st, i) {
    const seat = st.seats[i];
    if (seat.owner !== me) return false;
    if (inPlay(st) && seatHasHands(seat)) return false;
    st.seats[i] = emptySeat();
  }
  function opBet(st, i, field, amount) {
    const seat = st.seats[i];
    if (seat.owner !== me || inPlay(st)) return false;
    // limites de la table : 5 € minimum, 250 € maximum par place
    if (field === 'bet') seat.bet = amount === 0 ? 0 : Math.min(250, seat.bet + amount);
    else if (st.settings.sides) seat[field] = amount;
    else return false;
    seat.ready = false;
    if (seat.bet > 0) armBetTimer(st);
  }

  // « Je mise » : mes places sont prêtes ; quand tous les joueurs ont misé, la donne part tout de suite
  function opReady(st) {
    if (st.phase === 'playing' || st.phase === 'insurance') return false;
    let mine = 0;
    st.seats.forEach((s) => { if (s.owner === me && s.bet > 0) { s.ready = true; mine++; } });
    if (!mine) return false;
    armBetTimer(st);
    const betting = st.seats.filter((s) => s.owner && s.bet > 0);
    if (betting.every((s) => s.ready)) opDeal(st);
  }

  // Fin du minuteur des mises : la donne part avec ceux qui ont une mise
  function opAutoDeal(st) {
    if (st.phase === 'playing' || st.phase === 'insurance' || !st.betDeadline || now() < st.betDeadline - 300) return false;
    if (opDeal(st) === false) st.betDeadline = null; // personne n'a misé : on attend
  }

  function tagSum(cards) { return cards.reduce((a, c) => a + HiLo.tag(c.rank), 0); }

  function opDeal(st) {
    if (inPlay(st) || st.gameEnd || st.started === false) return false; // salle d'attente : l'hôte n'a pas lancé
    // Les cartes de la main précédente passent dans la défausse (et dans le compte)
    let used = tagSum(st.dealer);
    st.seats.forEach((s) => s.hands.forEach((h) => { used += tagSum(h.cards); }));
    st.rcBase += used;
    if (st.shoe.length < DECKS * 52 * 0.25) {
      st.shoe = newShoe(); st.rcBase = 0; st.shuffles++;
      st.note = 'Le sabot a été mélangé : le compte repart de zéro.';
    } else st.note = '';

    const active = [];
    st.seats.forEach((s, i) => {
      s.hands = []; s.side = ''; s.ready = false; s.ins = 0; s.insDecided = false;
      if (!s.owner || s.bet <= 0) return;
      const p = player(st, s.owner);
      if (p.out) return;
      if (!st.settings.sides) { s.pp = 0; s.t213 = 0; }
      const total = s.bet + (s.pp || 0) + (s.t213 || 0);
      if (p.bankroll < total) return;
      p.bankroll -= total;
      p.played = true;
      s.hands = [{ cards: [], bet: s.bet, done: false }];
      active.push(i);
    });
    if (!active.length) return false;

    st.dealer = [];
    st.round++;
    for (let r = 0; r < 2; r++) {
      active.forEach((i) => st.seats[i].hands[0].cards.push(draw(st)));
      // Règle européenne : une seule carte pour le croupier, la 2e viendra après les joueurs
      if (r === 0 || !st.settings.noHole) st.dealer.push(draw(st));
    }
    // Paris annexes
    const up = st.dealer[0];
    active.forEach((i) => {
      const s = st.seats[i];
      const c = s.hands[0].cards;
      const p = player(st, s.owner);
      const parts = [];
      const one = (amount, res, label) => {
        if (!amount) return;
        if (res) { p.bankroll += amount * (res.mult + 1); parts.push('✔ ' + label + ' : ' + res.name + ' +' + amount * res.mult + ' €'); }
        else parts.push('✘ ' + label + ' −' + amount + ' €');
      };
      one(s.pp, SideBets.perfectPairs(c[0], c[1]), 'Paire parfaite');
      one(s.t213, SideBets.twentyOnePlusThree(c[0], c[1], up), '21+3');
      s.side = parts.join(' · ');
    });

    st.betDeadline = null;
    st.msg = '';
    const dealtMs = (active.length + 1) * 2 * CARD_MS;
    if (up.rank === 'A') {
      // Le croupier montre un As : chacun décide de prendre l'assurance avant la vérification
      st.phase = 'insurance';
      st.insDeadline = now() + dealtMs + 10000;
      return;
    }
    afterPeek(st, dealtMs);
  }

  function opInsurance(st, take) {
    if (st.phase !== 'insurance') return false;
    let any = false;
    st.seats.forEach((s) => {
      if (s.owner !== me || !s.hands.length || s.insDecided) return;
      const p = player(st, s.owner);
      const cost = Math.floor(s.hands[0].bet / 2);
      if (take && cost > 0 && p.bankroll >= cost) { p.bankroll -= cost; s.ins = cost; }
      s.insDecided = true; any = true;
    });
    if (!any) return false;
    if (st.seats.every((s) => !s.hands.length || s.insDecided)) resolveInsurance(st);
  }
  function opInsuranceTimeout(st) {
    if (st.phase !== 'insurance' || now() < st.insDeadline - 300) return false;
    resolveInsurance(st);
  }
  function resolveInsurance(st) {
    const dBJ = isBJ(st.dealer);
    st.seats.forEach((s) => {
      s.insDecided = true;
      if (!s.ins || st.settings.noHole) return; // règle européenne : réglée à la fin, avec la 2e carte du croupier
      const p = player(st, s.owner);
      if (dBJ) { p.bankroll += s.ins * 3; s.side = (s.side ? s.side + ' · ' : '') + '✔ Assurance +' + s.ins * 2 + ' €'; }
      else s.side = (s.side ? s.side + ' · ' : '') + '✘ Assurance −' + s.ins + ' €';
    });
    afterPeek(st, 0);
  }

  // Vérification du blackjack du croupier, puis début du jeu
  function afterPeek(st, extraMs) {
    st.phase = 'playing';
    const upV = Strategy.cardValue(st.dealer[0].rank);
    if (!st.settings.noHole && upV >= 10 && isBJ(st.dealer)) {
      st.msg = 'Le croupier a un blackjack.';
      return finish(st);
    }
    const active = [];
    st.seats.forEach((s, i) => { if (s.hands.length) active.push(i); });
    active.forEach((i) => { const h = st.seats[i].hands[0]; if (isBJ(h.cards)) { h.done = true; h.natural = true; } });
    st.turn = { seat: active[0], hand: 0 };
    advance(st, extraMs);
  }

  function advance(st, extraMs) {
    let { seat, hand } = st.turn;
    let drawn = 0;
    while (seat < SEATS) {
      const s = st.seats[seat];
      while (s.hands && hand < s.hands.length) {
        const h = s.hands[hand];
        if (!h.done && h.cards.length === 1) {
          h.cards.push(draw(st)); drawn++;
          if (h.splitAces) h.done = true;
        }
        if (!h.done && value(h.cards).total >= 21) h.done = true;
        if (!h.done) {
          st.turn = { seat, hand };
          st.turnAt = now();
          st.turnDeadline = now() + st.settings.turnTime * 1000 + (extraMs || 0) + drawn * CARD_MS;
          st.msg = '';
          return;
        }
        hand++;
      }
      seat++; hand = 0;
    }
    st.turn = null;
    dealerPlay(st);
  }

  function dealerPlay(st) {
    const live = [];
    st.seats.forEach((s) => s.hands.forEach((h) => { if (value(h.cards).total <= 21 && !h.surrendered) live.push(h); }));
    const playing = live.filter((h) => !h.natural);
    if (st.settings.noHole && live.length) st.dealer.push(draw(st)); // 2e carte du croupier
    if (playing.length && !isBJ(st.dealer)) {
      while (value(st.dealer).total < 17) st.dealer.push(draw(st));
    }
    finish(st);
  }

  function finish(st) {
    st.phase = 'over';
    st.turn = null;
    // Minuteur des mises de la manche suivante (après l'animation du croupier)
    st.betDeadline = now() + st.settings.betTime * 1000 + (st.dealer.length + 2) * CARD_MS + 2500;
    st.seats.forEach((s) => { s.ready = false; });
    const d = value(st.dealer).total;
    const dBJ = isBJ(st.dealer);
    st.seats.forEach((s) => {
      if (!s.owner || !s.hands.length) return;
      const p = player(st, s.owner);
      if (st.settings.noHole && s.ins) { // assurance (règle européenne) : réglée maintenant
        if (dBJ) { p.bankroll += s.ins * 3; s.side = (s.side ? s.side + ' · ' : '') + '✔ Assurance +' + s.ins * 2 + ' €'; }
        else s.side = (s.side ? s.side + ' · ' : '') + '✘ Assurance −' + s.ins + ' €';
      }
      const single = s.hands.length === 1;
      s.hands.forEach((h) => {
        const v = value(h.cards).total;
        const pBJ = single && !h.split && isBJ(h.cards);
        let back = 0, txt, cls;
        if (h.surrendered) { back = h.bet / 2; txt = 'Abandon −' + h.bet / 2 + ' €'; cls = 'lose'; }
        else if (pBJ && dBJ) { back = h.bet; txt = 'Égalité'; cls = 'push'; }
        else if (pBJ) { back = h.bet * 2.5; txt = 'Blackjack ! +' + h.bet * 1.5 + ' €'; cls = 'win'; }
        else if (dBJ) { txt = 'Blackjack du croupier'; cls = 'lose'; }
        else if (v > 21) { txt = 'Sauté'; cls = 'lose'; }
        else if (d > 21 || v > d) { back = h.bet * 2; txt = 'Gagné +' + h.bet + ' €'; cls = 'win'; }
        else if (v === d) { back = h.bet; txt = 'Égalité'; cls = 'push'; }
        else { txt = 'Perdu'; cls = 'lose'; }
        p.bankroll += back;
        h.result = txt; h.resultClass = cls;
      });
    });
    // Pas de recave : sous la mise minimale, le joueur est éliminé
    Object.keys(st.players).forEach((uid) => {
      const p = st.players[uid];
      if (p.played && !p.out && p.bankroll < 5) { p.out = true; p.outRound = st.round; st.seats.forEach((s) => { if (s.owner === uid) s.bet = 0; }); }
    });
    checkGameEnd(st);
    if (!st.msg) st.msg = d > 21 ? 'Le croupier saute avec ' + d + ' !' : 'Le croupier a ' + (dBJ ? 'un blackjack' : d) + '.';
  }

  // Fin de la partie : nombre de mains atteint, ou un seul joueur encore en jeu
  function checkGameEnd(st) {
    const parts = Object.keys(st.players).filter((u) => st.players[u].played);
    const alive = parts.filter((u) => !st.players[u].out);
    const limit = st.settings.hands && st.round >= st.settings.hands;
    if (!parts.length || !(limit || !alive.length || (parts.length >= 2 && alive.length === 1))) return;
    const rows = parts.map((u) => ({ uid: u, name: st.players[u].name || 'Joueur', bankroll: st.players[u].bankroll, out: !!st.players[u].out, outRound: st.players[u].outRound || 0 }));
    rows.sort((a, b) => (a.out - b.out) || (a.out ? b.outRound - a.outRound : b.bankroll - a.bankroll));
    st.gameEnd = { at: now(), rows };
    st.betDeadline = null;
  }
  function opRestart(st) {
    if (!st.gameEnd || inPlay(st)) return false;
    Object.values(st.players).forEach((p) => { p.bankroll = startMoney(st); p.out = false; p.played = false; p.outRound = 0; });
    st.gameEnd = null; st.round = 0; st.msg = 'Nouvelle partie ! Choisissez vos places et vos mises.';
    st.seats.forEach((s) => { s.hands = []; s.side = ''; if (s.owner) s.bet = 10; });
    st.dealer = [];
  }

  function opAct(st, action, force) {
    if (st.phase !== 'playing' || !st.turn) return false;
    const s = st.seats[st.turn.seat];
    if (!force && s.owner !== me) return false;
    if (force && now() < (st.turnDeadline || 0) - 300) return false; // le temps n'est pas écoulé
    const h = s.hands[st.turn.hand];
    const p = player(st, s.owner);
    const two = h.cards.length === 2;
    if (action === 'H') {
      h.cards.push(draw(st));
      if (value(h.cards).total >= 21) h.done = true;
    } else if (action === 'S') {
      h.done = true;
    } else if (action === 'D') {
      if (!two || p.bankroll < h.bet) return false;
      p.bankroll -= h.bet; h.bet *= 2; h.doubled = true;
      h.cards.push(draw(st)); h.done = true;
    } else if (action === 'R') {
      if (!two || s.hands.length > 1 || h.split || st.settings.noHole) return false;
      h.surrendered = true; h.done = true;
    } else if (action === 'P') {
      if (!two || p.bankroll < h.bet || s.hands.length >= 4 ||
        Strategy.cardValue(h.cards[0].rank) !== Strategy.cardValue(h.cards[1].rank)) return false;
      p.bankroll -= h.bet;
      const aces = h.cards[0].rank === 'A';
      const second = { cards: [h.cards.pop()], bet: h.bet, done: false, split: true, splitAces: aces };
      h.split = true; h.splitAces = aces;
      s.hands.splice(st.turn.hand + 1, 0, second);
    } else return false;
    advance(st, action === 'S' || action === 'R' ? 0 : CARD_MS);
  }

  function availableFor(st) {
    if (!st || st.phase !== 'playing' || !st.turn) return null;
    const s = st.seats[st.turn.seat];
    const h = s.hands[st.turn.hand];
    const p = st.players[s.owner] || { bankroll: 0 };
    const two = h.cards.length === 2;
    return {
      H: true, S: true,
      D: two && p.bankroll >= h.bet,
      P: two && p.bankroll >= h.bet && s.hands.length < 4 &&
        Strategy.cardValue(h.cards[0].rank) === Strategy.cardValue(h.cards[1].rank),
      R: two && s.hands.length === 1 && !h.split && !st.settings.noHole,
    };
  }

  // ================= Écriture partagée =================
  async function mutate(fn) {
    if (!net || !tableId || !canWrite) return false;
    working = true;
    renderControls();
    try {
      return await net.transact(tableId, fn);
    } catch (e) {
      const code = e && e.code;
      if (code === 'invalid_argument' || code === 'PERMISSION_DENIED') {
        canWrite = false;
        toast('Tu peux regarder cette table, mais pas y jouer : demande au propriétaire du jeu de t\'inviter comme éditeur.');
      } else if (code === 'busy') toast('La table est occupée, réessaie.');
      else if (code === 'gone') toast('Cette table n\'existe plus.');
      else toast('Action non envoyée. Vérifie ta connexion et réessaie.');
      return false;
    } finally {
      working = false;
      if (state) renderAll(); else renderControls();
    }
  }

  // Classement final + prix versé sur la banque du Casino (une seule fois par partie)
  let shownEnd = null;
  let lastTurnKey = null;
  function showGameEnd(st) {
    if (!st.gameEnd || shownEnd === st.gameEnd.at || animating()) return;
    shownEnd = st.gameEnd.at;
    const rows = st.gameEnd.rows || [];
    const place = rows.findIndex((r) => r.uid === me) + 1;
    let prize = 0;
    if (place && window.Casino) { prize = Casino.prizeFor(place, rows.length); Casino.multiPrize('bj:' + tableId + ':' + st.gameEnd.at, place, rows.length, { game: 'blackjack', table: tableId }); }
    const fn = () => window.Casino && Casino.showRanking({
      title: place === 1 ? 'Tu gagnes la partie !' : (rows[0] ? rows[0].name + ' gagne la partie !' : 'Partie terminée'),
      subtitle: (place ? 'Tu termines ' + (place === 1 ? '1er' : place + 'e') + '. ' : '') + (prize ? '+' + prize + ' € sur ta banque du Casino.' : 'Les jetons de la table restent sur la table.'),
      rows: rows.map((r) => ({ name: r.name + (r.out ? ' (éliminé)' : ''), value: r.bankroll + ' €', me: r.uid === me })),
      againLabel: 'Nouvelle partie', onAgain: () => mutate(opRestart),
    });
    setTimeout(fn, 1200);
  }

  function toast(text) {
    const m = $('m-message');
    m.textContent = text;
    m.classList.add('flash');
    setTimeout(() => m.classList.remove('flash'), 1600);
  }

  // ================= Réception et animation =================

  function onTable(raw) {
    setTimeout(befriend, 0);
    if (!raw) { state = null; showLobby('Cette table n\'existe pas ou a été supprimée.'); return; }
    const st = normalize(JSON.parse(JSON.stringify(raw)));
    state = st;
    if (firstSnap) BJ.setCountCtx(ctx); // le tableau de stratégie suit la règle de la table
    if (st.round !== shownRound) { holeFlipped = !!st.settings.noHole; ctx.counter.reset(st.rcBase); }
    const all = [];
    st.dealer.forEach((c, i) => all.push({ c, dealerIdx: i }));
    st.seats.forEach((s) => s.hands.forEach((h) => h.cards.forEach((c) => all.push({ c }))));
    if (firstSnap) {
      all.forEach((x) => revealed.add(x.c.id));
      holeFlipped = !holeHidden(st) || st.settings.noHole;
      firstSnap = false;
      shownRound = st.round;
      queue = [];
      renderAll();
      return;
    }
    shownRound = st.round;
    const queued = new Set(queue.filter((e) => e.card).map((e) => e.card.id));
    const fresh = all.filter((x) => !revealed.has(x.c.id) && !queued.has(x.c.id)).sort((a, b) => a.c.id - b.c.id);
    const needFlip = !holeHidden(st) && st.dealer.length >= 2 && !holeFlipped && !queue.some((e) => e.flip);
    let flipInserted = false;
    fresh.forEach((x) => {
      if (needFlip && !flipInserted && x.dealerIdx != null && x.dealerIdx >= 2) { queue.push({ flip: true }); flipInserted = true; }
      queue.push({ card: x.c });
    });
    if (needFlip && !flipInserted) queue.push({ flip: true });
    renderAll();
    tick();
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    while (queue.length) {
      const ev = queue.shift();
      if (ev.flip) holeFlipped = true; else revealed.add(ev.card.id);
      renderAll();
      await sleep(ev.flip ? delay() * 1.4 : delay());
    }
    ticking = false;
    renderAll();
  }

  const animating = () => queue.length > 0 || ticking;

  // ================= Rendu =================
  function nameOf(uid) {
    if (!uid) return '';
    if (uid === me) return 'Toi';
    const p = state && state.players[uid];
    return (p && p.name) || names[uid] || 'Joueur';
  }
  const asked = new Set();
  async function resolveNames(extra) {
    if (!net || net.kind !== 'claude' || !state) return;
    const ids = new Set();
    state.seats.forEach((s) => s.owner && s.owner !== me && !names[s.owner] && !asked.has(s.owner) && ids.add(s.owner));
    (extra || []).forEach((u) => { if (u !== me && !names[u] && !asked.has(u)) ids.add(u); });
    if (!ids.size) return;
    ids.forEach((i) => asked.add(i));
    const ps = await net.profiles([...ids]);
    if (Object.keys(ps).length) { Object.assign(names, ps); renderAll(); if (lastChat) renderChat(lastChat); }
  }

  function totalText(cards) {
    if (!cards.length) return '';
    const v = value(cards);
    if (isBJ(cards)) return 'Blackjack';
    return (v.soft && v.total < 21 ? (v.total - 10) + ' / ' : '') + v.total;
  }

  // ----- Aides du coach -----
  function coachChoiceKey() { return 'bj-coach-' + tableId + '-' + me; }
  function coachChoice() {
    try { const v = localStorage.getItem(coachChoiceKey()); return v === null ? null : v === '1'; } catch (e) { return null; }
  }
  function setCoachChoice(on) {
    try { localStorage.setItem(coachChoiceKey(), on ? '1' : '0'); } catch (e) { /* ignore */ }
    applyCoach();
    renderAll();
  }
  function coachOn() {
    return !!(state && state.settings.coach && coachChoice() !== false);
  }
  function applyCoach() {
    const inTable = document.body.dataset.mode === 'multi' && tableId && state;
    document.body.classList.toggle('no-coach', !!(inTable && !coachOn()));
    if (!inTable) return;
    const allowed = state.settings.coach;
    $('m-coach-row').hidden = !allowed;
    $('m-coach-off-note').hidden = allowed;
    $('m-opt-coach').checked = coachOn();
    $('m-sides-off-note').hidden = state.settings.sides;
    // Première arrivée sur la table : on demande au joueur s'il veut les aides
    if (allowed && coachChoice() === null && !$('coach-dialog').open) {
      try { $('coach-dialog').showModal(); } catch (e) { $('coach-dialog').setAttribute('open', ''); }
    }
  }

  // ---------- Liste des parties ouvertes (onglet Multijoueur de l'accueil) ----------
  // Signal envoyé par l'hôte à chaque changement ET toutes les 30 s, même si la table attend sans bouger.
  // Les tables créées avant cette option sont considérées comme publiques.
  let lobbyLastInfo = null;
  function lobbyTick() {
    const st = state;
    if (!st || !tableId || !window.Social || !Social.lobbyBeat) return;
    if (!(st.creator === me && !st.gameEnd)) { if (lobbyLastInfo) { Social.lobbyRemove('blackjack', tableId, lobbyLastInfo); lobbyLastInfo = null; } return; }
    const sets = st.settings || {};
    lobbyLastInfo = { name: st.name, host: myName(), players: new Set(st.seats.map((x) => x.owner).filter(Boolean)).size, max: 5, pub: sets.public !== false, vip: !!sets.vip, lk: sets.lk };
    Social.lobbyBeat('blackjack', tableId, lobbyLastInfo);
  }
  setInterval(lobbyTick, 30000);

  function renderAll() {
    if (!state || !tableId) return;
    const st = state;
    if (window.Social && Social.waitingRoom) {
      const uids = [...new Set([st.creator].concat(Object.keys(st.players || {})))].filter(Boolean);
      Social.waitingRoom({
        container: $('mtable'), started: st.started !== false, me, hostUid: st.creator, minPlayers: 1,
        players: uids.map((u) => ({ uid: u, name: nameOf(u), ready: !!(st.wait && st.wait[u]) })),
        onReady: (on) => mutate((x) => { x.wait = x.wait || {}; x.wait[me] = on; }),
        onStart: () => mutate((x) => { if (x.creator !== me) return false; x.started = true; x.betDeadline = null; x.msg = 'C\'est parti ! Misez.'; }),
      });
    }
    lobbyTick();
    applyCoach();
    const anim = animating();
    $('mtable-name').textContent = st.name || 'Table';
    $('mtable-code').hidden = !net.usesCodes;
    $('mtable-code-value').textContent = tableId;
    $('mtable-shoe').textContent = (st.settings.hands ? 'Main ' + Math.min(st.round, st.settings.hands) + ' / ' + st.settings.hands + ' · ' : '') + 'Sabot : ' + (st.shoe.length / 52).toFixed(1) + ' jeux';
    showGameEnd(st);

    // Croupier
    const dc = $('m-dealer-cards');
    dc.innerHTML = '';
    const dVisible = st.dealer.filter((c) => revealed.has(c.id));
    dVisible.forEach((c, i) => dc.appendChild(BJ.cardEl(c, i === 1 && !holeFlipped, ctx)));
    const shownDealer = holeFlipped ? dVisible : dVisible.slice(0, 1);
    $('m-dealer-total').textContent = shownDealer.length ? totalText(shownDealer) : '';

    // Places : vue personnelle — tes places en grand en bas, les autres en petit au-dessus.
    // Quand c'est au tour d'un ami, sa place s'agrandit.
    const others = $('seats-others'), mine = $('seats-mine');
    others.innerHTML = ''; mine.innerHTML = '';
    const turnSeat = st.phase === 'playing' && st.turn && !anim ? st.turn.seat : -1;
    const playingNow = inPlay(st) || anim;
    st.seats.forEach((s, i) => {
      const own = s.owner === me;
      if (!s.owner && playingNow) return; // places vides cachées pendant la main
      const el = seatEl(st, s, i, anim);
      if (!own && i !== turnSeat) el.classList.add('compact');
      if (!own && i === turnSeat) el.classList.add('spotlight');
      (own ? mine : others).appendChild(el);
    });
    mine.hidden = !mine.children.length;
    // Étape de la main en cours, et qui passe en premier sur téléphone (le joueur dont c'est le tour)
    const hasResults = st.phase === 'over' && st.seats.some((x) => x.hands.some((h) => h.result));
    const step = anim ? (st.phase === 'playing' ? 'play' : 'dealer') : st.phase === 'playing' || st.phase === 'insurance' ? 'play' : hasResults ? 'result' : 'bet';
    document.querySelectorAll('#m-steps li').forEach((li) => {
      const order = ['bet', 'play', 'dealer', 'result'];
      li.className = li.dataset.step === step ? 'on' : order.indexOf(li.dataset.step) < order.indexOf(step) ? 'done' : '';
    });
    const myTurn = turnSeat >= 0 && st.seats[turnSeat].owner === me;
    $('mtable').classList.toggle('others-first', turnSeat >= 0 && !myTurn);

    // Message
    const msg = $('m-message');
    if (!msg.classList.contains('flash')) {
      if (anim) msg.textContent = st.phase === 'playing' && st.turn ? 'Distribution…' : 'Le croupier joue…';
      else if (st.phase === 'playing' && st.turn) {
        const owner = st.seats[st.turn.seat].owner;
        msg.textContent = owner === me ? 'À toi de jouer (place ' + (st.turn.seat + 1) + ') !' : 'Au tour de ' + nameOf(owner) + ' (place ' + (st.turn.seat + 1) + ').';
        // téléphone : à mon tour, la table revient en haut de l'écran (croupier + ma place + boutons)
        const turnKey = st.round + ':' + st.turn.seat + ':' + st.turn.hand;
        if (owner === me && lastTurnKey !== turnKey && window.matchMedia('(max-width: 600px)').matches) $('mtable').scrollIntoView({ block: 'start', behavior: 'smooth' });
        lastTurnKey = turnKey;
      } else if (st.phase === 'insurance') msg.textContent = 'Le croupier montre un As : assurance ?';
      else if (st.gameEnd) msg.textContent = (st.msg || '') + ' Partie terminée !';
      else if (st.players[me] && st.players[me].out) msg.textContent = (st.msg || '') + ' Tu es éliminé : tu regardes la fin de la partie.';
      else if (st.phase === 'over') {
        const mineRes = st.seats.filter((x) => x.owner === me).flatMap((x) => x.hands.map((h) => h.result)).filter(Boolean);
        msg.textContent = (st.msg || 'Main terminée.') + (mineRes.length ? ' Toi : ' + mineRes.join(' / ') + '.' : '') + (st.note ? ' ' + st.note : '') + ' Misez pour la suivante.';
      }
      else msg.textContent = (st.msg || '') + (st.note ? ' ' + st.note : '');
    }

    // Banque du joueur sur cette table
    if (document.body.dataset.mode === 'multi') {
      const p = st.players[me];
      $('bankroll').textContent = p ? p.bankroll : startMoney(st);
    }
    renderControls();
    BJ.renderCount();
    resolveNames();
    maybeHint();
    scheduleTimers();
    roundSounds();
  }

  function seatEl(st, s, i, anim) {
    const el = document.createElement('div');
    const isTurn = st.phase === 'playing' && st.turn && st.turn.seat === i && !anim;
    el.className = 'seat' + (s.owner === me ? ' mine' : '') + (isTurn ? ' turn' : '') + (!s.owner ? ' empty' : '');
    const head = document.createElement('div');
    head.className = 'seat-head';
    const title = document.createElement('span');
    title.textContent = 'Place ' + (i + 1) + (s.owner ? ' · ' + nameOf(s.owner) : '');
    head.appendChild(title);
    if (s.owner) {
      const bank = document.createElement('span');
      bank.className = 'muted small';
      const p = st.players[s.owner];
      bank.textContent = p ? p.bankroll + ' €' : '';
      head.appendChild(bank);
    }
    el.appendChild(head);

    if (!s.owner) {
      const b = document.createElement('button');
      b.textContent = 'S\'asseoir';
      b.disabled = !canWrite || working;
      b.addEventListener('click', () => mutate((x) => opSit(x, i)));
      el.appendChild(b);
      return el;
    }

    // Mains
    s.hands.forEach((h, hi) => {
      const hand = document.createElement('div');
      hand.className = 'hand' + (isTurn && st.turn.hand === hi ? ' active' : '');
      const cards = document.createElement('div');
      cards.className = 'cards small-cards';
      if (s.hands.length > 1) hand.dataset.label = 'Main ' + (hi + 1);
      const vis = h.cards.filter((c) => revealed.has(c.id));
      vis.forEach((c) => cards.appendChild(BJ.cardEl(c, false, ctx)));
      hand.appendChild(cards);
      const info = document.createElement('div');
      info.className = 'hand-info';
      const t = document.createElement('b');
      t.textContent = totalText(vis);
      if (value(vis).total > 21) t.className = 'bust';
      info.append('Total : ', t, ' · ' + h.bet + ' €');
      if (h.result && !anim && st.phase === 'over') {
        const r = document.createElement('span');
        r.className = 'result ' + h.resultClass;
        r.textContent = ' ' + h.result;
        info.appendChild(r);
      }
      hand.appendChild(info);
      el.appendChild(hand);
    });
    if (s.side && !anim) {
      const sd = document.createElement('div');
      sd.className = 'side-result';
      sd.textContent = s.side;
      el.appendChild(sd);
    }

    // Emplacements de mise sur le tapis : seulement pendant les mises (pendant la main, la mise est écrite sous les cartes)
    const betting = s.owner === me && !inPlay(st) && !working;
    const inRound = s.hands.length > 0;
    const shownBet = inRound ? s.hands.reduce((a, h) => a + h.bet, 0) : s.bet;
    // Résultat de la main bien visible sur la place
    if (st.phase === 'over' && !anim && inRound && s.hands.some((h) => h.resultClass)) {
      const cls = s.hands.map((h) => h.resultClass);
      el.classList.add(cls.includes('win') ? 'res-win' : cls.every((c) => c === 'push') ? 'res-push' : 'res-lose');
    }
    if (inPlay(st) || anim || (inRound && st.phase === 'over' && s.owner !== me)) {
      if ((s.pp || s.t213) && !s.side && st.settings.sides) {
        const sd = document.createElement('div'); sd.className = 'side-result';
        sd.textContent = 'Paris annexes : ' + [s.t213 ? '21+3 ' + s.t213 + ' €' : '', s.pp ? 'Paire ' + s.pp + ' €' : ''].filter(Boolean).join(' · ');
        el.appendChild(sd);
      }
      return el;
    }
    el.appendChild(BJ.spotsEl({
      main: shownBet, pp: s.pp || 0, t213: s.t213 || 0,
      sides: st.settings.sides,
      editable: betting,
      compact: s.owner !== me,
      onSide: (f, v) => mutate((x) => opBet(x, i, f, v)),
    }));

    // Mises (place du joueur, hors main en cours)
    if (s.owner === me && !inPlay(st)) {
      const bets = document.createElement('div');
      bets.className = 'seat-bets';
      const line = document.createElement('div');
      line.className = 'row';
      [5, 10, 25, 100].forEach((v) => {
        const b = document.createElement('button');
        b.className = 'mini-chip';
        b.textContent = '+' + v;
        b.disabled = working;
        b.addEventListener('click', () => { if (window.Sfx) Sfx.chips(); mutate((x) => opBet(x, i, 'bet', v)); });
        line.appendChild(b);
      });
      const clr = document.createElement('button');
      clr.className = 'ghost small';
      clr.textContent = '0';
      clr.title = 'Remettre la mise à zéro';
      clr.addEventListener('click', () => mutate((x) => opBet(x, i, 'bet', 0)));
      line.appendChild(clr);
      bets.appendChild(line);
      const leave = document.createElement('button');
      leave.className = 'ghost small';
      leave.textContent = 'Quitter la place';
      leave.addEventListener('click', () => mutate((x) => opLeave(x, i)));
      bets.appendChild(leave);
      el.appendChild(bets);
    }
    return el;
  }

  function renderControls() {
    const box = $('m-controls');
    if (!box || !state) return;
    box.innerHTML = '';
    const st = state;
    const anim = animating();
    if (!canWrite) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Tu regardes la table. Pour jouer, le propriétaire du jeu doit t\'inviter comme éditeur.';
      box.appendChild(p);
      return;
    }
    const btn = (label, cls, onClick, disabled) => {
      const b = document.createElement('button');
      if (cls) b.className = cls;
      b.textContent = label;
      b.disabled = !!disabled || working;
      b.addEventListener('click', onClick);
      box.appendChild(b);
      return b;
    };
    const note = (text) => {
      const p = document.createElement('span');
      p.className = 'muted small';
      p.textContent = text;
      box.appendChild(p);
    };
    const mySeats = st.seats.filter((s) => s.owner === me);

    // Mises : chacun valide sa mise ; la donne part quand tout le monde a misé ou à la fin du minuteur
    if (st.phase === 'over' || st.phase === 'betting' || !st.phase) {
      if (!mySeats.length) { note('Choisis une ou plusieurs places pour jouer.'); return; }
      const betting = mySeats.filter((s) => s.bet > 0);
      if (!betting.length) { note('Ta mise est à 0 : tu ne joueras pas cette manche.'); return; }
      if (betting.every((s) => s.ready)) note('Mise validée ✔ — en attente des autres joueurs…');
      else btn('Miser ' + betting.reduce((a, s) => a + s.bet + (s.pp || 0) + (s.t213 || 0), 0) + ' €', 'primary', () => { BJ.setCountCtx(ctx); if (window.Sfx) Sfx.chips(); mutate(opReady); }, anim);
      return;
    }

    // Assurance
    if (st.phase === 'insurance') {
      if (anim) return;
      const undecided = st.seats.filter((s) => s.owner === me && s.hands.length && !s.insDecided);
      if (!undecided.length) { note(mySeats.some((s) => s.hands.length) ? 'Décision enregistrée, en attente des autres…' : ''); return; }
      const cost = undecided.reduce((a, s) => a + Math.floor(s.hands[0].bet / 2), 0);
      const decide = (take) => mutate((x) => opInsurance(x, take)).then((ok) => { if (ok && coachOn() && BJ.recordInsurance) BJ.recordInsurance(take); });
      btn('Prendre l\'assurance (' + cost + ' €)', '', () => decide(true));
      btn('Non merci', 'primary', () => decide(false));
      if (coachOn() && $('m-opt-hint').checked && BJ.showInsuranceHint) BJ.showInsuranceHint();
      return;
    }

    if (anim || !st.turn) return;
    const s = st.seats[st.turn.seat];
    if (s.owner === me) {
      const opts = availableFor(st);
      ['H', 'S', 'D', 'P', 'R'].forEach((a) => btn(L[a], '', () => myAction(a), !opts[a]));
      if (coachOn()) btn('💡 Conseil', 'ghost', () => showHint(true));
    } else {
      note('En attente de ' + nameOf(s.owner) + '… (rester automatique à la fin du temps)');
    }
  }

  // ================= Minuteurs =================
  // Chaque appareil programme l'expiration ; le premier qui la constate fait l'action (transaction).
  let timers = [];
  function scheduleTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    const st = state;
    if (!st || !canWrite || !tableId) return;
    const at = (deadline, fn, mineFirst) => {
      if (!deadline) return;
      const delay = Math.max(0, deadline - now()) + (mineFirst ? 100 : 1200 + Math.random() * 800);
      timers.push(setTimeout(() => mutate(fn), delay));
    };
    const iPlay = st.seats.some((x) => x.owner === me);
    if ((st.phase === 'over' || st.phase === 'betting' || !st.phase) && st.betDeadline) at(st.betDeadline, opAutoDeal, iPlay);
    else if (st.phase === 'insurance') at(st.insDeadline, opInsuranceTimeout, iPlay);
    else if (st.phase === 'playing' && st.turn && st.turnDeadline) {
      const owner = st.seats[st.turn.seat].owner;
      const key = st.round + ':' + st.turn.seat + ':' + st.turn.hand;
      at(st.turnDeadline, (x) => (x.turn && x.round + ':' + x.turn.seat + ':' + x.turn.hand === key ? opAct(x, 'S', true) : false), owner === me);
    }
  }

  // Barre de temps affichée sous le message
  let lastTickSec = -1;
  setInterval(() => {
    const st = state;
    const box = $('m-timer');
    if (!st || !tableId || document.body.dataset.mode !== 'multi') { box.hidden = true; return; }
    let end = 0, total = 0, label = '', mine = false;
    if ((st.phase === 'over' || st.phase === 'betting' || !st.phase) && st.betDeadline && st.seats.some((x) => x.owner && x.bet > 0)) {
      end = st.betDeadline; total = st.settings.betTime * 1000; label = 'Mises';
      mine = st.seats.some((x) => x.owner === me && x.bet > 0 && !x.ready);
    } else if (st.phase === 'insurance' && !animating()) {
      end = st.insDeadline; total = 10000; label = 'Assurance';
      mine = st.seats.some((x) => x.owner === me && x.hands.length && !x.insDecided);
    } else if (st.phase === 'playing' && st.turn && !animating()) {
      end = st.turnDeadline; total = st.settings.turnTime * 1000;
      const owner = st.seats[st.turn.seat].owner;
      mine = owner === me;
      label = mine ? 'À toi' : nameOf(owner);
    }
    if (!end || animating()) { box.hidden = true; return; }
    const left = Math.max(0, end - now());
    box.hidden = false;
    $('m-timer-bar').style.width = Math.min(100, (left / total) * 100) + '%';
    $('m-timer-bar').classList.toggle('urgent', left < 5000);
    $('m-timer-text').textContent = label + ' : ' + Math.ceil(left / 1000) + ' s';
    const sec = Math.ceil(left / 1000);
    if (mine && left > 0 && left < 5000 && sec !== lastTickSec && window.Sfx) { lastTickSec = sec; Sfx.tick(); }
  }, 250);

  // ================= Sons de fin de manche =================
  let soundedRound = -1;
  function roundSounds() {
    const st = state;
    if (!st || st.phase !== 'over' || animating() || st.round === soundedRound || firstSnap) return;
    soundedRound = st.round;
    if (!window.Sfx) return;
    let net = 0, mineAny = false, anyBJ = false;
    st.seats.forEach((s) => s.hands.forEach((h) => {
      if (/^Blackjack !/.test(h.result || '')) anyBJ = true;
      if (s.owner !== me) return;
      mineAny = true;
      if (h.resultClass === 'win') net += 1; else if (h.resultClass === 'lose') net -= 1;
    }));
    if (anyBJ) Sfx.blackjack();
    else if (mineAny) { if (net > 0) Sfx.win(); else if (net < 0) Sfx.lose(); else Sfx.push(); }
    if (window.Casino && mineAny) {
      let money = 0, bj = false, dbl = false;
      st.seats.forEach((s) => s.hands.forEach((h) => {
        if (s.owner !== me) return;
        if (h.resultClass === 'win') money += /^Blackjack/.test(h.result) ? h.bet * 1.5 : h.bet;
        else if (h.resultClass === 'lose') money -= h.surrendered ? h.bet / 2 : h.bet;
        if (/^Blackjack !/.test(h.result || '')) bj = true;
        if (h.doubled && h.resultClass === 'win') dbl = true;
      }));
      if (!window.__multiTracked) { window.__multiTracked = true; Casino.track('multi', { game: 'blackjack' }); }
      Casino.track('bj', { net: money, blackjack: bj, doubledWin: dbl });
    }
  }

  function currentSituation() {
    const st = state;
    const s = st.seats[st.turn.seat];
    const h = s.hands[st.turn.hand];
    const o = availableFor(st);
    return { cards: h.cards, up: st.dealer[0].rank, opts: BJ.withCount({ canDouble: o.D, canSplit: o.P, canSurrender: o.R }) };
  }

  function showHint(force) {
    if (!state || state.phase !== 'playing' || !state.turn || animating() || !coachOn()) return;
    if (state.seats[state.turn.seat].owner !== me) return;
    const sit = currentSituation();
    const key = state.round + ':' + state.turn.seat + ':' + state.turn.hand + ':' + sit.cards.length;
    if (!force && hintKey === key) return;
    hintKey = key;
    BJ.setSituation(sit);
    BJ.showHintFor(Strategy.recommend(sit.cards, sit.up, sit.opts));
  }
  function maybeHint() { if ($('m-opt-hint').checked) showHint(false); }

  function myAction(a) {
    if (!state || animating()) return;
    const sit = currentSituation();
    const rec = Strategy.recommend(sit.cards, sit.up, sit.opts);
    const turnBefore = JSON.stringify(state.turn) + state.round;
    mutate((x) => {
      if (JSON.stringify(x.turn) + x.round !== turnBefore) return false;
      return opAct(x, a, false);
    }).then((ok) => {
      if (ok && coachOn()) { BJ.setSituation(sit, a); BJ.recordDecision(rec, a); }
    });
  }

  // ================= Chat de la table =================
  let lastChat = null;
  function renderChat(list) {
    lastChat = list;
    const log = $('table-chat');
    log.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('div');
      p.className = 'muted small';
      p.textContent = 'Aucun message. Dis bonjour à la table !';
      log.appendChild(p);
    }
    const unknown = [];
    list.forEach((m) => { if (window.Social && Social.isReaction(m)) Social.floatReaction(m); });
    list.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'msg ' + (m.uid === me ? 'me' : 'other');
      const who = document.createElement('b');
      who.textContent = (m.uid === me ? 'Toi' : (m.name || nameOf(m.uid))) + ' ';
      if (m.uid !== me && !m.name) unknown.push(m.uid);
      el.appendChild(who);
      el.append(String(m.text || ''));
      log.appendChild(el);
    });
    log.scrollTop = log.scrollHeight;
    if (unknown.length) resolveNames(unknown);
  }

  async function sendChat(text) {
    text = text.trim();
    if (!text || !net || !tableId || !canWrite) return;
    try {
      await net.sendChat(tableId, { uid: me, name: myName() || '', text: text.slice(0, 300), ts: Date.now() });
    } catch (e) {
      toast('Message non envoyé.');
    }
  }

  // ================= Accueil des tables =================
  // Quitter la table : libère mes places (hors main en cours) et ferme la table si plus personne n'y est
  async function leaveTable(id) {
    if (!id || !stopPresence) return;
    const stop = stopPresence;
    stopPresence = null;
    try {
      await net.transact(id, (st) => {
        let changed = false;
        st.seats.forEach((s, i) => {
          if (s.owner === me && !(inPlay(st) && s.hands.length)) { st.seats[i] = emptySeat(); changed = true; }
        });
        return changed ? undefined : false;
      });
    } catch (e) { /* table déjà fermée */ }
    await stop();
    try {
      if ((await net.activeCount(id)) === 0) await net.deleteTable(id);
    } catch (e) { /* ignore */ }
  }

  function showLobby(note) {
    if (tableId) leaveTable(tableId);
    if (unsubTable) { unsubTable(); unsubTable = null; }
    if (unsubChat) { unsubChat(); unsubChat = null; }
    tableId = null; state = null;
    $('mtable').hidden = true;
    $('lobby').hidden = false;
    $('table-chat-panel').hidden = true;
    $('lobby-note').textContent = note || '';
    BJ.setCountCtx(null);
    document.body.classList.remove('no-coach');
    setUrlCode(null);
    const codes = net.usesCodes;
    $('join-code').hidden = !codes;
    $('pseudo-row').hidden = !codes;
    $('table-list').hidden = codes;
    if (!codes && !unsubLobby) {
      unsubLobby = net.watchLobby(renderLobby, () => {
        $('table-list').innerHTML = '<li class="muted">Impossible de charger les tables.</li>';
      });
    }
  }

  async function renderLobby(all) {
    const list = $('table-list');
    // On n'affiche que les tables où quelqu'un est présent ; les autres sont fermées et supprimées
    const counts = await Promise.all(all.map((t) => net.activeCount(t.id).catch(() => 1)));
    const tables = all.filter((t, i) => counts[i] > 0 || Date.now() - (t.createdAt || 0) < 60000);
    all.forEach((t, i) => { if (counts[i] === 0 && Date.now() - (t.createdAt || 0) >= 60000 && canWrite) net.deleteTable(t.id).catch(() => {}); });
    list.innerHTML = '';
    if (!tables.length) {
      list.innerHTML = '<li class="muted">Aucune table pour l\'instant : crée la première !</li>';
      return;
    }
    tables.forEach((t) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      const n = document.createElement('b');
      n.textContent = t.name || 'Table';
      const seats = t.seats || [];
      const seated = new Set(seats.filter((s) => s && s.owner).map((s) => s.owner)).size;
      const free = SEATS - seats.filter((s) => s && s.owner).length;
      const sub = document.createElement('div');
      sub.className = 'muted small';
      sub.textContent = seated + ' joueur' + (seated > 1 ? 's' : '') + ' · ' + free + ' place' + (free > 1 ? 's' : '') + ' libre' + (free > 1 ? 's' : '');
      info.append(n, sub);
      const actions = document.createElement('div');
      actions.className = 'row';
      const join = document.createElement('button');
      join.textContent = 'Rejoindre';
      join.addEventListener('click', () => openTable(t.id));
      actions.appendChild(join);
      if (t.creator === me && canWrite) actions.appendChild(deleteButton(t.id));
      li.append(info, actions);
      list.appendChild(li);
    });
  }

  function deleteButton(id) {
    const del = document.createElement('button');
    del.className = 'ghost small';
    del.textContent = 'Supprimer';
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = 'Confirmer ?'; setTimeout(() => { armed = false; del.textContent = 'Supprimer'; }, 3000); return; }
      try { await net.deleteTable(id); } catch (e) { /* ignore */ }
    });
    return del;
  }

  function setUrlCode(code) {
    if (!net || !net.usesCodes) return;
    try {
      const u = new URL(location.href);
      if (code) u.searchParams.set('table', code); else u.searchParams.delete('table');
      history.replaceState(null, '', u.toString());
    } catch (e) { /* ignore */ }
  }

  function inviteLink() {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('table', tableId);
    return u.toString();
  }

  async function openTable(id, justCreated) {
    if (tableId && tableId !== id) leaveTable(tableId);
    if (unsubTable) unsubTable();
    if (unsubChat) unsubChat();
    // Une table sans aucun joueur présent est fermée : on la supprime et on refuse d'y entrer
    if (!justCreated) {
      $('lobby-note').textContent = 'Recherche de la table…';
      let n = 1;
      try { n = await net.activeCount(id); } catch (e) { n = 1; }
      if (n === 0) {
        try { await net.deleteTable(id); } catch (e) { /* ignore */ }
        $('lobby-note').textContent = 'Cette table est fermée : tout le monde l\'a quittée. Crée une nouvelle table.';
        return;
      }
      $('lobby-note').textContent = '';
    }
    tableId = id;
    if (window.Social && Social.tableReady) Social.tableReady('blackjack', id);
    stopPresence = net.presenceStart(id);
    firstSnap = true;
    queue = [];
    revealed.clear();
    ctx.shown.clear();
    shownRound = -1;
    lastChat = null;
    $('lobby').hidden = true;
    $('mtable').hidden = false;
    $('table-chat-panel').hidden = false;
    $('m-message').textContent = 'Connexion à la table…';
    $('seats-others').innerHTML = ''; $('seats-mine').innerHTML = '';
    BJ.setCountCtx(ctx);
    setUrlCode(id);
    unsubTable = net.watchTable(id, onTable, () => toast('Connexion à la table perdue.'));
    unsubChat = net.watchChat(id, renderChat);
  }

  function needPseudo() {
    if (!net.usesCodes || myName()) return false;
    $('pseudo').focus();
    $('lobby-note').textContent = 'Choisis d\'abord un pseudo.';
    return true;
  }

  $('create-table').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!net || !canWrite || needPseudo()) return;
    const name = $('table-name').value.trim().slice(0, 30) || 'Table de ' + (myName() || names[me] || 'blackjack');
    try {
      const st = initialState(name, {
        coach: $('set-coach').checked,
        sides: $('set-sides').checked,
        bankroll: parseInt($('set-bankroll').value, 10) || START_BANKROLL,
        turnTime: parseInt($('set-turn').value, 10) || 20,
        betTime: parseInt($('set-bettime').value, 10) || 15,
        noHole: $('set-rule').value !== 'us',
        public: $('set-public').checked, vip: !!(window.Casino && Casino.isVip() && $('set-vip').checked), lk: Math.random().toString(36).slice(2, 10),
        hands: parseInt($('set-hands').value, 10) || 20,
      });
      const id = await net.createTable(st);
      $('table-name').value = '';
      openTable(id, true);
      if (window.Casino && Casino.launchFx) Casino.launchFx('blackjack', 'Table créée !', 'Code ' + id + ' · invite tes amis');
    } catch (err) {
      const code = err && err.code;
      if (code === 'invalid_argument' || code === 'PERMISSION_DENIED') { canWrite = false; $('lobby-note').textContent = 'Tu n\'as pas le droit de créer une table.'; }
      else if (code === 'quota_exceeded') $('lobby-note').textContent = 'Trop de tables : supprime-en une ancienne.';
      else $('lobby-note').textContent = 'Impossible de créer la table. Vérifie ta connexion.';
    }
  });
  $('join-code').addEventListener('submit', (e) => {
    e.preventDefault();
    if (needPseudo()) return;
    const code = $('code-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { $('lobby-note').textContent = 'Le code fait 4 caractères (ex. KQ7P).'; return; }
    openTable(code);
  });
  $('code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('pseudo').addEventListener('change', (e) => {
    try { localStorage.setItem('bj-pseudo', e.target.value.trim().slice(0, 16)); } catch (err) { /* ignore */ }
    $('lobby-note').textContent = '';
  });
  $('invite').addEventListener('click', async () => {
    if (window.Social && Social.inviteDialog) { Social.inviteDialog('blackjack', tableId); return; }
    const link = inviteLink();
    const text = 'Rejoins ma table de blackjack ! Code : ' + tableId;
    if (navigator.share) {
      try { await navigator.share({ title: 'Blackjack entre amis', text, url: link }); return; } catch (e) { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(text + ' — ' + link); toast('Lien d\'invitation copié !'); }
    catch (e) { toast('Code de la table : ' + tableId); }
  });
  $('leave-table').addEventListener('click', () => { if (lobbyLastInfo && window.Social) Social.lobbyRemove('blackjack', tableId, lobbyLastInfo); lobbyLastInfo = null; showLobby(); if (window.Social && Social.hubLink) location.href = Social.hubLink('#multi'); });
  // Réactions rapides : envoyées par le chat de la table, elles s'envolent chez tout le monde
  if (window.Social) {
    Social.reactionBar($('table-chat-form').parentNode, (emoji) => {
      if (!net || !tableId) return;
      net.sendChat(tableId, { uid: me, name: (myName() || ''), text: emoji, ts: Date.now(), reaction: true }).catch(() => {});
    });
  }
  // Les joueurs croisés à une table deviennent des amis (classement de l'accueil)
  function befriend() {
    if (!window.Social) return;
    (state ? state.seats.map((x) => x.owner) : []).forEach((u) => { if (u && u !== me) Social.addFriendUid(u); });
  }
  $('table-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('table-chat-input').value;
    $('table-chat-input').value = '';
    sendChat(v);
  });
  $('m-opt-hint').addEventListener('change', () => maybeHint());
  $('m-opt-coach').addEventListener('change', (e) => setCoachChoice(e.target.checked));
  $('coach-yes').addEventListener('click', () => { $('coach-dialog').close(); setCoachChoice(true); });
  $('coach-no').addEventListener('click', () => { $('coach-dialog').close(); setCoachChoice(false); });
  $('coach-dialog').addEventListener('cancel', (e) => e.preventDefault()); // il faut choisir
  // Un seul réglage de vitesse, affiché dans les deux vues
  $('m-opt-speed').addEventListener('change', (e) => { $('opt-speed').value = e.target.value; $('opt-speed').dispatchEvent(new Event('change')); });
  $('opt-speed').addEventListener('change', (e) => { $('m-opt-speed').value = e.target.value; });

  // ================= Onglets =================
  function setMode(mode) {
    document.body.dataset.mode = mode;
    $('tab-solo').classList.toggle('active', mode === 'solo');
    $('tab-multi').classList.toggle('active', mode === 'multi');
    $('tab-solo').setAttribute('aria-selected', mode === 'solo');
    $('tab-multi').setAttribute('aria-selected', mode === 'multi');
    if (mode !== 'solo') { $('solo-view').hidden = true; $('bj-setup').hidden = true; }
    $('multi-view').hidden = mode !== 'multi';
    if (mode === 'solo') {
      $('table-chat-panel').hidden = true;
      BJ.setCountCtx(null);
      BJ.showSolo();
    } else {
      if (window.Casino) Casino.training = false; // entre amis : ça compte pour la progression
      $('bank-label').textContent = 'Jetons';
      startMulti();
    }
  }
  $('tab-solo').addEventListener('click', () => setMode('solo'));
  $('tab-multi').addEventListener('click', () => setMode('multi'));

  let started = false;
  async function startMulti() {
    if (tableId) { $('table-chat-panel').hidden = false; BJ.setCountCtx(ctx); renderAll(); return; }
    if (started) { if (net) showLobby(); return; }
    started = true;
    $('lobby').hidden = true;
    $('multi-loading').hidden = false;
    let n = null;
    try { n = await window.createNet(); } catch (e) { n = null; }
    $('multi-loading').hidden = true;
    if (!n || n.error) {
      $('multi-unavailable').hidden = false;
      if (n && n.error === 'firebase') $('multi-unavailable-detail').textContent = 'Connexion au serveur impossible. Vérifie ta connexion Internet puis recharge la page.';
      return;
    }
    net = n;
    me = net.me;
    canWrite = net.canWrite;
    try { $('pseudo').value = myName(); } catch (e) { /* ignore */ }
    if (!canWrite) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Tu peux regarder les tables, mais pas jouer : le propriétaire du jeu doit t\'inviter comme éditeur.';
      $('lobby').appendChild(p);
      $('create-table').hidden = true;
    }
    const code = new URLSearchParams(location.search).get('table'); // lu avant que showLobby nettoie l'adresse
    showLobby();
    if (code && net.usesCodes) {
      if (myName()) openTable(code.toUpperCase());
      else { $('code-input').value = code.toUpperCase(); needPseudo(); }
    }
  }

  window.Multi = { rerender: () => { if (tableId) renderAll(); }, normalize };

  // Lien d'invitation : ouvre directement l'onglet « Entre amis »
  if (new URLSearchParams(location.search).get('table') || new URLSearchParams(location.search).get('multi') || (window.Social && Social.wantsTable && Social.wantsTable())) { document.body.classList.add('multi-entry'); setMode('multi'); }
  // écran « Entre amis » dans le style de l'écran de lancement
  if (window.Casino && Casino.styleLobby) Casino.styleLobby(document.getElementById('lobby'), 'blackjack', { join: '#join-code', pseudo: '#pseudo' });
})();

// option « Club privé VIP » visible seulement pour les membres
(function () { const o = document.getElementById('set-vip'); if (o && window.Casino) o.closest('label').hidden = !Casino.isVip(); })();
