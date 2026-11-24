/*
 * Mode « Entre amis » : une table partagée en ligne (5 places).
 * Chaque joueur choisit une ou plusieurs places, mise (avec paris annexes) et joue à son tour.
 * L'état de la table est un document partagé ; chaque action prend un verrou court,
 * relit l'état, l'applique et le réécrit, pour que deux joueurs ne s'écrasent pas.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DECKS = 6;
  const SEATS = 5;
  const START_BANKROLL = 1000;
  const TURN_TIMEOUT = 30000; // après 30 s, un autre joueur peut faire rester la main
  const L = Strategy.ACTION_LABELS;

  let db = null, user = null;
  let me = null;            // id du joueur
  let canWrite = true;
  const tabId = Math.random().toString(36).slice(2, 8);
  const names = {};         // id -> nom affiché

  let tableId = null;
  let state = null;         // dernier état reçu
  let unsubTable = null, unsubChat = null, unsubLobby = null;
  let working = false;      // une action est en cours d'envoi

  // ----- Animation : les cartes reçues sont révélées une par une -----
  const ctx = { shown: new Map(), counter: HiLo.create(), cardsLeft: () => (state ? state.shoe.length : DECKS * 52) };
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

  function initialState(name) {
    const seats = [];
    for (let i = 0; i < SEATS; i++) seats.push(emptySeat());
    return {
      name, creator: me, createdAt: Date.now(), updatedAt: Date.now(),
      phase: 'betting', shoe: newShoe(), cardSeq: 0, rcBase: 0, shuffles: 0,
      seats, dealer: [], turn: null, turnAt: 0, players: {}, round: 0,
      msg: 'Choisissez vos places et vos mises.',
    };
  }

  function player(st, uid) {
    if (!st.players[uid]) st.players[uid] = { bankroll: START_BANKROLL };
    return st.players[uid];
  }

  function seatHasHands(seat) { return seat.hands && seat.hands.length > 0; }

  function opSit(st, i) {
    const seat = st.seats[i];
    if (seat.owner) return false;
    player(st, me);
    st.seats[i] = emptySeat();
    st.seats[i].owner = me;
    st.seats[i].bet = 10;
  }
  function opLeave(st, i) {
    const seat = st.seats[i];
    if (seat.owner !== me) return false;
    if (st.phase === 'playing' && seatHasHands(seat)) return false;
    st.seats[i] = emptySeat();
  }
  function opBet(st, i, field, amount) {
    const seat = st.seats[i];
    if (seat.owner !== me || st.phase === 'playing') return false;
    if (field === 'bet') seat.bet = amount === 0 ? 0 : Math.min(500, seat.bet + amount);
    else seat[field] = amount;
  }

  function tagSum(cards) { return cards.reduce((a, c) => a + HiLo.tag(c.rank), 0); }

  function opDeal(st) {
    if (st.phase === 'playing') return false;
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
      s.hands = []; s.side = '';
      if (!s.owner || s.bet <= 0) return;
      const p = player(st, s.owner);
      const total = s.bet + (s.pp || 0) + (s.t213 || 0);
      if (p.bankroll < total) return;
      p.bankroll -= total;
      s.hands = [{ cards: [], bet: s.bet, done: false }];
      active.push(i);
    });
    if (!active.length) return false;

    st.dealer = [];
    st.round++;
    for (let r = 0; r < 2; r++) {
      active.forEach((i) => st.seats[i].hands[0].cards.push(draw(st)));
      st.dealer.push(draw(st));
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

    st.phase = 'playing';
    const upV = Strategy.cardValue(up.rank);
    if (upV >= 10 && isBJ(st.dealer)) {
      st.msg = 'Le croupier a un blackjack.';
      return finish(st);
    }
    active.forEach((i) => { const h = st.seats[i].hands[0]; if (isBJ(h.cards)) { h.done = true; h.natural = true; } });
    st.turn = { seat: active[0], hand: 0 };
    advance(st);
  }

  function advance(st) {
    let { seat, hand } = st.turn;
    while (seat < SEATS) {
      const s = st.seats[seat];
      while (s.hands && hand < s.hands.length) {
        const h = s.hands[hand];
        if (!h.done && h.cards.length === 1) {
          h.cards.push(draw(st));
          if (h.splitAces) h.done = true;
        }
        if (!h.done && value(h.cards).total >= 21) h.done = true;
        if (!h.done) {
          st.turn = { seat, hand };
          st.turnAt = Date.now();
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
    const live = st.seats.some((s) => s.hands.some((h) => value(h.cards).total <= 21 && !(h.natural)));
    if (live) {
      while (value(st.dealer).total < 17) st.dealer.push(draw(st));
    }
    finish(st);
  }

  function finish(st) {
    st.phase = 'over';
    st.turn = null;
    const d = value(st.dealer).total;
    const dBJ = isBJ(st.dealer);
    st.seats.forEach((s) => {
      if (!s.owner || !s.hands.length) return;
      const p = player(st, s.owner);
      const single = s.hands.length === 1;
      s.hands.forEach((h) => {
        const v = value(h.cards).total;
        const pBJ = single && !h.split && isBJ(h.cards);
        let back = 0, txt, cls;
        if (pBJ && dBJ) { back = h.bet; txt = 'Égalité'; cls = 'push'; }
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
    Object.keys(st.players).forEach((uid) => {
      if (st.players[uid].bankroll < 5) st.players[uid].bankroll = START_BANKROLL;
    });
    if (!st.msg) st.msg = d > 21 ? 'Le croupier saute avec ' + d + ' !' : 'Le croupier a ' + (dBJ ? 'un blackjack' : d) + '.';
  }

  function opAct(st, action, force) {
    if (st.phase !== 'playing' || !st.turn) return false;
    const s = st.seats[st.turn.seat];
    if (!force && s.owner !== me) return false;
    if (force && Date.now() - st.turnAt < TURN_TIMEOUT) return false;
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
    } else if (action === 'P') {
      if (!two || p.bankroll < h.bet || s.hands.length >= 4 ||
        Strategy.cardValue(h.cards[0].rank) !== Strategy.cardValue(h.cards[1].rank)) return false;
      p.bankroll -= h.bet;
      const aces = h.cards[0].rank === 'A';
      const second = { cards: [h.cards.pop()], bet: h.bet, done: false, split: true, splitAces: aces };
      h.split = true; h.splitAces = aces;
      s.hands.splice(st.turn.hand + 1, 0, second);
    } else return false;
    advance(st);
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
    };
  }

  // ================= Écriture partagée avec verrou =================
  async function mutate(fn) {
    if (!db || !tableId || !canWrite) return false;
    working = true;
    renderControls();
    try {
      const lock = db.doc('tables/' + tableId + '/lock/main');
      let ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        const r = await lock.acquire({ holder: me + ':' + tabId, ttlMs: 1500 });
        ok = r.acquired;
        if (!ok) await sleep(120 + Math.random() * 200);
      }
      if (!ok) { toast('La table est occupée, réessaie.'); return false; }
      const ref = db.doc('tables/' + tableId);
      const snap = await ref.get();
      if (!snap.exists) { toast('Cette table n\'existe plus.'); return false; }
      const st = JSON.parse(JSON.stringify(snap.data()));
      if (fn(st) === false) return false;
      st.updatedAt = Date.now();
      await ref.set(st);
      return true;
    } catch (e) {
      if (e && e.code === 'invalid_argument') {
        canWrite = false;
        toast('Tu peux regarder cette table, mais pas y jouer : demande au propriétaire du jeu de t\'inviter comme éditeur.');
      } else toast('Action non envoyée (' + ((e && e.code) || 'erreur') + '). Réessaie.');
      return false;
    } finally {
      working = false;
      renderControls();
    }
  }

  function toast(text) {
    const m = $('m-message');
    m.textContent = text;
    m.classList.add('flash');
    setTimeout(() => m.classList.remove('flash'), 1200);
  }

  // ================= Réception et animation =================
  function onTableSnapshot(snap) {
    if (!snap.exists) { state = null; toast('Cette table a été supprimée.'); showLobby(); return; }
    const st = snap.data();
    state = st;
    if (st.round !== shownRound) { holeFlipped = false; ctx.counter.reset(st.rcBase); }
    const all = [];
    st.dealer.forEach((c, i) => all.push({ c, dealerIdx: i }));
    st.seats.forEach((s) => s.hands.forEach((h) => h.cards.forEach((c) => all.push({ c }))));
    if (firstSnap) {
      all.forEach((x) => revealed.add(x.c.id));
      holeFlipped = st.phase !== 'playing';
      firstSnap = false;
      shownRound = st.round;
      queue = [];
      renderAll();
      return;
    }
    shownRound = st.round;
    const queued = new Set(queue.filter((e) => e.card).map((e) => e.card.id));
    const fresh = all.filter((x) => !revealed.has(x.c.id) && !queued.has(x.c.id)).sort((a, b) => a.c.id - b.c.id);
    const needFlip = st.phase !== 'playing' && st.dealer.length >= 2 && !holeFlipped && !queue.some((e) => e.flip);
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
    return names[uid] || 'Joueur';
  }
  async function resolveNames() {
    if (!user || !state) return;
    const ids = new Set();
    state.seats.forEach((s) => s.owner && s.owner !== me && !names[s.owner] && ids.add(s.owner));
    if (!ids.size) return;
    try {
      const ps = await user.profiles([...ids]);
      let changed = false;
      ids.forEach((id) => { const n = (ps[id] && ps[id].name) || ''; if (n) { names[id] = n; changed = true; } });
      if (changed) renderAll();
    } catch (e) { /* noms indisponibles */ }
  }

  function totalText(cards) {
    if (!cards.length) return '';
    const v = value(cards);
    if (isBJ(cards)) return 'Blackjack';
    return (v.soft && v.total < 21 ? (v.total - 10) + ' / ' : '') + v.total;
  }

  function renderAll() {
    if (!state || !tableId) return;
    const st = state;
    const anim = animating();
    $('mtable-name').textContent = st.name || 'Table';
    $('mtable-shoe').textContent = 'Sabot : ' + (st.shoe.length / 52).toFixed(1) + ' jeux';

    // Croupier
    const dc = $('m-dealer-cards');
    dc.innerHTML = '';
    const dVisible = st.dealer.filter((c) => revealed.has(c.id));
    dVisible.forEach((c, i) => dc.appendChild(BJ.cardEl(c, i === 1 && !holeFlipped, ctx)));
    const shownDealer = holeFlipped ? dVisible : dVisible.slice(0, 1);
    $('m-dealer-total').textContent = shownDealer.length ? totalText(shownDealer) : '';

    // Places
    const seatsEl = $('seats');
    seatsEl.innerHTML = '';
    st.seats.forEach((s, i) => seatsEl.appendChild(seatEl(st, s, i, anim)));

    // Message
    const msg = $('m-message');
    if (!msg.classList.contains('flash')) {
      if (anim) msg.textContent = st.phase === 'playing' && st.turn ? 'Distribution…' : 'Le croupier joue…';
      else if (st.phase === 'playing' && st.turn) {
        const owner = st.seats[st.turn.seat].owner;
        msg.textContent = owner === me ? 'À toi de jouer (place ' + (st.turn.seat + 1) + ') !' : 'Au tour de ' + nameOf(owner) + ' (place ' + (st.turn.seat + 1) + ').';
      } else if (st.phase === 'over') msg.textContent = (st.msg || 'Main terminée.') + (st.note ? ' ' + st.note : '') + ' Changez vos mises puis distribuez.';
      else msg.textContent = (st.msg || '') + (st.note ? ' ' + st.note : '');
    }

    // Banque du joueur sur cette table
    if (document.body.dataset.mode === 'multi') {
      const p = st.players[me];
      $('bankroll').textContent = p && !anim ? p.bankroll : (p ? p.bankroll : START_BANKROLL);
    }
    renderControls();
    BJ.renderCount();
    resolveNames();
    maybeHint();
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

    // Mises (place du joueur, hors main en cours)
    if (s.owner === me && st.phase !== 'playing') {
      const bets = document.createElement('div');
      bets.className = 'seat-bets';
      const line = document.createElement('div');
      line.className = 'row';
      const lab = document.createElement('span');
      lab.textContent = 'Mise : ' + s.bet + ' €';
      line.appendChild(lab);
      [5, 10, 25, 100].forEach((v) => {
        const b = document.createElement('button');
        b.className = 'mini-chip';
        b.textContent = '+' + v;
        b.disabled = working;
        b.addEventListener('click', () => mutate((x) => opBet(x, i, 'bet', v)));
        line.appendChild(b);
      });
      const clr = document.createElement('button');
      clr.className = 'ghost small';
      clr.textContent = '0';
      clr.title = 'Remettre la mise à zéro';
      clr.addEventListener('click', () => mutate((x) => opBet(x, i, 'bet', 0)));
      line.appendChild(clr);
      bets.appendChild(line);
      const sides = document.createElement('div');
      sides.className = 'row small';
      [['pp', 'Paire parfaite'], ['t213', '21+3']].forEach(([f, label]) => {
        const l = document.createElement('label');
        l.textContent = label + ' ';
        const sel = document.createElement('select');
        [0, 5, 10, 25].forEach((v) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = v ? v + ' €' : '—';
          if ((s[f] || 0) === v) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => mutate((x) => opBet(x, i, f, parseInt(sel.value, 10))));
        l.appendChild(sel);
        sides.appendChild(l);
      });
      bets.appendChild(sides);
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
    if (st.phase !== 'playing') {
      const mine = st.seats.some((s) => s.owner === me);
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = 'Distribuer';
      b.disabled = working || anim || !mine || !st.seats.some((s) => s.owner && s.bet > 0);
      b.title = mine ? '' : 'Assieds-toi d\'abord à une place';
      b.addEventListener('click', () => { BJ.setCountCtx(ctx); mutate(opDeal); });
      box.appendChild(b);
      if (!mine) {
        const p = document.createElement('span');
        p.className = 'muted small';
        p.textContent = 'Choisis une ou plusieurs places pour jouer.';
        box.appendChild(p);
      }
      return;
    }
    if (anim || !st.turn) return;
    const s = st.seats[st.turn.seat];
    if (s.owner === me) {
      const opts = availableFor(st);
      ['H', 'S', 'D', 'P'].forEach((a) => {
        const b = document.createElement('button');
        b.textContent = L[a];
        b.disabled = working || !opts[a];
        b.addEventListener('click', () => myAction(a));
        box.appendChild(b);
      });
      const h = document.createElement('button');
      h.className = 'ghost';
      h.textContent = '💡 Conseil';
      h.addEventListener('click', () => showHint(true));
      box.appendChild(h);
    } else {
      const waited = Date.now() - st.turnAt;
      const p = document.createElement('span');
      p.className = 'muted small';
      p.textContent = 'En attente de ' + nameOf(s.owner) + '…';
      box.appendChild(p);
      const b = document.createElement('button');
      b.className = 'ghost small';
      b.textContent = 'Passer son tour (rester)';
      b.disabled = working || waited < TURN_TIMEOUT;
      b.title = 'Possible après 30 secondes sans action';
      b.addEventListener('click', () => mutate((x) => opAct(x, 'S', true)));
      box.appendChild(b);
      if (waited < TURN_TIMEOUT) setTimeout(renderControls, TURN_TIMEOUT - waited + 100);
    }
  }

  function currentSituation() {
    const st = state;
    const s = st.seats[st.turn.seat];
    const h = s.hands[st.turn.hand];
    const o = availableFor(st);
    return { cards: h.cards, up: st.dealer[0].rank, opts: { canDouble: o.D, canSplit: o.P } };
  }

  function showHint(force) {
    if (!state || state.phase !== 'playing' || !state.turn || animating()) return;
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
      if (ok) { BJ.setSituation(sit, a); BJ.recordDecision(rec, a); }
    });
  }

  // ================= Chat de la table =================
  function renderChat(snap) {
    const log = $('table-chat');
    log.innerHTML = '';
    const docs = snap.docs.slice().reverse();
    if (!docs.length) {
      const p = document.createElement('div');
      p.className = 'muted small';
      p.textContent = 'Aucun message. Dis bonjour à la table !';
      log.appendChild(p);
    }
    const unknown = [];
    docs.forEach((d) => {
      const m = d.data();
      const el = document.createElement('div');
      el.className = 'msg ' + (m.uid === me ? 'me' : 'other');
      const who = document.createElement('b');
      who.textContent = nameOf(m.uid) + ' ';
      if (m.uid !== me && !names[m.uid]) unknown.push(m.uid);
      el.appendChild(who);
      el.append(String(m.text || ''));
      log.appendChild(el);
    });
    log.scrollTop = log.scrollHeight;
    if (unknown.length && user) {
      user.profiles([...new Set(unknown)]).then((ps) => {
        let ch = false;
        Object.keys(ps).forEach((id) => { if (ps[id] && ps[id].name) { names[id] = ps[id].name; ch = true; } });
        if (ch) renderChat(snap);
      }).catch(() => {});
    }
  }

  async function sendChat(text) {
    text = text.trim();
    if (!text || !db || !tableId || !canWrite) return;
    const col = db.collection('tables/' + tableId + '/chat');
    try {
      await col.add({ uid: me, text: text.slice(0, 300), ts: Date.now() });
      // Nettoyage des vieux messages (plus de 3 jours)
      const old = await col.where('ts', '<', Date.now() - 3 * 864e5).limit(20).get();
      for (const d of old.docs) await col.doc(d.id).delete();
    } catch (e) {
      toast('Message non envoyé.');
    }
  }

  // ================= Lobby =================
  function showLobby() {
    if (unsubTable) { unsubTable(); unsubTable = null; }
    if (unsubChat) { unsubChat(); unsubChat = null; }
    tableId = null; state = null;
    $('mtable').hidden = true;
    $('lobby').hidden = false;
    $('table-chat-panel').hidden = true;
    BJ.setCountCtx(null);
    if (!unsubLobby) {
      unsubLobby = db.collection('tables').orderBy('updatedAt', 'desc').limit(30).onSnapshot(renderLobby, () => {
        $('table-list').innerHTML = '<li class="muted">Impossible de charger les tables.</li>';
      });
    }
  }

  function renderLobby(snap) {
    const list = $('table-list');
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<li class="muted">Aucune table pour l\'instant : crée la première !</li>';
      return;
    }
    snap.docs.forEach((d) => {
      const t = d.data();
      const li = document.createElement('li');
      const info = document.createElement('div');
      const n = document.createElement('b');
      n.textContent = t.name || 'Table';
      const seated = new Set((t.seats || []).filter((s) => s.owner).map((s) => s.owner)).size;
      const free = (t.seats || []).filter((s) => !s.owner).length;
      const sub = document.createElement('div');
      sub.className = 'muted small';
      sub.textContent = seated + ' joueur' + (seated > 1 ? 's' : '') + ' · ' + free + ' place' + (free > 1 ? 's' : '') + ' libre' + (free > 1 ? 's' : '');
      info.append(n, sub);
      const actions = document.createElement('div');
      actions.className = 'row';
      const join = document.createElement('button');
      join.textContent = 'Rejoindre';
      join.addEventListener('click', () => openTable(d.id));
      actions.appendChild(join);
      if (t.creator === me && canWrite) {
        const del = document.createElement('button');
        del.className = 'ghost small';
        del.textContent = 'Supprimer';
        let armed = false;
        del.addEventListener('click', async () => {
          if (!armed) { armed = true; del.textContent = 'Confirmer ?'; setTimeout(() => { armed = false; del.textContent = 'Supprimer'; }, 3000); return; }
          try { await db.doc('tables/' + d.id).delete(); } catch (e) { /* ignore */ }
        });
        actions.appendChild(del);
      }
      li.append(info, actions);
      list.appendChild(li);
    });
  }

  function openTable(id) {
    if (unsubTable) unsubTable();
    if (unsubChat) unsubChat();
    tableId = id;
    firstSnap = true;
    queue = [];
    revealed.clear();
    ctx.shown.clear();
    shownRound = -1;
    $('lobby').hidden = true;
    $('mtable').hidden = false;
    $('table-chat-panel').hidden = false;
    $('m-message').textContent = 'Connexion à la table…';
    BJ.setCountCtx(ctx);
    unsubTable = db.doc('tables/' + id).onSnapshot(onTableSnapshot, () => toast('Connexion à la table perdue.'));
    unsubChat = db.collection('tables/' + id + '/chat').orderBy('ts', 'desc').limit(50).onSnapshot(renderChat, () => {});
  }

  $('create-table').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!db || !canWrite) return;
    const name = $('table-name').value.trim().slice(0, 30) || 'Table de ' + (names[me] || 'blackjack');
    const ref = db.collection('tables').doc();
    try {
      await ref.set(initialState(name));
      $('table-name').value = '';
      openTable(ref.id);
    } catch (err) {
      if (err && err.code === 'invalid_argument') {
        canWrite = false;
        toast('Tu n\'as pas le droit de créer une table.');
      } else if (err && err.code === 'quota_exceeded') {
        toast('Trop de tables : supprime-en une ancienne.');
      }
    }
  });
  $('leave-table').addEventListener('click', showLobby);
  $('table-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('table-chat-input').value;
    $('table-chat-input').value = '';
    sendChat(v);
  });
  $('m-opt-hint').addEventListener('change', () => maybeHint());

  // ================= Onglets =================
  function setMode(mode) {
    document.body.dataset.mode = mode;
    $('tab-solo').classList.toggle('active', mode === 'solo');
    $('tab-multi').classList.toggle('active', mode === 'multi');
    $('tab-solo').setAttribute('aria-selected', mode === 'solo');
    $('tab-multi').setAttribute('aria-selected', mode === 'multi');
    $('solo-view').hidden = mode !== 'solo';
    $('multi-view').hidden = mode !== 'multi';
    if (mode === 'solo') {
      $('table-chat-panel').hidden = true;
      BJ.setCountCtx(null);
      BJ.render();
    } else {
      startMulti();
    }
  }
  $('tab-solo').addEventListener('click', () => setMode('solo'));
  $('tab-multi').addEventListener('click', () => setMode('multi'));

  let started = false;
  async function startMulti() {
    if (tableId) { $('table-chat-panel').hidden = false; BJ.setCountCtx(ctx); renderAll(); return; }
    if (started) { if (db) showLobby(); return; }
    started = true;
    const unavailable = () => { $('multi-unavailable').hidden = false; $('lobby').hidden = true; };
    if (!window.claude || typeof window.claude.use !== 'function') return unavailable();
    $('lobby').hidden = false;
    try {
      [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    } catch (e) { db = null; }
    if (!db || !user) return unavailable();
    me = await user.id();
    if (!me) return unavailable();
    try {
      const w = await user.can('data.write');
      canWrite = w !== false;
    } catch (e) { canWrite = true; }
    if (!canWrite) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Tu peux regarder les tables, mais pas jouer : le propriétaire du jeu doit t\'inviter comme éditeur.';
      $('lobby').appendChild(p);
      $('create-table').hidden = true;
    }
    showLobby();
  }

  window.Multi = { rerender: () => { if (tableId) renderAll(); } };
})();
