/*
 * Comptage de cartes Hi-Lo : 2 à 6 = +1, 7 à 9 = 0, 10 / figures / As = -1.
 * Compte vrai = compte courant / nombre de jeux restant dans le sabot.
 */
(function (root) {
  'use strict';

  function tag(rank) {
    if (rank === 'A' || rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return -1;
    const v = parseInt(rank, 10);
    return v >= 2 && v <= 6 ? 1 : 0;
  }

  function tagText(t) { return t > 0 ? '+1' : t < 0 ? '−1' : '0'; }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; }

  // Un compteur indépendant (solo ou table entre amis)
  function create() {
    const seen = new Set();
    const c = {
      running: 0,
      cards: 0,
      observe(card) {
        if (!card || card.id == null || seen.has(card.id)) return;
        seen.add(card.id);
        c.running += tag(card.rank);
        c.cards++;
      },
      reset(base) { seen.clear(); c.running = base || 0; c.cards = 0; },
      trueCount(cardsLeft) {
        const decks = Math.max(0.5, cardsLeft / 52);
        return c.running / decks;
      },
    };
    return c;
  }

  // Conseil de mise selon le compte vrai (en unités de mise de base)
  function betAdvice(tc) {
    const t = Math.floor(tc);
    if (t <= 0) return { units: 1, text: 'Sabot neutre ou défavorable : mise minimale (1 unité).' };
    if (t === 1) return { units: 1, text: 'Léger avantage pour toi, mais pas encore assez : reste à 1 unité.' };
    if (t === 2) return { units: 2, text: 'Compte vrai +2 : le sabot est riche en 10 et en As, mise 2 unités.' };
    if (t === 3) return { units: 4, text: 'Compte vrai +3 : tu as l\'avantage, mise 4 unités.' };
    return { units: 6, text: 'Compte vrai +' + t + ' : gros avantage, mise 6 unités ou plus.' };
  }

  const api = { tag, tagText, signed, create, betAdvice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HiLo = api;
})(typeof window !== 'undefined' ? window : this);
