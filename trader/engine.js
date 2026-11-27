/*
 * Bourse Flash — mathématiques du marché et des positions (partagées par l'app et les tests).
 *
 * Le cours : une marche aléatoire multiplicative « juste » (son espérance ne monte ni ne descend) :
 *   à chaque pas de DT secondes, prix × exp(σ·√DT·Z − σ²·DT/2), Z gaussienne ;
 *   + de temps en temps un saut (krach ou envolée) de même taille dans les deux sens, à espérance nulle ;
 *   + des phases calmes et agitées (la volatilité change de temps en temps).
 * Le marché ne regarde JAMAIS tes positions : il est tiré au hasard (générateur cryptographique), point.
 *
 * Une position : mise M, levier L, sens +1 (achat : tu gagnes si ça monte) ou −1 (vente : tu gagnes si ça baisse).
 *   valeur = M × (1 + sens × L × (prix / prix d'entrée − 1)) − frais
 *   frais = FEE × M × L (payés à l'ouverture) ;
 *   liquidation : si la valeur tombe sous LIQ × M, la position est fermée et la mise est perdue.
 * Avantage du casino ≈ les frais + la liquidation (on perd tout un peu avant zéro). Vérifié par simulation :
 * selon le levier et la durée, les stratégies simples rendent entre 92 et 99,7 % des mises (levier max. par action : ×20, ×10, ×3).
 */
(function (root) {
  'use strict';
  const CONFIG = {
    DT: 0.25,          // secondes par pas de cours
    BURST: 8,          // un krach / une envolée dure 8 pas (2 s), cotation suspendue pendant ce temps
    FEE: 0.003,        // frais : 0,3 % de la somme engagée (mise × levier)
    LIQ: 0.15,         // liquidation quand il ne reste que 15 % de la mise
    LEVERS: [1, 2, 3, 5, 10, 20],
    MIN_BET: 1, MAX_BET: 1e9, MAX_WIN: 1e12, MAX_POS: 5,
  };
  // Les trois actions (fictives) : volatilité par √seconde, fréquence et taille des sauts
  const ASSETS = [
    { id: 'neon', name: 'Néon Corp', short: 'NÉON', icon: '💡', maxLev: 20, start: 120, sigma: 0.0016, jumpRate: 1 / 150, jump: 0.03, desc: 'Grosse entreprise solide : ça bouge doucement.' },
    { id: 'orbit', name: 'Orbit Motors', short: 'ORBT', icon: '🛰️', maxLev: 10, start: 48, sigma: 0.0035, jumpRate: 1 / 75, jump: 0.06, desc: 'Start-up spatiale : des hauts et des bas.' },
    { id: 'moon', name: 'MoonCoin', short: 'MOON', icon: '🌙', maxLev: 3, start: 3.2, sigma: 0.0075, jumpRate: 1 / 40, jump: 0.14, desc: 'Crypto-monnaie folle : krachs et envolées.' },
  ];
  const NEWS = {
    up: ['Rumeur de rachat géant chez {n} !', '{n} annonce des résultats record !', 'Un milliardaire achète massivement {n} !', 'Contrat historique signé par {n} !'],
    down: ['Scandale comptable chez {n} !', '{n} rate ses objectifs, panique en salle !', 'Le patron de {n} démissionne !', 'Enquête des autorités sur {n} !'],
  };

  // ---------- Hasard ----------
  const cryptoOf = () => ((typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('crypto').webcrypto);
  const buf = new Uint32Array(256); let bi = 256;
  function rnd() { if (bi >= 256) { cryptoOf().getRandomValues(buf); bi = 0; } return (buf[bi++] + 0.5) / 4294967296; }
  function gauss(r) { r = r || rnd; return Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r()); }

  /** Nouveau marché pour une action. */
  function market(asset) { return { id: asset.id, price: asset.start, open: asset.start, regime: 1, regimeLeft: 60, t: 0 }; }

  /**
   * Un pas de cours. Renvoie { price, jump } (jump : null, 'up' ou 'down').
   * Toutes les composantes ont une espérance multiplicative de 1 : le cours est un « jeu équitable ».
   */
  function step(m, asset, r) {
    r = r || rnd;
    const dt = CONFIG.DT;
    // phases calmes / agitées (de ×0,6 à ×1,8 la volatilité)
    m.regimeLeft -= dt;
    if (m.regimeLeft <= 0) { const x = r(); m.regime = x < 0.45 ? 0.6 : x < 0.85 ? 1 : 1.8; m.regimeLeft = 15 + r() * 45; }
    const s = asset.sigma * m.regime;
    let f = Math.exp(s * Math.sqrt(dt) * gauss(r) - s * s * dt / 2);
    let jump = null;
    // krach / envolée : le saut se fait en BURST pas (1 s) ; pendant ce temps la cotation est suspendue
    // (impossible d'ouvrir ou de fermer une position sur cette action), mais les liquidations jouent à chaque pas.
    if (m.burst) {
      f *= m.burst.f;
      if (--m.burst.left <= 0) m.burst = null;
    } else if (r() < asset.jumpRate * dt) {
      const size = asset.jump * (0.5 + r()); // taille du saut, symétrique en espérance
      const up = r() < 0.5, total = up ? 1 + size : 1 - Math.min(0.9, size);
      m.burst = { f: Math.pow(total, 1 / CONFIG.BURST), left: CONFIG.BURST - 1, dir: up ? 'up' : 'down' };
      f *= m.burst.f; jump = m.burst.dir;
    }
    m.price = Math.max(0.0001, m.price * f);
    // pour éviter des prix ridicules, le cours « se divise / se regroupe » sans rien changer aux positions
    m.t += dt;
    return { price: m.price, jump };
  }

  // ---------- Positions ----------
  const round2 = (x) => Math.round(x * 100) / 100;
  const feeOf = (bet, lev) => round2(bet * lev * CONFIG.FEE);
  /** Valeur d'une position au prix p (avant plafond). */
  function valueAt(pos, p) {
    return pos.bet * (1 + pos.dir * pos.lev * (p / pos.entry - 1)) - pos.fee;
  }
  /** Prix où la position serait liquidée. */
  function liqPrice(pos) {
    // valeur = LIQ × mise  ⇔  p = entry × (1 + ((LIQ·M + fee)/M − 1) / (dir·L))
    const k = ((CONFIG.LIQ * pos.bet + pos.fee) / pos.bet - 1) / (pos.dir * pos.lev);
    return pos.entry * (1 + k);
  }
  function open(bet, lev, dir, price) { return { bet, lev, dir, entry: price, fee: feeOf(bet, lev), liq: 0 }; }
  /** Règlement : ce que la position rend (0 si liquidée), plafonné à MAX_WIN de gain. */
  function payoutOf(pos, p) {
    const v = valueAt(pos, p);
    if (v <= CONFIG.LIQ * pos.bet) return 0;
    return round2(Math.min(pos.bet + CONFIG.MAX_WIN, v));
  }
  const halted = (m) => !!m.burst;
  const isLiquidated = (pos, p) => valueAt(pos, p) <= CONFIG.LIQ * pos.bet;

  /**
   * Simulation : stratégie « j'ouvre, je garde entre minS et maxS secondes (ou objectif / limite), je ferme ».
   * Renvoie le taux de retour (somme rendue / somme misée).
   */
  function simulate(n, opts) {
    opts = Object.assign({ asset: 1, lev: 10, minS: 5, maxS: 90, tp: 0, sl: 0 }, opts || {});
    const asset = ASSETS[opts.asset];
    let staked = 0, back = 0, liq = 0;
    const m = market(asset);
    for (let i = 0; i < 400; i++) step(m, asset);
    for (let k = 0; k < n; k++) {
      while (halted(m)) step(m, asset);
      const pos = open(10, opts.lev, rnd() < 0.5 ? 1 : -1, m.price);
      const hold = opts.minS + rnd() * (opts.maxS - opts.minS);
      let out = null;
      for (let t = 0; t < hold; t += CONFIG.DT) {
        step(m, asset);
        if (isLiquidated(pos, m.price)) { out = 0; liq++; break; }
        if (halted(m)) continue; // cotation suspendue : ni fermeture, ni ordre automatique
        const v = valueAt(pos, m.price);
        if (opts.tp && v >= pos.bet * (1 + opts.tp)) { out = payoutOf(pos, m.price); break; }
        if (opts.sl && v <= pos.bet * (1 - opts.sl)) { out = payoutOf(pos, m.price); break; }
      }
      while (out === null && halted(m)) { step(m, asset); if (isLiquidated(pos, m.price)) { out = 0; liq++; } }
      if (out === null) out = payoutOf(pos, m.price);
      staked += pos.bet; back += out;
    }
    return { rtp: back / staked, liq: liq / n };
  }

  const api = { CONFIG, ASSETS, NEWS, rnd, gauss, market, step, feeOf, valueAt, liqPrice, open, payoutOf, isLiquidated, halted, simulate, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraderEngine = api;
})(typeof window !== 'undefined' ? window : this);
