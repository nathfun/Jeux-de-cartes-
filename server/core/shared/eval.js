/*
 * Évaluation des mains de poker (Texas Hold'em) et calcul d'équité par simulation.
 * Une carte : { rank: '2'..'10','J','Q','K','A', suit: '♠♥♦♣', id }.
 */
(function (root) {
  'use strict';
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const val = (r) => RANKS.indexOf(r) + 2; // 2..14

  const NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As' };
  const PLURAL = { 11: 'Valets', 12: 'Dames', 13: 'Rois', 14: 'As' };
  const rn = (v) => NAMES[v];
  const rp = (v) => PLURAL[v] || NAMES[v];
  const de = (word) => (/^[AEIOUÉ8]/i.test(word) ? 'd\'' + word : 'de ' + word); // « d'As », « de Rois »
  const aux = (word) => (/^(As)$/.test(word) ? 'aux As' : /^\d/.test(word) ? 'aux ' + word : 'aux ' + word);

  const CATEGORIES = ['Carte haute', 'Paire', 'Double paire', 'Brelan', 'Suite', 'Couleur', 'Full', 'Carré', 'Quinte flush'];

  // Évalue exactement 5 cartes -> { score, cat, values }
  function eval5(cards) {
    const vs = cards.map((c) => val(c.rank)).sort((a, b) => b - a);
    const flush = cards.every((c) => c.suit === cards[0].suit);
    const uniq = [...new Set(vs)];
    let straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A-2-3-4-5
    }
    const counts = {};
    vs.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    const groups = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || b - a);
    const shape = groups.map((g) => counts[g]).join('');
    let cat, values;
    if (straightHigh && flush) { cat = 8; values = [straightHigh]; }
    else if (shape === '41') { cat = 7; values = groups; }
    else if (shape === '32') { cat = 6; values = groups; }
    else if (flush) { cat = 5; values = vs; }
    else if (straightHigh) { cat = 4; values = [straightHigh]; }
    else if (shape === '311') { cat = 3; values = groups; }
    else if (shape === '221') { cat = 2; values = groups; }
    else if (shape === '2111') { cat = 1; values = groups; }
    else { cat = 0; values = vs; }
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (values[i] || 0);
    return { score, cat, values };
  }

  // Meilleure main de 5 cartes parmi 5 à 7 cartes (on essaie chaque façon d'écarter 0, 1 ou 2 cartes)
  function best(cards) {
    const n = cards.length;
    let top = null, topCards = null;
    const tryPick = (pick) => {
      const e = eval5(pick);
      if (!top || e.score > top.score) { top = e; topCards = pick; }
    };
    if (n === 5) tryPick(cards);
    else if (n === 6) for (let a = 0; a < 6; a++) tryPick(cards.filter((_, i) => i !== a));
    else for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) tryPick(cards.filter((_, i) => i !== a && i !== b));
    return Object.assign({ cards: topCards }, top);
  }

  function describe(e) {
    const v = e.values;
    switch (e.cat) {
      case 8: return v[0] === 14 ? 'Quinte flush royale' : 'Quinte flush au ' + rn(v[0]);
      case 7: return 'Carré ' + de(rp(v[0]));
      case 6: return 'Full ' + aux(rp(v[0])) + ' par les ' + rp(v[1]);
      case 5: return 'Couleur ' + (v[0] === 14 ? 'à l\'As' : 'au ' + rn(v[0]));
      case 4: return 'Suite ' + (v[0] === 14 ? 'à l\'As' : 'au ' + rn(v[0]));
      case 3: return 'Brelan ' + de(rp(v[0]));
      case 2: return 'Double paire ' + rp(v[0]) + ' et ' + rp(v[1]);
      case 1: return 'Paire ' + de(rp(v[0]));
      default: return 'Hauteur ' + (v[0] === 14 ? 'As' : rn(v[0]));
    }
  }

  function evaluate(cards) {
    const b = best(cards);
    b.name = describe(b);
    b.category = CATEGORIES[b.cat];
    return b;
  }

  function fullDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
    return d;
  }
  const key = (c) => c.rank + c.suit;

  /**
   * Équité par simulation Monte-Carlo : probabilité de gagner (égalités partagées)
   * contre `opponents` mains. `accept(deuxCartes)` (facultatif) écarte les mains qu'un
   * adversaire encore dans le coup n'aurait pas jouées.
   */
  function equity(hole, board, opponents, iters, accept) {
    iters = iters || 600;
    const known = new Set(hole.concat(board).map(key));
    const pool = fullDeck().filter((c) => !known.has(key(c)));
    const need = 5 - board.length;
    let win = 0;
    for (let it = 0; it < iters; it++) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      let p = 0;
      const fullBoard = board.concat(pool.slice(0, need));
      p = need;
      const mine = best(hole.concat(fullBoard)).score;
      let bestOpp = 0, tie = 0;
      for (let o = 0; o < opponents; o++) {
        let pair = [pool[p], pool[p + 1]];
        if (accept) {
          let tries = 0;
          while (!accept(pair) && tries < 8 && p + 3 < pool.length - 2 * (opponents - o - 1)) { p += 2; pair = [pool[p], pool[p + 1]]; tries++; }
        }
        p += 2;
        const sc = best(pair.concat(fullBoard)).score;
        if (sc > bestOpp) { bestOpp = sc; tie = 0; }
        if (sc === bestOpp) tie++;
      }
      if (mine > bestOpp) win += 1;
      else if (mine === bestOpp) win += 1 / (tie + 1);
    }
    return win / iters;
  }

  const api = { RANKS, SUITS, val, rn, rp, evaluate, eval5, best, equity, fullDeck, CATEGORIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerEval = api;
})(typeof window !== 'undefined' ? window : this);
