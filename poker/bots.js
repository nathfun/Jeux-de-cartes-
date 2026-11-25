/*
 * Adversaires automatiques. Ils s'appuient sur la même analyse que le coach,
 * avec un style qui les rend plus ou moins larges, agressifs et bluffeurs.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./coach.js') : root.PokerCoach;
  const P = isNode ? require('./engine.js') : root.PokerEngine;

  const STYLES = {
    prudent: { label: 'Prudent', looseness: -1, aggression: 0.35, bluff: 0.03 },
    regulier: { label: 'Régulier', looseness: 0, aggression: 0.65, bluff: 0.08 },
    agressif: { label: 'Agressif', looseness: 1.5, aggression: 0.9, bluff: 0.2 },
  };
  const NAMES = ['Léon', 'Sofia', 'Marius', 'Inès', 'Hugo', 'Jade', 'Malo', 'Lina'];

  function decide(st, i, styleKey) {
    const style = STYLES[styleKey] || STYLES.regulier;
    const res = C.analyze(st, i, { iters: 220, style });
    const L = res.legal;
    let a = { type: res.rec.type, to: res.rec.to };
    const rnd = Math.random();
    if (a.type === 'raise' && rnd > style.aggression) a = { type: L.toCall ? 'call' : 'check' };
    else if (a.type === 'check' && L.canRaise && st.street !== 'preflop' && rnd < style.bluff) {
      a = { type: 'raise', to: Math.max(L.minTo, Math.round(L.pot * 0.5)) }; // bluff
    } else if (a.type === 'fold' && st.street !== 'river' && L.toCall <= st.bb * 2 && rnd < style.bluff * 1.5) {
      a = { type: 'call' }; // suit pour voir
    }
    if (a.type === 'raise') {
      const vary = 0.85 + Math.random() * 0.3;
      a.to = Math.max(L.minTo, Math.min(L.maxTo, Math.round((a.to * vary) / 5) * 5));
      if (a.to >= L.maxTo * 0.85) a = { type: 'allin' };
    }
    return a;
  }

  /** Joue l'action du bot ; si elle était refusée, se rabat sur parler / suivre / se coucher. */
  function play(st, i, styleKey) {
    const a = decide(st, i, styleKey);
    if (P.act(st, i, a)) return a;
    const L = P.legal(st, i);
    const fb = L.canCheck ? { type: 'check' } : { type: 'call' };
    if (P.act(st, i, fb)) return fb;
    P.act(st, i, { type: 'fold' });
    return { type: 'fold' };
  }

  const api = { STYLES, NAMES, decide, play };
  if (isNode) module.exports = api;
  else root.PokerBots = api;
})(typeof window !== 'undefined' ? window : this);
