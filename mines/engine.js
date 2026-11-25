/*
 * Mines — mathématiques du jeu (multiplicateurs, tirage vérifiable).
 *
 * Grille de 25 cases, m mines cachées. Après k cases sûres retournées, la chance d'en être arrivé là vaut
 *   P(k) = C(25 − m, k) / C(25, k) = Π (25 − m − i) / (25 − i), i = 0..k−1
 * et le multiplicateur proposé vaut RTP / P(k) (arrondi au centième inférieur).
 * Quelle que soit la stratégie (nombre de mines, moment où l'on encaisse), l'espérance vaut RTP × mise :
 * le casino garde 3 % en moyenne, comme Rocket Crash et Plinko.
 *
 * Tirage « Provably Fair » : les positions des mines viennent d'un mélange (Fisher-Yates) piloté par
 * HMAC-SHA256(server seed, « client seed:nonce:0 ») puis « …:1 » ; l'empreinte du server seed est publiée avant.
 */
(function (root) {
  'use strict';
  const CONFIG = { SIZE: 25, RTP: 0.97, MIN_BET: 1, MAX_BET: 500, MAX_WIN: 100000 };
  const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

  /** Chance de retourner k cases sûres d'affilée avec m mines. */
  function probSafe(m, k) {
    let p = 1;
    for (let i = 0; i < k; i++) p *= (CONFIG.SIZE - m - i) / (CONFIG.SIZE - i);
    return p;
  }
  /** Multiplicateur après k cases sûres. */
  const multAt = (m, k) => (k <= 0 ? 1 : floor2(CONFIG.RTP / probSafe(m, k)));
  /** Chance que la prochaine case soit sûre (k cases déjà retournées). */
  const nextSafe = (m, k) => (CONFIG.SIZE - m - k) / (CONFIG.SIZE - k);
  const maxReveals = (m) => CONFIG.SIZE - m;

  /** Positions des mines (0..24) à partir de 128 caractères hexadécimaux. */
  function minesFromHex(hex, m) {
    const cells = Array.from({ length: CONFIG.SIZE }, (_, i) => i);
    let k = 0;
    for (let i = CONFIG.SIZE - 1; i > 0; i--) {
      const r = parseInt(hex.substr(k * 4, 4), 16) / 65536; k++;
      const j = Math.floor(r * (i + 1));
      const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    return cells.slice(0, m).sort((a, b) => a - b);
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
  async function minesFromSeeds(serverSeed, clientSeed, nonce, m) {
    const base = clientSeed + ':' + nonce;
    return minesFromHex((await hmac(serverSeed, base + ':0')) + (await hmac(serverSeed, base + ':1')), m);
  }
  function settle(bet, m, k) {
    const mult = multAt(m, k);
    const payout = Math.min(bet + CONFIG.MAX_WIN, Math.round(bet * mult * 100) / 100);
    return { mult, payout, net: Math.round((payout - bet) * 100) / 100 };
  }

  /** Simulation : stratégie « retourner k cases au hasard puis encaisser ». */
  function simulate(n, m, k) {
    let back = 0;
    for (let t = 0; t < n; t++) {
      const a = new Uint8Array(64); cryptoOf().getRandomValues(a);
      const mines = new Set(minesFromHex(hexOf(a.buffer), m));
      const order = Array.from({ length: CONFIG.SIZE }, (_, i) => i).sort(() => Math.random() - 0.5);
      let ok = true;
      for (let i = 0; i < k; i++) if (mines.has(order[i])) { ok = false; break; }
      if (ok) back += settle(1, m, k).payout;
    }
    return back / n;
  }

  const api = { CONFIG, probSafe, multAt, nextSafe, maxReveals, minesFromHex, randomSeed, sha256, hmac, minesFromSeeds, settle, simulate, floor2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MinesEngine = api;
})(typeof window !== 'undefined' ? window : this);
