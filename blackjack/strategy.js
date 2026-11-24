/*
 * Stratégie de base du blackjack
 * Règles : 6 jeux, le croupier reste sur 17 souple (S17),
 * double sur deux cartes quelconques, double après split autorisé (DAS).
 */
(function (root) {
  'use strict';

  const ACTION_LABELS = { H: 'Tirer', S: 'Rester', D: 'Doubler', P: 'Séparer' };

  function cardValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    return parseInt(rank, 10);
  }

  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      total += cardValue(c.rank);
      if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return { total, soft: aces > 0 };
  }

  function upLabel(up) {
    return up === 11 ? 'As' : String(up);
  }

  // --- Tables (valeur du croupier : 2..11, 11 = As) ---

  function hardAction(total, up) {
    if (total <= 8) return 'H';
    if (total === 9) return up >= 3 && up <= 6 ? 'D' : 'H';
    if (total === 10) return up <= 9 ? 'D' : 'H';
    if (total === 11) return up <= 10 ? 'D' : 'H';
    if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
    if (total <= 16) return up <= 6 ? 'S' : 'H';
    return 'S';
  }

  // "Ds" = doubler si possible, sinon rester
  function softAction(total, up) {
    if (total <= 12) return 'H';
    if (total <= 14) return up >= 5 && up <= 6 ? 'D' : 'H';
    if (total <= 16) return up >= 4 && up <= 6 ? 'D' : 'H';
    if (total === 17) return up >= 3 && up <= 6 ? 'D' : 'H';
    if (total === 18) {
      if (up >= 3 && up <= 6) return 'Ds';
      if (up === 2 || up === 7 || up === 8) return 'S';
      return 'H';
    }
    return 'S';
  }

  // Renvoie true si la paire doit être séparée (valeur d'une carte : 2..11)
  function pairSplit(v, up) {
    switch (v) {
      case 11: return true;
      case 10: return false;
      case 9: return (up >= 2 && up <= 6) || up === 8 || up === 9;
      case 8: return true;
      case 7: return up <= 7;
      case 6: return up <= 6;
      case 5: return false;
      case 4: return up === 5 || up === 6;
      case 3:
      case 2: return up <= 7;
      default: return false;
    }
  }

  // --- Explications pédagogiques ---

  function reasonFor(category, total, up, action, pairVal) {
    const weak = up >= 2 && up <= 6;
    const u = upLabel(up);
    if (category === 'pair') {
      const name = pairVal === 11 ? 'As' : String(pairVal);
      if (action === 'P') {
        if (pairVal === 11) return 'Sépare toujours les As : chaque As devient le début d\'une main à 21 potentiel, alors que 12 souple est une main médiocre.';
        if (pairVal === 8) return 'Sépare toujours les 8 : 16 est la pire main du jeu, deux mains commençant par 8 sont bien meilleures.';
        if (pairVal === 9) return 'Avec une paire de 9 contre ' + u + ', séparer rapporte plus que rester sur 18.';
        return 'Paire de ' + name + ' contre ' + u + ' : le croupier est vulnérable, séparer permet de miser davantage dans une situation favorable.';
      }
      if (pairVal === 10) return 'Ne sépare jamais les 10 : 20 est une excellente main, la casser coûte de l\'argent.';
      if (pairVal === 5) return 'Ne sépare jamais les 5 : joue-les comme un 10 dur (souvent un double).';
      if (pairVal === 9) return 'Paire de 9 contre ' + u + ' : ton 18 suffit (contre un 7, le croupier fait souvent 17), ou il est trop fort pour séparer.';
      return 'Paire de ' + name + ' contre ' + u + ' : séparer n\'est pas rentable ici, joue-la comme un ' + total + ' dur (' + ACTION_LABELS[action].toLowerCase() + ').';
    }
    if (category === 'soft') {
      if (action === 'D') return 'Main souple ' + total + ' contre ' + u + ' : tu ne peux pas sauter en tirant une carte, et le croupier est faible : double !';
      if (action === 'S') return total >= 19
        ? 'Souple ' + total + ' est une main forte : reste.'
        : 'Souple 18 contre ' + u + ' : 18 est suffisant ici, reste.';
      if (total === 18) return 'Souple 18 contre ' + u + ' : le croupier fait souvent 19-20, tire pour t\'améliorer (tu ne peux pas sauter).';
      return 'Main souple ' + total + ' : l\'As te protège, tire sans risque de sauter pour améliorer ta main.';
    }
    // hard
    if (total <= 8) return 'Avec ' + total + ' ou moins, aucune carte ne peut te faire sauter : tire toujours.';
    if (total >= 17) return 'Dur ' + total + ' : le risque de sauter est trop élevé, reste toujours.';
    if (action === 'D') return 'Dur ' + total + ' contre ' + u + ' : bonne chance de tirer une figure, double pour maximiser le gain.';
    if (total <= 11) return 'Dur ' + total + ' contre ' + u + ' : le croupier est trop fort pour doubler, mais tu ne peux pas sauter : tire.';
    if (action === 'S') return 'Dur ' + total + ' contre ' + u + ' : le croupier montre une carte faible et va souvent sauter. Laisse-lui prendre le risque, reste.';
    if (weak) return 'Dur 12 contre ' + u + ' : seules les figures te font sauter, et un 2 ou 3 du croupier n\'est pas assez faible : tire.';
    return 'Dur ' + total + ' contre ' + u + ' : le croupier a probablement 17 ou plus. Rester perd trop souvent, tire malgré le risque.';
  }

  // Écarts liés au comptage (« Illustrious 18 », 6 jeux, S17).
  // Au-delà du seuil de compte vrai, l'action change par rapport à la stratégie de base.
  const DEVIATIONS = [
    { pair: 10, up: 5, idx: 5, act: 'P' },
    { pair: 10, up: 6, idx: 4, act: 'P' },
    { hard: 16, up: 10, idx: 0, act: 'S' },
    { hard: 15, up: 10, idx: 4, act: 'S' },
    { hard: 16, up: 9, idx: 5, act: 'S' },
    { hard: 10, up: 10, idx: 4, act: 'D' },
    { hard: 10, up: 11, idx: 4, act: 'D' },
    { hard: 11, up: 11, idx: 1, act: 'D' },
    { hard: 9, up: 2, idx: 1, act: 'D' },
    { hard: 9, up: 7, idx: 3, act: 'D' },
    { hard: 12, up: 3, idx: 2, act: 'S' },
    { hard: 12, up: 2, idx: 3, act: 'S' },
    { hard: 12, up: 4, idx: 0, act: 'H', below: true },
    { hard: 12, up: 5, idx: -2, act: 'H', below: true, incl: true },
    { hard: 12, up: 6, idx: -1, act: 'H', below: true, incl: true },
    { hard: 13, up: 2, idx: -1, act: 'H', below: true, incl: true },
    { hard: 13, up: 3, idx: -2, act: 'H', below: true, incl: true },
  ];
  const signedIdx = (n) => (n > 0 ? '+' + n : String(n));

  function deviationFor(category, total, pairVal, up, action, opts) {
    const tc = opts.trueCount;
    if (typeof tc !== 'number') return null;
    for (const d of DEVIATIONS) {
      if (d.up !== up) continue;
      if (d.pair != null) { if (category !== 'pair' || pairVal !== d.pair || !opts.canSplit) continue; }
      else if (category === 'soft' || action === 'P' || d.hard !== total) continue;
      const hit = d.below ? (d.incl ? tc <= d.idx : tc < d.idx) : tc >= d.idx;
      if (!hit || d.act === action) continue;
      if (d.act === 'D' && !opts.canDouble) continue;
      return d;
    }
    return null;
  }

  function deviationReason(d, tc, base) {
    const t = 'Compte vrai ' + signedIdx(Math.round(tc * 10) / 10) + ' (seuil ' + (d.below ? (d.incl ? '≤ ' : '< ') : '≥ ') + signedIdx(d.idx) + ') : ';
    const why = {
      S: 'il reste beaucoup de 10 et d\'As. Tirer te ferait sauter plus souvent, et le croupier risque davantage de sauter : reste, alors que la stratégie de base dit « ' + ACTION_LABELS[base] + ' ».',
      D: 'il reste beaucoup de 10 et d\'As, ta carte unique a plus de chances d\'être forte : double, alors que la stratégie de base dit « ' + ACTION_LABELS[base] + ' ».',
      H: 'il reste surtout des petites cartes. Tu risques moins de sauter et le croupier saute moins souvent : tire, alors que la stratégie de base dit « ' + ACTION_LABELS[base] + ' ».',
      P: 'le croupier va très souvent sauter, séparer les 10 rapporte plus que garder 20. (Au casino, ce coup trahit un compteur !)',
    };
    return t + why[d.act];
  }

  /**
   * Recommande l'action optimale.
   * @param cards  cartes de la main du joueur
   * @param upRank rang de la carte visible du croupier
   * @param opts   { canDouble, canSplit, trueCount? } — avec trueCount, applique les écarts liés au comptage
   */
  function recommend(cards, upRank, opts) {
    opts = opts || {};
    const up = cardValue(upRank);
    const hv = handValue(cards);
    const isPair = cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);

    let category, action, key, pairVal = null;

    if (isPair && opts.canSplit && pairSplit(cardValue(cards[0].rank), up)) {
      pairVal = cardValue(cards[0].rank);
      category = 'pair';
      action = 'P';
    } else if (isPair && opts.canSplit) {
      // paire qu'on ne sépare pas : on la classe en "paire" pour le suivi
      pairVal = cardValue(cards[0].rank);
      category = 'pair';
      action = hv.soft ? softAction(hv.total, up) : hardAction(hv.total, up);
    } else if (hv.soft) {
      category = 'soft';
      action = softAction(hv.total, up);
    } else {
      category = 'hard';
      action = hardAction(hv.total, up);
    }

    if (action === 'Ds') action = opts.canDouble ? 'D' : 'S';
    if (action === 'D' && !opts.canDouble) action = 'H';

    let deviation = null, reason;
    const dev = deviationFor(category, hv.total, pairVal, up, action, opts);
    if (dev) {
      deviation = { base: action, index: dev.idx };
      reason = deviationReason(dev, opts.trueCount, action);
      action = dev.act;
    } else {
      reason = reasonFor(category, hv.total, up, action, pairVal);
    }

    if (category === 'pair') {
      key = 'Paire de ' + (pairVal === 11 ? 'As' : pairVal) + ' vs ' + upLabel(up);
    } else {
      key = (category === 'soft' ? 'Souple ' : 'Dur ') + hv.total + ' vs ' + upLabel(up);
    }

    return {
      action,
      label: ACTION_LABELS[action],
      category,
      key,
      total: hv.total,
      reason,
      deviation,
    };
  }

  // Probabilité que le croupier saute selon sa carte visible (6 jeux, reste sur 17 souple)
  const DEALER_BUST = { 2: 35, 3: 37, 4: 40, 5: 42, 6: 42, 7: 26, 8: 24, 9: 23, 10: 23, 11: 17 };

  // Chance de sauter si on tire une carte sur un total dur
  function bustChance(total) {
    if (total <= 11) return 0;
    let bust = 0;
    for (let v = 1; v <= 10; v++) {
      if (total + v > 21) bust += v === 10 ? 4 : 1;
    }
    return Math.round((bust / 13) * 100);
  }

  /**
   * Explications détaillées d'une recommandation (liste de paragraphes en texte brut).
   */
  function details(cards, upRank, opts) {
    const rec = recommend(cards, upRank, opts);
    const up = cardValue(upRank);
    const u = upLabel(up);
    const out = [];
    const db = DEALER_BUST[up];
    out.push('Le croupier montre ' + u + ' : il saute dans environ ' + db + ' % des cas. ' +
      (up <= 6 ? 'C\'est une carte faible : avec une main moyenne, il doit souvent tirer et risque de sauter.'
        : 'C\'est une carte forte : il finit le plus souvent entre 17 et 21.'));

    const hv = handValue(cards);
    if (!hv.soft && hv.total >= 12 && hv.total <= 20) {
      out.push('Si tu tires avec ' + hv.total + ' dur, tu as environ ' + bustChance(hv.total) + ' % de risque de sauter.');
    } else if (hv.soft) {
      out.push('Ta main est « souple » : l\'As compte 11, mais il repasse à 1 si besoin. Tirer une carte ne peut donc pas te faire sauter.');
    } else if (hv.total <= 11) {
      out.push('Avec ' + hv.total + ', aucune carte ne peut te faire sauter : la seule question est de tirer ou de doubler.');
    }

    if (rec.action === 'D') {
      out.push('Pourquoi doubler ? Tu mises deux fois plus dans une situation où tu as l\'avantage. Tu ne reçois qu\'une carte, mais c\'est rentable sur le long terme.');
    } else if (rec.action === 'S' && hv.total >= 12 && hv.total <= 16) {
      out.push('Pourquoi rester avec une main faible ? Contre une carte faible, ta main perd souvent, mais tirer perd encore plus souvent. Tu laisses le croupier prendre le risque de sauter.');
    } else if (rec.action === 'H' && hv.total >= 12 && hv.total <= 16) {
      out.push('Pourquoi tirer malgré le risque ? Contre une carte forte, rester avec ' + hv.total + ' perd environ 3 fois sur 4. Tirer donne une chance de faire 17-21, même si tu sautes parfois.');
    } else if (rec.action === 'P') {
      out.push('Pourquoi séparer ? Tu transformes une mauvaise main (ou une main moyenne) en deux mains qui démarrent mieux, en misant plus quand la situation est favorable.');
    }

    if (rec.deviation) {
      out.push('Écart de comptage : la stratégie de base dit « ' + ACTION_LABELS[rec.deviation.base] + ' », mais avec ce compte vrai l\'action la plus rentable devient « ' + rec.label + ' ». Ces écarts (les « Illustrious 18 ») ne valent que si ton compte est juste.');
    }
    const mnemo = {
      hard: 'Astuce : 12 à 16 → reste contre 2-6 (sauf 12 contre 2 et 3), tire contre 7-As. 17 ou plus → reste toujours.',
      soft: 'Astuce : souple 19 et 20 → reste. Souple 18 → double contre 3-6, reste contre 2, 7, 8, tire contre 9, 10, As. En dessous, double contre les cartes faibles, sinon tire.',
      pair: 'Astuce : toujours séparer As et 8, jamais 10 et 5. Les petites paires (2, 3, 6, 7) se séparent contre les cartes faibles.',
    };
    out.push(mnemo[rec.category]);
    return { rec, paragraphs: out };
  }

  // Grille complète pour l'affichage du tableau
  function chart() {
    const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const hard = [];
    for (let t = 8; t <= 17; t++) {
      hard.push({ label: t === 8 ? '≤8' : t === 17 ? '17+' : String(t), key: 'hard-' + t, cells: ups.map(u => hardAction(t, u)) });
    }
    const soft = [];
    for (let t = 13; t <= 20; t++) {
      soft.push({ label: 'A,' + (t - 11), key: 'soft-' + t, cells: ups.map(u => softAction(t, u)) });
    }
    const pairs = [];
    for (const v of [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
      const n = v === 11 ? 'A' : String(v);
      pairs.push({
        label: n + ',' + n, key: 'pair-' + v,
        cells: ups.map(u => pairSplit(v, u) ? 'P' : (v === 11 ? 'P' : hardAction(v * 2, u))),
      });
    }
    return { ups, hard, soft, pairs };
  }

  const api = { DEVIATIONS, recommend, details, handValue, cardValue, chart, ACTION_LABELS, hardAction, softAction, pairSplit, DEALER_BUST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Strategy = api;
})(typeof window !== 'undefined' ? window : this);
