/*
 * Roulette : interface de la table (partagée avec le mode « Entre amis ») et partie solo.
 * Déroulé d'un tour : « Faites vos jeux » → compte à rebours (démarré par la première mise)
 * → « Rien ne va plus » → la bille tourne → annonce du numéro → paiement → tour suivant.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const B = RouletteBets;
  const BASE_CHIPS = [1, 5, 10, 25, 100, 500];
  let CHIPS = BASE_CHIPS.slice();
  // La Dette : les jetons grossissent avec les paliers (×2, ×5, ×10…)
  function scaleChips(real) {
    const f = real && window.Casino && Casino.betFactor ? Casino.betFactor() : 1;
    let m = 1; [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].forEach((x) => { if (x <= f) m = x; });
    CHIPS = BASE_CHIPS.map((v) => v * m);
    if (!CHIPS.includes(selected)) selected = CHIPS[1];
  }
  const chipBase = (v) => BASE_CHIPS[Math.max(0, CHIPS.indexOf(v))];
  const SPIN_MS = 9000;
  const RESULT_MS = 5500;
  const now = () => Date.now();
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR');

  // ======================= Interface de la table =======================
  let wheel = null;
  let selected = 5;
  let handlers = {};
  let vertical = null;
  let lastView = null;

  function buildTapis() {
    const wrap = $('tapis');
    const v = wrap.getBoundingClientRect().width < 560;
    if (v === vertical && wrap.children.length) return;
    vertical = v;
    wrap.classList.toggle('vertical', v);
    const sz = B.size(v);
    wrap.style.aspectRatio = sz.w + ' / ' + sz.h;
    wrap.innerHTML = '';
    B.spots.slice().sort((a, b) => a.z - b.z).forEach((s) => {
      const r = B.rectFor(s, v);
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset.key = s.key;
      el.style.left = (r.x / sz.w) * 100 + '%';
      el.style.top = (r.y / sz.h) * 100 + '%';
      el.style.width = (r.w / sz.w) * 100 + '%';
      el.style.height = (r.h / sz.h) * 100 + '%';
      el.setAttribute('aria-label', s.name);
      el.title = s.name + ' — paie ' + s.payout + ' contre 1';
      if (s.type === 'plein') {
        const n = s.numbers[0];
        el.className = 'spot plein ' + B.color(n);
        const span = document.createElement('span'); span.className = 'num'; span.textContent = n;
        el.appendChild(span);
      } else if (s.z > 0) {
        el.className = 'spot hot';
      } else {
        el.className = 'spot out ' + (s.key === 'red' ? 'red' : s.key === 'black' ? 'black' : '');
        if (s.key === 'red' || s.key === 'black') { const d = document.createElement('span'); d.className = 'diamond'; el.appendChild(d); }
        else el.textContent = s.type === 'colonne' ? '2 pour 1' : s.type === 'douzaine' ? ['1re 12', '2e 12', '3e 12'][+s.key[1] - 1] : { low: '1 à 18', high: '19 à 36', even: 'Pair', odd: 'Impair' }[s.key];
      }
      el.addEventListener('click', () => { if (handlers.bet) handlers.bet(s.key); });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (handlers.remove) handlers.remove(s.key); });
      wrap.appendChild(el);
    });
  }

  function centerOf(key) {
    const s = B.byKey[key];
    const r = B.rectFor(s, vertical);
    const sz = B.size(vertical);
    return { left: ((r.x + r.w / 2) / sz.w) * 100, top: ((r.y + r.h / 2) / sz.h) * 100 };
  }

  function chipClass(amount) {
    let c = CHIPS[0];
    CHIPS.forEach((v) => { if (amount >= v) c = v; });
    return 'c' + chipBase(c);
  }

  /**
   * view : { phase, deadline, betTime, bets, others:[{key, amount, color}], bankroll, history, result,
   *          players:[{name, color, bankroll, ready, me}], announce, sub, canBet, readyLabel, readyDisabled }
   */
  function render(view) {
    lastView = view;
    buildTapis();
    const tapis = $('tapis');
    tapis.classList.toggle('locked', !view.canBet);
    tapis.querySelectorAll('.chip-on, .dolly, .chip-pct').forEach((e) => e.remove());
    tapis.querySelectorAll('.spot.win').forEach((e) => e.classList.remove('win'));
    const showResult = view.phase === 'result' && view.result != null;
    // jetons des autres joueurs (petits jetons de couleur, décalés)
    (view.others || []).forEach((o, k) => {
      const c = centerOf(o.key);
      const el = document.createElement('div');
      el.className = 'chip-on other';
      el.style.background = o.color;
      el.style.left = 'calc(' + c.left + '% + ' + ((k % 3) * 7 - 7) + 'px)';
      el.style.top = 'calc(' + c.top + '% - 12px)';
      el.title = o.name + ' : ' + o.amount + ' €';
      tapis.appendChild(el);
    });
    Object.keys(view.bets || {}).forEach((key) => {
      const amt = view.bets[key];
      if (!amt) return;
      const c = centerOf(key);
      const el = document.createElement('div');
      el.className = 'chip-on ' + chipClass(amt);
      if (showResult) el.classList.add(B.payout(key, amt, view.result) > 0 ? 'won' : 'lost');
      el.style.left = c.left + '%';
      el.style.top = c.top + '%';
      el.textContent = amt >= 1000 ? Math.round(amt / 100) / 10 + 'k' : amt;
      tapis.appendChild(el);
      // Aides : chance de gagner de cette mise, au-dessus du jeton
      if (!document.body.classList.contains('no-coach') && !showResult) {
        const pc = document.createElement('div');
        pc.className = 'chip-pct';
        pc.style.left = c.left + '%';
        pc.style.top = c.top + '%';
        pc.textContent = B.chanceText(key);
        pc.title = 'Chance de gagner cette mise';
        tapis.appendChild(pc);
      }
    });
    if (showResult) {
      B.spots.forEach((s) => {
        if (s.numbers.includes(view.result)) { const el = tapis.querySelector('[data-key="' + s.key + '"]'); if (el && s.z === 0) el.classList.add('win'); }
      });
      const c = centerOf('n' + view.result);
      const d = document.createElement('div');
      d.className = 'dolly'; d.style.left = c.left + '%'; d.style.top = c.top + '%';
      tapis.appendChild(d);
    }
    // annonce, compte à rebours, historique
    $('announce').textContent = view.announce || '';
    $('announce').classList.toggle('urgent', view.phase === 'betting' && view.deadline && view.deadline - now() < 5000);
    $('sub-message').textContent = view.sub || '';
    const hist = $('history');
    hist.innerHTML = '';
    (view.history || []).slice(0, 14).forEach((n) => { const s = document.createElement('span'); s.className = B.color(n); s.textContent = n; hist.appendChild(s); });
    const pl = $('players');
    pl.innerHTML = '';
    (view.players || []).forEach((p) => {
      const s = document.createElement('span');
      const i = document.createElement('i'); i.style.background = p.color;
      s.append(i, (p.me ? 'Toi' : p.name) + ' · ' + fmt(p.bankroll) + ' €' + (p.ready ? ' ✔' : '') + (p.cashedOut ? ' 💰 encaissé' : p.out ? ' (éliminé)' : ''));
      pl.appendChild(s);
    });
    $('bankroll').textContent = view.bankroll == null ? '–' : fmt(view.bankroll);
    const total = Object.values(view.bets || {}).reduce((a, b) => a + b, 0);
    $('total-bet').textContent = fmt(total);
    ['b-undo', 'b-clear', 'b-rebet', 'b-double'].forEach((id) => { $(id).disabled = !view.canBet; });
    $('b-ready').textContent = view.readyLabel || 'Lancer la bille';
    $('b-ready').disabled = !!view.readyDisabled;
    $('b-end').disabled = !!view.endDisabled;
    if (showResult) showBadge(view.result); else $('result-badge').hidden = true;
    tickTimer();
  }

  function tickTimer() {
    const v = lastView;
    const box = $('timer');
    if (!v || v.phase !== 'betting' || !v.deadline) { box.hidden = true; return; }
    const left = Math.max(0, v.deadline - now());
    box.hidden = false;
    $('timer-bar').style.width = Math.min(100, (left / (v.betTime * 1000)) * 100) + '%';
    $('timer-bar').classList.toggle('urgent', left < 5000);
    $('timer-text').textContent = 'Mises : ' + Math.ceil(left / 1000) + ' s';
    $('announce').classList.toggle('urgent', left < 5000);
    if (left < 5000 && v.announce === 'Faites vos jeux') $('announce').textContent = 'Dernières mises !';
  }
  setInterval(tickTimer, 200);

  /** Petite fenêtre après chaque numéro : gain en vert, perte en rouge. */
  function showOutcome(net, staked) {
    if (!staked) return;
    const box = $('outcome');
    box.className = 'outcome ' + (net > 0 ? 'win' : net < 0 ? 'lose' : 'even');
    $('outcome-title').textContent = net > 0 ? 'Gagné !' : net < 0 ? 'Perdu' : 'Mise récupérée';
    $('outcome-amount').textContent = (net > 0 ? '+' : net < 0 ? '−' : '') + fmt(Math.abs(net)) + ' €';
    $('outcome-detail').textContent = 'Misé ' + fmt(staked) + ' € · récupéré ' + fmt(staked + net) + ' €';
    box.hidden = false;
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    clearTimeout(showOutcome.t);
    showOutcome.t = setTimeout(() => { box.hidden = true; }, 3800);
  }

  function showBadge(n) {
    const b = $('result-badge');
    if (!b.hidden && b.textContent === String(n)) return;
    b.className = 'result-badge ' + B.color(n);
    b.textContent = n;
    b.hidden = false;
  }

  function rienNeVaPlus() {
    const r = $('rien');
    r.hidden = false;
    r.style.animation = 'none'; void r.offsetWidth; r.style.animation = '';
    if (window.Sfx) Sfx.say('Rien ne va plus');
    setTimeout(() => {
      r.hidden = true;
      // Sur téléphone, la roue et le tapis ne tiennent pas ensemble à l'écran : on montre la roue pendant le lancer
      if (window.matchMedia('(max-width: 640px)').matches) $('wheel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 1200);
  }

  function buildChips() {
    const box = $('chips');
    box.innerHTML = '';
    CHIPS.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip c' + chipBase(v) + (v === selected ? ' sel' : '');
      b.textContent = v >= 1000 ? (v / 1000) + 'k' : v;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', v === selected);
      b.setAttribute('aria-label', 'Jeton de ' + v + ' €');
      b.addEventListener('click', () => { selected = v; buildChips(); });
      box.appendChild(b);
    });
  }

  function announceResult(n) {
    if (!window.Sfx) return;
    Sfx.say(n === 0 ? 'Zéro' : n + ', ' + (B.RED.has(n) ? 'rouge' : 'noir') + ', ' + (n % 2 ? 'impair' : 'pair') + ' et ' + (n <= 18 ? 'manque' : 'passe'));
  }

  function limitText(key) {
    const s = B.byKey[key];
    return 'Mise maximale sur ' + B.TYPES[s.type].label.toLowerCase() + ' : ' + s.max + ' €.';
  }

  // ---------- Aides ----------
  function coachInfo(key) {
    if (document.body.classList.contains('no-coach')) return;
    const inf = B.info(key);
    const fb = $('feedback');
    fb.className = 'feedback hint';
    fb.innerHTML = '';
    const v = document.createElement('div'); v.className = 'verdict'; v.textContent = inf.name;
    const p = document.createElement('p'); p.textContent = inf.text;
    fb.append(v, p);
  }
  function coachRound(lines, cls) {
    if (document.body.classList.contains('no-coach')) return;
    const fb = $('feedback');
    fb.className = 'feedback ' + (cls || 'hint');
    fb.innerHTML = '';
    lines.forEach((t, k) => {
      const p = document.createElement(k === 0 ? 'div' : 'p');
      if (k === 0) p.className = 'verdict';
      p.textContent = t;
      fb.appendChild(p);
    });
  }

  // Statistiques et détection des pièges classiques (partagées solo / entre amis)
  function createStats() {
    return { spins: 0, wagered: 0, net: 0, expected: 0, biggestWin: 0, biggestLoss: 0, played: 0, wins: 0, streak: 0, bestStreak: 0, peak: 0, startedAt: Date.now(), tips: {}, lastSimple: {}, history: [] };
  }
  const TIP_TEXT = {
    martingale: 'Tu doubles ta mise après une perte (martingale). Ça semble sûr, mais une série de pertes arrive plus vite qu\'on ne croit et vide le solde : la martingale ne change pas l\'avantage du casino.',
    fallacy: 'Après plusieurs rouges d\'affilée, le noir n\'est pas « dû » : la bille n\'a pas de mémoire, chaque tour reste à 18 chances sur 37.',
    bigbet: 'Tu mises une grosse part de ton solde sur un seul tour. Pour durer, vise 2 à 5 % de ton solde par tour.',
    pleins: 'Les pleins paient beaucoup mais ne sortent qu\'une fois sur 37 : attends-toi à de longues séries sans gain.',
    simples: 'Les chances simples sont les mises les moins chères pour toi : grâce au partage, le casino n\'y garde que 1,35 %.',
  };
  /** À appeler juste avant le tirage, avec les mises du tour et le solde avant mise. */
  function analyseBets(T, bets, bankrollBefore, history) {
    const staked = Object.values(bets).reduce((a, b) => a + b, 0);
    if (!staked) return;
    const tip = (k) => { T.tips[k] = (T.tips[k] || 0) + 1; };
    ['red', 'black', 'even', 'odd', 'low', 'high'].forEach((k) => {
      const prev = T.lastSimple[k];
      if (bets[k] && prev && prev.lost && bets[k] >= prev.amount * 1.8) tip('martingale');
    });
    const last4 = history.slice(0, 4);
    if (last4.length === 4 && last4.every((n) => B.color(n) === 'red') && bets.black) tip('fallacy');
    if (last4.length === 4 && last4.every((n) => B.color(n) === 'black') && bets.red) tip('fallacy');
    if (staked > bankrollBefore * 0.25) tip('bigbet');
    if (Object.keys(bets).filter((k) => k[0] === 'n').length >= 5) tip('pleins');
  }
  /** Après le tirage : met à jour les statistiques ; renvoie { staked, back, net }. */
  function recordSpin(T, bets, n) {
    const staked = Object.values(bets).reduce((a, b) => a + b, 0);
    let back = 0, expected = 0;
    Object.keys(bets).forEach((k) => {
      back += B.payout(k, bets[k], n);
      expected += bets[k] * (B.byKey[k].type === 'simple' ? 0.0135 : 0.027);
    });
    T.spins++;
    T.wagered += staked;
    T.net += back - staked;
    T.expected += expected;
    if (back - staked > T.biggestWin) T.biggestWin = back - staked;
    if (staked - back > (T.biggestLoss || 0)) T.biggestLoss = staked - back;
    if (staked) {
      T.played = (T.played || 0) + 1;
      if (back > staked) { T.wins = (T.wins || 0) + 1; T.streak = (T.streak || 0) + 1; T.bestStreak = Math.max(T.bestStreak || 0, T.streak); }
      else T.streak = 0;
    }
    T.history.unshift(n);
    ['red', 'black', 'even', 'odd', 'low', 'high'].forEach((k) => {
      T.lastSimple[k] = bets[k] ? { amount: bets[k], lost: B.payout(k, bets[k], n) < bets[k] } : null;
    });
    if (staked && Object.keys(bets).every((k) => B.byKey[k].type === 'simple')) T.tips.simples = (T.tips.simples || 0) + 0;
    return { staked, back, net: back - staked, expected };
  }

  function renderStats(T) {
    $('s-spins').textContent = T.spins;
    $('s-wagered').textContent = fmt(T.wagered);
    $('s-net').textContent = (T.net > 0 ? '+' : '') + fmt(T.net);
    $('s-net').style.color = T.net > 0 ? 'var(--good)' : T.net < 0 ? 'var(--bad)' : '';
    const luck = T.net + T.expected;
    $('s-luck').textContent = (luck > 0 ? '+' : '') + fmt(Math.round(luck));
    $('s-luck').style.color = luck > 0 ? 'var(--good)' : luck < 0 ? 'var(--bad)' : '';
    const h = T.history;
    const red = h.filter((n) => B.color(n) === 'red').length, black = h.filter((n) => B.color(n) === 'black').length, zero = h.filter((n) => n === 0).length;
    $('freq').innerHTML = '';
    if (h.length) {
      [['red', 'Rouge ' + red], ['black', 'Noir ' + black], ['green', 'Zéro ' + zero]].forEach(([c, t]) => {
        const s = document.createElement('span'); s.className = c; s.textContent = t; $('freq').appendChild(s);
      });
    }
    const tips = $('tips');
    tips.innerHTML = '';
    const list = Object.entries(T.tips).filter(([k, n]) => n > 0 && TIP_TEXT[k]).sort((a, b) => b[1] - a[1]).map(([k, n]) => TIP_TEXT[k] + ' (' + n + '×)');
    if (!list.length) list.push('Aucune méthode ne bat la roulette : chaque tour est indépendant, et le 0 donne l\'avantage au casino. Fixe-toi une limite et amuse-toi.');
    list.push(TIP_TEXT.simples);
    list.forEach((t) => { const li = document.createElement('li'); li.textContent = t; tips.appendChild(li); });
  }

  // Profil du Casino : expérience, défis, succès, effet « gros gain »
  function trackSpin(bets, n, r) {
    if (!window.Casino || !r.staked) return;
    const pleinHit = Object.keys(bets).some((k) => B.byKey[k].type === 'plein' && B.byKey[k].numbers[0] === n);
    const zeroWin = n === 0 && Object.keys(bets).some((k) => B.byKey[k].numbers.includes(0));
    Casino.track('rl', { staked: r.staked, bet: r.staked, net: r.net, pleinHit, zeroWin });
    if (r.net >= 9 * r.staked && r.net >= 50) setTimeout(() => Casino.bigWin(r.net, pleinHit ? 'EN PLEIN !' : 'GROS GAIN !'), 1500);
  }

  // ---------- Bilan de partie (encaissement, fin de partie) ----------
  function bilanStats(T, startBank, finalBank) {
    const counts = {};
    T.history.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
    const hot = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const res = finalBank - startBank;
    const luck = Math.round(T.net + T.expected);
    const mins = Math.max(1, Math.round((Date.now() - (T.startedAt || Date.now())) / 60000));
    return [
      ['Résultat', (res > 0 ? '+' : res < 0 ? '−' : '') + fmt(Math.abs(res)) + ' €'],
      ['Solde final', fmt(finalBank) + ' €'],
      ['Solde le plus haut', fmt(Math.max(T.peak || 0, startBank, finalBank)) + ' €'],
      ['Tours joués', T.spins],
      ['Tours gagnants', T.played ? T.wins + ' / ' + T.played + ' (' + Math.round((T.wins / T.played) * 100) + ' %)' : '–'],
      ['Meilleure série', (T.bestStreak || 0) + ' gain' + ((T.bestStreak || 0) > 1 ? 's' : '')],
      ['Total misé', fmt(T.wagered) + ' €'],
      ['Plus gros gain', T.biggestWin ? '+' + fmt(T.biggestWin) + ' €' : '–'],
      ['Plus grosse perte', T.biggestLoss ? '−' + fmt(T.biggestLoss) + ' €' : '–'],
      ['Numéro le plus sorti', hot !== undefined ? hot + ' (' + counts[hot] + '×)' : '–'],
      ['Chance', (luck >= 0 ? '+' : '−') + fmt(Math.abs(luck)) + ' €'],
      ['Durée', mins + ' min'],
    ];
  }

  // ---------- Fin de partie ----------
  function showRecap(o) {
    const box = $('recap');
    box.hidden = false;
    box.classList.remove('show-stats');
    box.classList.toggle('lost', !o.won);
    $('recap-icon').textContent = o.icon || (o.won ? '🏆' : '🎡');
    $('recap-title').textContent = o.title;
    $('recap-sub').textContent = o.subtitle || '';
    if (window.Sfx) { if (o.won) { Sfx.win(); setTimeout(() => Sfx.win(), 450); } else Sfx.lose(); }
    if (o.won) confetti();
    const grid = $('recap-stats');
    grid.innerHTML = '';
    (o.stats || []).forEach(([label, value]) => {
      const d = document.createElement('div'); d.className = 'stat';
      const v = document.createElement('span'); v.textContent = value;
      const l = document.createElement('small'); l.textContent = label;
      d.append(v, l); grid.appendChild(d);
    });
    const tb = $('recap-ranking');
    tb.innerHTML = '';
    (o.ranking || []).forEach((r, k) => {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      [k === 0 ? '🥇' : k === 1 ? '🥈' : k === 2 ? '🥉' : (k + 1) + 'e', r.me ? 'Toi' : r.name, fmt(r.bankroll) + ' €', r.biggestWin ? '+' + fmt(r.biggestWin) : '–', fmt(r.wagered || 0) + ' €']
        .forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    $('recap-rank-title').textContent = o.rankTitle || 'Classement';
    $('recap-again').textContent = o.againLabel || 'Nouvelle partie';
    $('recap-again').onclick = () => { box.hidden = true; if (o.onAgain) o.onAgain(); };
    $('recap-close').textContent = o.closeLabel || 'Fermer';
    $('recap-close').onclick = () => { box.hidden = true; if (o.onClose) o.onClose(); };
    setTimeout(() => box.classList.add('show-stats'), 2000);
  }
  function confetti() {
    const c = $('confetti');
    const x = c.getContext('2d');
    const W = c.width = window.innerWidth, H = c.height = window.innerHeight;
    const colors = ['#f2c14e', '#ffffff', '#b3171b', '#0d7a3e', '#141414'];
    const parts = Array.from({ length: 170 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, r: 4 + Math.random() * 6, vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4, a: Math.random() * 6, va: -0.2 + Math.random() * 0.4, col: colors[Math.floor(Math.random() * colors.length)] }));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    (function frame(t) {
      x.clearRect(0, 0, W, H);
      parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.a += p.va; p.vy += 0.03; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.col; x.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); x.restore(); });
      if (t - t0 < 4000 && !reduce) requestAnimationFrame(frame); else x.clearRect(0, 0, W, H);
    })(t0);
  }

  function setHandlers(h) { handlers = h || {}; }
  function ensureWheel() { if (!wheel) wheel = new RouletteWheel($('wheel')); return wheel; }

  $('b-undo').addEventListener('click', () => handlers.undo && handlers.undo());
  $('b-clear').addEventListener('click', () => handlers.clear && handlers.clear());
  $('b-rebet').addEventListener('click', () => handlers.rebet && handlers.rebet());
  $('b-double').addEventListener('click', () => handlers.double && handlers.double());
  $('b-ready').addEventListener('click', () => handlers.ready && handlers.ready());
  // « Encaisser » : deux clics pour confirmer
  let endArmed = null;
  $('b-end').addEventListener('click', () => {
    if (!handlers.end) return;
    if (!endArmed) {
      // solde + mises pas encore jouées (elles seront rendues)
      const v = lastView || {};
      const amount = (v.bankroll || 0) + (v.phase === 'waiting' || v.phase === 'betting' ? Object.values(v.bets || {}).reduce((x, y) => x + y, 0) : 0);
      $('b-end').textContent = 'Confirmer : encaisser ' + fmt(amount) + ' € ?';
      endArmed = setTimeout(() => { endArmed = null; $('b-end').textContent = '💰 Encaisser'; }, 3500);
      return;
    }
    clearTimeout(endArmed); endArmed = null;
    $('b-end').textContent = '💰 Encaisser';
    handlers.end();
  });
  window.addEventListener('resize', () => { if (lastView) { buildTapis(); render(lastView); } });
  // Interrupteur « Aides » : active ou coupe tout (pourcentages sur les jetons, panneau d'aides, conseils, chance)
  function applyAides(on) {
    document.body.classList.toggle('no-coach', !on);
    $('opt-info').checked = on;
    if (lastView) render(lastView);
  }
  $('opt-info').addEventListener('change', (e) => { if (handlers.setAides) handlers.setAides(e.target.checked); else applyAides(e.target.checked); });
  buildChips();

  window.RouletteUI = {
    render, setHandlers, ensureWheel, showOutcome, limitText, applyAides, trackSpin, rienNeVaPlus, announceResult, coachInfo, coachRound,
    createStats, analyseBets, recordSpin, renderStats, showRecap, bilanStats,
    get chip() { return selected; },
    SPIN_MS, RESULT_MS, fmt,
  };

  // ======================= Partie solo =======================
  let S = null; // état de la partie solo
  let soloTimer = null;

  let defi = null; // défi entre amis en cours : { code, meta, rng }
  // mode : 'train' (crédit illimité + aides), 'real' (somme apportée de la banque, sans aides) ou 'defi'
  function startSolo(mode, amount, resumed) {
    mode = defi ? 'defi' : mode || 'train';
    if (window.Casino) Casino.training = mode === 'train';
    scaleChips(mode === 'real'); buildChips();
    const bank = defi ? defi.meta.bank : amount || 10000;
    const start = mode === 'real' && window.Casino && Casino.session('roulette') ? Casino.session('roulette').start : bank;
    S = {
      mode, bankroll: bank, start, betTime: parseInt($('set-bettime').value, 10), coach: mode === 'train',
      bets: {}, log: [], lastBets: {}, history: [], phase: 'waiting', deadline: null, result: null,
      T: createStats(), startedAt: now(), maxBank: bank, defi,
    };
    applyAides(S.coach);
    const badge = $('mode-badge');
    badge.hidden = mode === 'defi';
    badge.className = 'cm-badge mode-line' + (mode === 'real' ? ' real' : '');
    badge.textContent = mode === 'real' ? '🕴️ La Dette · sans aides · « Encaisser » ramène l\'argent dans ta caisse' : '🎓 Apprentissage · crédit illimité, aides et conseils · ne compte pas';
    $('aides-row').hidden = mode !== 'train'; // en partie réelle : pas d'aides, on teste ce qu'on a appris
    $('setup').hidden = true;
    $('game').hidden = false;
    ensureWheel();
    setHandlers(soloHandlers);
    if (window.Sfx) Sfx.say('Faites vos jeux');
    soloRender();
    renderStats(S.T);
  }

  function soloView() {
    const s = S;
    let announce = 'Faites vos jeux', sub = '';
    if (s.phase === 'waiting') sub = 'Pose tes jetons : le compte à rebours démarre à ta première mise.';
    if (s.phase === 'betting') sub = 'Touche les cases du tapis pour miser. « Lancer la bille » pour ne pas attendre.';
    if (s.defi && (s.phase === 'waiting' || s.phase === 'betting')) sub = '🎯 Défi · tour ' + (s.T.spins + 1) + ' / ' + s.defi.meta.rounds + ' · ' + sub;
    if (s.phase === 'spinning') { announce = 'Rien ne va plus'; sub = 'La bille tourne…'; }
    if (s.phase === 'result') { announce = B.describe(s.result); sub = s.resultText || ''; }
    return {
      phase: s.phase, deadline: s.deadline, betTime: s.betTime, bets: s.bets, others: [], bankroll: s.bankroll,
      history: s.history, result: s.result, announce, sub,
      canBet: s.phase === 'waiting' || s.phase === 'betting',
      readyLabel: 'Lancer la bille', readyDisabled: s.phase !== 'betting',
    };
  }
  function soloRender() {
    if (!S) return;
    // partie réelle : la somme sur la table (mises pas encore jouées comprises) est sauvegardée en continu
    if (window.Casino && S.phase !== 'over' && S.mode === 'real') Casino.setStack('roulette', S.bankroll + (S.phase === 'spinning' ? 0 : S.log.reduce((a, l) => a + l.amount, 0)));
    render(soloView());
  }

  function addBet(key, amount) {
    if (!S || !(S.phase === 'waiting' || S.phase === 'betting')) return false;
    if (S.bankroll < amount) { $('sub-message').textContent = 'Solde insuffisant pour ce jeton.'; return false; }
    // partie réelle : plafonds du palier de La Dette (par case selon le type, et deux fois la mise max. pour le tour)
    if (S.mode === 'real' && window.Casino) {
      const cap = Casino.maxBet(), staked = Object.values(S.bets).reduce((a, v) => a + v, 0);
      const caseCap = Math.min(cap, Math.round(B.byKey[key].max * Casino.betFactor()));
      // mises minimales : 1 € sur un numéro, 2 € sur les chances simples, douzaines et colonnes (elles montent avec les paliers)
      const out = ['simple', 'douzaine', 'colonne'].includes(B.byKey[key].type), minIn = Casino.minBet('roulette'), mn = out ? minIn * 2 : minIn;
      if ((S.bets[key] || 0) + amount < mn) { $('sub-message').textContent = 'Mise minimale : ' + mn + ' € ' + (out ? 'sur les chances simples, douzaines et colonnes.' : 'sur un numéro.'); return false; }
      if ((S.bets[key] || 0) + amount > caseCap) { $('sub-message').textContent = 'À ce palier, au plus ' + caseCap.toLocaleString('fr-FR') + ' € sur cette case.'; return false; }
      if (staked + amount > cap * 2) { $('sub-message').textContent = 'À ce palier, au plus ' + (cap * 2).toLocaleString('fr-FR') + ' € par tour.'; return false; }
    } else if (B.room(key, S.bets[key]) < amount) { $('sub-message').textContent = limitText(key); return false; }
    S.bets[key] = (S.bets[key] || 0) + amount;
    S.bankroll -= amount;
    S.log.push({ key, amount });
    if (S.phase === 'waiting') {
      S.phase = 'betting';
      S.deadline = now() + S.betTime * 1000;
      clearTimeout(soloTimer);
      soloTimer = setTimeout(closeBets, S.betTime * 1000);
    }
    return true;
  }

  const soloHandlers = {
    bet(key) {
      if (addBet(key, selected)) { if (window.Sfx) Sfx.chips(); coachInfo(key); soloRender(); }
    },
    remove(key) {
      if (!S || !S.bets[key] || !(S.phase === 'betting' || S.phase === 'waiting')) return;
      S.bankroll += S.bets[key]; delete S.bets[key];
      S.log = S.log.filter((l) => l.key !== key);
      soloRender();
    },
    undo() {
      const l = S && S.log.pop();
      if (!l) return;
      S.bets[l.key] -= l.amount; S.bankroll += l.amount;
      if (!S.bets[l.key]) delete S.bets[l.key];
      soloRender();
    },
    clear() {
      if (!S) return;
      S.log.forEach((l) => { S.bankroll += l.amount; });
      S.bets = {}; S.log = [];
      soloRender();
    },
    rebet() {
      if (!S) return;
      const total = Object.values(S.lastBets).reduce((a, b) => a + b, 0);
      if (!total) return;
      if (total > S.bankroll) { $('sub-message').textContent = 'Solde insuffisant pour remiser.'; return; }
      Object.keys(S.lastBets).forEach((k) => addBet(k, S.lastBets[k]));
      if (window.Sfx) Sfx.chips();
      soloRender();
    },
    double() {
      if (!S) return;
      const cur = Object.assign({}, S.bets);
      const total = Object.values(cur).reduce((a, b) => a + b, 0);
      if (!total || total > S.bankroll) { $('sub-message').textContent = total ? 'Solde insuffisant pour doubler.' : ''; return; }
      Object.keys(cur).forEach((k) => addBet(k, cur[k]));
      if (window.Sfx) Sfx.chips();
      soloRender();
    },
    ready() { if (S && S.phase === 'betting') { clearTimeout(soloTimer); closeBets(); } },
    setAides(on) { if (S) S.coach = on; applyAides(on); },
    end() {
      if (!S) return;
      if (S.phase === 'spinning') { $('sub-message').textContent = 'La bille tourne : tu pourras encaisser juste après ce tour.'; return; }
      // les mises posées mais pas encore jouées sont rendues
      S.log.forEach((l) => { S.bankroll += l.amount; });
      S.bets = {}; S.log = [];
      soloRender();
      if (S.defi) { endDefi(); return; }
      if (window.Casino && S.mode === 'real') { Casino.cashOut('roulette'); Casino.track('rl-cashout', { diff: S.bankroll - S.start }); }
      soloRecap(false, true);
    },
  };

  async function closeBets() {
    if (!S || S.phase !== 'betting') return;
    S.phase = 'spinning';
    const before = S.bankroll + Object.values(S.bets).reduce((a, b) => a + b, 0);
    analyseBets(S.T, S.bets, before, S.history);
    rienNeVaPlus();
    soloRender();
    let n;
    S.serverStack = null;
    if (S.defi) n = Math.floor(S.defi.rng() * 37); // défi : la même suite de numéros pour tous les amis
    else if (S.mode === 'real' && window.Casino && Casino.server) {
      // partie réelle : c'est le serveur qui lance la bille et compte l'argent
      const r = await Casino.call('rl.spin', { bets: S.bets });
      if (r.error) {
        S.log.forEach((l) => { S.bankroll += l.amount; });
        S.bets = {}; S.log = []; S.phase = 'waiting'; S.deadline = null;
        soloRender();
        $('sub-message').textContent = '⚠️ ' + r.error + ' Tes mises te sont rendues.';
        return;
      }
      n = r.n;
      S.serverStack = r.stack;
    } else {
      const arr = new Uint32Array(1);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      n = arr[0] % 37;
    }
    await sleep(700);
    await ensureWheel().spin(n, { duration: SPIN_MS });
    resolveSolo(n);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function resolveSolo(n) {
    const r = recordSpin(S.T, S.bets, n);
    S.bankroll += r.back;
    if (S.serverStack != null) S.bankroll = S.serverStack; // le serveur fait foi
    S.maxBank = Math.max(S.maxBank, S.bankroll);
    S.T.peak = Math.max(S.T.peak || 0, S.bankroll);
    S.result = n;
    S.history.unshift(n);
    S.phase = 'result';
    S.resultText = r.staked ? (r.net > 0 ? 'Tu gagnes ' + fmt(r.net) + ' € !' : r.net < 0 ? 'Tu perds ' + fmt(-r.net) + ' €.' : 'Mise récupérée.') +
      (n === 0 && Object.keys(S.bets).some((k) => B.byKey[k].type === 'simple') ? ' (partage : la moitié de tes chances simples t\'est rendue)' : '') : '';
    announceResult(n);
    setTimeout(() => showOutcome(r.net, r.staked), 700);
    trackSpin(S.bets, n, r);
    if (window.Sfx && r.staked) setTimeout(() => { if (r.net > 0) Sfx.win(); else if (r.net < 0) Sfx.lose(); }, 900);
    if (r.staked) {
      coachRound([
        (r.net >= 0 ? '✔ ' : '✘ ') + 'Tour ' + S.T.spins + ' : ' + B.describe(n),
        'Tu as misé ' + fmt(r.staked) + ' € et récupéré ' + fmt(r.back) + ' €.',
        'En moyenne, ces mises te font perdre ' + fmt(Math.round(r.expected * 100) / 100) + ' € par tour : c\'est l\'avantage du casino. Sur toute la partie, ta chance par rapport à la moyenne est de ' + (S.T.net + S.T.expected >= 0 ? '+' : '') + fmt(Math.round(S.T.net + S.T.expected)) + ' €.',
      ], r.net > 0 ? 'good' : r.net < 0 ? 'bad' : 'hint');
    }
    renderStats(S.T);
    soloRender();
    setTimeout(nextSolo, RESULT_MS);
  }

  function nextSolo() {
    if (!S || S.phase !== 'result') return;
    if (Object.keys(S.bets).length) S.lastBets = S.bets;
    S.bets = {}; S.log = [];
    S.phase = 'waiting'; S.deadline = null; S.result = null;
    ensureWheel().clear();
    if (S.defi && (S.T.spins >= S.defi.meta.rounds || S.bankroll < 1)) { endDefi(); return; }
    if (S.bankroll < 1 && S.mode === 'train') { S.bankroll = S.start = window.Casino ? Casino.TRAIN_BANK : 1000; coachRound(['Entraînement : ton crédit est rechargé à ' + fmt(S.bankroll) + ' €.'], 'hint'); }
    if (S.bankroll < 1) { if (window.Casino && S.mode === 'real') Casino.cashOut('roulette'); soloRender(); soloRecap(true); return; }
    if (window.Sfx) Sfx.say('Faites vos jeux');
    soloRender();
  }

  async function endDefi() {
    const d = S.defi, score = S.bankroll;
    S.phase = 'over';
    soloRender();
    $('sub-message').textContent = 'Défi terminé ! Envoi de ton score…';
    await Social.submitChallenge(d.code, score);
    const ch = await Social.getChallenge(d.code);
    Social.showChallengeResult(ch || { code: d.code, meta: d.meta, results: {}, uid: null }, score);
    defi = null;
    S = null;
    $('game').hidden = true; $('setup').hidden = false; $('defi-banner').hidden = true;
    history.replaceState(null, '', location.pathname);
    renderPicker();
  }

  function soloRecap(broke, cashout) {
    clearTimeout(soloTimer);
    S.phase = 'over';
    const T = S.T;
    const won = S.bankroll > S.start;
    const diff = S.bankroll - S.start;
    showRecap({
      won, icon: cashout ? (won ? '💰' : '🎡') : undefined,
      title: broke ? 'Tout est perdu' : cashout ? (S.mode === 'train' ? 'Fin de l\'entraînement' : 'Tu encaisses ' + fmt(S.bankroll) + ' €') : won ? 'Bravo, tu repars gagnant !' : 'Fin de la partie',
      subtitle: diff > 0 ? 'Tu repars avec ' + fmt(diff) + ' € de plus qu\'au départ !' : diff < 0 ? 'Tu repars avec ' + fmt(-diff) + ' € de moins qu\'au départ.' : 'Tu repars avec ton solde de départ.',
      stats: bilanStats(T, S.start, S.bankroll),
      ranking: [{ name: 'Toi', me: true, bankroll: S.bankroll, biggestWin: T.biggestWin, wagered: T.wagered }],
      rankTitle: 'Ton bilan',
      againLabel: 'Nouvelle partie', closeLabel: 'Fermer',
      onAgain: backToSetup,
      onClose: backToSetup,
    });
  }

  function backToSetup() { S = null; $('game').hidden = true; $('setup').hidden = false; renderPicker(); }
  function renderPicker() {
    if (!window.Casino || defi) { $('mode-picker').hidden = true; $('start').hidden = false; return; }
    $('mode-picker').hidden = false;
    Casino.modePicker($('mode-picker'), { game: 'roulette', min: 1, suggest: 100, onStart: startSolo });
  }
  $('start').addEventListener('click', () => startSolo(defi ? 'defi' : 'train'));
  // Lien de défi (?defi=CODE)
  const defiCode = new URLSearchParams(location.search).get('defi');
  if (defiCode && window.Social) {
    Social.getChallenge(defiCode).then((ch) => {
      if (!ch || ch.meta.game !== 'roulette') { $('wallet-note').textContent = 'Défi introuvable.'; return; }
      defi = { code: defiCode, meta: ch.meta, rng: Social.rng(ch.meta.seed) };
      $('defi-banner').hidden = false;
      $('defi-text').textContent = 'Défi de ' + ch.meta.by + ' : ' + ch.meta.rounds + ' tours avec ' + ch.meta.bank + ' € de jetons de défi. Tout le monde reçoit les mêmes numéros : fais le meilleur solde final ! (Ton portefeuille n\'est pas touché.)';
      $('start').textContent = 'Relever le défi';
      renderPicker();
    });
  }
  renderPicker();
  window.RouletteSolo = {
    get state() { return S; },
    // retour sur l'onglet Solo : on reprend la partie en cours ou on affiche les réglages
    activate() {
      if (window.Casino) Casino.training = !!S && S.mode === 'train';
      document.body.classList.toggle('no-coach', !!S && !S.coach);
      $('opt-info').checked = !S || S.coach;
      $('aides-row').hidden = !!S && S.mode !== 'train';
      if (S) { $('setup').hidden = true; $('game').hidden = false; setHandlers(soloHandlers); soloRender(); renderStats(S.T); }
      else { $('setup').hidden = false; $('game').hidden = true; }
    },
  };
})();
