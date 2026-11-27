/*
 * Plinko — mathématiques du jeu (tables de gains, tirage vérifiable).
 *
 * La bille traverse `rows` rangées de picots ; à chaque picot elle part à gauche ou à droite avec la même chance.
 * Elle tombe dans la case k (= nombre de rebonds à droite) avec la probabilité C(rows, k) / 2^rows.
 * Chaque case paie un multiplicateur de la mise ; les tables sont calibrées pour rendre ≈ 97 % des mises
 * en moyenne (avantage maison ≈ 3 %, comme Rocket Crash). Le RTP exact de chaque réglage est calculé (rtpOf).
 *
 * Tirage : HMAC-SHA256(server seed, « client seed:nonce ») ; le bit i du hachage donne la direction au picot i
 * (0 = gauche, 1 = droite). Le hachage SHA-256 du server seed est publié avant de jouer, le seed est révélé
 * quand on en change : chacun peut recalculer le chemin exact de chaque bille.
 */
(function (root) {
  'use strict';
  const CONFIG = { MIN_BET: 1, MAX_BET: 1e9, MAX_WIN: 1e12, ROWS: [8, 10, 12, 14, 16], RISKS: ['low', 'medium', 'high'] };
  const RISK_NAMES = { low: 'Faible', medium: 'Moyen', high: 'Élevé' };

  // Tables de gains (moitié gauche, du bord vers le centre ; la table est symétrique).
  // Chacune rend entre 96,7 % et 97,3 % des mises en moyenne (vérifié par rtpOf et par simulation).
  const HALF = {
    8: { low: [5.6, 2.1, 1, 1, 0.5], medium: [13, 3, 1.2, 0.7, 0.4], high: [29, 4, 1.4, 0.3, 0.2] },
    10: { low: [8.9, 3, 1.4, 1, 1, 0.5], medium: [22, 4, 2, 1.4, 0.6, 0.4], high: [76, 10, 3, 0.8, 0.3, 0.2] },
    12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.4], medium: [33, 11, 4, 2, 1.1, 0.6, 0.2], high: [170, 24, 8.1, 2, 0.6, 0.2, 0.2] },
    14: { low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.4], medium: [58, 15, 7, 3.5, 1.9, 1, 0.5, 0.2], high: [420, 56, 18, 4.5, 1.9, 0.3, 0.2, 0.2] },
    16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.4], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.2], high: [1000, 130, 26, 8, 4, 2, 0.2, 0.2, 0.2] },
  };

  function binom(n) { const c = [1]; for (let k = 1; k <= n; k++) c[k] = c[k - 1] * (n - k + 1) / k; return c; }
  const probs = (n) => { const c = binom(n), t = Math.pow(2, n); return c.map((x) => x / t); };
  const TABLES = {};
  Object.keys(HALF).forEach((n) => {
    TABLES[n] = {};
    Object.keys(HALF[n]).forEach((r) => { const h = HALF[n][r]; TABLES[n][r] = h.concat(h.slice(0, h.length - 1).reverse()); });
  });
  const table = (rows, risk) => TABLES[rows][risk];
  const rtpOf = (rows, risk) => probs(rows).reduce((a, p, k) => a + p * table(rows, risk)[k], 0);
  const probOf = (rows, k) => probs(rows)[k];

  /** Chemin d'une bille à partir d'un hachage hexadécimal : tableau de 0/1, un par rangée. */
  function pathFromHex(hex, rows) {
    const out = [];
    for (let i = 0; i < rows; i++) { const nib = parseInt(hex[i >> 2], 16); out.push((nib >> (3 - (i & 3))) & 1); }
    return out;
  }
  const slotOf = (path) => path.reduce((a, b) => a + b, 0);
  /** Gain d'une bille (plafonné à MAX_WIN). */
  function settle(bet, rows, risk, slot) {
    const m = table(rows, risk)[slot];
    const payout = Math.min(CONFIG.MAX_WIN, Math.round(bet * m * 100) / 100);
    return { mult: m, payout, net: Math.round((payout - bet) * 100) / 100 };
  }
  /** Couleur d'une case selon son multiplicateur. */
  const tier = (m) => (m < 1 ? 'low' : m < 2 ? 'mid' : m < 10 ? 'high' : 'epic');

  // ---------- Provably Fair ----------
  const hexOf = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const cryptoOf = () => ((typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('crypto').webcrypto);
  function randomSeed() { const a = new Uint8Array(32); cryptoOf().getRandomValues(a); return hexOf(a.buffer); }
  async function sha256(text) { return hexOf(await cryptoOf().subtle.digest('SHA-256', new TextEncoder().encode(text))); }
  async function hmac(key, msg) {
    const s = cryptoOf().subtle;
    const k = await s.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hexOf(await s.sign('HMAC', k, new TextEncoder().encode(msg)));
  }
  async function pathFromSeeds(serverSeed, clientSeed, nonce, rows) { return pathFromHex(await hmac(serverSeed, clientSeed + ':' + nonce), rows); }
  function randomPath(rows) { const a = new Uint8Array(32); cryptoOf().getRandomValues(a); return pathFromHex(hexOf(a.buffer), rows); }

  /** Simulation : RTP mesuré sur n billes. */
  function simulate(n, rows, risk) {
    let back = 0;
    for (let i = 0; i < n; i++) back += settle(1, rows, risk, slotOf(randomPath(rows))).payout;
    return back / n;
  }

  const api = { CONFIG, RISK_NAMES, TABLES, table, rtpOf, probOf, probs, pathFromHex, slotOf, settle, tier, randomSeed, sha256, hmac, pathFromSeeds, randomPath, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlinkoEngine = api;
})(typeof window !== 'undefined' ? window : this);
