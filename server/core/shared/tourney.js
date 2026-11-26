/*
 * Partie façon tournoi : blindes qui montent, éliminations, statistiques et récapitulatif.
 * Partagé par le poker solo (app.js) et entre amis (multi.js).
 */
(function (root) {
  'use strict';

  // Multiplicateurs des blindes de départ, niveau par niveau (10/20 → 20/40 → 30/60 → 50/100 → 80/160…)
  const LEVELS = [1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500];

  /** Règle de montée : '0' (jamais), 'h6' (toutes les 6 mains), 'm3' (toutes les 3 minutes). */
  function parseRule(v) {
    const m = /^([hm])(\d+)$/.exec(String(v || ''));
    return m ? { type: m[1] === 'h' ? 'hands' : 'minutes', n: +m[2] } : null;
  }
  function ruleLabel(v) {
    const r = parseRule(v);
    if (!r) return 'blindes fixes';
    return r.type === 'hands' ? 'toutes les ' + r.n + ' mains' : 'toutes les ' + r.n + ' minutes';
  }

  function blindsAt(baseSb, baseBb, level) {
    const m = LEVELS[Math.min(level, LEVELS.length - 1)];
    const r5 = (x) => Math.max(1, Math.round(x / 5) * 5);
    return { sb: r5(baseSb * m), bb: r5(baseBb * m) };
  }

  /**
   * À appeler au début de chaque main. lv = { level, handsAtLevel, levelStart } (modifié sur place).
   * Renvoie les nouvelles blindes si elles augmentent, sinon null.
   */
  function maybeLevelUp(lv, ruleStr, baseSb, baseBb, now) {
    const r = parseRule(ruleStr);
    lv.level = lv.level || 0;
    lv.handsAtLevel = lv.handsAtLevel || 0;
    if (!lv.levelStart) lv.levelStart = now;
    if (!r || lv.level >= LEVELS.length - 1) { lv.handsAtLevel++; return null; }
    const due = r.type === 'hands' ? lv.handsAtLevel >= r.n : now - lv.levelStart >= r.n * 60000;
    if (!due) { lv.handsAtLevel++; return null; }
    lv.level++;
    lv.handsAtLevel = 1;
    lv.levelStart = now;
    return blindsAt(baseSb, baseBb, lv.level);
  }

  /** Texte du prochain palier (« dans 3 mains », « dans 2:41 »). */
  function nextLevelText(lv, ruleStr, now) {
    const r = parseRule(ruleStr);
    if (!r || (lv.level || 0) >= LEVELS.length - 1) return '';
    if (r.type === 'hands') {
      const left = Math.max(1, r.n - (lv.handsAtLevel || 0) + 1);
      return 'hausse dans ' + left + ' main' + (left > 1 ? 's' : '');
    }
    const ms = Math.max(0, (lv.levelStart || now) + r.n * 60000 - now);
    return 'hausse dans ' + Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  }

  // ---------- Statistiques de partie ----------
  function createStats(now) {
    return { startedAt: now, hands: 0, biggestPot: null, players: {}, eliminated: [], allins: 0, showdowns: 0 };
  }

  /**
   * Enregistre une main terminée (st = état du moteur, street = 'showdown').
   * keyOf(i) : identifiant du joueur à la place i ; nameOf(i) : son nom.
   * Renvoie la liste des joueurs éliminés pendant cette main.
   */
  function recordHand(T, st, keyOf, nameOf, now) {
    T.hands++;
    const r = st.results;
    if (!r) return [];
    const total = r.pots.reduce((a, p) => a + p.amount, 0);
    const winners = [...new Set(r.pots.flatMap((p) => p.winners))];
    if (!r.uncontested) T.showdowns++;
    if (!T.biggestPot || total > T.biggestPot.amount) {
      T.biggestPot = { amount: total, name: winners.map(nameOf).join(' et '), hand: r.uncontested ? 'sans abattage' : (r.pots[0].hand || ''), handNo: st.handNo };
    }
    st.seats.forEach((s, i) => {
      if (!s.cards || !s.cards.length) return;
      const k = keyOf(i);
      if (!k) return;
      const p = T.players[k] || (T.players[k] = { name: nameOf(i), handsWon: 0, biggestWin: 0, allins: 0, played: 0 });
      p.name = nameOf(i);
      p.played++;
      if (s.allin) { p.allins++; T.allins++; }
      if (s.won > 0) {
        p.handsWon++;
        const gain = s.won - s.total;
        if (gain > p.biggestWin) p.biggestWin = gain;
      }
    });
    // Éliminations : plus de jetons après cette main
    const busted = [];
    st.seats.forEach((s, i) => {
      if (s.cards && s.cards.length && s.stack <= 0 && !T.eliminated.some((e) => e.key === keyOf(i))) busted.push(i);
    });
    const remaining = st.seats.filter((s) => s.stack > 0 && (s.owner !== undefined ? s.owner : true) && !s.outForGood).length;
    // Plusieurs éliminés dans la même main : celui qui avait le plus de jetons au départ finit devant
    busted.sort((a, b) => st.seats[b].total - st.seats[a].total);
    busted.forEach((i, k) => T.eliminated.push({ key: keyOf(i), name: nameOf(i), place: remaining + 1 + k, hand: st.handNo, at: now }));
    return busted;
  }

  /** Classement final : le vainqueur, puis les éliminés du dernier au premier. */
  function ranking(T, winnerKey, winnerName) {
    const list = [{ key: winnerKey, name: winnerName, place: 1 }];
    T.eliminated.slice().sort((a, b) => a.place - b.place).forEach((e) => list.push(e));
    return list.map((e) => Object.assign({}, e, T.players[e.key] || {}));
  }

  function duration(ms) {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'moins d\'une minute' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }

  const api = { LEVELS, parseRule, ruleLabel, blindsAt, maybeLevelUp, nextLevelText, createStats, recordHand, ranking, duration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tourney = api;
})(typeof window !== 'undefined' ? window : this);
