/*
 * Moteur de Texas Hold'em No-Limit, écrit en fonctions pures sur un état JSON
 * (le même état sert en solo et entre amis).
 *
 * État :
 *  { seats: [{ id, name, stack, cards: [], bet, total, folded, allin, acted, out, last }],
 *    button, sb, bb, street: 'idle'|'preflop'|'flop'|'turn'|'river'|'showdown',
 *    board: [], deck: [], currentBet, minRaise, toAct, handNo, cardSeq, results, log: [] }
 *  bet   = mise sur le tour d'enchères en cours ; total = mise totale de la main.
 *  out   = siège vide ou joueur sans jetons (ne reçoit pas de cartes).
 */
(function (root) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./eval.js') : root.PokerEval;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function createTable(opts) {
    return {
      seats: [], button: -1, sb: opts.sb || 10, bb: opts.bb || 20,
      street: 'idle', board: [], deck: [], currentBet: 0, minRaise: opts.bb || 20,
      toAct: -1, handNo: 0, cardSeq: 0, results: null, log: [],
    };
  }

  function addSeat(st, seat) {
    st.seats.push(Object.assign({ cards: [], bet: 0, total: 0, folded: false, allin: false, acted: false, out: false, last: '' }, seat));
  }

  const inHand = (s) => !s.out && !s.folded && s.cards.length > 0;
  const canAct = (s) => inHand(s) && !s.allin;
  function next(st, from, pred) {
    const n = st.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (pred(st.seats[i], i)) return i;
    }
    return -1;
  }
  const pot = (st) => st.seats.reduce((a, s) => a + s.total, 0);

  function draw(st) {
    const raw = st.deck.pop();
    st.cardSeq++;
    return { rank: raw.rank, suit: raw.suit, id: st.cardSeq };
  }

  function log(st, text) {
    st.log.push(text);
    if (st.log.length > 40) st.log.shift();
  }

  function put(st, i, amount) {
    const s = st.seats[i];
    const a = Math.min(amount, s.stack);
    s.stack -= a; s.bet += a; s.total += a;
    if (s.stack === 0) s.allin = true;
    return a;
  }

  /** Démarre une nouvelle main. Renvoie false s'il n'y a pas au moins 2 joueurs avec des jetons. */
  function startHand(st) {
    st.seats.forEach((s) => {
      s.out = s.out || s.stack <= 0;
      s.cards = []; s.bet = 0; s.total = 0; s.folded = false; s.allin = false; s.acted = false; s.last = '';
      s.won = 0; s.shown = false; s.handName = '';
    });
    const players = st.seats.filter((s) => !s.out);
    if (players.length < 2) return false;
    st.handNo++;
    st.board = []; st.results = null;
    st.deck = shuffle(E.fullDeck());
    st.button = next(st, st.button < 0 ? st.seats.length - 1 : st.button, (s) => !s.out);
    const headsUp = players.length === 2;
    const sbSeat = headsUp ? st.button : next(st, st.button, (s) => !s.out);
    const bbSeat = next(st, sbSeat, (s) => !s.out);
    put(st, sbSeat, st.sb); st.seats[sbSeat].last = 'Petite blinde';
    put(st, bbSeat, st.bb); st.seats[bbSeat].last = 'Grosse blinde';
    st.sbSeat = sbSeat; st.bbSeat = bbSeat;
    for (let r = 0; r < 2; r++) {
      let i = sbSeat;
      for (let k = 0; k < players.length; k++) {
        st.seats[i].cards.push(draw(st));
        i = next(st, i, (s) => !s.out);
      }
    }
    st.street = 'preflop';
    st.currentBet = st.bb;
    st.minRaise = st.bb;
    st.toAct = next(st, bbSeat, (s) => canAct(s));
    log(st, 'Main n°' + st.handNo + ' — blindes ' + st.sb + '/' + st.bb);
    // Cas rare : tout le monde est déjà à tapis avec les blindes
    if (st.toAct === -1 || !needsAction(st)) endBettingRound(st);
    return true;
  }

  /** Ce que le joueur `i` peut faire. */
  function legal(st, i) {
    const s = st.seats[i];
    const toCall = Math.min(st.currentBet - s.bet, s.stack);
    const maxTo = s.bet + s.stack;                      // tapis
    const minTo = Math.min(st.currentBet + st.minRaise, maxTo);
    return {
      toCall,
      canCheck: toCall === 0,
      canRaise: s.stack > toCall && st.seats.some((o, j) => j !== i && canAct(o)),
      minTo, maxTo,
      isBet: st.currentBet === 0,
      pot: pot(st),
    };
  }

  function needsAction(st) {
    const actors = st.seats.filter(canAct);
    if (actors.length === 0) return false;
    if (actors.length === 1 && actors[0].bet >= st.currentBet && st.seats.filter(inHand).length > 1 && actors[0].acted) return false;
    return actors.some((s) => !s.acted || s.bet < st.currentBet);
  }

  /**
   * Applique une action du joueur `i`.
   * action = { type: 'fold'|'check'|'call'|'raise'|'allin', to: montant total de la mise (raise) }
   * Renvoie false si l'action est illégale.
   */
  function act(st, i, action) {
    if (st.toAct !== i || !['preflop', 'flop', 'turn', 'river'].includes(st.street)) return false;
    const s = st.seats[i];
    const L = legal(st, i);
    const name = s.name;
    switch (action.type) {
      case 'fold':
        s.folded = true; s.last = 'Se couche';
        log(st, name + ' se couche');
        break;
      case 'check':
        if (!L.canCheck) return false;
        s.last = 'Parole';
        log(st, name + ' parle');
        break;
      case 'call':
        if (L.toCall === 0) return act(st, i, { type: 'check' });
        put(st, i, L.toCall);
        s.last = s.allin ? 'Tapis (' + s.total + ')' : 'Suit ' + s.bet;
        log(st, name + ' suit ' + s.bet);
        break;
      case 'raise':
      case 'allin': {
        let to = action.type === 'allin' ? L.maxTo : Math.round(action.to);
        if (!L.canRaise && action.type === 'raise') return false;
        to = Math.min(to, L.maxTo);
        if (to <= st.currentBet) { // pas une relance : simple suivi (tapis inclus)
          if (action.type === 'allin') { put(st, i, L.toCall); s.last = 'Tapis (' + s.total + ')'; log(st, name + ' fait tapis'); break; }
          return false;
        }
        if (to < L.minTo && to < L.maxTo) return false;
        const raiseBy = to - st.currentBet;
        const wasBet = st.currentBet === 0;
        put(st, i, to - s.bet);
        if (raiseBy >= st.minRaise) st.minRaise = raiseBy;
        st.currentBet = to;
        st.seats.forEach((o, j) => { if (j !== i && canAct(o)) o.acted = false; });
        s.last = s.allin ? 'Tapis (' + to + ')' : (wasBet ? 'Mise ' : 'Relance à ') + to;
        log(st, name + (s.allin ? ' fait tapis à ' : wasBet ? ' mise ' : ' relance à ') + to);
        break;
      }
      default: return false;
    }
    s.acted = true;
    afterAction(st, i);
    return true;
  }

  function afterAction(st, i) {
    const alive = st.seats.filter(inHand);
    if (alive.length === 1) { finishUncontested(st, st.seats.indexOf(alive[0])); return; }
    if (needsAction(st)) {
      st.toAct = next(st, i, (s) => canAct(s) && (!s.acted || s.bet < st.currentBet));
      if (st.toAct !== -1) return;
    }
    endBettingRound(st);
  }

  const NEXT = { preflop: 'flop', flop: 'turn', turn: 'river' };

  function endBettingRound(st) {
    st.seats.forEach((s) => { s.bet = 0; s.acted = false; });
    st.currentBet = 0;
    st.minRaise = st.bb;
    if (st.street === 'river') {
      if (st.external) { st.pending = 'showdown'; st.toAct = -1; return; }
      return showdown(st);
    }
    // Mode « donneur externe » (entre amis) : l'hôte, seul à connaître le paquet, distribuera le tour suivant
    if (st.external) { st.pending = NEXT[st.street]; st.toAct = -1; return; }
    const cards = st.street === 'preflop' ? [draw(st), draw(st), draw(st)] : [draw(st)];
    dealStreet(st, cards);
  }

  function dealStreet(st, cards) {
    st.pending = null;
    st.board.push(...cards);
    st.street = NEXT[st.street];
    st.seats.forEach((s) => { if (inHand(s) && !s.allin) s.last = ''; });
    log(st, { flop: 'Flop', turn: 'Turn', river: 'River' }[st.street] + ' : ' + st.board.map((c) => c.rank + c.suit).join(' '));
    const actors = st.seats.filter(canAct).length;
    const alive = st.seats.filter(inHand).length;
    if (actors >= 2 && alive >= 2) {
      st.toAct = next(st, st.button, (s) => canAct(s));
    } else {
      // Plus personne ne peut miser : on déroule le tableau jusqu'à l'abattage
      st.toAct = -1;
      st.runout = true;
      endBettingRound(st);
    }
  }

  /** Mode externe : l'hôte fournit les cartes du tour attendu (st.pending). */
  function fulfill(st, cards) {
    if (!NEXT[st.street] || st.pending !== NEXT[st.street]) return false;
    dealStreet(st, cards);
    return true;
  }

  function finishUncontested(st, w) {
    const amount = pot(st);
    const s = st.seats[w];
    s.stack += amount; s.won = amount;
    st.street = 'showdown';
    st.toAct = -1;
    st.results = { pots: [{ amount, winners: [w], hand: null }], uncontested: true };
    log(st, s.name + ' remporte ' + amount + ' (tout le monde s\'est couché)');
  }

  function showdown(st) {
    st.pending = null;
    st.street = 'showdown';
    st.toAct = -1;
    const alive = [];
    st.seats.forEach((s, i) => {
      if (inHand(s)) {
        const e = E.evaluate(s.cards.concat(st.board));
        s.score = e.score; s.handName = e.name; s.shown = true; s.bestCards = e.cards.map((c) => c.id);
        alive.push(i);
      }
    });
    // Pots secondaires par niveaux de mise
    const levels = [...new Set(st.seats.filter((s) => s.total > 0).map((s) => s.total))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    for (const lv of levels) {
      let amount = 0;
      st.seats.forEach((s) => { amount += Math.max(0, Math.min(s.total, lv) - prev); });
      const eligible = alive.filter((i) => st.seats[i].total >= lv);
      if (amount > 0) {
        if (eligible.length === 0) { // ne devrait pas arriver : rendu au plus gros contributeur
          const back = st.seats.reduce((b, s, i) => (s.total >= lv ? i : b), 0);
          pots.push({ amount, winners: [back], hand: null });
        } else {
          const top = Math.max(...eligible.map((i) => st.seats[i].score));
          const winners = eligible.filter((i) => st.seats[i].score === top);
          if (pots.length && pots[pots.length - 1].winners.join() === winners.join()) pots[pots.length - 1].amount += amount;
          else pots.push({ amount, winners, hand: st.seats[winners[0]].handName });
        }
      }
      prev = lv;
    }
    pots.forEach((p) => {
      const share = Math.floor(p.amount / p.winners.length);
      let rest = p.amount - share * p.winners.length;
      // le jeton restant va au premier gagnant à gauche du bouton
      const ordered = p.winners.slice().sort((a, b) => ((a - st.button + st.seats.length) % st.seats.length) - ((b - st.button + st.seats.length) % st.seats.length));
      ordered.forEach((w) => {
        const g = share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        st.seats[w].stack += g; st.seats[w].won = (st.seats[w].won || 0) + g;
      });
      log(st, p.winners.map((w) => st.seats[w].name).join(' et ') + ' remporte' + (p.winners.length > 1 ? 'nt' : '') + ' ' + p.amount + ' avec ' + p.hand);
    });
    st.results = { pots, uncontested: false };
  }

  const api = { createTable, addSeat, startHand, legal, act, pot, inHand, canAct, next, fulfill, showdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerEngine = api;
})(typeof window !== 'undefined' ? window : this);
