/*
 * Rocket Crash — mathématiques du jeu (partagées par l'app et par le serveur functions/).
 *
 * Distribution du point d'explosion (« crash ») :
 *   r uniforme dans [0, 1[  →  crash = max(1.00, ⌊100 · RTP / (1 − r)⌋ / 100), plafonné à MAX_MULT.
 *   Pour tout multiplicateur m > 1 :  P(crash ≥ m) = RTP / m.
 *   Un joueur qui retire à m gagne m × mise avec la probabilité RTP / m : son espérance vaut RTP × mise,
 *   quelle que soit sa stratégie. Avantage maison = 1 − RTP (3 % par défaut), sans jamais toucher une manche.
 *   Avec probabilité 1 − RTP, crash = 1.00 : la fusée explose au décollage.
 *
 * Tirage : générateur cryptographique (crypto.getRandomValues / crypto du serveur), jamais Math.random().
 * Provably Fair : r peut aussi venir de HMAC-SHA256(server seed, « client seed:nonce ») ; le hachage SHA-256
 * du server seed est publié avant la manche, le seed lui-même est révélé quand on en change, et chacun peut
 * recalculer le résultat de chaque manche.
 *
 * Vol : le multiplicateur suit m(t) = e^(K·t) (t en millisecondes) : ×2 en 11,6 s, ×10 en 38 s, ×100 en 77 s.
 */
(function (root) {
  'use strict';
  const CONFIG = {
    RTP: 0.97,          // taux de redistribution (avantage maison = 3 %)
    K: 0.00006,         // vitesse de croissance du multiplicateur
    MAX_MULT: 10000,    // plafond d'affichage du multiplicateur
    MIN_BET: 1,
    MAX_BET: 500,
    MAX_WIN: 10000,    // gain maximal par manche : retrait automatique au-delà
    COUNTDOWN_MS: 6000, // temps pour miser avant le décollage
    LAUNCH_MS: 900,     // allumage des moteurs (le multiplicateur reste à 1.00)
    CRASH_SHOW_MS: 3200,
  };

  const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

  /** Point d'explosion à partir d'un nombre uniforme r de [0, 1[. */
  function crashFromFloat(r, rtp) {
    rtp = rtp || CONFIG.RTP;
    if (!(r >= 0 && r < 1)) throw new Error('r hors de [0, 1[');
    const raw = rtp / (1 - r);
    if (raw < 1) return 1;
    return Math.min(CONFIG.MAX_MULT, floor2(raw));
  }

  /** Nombre uniforme sur 52 bits à partir d'un hachage hexadécimal (13 premiers chiffres). */
  function floatFromHex(hex) {
    return parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
  }

  /** Nombre uniforme cryptographique (navigateur ou Node). */
  function secureFloat() {
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : (typeof require === 'function' ? require('crypto').webcrypto : null);
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    // 52 bits : 32 bits + 20 bits
    return (a[0] * Math.pow(2, 20) + (a[1] >>> 12)) / Math.pow(2, 52);
  }

  const multiplierAt = (ms) => (ms <= 0 ? 1 : Math.min(CONFIG.MAX_MULT, floor2(Math.exp(CONFIG.K * ms))));
  const exactAt = (ms) => (ms <= 0 ? 1 : Math.exp(CONFIG.K * ms));
  const timeFor = (m) => (m <= 1 ? 0 : Math.log(m) / CONFIG.K);
  /** Probabilité que la fusée atteigne au moins m. */
  const probReach = (m, rtp) => (m <= 1 ? 1 : Math.min(1, (rtp || CONFIG.RTP) / m));
  /** Couleur de l'historique selon le multiplicateur. */
  const tier = (m) => (m < 1.5 ? 'low' : m < 2 ? 'mid' : m < 10 ? 'high' : 'epic');

  // ---------- Provably Fair ----------
  const hexOf = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  function randomSeed() {
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('crypto').webcrypto;
    const a = new Uint8Array(32); c.getRandomValues(a);
    return hexOf(a.buffer);
  }
  /** SHA-256 en hexadécimal (asynchrone : WebCrypto). */
  async function sha256(text) {
    const s = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : require('crypto').webcrypto.subtle;
    return hexOf(await s.digest('SHA-256', new TextEncoder().encode(text)));
  }
  async function hmac(key, msg) {
    const s = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : require('crypto').webcrypto.subtle;
    const k = await s.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hexOf(await s.sign('HMAC', k, new TextEncoder().encode(msg)));
  }
  /** Résultat vérifiable d'une manche. */
  async function crashFromSeeds(serverSeed, clientSeed, nonce, rtp) {
    return crashFromFloat(floatFromHex(await hmac(serverSeed, clientSeed + ':' + nonce)), rtp);
  }
  /** Versions synchrones pour le serveur (Node). */
  function crashFromSeedsSync(serverSeed, clientSeed, nonce, rtp) {
    const h = require('crypto').createHmac('sha256', serverSeed).update(clientSeed + ':' + nonce).digest('hex');
    return crashFromFloat(floatFromHex(h), rtp);
  }
  const sha256Sync = (t) => require('crypto').createHash('sha256').update(t).digest('hex');

  /**
   * Règlement d'une mise : retrait à c (multiplicateur au centième) accepté seulement si c ≤ crash
   * et si la fusée a décollé (crash > 1). Gain plafonné à MAX_WIN.
   */
  function settle(bet, cashAt, crash) {
    if (!(crash > 1) || !(cashAt >= 1) || cashAt > crash) return { won: false, payout: 0, net: -bet };
    const payout = Math.min(CONFIG.MAX_WIN, Math.round(bet * cashAt * 100) / 100);
    return { won: true, payout, net: Math.round((payout - bet) * 100) / 100 };
  }
  /** Multiplicateur où le gain maximal est atteint (retrait automatique). */
  const maxWinMult = (bet) => floor2(CONFIG.MAX_WIN / bet);

  /** Simulation : RTP mesuré pour une stratégie « retirer à target ». */
  function simulate(n, target, rng) {
    rng = rng || secureFloat;
    let staked = 0, back = 0, instant = 0;
    for (let i = 0; i < n; i++) {
      const c = crashFromFloat(rng());
      if (c === 1) instant++;
      staked += 1;
      back += settle(1, target, c).payout;
    }
    return { rtp: back / staked, instant: instant / n };
  }

  const api = {
    CONFIG, crashFromFloat, floatFromHex, secureFloat, multiplierAt, exactAt, timeFor, probReach, tier,
    randomSeed, sha256, hmac, crashFromSeeds, crashFromSeedsSync, sha256Sync, settle, maxWinMult, simulate, floor2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrashEngine = api;
})(typeof window !== 'undefined' ? window : this);
