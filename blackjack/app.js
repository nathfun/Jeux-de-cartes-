(function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DECKS = 6;
  const MAX_HANDS = 4;
  const START_BANKROLL = 1000;
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
  }

  // ---------- Sabot ----------
  function buildShoe() {
    soloCtx.counter.reset();
    shoe = [];
    for (let d = 0; d < DECKS; d++)
      for (const s of SUITS) for (const r of RANKS) shoe.push({ rank: r, suit: s });
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
  }
  let cardSeq = 0;
  function draw() {
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
  const soloCtx = { shown: new Map(), counter: HiLo.create(), cardsLeft: () => shoe.length };
  let countCtx = soloCtx; // contexte affiché dans le panneau de comptage

  // ---------- Rendu des cartes ----------
  function cardEl(card, hidden, ctx) {
    ctx = ctx || soloCtx;
    const el = document.createElement('div');
    const prev = ctx.shown.get(card.id);
    const anim = !prev ? ' dealt' : (prev === 'hidden' && !hidden ? ' flip' : '');
    ctx.shown.set(card.id, hidden ? 'hidden' : 'shown');
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
    $('play-controls').classList.toggle('hidden', !inRound);
    $('deal').disabled = busy || bet <= 0 || bet + side.pp + side.t213 > stats.bankroll;

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
  const SIDE_STEPS = [0, 5, 10, 25, 50];
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
    return { H: true, S: true, D: canDouble, P: canSplit };
  }

  // Donne une carte puis laisse le temps de la voir
  async function give(cards, factor) {
    cards.push(draw());
    render();
    await sleep(factor);
  }

  async function deal() {
    if (busy || bet <= 0 || bet + side.pp + side.t213 > stats.bankroll) return;
    if (round && round.phase !== 'over') return;
    busy = true;
    if (shoe.length < DECKS * 52 * 0.25) {
      buildShoe();
      setMessage('Le sabot est mélangé à nouveau.');
    } else {
      setMessage('Distribution…');
    }
    hideQuiz();
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
    await give(player);
    await give(round.dealer);
    await give(player);
    await give(round.dealer, 0.8);
    settleSideBets(player, round.dealer[0]);

    const up = Strategy.cardValue(round.dealer[0].rank);
    const dealerBJ = isBlackjack(round.dealer);

    if (isBlackjack(player) || (dealerBJ && up >= 10)) {
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
  }

  async function act(action) {
    if (busy || !round || round.phase !== 'playing') return;
    const opts = availableActions();
    if (!opts[action]) return;
    const h = round.hands[round.active];
    const o = withCount({ canDouble: opts.D, canSplit: opts.P });
    const rec = Strategy.recommend(h.cards, round.dealer[0].rank, o);
    setSituation({ cards: h.cards, up: round.dealer[0].rank, opts: o }, action);
    recordDecision(rec, action);
    busy = true;

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
      return;
    }
    // Tour du croupier : retourne la carte cachée puis tire une carte à la fois
    round.phase = 'dealer';
    setMessage('Le croupier retourne sa carte…');
    render();
    await sleep(1.1);
    const allBust = round.hands.every((h) => value(h.cards).total > 21);
    if (!allBust) {
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
      if (pBJ && dealerBJ) { back = h.bet; set(h, 'Égalité', 'push'); stats.pushes++; }
      else if (pBJ) { back = h.bet * 2.5; set(h, 'Blackjack ! +' + h.bet * 1.5 + ' €', 'win'); stats.wins++; stats.blackjacks++; }
      else if (dealerBJ) { set(h, 'Blackjack du croupier', 'lose'); stats.losses++; }
      else if (p > 21) { set(h, 'Sauté', 'lose'); stats.losses++; }
      else if (d > 21 || p > d) { back = h.bet * 2; set(h, 'Gagné +' + h.bet + ' €', 'win'); stats.wins++; }
      else if (p === d) { back = h.bet; set(h, 'Égalité', 'push'); stats.pushes++; }
      else { set(h, 'Perdu', 'lose'); stats.losses++; }
      payout += back;
    }
    stats.bankroll += payout;
    const net = payout - wagered;
    stats.net += net;

    let msg = net > 0 ? 'Tu gagnes ' + net + ' € !' : net < 0 ? 'Tu perds ' + (-net) + ' €.' : 'Égalité, mise rendue.';
    if (dealerBJ) msg = 'Le croupier a un blackjack. ' + msg;
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

    if (stats.bankroll < 5) {
      appendFeedbackNote('Banque épuisée ! Elle a été remise à ' + START_BANKROLL + ' € pour continuer l\'entraînement.');
      stats.bankroll = START_BANKROLL;
    }
    if (bet > stats.bankroll) bet = Math.max(0, Math.min(bet, stats.bankroll));
    saveStats();
    render();
    maybeQuiz();
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
    if (busy || !round || round.phase !== 'playing') return;
    const h = round.hands[round.active];
    const opts = availableActions();
    const o = withCount({ canDouble: opts.D, canSplit: opts.P });
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
  const CHART_LABELS = { H: 'T', S: 'R', D: 'D', Ds: 'Dr', P: 'S' };
  function renderChart() {
    const ch = Strategy.chart();
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
    withCount,
    setCountCtx(ctx) { countCtx = ctx || soloCtx; renderCount(); },
    renderCount,
  };

  // ---------- Événements ----------
  document.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    const v = parseInt(b.dataset.chip, 10);
    if (bet + v <= stats.bankroll) bet += v;
    render();
  }));
  $('clear-bet').addEventListener('click', () => { bet = 0; render(); });
  $('deal').addEventListener('click', deal);
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => act(b.dataset.action)));
  $('hint').addEventListener('click', showHint);
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
    stats = freshStats();
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
      const map = { t: 'H', r: 'S', d: 'D', s: 'P' };
      if (map[k]) act(map[k]);
      else if (k === 'c') showHint();
    } else if (k === 'enter' || k === ' ') {
      e.preventDefault();
      deal();
    }
  });

  buildShoe();
  applySpeed();
  renderChart();
  render();
})();
