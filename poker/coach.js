/*
 * Analyse d'une situation de poker : utilisée par le coach (conseils au joueur)
 * et par les bots (avec des réglages de style).
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode ? require('./eval.js') : root.PokerEval;
  const P = isNode ? require('./engine.js') : root.PokerEngine;
  const pct = (x) => Math.round(x * 100) + ' %';

  // ---------- Avant le flop ----------
  // Formule de Chen : une note de force des deux cartes de départ
  function chen(cards) {
    const [a, b] = cards.map((c) => E.val(c.rank)).sort((x, y) => y - x);
    const pts = (v) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
    let s = pts(a);
    if (a === b) s = Math.max(5, s * 2);
    if (cards[0].suit === cards[1].suit) s += 2;
    const gap = a - b - 1;
    if (a !== b) {
      s -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && a < 12) s += 1;
    }
    return Math.ceil(s);
  }

  function handLabel(cards) {
    const sorted = cards.slice().sort((x, y) => E.val(y.rank) - E.val(x.rank));
    const r = (c) => (c.rank === '10' ? 'T' : c.rank);
    if (sorted[0].rank === sorted[1].rank) return r(sorted[0]) + r(sorted[1]);
    return r(sorted[0]) + r(sorted[1]) + (sorted[0].suit === sorted[1].suit ? 's' : 'o');
  }

  function preflopClass(score) {
    if (score >= 12) return { name: 'premium', label: 'main premium' };
    if (score >= 9) return { name: 'strong', label: 'main forte' };
    if (score >= 7) return { name: 'playable', label: 'main jouable' };
    if (score >= 5) return { name: 'marginal', label: 'main marginale' };
    return { name: 'weak', label: 'main faible' };
  }

  // Position du joueur par rapport au bouton
  function position(st, i) {
    const active = [];
    for (let k = 1; k <= st.seats.length; k++) {
      const j = (st.button + k) % st.seats.length;
      if (!st.seats[j].out && st.seats[j].cards.length) active.push(j);
    }
    const n = active.length;
    if (i === st.button) return { key: 'btn', label: 'au bouton', late: true, n };
    if (i === st.sbSeat) return { key: 'sb', label: 'en petite blinde', late: false, n };
    if (i === st.bbSeat) return { key: 'bb', label: 'en grosse blinde', late: false, n };
    const idx = active.indexOf(i); // 0 = SB, 1 = BB, ... n-1 = bouton
    if (idx === n - 2) return { key: 'co', label: 'au cut-off (juste avant le bouton)', late: true, n };
    if (idx >= n - 3 && n >= 5) return { key: 'mp', label: 'en position intermédiaire', late: false, n };
    return { key: 'ep', label: 'en début de parole', late: false, n };
  }

  // ---------- Après le flop : tirages ----------
  function draws(hole, board) {
    const all = hole.concat(board);
    const out = [];
    if (board.length >= 5) return out;
    // Couleur
    for (const s of E.SUITS) {
      const n = all.filter((c) => c.suit === s).length;
      if (n === 4 && hole.some((c) => c.suit === s)) {
        const nut = hole.some((c) => c.suit === s && c.rank === 'A');
        out.push({ key: 'flush', name: nut ? 'tirage couleur max (à l\'As)' : 'tirage couleur', outs: 9 });
      }
    }
    // Suite : quelles valeurs compléteraient une suite utilisant au moins une de mes cartes ?
    const has = new Set(all.map((c) => E.val(c.rank)));
    if (has.has(14)) has.add(1);
    const holeV = new Set(hole.map((c) => E.val(c.rank)).concat(hole.some((c) => c.rank === 'A') ? [1] : []));
    const already = E.evaluate(all).cat >= 4;
    if (!already) {
      const completing = new Set();
      for (let v = 1; v <= 14; v++) {
        if (has.has(v)) continue;
        for (let lo = Math.max(1, v - 4); lo <= Math.min(10, v); lo++) {
          let ok = true, usesHole = false;
          for (let k = lo; k < lo + 5; k++) {
            if (k !== v && !has.has(k)) { ok = false; break; }
            if (holeV.has(k)) usesHole = true;
          }
          if (ok && usesHole) completing.add(v === 1 ? 14 : v);
        }
      }
      if (completing.size >= 2) out.push({ key: 'oesd', name: 'tirage suite par les deux bouts', outs: 8 });
      else if (completing.size === 1) out.push({ key: 'gutshot', name: 'tirage suite ventral', outs: 4 });
    }
    // Deux cartes supérieures au tableau
    const made = E.evaluate(all);
    const maxBoard = Math.max(...board.map((c) => E.val(c.rank)));
    if (made.cat === 0 && hole.every((c) => E.val(c.rank) > maxBoard)) out.push({ key: 'overs', name: 'deux cartes hautes', outs: 6 });
    return out;
  }

  // Description de la main faite, avec « paire supérieure », « overpair »…
  function madeHand(hole, board) {
    const e = E.evaluate(hole.concat(board));
    let note = '';
    const bv = board.map((c) => E.val(c.rank)).sort((a, b) => b - a);
    const hv = hole.map((c) => E.val(c.rank));
    if (e.cat === 1) {
      const p = e.values[0];
      if (hv[0] === hv[1] && p > bv[0]) note = 'paire servie supérieure au tableau (overpair)';
      else if (p === bv[0] && hv.includes(p)) note = 'paire supérieure (top pair)';
      else if (hv.includes(p)) note = 'paire moyenne ou faible';
      else note = 'la paire est sur le tableau : elle est partagée';
    } else if (e.cat >= 2) {
      // la main utilise-t-elle mes cartes ?
      const boardOnly = board.length === 5 ? E.evaluate(board).score : -1;
      if (boardOnly === e.score) note = 'ta main est entièrement sur le tableau (partagée)';
    }
    return { eval: e, note };
  }

  /**
   * Analyse complète pour le joueur i.
   * opts : { iters, style: { looseness, aggression } } (style pour les bots)
   */
  function analyze(st, i, opts) {
    opts = opts || {};
    const s = st.seats[i];
    const L = P.legal(st, i);
    const pot = L.pot;
    const opponents = st.seats.filter((o, j) => j !== i && P.inHand(o)).length;
    const res = { street: st.street, toCall: L.toCall, pot, opponents, legal: L, bb: st.bb };
    res.potOdds = L.toCall > 0 ? L.toCall / (pot + L.toCall) : 0;
    const shift = (opts.style && opts.style.looseness) || 0;

    if (st.street === 'preflop') {
      const score = chen(s.cards);
      const cls = preflopClass(score);
      const pos = position(st, i);
      res.chen = score; res.cls = cls; res.pos = pos; res.label = handLabel(s.cards);
      res.equity = E.equity(s.cards, [], Math.max(1, opponents), opts.iters || 400);
      const raised = st.currentBet > st.bb;
      const bbs = st.currentBet / st.bb;
      // Seuils d'ouverture selon la position, plus larges à peu de joueurs
      const base = { ep: 9, mp: 8, co: 7, btn: 6, sb: 7, bb: 8 }[pos.key];
      const openAt = base - Math.max(0, 6 - pos.n) * 0.6 - shift;
      const pair = s.cards[0].rank === s.cards[1].rank;
      const stackBB = (s.stack + s.bet) / st.bb;
      if (!raised) {
        if (pos.key === 'bb' && L.canCheck) {
          res.rec = score >= openAt + 1 ? raiseRec(st, i, Math.max(3, 3 + countLimpers(st)) * st.bb, 'Avec une ' + cls.label + ' en grosse blinde, relance pour faire payer les joueurs qui ont juste suivi.')
            : { type: 'check', reason: 'En grosse blinde, personne n\'a relancé : tu vois le flop gratuitement. Parole.' };
        } else if (score >= openAt) {
          const to = (2.5 + countLimpers(st)) * st.bb;
          res.rec = raiseRec(st, i, to, cap(res.label) + ' est une ' + cls.label + ' ' + pos.label + ' : ouvre en relançant à environ ' + (to / st.bb) + ' grosses blindes. Entrer en relançant (plutôt qu\'en suivant) te donne l\'initiative.');
        } else if (pos.key === 'sb' && score >= openAt - 2 && L.toCall <= st.sb) {
          res.rec = { type: 'call', reason: 'En petite blinde, compléter coûte peu : avec une main moyenne tu peux voir le flop.' };
        } else {
          res.rec = { type: L.canCheck ? 'check' : 'fold', reason: cap(res.label) + ' est une ' + cls.label + ' ' + pos.label + '. Les joueurs qui parlent après toi peuvent avoir mieux : couche-toi et attends une meilleure occasion.' };
        }
      } else {
        const premium = score >= 11 || res.label === 'AKs' || res.label === 'AKo';
        if (premium) {
          res.rec = raiseRec(st, i, st.currentBet * 3, cap(res.label) + ' fait partie des toutes meilleures mains : sur relance, sur-relance (3-bet) à environ 3 fois la mise.');
        } else if ((score >= 8 - shift && bbs <= stackBB * 0.15) || (pair && L.toCall <= s.stack * 0.06)) {
          res.rec = { type: 'call', reason: pair && score < 8
            ? 'Petite paire face à une relance : suis seulement si c\'est bon marché (moins de 6 % de ton tapis), pour espérer toucher un brelan au flop (1 chance sur 8,5).'
            : cap(res.label) + ' est assez solide pour suivre la relance, mais pas pour sur-relancer.' };
        } else {
          res.rec = { type: 'fold', reason: 'Face à une relance, ' + res.label + ' (' + cls.label + ') ne suffit pas : le relanceur a souvent mieux. Couche-toi.' };
        }
      }
      res.threshold = null;
      return finish(res, st, i);
    }

    // ----- Après le flop -----
    res.made = madeHand(s.cards, st.board);
    res.draws = draws(s.cards, st.board);
    res.outs = Math.min(15, res.draws.reduce((a, d) => a + d.outs, 0));
    // Après le flop, les adversaires encore là n'ont pas n'importe quoi : on écarte les mains très faibles
    const playable = (cards) => chen(cards) >= 4;
    res.equity = E.equity(s.cards, st.board, Math.max(1, opponents), opts.iters || 600, playable);
    const eq = res.equity;
    const halfPot = Math.max(st.bb, Math.round(pot * 0.5));
    const twoThirds = Math.max(st.bb, Math.round(pot * 0.66));
    if (L.toCall === 0) {
      if (eq >= 0.65 - shift * 0.03) res.rec = betRec(st, i, twoThirds, 'Ton équité est de ' + pct(eq) + ' : tu es probablement devant. Mise environ 2/3 du pot pour te faire payer par des mains moins fortes (mise de valeur).');
      else if (eq >= 0.5 && opponents <= 1) res.rec = betRec(st, i, halfPot, 'Face à un seul adversaire avec ' + pct(eq) + ' d\'équité, une mise d\'une demi-pot protège ta main et gagne souvent le pot tout de suite.');
      else if (res.outs >= 8 && st.street !== 'river') res.rec = betRec(st, i, halfPot, 'Avec ' + res.outs + ' outs (' + res.draws.map((d) => d.name).join(', ') + '), une mise de semi-bluff est possible : tu peux gagner tout de suite, et sinon tu as encore des chances de toucher. Parler est aussi correct.', true);
      else res.rec = { type: 'check', reason: 'Équité de ' + pct(eq) + ' : pas assez pour miser. Parle (check) et vois la suite gratuitement.' };
    } else {
      res.threshold = res.potOdds;
      if (eq >= 0.72 - shift * 0.03 && L.canRaise) {
        res.rec = raiseRec(st, i, st.currentBet * 2.5 + Math.round(pot * 0.25), 'Ton équité (' + pct(eq) + ') est très élevée : relance pour faire grossir le pot pendant que tu es devant.');
      } else if (eq >= res.potOdds) {
        res.rec = { type: 'call', reason: 'Tu dois payer ' + L.toCall + ' pour un pot de ' + (pot + L.toCall) + ' : il te faut au moins ' + pct(res.potOdds) + ' de chances de gagner. Tu en as environ ' + pct(eq) + ' : suivre est rentable.' };
      } else if (res.outs >= 8 && st.street === 'flop' && eq >= res.potOdds - 0.07) {
        res.rec = { type: 'call', reason: 'Juste un peu court en cotes (' + pct(eq) + ' contre ' + pct(res.potOdds) + ' nécessaires), mais ton tirage peut rapporter gros si tu touches (cotes implicites) : suivre se défend.', borderline: true };
      } else {
        res.rec = { type: 'fold', reason: 'Il te faut ' + pct(res.potOdds) + ' de chances de gagner pour suivre, et tu n\'en as qu\'environ ' + pct(eq) + '. Suivre perd de l\'argent sur le long terme : couche-toi.' };
      }
    }
    return finish(res, st, i);
  }

  function countLimpers(st) {
    return st.seats.filter((s, j) => j !== st.bbSeat && j !== st.sbSeat && s.bet === st.bb && s.acted).length;
  }
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function clampTo(st, i, to) {
    const L = P.legal(st, i);
    return Math.max(L.minTo, Math.min(L.maxTo, Math.round(to / 5) * 5 || L.minTo));
  }
  function raiseRec(st, i, to, reason) {
    const L = P.legal(st, i);
    if (!L.canRaise) return { type: L.toCall ? 'call' : 'check', reason };
    return { type: 'raise', to: clampTo(st, i, to), reason };
  }
  function betRec(st, i, amount, reason, optional) {
    const L = P.legal(st, i);
    if (!L.canRaise) return { type: 'check', reason };
    return { type: 'raise', to: clampTo(st, i, amount), reason, optional: !!optional };
  }

  const KIND = { fold: 'fold', check: 'passive', call: 'passive', raise: 'aggressive', allin: 'aggressive' };
  const LABEL = { fold: 'Se coucher', check: 'Parler', call: 'Suivre', raise: 'Relancer', allin: 'Tapis' };

  function finish(res, st, i) {
    const L = res.legal;
    const r = res.rec;
    if (r.type === 'raise') r.label = (L.isBet ? 'Miser ' : 'Relancer à ') + r.to;
    else if (r.type === 'call') r.label = 'Suivre ' + L.toCall;
    else r.label = LABEL[r.type];
    r.kind = KIND[r.type];
    return res;
  }

  /** Juge l'action jouée par rapport à la recommandation : 'good' | 'ok' | 'bad'. */
  function judge(res, action) {
    const played = KIND[action.type === 'allin' ? 'allin' : action.type];
    const want = res.rec.kind;
    if (played === want) return 'good';
    if (res.rec.optional && played === 'passive') return 'good';
    if (res.rec.borderline) return 'ok';
    if (want === 'fold' && played === 'passive' && res.toCall === 0) return 'good';
    // près du seuil : écart de moins de 5 points d'équité
    if (res.threshold != null && Math.abs(res.equity - res.threshold) < 0.05 && played !== 'aggressive') return 'ok';
    if (want === 'aggressive' && played === 'passive') return 'ok';
    return 'bad';
  }

  // Type d'erreur, pour les conseils personnalisés
  function mistake(res, action) {
    const played = KIND[action.type];
    const want = res.rec.kind;
    if (res.street === 'preflop') {
      if (want === 'fold' && played !== 'fold') return 'looseOpen';
      if (want !== 'fold' && played === 'fold') return 'tightFold';
      if (want === 'aggressive' && played === 'passive') return 'limp';
      return 'other';
    }
    if (want === 'fold' && played === 'passive') return 'callNoOdds';
    if (want === 'fold' && played === 'aggressive') return 'badBluff';
    if (want !== 'fold' && played === 'fold') return 'foldWithOdds';
    if (want === 'aggressive' && played === 'passive') return 'missedValue';
    if (want === 'passive' && played === 'aggressive') return 'overBet';
    return 'other';
  }

  /** Paragraphes détaillés pour le bouton « Plus de détails ». */
  function details(res) {
    const out = [];
    if (res.street === 'preflop') {
      out.push('Ta main : ' + res.label + ' (note de Chen ' + res.chen + '/20, ' + res.cls.label + '). Tu es ' + res.pos.label + ' à une table de ' + res.pos.n + ' joueurs.');
      out.push('Contre ' + res.opponents + ' adversaire' + (res.opponents > 1 ? 's' : '') + ' avec des mains au hasard, elle gagne environ ' + pct(res.equity) + ' du temps (les vrais adversaires qui restent ont en général de meilleures mains que le hasard).');
      out.push('La position compte : plus tu parles tard, plus tu as d\'informations sur les autres, donc tu peux jouer plus de mains au bouton qu\'en début de parole.');
      out.push('Repère simple : en début de parole, joue les paires moyennes et hautes, AK, AQ, AJ assortis, KQ assortis. Au bouton, tu peux ouvrir beaucoup plus large.');
    } else {
      out.push('Ta main : ' + res.made.eval.name + (res.made.note ? ' — ' + res.made.note : '') + '.');
      if (res.draws.length) {
        out.push('Tirages : ' + res.draws.map((d) => d.name + ' (' + d.outs + ' outs)').join(', ') + '. ' +
          (res.street === 'flop' ? 'Règle du 4 : ' + res.outs + ' outs × 4 ≈ ' + Math.min(100, res.outs * 4) + ' % de toucher d\'ici la river.'
            : res.street === 'turn' ? 'Règle du 2 : ' + res.outs + ' outs × 2 ≈ ' + res.outs * 2 + ' % de toucher à la river.' : ''));
      } else if (res.street !== 'river') out.push('Aucun tirage particulier.');
      out.push('Équité estimée : ' + pct(res.equity) + ' (simulation contre ' + res.opponents + ' adversaire' + (res.opponents > 1 ? 's' : '') + ', en écartant les mains de départ trop faibles qu\'ils auraient jetées).');
      if (res.toCall > 0) {
        out.push('Cotes du pot : tu paies ' + res.toCall + ' pour gagner ' + (res.pot + res.toCall) + ', soit ' + res.toCall + ' / ' + (res.pot + res.toCall) + ' = ' + pct(res.potOdds) + '. Si ton équité dépasse ce chiffre, suivre est rentable sur le long terme.');
      } else {
        out.push('Personne n\'a misé : tu peux parler gratuitement ou miser. On mise pour la valeur (être payé par pire) ou en semi-bluff (faire coucher mieux, avec un tirage en secours).');
      }
    }
    return out;
  }

  const api = { analyze, judge, mistake, details, chen, handLabel, preflopClass, position, draws, KIND, LABEL };
  if (isNode) module.exports = api;
  else root.PokerCoach = api;
})(typeof window !== 'undefined' ? window : this);
