/*
 * Machine à sous « Casino Royal » : 5 rouleaux, 3 rangées, 10 lignes de gain.
 * - Les gains se comptent de gauche à droite, à partir du 1er rouleau (3, 4 ou 5 symboles identiques).
 * - 🃏 Joker : remplace n'importe quel symbole sauf 🎰 (il n'apparaît que sur les rouleaux 2 à 4).
 * - 🎰 Bonus : 3 ou plus n'importe où → gain + tours gratuits où tous les gains sont doublés.
 * - Cinq 7️⃣ sur une ligne : JACKPOT.
 * Taux de redistribution réglé par simulation (voir rtp) : la machine rend environ 94 % des mises.
 */
(function (root) {
  'use strict';
  const SYMBOLS = [
    { id: 'cerise', icon: '🍒', weight: 30, pays: [0, 0, 0, 11, 26, 60] },
    { id: 'citron', icon: '🍋', weight: 28, pays: [0, 0, 0, 13, 36, 90] },
    { id: 'orange', icon: '🍊', weight: 25, pays: [0, 0, 0, 16, 46, 130] },
    { id: 'raisin', icon: '🍇', weight: 20, pays: [0, 0, 0, 21, 66, 180] },
    { id: 'cloche', icon: '🔔', weight: 14, pays: [0, 0, 0, 35, 110, 350] },
    { id: 'etoile', icon: '⭐', weight: 10, pays: [0, 0, 0, 55, 180, 650] },
    { id: 'diamant', icon: '💎', weight: 6, pays: [0, 0, 0, 90, 350, 1300] },
    { id: 'sept', icon: '7️⃣', weight: 3, pays: [0, 0, 0, 140, 650, 5000] },
    { id: 'joker', icon: '🃏', weight: 4, wild: true },
    { id: 'bonus', icon: '🎰', weight: 3, scatter: true },
  ];
  const byId = {};
  SYMBOLS.forEach((s) => { byId[s.id] = s; });
  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  ];
  const SCATTER = { 3: { mult: 2, free: 8 }, 4: { mult: 10, free: 12 }, 5: { mult: 50, free: 20 } };
  let PAY_SCALE = 1; // multiplicateur global des gains (réglé pour viser ~95 %)

  function pick(reel, random) {
    const pool = SYMBOLS.filter((s) => !(s.wild && (reel === 0 || reel === 4)));
    const total = pool.reduce((a, s) => a + s.weight, 0);
    let r = random() * total;
    for (const s of pool) { r -= s.weight; if (r < 0) return s.id; }
    return pool[pool.length - 1].id;
  }

  /** Tire une grille 5 × 3 : grid[rouleau][rangée] = identifiant de symbole. */
  function spinGrid(random) {
    random = random || Math.random;
    return [0, 1, 2, 3, 4].map((r) => [0, 1, 2].map(() => pick(r, random)));
  }

  /**
   * Calcule les gains d'une grille pour une mise totale `bet` (répartie sur les 10 lignes).
   * free = true : tours gratuits (gains doublés).
   */
  function evaluate(grid, bet, free) {
    const lineBet = bet / LINES.length;
    const wins = [];
    let total = 0;
    LINES.forEach((line, li) => {
      const syms = line.map((row, reel) => grid[reel][row]);
      if (syms[0] === 'bonus') return;
      // symbole de la ligne : le premier qui n'est pas un joker
      const base = syms.find((s) => s !== 'joker') || 'sept';
      if (byId[base].scatter) return;
      let count = 0;
      for (const s of syms) { if (s === base || s === 'joker') count++; else break; }
      if (count >= 3) {
        const amount = byId[base].pays[count] * lineBet * PAY_SCALE * (free ? 2 : 1);
        const jackpot = base === 'sept' && count === 5;
        wins.push({ line: li, symbol: base, count, amount, jackpot, cells: line.slice(0, count).map((row, reel) => [reel, row]) });
        total += amount;
      }
    });
    // symboles bonus n'importe où
    const scat = [];
    grid.forEach((col, reel) => col.forEach((s, row) => { if (s === 'bonus') scat.push([reel, row]); }));
    let freeSpins = 0;
    if (scat.length >= 3) {
      const sc = SCATTER[Math.min(5, scat.length)];
      const amount = sc.mult * bet * (free ? 2 : 1);
      total += amount;
      freeSpins = sc.free;
      wins.push({ scatter: true, count: scat.length, amount, cells: scat });
    }
    return { wins, total: Math.round(total * 100) / 100, freeSpins, jackpot: wins.some((w) => w.jackpot) };
  }

  /** Simulation : taux de redistribution (gains / mises, tours gratuits compris). */
  function rtp(n, random) {
    random = random || Math.random;
    let staked = 0, won = 0, free = 0;
    for (let i = 0; i < n; i++) {
      staked += 10;
      let r = evaluate(spinGrid(random), 10, false);
      won += r.total; free += r.freeSpins;
      while (free > 0) { free--; r = evaluate(spinGrid(random), 10, true); won += r.total; free += r.freeSpins; }
    }
    return won / staked;
  }

  const api = { SYMBOLS, byId, LINES, SCATTER, spinGrid, evaluate, rtp, setScale(x) { PAY_SCALE = x; }, get scale() { return PAY_SCALE; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlotEngine = api;
})(typeof window !== 'undefined' ? window : this);
