/*
 * Loto Express — mathématiques du jeu (table des gains, tirage vérifiable).
 *
 * On coche de 1 à 8 numéros parmi 30 ; la sphère tire 10 boules (chaque numéro sort une fois sur trois). Le gain dépend du nombre de numéros cochés
 * et du nombre de bons numéros. Chance d'avoir m bons numéros sur k cochés :
 *   P(k, m) = C(k, m) × C(30 − k, 10 − m) / C(30, 10)
 * Les tables ci-dessous rendent environ 94 à 96 % des mises en moyenne, quel que soit le nombre de numéros joués.
 *
 * Tirage « Provably Fair » : les 10 boules viennent d'un mélange (Fisher-Yates) piloté par
 * HMAC-SHA256(server seed, « client seed:nonce:0 ») ; l'empreinte du server seed est publiée avant.
 */
(function (root) {
  'use strict';
  const CONFIG = { N: 30, DRAW: 10, MAX_PICK: 8, MIN_BET: 1, MAX_BET: 500, MAX_WIN: 10000 };
  // PAY[k][m] : multiplicateur de la mise (gain total rendu) avec k numéros cochés et m bons numéros
  const PAY = {
    1: { 1: 2.85 },
    2: { 1: 1, 2: 4.7 },
    3: { 1: 0.5, 2: 1.6, 3: 12 },
    4: { 2: 1.2, 3: 4.2, 4: 27 },
    5: { 2: 0.6, 3: 1.8, 4: 10, 5: 80 },
    6: { 3: 1.3, 4: 4.6, 5: 28, 6: 300 },
    7: { 3: 0.8, 4: 2.4, 5: 9.5, 6: 80, 7: 1000 },
    8: { 3: 0.4, 4: 1.4, 5: 5, 6: 28, 7: 300, 8: 3500 },
  };

  const comb = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  const prob = (k, m) => comb(k, m) * comb(CONFIG.N - k, CONFIG.DRAW - m) / comb(CONFIG.N, CONFIG.DRAW);
  const rtp = (k) => Object.keys(PAY[k]).reduce((a, m) => a + prob(k, +m) * PAY[k][m], 0);

  /** Les 10 boules (1..40) à partir de 128 caractères hexadécimaux, dans l'ordre de sortie. */
  function drawFromHex(hex) {
    const balls = Array.from({ length: CONFIG.N }, (_, i) => i + 1);
    let k = 0;
    for (let i = CONFIG.N - 1; i > CONFIG.N - 1 - CONFIG.DRAW; i--) {
      const r = parseInt(hex.substr((k++ % 32) * 4, 4), 16) / 65536;
      const j = Math.floor(r * (i + 1));
      const t = balls[i]; balls[i] = balls[j]; balls[j] = t;
    }
    return balls.slice(CONFIG.N - CONFIG.DRAW).reverse();
  }
  function validPicks(picks) {
    if (!Array.isArray(picks) || picks.length < 1 || picks.length > CONFIG.MAX_PICK) return false;
    const s = new Set(picks);
    return s.size === picks.length && picks.every((n) => Number.isInteger(n) && n >= 1 && n <= CONFIG.N);
  }
  function settle(bet, picks, drawn) {
    const set = new Set(drawn), hits = picks.filter((n) => set.has(n));
    const mult = PAY[picks.length][hits.length] || 0;
    const payout = Math.min(bet + CONFIG.MAX_WIN, Math.round(bet * mult * 100) / 100);
    return { hits, mult, payout, net: Math.round((payout - bet) * 100) / 100, jackpot: hits.length === picks.length && picks.length >= 5 };
  }

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
  async function drawFromSeeds(serverSeed, clientSeed, nonce) {
    const base = clientSeed + ':' + nonce;
    return drawFromHex((await hmac(serverSeed, base + ':0')) + (await hmac(serverSeed, base + ':1')));
  }
  /** Tirage local (mode apprentissage, sans serveur). */
  function localDraw() { const a = new Uint8Array(64); cryptoOf().getRandomValues(a); return drawFromHex(hexOf(a.buffer)); }

  const api = { CONFIG, PAY, prob, rtp, drawFromHex, validPicks, settle, randomSeed, sha256, hmac, drawFromSeeds, localDraw, comb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LotoEngine = api;
})(typeof window !== 'undefined' ? window : this);
