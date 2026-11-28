/*
 * Plus ou Moins — moteur partagé app / serveur.
 * Une carte est retournée (As = 1, le plus petit, jusqu'au Roi = 13). On parie que la suivante sera plus haute,
 * plus basse, ou de même valeur. Bonne réponse : le gain grimpe ; mauvaise : la mise est perdue.
 * Même valeur sur un pari « plus » ou « moins » : égalité, on continue sans rien perdre.
 * Gain = mise × RTP × produit des (1 / chance) de chaque bonne réponse : le jeu rend RTP quel que soit le moment où l'on s'arrête.
 */
(function (root) {
  'use strict';
  const RTP = 0.97, SKIPS = 3, MAX_FAIR = 5000;
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const draw = (rnd) => ({ r: 1 + rnd(13), s: rnd(4) });
  /** Chance de gagner chaque pari depuis une carte de rang r (égalités exclues pour « plus » / « moins »). */
  function chances(r) {
    return { hi: (13 - r) / 12, lo: (r - 1) / 12, eq: 1 / 13 };
  }
  /** Coefficient (« juste ») de chaque pari : 1 / chance. 0 = pari impossible. */
  function odds(r) {
    const c = chances(r);
    return { hi: c.hi ? 1 / c.hi : 0, lo: c.lo ? 1 / c.lo : 0, eq: 13 };
  }
  /** Résultat d'un pari : 'win', 'lose' ou 'push' (égalité sur plus/moins). */
  function judge(r, next, dir) {
    if (dir === 'eq') return next === r ? 'win' : 'lose';
    if (next === r) return 'push';
    return (dir === 'hi' ? next > r : next < r) ? 'win' : 'lose';
  }
  const payMult = (fair) => Math.floor(RTP * Math.min(MAX_FAIR, fair) * 100) / 100;
  const label = (c) => RANKS[c.r] + SUITS[c.s];
  const api = { RTP, SKIPS, MAX_FAIR, RANKS, SUITS, draw, chances, odds, judge, payMult, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HiloEngine = api;
})(typeof window !== 'undefined' ? window : this);
