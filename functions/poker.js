/*
 * Tournoi de poker réel joué par le serveur : le paquet, les cartes des bots et leurs décisions
 * restent ici. L'app reçoit une suite d'images de la table (« frames ») à animer, avec les cartes
 * des adversaires cachées tant qu'elles ne sont pas montrées.
 */
'use strict';
const P = require('./shared/engine.js');
const B = require('./shared/bots.js');
const Tourney = require('./shared/tourney.js');

const ME = 0;
const BUYINS = [100, 500, 1000, 2500];
const BLINDS = { '10/20': [10, 20], '25/50': [25, 50], '50/100': [50, 100] };
const STACKS = [50, 100, 200];
const RULES = ['h5', 'h8', 'h12', 'm3', 'm5', '0'];
const STYLES = ['mix', 'prudent', 'regulier', 'agressif'];

// Image de la table vue par le joueur : sans le paquet, cartes adverses cachées
function view(st) {
  const v = JSON.parse(JSON.stringify(st));
  delete v.deck;
  const showdown = st.street === 'showdown';
  v.seats.forEach((s, i) => {
    if (i === ME) return;
    const visible = (st.runout && P.inHand(st.seats[i])) || (showdown && s.shown);
    if (!visible) { s.cards = s.cards.map((c) => ({ id: c.id, rank: '', suit: '' })); s.bestCards = []; s.score = 0; s.handName = ''; }
  });
  return v;
}

function handle(Pl, S, ctx, N, fail, track) {
  const d = ctx.data || {};
  const now = ctx.now;
  const frames = [];
  let hand = null;

  if (ctx.op === 'pk.start') {
    if (S.pk && !S.pk.done) return { frames: [view(S.pk.st)], cfg: S.pk.cfg, T: S.pk.T, resumed: true };
    const buyIn = d.buyIn, n = d.opponents;
    if (!BUYINS.includes(buyIn)) fail('Droit d\'entrée invalide.');
    if (!(Number.isInteger(n) && n >= 1 && n <= 5)) fail('Nombre d\'adversaires invalide.');
    if (!BLINDS[d.blinds] || !STACKS.includes(d.stack) || !RULES.includes(d.rule) || !STYLES.includes(d.style)) fail('Réglages invalides.');
    if (Pl.wallet < buyIn) fail('Ta banque est insuffisante pour ce droit d\'entrée.');
    Pl.wallet -= buyIn;
    Pl.sessions.poker = { stack: buyIn, start: buyIn, at: now, tourney: true };
    const [sb, bb] = BLINDS[d.blinds];
    const cfg = { sb, bb, stack: bb * d.stack, coach: false, real: true, rule: d.rule, lv: {}, buyIn, players: n + 1, timer: 0 };
    const st = P.createTable({ sb, bb });
    P.addSeat(st, { name: 'Toi', stack: cfg.stack, human: true });
    const styles = ['regulier', 'agressif', 'prudent', 'regulier', 'agressif'];
    const names = B.NAMES.slice().sort(() => Math.random() - 0.5);
    for (let k = 0; k < n; k++) P.addSeat(st, { name: names[k], stack: cfg.stack, style: d.style === 'mix' ? styles[k] : d.style });
    S.pk = { st, cfg, T: Tourney.createStats(now), handStart: cfg.stack, done: false };
    return { frames: [view(st)], cfg, T: S.pk.T };
  }

  const g = S.pk;
  if (!g || g.done) fail('Aucun tournoi en cours.');
  const st = g.st;
  if (ctx.op === 'pk.hand') {
    if (st.street !== 'idle' && st.street !== 'showdown') fail('Une main est déjà en cours.');
    const b = Tourney.maybeLevelUp(g.cfg.lv, g.cfg.rule, g.cfg.sb, g.cfg.bb, now);
    let blindMsg = '';
    if (b) { st.sb = b.sb; st.bb = b.bb; blindMsg = 'Les blindes augmentent : ' + b.sb + ' / ' + b.bb + ' ! '; st.log.push('Les blindes augmentent : ' + b.sb + ' / ' + b.bb); }
    g.handStart = st.seats[ME].stack;
    if (!P.startHand(st)) fail('Pas assez de joueurs.');
    frames.push(view(st));
    hand = runBots();
    return { frames, hand, blindMsg, T: g.T };
  }
  if (ctx.op === 'pk.act') {
    if (st.street === 'showdown' || st.toAct !== ME) fail('Ce n\'est pas ton tour.');
    let action = d.action || {};
    const L = P.legal(st, ME);
    if (!['fold', 'check', 'call', 'raise', 'allin'].includes(action.type)) fail('Action invalide.');
    if (action.type === 'raise') {
      const to = Math.floor(Number(action.to));
      if (!(to > 0)) fail('Relance invalide.');
      action = to >= L.maxTo ? { type: 'allin' } : { type: 'raise', to };
    }
    if (!P.act(st, ME, action)) fail('Action impossible.');
    frames.push(view(st));
    hand = runBots();
    return { frames, hand, T: g.T };
  }
  fail('Opération inconnue.');

  // Les bots jouent jusqu'au tour du joueur ou jusqu'à l'abattage
  function runBots() {
    let guard = 0;
    while (st.street !== 'showdown' && st.toAct !== ME && guard++ < 200) {
      const i = st.toAct;
      B.play(st, i, st.seats[i].style);
      frames.push(view(st));
    }
    return st.street === 'showdown' ? endHand() : null;
  }
  function endHand() {
    const me = st.seats[ME];
    const net = me.stack - g.handStart;
    const r = st.results;
    const cat = me.score ? Math.floor(me.score / 759375) : -1;
    track('pk', { won: me.won > 0, net, cat: me.won > 0 && !r.uncontested ? cat : -1, allinWon: me.allin && me.won > 0 });
    const out = Tourney.recordHand(g.T, st, (i) => 's' + i, (i) => st.seats[i].name, now);
    const alive = st.seats.filter((x) => x.stack > 0);
    let place = 0;
    if (me.stack <= 0) place = g.T.eliminated.find((e) => e.key === 's' + ME).place;
    else if (alive.length === 1) place = 1;
    let prize = 0;
    if (place) {
      const pool = g.cfg.buyIn * g.cfg.players;
      const split = g.cfg.players <= 3 ? [1] : [0.65, 0.25, 0.1];
      prize = Math.round(pool * (split[place - 1] || 0));
      Pl.wallet += prize;
      delete Pl.sessions.poker;
      track('pk-tourney', { place, players: g.cfg.players });
      g.done = true;
    }
    return { net, out, place, prize, finished: !!place };
  }
}

module.exports = { handle, view };
