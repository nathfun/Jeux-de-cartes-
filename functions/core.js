/*
 * Logique du serveur du Casino, sans Firebase (testable seule).
 * handle(state, ctx) applique une opération demandée par un joueur et renvoie le résultat.
 *
 * state = { player, secret } :
 *   player : profil du joueur (banque, niveau, défis, succès, parties réelles en cours…)
 *   secret : ce que le joueur ne doit pas voir (sabot du blackjack, table de poker complète…)
 * ctx = { uid, anon, op, data, now, rnd, table }
 *   rnd(n) : entier aléatoire dans [0, n) (crypto côté serveur)
 *   table  : état d'une table entre amis lu juste avant (pour les prix)
 */
'use strict';
const R = require('./shared/casino-rules.js');
const B = require('./shared/bets.js');
const SL = require('./shared/slots-engine.js');
const CR = require('./shared/crash-engine.js');
const ST = require('./shared/strategy.js');
const SB = require('./shared/sidebets.js');
const PK = require('./poker.js');
const PL = require('./shared/plinko-engine.js');
const MN = require('./shared/mines-engine.js');
const GD = require('./shared/gold-engine.js');
const nodeCrypto = require('crypto');
const hmacHex = (key, msg) => nodeCrypto.createHmac('sha256', key).update(msg).digest('hex');
const sha256Hex = (t) => nodeCrypto.createHash('sha256').update(t).digest('hex');

class GameError extends Error { constructor(msg) { super(msg); this.userMessage = msg; } }
const fail = (msg) => { throw new GameError(msg); };
const int = (v) => (Number.isInteger(v) ? v : NaN);
const round2 = (v) => Math.round(v * 100) / 100;

// ---------- Blackjack (règle européenne : pas de carte cachée) ----------
const DECKS = 6, MIN_BET = 1, MAX_HANDS = 4, MAX_SIDE = 25;
// Mise maximale par coup selon le salon VIP du joueur (fixée au début de chaque opération)
let MAX_BET = 50;
const SLOT_BETS = [1, 2, 5, 10, 20, 50, 100, 250, 500];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const value = (cards) => ST.handValue(cards);
const isBJ = (cards) => cards.length === 2 && value(cards).total === 21;

function newShoe(rnd) {
  const shoe = [];
  for (let d = 0; d < DECKS; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ rank: r, suit: s });
  for (let i = shoe.length - 1; i > 0; i--) { const j = rnd(i + 1); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  return shoe;
}

/**
 * Le serveur déroule la main dans le même ordre que l'app : chaque carte tirée est ajoutée à `out`,
 * l'app les distribue ensuite une par une avec ses animations. L'argent est compté ici.
 */
function bjEngine(sess, bj, rnd, out) {
  const draw = () => {
    if (!bj.shoe.length) bj.shoe = newShoe(rnd);
    const c = bj.shoe.pop();
    out.push(c);
    return { rank: c.rank, suit: c.suit };
  };
  function proceed() {
    const r = bj.round;
    if (isBJ(r.hands[0].cards)) { r.hands[0].done = true; r.active = 1; return dealer(); }
    r.phase = 'playing';
    return null;
  }
  function advance() {
    const r = bj.round;
    while (r.active < r.hands.length && r.hands[r.active].done) r.active++;
    if (r.active < r.hands.length) {
      const h = r.hands[r.active];
      if (h.cards.length === 1) h.cards.push(draw());
      if (value(h.cards).total === 21) { h.done = true; return advance(); }
      return null;
    }
    return dealer();
  }
  function dealer() {
    const r = bj.round;
    r.phase = 'dealer';
    const live = r.hands.filter((h) => value(h.cards).total <= 21 && !h.surrendered);
    const onlyNaturals = live.length > 0 && r.hands.length === 1 && isBJ(r.hands[0].cards);
    if (live.length) r.dealer.push(draw());
    if (live.length && !onlyNaturals && !isBJ(r.dealer)) {
      while (value(r.dealer).total < 17) r.dealer.push(draw());
    }
    return settle();
  }
  function settle() {
    const r = bj.round;
    r.phase = 'over';
    const d = value(r.dealer).total;
    const dBJ = isBJ(r.dealer);
    const single = r.hands.length === 1;
    let payout = 0, wagered = 0;
    const results = r.hands.map((h) => {
      const p = value(h.cards).total;
      const pBJ = single && !h.split && isBJ(h.cards);
      wagered += h.bet;
      let back = 0, res;
      if (h.surrendered) { back = h.bet / 2; res = 'lose'; }
      else if (pBJ && dBJ) { back = h.bet; res = 'push'; }
      else if (pBJ) { back = h.bet * 2.5; res = 'win'; }
      else if (dBJ) res = 'lose';
      else if (p > 21) res = 'lose';
      else if (d > 21 || p > d) { back = h.bet * 2; res = 'win'; }
      else if (p === d) { back = h.bet; res = 'push'; }
      else res = 'lose';
      payout += back;
      return res;
    });
    if (r.ins && dBJ) payout += r.ins * 3;
    sess.stack = round2(sess.stack + payout);
    const net = payout - wagered - (r.ins && dBJ ? r.ins : 0);
    return {
      net, results,
      track: {
        net, bet: r.hands.reduce((a, h) => a + (h.doubled ? h.bet / 2 : h.bet), 0),
        blackjack: single && !r.hands[0].split && isBJ(r.hands[0].cards),
        doubledWin: r.hands.some((h, i) => h.doubled && results[i] === 'win'),
      },
    };
  }
  return {
    deal(bet, pp, t213) {
      if (bj.round && bj.round.phase !== 'over') fail('Une main est déjà en cours.');
      if (!(bet >= MIN_BET && bet <= MAX_BET)) fail('Mise entre ' + MIN_BET + ' et ' + MAX_BET + ' €.');
      if (!(pp >= 0 && pp <= MAX_SIDE && t213 >= 0 && t213 <= MAX_SIDE)) fail('Pari annexe invalide.');
      if (bet + pp + t213 > sess.stack) fail('Pas assez d\'argent sur la table.');
      let shuffled = false;
      if (!bj.shoe || bj.shoe.length < DECKS * 52 * 0.25) { bj.shoe = newShoe(rnd); shuffled = true; }
      sess.stack = round2(sess.stack - bet - pp - t213);
      bj.round = { bet, pp, t213, hands: [{ cards: [], bet, done: false }], dealer: [], active: 0, phase: 'dealing', ins: 0 };
      const r = bj.round;
      const p = r.hands[0].cards;
      p.push(draw()); r.dealer.push(draw()); p.push(draw());
      // paris annexes, réglés tout de suite
      const pr = pp ? SB.perfectPairs(p[0], p[1]) : null;
      const tr = t213 ? SB.twentyOnePlusThree(p[0], p[1], r.dealer[0]) : null;
      if (pr) sess.stack = round2(sess.stack + pp + pp * pr.mult);
      if (tr) sess.stack = round2(sess.stack + t213 + t213 * tr.mult);
      // assurance proposée quand le croupier montre un As (si on peut la payer)
      const cost = Math.floor(bet / 2);
      if (ST.cardValue(r.dealer[0].rank) === 11 && cost > 0 && sess.stack >= cost) { r.phase = 'insurance'; return { shuffled, settle: null }; }
      return { shuffled, settle: proceed() };
    },
    insurance(take) {
      const r = bj.round;
      if (!r || r.phase !== 'insurance') fail('Pas d\'assurance en attente.');
      if (take) { const cost = Math.floor(r.bet / 2); sess.stack = round2(sess.stack - cost); r.ins = cost; }
      return { settle: proceed() };
    },
    act(action) {
      const r = bj.round;
      if (!r || r.phase !== 'playing') fail('Ce n\'est pas le moment de jouer.');
      const h = r.hands[r.active];
      const two = h.cards.length === 2;
      const affordable = sess.stack >= h.bet;
      const can = {
        H: true, S: true, D: two && affordable,
        P: two && affordable && r.hands.length < MAX_HANDS && ST.cardValue(h.cards[0].rank) === ST.cardValue(h.cards[1].rank),
      };
      if (!can[action]) fail('Action impossible.');
      if (action === 'H') { h.cards.push(draw()); if (value(h.cards).total >= 21) h.done = true; }
      else if (action === 'S') h.done = true;
      else if (action === 'D') { sess.stack = round2(sess.stack - h.bet); h.bet *= 2; h.doubled = true; h.cards.push(draw()); h.done = true; }
      else if (action === 'P') {
        sess.stack = round2(sess.stack - h.bet);
        const second = { cards: [h.cards.pop()], bet: h.bet, done: false, split: true };
        h.split = true;
        const aces = h.cards[0].rank === 'A';
        r.hands.splice(r.active + 1, 0, second);
        h.cards.push(draw());
        if (aces) { second.cards.push(draw()); h.done = true; second.done = true; }
      }
      if (value(h.cards).total === 21) h.done = true;
      return { settle: advance() };
    },
    // Page quittée en pleine main : assurance refusée et on reste sur toutes les mains restantes
    finish() {
      const r = bj.round;
      if (!r || r.phase === 'over') return null;
      if (r.phase === 'insurance') { const s = proceed(); if (s) return s; }
      r.hands.forEach((h) => { h.done = true; });
      return advance();
    },
  };
}

function bj(sess, secret, rnd, out) {
  secret.bj = secret.bj || { shoe: null, round: null };
  return bjEngine(sess, secret.bj, rnd, out);
}


// ---------- Rocket Crash ----------
// Seeds « Provably Fair » propres à chaque joueur : l'empreinte est publiée, le seed révélé au changement.
function crashSeeds(S, rnd) {
  if (!S.cr || !S.cr.seed) {
    const seed = Array.from({ length: 32 }, () => rnd(256).toString(16).padStart(2, '0')).join('');
    S.cr = Object.assign(S.cr || {}, { seed, hash: CR.sha256Sync(seed), client: S.cr && S.cr.client || 'casino', nonce: 0 });
  }
  return S.cr;
}
// Règle une manche terminée (ou interrompue) : retrait automatique s'il a été atteint, sinon mise perdue. Une seule fois.
function crashFinish(P, r, track) {
  if (!r || r.done) return;
  r.done = true;
  if (!r.bet || r.cashed) return;
  if (r.auto && r.auto <= r.crash && r.crash > 1) crashPay(P, r, r.auto, track);
  else track('cr', { bet: r.bet, net: -r.bet, mult: 0 });
}
function crashPay(P, r, m, track) {
  if (r.cashed) return;
  const res = CR.settle(r.bet, Math.min(m, CR.maxWinMult(r.bet)), r.crash);
  if (!res.won) return;
  r.cashed = true; r.cashAt = Math.min(m, CR.maxWinMult(r.bet)); r.payout = res.payout;
  if (P.sessions.crash) P.sessions.crash.stack = round2(P.sessions.crash.stack + res.payout);
  track('cr', { bet: r.bet, net: res.net, mult: r.cashAt });
}
function crashOp(P, S, ctx, sess, track, fail) {
  const d = ctx.data || {}, now = ctx.now;
  const C = crashSeeds(S, ctx.rnd);
  const r = C.round;
  const bustAt = (x) => x.startAt + CR.timeFor(x.crash);
  if (ctx.op === 'cr.seed') {
    if (r && !r.done) fail('Attends la fin de la manche.');
    const prev = { server: C.seed, client: C.client, nonce: C.nonce };
    S.cr = { client: String(d.client || C.client).slice(0, 32) || 'casino' };
    const N = crashSeeds(S, ctx.rnd);
    return { hash: N.hash, client: N.client, nonce: N.nonce, prev };
  }
  if (ctx.op === 'cr.round') {
    if (r && !r.done) {
      if (r.bet && !r.cashed && now < bustAt(r)) fail('Une manche est encore en cours.');
      crashFinish(P, r, track);
    }
    const bet = int(d.bet || 0);
    const auto = Number(d.auto) >= 1.01 ? CR.floor2(Number(d.auto)) : 0;
    if (bet) {
      const ss = sess('crash');
      if (!(bet >= CR.CONFIG.MIN_BET && bet <= Math.min(CR.CONFIG.MAX_BET, MAX_BET))) fail('Mise entre ' + CR.CONFIG.MIN_BET + ' et ' + Math.min(CR.CONFIG.MAX_BET, MAX_BET) + ' € dans ton salon.');
      if (bet > ss.stack) fail('Pas assez d\'argent sur la table.');
      ss.stack = round2(ss.stack - bet);
    }
    C.nonce++;
    const crash = CR.crashFromSeedsSync(C.seed, C.client, C.nonce);
    C.round = { id: String(C.nonce), bet, auto, crash, startAt: now + CR.CONFIG.LAUNCH_MS, cashed: false, done: false };
    return { id: C.round.id, startAt: C.round.startAt, serverNow: now, hash: C.hash, nonce: C.nonce, stack: P.sessions.crash ? P.sessions.crash.stack : 0 };
  }
  if (!r || r.id !== String(d.id)) fail('Manche inconnue.');
  const stackNow = () => (P.sessions.crash ? P.sessions.crash.stack : 0);
  const over = now >= bustAt(r);
  if (ctx.op === 'cr.cashout') {
    if (!r.bet) fail('Pas de mise sur cette manche.');
    if (r.cashed) return { cashAt: r.cashAt, payout: r.payout, stack: stackNow(), again: true }; // déjà payé : rien de plus
    if (now < r.startAt) fail('La fusée n\'a pas encore décollé.');
    if (over || r.done) { crashFinish(P, r, track); return r.cashed ? { cashAt: r.cashAt, payout: r.payout, stack: stackNow() } : { busted: true, crash: r.crash, stack: stackNow() }; }
    let m = CR.multiplierAt(now - r.startAt);
    if (r.auto && m >= r.auto) m = r.auto; // le retrait automatique est passé avant
    crashPay(P, r, m, track);
    return { cashAt: r.cashAt, payout: r.payout, stack: stackNow() };
  }
  // cr.status : l'explosion n'est révélée qu'une fois passée
  if (!over && !r.done) {
    const m = CR.multiplierAt(now - r.startAt);
    if (r.bet && !r.cashed && r.auto && m >= r.auto) crashPay(P, r, r.auto, track);
    if (r.bet && !r.cashed && m >= CR.maxWinMult(r.bet)) crashPay(P, r, CR.maxWinMult(r.bet), track);
    return { busted: false, m, cashed: r.cashed, cashAt: r.cashAt, payout: r.payout, stack: stackNow() };
  }
  crashFinish(P, r, track);
  return { busted: true, crash: r.crash, cashed: r.cashed, cashAt: r.cashAt, payout: r.payout, stack: stackNow(), nonce: C.nonce };
}

// ---------- Seeds « Provably Fair » (Plinko, Mines) : une paire par jeu et par joueur ----------
function seedsOf(S, key, rnd) {
  if (!S[key] || !S[key].seed) {
    const seed = Array.from({ length: 32 }, () => rnd(256).toString(16).padStart(2, '0')).join('');
    S[key] = { seed, hash: sha256Hex(seed), client: (S[key] && S[key].client) || 'casino', nonce: 0, round: S[key] && S[key].round };
  }
  return S[key];
}
function rotateSeeds(S, key, client, rnd) {
  const C = seedsOf(S, key, rnd);
  const prev = { server: C.seed, client: C.client, nonce: C.nonce };
  S[key] = { client: String(client || C.client).slice(0, 32) || 'casino', round: C.round };
  const n = seedsOf(S, key, rnd);
  return { hash: n.hash, client: n.client, nonce: n.nonce, prev };
}

// ---------- Plinko : le serveur tire le chemin de chaque bille ----------
function plinkoOp(P, S, ctx, sess, track) {
  const d = ctx.data || {};
  if (ctx.op === 'pl.seed') return rotateSeeds(S, 'pl', d.client, ctx.rnd);
  const ss = sess('plinko');
  const bet = int(d.bet), rows = int(d.rows), risk = String(d.risk);
  if (!PL.CONFIG.ROWS.includes(rows) || !PL.CONFIG.RISKS.includes(risk)) fail('Plateau invalide.');
  if (!(bet >= PL.CONFIG.MIN_BET && bet <= Math.min(PL.CONFIG.MAX_BET, MAX_BET))) fail('Mise entre ' + PL.CONFIG.MIN_BET + ' et ' + Math.min(PL.CONFIG.MAX_BET, MAX_BET) + ' € dans ton salon.');
  if (bet > ss.stack) fail('Pas assez d\'argent sur la table.');
  const C = seedsOf(S, 'pl', ctx.rnd);
  C.nonce++;
  const path = PL.pathFromHex(hmacHex(C.seed, C.client + ':' + C.nonce), rows);
  const slot = PL.slotOf(path), res = PL.settle(bet, rows, risk, slot);
  // la bille est réglée tout de suite (son chemin est fixé) ; l'app l'anime ensuite
  ss.stack = round2(ss.stack - bet + res.payout);
  track('pl', { bet, net: res.net, mult: res.mult, edge: slot === 0 || slot === rows });
  return { path, slot, mult: res.mult, payout: res.payout, net: res.net, nonce: C.nonce, hash: C.hash, stack: ss.stack };
}

// ---------- Mines : les mines restent cachées sur le serveur jusqu'à la fin de la manche ----------
function minesOp(P, S, ctx, sess, track) {
  const d = ctx.data || {};
  if (ctx.op === 'mn.seed') {
    if (S.mn && S.mn.round && S.mn.round.active) fail('Termine la manche en cours d\'abord.');
    return rotateSeeds(S, 'mn', d.client, ctx.rnd);
  }
  const C = seedsOf(S, 'mn', ctx.rnd);
  const ss = sess('mines');
  const r = C.round;
  const end = (won) => {
    r.active = false;
    const res = won ? MN.settle(r.bet, r.m, r.open.length) : { mult: 0, payout: 0, net: -r.bet };
    ss.stack = round2(ss.stack + res.payout);
    track('mn', { bet: r.bet, net: res.net, mines: r.m, reveals: r.open.length, mult: res.mult, bust: !won, clear: won && r.open.length >= MN.maxReveals(r.m), firstBust: !won && r.open.length === 0 });
    return { over: true, won, mult: res.mult, payout: res.payout, mines: r.mines, open: r.open, stack: ss.stack, nonce: r.nonce };
  };
  if (ctx.op === 'mn.start') {
    if (r && r.active) fail('Une manche est déjà en cours.');
    const bet = int(d.bet), m = int(d.mines);
    if (!(m >= 1 && m <= 24)) fail('Entre 1 et 24 mines.');
    if (!(bet >= MN.CONFIG.MIN_BET && bet <= Math.min(MN.CONFIG.MAX_BET, MAX_BET))) fail('Mise entre ' + MN.CONFIG.MIN_BET + ' et ' + Math.min(MN.CONFIG.MAX_BET, MAX_BET) + ' € dans ton salon.');
    if (bet > ss.stack) fail('Pas assez d\'argent sur la table.');
    ss.stack = round2(ss.stack - bet);
    C.nonce++;
    const base = C.client + ':' + C.nonce;
    C.round = { bet, m, mines: MN.minesFromHex(hmacHex(C.seed, base + ':0') + hmacHex(C.seed, base + ':1'), m), open: [], active: true, nonce: C.nonce };
    return { started: true, nonce: C.nonce, hash: C.hash, stack: ss.stack };
  }
  if (!r || !r.active) fail('Aucune manche en cours.');
  if (ctx.op === 'mn.reveal') {
    const cell = int(d.cell);
    if (!(cell >= 0 && cell < MN.CONFIG.SIZE)) fail('Case invalide.');
    if (r.open.includes(cell)) return { gem: true, again: true, k: r.open.length, mult: MN.multAt(r.m, r.open.length), stack: ss.stack };
    if (r.mines.includes(cell)) return Object.assign(end(false), { gem: false, cell });
    r.open.push(cell);
    if (r.open.length >= MN.maxReveals(r.m)) return Object.assign(end(true), { gem: true, cell });
    return { gem: true, cell, k: r.open.length, mult: MN.multAt(r.m, r.open.length), stack: ss.stack };
  }
  if (ctx.op === 'mn.cashout') {
    if (!r.open.length) {
      // aucune case retournée : la mise est rendue (manche annulée)
      r.active = false; ss.stack = round2(ss.stack + r.bet);
      return { over: true, cancelled: true, mines: r.mines, stack: ss.stack, nonce: r.nonce };
    }
    return end(true);
  }
  fail('Opération inconnue.');
}

// ---------- Opérations ----------
function handle(state, ctx) {
  const now = ctx.now, N = [];
  const P = R.normalize(state.player, now);
  // passage à la nouvelle économie (÷ 10) : les manches en cours sont abandonnées (l'argent des tables est déjà rendu)
  if (P._econMigrated) { delete P._econMigrated; state.secret = {}; N.push({ kind: 'gold', icon: '💶', title: 'Nouvelle économie', text: 'Tous les montants du Casino sont divisés par 10 : ta banque est maintenant de ' + Math.round(P.wallet).toLocaleString('fr-FR') + ' €. Les mises maximales montent avec ton niveau (salons VIP).' }); }
  MAX_BET = R.maxBet(P, now);
  if (!state.player || !P.pseudo) { const ps = String(ctx.data && ctx.data.pseudo || '').trim().slice(0, 16); if (ps) P.pseudo = ps; }
  const S = state.secret || {};
  const d = ctx.data || {};
  R.ensureDaily(P, now);
  let result = {};
  const sess = (game) => P.sessions[game] || fail('Aucune partie réelle en cours : choisis une somme pour commencer.');
  const track = (type, data) => R.track(P, type, data, now, N);

  switch (ctx.op) {
    case 'sync': break;
    case 'profile.set': {
      if (typeof d.pseudo === 'string') P.pseudo = d.pseudo.trim().slice(0, 16);
      if (typeof d.avatar === 'string' && (R.AVATARS.includes(d.avatar) || R.canUse(P, 'avatar', d.avatar))) P.avatar = d.avatar;
      if (ctx.codeOk) P.friendCode = d.code;
      break;
    }
    case 'shop.buy': {
      const r = R.buyItem(P, String(d.kind), String(d.id), N);
      if (r.error) fail(r.error);
      result.price = r.price;
      break;
    }
    // ----- Parrainage : un nouveau joueur indique le code ami de son parrain (le paiement est fait par le serveur) -----
    case 'ref.link': {
      if (P.refBy) fail('Tu as déjà un parrain.');
      if (!ctx.refUid) fail('Code de parrainage inconnu.');
      if (ctx.refUid === ctx.uid) fail('Tu ne peux pas être ton propre parrain.');
      if ((P.totals.hands || 0) >= R.REF_MIN_HANDS) fail('Le parrainage est réservé aux nouveaux joueurs.');
      P.refBy = ctx.refUid; P.refByName = String(ctx.refName || 'Un ami').slice(0, 16); P.refAt = now;
      result = { uid: ctx.refUid, name: P.refByName, need: R.REF_MIN_HANDS };
      break;
    }
    case 'bonus.claim': result.amount = R.claimBonus(P, now, N); break;
    case 'challenge.claim': result.amount = R.claimChallenge(P, String(d.id), now, N); break;
    case 'vip.buy': { const r = R.buyVip(P, String(d.pass), now, N); if (r.error) fail(r.error); result = r; break; }
    case 'booster.open': { const r = R.openBooster(P, String(d.source), now, ctx.rnd, N); if (r.error) fail(r.error); result = r; break; }
    case 'card.craft': { const r = R.craftCard(P, String(d.kind), String(d.id), now); if (r.error) fail(r.error); result = r; break; }
    case 'wheel.spin': { const r = R.spinWheel(P, now, ctx.rnd, N); if (!r) fail('Plus de tour de roue aujourd\'hui : reviens demain !'); result = r; break; }
    case 'chest.claim': result.amount = R.claimChest(P, now, N); if (!result.amount) fail('Le coffre est encore vide.'); break;
    case 'rescue.claim': result.amount = R.claimRescue(P, now); if (!result.amount) fail('L\'aide de secours n\'est pas disponible.'); break;
    case 'session.start': {
      const game = String(d.game);
      if (P.sessions[game]) {
        // reprise : une main de blackjack laissée en plein milieu est terminée (on reste)
        if (game === 'blackjack' && S.bj && S.bj.round && S.bj.round.phase !== 'over') {
          const s = bj(P.sessions.blackjack, S, ctx.rnd, []).finish();
          if (s) { track('bj', s.track); result.finished = true; }
        }
        if (game === 'slots' && S.sl) { result.free = S.sl.free; result.freeBet = S.sl.freeBet; }
        result.session = P.sessions[game]; result.resumed = true; break;
      }
      const min = 1;
      if (!(int(d.amount) >= min)) fail('Il faut apporter au moins ' + min + ' €.');
      if (!R.startSession(P, game, d.amount, now)) fail('Ta banque ne contient pas assez d\'argent.');
      result.session = P.sessions[game];
      break;
    }
    case 'session.cashout': {
      const game = String(d.game);
      sess(game);
      if (game === 'blackjack' && S.bj && S.bj.round && S.bj.round.phase !== 'over') {
        const out = [];
        const s = bj(P.sessions.blackjack, S, ctx.rnd, out).finish();
        if (s) track('bj', s.track);
      }
      if (game === 'slots' && S.sl && S.sl.free > 0) fail('Termine d\'abord tes tours gratuits.');
      if (game === 'poker') fail('Au poker, la partie se termine à la fin du tournoi.');
      if (game === 'mines' && S.mn && S.mn.round && S.mn.round.active) {
        const r = S.mn.round;
        if (r.open.length) { const res = MN.settle(r.bet, r.m, r.open.length); P.sessions.mines.stack = round2(P.sessions.mines.stack + res.payout); track('mn', { bet: r.bet, net: res.net, mines: r.m, reveals: r.open.length, mult: res.mult }); }
        else P.sessions.mines.stack = round2(P.sessions.mines.stack + r.bet);
        r.active = false;
      }
      if (game === 'trader') fail('Bourse Flash en partie réelle n\'est pas encore géré par le serveur.');
      if (game === 'crash' && S.cr && S.cr.round && !S.cr.round.done) {
        const r = S.cr.round;
        if (r.bet && !r.cashed && now < r.startAt + CR.timeFor(r.crash)) fail('Attends la fin de la manche.');
        crashFinish(P, r, track);
      }
      const startStack = P.sessions[game].start, endStack = P.sessions[game].stack;
      result.cash = R.cashOut(P, game, N);
      if (game === 'roulette') track('rl-cashout', { diff: endStack - startStack });
      if (game === 'slots') S.sl = null;
      if (game === 'blackjack') S.bj = { shoe: S.bj && S.bj.shoe, round: null };
      break;
    }

    // ----- Roulette : le serveur lance la bille -----
    case 'rl.spin': {
      const ss = sess('roulette');
      const bets = d.bets || {};
      let staked = 0;
      for (const k of Object.keys(bets)) {
        const v = bets[k];
        if (!B.byKey[k] || !(int(v) >= 1) || v > Math.min(B.byKey[k].max, MAX_BET)) fail('Mise invalide sur ' + k + ' (au plus ' + Math.min(B.byKey[k].max, MAX_BET) + ' €).');
        staked += v;
      }
      if (!staked) fail('Aucune mise.');
      if (staked > MAX_BET * 2) fail('Au plus ' + MAX_BET * 2 + ' € par tour dans ton salon.');
      if (staked > ss.stack) fail('Pas assez d\'argent sur la table.');
      const n = ctx.rnd(37);
      let back = 0;
      for (const k of Object.keys(bets)) back += B.payout(k, bets[k], n);
      ss.stack = round2(ss.stack - staked + back);
      const pleinHit = Object.keys(bets).some((k) => B.byKey[k].type === 'plein' && B.byKey[k].numbers[0] === n);
      const zeroWin = n === 0 && Object.keys(bets).some((k) => B.byKey[k].numbers.includes(0));
      track('rl', { staked, bet: staked, net: back - staked, pleinHit, zeroWin });
      result = { n, back, staked, stack: ss.stack };
      break;
    }

    // ----- Machine à sous : le serveur tire les rouleaux -----
    case 'sl.spin': {
      const ss = sess('slots');
      S.sl = S.sl || { free: 0, freeBet: 0 };
      const free = S.sl.free > 0;
      const bet = free ? S.sl.freeBet : int(d.bet);
      if (!free && !(SLOT_BETS.includes(bet) && bet <= MAX_BET)) fail('Mise invalide (au plus ' + MAX_BET + ' € dans ton salon).');
      if (!free && bet > ss.stack) fail('Pas assez d\'argent sur la table.');
      const random = () => ctx.rnd(1 << 30) / (1 << 30);
      const grid = SL.spinGrid(random);
      const res = SL.evaluate(grid, bet, free);
      if (free) S.sl.free--; else ss.stack = round2(ss.stack - bet);
      ss.stack = round2(ss.stack + res.total);
      if (res.freeSpins) { if (!free) S.sl.freeBet = bet; S.sl.free += res.freeSpins; }
      track('sl', { bet: free ? 0 : bet, net: res.total - (free ? 0 : bet), jackpot: res.jackpot, freeTrigger: res.freeSpins > 0 });
      result = { grid, res, free: S.sl.free, freeBet: S.sl.freeBet, stack: ss.stack };
      break;
    }

    // ----- Rocket Crash : le serveur tire la manche, encaisse la mise et juge chaque retrait -----
    case 'cr.round': case 'cr.cashout': case 'cr.status': case 'cr.seed': {
      result = crashOp(P, S, ctx, sess, track, fail);
      break;
    }

    // ----- Ruée vers l'Or : le serveur tire la grille et joue le bonus « Le Filon » en entier -----
    case 'gd.spin': {
      const ss = sess('gold');
      const bet = int(d.bet);
      if (!(GD.BETS.includes(bet) && bet <= MAX_BET)) fail('Mise invalide (au plus ' + MAX_BET + ' € dans ton salon).');
      if (bet > ss.stack) fail('Pas assez d\'argent sur la table.');
      const r = GD.play(bet, () => ctx.rnd(1 << 30) / (1 << 30));
      ss.stack = round2(ss.stack - bet + r.total);
      track('sl', { bet, net: round2(r.total - bet), jackpot: r.jackpot === 'grand', freeTrigger: !!r.bonus });
      result = Object.assign(r, { stack: ss.stack });
      break;
    }

    // ----- Plinko et Mines -----
    case 'pl.drop': case 'pl.seed': result = plinkoOp(P, S, ctx, sess, track); break;
    case 'mn.start': case 'mn.reveal': case 'mn.cashout': case 'mn.seed': result = minesOp(P, S, ctx, sess, track); break;

    // ----- Blackjack : le sabot reste sur le serveur -----
    case 'bj.deal': case 'bj.ins': case 'bj.act': {
      const ss = sess('blackjack');
      const out = [];
      const eng = bj(ss, S, ctx.rnd, out);
      let r;
      if (ctx.op === 'bj.deal') r = eng.deal(int(d.bet), int(d.pp || 0), int(d.t213 || 0));
      else if (ctx.op === 'bj.ins') r = eng.insurance(!!d.take);
      else r = eng.act(String(d.action));
      if (r.settle) track('bj', r.settle.track);
      result = { cards: out, shuffled: !!r.shuffled, phase: S.bj.round.phase, stack: ss.stack, left: S.bj.shoe.length };
      break;
    }

    // ----- Poker : le serveur joue la table (bots compris) -----
    case 'pk.start': case 'pk.hand': case 'pk.act': {
      S.pk = S.pk || null;
      result = PK.handle(P, S, ctx, N, fail, track);
      break;
    }

    // ----- Entre amis : prix de fin de partie, vérifié sur la table -----
    case 'multi.prize': {
      const v = verifyTable(ctx.uid, String(d.game), ctx.table, now);
      const day = R.today(now);
      P.prizeDay = P.prizeDay && P.prizeDay.date === day ? P.prizeDay : { date: day, n: 0 };
      if (P.prizes[v.key]) { result.amount = 0; break; }
      if (P.prizeDay.n >= 5) { P.prizes[v.key] = now; result.amount = 0; result.capped = true; break; }
      result.amount = R.applyPrize(P, v.key, v.place, v.players, now, N);
      // club privé (table VIP) : prix doublé pour les membres VIP
      if (result.amount && t0vip(ctx.table) && R.isVip(P, now)) { P.wallet += result.amount; result.amount *= 2; result.vipClub = true; }
      if (result.amount) P.prizeDay.n++;
      result.place = v.place; result.players = v.players;
      break;
    }
    default: fail('Opération inconnue.');
  }
  state.player = P;
  state.secret = S;
  return { state, result, notes: N };
}

// Vérifie la fin de partie d'une table entre amis et la place du joueur
const t0vip = (t) => !!(t && (t.vip || (t.settings && t.settings.vip)));
function verifyTable(uid, game, t, now) {
  if (!t) fail('Table introuvable.');
  const recent = (at) => at && now - at < 30 * 60000;
  if (game === 'blackjack') {
    const g = t.gameEnd;
    if (!g || !recent(g.at) || !Array.isArray(g.rows)) fail('Partie non terminée.');
    const place = g.rows.findIndex((r) => r.uid === uid) + 1;
    if (!place) fail('Tu ne faisais pas partie de cette partie.');
    if (!(t.round >= 3)) fail('Partie trop courte.');
    return { key: 'bj:' + t.id + ':' + g.at, place, players: g.rows.length };
  }
  if (game === 'poker') {
    const g = t.gameOver;
    if (!g || !recent(g.at) || !t.tstats) fail('Partie non terminée.');
    const elim = t.tstats.eliminated || [];
    const players = elim.length + 1;
    const place = g.winner === uid ? 1 : ((elim.find((e) => e.key === uid) || {}).place || 0);
    if (!place) fail('Tu ne faisais pas partie de cette partie.');
    if (!(t.tstats.hands >= 3)) fail('Partie trop courte.');
    return { key: 'pk:' + t.id + ':' + g.at, place, players };
  }
  if (game === 'roulette') {
    if (t.phase !== 'over' || !t.over || !recent(t.over.at)) fail('Partie non terminée.');
    const ranking = Object.keys(t.players || {}).sort((a, b) => t.players[b].bankroll - t.players[a].bankroll);
    const place = ranking.indexOf(uid) + 1;
    if (!place) fail('Tu ne faisais pas partie de cette partie.');
    if (!(t.round >= 3)) fail('Partie trop courte.');
    return { key: 'rl:' + t.id + ':' + t.over.at, place, players: ranking.length };
  }
  fail('Jeu inconnu.');
}

module.exports = { handle, GameError, newShoe };
