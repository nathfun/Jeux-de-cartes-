/*
 * « Ruée vers l'Or » — machine à sous à bonus « Le Filon » (mécanique « hold & spin »), moteur partagé app / serveur.
 *
 * Jeu de base : 5 rouleaux × 3 rangées, 243 façons de gagner (un symbole paie s'il est présent sur des rouleaux
 * consécutifs en partant de la gauche ; gain × nombre de combinaisons). La dynamite 🧨 remplace tout (rouleaux 2 à 4).
 * Les pépites 🟡 portent une valeur (× la mise) : elles ne paient pas seules, elles déclenchent le bonus.
 * « Coup de grisou » (au hasard) : 1 ou 2 rouleaux du milieu explosent en dynamite.
 *
 * Bonus « Le Filon » : 6 pépites ou plus → les pépites restent en place, 3 relances.
 * Chaque nouvelle pépite reste et remet les relances à 3. Pépites spéciales pendant le bonus :
 *   🚃 wagon : ramasse la valeur de toutes les pépites présentes ;  💥 filon : double toutes les pépites présentes.
 * Grille pleine (15 pépites) → jackpot GRAND (1 000 × la mise) en plus.
 * Jackpots MINI / MINEUR / MAJEUR : pépites rares de 20, 50 et 200 × la mise.
 *
 * Le hasard vient d'une fonction rng() → [0, 1[ (cryptographique dans l'app, crypto.randomInt sur le serveur).
 * Vérifié par simulation (simulate, 800 000 tours) : taux de retour ≈ 96–97 %, 38 % de tours gagnants,
 * bonus « Le Filon » environ 1 tour sur 120 (≈ 37 % des gains).
 */
(function (root) {
  'use strict';
  const BETS = (() => { const a = []; for (let e = 1; e <= 1e8; e *= 10) [1, 2, 5].forEach((m) => a.push(m * e)); [25, 250, 2500, 25000, 250000].forEach((v) => a.push(v)); return a.sort((x, y) => x - y); })();
  const REELS = 5, ROWS = 3, CELLS = REELS * ROWS;
  const UNIT = 20; // les gains du tableau sont en « mise ÷ 20 »
  const SYMBOLS = {
    P: { icon: '🤠', name: 'Prospecteur', pay: [0, 0, 0, 9, 29, 115] },
    S: { icon: '💰', name: 'Sac d\'or', pay: [0, 0, 0, 6.5, 18, 72] },
    T: { icon: '🚂', name: 'Train', pay: [0, 0, 0, 4.5, 13, 50] },
    M: { icon: '🐴', name: 'Mule', pay: [0, 0, 0, 3.5, 10, 36] },
    X: { icon: '⛏️', name: 'Pioche', pay: [0, 0, 0, 1.5, 3.5, 14] },
    C: { icon: '🧭', name: 'Boussole', pay: [0, 0, 0, 1.5, 3, 11] },
    L: { icon: '🔦', name: 'Lampe', pay: [0, 0, 0, 0.75, 2.25, 7.5] },
    R: { icon: '🪨', name: 'Roche', pay: [0, 0, 0, 0.75, 2.25, 7.5] },
    W: { icon: '🧨', name: 'Dynamite (joker)', wild: true },
    N: { icon: '🟡', name: 'Pépite', nugget: true },
  };
  // poids de tirage de chaque case (par rouleau) : les rouleaux du milieu ont la dynamite
  const BASE_W = { P: 3, S: 4, T: 5, M: 6, X: 10, C: 11, L: 13, R: 13 };
  const WILD_W = [0, 3, 3, 3, 0];
  const NUGGET_W = 10;           // chance d'une pépite par case (jeu de base)
  const GRISOU = 1 / 16;          // « Coup de grisou » : rouleaux de dynamite
  const TRIGGER = 6;              // pépites pour lancer le bonus
  // valeurs des pépites (× la mise) et jackpots
  const NUGGET_VALUES = [[1, 30], [2, 22], [3, 14], [5, 10], [8, 6], [10, 5], [15, 3]];
  const JACKPOTS = { mini: { x: 20, name: 'MINI', w: 1.6 }, minor: { x: 50, name: 'MINEUR', w: 0.6 }, major: { x: 200, name: 'MAJEUR', w: 0.12 }, grand: { x: 1000, name: 'GRAND' } };
  const BONUS_NEW = 0.05;        // chance qu'une case vide se remplisse à chaque relance
  const WAGON = 0.05, BOOST = 0.035; // pépites spéciales (parmi les nouvelles pépites du bonus)

  function pickW(rng, entries) {
    let t = 0; for (const e of entries) t += e[1];
    let r = rng() * t;
    for (const e of entries) { r -= e[1]; if (r < 0) return e[0]; }
    return entries[entries.length - 1][0];
  }
  /** Une pépite : { v: multiple de la mise, jp?: 'mini'|'minor'|'major' } */
  function nugget(rng) {
    const r = rng() * 100;
    if (r < JACKPOTS.major.w) return { v: JACKPOTS.major.x, jp: 'major' };
    if (r < JACKPOTS.major.w + JACKPOTS.minor.w) return { v: JACKPOTS.minor.x, jp: 'minor' };
    if (r < JACKPOTS.major.w + JACKPOTS.minor.w + JACKPOTS.mini.w) return { v: JACKPOTS.mini.x, jp: 'mini' };
    return { v: pickW(rng, NUGGET_VALUES) };
  }
  const idx = (reel, row) => reel * ROWS + row;

  /** Grille du jeu de base : tableau de 15 cases { s, n? } (colonne par colonne). */
  function spinGrid(rng) {
    const grid = [];
    for (let c = 0; c < REELS; c++) {
      const w = Object.entries(BASE_W).concat([['W', WILD_W[c]], ['N', NUGGET_W]]);
      for (let r = 0; r < ROWS; r++) {
        const s = pickW(rng, w);
        grid.push(s === 'N' ? { s, n: nugget(rng) } : { s });
      }
    }
    let grisou = null;
    if (rng() < GRISOU) {
      const reels = [1, 2, 3].filter(() => rng() < 0.5);
      if (!reels.length) reels.push(1 + Math.floor(rng() * 3));
      reels.forEach((c) => { for (let r = 0; r < ROWS; r++) grid[idx(c, r)] = { s: 'W' }; });
      grisou = reels;
    }
    return { grid, grisou };
  }

  /** Gains « 243 façons » : liste des gains { s, count, ways, win, cells } en € pour la mise donnée. */
  function evaluate(grid, bet) {
    const unit = bet / UNIT, wins = [];
    Object.keys(SYMBOLS).forEach((s) => {
      const def = SYMBOLS[s]; if (!def.pay) return;
      let ways = 1, count = 0; const cells = [];
      for (let c = 0; c < REELS; c++) {
        let k = 0;
        for (let r = 0; r < ROWS; r++) { const g = grid[idx(c, r)]; if (g.s === s || g.s === 'W') { k++; cells.push(idx(c, r)); } }
        if (!k) break;
        ways *= k; count++;
      }
      if (count >= 3 && def.pay[count]) {
        // on ne garde que les cases des rouleaux qui comptent
        wins.push({ s, count, ways, win: Math.round(def.pay[count] * ways * unit * 100) / 100, cells: cells.filter((i) => Math.floor(i / ROWS) < count) });
      }
    });
    return wins;
  }

  /** Bonus « Le Filon ». Renvoie les étapes (pour l'animation) et le total. */
  function bonus(grid, bet, rng) {
    const cells = grid.map((g) => (g.s === 'N' ? { v: g.n.v, jp: g.n.jp || null } : null));
    let left = 3; const steps = [];
    while (left > 0 && cells.some((x) => !x)) {
      const added = [];
      cells.forEach((x, i) => {
        if (x || rng() >= BONUS_NEW) return;
        const r = rng();
        if (r < WAGON) { cells[i] = { v: 0, kind: 'wagon' }; added.push(i); }
        else if (r < WAGON + BOOST) { cells[i] = { v: 0, kind: 'boost' }; added.push(i); }
        else { const n = nugget(rng); cells[i] = { v: n.v, jp: n.jp || null }; added.push(i); }
      });
      // effets des pépites spéciales, dans l'ordre d'arrivée
      const effects = [];
      added.forEach((i) => {
        const x = cells[i];
        if (x.kind === 'wagon') { const sum = cells.reduce((a, y, j) => a + (y && j !== i ? y.v : 0), 0); x.v = sum; x.kind = 'wagonDone'; effects.push({ i, kind: 'wagon', v: sum }); }
        else if (x.kind === 'boost') { cells.forEach((y, j) => { if (y && j !== i && y.v) y.v *= 2; }); x.v = 0; x.kind = 'boostDone'; effects.push({ i, kind: 'boost' }); }
      });
      left = added.length ? 3 : left - 1;
      steps.push({ added, effects, left, cells: cells.map((x) => (x ? { v: x.v, jp: x.jp || null, kind: x.kind || null } : null)) });
    }
    const full = cells.every((x) => x);
    const totalX = cells.reduce((a, x) => a + (x ? x.v : 0), 0) + (full ? JACKPOTS.grand.x : 0);
    return { steps, full, totalX, total: Math.round(totalX * bet * 100) / 100 };
  }

  /** Un tour complet : grille, gains, éventuel bonus. */
  function play(bet, rng) {
    const { grid, grisou } = spinGrid(rng);
    const wins = evaluate(grid, bet);
    const base = Math.round(wins.reduce((a, w) => a + w.win, 0) * 100) / 100;
    const nuggets = grid.filter((g) => g.s === 'N').length;
    const bon = nuggets >= TRIGGER ? bonus(grid, bet, rng) : null;
    const total = Math.round((base + (bon ? bon.total : 0)) * 100) / 100;
    const jackpot = bon ? (bon.full ? 'grand' : (bon.steps.length ? bon.steps[bon.steps.length - 1].cells : grid.map((g) => (g.s === 'N' ? { jp: g.n.jp } : null))).reduce((best, x) => {
      const order = ['mini', 'minor', 'major'];
      return x && x.jp && order.indexOf(x.jp) > order.indexOf(best || '') ? x.jp : best;
    }, null)) : null;
    return { grid, grisou, wins, base, nuggets, bonus: bon, total, jackpot };
  }

  /** Simulation : taux de retour, fréquence des gains et du bonus. */
  function simulate(n, rng) {
    rng = rng || Math.random;
    let staked = 0, back = 0, hits = 0, bonuses = 0, bonusBack = 0, grands = 0, grisous = 0;
    for (let i = 0; i < n; i++) {
      const r = play(10, rng);
      staked += 10; back += r.total;
      if (r.total > 0) hits++;
      if (r.bonus) { bonuses++; bonusBack += r.bonus.total; if (r.bonus.full) grands++; }
      if (r.grisou) grisous++;
    }
    return { rtp: back / staked, hit: hits / n, bonusEvery: n / Math.max(1, bonuses), bonusShare: bonusBack / Math.max(1, back), grands, grisous: grisous / n };
  }

  const api = { BETS, REELS, ROWS, CELLS, UNIT, SYMBOLS, JACKPOTS, TRIGGER, spinGrid, evaluate, bonus, play, simulate, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoldEngine = api;
})(typeof window !== 'undefined' ? window : this);
