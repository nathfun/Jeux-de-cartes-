(function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DECKS = 6;
  const MAX_HANDS = 4;
  const START_BANKROLL = 1000;
  // Limites de la table, comme au casino (le doublement et la séparation peuvent dépasser le maximum)
  const MIN_BET = 1;
  // mise maximale : celle du salon VIP en partie réelle (elle monte avec le niveau), 500 € en entraînement
  const maxBetNow = () => (mode === 'real' && window.Casino ? Casino.maxBet() : 500);
  const STORAGE_KEY = 'blackjack-coach-v1';
  const CAT_LABELS = { hard: 'Mains dures', soft: 'Mains souples', pair: 'Paires' };
  const $ = (id) => document.getElementById(id);

  // ---------- État ----------
  let shoe = [];
  let bet = 10;
  let round = null; // { dealer: [], hands: [], active, phase, decisions: [] }
  const side = { pp: 0, t213: 0 }; // paris annexes choisis
  let lastSituation = null;        // dernière situation analysée (pour les détails et le chat)
  let stats = loadStats();
  // Mode de la partie solo : 'train' (crédit illimité + coach), 'real' (somme apportée, sans aides) ou 'defi'
  let mode = null;
  const TRAIN_BANK = window.Casino ? Casino.TRAIN_BANK : 1000;

  function freshStats() {
    return {
      bankroll: START_BANKROLL,
      decisions: 0, correct: 0,
      cats: { hard: [0, 0], soft: [0, 0], pair: [0, 0] }, // [corrects, total]
      mistakes: {},   // clé -> { count, played, optimal }
      patterns: {},   // type d'erreur -> nombre
      hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0,
      net: 0, maxBetRatio: 0, recent: [], // 1/0 des 30 dernières décisions
      sideBets: 0, sideNet: 0,         // paris annexes
      countQuiz: 0, countQuizOk: 0,    // entraînement au comptage
    };
  }
  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(freshStats(), JSON.parse(raw));
    } catch (e) { /* stockage indisponible */ }
    return freshStats();
  }
  function saveStats() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
    if (window.Casino && mode === 'real') Casino.setStack('blackjack', stats.bankroll); // la somme sur la table est sauvegardée en continu
  }

  // ---------- Sabot ----------
  // Défi entre amis : { code, meta, hands } ; le sabot est mélangé avec la graine du défi
  let defi = null;
  function buildShoe(random) {
    random = random || Math.random;
    soloCtx.counter.reset();
    shoe = [];
    for (let d = 0; d < DECKS; d++)
      for (const s of SUITS) for (const r of RANKS) shoe.push({ rank: r, suit: s });
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
  }
  let cardSeq = 0;
  // Partie réelle avec le serveur : les cartes viennent du sabot du serveur, dans l'ordre où l'app les distribue
  let srvQueue = [], srvStack = null;
  const srvMode = () => mode === 'real' && !!window.Casino && Casino.server;
  function draw() {
    if (srvMode() && srvQueue.length) { const c = srvQueue.shift(); return { rank: c.rank, suit: c.suit, id: ++cardSeq }; }
    if (shoe.length === 0) buildShoe();
    const c = shoe.pop();
    return { rank: c.rank, suit: c.suit, id: ++cardSeq };
  }

  const value = (cards) => Strategy.handValue(cards);
  const isBlackjack = (cards) => cards.length === 2 && value(cards).total === 21;

  // ---------- Rythme et animations ----------
  const BASE_DELAY = 650; // ms entre deux cartes à vitesse normale
  let busy = false;       // bloque les actions pendant une animation
  function speed() {
    const v = parseFloat($('opt-speed').value);
    return v > 0 ? v : 1;
  }
  function sleep(factor) {
    return new Promise((r) => setTimeout(r, BASE_DELAY * (factor || 1) / speed()));
  }
  function applySpeed() {
    document.documentElement.style.setProperty('--anim', (0.45 / speed()) + 's');
  }

  // Chaque mode (solo, table entre amis) a son propre suivi des cartes affichées et son compteur
  // shown : id de carte -> 'hidden' | 'shown' : permet d'animer seulement les nouvelles cartes
  const soloCtx = { shown: new Map(), counter: HiLo.create(), cardsLeft: () => shoe.length, enhc: () => soloEnhc() };
  // Règle du croupier en solo : européenne (pas de carte cachée, par défaut) ou américaine
  function soloEnhc() { const el = document.getElementById('opt-rule'); return !el || el.value !== 'us'; }
  let countCtx = soloCtx; // contexte affiché dans le panneau de comptage

  // ---------- Rendu des cartes ----------
  function cardEl(card, hidden, ctx) {
    ctx = ctx || soloCtx;
    const el = document.createElement('div');
    const prev = ctx.shown.get(card.id);
    const anim = !prev ? ' dealt' : (prev === 'hidden' && !hidden ? ' flip' : '');
    ctx.shown.set(card.id, hidden ? 'hidden' : 'shown');
    if (window.Sfx) { if (anim === ' dealt') Sfx.card(); else if (anim === ' flip') Sfx.flip(); }
    if (hidden) { el.className = 'card back' + anim; return el; }
    ctx.counter.observe(card);
    const red = card.suit === '♥' || card.suit === '♦';
    el.className = 'card' + (red ? ' red' : '') + anim;
    el.innerHTML = '<div class="tl">' + card.rank + '<br>' + card.suit + '</div>' +
      '<div class="mid">' + card.suit + '</div>' +
      '<div class="br">' + card.rank + '<br>' + card.suit + '</div>';
    if ($('opt-tags').checked && !document.body.classList.contains('no-coach')) {
      const t = HiLo.tag(card.rank);
      const b = document.createElement('span');
      b.className = 'tag ' + (t > 0 ? 'plus' : t < 0 ? 'minus' : 'zero');
      b.textContent = HiLo.tagText(t);
      el.appendChild(b);
    }
    el.setAttribute('aria-label', card.rank + card.suit);
    return el;
  }

  function totalText(cards) {
    if (!cards.length) return '';
    const v = value(cards);
    if (isBlackjack(cards)) return 'Blackjack';
    return (v.soft && v.total < 21 ? (v.total - 10) + ' / ' : '') + v.total;
  }

  function render() {
    $('bankroll').textContent = stats.bankroll;
    $('bet').textContent = bet;

    const dc = $('dealer-cards');
    dc.innerHTML = '';
    const pc = $('player-hands');
    pc.innerHTML = '';

    if (round) {
      const hideHole = round.phase === 'playing' || round.phase === 'dealing';
      round.dealer.forEach((c, i) => dc.appendChild(cardEl(c, hideHole && i === 1)));
      const up = round.dealer[0] ? Strategy.cardValue(round.dealer[0].rank) : null;
      $('dealer-total').textContent = !round.dealer.length ? ''
        : hideHole ? (up === 11 ? 'As' : String(up))
        : totalText(round.dealer);

      round.hands.forEach((h, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'hand' + (round.phase === 'playing' && i === round.active ? ' active' : '');
        const cards = document.createElement('div');
        cards.className = 'cards';
        h.cards.forEach((c) => cards.appendChild(cardEl(c)));
        const info = document.createElement('div');
        info.className = 'hand-info';
        const bust = value(h.cards).total > 21;
        info.innerHTML = 'Total : <b' + (bust ? ' class="bust"' : '') + '>' + totalText(h.cards) + '</b> · Mise ' + h.bet + ' €' +
          (h.result ? ' <span class="result ' + h.resultClass + '">' + h.result + '</span>' : '') +
          (i === 0 && round.sideText ? '<div class="side-result">' + round.sideText + '</div>' : '');
        wrap.appendChild(cards);
        wrap.appendChild(info);
        pc.appendChild(wrap);
      });
    } else {
      $('dealer-total').textContent = '';
    }

    const inRound = round && round.phase !== 'over';
    const playing = round && round.phase === 'playing' && !busy;
    $('bet-controls').classList.toggle('hidden', !!inRound);
    $('play-controls').classList.toggle('hidden', !inRound || !!insuranceResolve);
    $('deal').disabled = busy || bet < MIN_BET || bet > maxBetNow() || bet + side.pp + side.t213 > stats.bankroll;

    if (inRound) {
      const opts = playing ? availableActions() : {};
      document.querySelectorAll('[data-action]').forEach((b) => {
        b.disabled = !opts[b.dataset.action];
      });
      $('hint').disabled = !playing;
    }
    // Emplacements de mise sur le tapis
    const roundOn = round && round.phase !== 'over';
    const spots = $('solo-spots');
    spots.innerHTML = '';
    spots.appendChild(spotsEl({
      main: roundOn ? round.hands.reduce((a, h) => a + h.bet, 0) : bet,
      pp: roundOn ? round.pp : side.pp,
      t213: roundOn ? round.t213 : side.t213,
      sides: true,
      editable: !roundOn && !busy,
      onSide: (f, v) => { side[f] = v; render(); },
    }));
    renderStats();
    renderCount();
  }

  // ---------- Emplacements de mise (mise principale + paris annexes rouges) ----------
  const SIDE_STEPS = [0, 1, 5, 10, 25];
  function chipStack(amount) {
    const c = document.createElement('span');
    c.className = 'spot-chip' + (amount ? '' : ' empty');
    c.textContent = amount ? amount : '';
    return c;
  }
  /**
   * opts : { main, pp, t213, sides, editable, compact, onSide(field, montant) }
   * Un toucher sur un emplacement rouge fait défiler 0 → 5 → 10 → 25 → 50 → 0.
   */
  function spotsEl(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'spots' + (opts.compact ? ' compact' : '');
    const side = (field, label, title) => {
      const amount = opts[field] || 0;
      const b = document.createElement(opts.editable ? 'button' : 'div');
      b.className = 'spot side' + (amount ? ' filled' : '');
      if (opts.editable) {
        b.type = 'button';
        b.title = title + ' — touche pour changer la mise';
        b.addEventListener('click', () => {
          const next = SIDE_STEPS[(SIDE_STEPS.indexOf(amount) + 1) % SIDE_STEPS.length] || 0;
          if (window.Sfx) Sfx.chips();
          opts.onSide(field, next);
        });
      }
      b.appendChild(chipStack(amount));
      const l = document.createElement('span');
      l.className = 'spot-label';
      l.textContent = label;
      b.appendChild(l);
      return b;
    };
    if (opts.sides) wrap.appendChild(side('t213', '21+3', '21+3 : tes 2 cartes + la carte visible du croupier'));
    const main = document.createElement('div');
    main.className = 'spot main' + (opts.main ? ' filled' : '');
    main.appendChild(chipStack(opts.main));
    const ml = document.createElement('span');
    ml.className = 'spot-label';
    ml.textContent = 'Mise';
    main.appendChild(ml);
    wrap.appendChild(main);
    if (opts.sides) wrap.appendChild(side('pp', 'Paire', 'Paire parfaite : tes 2 premières cartes forment une paire'));
    return wrap;
  }

  // ---------- Déroulement ----------
  function availableActions() {
    const h = round.hands[round.active];
    const two = h.cards.length === 2;
    const affordable = stats.bankroll >= h.bet;
    const canDouble = two && affordable;
    const canSplit = two && affordable && round.hands.length < MAX_HANDS &&
      Strategy.cardValue(h.cards[0].rank) === Strategy.cardValue(h.cards[1].rank);
    const canSurrender = two && round.hands.length === 1 && !h.split && !soloEnhc(); // pas d'abandon en règle européenne
    return { H: true, S: true, D: canDouble, P: canSplit, R: canSurrender };
  }

  // Donne une carte puis laisse le temps de la voir
  async function give(cards, factor) {
    cards.push(draw());
    render();
    await sleep(factor);
  }

  async function deal() {
    if ($('coach-bubble')) $('coach-bubble').hidden = true;
    if (busy || bet < MIN_BET || bet > maxBetNow() || bet + side.pp + side.t213 > stats.bankroll) return;
    if (round && round.phase !== 'over') return;
    busy = true;
    let srvPhase = null;
    if (srvMode()) {
      const r = await Casino.call('bj.deal', { bet, pp: side.pp, t213: side.t213 });
      if (r.error) { busy = false; setMessage('⚠️ ' + r.error); render(); return; }
      srvQueue = r.cards.slice(); srvStack = r.stack; srvPhase = r.phase;
      setMessage(r.shuffled ? 'Le sabot est mélangé à nouveau.' : 'Distribution…');
    } else if (shoe.length < DECKS * 52 * 0.25) {
      buildShoe();
      setMessage('Le sabot est mélangé à nouveau.');
    } else {
      setMessage('Distribution…');
    }
    hideQuiz();
    // téléphone : la table entière (croupier compris) revient à l'écran pour jouer
    if (window.matchMedia('(max-width: 600px)').matches) $('solo-view').scrollIntoView({ block: 'start', behavior: 'smooth' });
    stats.bankroll -= bet + side.pp + side.t213;
    stats.maxBetRatio = Math.max(stats.maxBetRatio, bet / (stats.bankroll + bet));
    round = {
      dealer: [],
      hands: [{ cards: [], bet, done: false }],
      active: 0, phase: 'dealing', decisions: [], pp: side.pp, t213: side.t213, sideText: '',
    };
    render();
    await sleep(0.4);
    const player = round.hands[0].cards;
    const enhc = soloEnhc();
    round.enhc = enhc;
    await give(player);
    await give(round.dealer, enhc ? 0.8 : 1);
    await give(player, enhc ? 0.8 : 1);
    // Règle américaine : 2e carte du croupier face cachée. Règle européenne : elle viendra après les joueurs.
    if (!enhc) await give(round.dealer, 0.8);
    settleSideBets(player, round.dealer[0]);

    const up = Strategy.cardValue(round.dealer[0].rank);
    const dealerBJ = !enhc && isBlackjack(round.dealer);

    // Assurance : proposée quand le croupier montre un As
    if (up === 11) {
      const cost = Math.floor(bet / 2);
      const offer = srvMode() ? srvPhase === 'insurance' : cost > 0 && stats.bankroll >= cost;
      const took = offer ? await askInsurance(cost) : false;
      if (srvMode() && offer) {
        const r = await Casino.call('bj.ins', { take: took });
        if (!r.error) { srvQueue = srvQueue.concat(r.cards); srvStack = r.stack; }
      }
      recordInsurance(took);
      if (took) { round.ins = cost; stats.bankroll -= cost; render(); }
      if (!enhc) {
        setMessage('Le croupier vérifie s\'il a un blackjack…');
        await sleep(1);
      }
    }

    if (enhc && isBlackjack(player)) {
      // Règle européenne : le blackjack du joueur attend la 2e carte du croupier
      setMessage('Blackjack ! Le croupier tire sa deuxième carte…');
      round.hands[0].done = true;
      round.active = 1;
      await dealerTurn();
      return;
    }
    if (!enhc && (isBlackjack(player) || (dealerBJ && up >= 10))) {
      if (dealerBJ && up >= 10) {
        setMessage('Le croupier vérifie sa carte cachée…');
        await sleep(0.8);
      }
      round.phase = 'over';
      render();
      await sleep(0.8);
      busy = false;
      settle();
      return;
    }
    round.phase = 'playing';
    busy = false;
    setMessage('À toi de jouer !');
    render();
    maybeShowHint();
    startTimer(() => act('S'));
  }

  async function act(action) {
    if (busy || !round || round.phase !== 'playing') return;
    const opts = availableActions();
    if (!opts[action]) return;
    stopTimer();
    const h = round.hands[round.active];
    const o = withCount({ canDouble: opts.D, canSplit: opts.P, canSurrender: opts.R });
    const rec = Strategy.recommend(h.cards, round.dealer[0].rank, o);
    setSituation({ cards: h.cards, up: round.dealer[0].rank, opts: o }, action);
    recordDecision(rec, action);
    busy = true;
    if (srvMode()) {
      const r = await Casino.call('bj.act', { action });
      if (r.error) { busy = false; setMessage('⚠️ ' + r.error); render(); return; }
      srvQueue = srvQueue.concat(r.cards); srvStack = r.stack;
    }

    if (action === 'H') {
      await give(h.cards, 0.8);
      const v = value(h.cards).total;
      if (v > 21) { setMessage('Tu sautes avec ' + v + ' !'); await sleep(0.8); }
      if (v >= 21) h.done = true;
    } else if (action === 'S') {
      h.done = true;
    } else if (action === 'D') {
      stats.bankroll -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      setMessage('Tu doubles : une seule carte.');
      await give(h.cards, 1);
      h.done = true;
    } else if (action === 'R') {
      h.surrendered = true;
      h.done = true;
      setMessage('Tu abandonnes : la moitié de ta mise t\'est rendue.');
      await sleep(0.6);
    } else if (action === 'P') {
      stats.bankroll -= h.bet;
      const second = { cards: [h.cards.pop()], bet: h.bet, done: false, split: true };
      h.split = true;
      const aces = h.cards[0].rank === 'A';
      round.hands.splice(round.active + 1, 0, second);
      setMessage(aces ? 'As séparés : une carte par main.' : 'Main séparée.');
      render();
      await sleep(0.6);
      await give(h.cards);
      if (aces) { await give(second.cards); h.done = true; second.done = true; }
    }
    if (value(h.cards).total === 21) h.done = true;
    await advance();
  }

  async function advance() {
    while (round.active < round.hands.length && round.hands[round.active].done) round.active++;
    if (round.active < round.hands.length) {
      const h = round.hands[round.active];
      if (h.cards.length === 1) {
        render();
        await sleep(0.5);
        await give(h.cards);
      }
      if (value(h.cards).total === 21) { h.done = true; return advance(); }
      busy = false;
      if (round.hands.length > 1) setMessage('Main ' + (round.active + 1) + ' sur ' + round.hands.length + ' : à toi de jouer.');
      else setMessage('À toi de jouer !');
      render();
      maybeShowHint();
      startTimer(() => act('S'));
      return;
    }
    await dealerTurn();
  }

  // Tour du croupier : retourne sa carte cachée (règle américaine) ou tire sa 2e carte (règle européenne),
  // puis tire une carte à la fois jusqu'à 17
  async function dealerTurn() {
    round.phase = 'dealer';
    const enhc = round.enhc;
    const live = round.hands.filter((h) => value(h.cards).total <= 21 && !h.surrendered);
    const onlyNaturals = live.length > 0 && live.every((h) => round.hands.length === 1 && isBlackjack(h.cards));
    if (enhc) {
      setMessage(live.length ? 'Le croupier tire sa deuxième carte…' : 'Main terminée.');
      render();
      await sleep(0.6);
      if (live.length) await give(round.dealer, 1);
    } else {
      setMessage('Le croupier retourne sa carte…');
      render();
      await sleep(1.1);
    }
    if (live.length && !onlyNaturals && !isBlackjack(round.dealer)) {
      while (value(round.dealer).total < 17) {
        setMessage('Le croupier a ' + value(round.dealer).total + ', il tire…');
        await sleep(0.5);
        await give(round.dealer, 1);
      }
      const d = value(round.dealer).total;
      setMessage(d > 21 ? 'Le croupier saute avec ' + d + ' !' : 'Le croupier reste sur ' + d + '.');
      await sleep(0.9);
    }
    round.phase = 'over';
    busy = false;
    settle();
  }


  function settle() {
    const d = value(round.dealer).total;
    const dealerBJ = isBlackjack(round.dealer);
    let payout = 0, wagered = 0;
    const single = round.hands.length === 1;

    for (const h of round.hands) {
      const p = value(h.cards).total;
      const pBJ = single && !h.split && isBlackjack(h.cards);
      wagered += h.bet;
      stats.hands++;
      let back = 0;
      if (h.surrendered) { back = h.bet / 2; set(h, 'Abandon −' + h.bet / 2 + ' €', 'lose'); stats.losses++; }
      else if (pBJ && dealerBJ) { back = h.bet; set(h, 'Égalité', 'push'); stats.pushes++; }
      else if (pBJ) { back = h.bet * 2.5; set(h, 'Blackjack ! +' + h.bet * 1.5 + ' €', 'win'); stats.wins++; stats.blackjacks++; }
      else if (dealerBJ) { set(h, 'Blackjack du croupier', 'lose'); stats.losses++; }
      else if (p > 21) { set(h, 'Sauté', 'lose'); stats.losses++; }
      else if (d > 21 || p > d) { back = h.bet * 2; set(h, 'Gagné +' + h.bet + ' €', 'win'); stats.wins++; }
      else if (p === d) { back = h.bet; set(h, 'Égalité', 'push'); stats.pushes++; }
      else { set(h, 'Perdu', 'lose'); stats.losses++; }
      payout += back;
    }
    if (round.ins && dealerBJ) payout += round.ins * 3; // l'assurance paie 2 contre 1
    if (round.ins) {
      round.insText = dealerBJ ? 'Assurance gagnée : +' + round.ins * 2 + ' €' : 'Pas de blackjack : assurance perdue (−' + round.ins + ' €)';
      if (!dealerBJ) stats.net -= round.ins;
    }
    stats.bankroll += payout;
    if (srvMode() && srvStack != null) stats.bankroll = srvStack; // le serveur fait foi
    const net = payout - wagered - (round.ins && dealerBJ ? round.ins : 0);
    stats.net += net;

    let msg = net > 0 ? 'Tu gagnes ' + net + ' € !' : net < 0 ? 'Tu perds ' + (-net) + ' €.' : 'Égalité, mise rendue.';
    if (dealerBJ) msg = 'Le croupier a un blackjack. ' + msg;
    if (round.insText) msg += ' ' + round.insText + '.';
    // Sons : blackjack, victoire, défaite
    if (window.Sfx) {
      const hasBJ = round.hands.length === 1 && !round.hands[0].split && isBlackjack(round.hands[0].cards);
      if (hasBJ) Sfx.blackjack();
      else if (net > 0) Sfx.win(); else if (net < 0) Sfx.lose(); else Sfx.push();
    }
    // Profil du Casino : expérience, défis, succès
    if (window.Casino) {
      Casino.track('bj', {
        net, bet: round.hands.reduce((a, h) => a + (h.doubled ? h.bet / 2 : h.bet), 0),
        blackjack: round.hands.length === 1 && !round.hands[0].split && isBlackjack(round.hands[0].cards),
        doubledWin: round.hands.some((h) => h.doubled && h.resultClass === 'win'),
      });
    }
    if (d > 21) msg = 'Le croupier saute ! ' + msg;
    setMessage(msg);

    // Leçon sur le résultat vs la décision
    const decs = round.decisions;
    if (decs.length) {
      const allGood = decs.every((x) => x.good);
      const anyBad = decs.some((x) => !x.good);
      if (allGood && net < 0) {
        appendFeedbackNote('Tu as bien joué et pourtant perdu : c\'est normal, l\'avantage du croupier est d\'environ 0,5 %. Juge tes décisions, pas le résultat d\'une main.');
      } else if (anyBad && net > 0) {
        appendFeedbackNote('Tu as gagné malgré une erreur : la chance t\'a souri, mais sur le long terme cette décision te coûte de l\'argent.');
      }
    }

    if (stats.bankroll < MIN_BET && mode === 'train') {
      appendFeedbackNote('Entraînement : ton crédit est rechargé à ' + TRAIN_BANK + ' €.');
      stats.bankroll = TRAIN_BANK;
    }
    if (stats.bankroll < MIN_BET && mode === 'real') setTimeout(() => endSession(true), 2500);
    if (bet > stats.bankroll) bet = Math.max(0, Math.min(bet, stats.bankroll));
    saveStats();
    render();
    maybeQuiz();
    if (defi) {
      defi.hands++;
      $('defi-count').textContent = 'Main ' + Math.min(defi.hands + 1, defi.meta.rounds) + ' / ' + defi.meta.rounds + ' · solde de défi : ' + stats.bankroll + ' €';
      if (defi.hands >= defi.meta.rounds || stats.bankroll < MIN_BET) endDefi();
    }
  }

  function set(h, text, cls) { h.result = text; h.resultClass = cls; }

  // Paris annexes : réglés juste après la distribution
  function settleSideBets(cards, up) {
    const parts = [];
    const one = (amount, res, label) => {
      if (!amount) return;
      stats.sideBets++;
      if (res) {
        const win = amount * res.mult;
        stats.bankroll += amount + win;
        stats.sideNet += win;
        parts.push('<span class="win">' + label + ' : ' + res.name + ' +' + win + ' €</span>');
      } else {
        stats.sideNet -= amount;
        parts.push('<span class="lose">' + label + ' perdu −' + amount + ' €</span>');
      }
    };
    one(round.pp, SideBets.perfectPairs(cards[0], cards[1]), 'Paire parfaite');
    one(round.t213, SideBets.twentyOnePlusThree(cards[0], cards[1], up), '21+3');
    round.sideText = parts.join(' · ');
    saveStats();
    render();
  }

  // ---------- Coach ----------
  function patternOf(rec, played) {
    const opt = rec.action;
    if (opt === 'R') return 'missedSurrender';
    if (played === 'R') return 'badSurrender';
    if (opt === 'P') return 'missedSplit';
    if (played === 'P') return 'badSplit';
    if (opt === 'D') return 'missedDouble';
    if (played === 'D') return 'badDouble';
    if (rec.category === 'soft') return 'soft';
    if (opt === 'H' && played === 'S') return rec.total >= 12 ? 'standStiff' : 'standLow';
    if (opt === 'S' && played === 'H') return rec.total >= 17 ? 'hitHigh' : 'hitStiff';
    return 'other';
  }

  function recordDecision(rec, played) {
    const good = rec.action === played;
    stats.decisions++;
    if (good) stats.correct++;
    const cat = stats.cats[rec.category];
    cat[1]++;
    if (good) cat[0]++;
    stats.recent.push(good ? 1 : 0);
    if (stats.recent.length > 30) stats.recent.shift();
    if (!good) {
      const m = stats.mistakes[rec.key] || { count: 0, played: played, optimal: rec.action };
      m.count++;
      m.played = played;
      m.optimal = rec.action;
      stats.mistakes[rec.key] = m;
      const p = patternOf(rec, played);
      stats.patterns[p] = (stats.patterns[p] || 0) + 1;
    }
    if (round && round.decisions) round.decisions.push({ good, rec, played });
    saveStats();

    if ($('opt-coach').checked) showFeedback(rec, played, good);
    else showFeedbackHidden();
  }

  async function endDefi() {
    const d = defi, score = stats.bankroll;
    defi = null;
    $('defi-count').textContent = 'Défi terminé ! Envoi de ton score…';
    await Social.submitChallenge(d.code, score);
    const ch = await Social.getChallenge(d.code);
    Social.showChallengeResult(ch || { code: d.code, meta: d.meta, results: {}, uid: null }, score);
    // retour à l'écran de choix du mode
    buildShoe();
    $('defi-banner').hidden = true;
    history.replaceState(null, '', location.pathname);
    mode = null;
    showSolo();
  }

  // ---------- Assurance ----------
  let insuranceResolve = null;
  function askInsurance(cost) {
    $('ins-cost').textContent = cost;
    $('ins-controls').classList.remove('hidden');
    $('play-controls').classList.add('hidden');
    setMessage('Le croupier montre un As : veux-tu prendre l\'assurance ?');
    if (coachOnSolo() && $('opt-hint').checked) {
      const adv = Strategy.insuranceAdvice(insuranceCount());
      showInsuranceFeedback('hint', '💡 Conseil : ' + adv.label, adv.reason);
    }
    return new Promise((resolve) => {
      insuranceResolve = (took) => {
        insuranceResolve = null;
        stopTimer();
        $('ins-controls').classList.add('hidden');
        resolve(took);
      };
      startTimer(() => insuranceResolve && insuranceResolve(false));
    });
  }
  const coachOnSolo = () => $('opt-coach').checked;
  function insuranceCount() {
    return $('opt-dev').checked ? countCtx.counter.trueCount(countCtx.cardsLeft()) : null;
  }
  function recordInsurance(took) {
    const adv = Strategy.insuranceAdvice(insuranceCount());
    const good = took === adv.take;
    stats.decisions++;
    if (good) stats.correct++;
    stats.recent.push(good ? 1 : 0);
    if (stats.recent.length > 30) stats.recent.shift();
    if (!good) {
      const key = 'Assurance (As du croupier)';
      const m = stats.mistakes[key] || { count: 0 };
      m.count++; m.played = took ? 'I' : 'N'; m.optimal = adv.take ? 'I' : 'N';
      stats.mistakes[key] = m;
      const p = took ? 'insurance' : 'missedInsurance';
      stats.patterns[p] = (stats.patterns[p] || 0) + 1;
    }
    saveStats();
    if (coachOnSolo()) {
      showInsuranceFeedback(good ? 'good' : 'bad', good ? '✔ Bonne décision : ' + (took ? 'assurance prise' : 'assurance refusée')
        : '✘ Tu as ' + (took ? 'pris' : 'refusé') + ' l\'assurance, il fallait la ' + (adv.take ? 'prendre' : 'refuser'), adv.reason);
    }
  }
  function showInsuranceFeedback(cls, verdict, reason) {
    const fb = $('feedback');
    fb.className = 'feedback ' + cls;
    fb.innerHTML = '';
    const v = document.createElement('div'); v.className = 'verdict'; v.textContent = verdict;
    const r = document.createElement('div'); r.textContent = reason;
    fb.append(v, r);
  }

  // ---------- Minuteur de décision (facultatif en solo) ----------
  let timerId = null, timerEnd = 0, timerTotal = 0, lastTick = 0;
  function startTimer(onExpire) {
    stopTimer();
    const secs = parseInt($('opt-timer').value, 10) || 0;
    if (!secs) return;
    timerTotal = secs * 1000;
    timerEnd = Date.now() + timerTotal;
    $('solo-timer').hidden = false;
    const tick = () => {
      const left = timerEnd - Date.now();
      $('solo-timer-bar').style.width = Math.max(0, (left / timerTotal) * 100) + '%';
      $('solo-timer-bar').classList.toggle('urgent', left < 5000);
      $('solo-timer-text').textContent = Math.max(0, Math.ceil(left / 1000)) + ' s';
      const sec = Math.ceil(left / 1000);
      if (left < 5000 && sec !== lastTick && window.Sfx) { lastTick = sec; Sfx.tick(); }
      if (left <= 0) { stopTimer(); onExpire(); }
    };
    tick();
    timerId = setInterval(tick, 200);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    const el = $('solo-timer');
    if (el) el.hidden = true;
  }
  window.BJTimer = { start: startTimer, stop: stopTimer };

  // situation = { cards, up (rang), opts }
  function setSituation(situation, played) {
    lastSituation = Object.assign({ cards: situation.cards.slice(), played: played || null }, situation);
    lastSituation.cards = situation.cards.slice();
  }

  function detailsBlock() {
    const wrap = document.createElement('div');
    wrap.className = 'fb-actions';
    const more = document.createElement('button');
    more.className = 'ghost small';
    more.textContent = '🔎 Plus de détails';
    const box = document.createElement('div');
    box.className = 'details';
    box.hidden = true;
    more.addEventListener('click', () => {
      if (box.hidden && lastSituation) {
        const d = Strategy.details(lastSituation.cards, lastSituation.up, lastSituation.opts);
        box.innerHTML = '';
        d.paragraphs.forEach((t) => { const p = document.createElement('p'); p.textContent = t; box.appendChild(p); });
      }
      box.hidden = !box.hidden;
      more.textContent = box.hidden ? '🔎 Plus de détails' : 'Masquer les détails';
    });
    const ask = document.createElement('button');
    ask.className = 'ghost small';
    ask.textContent = '💬 Demander au coach';
    ask.addEventListener('click', () => {
      if (window.CoachChat) window.CoachChat.askAboutSituation();
    });
    wrap.appendChild(more);
    wrap.appendChild(ask);
    const frag = document.createDocumentFragment();
    frag.appendChild(wrap);
    frag.appendChild(box);
    return frag;
  }

  function showFeedback(rec, played, good) {
    const fb = $('feedback');
    fb.className = 'feedback ' + (good ? 'good' : 'bad');
    const L = Strategy.ACTION_LABELS;
    fb.innerHTML = '<div class="verdict">' + (good
      ? '✔ Bonne décision : ' + L[played]
      : '✘ Tu as choisi « ' + L[played] + ' », il fallait « ' + L[rec.action] + ' »') + '</div>' +
      '<div class="muted small">' + rec.key + '</div>' +
      '<div>' + rec.reason + '</div>';
    fb.appendChild(detailsBlock());
    highlightChart(rec);
    coachBubble(good, good ? '✔ Bonne décision : ' + L[played] : '✘ Il fallait « ' + L[rec.action] + ' »', rec.reason);
  }
  // Téléphone : le retour du coach s'affiche sur la table (le panneau complet est plus bas)
  function coachBubble(good, title, text) {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    let b = $('coach-bubble');
    if (!b) {
      b = document.createElement('button');
      b.id = 'coach-bubble'; b.type = 'button';
      b.addEventListener('click', () => { $('feedback-panel').scrollIntoView({ behavior: 'smooth' }); });
      $('play-controls').before(b);
    }
    b.className = 'coach-bubble ' + (good ? 'good' : 'bad');
    b.innerHTML = '';
    const t = document.createElement('b'); t.textContent = title;
    const d = document.createElement('span'); d.textContent = text.length > 140 ? text.slice(0, 137) + '…' : text;
    const m = document.createElement('small'); m.textContent = 'Touche pour le détail';
    b.append(t, d, m);
    b.hidden = false;
  }

  function showHintFor(rec) {
    const fb = $('feedback');
    fb.className = 'feedback hint';
    fb.innerHTML = '<div class="verdict">💡 Conseil : ' + rec.label + '</div>' +
      '<div class="muted small">' + rec.key + '</div><div>' + rec.reason + '</div>';
    fb.appendChild(detailsBlock());
    highlightChart(rec);
  }

  function showFeedbackHidden() {
    const fb = $('feedback');
    fb.className = 'feedback empty';
    fb.textContent = 'Coach en direct désactivé : consulte tes statistiques et conseils ci-dessous.';
  }

  function appendFeedbackNote(text) {
    const fb = $('feedback');
    if (fb.classList.contains('empty')) { fb.className = 'feedback hint'; fb.innerHTML = ''; }
    const p = document.createElement('p');
    p.className = 'small';
    p.style.margin = '.6rem 0 0';
    p.textContent = '📌 ' + text;
    fb.appendChild(p);
  }

  function showHint() {
    if (mode === 'real') return; // partie réelle : pas de conseils
    if (busy || !round || round.phase !== 'playing') return;
    const h = round.hands[round.active];
    const opts = availableActions();
    const o = withCount({ canDouble: opts.D, canSplit: opts.P, canSurrender: opts.R });
    const rec = Strategy.recommend(h.cards, round.dealer[0].rank, o);
    setSituation({ cards: h.cards, up: round.dealer[0].rank, opts: o });
    showHintFor(rec);
  }
  function maybeShowHint() { if ($('opt-hint').checked) showHint(); }

  const PATTERN_TIPS = {
    standStiff: 'Tu restes trop souvent avec 12-16 contre une carte forte (7 à As). Le croupier finira probablement à 17+ : il faut tirer, même si c\'est risqué.',
    hitStiff: 'Tu tires trop avec 12-16 contre une carte faible (2 à 6). Le croupier saute dans ~40 % des cas : laisse-le prendre le risque.',
    hitHigh: 'Ne tire jamais sur 17 dur ou plus : plus de 69 % des cartes te feraient sauter.',
    standLow: 'Avec 11 ou moins tu ne peux pas sauter : il faut toujours prendre une carte (ou doubler).',
    missedDouble: 'Tu ne doubles pas assez. Avec 10 ou 11, ou une main souple contre un croupier faible, doubler est l\'arme principale du joueur.',
    badDouble: 'Tu doubles dans de mauvaises situations. Réserve le double aux totaux 9-11 et aux mains souples contre 2-6.',
    missedSurrender: 'Pense à l\'abandon : avec 16 contre 9, 10 ou As (et 15 contre 10), abandonner te rend la moitié de ta mise et perd moins que jouer la main.',
    badSurrender: 'Tu abandonnes trop souvent : l\'abandon ne se justifie que dans les pires situations (16 contre 9, 10, As et 15 contre 10).',
    insurance: 'Tu prends l\'assurance : sans comptage de cartes, c\'est un pari perdant (environ −7 %). Refuse-la, sauf si ton compte vrai atteint +3.',
    missedInsurance: 'Avec un compte vrai de +3 ou plus, l\'assurance devient rentable : pense à la prendre dans ces moments-là.',
    missedSplit: 'Pense à séparer : toujours les As et les 8, et les petites paires (2, 3, 6, 7) contre une carte faible.',
    badSplit: 'Évite de séparer les 10, les 5 et les petites paires contre une carte forte du croupier.',
    soft: 'Les mains souples (avec un As compté 11) te posent problème : rappelle-toi qu\'elles ne peuvent pas sauter en tirant une carte, sois plus agressif.',
  };

  function buildTips() {
    const tips = [];
    if (stats.decisions < 5) return ['Joue quelques mains pour recevoir des conseils personnalisés.'];

    const acc = stats.correct / stats.decisions;
    const recent = stats.recent.length ? stats.recent.reduce((a, b) => a + b, 0) / stats.recent.length : acc;

    // Erreurs récurrentes
    const pats = Object.entries(stats.patterns).sort((a, b) => b[1] - a[1]);
    for (const [p, n] of pats.slice(0, 3)) {
      if (PATTERN_TIPS[p] && n >= 1) tips.push(PATTERN_TIPS[p] + ' (' + n + '×)');
    }

    // Catégorie la plus faible
    let worst = null;
    for (const k of Object.keys(stats.cats)) {
      const [c, t] = stats.cats[k];
      if (t >= 4 && c / t < 0.85 && (!worst || c / t < worst.r)) worst = { k, r: c / t };
    }
    if (worst) tips.push('Ta catégorie la plus faible : ' + CAT_LABELS[worst.k].toLowerCase() + ' (' + Math.round(worst.r * 100) + ' %). Ouvre le tableau de stratégie et révise cette section.');

    // Progression
    if (stats.decisions >= 30 && recent > acc + 0.05) tips.push('Tu progresses : ta précision récente (' + Math.round(recent * 100) + ' %) dépasse ta moyenne. Continue !');
    else if (stats.decisions >= 30 && recent < acc - 0.08) tips.push('Ta précision baisse sur les dernières mains : prends ton temps ou active « Afficher le conseil » quelques mains.');

    // Gestion de la banque
    if (stats.maxBetRatio > 0.1) tips.push('Gestion de la banque : tu as déjà misé ' + Math.round(stats.maxBetRatio * 100) + ' % de ta banque sur une seule main. Vise plutôt 1 à 5 % pour encaisser les séries perdantes.');

    if (stats.sideBets >= 5 && stats.sideNet < 0) tips.push('Paris annexes : tu y as perdu ' + (-stats.sideNet) + ' € sur ' + stats.sideBets + ' paris. Ils sont amusants, mais la maison y a un avantage de 4 à 7 % (contre 0,5 % sur la main principale avec une bonne stratégie).');
    if (stats.countQuiz >= 3) {
      const r = stats.countQuizOk / stats.countQuiz;
      if (r < 0.7) tips.push('Comptage : ' + Math.round(r * 100) + ' % de bonnes réponses. Active « Afficher +1/−1 sur les cartes » quelques mains, et compte par paires de cartes (un 5 et un roi s\'annulent).');
      else if (stats.countQuiz >= 10 && r >= 0.9) tips.push('Ton comptage est solide (' + Math.round(r * 100) + ' %). Prochaine étape : convertir en compte vrai et ajuster ta mise.');
    }
    if (acc >= 0.95 && stats.decisions >= 50) {
      tips.push('Excellent : ta stratégie de base est quasi parfaite ! Désactive le coach en direct pour te tester, puis intéresse-toi au comptage de cartes (Hi-Lo).');
    }
    tips.push('Ne prends jamais l\'assurance : elle a une espérance négative sans comptage de cartes.');
    return tips;
  }

  function renderStats() {
    const acc = stats.decisions ? Math.round((stats.correct / stats.decisions) * 100) + ' %' : '–';
    $('s-accuracy').textContent = acc;
    $('s-decisions').textContent = stats.decisions;
    $('s-hands').textContent = stats.hands;
    $('s-net').textContent = (stats.net > 0 ? '+' : '') + stats.net + ' €';
    $('s-net').style.color = stats.net > 0 ? 'var(--good)' : stats.net < 0 ? 'var(--bad)' : '';

    const bars = $('cat-bars');
    bars.innerHTML = '';
    for (const k of Object.keys(CAT_LABELS)) {
      const [c, t] = stats.cats[k];
      const r = t ? c / t : 0;
      const row = document.createElement('div');
      row.className = 'bar-row';
      const cls = r >= 0.9 ? '' : r >= 0.75 ? 'mid' : 'low';
      row.innerHTML = '<span>' + CAT_LABELS[k] + '</span><div class="bar"><div class="' + cls + '" style="width:' + (t ? r * 100 : 0) + '%"></div></div>' +
        '<span class="muted">' + (t ? Math.round(r * 100) + ' %' : '–') + '</span>';
      bars.appendChild(row);
    }
    $('s-wlp').textContent = 'Victoires ' + stats.wins + ' · Défaites ' + stats.losses + ' · Égalités ' + stats.pushes + ' · Blackjacks ' + stats.blackjacks;

    $('tips').innerHTML = buildTips().map((t) => '<li>' + t + '</li>').join('');

    const L = Strategy.ACTION_LABELS;
    const ms = Object.entries(stats.mistakes).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    $('mistakes').innerHTML = ms.length
      ? ms.map(([k, m]) => '<li><b>' + k + '</b> : tu as fait « ' + L[m.played] + ' », il faut « ' + L[m.optimal] + ' » <span class="muted">(' + m.count + '×)</span></li>').join('')
      : '<li class="muted">Aucune erreur pour l\'instant.</li>';
  }

  // ---------- Tableau de stratégie ----------
  const CHART_LABELS = { H: 'T', S: 'R', D: 'D', Ds: 'Dr', P: 'S', R: 'Ab' };
  function renderChart() {
    const ch = Strategy.chart(countCtx.enhc ? countCtx.enhc() : false);
    const head = '<tr><th></th>' + ch.ups.map((u) => '<th>' + (u === 11 ? 'A' : u) + '</th>').join('') + '</tr>';
    const table = (title, rows) => '<table><caption>' + title + '</caption>' + head +
      rows.map((r) => '<tr data-row="' + r.key + '"><th>' + r.label + '</th>' +
        r.cells.map((c, i) => '<td class="' + c + '" data-col="' + ch.ups[i] + '">' + CHART_LABELS[c] + '</td>').join('') + '</tr>').join('') +
      '</table>';
    $('chart').innerHTML = table('Mains dures', ch.hard) + table('Mains souples', ch.soft) + table('Paires', ch.pairs);
  }

  function highlightChart(rec) {
    document.querySelectorAll('#chart td.current').forEach((td) => td.classList.remove('current'));
    if (!lastSituation) return;
    const up = Strategy.cardValue(lastSituation.up);
    let rowKey;
    if (rec.category === 'pair') {
      rowKey = 'pair-' + Strategy.cardValue(lastSituation.cards[0].rank);
    } else if (rec.category === 'soft') {
      if (rec.total < 13 || rec.total > 20) return;
      rowKey = 'soft-' + rec.total;
    } else {
      rowKey = 'hard-' + Math.min(17, Math.max(8, rec.total));
    }
    const td = document.querySelector('#chart tr[data-row="' + rowKey + '"] td[data-col="' + up + '"]');
    if (td) td.classList.add('current');
  }

  function setMessage(t) { $('message').textContent = t; }

  // ---------- Comptage de cartes ----------
  // Ajoute le compte vrai aux options si les conseils ajustés au comptage sont activés
  function withCount(o) {
    if ($('opt-dev').checked) o.trueCount = countCtx.counter.trueCount(countCtx.cardsLeft());
    o.enhc = countCtx.enhc ? countCtx.enhc() : false;
    return o;
  }
  function renderCount() {
    const c = countCtx.counter;
    const left = countCtx.cardsLeft();
    const hidden = $('opt-count-hide').checked;
    const tc = c.trueCount(left);
    $('c-running').textContent = hidden ? '?' : HiLo.signed(c.running);
    $('c-decks').textContent = (left / 52).toFixed(1);
    $('c-true').textContent = hidden ? '?' : HiLo.signed(Math.round(tc * 10) / 10);
    $('c-advice').textContent = hidden ? 'Compte masqué : entraîne-toi à le suivre de tête.' : HiLo.betAdvice(tc).text;
    const q = stats.countQuiz;
    $('c-quiz-score').textContent = q ? 'Quiz : ' + stats.countQuizOk + '/' + q + ' bonnes réponses' : '';
  }

  function hideQuiz() { $('count-quiz').hidden = true; }
  function maybeQuiz() {
    if (!$('opt-count-hide').checked || countCtx !== soloCtx) return;
    $('count-quiz').hidden = false;
    $('quiz-answer').value = '';
    $('quiz-result').textContent = '';
    $('quiz-result').className = 'small';
  }
  function checkQuiz() {
    const raw = $('quiz-answer').value.trim().replace('−', '-').replace('+', '');
    if (raw === '' || isNaN(parseInt(raw, 10))) return;
    const ans = parseInt(raw, 10);
    const real = countCtx.counter.running;
    stats.countQuiz++;
    const ok = ans === real;
    if (ok) stats.countQuizOk++;
    $('quiz-result').className = 'small ' + (ok ? 'ok' : 'ko');
    $('quiz-result').textContent = ok ? '✔ Exact : le compte courant est ' + HiLo.signed(real) + '.'
      : '✘ Le compte courant est ' + HiLo.signed(real) + ' (tu as répondu ' + HiLo.signed(ans) + ').';
    saveStats();
    renderStats();
    const st = $('c-quiz-score');
    st.textContent = 'Quiz : ' + stats.countQuizOk + '/' + stats.countQuiz + ' bonnes réponses';
  }

  // Résumé de la situation et des statistiques, pour le chat du coach
  function getContext() {
    const lines = [];
    if (lastSituation) {
      const cards = lastSituation.cards.map((c) => c.rank + c.suit).join(' ');
      const rec = Strategy.recommend(lastSituation.cards, lastSituation.up, lastSituation.opts);
      lines.push('Dernière situation analysée : main du joueur ' + cards + ' (' + rec.key + '), carte visible du croupier ' + lastSituation.up + '.');
      if (lastSituation.played) lines.push('Le joueur a choisi : ' + Strategy.ACTION_LABELS[lastSituation.played] + '.');
      lines.push('Stratégie de base : ' + rec.label + '. Explication courte : ' + rec.reason);
    }
    if (stats.decisions) {
      lines.push('Précision du joueur : ' + Math.round(stats.correct / stats.decisions * 100) + ' % sur ' + stats.decisions + ' décisions.');
      const ms = Object.entries(stats.mistakes).sort((a, b) => b[1].count - a[1].count).slice(0, 3);
      if (ms.length) lines.push('Erreurs fréquentes : ' + ms.map(([k, m]) => k + ' (a fait ' + Strategy.ACTION_LABELS[m.played] + ' au lieu de ' + Strategy.ACTION_LABELS[m.optimal] + ')').join(' ; ') + '.');
    }
    const c = countCtx.counter;
    lines.push('Comptage Hi-Lo : compte courant ' + c.running + ', compte vrai ' + c.trueCount(countCtx.cardsLeft()).toFixed(1) + '.');
    return lines.join('\n');
  }

  // API partagée avec la table entre amis et le chat du coach
  window.BJ = {
    cardEl, spotsEl, recordDecision, setSituation, showHintFor, highlightChart,
    getContext, render, renderStats,
    getStats: () => stats,
    withCount, recordInsurance,
    showInsuranceHint() {
      const adv = Strategy.insuranceAdvice(insuranceCount());
      showInsuranceFeedback('hint', '💡 Conseil : ' + adv.label, adv.reason);
    },
    showSolo,
    setCountCtx(ctx) { countCtx = ctx || soloCtx; renderCount(); renderChart(); },
    renderCount,
  };

  // ---------- Événements ----------
  document.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    const v = parseInt(b.dataset.chip, 10);
    if (bet + v > maxBetNow()) setMessage('Mise maximale : ' + maxBetNow() + ' € par main' + (mode === 'real' ? ' dans ton salon (elle monte avec ton niveau).' : '.'));
    else if (bet + v <= stats.bankroll) { bet += v; if (window.Sfx) Sfx.chips(); }
    render();
  }));
  $('clear-bet').addEventListener('click', () => { bet = 0; render(); });
  $('deal').addEventListener('click', deal);
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => act(b.dataset.action)));
  $('hint').addEventListener('click', showHint);
  try { const r = localStorage.getItem('bj-rule'); if (r) $('opt-rule').value = r; } catch (e) { /* ignore */ }
  $('opt-rule').addEventListener('change', () => {
    try { localStorage.setItem('bj-rule', $('opt-rule').value); } catch (e) { /* ignore */ }
    renderChart();
  });
  $('ins-yes').addEventListener('click', () => insuranceResolve && insuranceResolve(true));
  $('ins-no').addEventListener('click', () => insuranceResolve && insuranceResolve(false));
  $('opt-tags').addEventListener('change', () => { if (window.Multi) window.Multi.rerender(); render(); });
  $('opt-count-hide').addEventListener('change', () => { renderCount(); hideQuiz(); });
  $('quiz-check').addEventListener('click', checkQuiz);
  $('quiz-answer').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); checkQuiz(); } });
  $('opt-hint').addEventListener('change', maybeShowHint);
  $('opt-speed').addEventListener('change', applySpeed);
  let resetArmed = false;
  $('reset').addEventListener('click', () => {
    if (busy) return;
    const btn = $('reset');
    if (!resetArmed) {
      resetArmed = true;
      btn.textContent = 'Clique encore pour confirmer';
      setTimeout(() => { resetArmed = false; btn.textContent = 'Réinitialiser les statistiques'; }, 3000);
      return;
    }
    resetArmed = false;
    btn.textContent = 'Réinitialiser les statistiques';
    const keep = stats.bankroll; // l'argent sur la table n'est pas remis à zéro
    stats = freshStats();
    stats.bankroll = keep;
    saveStats();
    round = null;
    bet = 10;
    $('feedback').className = 'feedback empty';
    $('feedback').textContent = 'Tes décisions seront analysées ici.';
    setMessage('Place ta mise et clique sur « Distribuer ».');
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (document.body.dataset.mode === 'multi') return;
    const k = e.key.toLowerCase();
    if (round && round.phase === 'playing') {
      const map = { t: 'H', r: 'S', d: 'D', s: 'P', a: 'R' };
      if (map[k]) act(map[k]);
      else if (k === 'c') showHint();
    } else if (k === 'enter' || k === ' ') {
      e.preventDefault();
      deal();
    }
  });

  // ---------- Choix du mode, encaissement ----------
  function startMode(m, amount) {
    mode = m;
    if (window.Casino) Casino.training = m === 'train';
    stats.bankroll = amount;
    bet = Math.min(10, amount);
    if (m === 'real') ['opt-coach', 'opt-hint', 'opt-tags', 'opt-dev'].forEach((id) => { $(id).checked = false; });
    else $('opt-coach').checked = true;
    // Partie réelle : règle européenne (pas de carte cachée), comme dans les casinos français
    if (m === 'real') $('opt-rule').value = 'eu';
    $('opt-rule').disabled = m === 'real';
    srvQueue = []; srvStack = null;
    round = null;
    buildShoe();
    $('feedback').className = 'feedback empty';
    $('feedback').textContent = 'Tes décisions seront analysées ici.';
    setMessage(m === 'real' ? 'Partie réelle : place ta mise. Pas de coach, mais ta précision est mesurée.' : 'Place ta mise et clique sur « Distribuer ».');
    saveStats();
    showSolo();
  }
  function showSolo() {
    if (document.body.dataset.mode === 'multi') return;
    if (window.Casino) Casino.training = mode === 'train';
    document.body.classList.toggle('no-coach', mode === 'real');
    const playing = !!mode;
    $('bj-setup').hidden = playing;
    $('solo-view').hidden = !playing;
    const badge = $('mode-badge');
    badge.hidden = !playing || mode === 'defi';
    badge.className = 'cm-badge mode-line' + (mode === 'real' ? ' real' : '');
    badge.textContent = mode === 'real' ? '💰 Partie réelle · sans aides · « Encaisser » ramène tes jetons à la banque' : '🎓 Apprentissage · crédit illimité, aides et conseils · ne compte pas';
    $('cashout').hidden = mode === 'defi' || mode === 'train';
    $('bank-label').textContent = mode === 'real' ? 'Sur la table' : mode === 'train' ? 'Crédit d\'apprentissage' : mode === 'defi' ? 'Jetons de défi' : 'Banque';
    if (!mode && window.Casino) { $('bankroll').textContent = (Math.round(Casino.wallet() * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
    $('cashout').textContent = mode === 'train' ? 'Terminer' : 'Encaisser';
    if (!playing) { renderPicker(); return; }
    render();
  }
  function renderPicker(msg) {
    if (!window.Casino) { startMode('train', TRAIN_BANK); return; }
    Casino.modePicker($('mode-picker'), { game: 'blackjack', min: MIN_BET, suggest: 100, onStart: (m, amount) => startMode(m, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'end-msg'; p.textContent = msg; $('mode-picker').prepend(p); }
  }
  async function endSession(broke) {
    if (busy || (round && round.phase !== 'over')) return;
    let msg = 'Entraînement terminé.';
    if (mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('blackjack');
      if (r && r.error) { setMessage('⚠️ ' + r.error); return; }
      const diff = r ? r.diff : 0;
      msg = broke ? 'Tout est perdu : il ne reste plus assez pour la mise minimale.' :
        'Tu encaisses ' + (r ? r.end : stats.bankroll) + ' € (' + (diff >= 0 ? '+' : '−') + Math.abs(diff) + ' € par rapport à la somme apportée).';
      Casino.toast(broke ? 'Partie perdue' : 'Encaissé !', msg, broke ? '💸' : '💰', diff > 0 ? 'gold' : '');
    }
    mode = null;
    round = null;
    if (window.Casino) Casino.training = false;
    showSolo();
    renderPicker(msg);
  }
  let cashArmed = false;
  $('cashout').addEventListener('click', () => {
    if (busy || (round && round.phase !== 'over')) { setMessage('Termine la main en cours avant d\'encaisser.'); return; }
    if (!cashArmed) {
      cashArmed = true;
      $('cashout').textContent = mode === 'train' ? 'Sûr ?' : 'Encaisser ' + stats.bankroll + ' € ?';
      setTimeout(() => { cashArmed = false; if (mode) $('cashout').textContent = mode === 'train' ? 'Terminer' : 'Encaisser'; }, 3000);
      return;
    }
    cashArmed = false;
    endSession(false);
  });

  buildShoe();
  applySpeed();
  // Lien de défi (?defi=CODE) : 10 mains, jetons de défi, même sabot pour tous
  const defiCode = new URLSearchParams(location.search).get('defi');
  if (defiCode && window.Social) {
    Social.getChallenge(defiCode).then((ch) => {
      if (!ch || ch.meta.game !== 'blackjack') return;
      defi = { code: defiCode, meta: ch.meta, hands: 0 };
      mode = 'defi';
      if (window.Casino) Casino.training = false;
      stats.bankroll = ch.meta.bank;
      bet = 10;
      buildShoe(Social.rng(ch.meta.seed));
      $('defi-banner').hidden = false;
      $('defi-text').textContent = 'Défi de ' + ch.meta.by + ' : ' + ch.meta.rounds + ' mains avec ' + ch.meta.bank + ' € de jetons de défi. Tout le monde a le même sabot : fais le meilleur solde final ! (Ton portefeuille n\'est pas touché.)';
      $('defi-count').textContent = 'Main 1 / ' + ch.meta.rounds;
      showSolo();
    });
  }
  renderChart();
  showSolo();
})();
