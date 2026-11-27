/*
 * Le Braquage — machine à sous 3 × 3, 5 lignes (3 horizontales + 2 diagonales).
 * 🕴️ (le parrain) remplace tous les symboles ; 3 🔐 n'importe où déclenchent « Le Coffre » :
 * on choisit un coffre-fort parmi trois, il contient ×5 à ×100 la mise. Redistribution ≈ 95 % (vérifiée par simulation).
 */
(function (root) {
  'use strict';
  const SYMBOLS = [
    { s: '🍒', w: 34, pay: 5 }, { s: '🔔', w: 26, pay: 9 }, { s: '💵', w: 18, pay: 19 },
    { s: '💎', w: 10, pay: 44 }, { s: '7️⃣', w: 5, pay: 115 }, { s: '🕴️', w: 3, pay: 320, wild: true }, { s: '🔐', w: 6, scatter: true },
  ];
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [6, 4, 2]];
  const SAFE = [{ m: 5, w: 55 }, { m: 10, w: 28 }, { m: 25, w: 12 }, { m: 100, w: 5 }];
  const TOTAL = SYMBOLS.reduce((a, x) => a + x.w, 0);
  function pick(r) { let x = r() * TOTAL; for (const it of SYMBOLS) { if (x < it.w) return it.s; x -= it.w; } return SYMBOLS[0].s; }
  const bySym = Object.fromEntries(SYMBOLS.map((x) => [x.s, x]));
  /** Tire une grille (9 cases, ligne par ligne) et calcule les gains. */
  function spin(bet, r) {
    const grid = Array.from({ length: 9 }, () => pick(r));
    const lineBet = bet / LINES.length, wins = [];
    LINES.forEach((L, li) => {
      const syms = L.map((i) => grid[i]);
      if (syms.some((x) => bySym[x].scatter)) return;
      const base = syms.find((x) => !bySym[x].wild) || '🕴️';
      if (syms.every((x) => x === base || bySym[x].wild)) wins.push({ line: li, cells: L, s: base, win: Math.round(lineBet * bySym[base].pay * 100) / 100 });
    });
    const scatters = grid.filter((x) => bySym[x].scatter).length;
    let bonus = null;
    if (scatters >= 3) {
      const t = SAFE.reduce((a, x) => a + x.w, 0); let x = r() * t, m = SAFE[0].m;
      for (const it of SAFE) { if (x < it.w) { m = it.m; break; } x -= it.w; }
      bonus = { mult: m, win: Math.round(bet * m * (scatters >= 4 ? 2 : 1) * 100) / 100, double: scatters >= 4 };
    }
    const total = Math.round((wins.reduce((a, w) => a + w.win, 0) + (bonus ? bonus.win : 0)) * 100) / 100;
    return { grid, wins, bonus, total, scatters };
  }
  function simulate(n) { let st = 0, back = 0, b = 0; const r = Math.random; for (let i = 0; i < n; i++) { const o = spin(10, r); st += 10; back += o.total; if (o.bonus) b++; } return { rtp: back / st, bonusRate: b / n }; }
  const api = { SYMBOLS, LINES, SAFE, spin, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeistEngine = api;
})(typeof window !== 'undefined' ? window : this);
