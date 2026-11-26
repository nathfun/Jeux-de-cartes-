/*
 * Paris annexes
 *  - Paire parfaite (tes 2 premières cartes) : paire mixte 5:1, paire de couleur 12:1, paire parfaite 25:1
 *  - 21+3 (tes 2 cartes + la carte visible du croupier) : couleur 5:1, suite 10:1,
 *    brelan 30:1, quinte flush 40:1, brelan de même couleur 100:1
 */
(function (root) {
  'use strict';
  const ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRed = (s) => s === '♥' || s === '♦';

  function perfectPairs(a, b) {
    if (a.rank !== b.rank) return null;
    if (a.suit === b.suit) return { name: 'Paire parfaite', mult: 25 };
    if (isRed(a.suit) === isRed(b.suit)) return { name: 'Paire de couleur', mult: 12 };
    return { name: 'Paire mixte', mult: 5 };
  }

  function isStraight(ranks) {
    const idx = ranks.map((r) => ORDER.indexOf(r)).sort((x, y) => x - y);
    if (idx[0] + 1 === idx[1] && idx[1] + 1 === idx[2]) return true;
    // As haut : Q K A
    return idx[0] === 0 && idx[1] === 11 && idx[2] === 12;
  }

  function twentyOnePlusThree(a, b, up) {
    const cards = [a, b, up];
    const flush = cards.every((c) => c.suit === a.suit);
    const trips = cards.every((c) => c.rank === a.rank);
    const straight = !trips && isStraight(cards.map((c) => c.rank));
    if (trips && flush) return { name: 'Brelan de même couleur', mult: 100 };
    if (straight && flush) return { name: 'Quinte flush', mult: 40 };
    if (trips) return { name: 'Brelan', mult: 30 };
    if (straight) return { name: 'Suite', mult: 10 };
    if (flush) return { name: 'Couleur', mult: 5 };
    return null;
  }

  const api = { perfectPairs, twentyOnePlusThree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SideBets = api;
})(typeof window !== 'undefined' ? window : this);
