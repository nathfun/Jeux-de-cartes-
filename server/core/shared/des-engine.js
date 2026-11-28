/*
 * 421 — moteur partagé app / serveur.
 * On lance 3 dés, puis on peut relancer UNE fois les dés de son choix (ou s'arrêter tout de suite : gain ×1,5).
 * La combinaison finale paie selon la table PAYS (en multiple de la mise, mise comprise).
 * La meilleure stratégie possible est calculée exactement (best) : avec elle, le jeu rend ≈ 97 %.
 */
(function (root) {
  'use strict';
  const ROLLS = 2;
  // bonus selon le lancer où l'on s'arrête : plus on s'arrête tôt, plus la combinaison paie
  const BONUS = [1.5, 1];
  // table des gains (multiple de la mise, mise comprise) — l'ordre est celui de la valeur des combinaisons
  const PAYS = [
    { id: '421', name: '4-2-1', mult: 5, test: (d) => d[0] === 4 && d[1] === 2 && d[2] === 1 },
    { id: 'aces', name: 'Trois as', mult: 4, test: (d) => d[0] === 1 && d[1] === 1 && d[2] === 1 },
    { id: 'brelan', name: 'Brelan', mult: 1.8, test: (d) => d[0] === d[1] && d[1] === d[2] },
    { id: 'suite', name: 'Suite', mult: 1, test: (d) => d[0] === d[1] + 1 && d[1] === d[2] + 1 },
  ];
  const sortD = (d) => d.slice().sort((a, b) => b - a); // du plus grand au plus petit (4-2-1)
  /** Combinaison de 3 dés : { id, name, mult } (mult 0 si rien). */
  function evaluate(dice) {
    const d = sortD(dice);
    for (const p of PAYS) if (p.test(d)) return { id: p.id, name: p.name, mult: p.mult };
    return { id: 'rien', name: 'Rien', mult: 0 };
  }
  // ---------- meilleure stratégie (programmation dynamique exacte) ----------
  const memo = new Map();
  /** Valeur d'une main (dés triés) avec k relances restantes, en jouant au mieux. */
  function value(d, k) {
    const key = d.join('') + k;
    if (memo.has(key)) return memo.get(key);
    let best = evaluate(d).mult * BONUS[ROLLS - 1 - k];
    if (k > 0) for (let mask = 1; mask < 8; mask++) best = Math.max(best, rerollEV(d, mask, k));
    memo.set(key, best);
    return best;
  }
  /** Espérance si on relance les dés du masque (bit i = relancer le dé i). */
  function rerollEV(d, mask, k) {
    const idx = [0, 1, 2].filter((i) => mask & (1 << i)), n = idx.length, total = Math.pow(6, n);
    let s = 0;
    for (let c = 0; c < total; c++) {
      const nd = d.slice(); let x = c;
      idx.forEach((i) => { nd[i] = (x % 6) + 1; x = Math.floor(x / 6); });
      s += value(sortD(nd), k - 1);
    }
    return s / total;
  }
  /** Conseil : quels dés garder (true = garder) et l'espérance correspondante. rollsLeft = relances restantes. */
  function best(dice, rollsLeft) {
    const d = dice.slice();
    const stop = evaluate(d).mult * BONUS[ROLLS - 1 - rollsLeft];
    let bestMask = 0, bestV = stop;
    if (rollsLeft > 0) for (let mask = 1; mask < 8; mask++) { const v = rerollEV(d, mask, rollsLeft); if (v > bestV + 1e-12) { bestV = v; bestMask = mask; } }
    return { keep: [0, 1, 2].map((i) => !(bestMask & (1 << i))), stop: bestMask === 0, ev: bestV };
  }
  /** Retour moyen avec la meilleure stratégie (vérification de l'équilibre). */
  function rtp() {
    let s = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) s += value(sortD([a, b, c]), ROLLS - 1);
    return s / 216;
  }
  const roll = (rnd) => 1 + Math.floor(rnd() * 6);
  /** Gain (multiple de la mise) d'une main arrêtée après « throws » lancers (1, 2 ou 3). */
  const payMult = (dice, throws) => Math.round(evaluate(dice).mult * BONUS[Math.min(ROLLS, Math.max(1, throws)) - 1] * 100) / 100;
  const api = { ROLLS, BONUS, PAYS, evaluate, payMult, best, rtp, roll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiceEngine = api;
})(typeof window !== 'undefined' ? window : this);
