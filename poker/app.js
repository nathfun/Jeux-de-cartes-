/*
 * Poker solo contre des bots, avec un coach.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const P = PokerEngine, C = PokerCoach, B = PokerBots;
  const STATS_KEY = 'poker-coach-v1';
  const ME = 0;

  let st = null;            // état du moteur
  let cfg = null;           // réglages de la partie
  let busy = false;         // animation ou bot en cours
  let boardShown = 0;       // cartes communes déjà révélées
  let pending = null;       // analyse du coach pour la décision en cours
  let handLog = [];         // décisions du joueur pendant la main
  let handStartStack = 0;
  let vpipThisHand = false;
  const shown = new Map();  // id carte -> 'hidden' | 'shown' (animations)
  const prevBets = {};      // mises affichées au dernier rendu (son des jetons)
  let stats = loadStats();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const speed = () => parseFloat($('opt-speed').value) || 1;
  const wait = (f) => sleep((f || 1) * 700 / speed());
  const coachOn = () => cfg && cfg.coach;

  // ---------- Statistiques ----------
  function freshStats() {
    return { decisions: 0, good: 0, ok: 0, bad: 0, hands: 0, vpip: 0, net: 0, patterns: {} };
  }
  function loadStats() {
    try { const raw = localStorage.getItem(STATS_KEY); if (raw) return Object.assign(freshStats(), JSON.parse(raw)); } catch (e) { /* ignore */ }
    return freshStats();
  }
  function saveStats() { try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ } }

  // ---------- Démarrage ----------
  function start() {
    const [sb, bb] = $('set-blinds').value.split('/').map(Number);
    const n = parseInt($('set-opponents').value, 10);
    const styleSel = $('set-style').value;
    cfg = { sb, bb, stack: bb * parseInt($('set-stack').value, 10), coach: $('set-coach').checked, timer: parseInt($('set-timer').value, 10) || 0 };
    document.body.classList.toggle('no-coach', !cfg.coach);
    st = P.createTable({ sb, bb });
    P.addSeat(st, { name: 'Toi', stack: cfg.stack, human: true });
    const styles = ['regulier', 'agressif', 'prudent', 'regulier', 'agressif'];
    const names = B.NAMES.slice().sort(() => Math.random() - 0.5);
    for (let k = 0; k < n; k++) {
      const style = styleSel === 'mix' ? styles[k] : styleSel;
      P.addSeat(st, { name: names[k], stack: cfg.stack, style });
    }
    $('setup').hidden = true;
    $('game').hidden = false;
    newHand();
  }

  function newHand() {
    $('next-hand').hidden = true;
    $('summary-panel').hidden = true;
    st.seats.forEach((s, i) => {
      if (i !== ME && s.stack <= 0) { s.stack = cfg.stack; s.out = false; s.rebuy = true; }
    });
    if (st.seats[ME].stack <= 0) {
      setMessage('Tu n\'as plus de jetons. Tu te recaves de ' + cfg.stack + '.');
      st.seats[ME].stack = cfg.stack; st.seats[ME].out = false;
    }
    handStartStack = st.seats[ME].stack;
    handLog = [];
    vpipThisHand = false;
    boardShown = 0;
    pending = null;
    if (!P.startHand(st)) { setMessage('Pas assez de joueurs.'); return; }
    stats.hands++;
    const rebuys = st.seats.filter((s) => s.rebuy).map((s) => s.name);
    st.seats.forEach((s) => { s.rebuy = false; });
    setMessage(rebuys.length ? rebuys.join(', ') + ' se recave' + (rebuys.length > 1 ? 'nt' : '') + '.' : '');
    loop();
  }

  async function loop() {
    busy = true;
    render();
    // Révélation progressive des cartes communes
    while (boardShown < st.board.length) {
      await wait(0.65);
      boardShown++;
      render();
    }
    if (st.street === 'showdown') { busy = false; endHand(); return; }
    const i = st.toAct;
    if (i === ME) {
      busy = false;
      pending = null;
      render();
      startTimer();
      if (coachOn()) {
        await sleep(30); // laisse l'écran se mettre à jour avant le calcul
        pending = C.analyze(st, ME, { iters: 700 });
        if ($('opt-hint').checked) showHint();
      }
      return;
    }
    await wait(1);
    const s = st.seats[i];
    B.play(st, i, s.style);
    loop();
  }

  // ---------- Actions du joueur ----------
  function humanAct(action) {
    if (busy || !st || st.toAct !== ME) return;
    stopTimer();
    const L = P.legal(st, ME);
    if (action.type === 'raise' && action.to >= L.maxTo) action = { type: 'allin' };
    const res = pending || (coachOn() ? C.analyze(st, ME, { iters: 400 }) : null);
    const street = st.street;
    if (!P.act(st, ME, action)) return;
    if (street === 'preflop' && ['call', 'raise', 'allin'].includes(action.type)) vpipThisHand = true;
    $('raise-box').hidden = true;
    if (res) record(res, action, street);
    loop();
  }

  function record(res, action, street) {
    const verdict = C.judge(res, action);
    stats.decisions++;
    stats[verdict]++;
    if (verdict === 'bad') {
      const m = C.mistake(res, action);
      stats.patterns[m] = (stats.patterns[m] || 0) + 1;
    }
    saveStats();
    const played = action.type === 'raise' ? (res.legal.isBet ? 'Miser ' : 'Relancer à ') + action.to : C.LABEL[action.type] + (action.type === 'call' ? ' ' + res.toCall : '');
    handLog.push({ street, verdict, played, rec: res.rec.label, reason: res.rec.reason });
    const fb = $('feedback');
    fb.className = 'feedback ' + verdict;
    fb.innerHTML = '';
    const v = document.createElement('div');
    v.className = 'verdict';
    v.textContent = verdict === 'good' ? '✔ Bon choix : ' + played
      : verdict === 'ok' ? '≈ Défendable : « ' + played + ' ». Le coach préférait « ' + res.rec.label + ' ».'
        : '✘ Tu as choisi « ' + played + ' », le coach conseillait « ' + res.rec.label + ' ».';
    fb.appendChild(v);
    appendReason(fb, res);
  }

  function appendReason(fb, res) {
    const p = document.createElement('p');
    p.textContent = res.rec.reason;
    fb.appendChild(p);
    const more = document.createElement('button');
    more.className = 'ghost small fb-actions';
    more.textContent = '🔎 Plus de détails';
    const box = document.createElement('div');
    box.className = 'details';
    box.hidden = true;
    C.details(res).forEach((t) => { const q = document.createElement('p'); q.textContent = t; box.appendChild(q); });
    more.addEventListener('click', () => {
      box.hidden = !box.hidden;
      more.textContent = box.hidden ? '🔎 Plus de détails' : 'Masquer les détails';
    });
    fb.append(more, box);
  }

  function showHint() {
    if (!coachOn() || busy || !st || st.toAct !== ME) return;
    if (!pending) pending = C.analyze(st, ME, { iters: 700 });
    showHintRes(pending);
  }
  function showHintRes(res) {
    const fb = $('feedback');
    fb.className = 'feedback hint';
    fb.innerHTML = '';
    const v = document.createElement('div');
    v.className = 'verdict';
    v.textContent = '💡 Conseil : ' + res.rec.label;
    fb.appendChild(v);
    appendReason(fb, res);
  }

  // ---------- Minuteur de réflexion ----------
  let timerId = null, lastTick = -1;
  function startTimer() {
    stopTimer();
    const secs = cfg.timer;
    if (!secs) return;
    const end = Date.now() + secs * 1000;
    $('timer').hidden = false;
    const tick = () => {
      const left = end - Date.now();
      $('timer-bar').style.width = Math.max(0, (left / (secs * 1000)) * 100) + '%';
      $('timer-bar').classList.toggle('urgent', left < 5000);
      $('timer-text').textContent = Math.max(0, Math.ceil(left / 1000)) + ' s';
      const sec = Math.ceil(left / 1000);
      if (left < 5000 && sec !== lastTick && window.Sfx) { lastTick = sec; Sfx.tick(); }
      if (left <= 0) {
        stopTimer();
        const L = P.legal(st, ME);
        humanAct({ type: L.canCheck ? 'check' : 'fold' }); // temps écoulé : parole si possible, sinon on se couche
      }
    };
    tick();
    timerId = setInterval(tick, 200);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    $('timer').hidden = true;
  }

  // ---------- Fin de main ----------
  async function endHand() {
    render();
    const me = st.seats[ME];
    const net = me.stack - handStartStack;
    stats.net += net;
    if (vpipThisHand) stats.vpip++;
    saveStats();
    const r = st.results;
    const winners = [...new Set(r.pots.flatMap((p) => p.winners))].map((w) => st.seats[w].name);
    let msg = winners.join(' et ') + (winners.length > 1 ? ' se partagent ' : ' remporte ') + r.pots.reduce((a, p) => a + p.amount, 0);
    if (!r.uncontested && r.pots[0].hand) msg += ' avec ' + r.pots[0].hand.toLowerCase();
    msg += net > 0 ? ' — tu gagnes ' + net + ' !' : net < 0 ? ' — tu perds ' + (-net) + '.' : '.';
    setMessage(msg);
    if (window.Sfx) { if (net > 0) Sfx.win(); else if (net < 0) Sfx.lose(); }
    if (coachOn() && handLog.length) renderSummary(net);
    $('next-hand').hidden = false;
    render();
  }

  function renderSummary(net) {
    const box = $('summary');
    box.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'summary-list';
    const STREET = { preflop: 'Avant le flop', flop: 'Flop', turn: 'Turn', river: 'River' };
    handLog.forEach((d) => {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.className = 'tag ' + d.verdict;
      t.textContent = d.verdict === 'good' ? '✔' : d.verdict === 'ok' ? '≈' : '✘';
      const txt = document.createElement('span');
      txt.textContent = STREET[d.street] + ' : ' + d.played + (d.verdict !== 'good' ? ' (conseil : ' + d.rec + ')' : '');
      li.append(t, txt);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    const good = handLog.filter((d) => d.verdict === 'good').length;
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = good === handLog.length
      ? (net < 0 ? 'Toutes tes décisions étaient bonnes : tu as perdu cette main par malchance, c\'est normal au poker.' : 'Main parfaitement jouée.')
      : (net > 0 ? 'Tu as gagné malgré ' + (handLog.length - good) + ' décision(s) discutable(s) : sur le long terme, elles coûtent des jetons.' : 'Relis les conseils ci-dessus pour la prochaine fois.');
    box.appendChild(p);
    $('summary-panel').hidden = false;
  }

  // ---------- Rendu ----------
  function cardEl(card, hidden) {
    const el = document.createElement('div');
    const prev = shown.get(card.id);
    const anim = !prev ? ' dealt' : (prev === 'hidden' && !hidden ? ' flip' : '');
    shown.set(card.id, hidden ? 'hidden' : 'shown');
    if (window.Sfx) { if (anim === ' dealt') Sfx.card(); else if (anim === ' flip') Sfx.flip(); }
    if (hidden) { el.className = 'card back' + anim; return el; }
    el.className = 'card' + (card.suit === '♥' || card.suit === '♦' ? ' red' : '') + anim;
    el.innerHTML = '<div class="tl">' + card.rank + '<br>' + card.suit + '</div><div class="mid">' + card.suit + '</div>';
    el.setAttribute('aria-label', card.rank + card.suit);
    return el;
  }

  function seatPos(k, n, r) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n; // 0 = en bas, puis sens des aiguilles d'une montre
    return { left: 50 + r[0] * Math.cos(a), top: 50 + r[1] * Math.sin(a) };
  }

  function render() {
    if (!st) return;
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const n = st.seats.length;
    const seatR = narrow ? [40, 42] : [44, 40];
    const betR = narrow ? [24, 26] : [27, 25];
    const seats = $('seats');
    seats.innerHTML = '';
    const showdown = st.street === 'showdown';
    const winCards = new Set();
    if (showdown && !st.results.uncontested) {
      st.results.pots.forEach((p) => p.winners.forEach((w) => (st.seats[w].bestCards || []).forEach((id) => winCards.add(id))));
    }
    st.seats.forEach((s, i) => {
      const pos = seatPos(i, n, seatR);
      const el = document.createElement('div');
      el.className = 'seat' + (i === ME ? ' me' : '') + (s.folded ? ' folded' : '') +
        (!showdown && st.toAct === i ? ' turn' : '') + (showdown && s.won > 0 ? ' winner' : '');
      el.style.left = pos.left + '%';
      el.style.top = i === ME ? 'calc(100% - 6px)' : pos.top + '%'; // ta place reste dans le tapis, en bas
      const hole = document.createElement('div');
      hole.className = 'hole';
      if (!s.folded || i === ME) {
        s.cards.forEach((c) => {
          const faceUp = i === ME || (showdown && s.shown);
          const ce = cardEl(c, !faceUp);
          if (winCards.has(c.id)) ce.classList.add('win');
          if (s.folded) ce.classList.add('dim');
          hole.appendChild(ce);
        });
      }
      const plate = document.createElement('div');
      plate.className = 'plate';
      const nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = s.name + (s.style && i !== ME ? '' : '');
      const sk = document.createElement('div');
      sk.className = 'stack';
      sk.textContent = s.allin && !showdown ? 'Tapis' : s.stack;
      const last = document.createElement('div');
      last.className = 'last';
      last.textContent = showdown && s.won ? '+' + s.won : s.last || '';
      plate.append(nm, sk, last);
      if (showdown && s.shown && s.handName) {
        const hn = document.createElement('div');
        hn.className = 'hand-name';
        hn.textContent = s.handName;
        plate.appendChild(hn);
      }
      if (i === ME) el.append(hole, plate); else el.append(hole, plate);
      seats.appendChild(el);

      if (s.bet > (prevBets[i] || 0) && window.Sfx) Sfx.chips();
      prevBets[i] = s.bet;
      if (s.bet > 0 && !showdown) {
        const bp = seatPos(i, n, betR);
        const chip = document.createElement('div');
        chip.className = 'bet-chip';
        chip.style.left = bp.left + '%';
        chip.style.top = bp.top + '%';
        chip.textContent = s.bet;
        seats.appendChild(chip);
      }
      if (i === st.button) {
        const dp = seatPos(i + 0.32, n, [seatR[0] - 9, seatR[1] - 12]);
        const d = document.createElement('div');
        d.className = 'dealer-btn';
        d.textContent = 'D';
        d.style.left = dp.left + '%';
        d.style.top = dp.top + '%';
        seats.appendChild(d);
      }
    });

    // Cartes communes
    const board = $('board');
    board.innerHTML = '';
    for (let k = 0; k < 5; k++) {
      if (k < boardShown && st.board[k]) {
        const ce = cardEl(st.board[k], false);
        if (winCards.has(st.board[k].id)) ce.classList.add('win');
        board.appendChild(ce);
      } else {
        const slot = document.createElement('div');
        slot.className = 'slot';
        board.appendChild(slot);
      }
    }
    const pot = P.pot(st);
    $('pot').textContent = pot ? 'Pot : ' + pot : '';
    $('my-stack').textContent = st.seats[ME].stack;
    renderActions();
    renderLog();
    renderStats();
  }

  function renderActions() {
    const myTurn = !busy && st.toAct === ME && st.street !== 'showdown';
    $('main-actions').hidden = st.street === 'showdown';
    ['a-fold', 'a-check', 'a-raise', 'a-allin', 'a-hint'].forEach((id) => { $(id).disabled = !myTurn; });
    if (!myTurn) { $('raise-box').hidden = true; return; }
    const L = P.legal(st, ME);
    const me = st.seats[ME];
    $('a-fold').hidden = L.canCheck; // pas de raison de se coucher quand on peut parler gratuitement
    $('a-check').textContent = L.canCheck ? 'Parler' : (L.toCall >= me.stack ? 'Suivre (tapis)' : 'Suivre ' + L.toCall);
    $('a-raise').hidden = !L.canRaise || L.minTo >= L.maxTo;
    $('a-raise').textContent = L.isBet ? 'Miser' : 'Relancer';
    $('a-allin').hidden = !L.canRaise && L.toCall < me.stack;
    $('a-allin').textContent = 'Tapis (' + (me.stack + me.bet) + ')';
    const sl = $('r-slider');
    sl.min = L.minTo; sl.max = L.maxTo; sl.step = Math.max(1, Math.round(st.bb / 2));
    if (+sl.value < L.minTo || +sl.value > L.maxTo) sl.value = L.minTo;
    updateRaiseLabel();
  }

  function updateRaiseLabel() {
    const L = P.legal(st, ME);
    const v = +$('r-slider').value;
    $('r-value').textContent = v >= L.maxTo ? 'tapis (' + v + ')' : v;
    $('r-confirm').firstChild.textContent = (L.isBet ? 'Miser ' : 'Relancer à ');
  }

  function renderLog() {
    const ol = $('log');
    ol.innerHTML = '';
    st.log.slice(-14).forEach((t) => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); });
  }

  const TIPS = {
    looseOpen: 'Tu joues trop de mains avant le flop. Les mains faibles, surtout en début de parole, coûtent de l\'argent : couche-les sans regret.',
    tightFold: 'Tu jettes parfois des mains jouables, surtout au bouton et au cut-off : en fin de parole, tu peux ouvrir plus large.',
    limp: 'Tu te contentes souvent de suivre la grosse blinde. Avec une bonne main, entre en relançant (environ 2,5 grosses blindes).',
    callNoOdds: 'Tu suis trop souvent sans avoir la cote. Avant de payer, compare tes chances (outs × 2 ou × 4) au prix à payer.',
    foldWithOdds: 'Tu te couches alors que la cote du pot justifiait de suivre : un petit prix pour un gros pot vaut souvent le coup.',
    missedValue: 'Tu ne mises pas assez tes bonnes mains. Quand tu es devant, mise pour te faire payer par des mains moins fortes.',
    overBet: 'Tu mises ou relances avec des mains moyennes. Parle plutôt et garde le pot petit quand ta main n\'est pas forte.',
    badBluff: 'Tes bluffs tombent dans de mauvais moments. Bluffe plutôt avec un tirage (semi-bluff) et contre peu d\'adversaires.',
  };
  function buildTips() {
    if (stats.decisions < 5) return ['Joue quelques mains pour recevoir des conseils personnalisés.'];
    const tips = Object.entries(stats.patterns).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .filter(([k]) => TIPS[k]).map(([k, n]) => TIPS[k] + ' (' + n + '×)');
    if (stats.hands >= 20) {
      const v = stats.vpip / stats.hands;
      if (v > 0.38) tips.push('Tu joues ' + Math.round(v * 100) + ' % des mains : c\'est beaucoup. Les bons joueurs en jouent plutôt 20 à 25 % à 6 joueurs.');
      else if (v < 0.12) tips.push('Tu ne joues que ' + Math.round(v * 100) + ' % des mains : tu peux être un peu plus large, surtout en fin de parole.');
    }
    if (!tips.length) tips.push('Très bon jeu jusqu\'ici ! Désactive le conseil automatique pour te tester.');
    return tips;
  }

  function renderStats() {
    $('s-acc').textContent = stats.decisions ? Math.round((stats.good / stats.decisions) * 100) + ' %' : '–';
    $('s-hands').textContent = stats.hands;
    $('s-vpip').textContent = stats.hands ? Math.round((stats.vpip / stats.hands) * 100) + ' %' : '–';
    $('s-net').textContent = (stats.net > 0 ? '+' : '') + stats.net;
    $('s-net').style.color = stats.net > 0 ? 'var(--good)' : stats.net < 0 ? 'var(--bad)' : '';
    $('tips').innerHTML = '';
    buildTips().forEach((t) => { const li = document.createElement('li'); li.textContent = t; $('tips').appendChild(li); });
  }

  function setMessage(t) { $('message').textContent = t; }

  // ---------- Événements ----------
  $('start').addEventListener('click', start);
  $('a-fold').addEventListener('click', () => humanAct({ type: 'fold' }));
  $('a-check').addEventListener('click', () => {
    const L = P.legal(st, ME);
    humanAct({ type: L.canCheck ? 'check' : 'call' });
  });
  $('a-raise').addEventListener('click', () => {
    $('raise-box').hidden = !$('raise-box').hidden;
    const L = P.legal(st, ME);
    $('r-slider').value = Math.min(L.maxTo, Math.max(L.minTo, Math.round((L.isBet ? L.pot * 0.66 : st.currentBet * 3) / 5) * 5));
    updateRaiseLabel();
  });
  $('a-allin').addEventListener('click', () => humanAct({ type: 'allin' }));
  $('r-slider').addEventListener('input', updateRaiseLabel);
  $('r-minus').addEventListener('click', () => { $('r-slider').stepDown(2); updateRaiseLabel(); });
  $('r-plus').addEventListener('click', () => { $('r-slider').stepUp(2); updateRaiseLabel(); });
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const L = P.legal(st, ME);
    const p = b.dataset.preset;
    // une relance « au pot » = suivre puis ajouter la taille du pot après le suivi
    const to = p === 'max' ? L.maxTo : st.currentBet + Math.round((L.pot + L.toCall) * parseFloat(p));
    $('r-slider').value = Math.min(L.maxTo, Math.max(L.minTo, to));
    updateRaiseLabel();
  }));
  $('r-confirm').addEventListener('click', () => humanAct({ type: 'raise', to: +$('r-slider').value }));
  $('a-hint').addEventListener('click', showHint);
  $('opt-hint').addEventListener('change', () => { if ($('opt-hint').checked) showHint(); });
  $('next-hand').addEventListener('click', newHand);
  let quitArmed = false;
  $('quit').addEventListener('click', () => {
    if (!quitArmed) { quitArmed = true; $('quit').textContent = 'Confirmer ?'; setTimeout(() => { quitArmed = false; $('quit').textContent = 'Nouvelle partie'; }, 3000); return; }
    quitArmed = false;
    $('quit').textContent = 'Nouvelle partie';
    st = null;
    stopTimer();
    $('game').hidden = true;
    $('setup').hidden = false;
    $('feedback').className = 'feedback empty';
    $('feedback').textContent = 'Tes décisions seront analysées ici.';
  });
  let resetArmed = false;
  $('reset-stats').addEventListener('click', () => {
    if (!resetArmed) { resetArmed = true; $('reset-stats').textContent = 'Clique encore pour confirmer'; setTimeout(() => { resetArmed = false; $('reset-stats').textContent = 'Réinitialiser les statistiques'; }, 3000); return; }
    resetArmed = false;
    stats = freshStats(); saveStats(); renderStats();
    $('reset-stats').textContent = 'Réinitialiser les statistiques';
  });
  window.addEventListener('resize', () => { if (st) render(); });
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !st || document.body.dataset.mode === 'multi') return;
    const k = e.key.toLowerCase();
    if (k === 'f' && !$('a-fold').hidden) $('a-fold').click();
    else if (k === 'c') $('a-check').click();
    else if (k === 'r' && !$('a-raise').hidden) $('a-raise').click();
    else if (k === 'enter' && !$('next-hand').hidden) newHand();
  });
  renderStats();
  // Partagé avec le mode « Entre amis » (multi.js) et les tests
  window.PokerApp = {
    get state() { return st; },
    record: (res, action, street) => record(res, action, street),
    showHintRes,
    renderStats,
    cardEl,
  };
})();
