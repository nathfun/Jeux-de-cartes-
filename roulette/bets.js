/*
 * Roulette européenne (un seul zéro), règles françaises.
 * - Gains : plein 35:1, cheval 17:1, transversale 11:1, carré 8:1, sixain 5:1,
 *   douzaine / colonne 2:1, chances simples 1:1.
 * - « Partage » : quand le 0 sort, les chances simples (rouge/noir, pair/impair, manque/passe)
 *   ne perdent que la moitié de la mise.
 * Le tapis est décrit dans un repère de cases (tapis horizontal), et peut être tourné en vertical (téléphone).
 */
(function (root) {
  'use strict';
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const color = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

  const TYPES = {
    plein: { label: 'Plein', payout: 35 },
    cheval: { label: 'Cheval', payout: 17 },
    trans: { label: 'Transversale', payout: 11 },
    carre: { label: 'Carré', payout: 8 },
    sixain: { label: 'Sixain', payout: 5 },
    douzaine: { label: 'Douzaine', payout: 2 },
    colonne: { label: 'Colonne', payout: 2 },
    simple: { label: 'Chance simple', payout: 1 },
  };

  // Position des numéros (tapis horizontal) : colonne = transversale, ligne 0 en haut (3, 6, … 36)
  const cellOf = (n) => ({ x: Math.floor((n - 1) / 3), y: 2 - ((n - 1) % 3) });

  const spots = [];
  const byKey = {};
  function add(key, type, numbers, rect, name, z) {
    const s = { key, type, numbers, rect, name, z: z || 0, payout: TYPES[type].payout };
    spots.push(s); byKey[key] = s;
  }
  const H = 0.34; // taille des zones de clic entre les cases

  // Pleins
  add('n0', 'plein', [0], { x: -1, y: 0, w: 1, h: 3 }, 'Plein 0');
  for (let n = 1; n <= 36; n++) { const c = cellOf(n); add('n' + n, 'plein', [n], { x: c.x, y: c.y, w: 1, h: 1 }, 'Plein ' + n); }
  // Chevaux (deux numéros voisins)
  for (let n = 1; n <= 36; n++) {
    const c = cellOf(n);
    if (n % 3 !== 0) add('c' + n + '-' + (n + 1), 'cheval', [n, n + 1], { x: c.x + 0.5 - H / 2, y: c.y - H / 2, w: H, h: H }, 'Cheval ' + n + '/' + (n + 1), 1);
    if (n <= 33) add('c' + n + '-' + (n + 3), 'cheval', [n, n + 3], { x: c.x + 1 - H / 2, y: c.y + 0.5 - H / 2, w: H, h: H }, 'Cheval ' + n + '/' + (n + 3), 1);
  }
  [1, 2, 3].forEach((n) => { const c = cellOf(n); add('c0-' + n, 'cheval', [0, n], { x: -H / 2, y: c.y + 0.5 - H / 2, w: H, h: H }, 'Cheval 0/' + n, 1); });
  // Transversales (3 numéros d'une colonne du tapis), sur le bord bas
  for (let t = 0; t < 12; t++) add('t' + (t * 3 + 1), 'trans', range(t * 3 + 1, t * 3 + 3), { x: t + 0.5 - H / 2, y: 3 - H / 2, w: H, h: H }, 'Transversale ' + (t * 3 + 1) + '-' + (t * 3 + 3), 1);
  add('t0-1-2', 'trans', [0, 1, 2], { x: -H / 2, y: 2 - H / 2, w: H, h: H }, 'Transversale 0-1-2', 2);
  add('t0-2-3', 'trans', [0, 2, 3], { x: -H / 2, y: 1 - H / 2, w: H, h: H }, 'Transversale 0-2-3', 2);
  // Carrés (4 numéros)
  for (let n = 1; n <= 32; n++) {
    if (n % 3 === 0) continue;
    const c = cellOf(n);
    add('q' + [n, n + 1, n + 3, n + 4].join('-'), 'carre', [n, n + 1, n + 3, n + 4], { x: c.x + 1 - H / 2, y: c.y - H / 2, w: H, h: H }, 'Carré ' + n + '-' + (n + 4), 2);
  }
  add('q0-1-2-3', 'carre', [0, 1, 2, 3], { x: -H / 2, y: 3 - H / 2, w: H, h: H }, 'Carré 0-1-2-3', 2);
  // Sixains (deux transversales voisines), au coin du bord bas
  for (let t = 0; t < 11; t++) add('s' + (t * 3 + 1), 'sixain', range(t * 3 + 1, t * 3 + 6), { x: t + 1 - H / 2, y: 3 - H / 2, w: H, h: H }, 'Sixain ' + (t * 3 + 1) + '-' + (t * 3 + 6), 2);
  // Colonnes (2 pour 1, au bout de chaque ligne)
  [0, 1, 2].forEach((row) => {
    const nums = range(1, 36).filter((n) => cellOf(n).y === row);
    const k = 3 - row; // colonne 3 en haut
    add('col' + k, 'colonne', nums, { x: 12, y: row, w: 1, h: 1 }, 'Colonne ' + k);
  });
  // Douzaines
  [0, 1, 2].forEach((d) => add('d' + (d + 1), 'douzaine', range(d * 12 + 1, d * 12 + 12), { x: d * 4, y: 3.15, w: 4, h: 0.7 }, (d + 1) + (d ? 'e' : 're') + ' douzaine'));
  // Chances simples
  const simples = [
    ['low', 'Manque (1-18)', range(1, 18)], ['even', 'Pair', range(1, 36).filter((n) => n % 2 === 0)],
    ['red', 'Rouge', range(1, 36).filter((n) => RED.has(n))], ['black', 'Noir', range(1, 36).filter((n) => !RED.has(n))],
    ['odd', 'Impair', range(1, 36).filter((n) => n % 2 === 1)], ['high', 'Passe (19-36)', range(19, 36)],
  ];
  simples.forEach(([k, name, nums], i) => add(k, 'simple', nums, { x: i * 2, y: 3.9, w: 2, h: 0.7 }, name));

  // Dimensions du tapis horizontal : x de -1 à 13, y de 0 à 4.6
  const BOUNDS = { x: -1, y: 0, w: 14, h: 4.6 };

  /** Rectangle d'une zone, en tapis horizontal ou vertical (pour les téléphones). */
  function rectFor(spot, vertical) {
    const r = spot.rect;
    if (!vertical) return { x: r.x - BOUNDS.x, y: r.y - BOUNDS.y, w: r.w, h: r.h };
    // rotation : les numéros 1-2-3 de gauche à droite, le 0 en haut, les chances simples à gauche
    return { x: 3 - (r.y + r.h) + (BOUNDS.h - 3), y: r.x - BOUNDS.x, w: r.h, h: r.w };
  }
  function size(vertical) { return vertical ? { w: BOUNDS.h, h: BOUNDS.w } : { w: BOUNDS.w, h: BOUNDS.h }; }

  /** Somme récupérée pour une mise sur `key` si le numéro `n` sort (mise comprise ; 0 si perdu). */
  function payout(key, amount, n) {
    const s = byKey[key];
    if (!s) return 0;
    if (s.numbers.includes(n)) return amount * (s.payout + 1);
    if (s.type === 'simple' && n === 0) return amount / 2; // partage
    return 0;
  }

  /** Infos pédagogiques d'une mise. */
  function info(key) {
    const s = byKey[key];
    const p = s.numbers.length / 37;
    const edge = s.type === 'simple' ? 1.35 : 2.7;
    return {
      name: s.name, type: TYPES[s.type].label, numbers: s.numbers, payout: s.payout,
      chance: p, edge,
      text: s.name + ' : couvre ' + s.numbers.length + ' numéro' + (s.numbers.length > 1 ? 's' : '') +
        ', paie ' + s.payout + ' contre 1. Chance de gagner : ' + (p * 100).toFixed(1).replace('.', ',') + ' % (' + s.numbers.length + ' sur 37). ' +
        'Le casino garde en moyenne ' + String(edge).replace('.', ',') + ' % de chaque mise' +
        (s.type === 'simple' ? ' (grâce au partage : si le 0 sort, tu récupères la moitié).' : ' (à cause du 0).'),
    };
  }

  function describe(n) {
    if (n === 0) return 'Zéro';
    return n + ' ' + (RED.has(n) ? 'rouge' : 'noir') + ', ' + (n % 2 ? 'impair' : 'pair') + ' et ' + (n <= 18 ? 'manque' : 'passe');
  }

  const api = { RED, WHEEL, color, spots, byKey, TYPES, rectFor, size, payout, info, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RouletteBets = api;
})(typeof window !== 'undefined' ? window : this);
