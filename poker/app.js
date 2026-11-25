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
  let T = null;             // statistiques de la partie (tournoi)
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
  // Tournoi réel avec le serveur : le serveur garde le paquet et joue les bots ; l'app anime ses « images » de la table
  let srv = false, srvQueue = [], srvHand = null;
  async function startServer() {
    $('buyin-note').textContent = '';
    $('start').disabled = true;
    const r = await Casino.call('pk.start', {
      buyIn: parseInt($('set-buyin').value, 10), opponents: parseInt($('set-opponents').value, 10), style: $('set-style').value,
      blinds: $('set-blinds').value, stack: parseInt($('set-stack').value, 10), rule: $('set-blindup').value,
    });
    $('start').disabled = false;
    if (r.error) { $('buyin-note').textContent = r.error; return; }
    srv = true;
    Casino.training = false;
    cfg = Object.assign({}, r.cfg, { coach: false, real: true, timer: parseInt($('set-timer').value, 10) || 0 });
    T = r.T;
    st = r.frames[r.frames.length - 1];
    document.body.classList.add('no-coach');
    $('setup').hidden = true;
    $('game').hidden = false;
    if (r.resumed && st.street !== 'idle' && st.street !== 'showdown') { setMessage('Tournoi repris.'); handStartStack = st.seats[ME].stack + st.seats[ME].total; loop(); return; }
    if (r.resumed) { render(); setMessage('Tournoi repris : lance la main suivante.'); $('next-hand').hidden = false; return; }
    newHand();
  }

  async function start() {
    if (window.Casino && Casino.server && pkMode() === 'real') { startServer(); return; }
    srv = false;
    const [sb, bb] = $('set-blinds').value.split('/').map(Number);
    const n = parseInt($('set-opponents').value, 10);
    const styleSel = $('set-style').value;
    // Droit d'entrée prélevé sur le portefeuille du Casino ; les mieux classés se partagent la cagnotte
    // Entraînement : gratuit avec coach ; tournoi réel : droit d'entrée, sans coach, compte pour la progression
    const real = !!window.Casino && pkMode() === 'real';
    const buyIn = real ? parseInt($('set-buyin').value, 10) || 0 : 0;
    if (buyIn && Casino.wallet() < buyIn) { $('buyin-note').textContent = 'Ta banque est insuffisante pour ce droit d\'entrée (' + Casino.wallet().toLocaleString('fr-FR') + ' €). Passe par la banque du temps sur l\'accueil.'; return; }
    if (buyIn) {
      // un tournoi réel abandonné (page fermée) est perdu : son droit d'entrée ne revient pas
      if (Casino.session('poker')) { Casino.setStack('poker', 0); await Casino.cashOut('poker'); }
      $('start').disabled = true;
      const r = await Casino.startSession('poker', buyIn);
      $('start').disabled = false;
      if (!r || r.error) { $('buyin-note').textContent = (r && r.error) || 'Impossible de payer le droit d\'entrée.'; return; }
    }
    if (window.Casino) Casino.training = !real;
    cfg = { sb, bb, stack: bb * parseInt($('set-stack').value, 10), coach: !real, real, timer: parseInt($('set-timer').value, 10) || 0,
      rule: $('set-blindup').value, lv: {}, buyIn, players: n + 1 };
    T = Tourney.createStats(Date.now());
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

  async function newHand() {
    $('next-hand').hidden = true;
    $('summary-panel').hidden = true;
    if (srv) {
      handLog = []; vpipThisHand = false; boardShown = 0; pending = null;
      const r = await Casino.call('pk.hand');
      if (r.error) { setMessage('⚠️ ' + r.error); $('next-hand').hidden = false; return; }
      T = r.T;
      st = r.frames.shift(); srvQueue = r.frames; srvHand = r.hand;
      handStartStack = st.seats[ME].stack + st.seats[ME].total; // tapis avant les blindes
      stats.hands++;
      setMessage(r.blindMsg || '');
      loop();
      return;
    }
    // Pas de recave : un joueur sans jetons est éliminé (le moteur le laisse hors du jeu)
    // Montée des blindes au début de la main
    let blindMsg = '';
    const b = Tourney.maybeLevelUp(cfg.lv, cfg.rule, cfg.sb, cfg.bb, Date.now());
    if (b) {
      st.sb = b.sb; st.bb = b.bb;
      blindMsg = 'Les blindes augmentent : ' + b.sb + ' / ' + b.bb + ' ! ';
      st.log.push('Les blindes augmentent : ' + b.sb + ' / ' + b.bb);
    }
    handStartStack = st.seats[ME].stack;
    handLog = [];
    vpipThisHand = false;
    boardShown = 0;
    pending = null;
    if (!P.startHand(st)) { setMessage('Pas assez de joueurs.'); return; }
    stats.hands++;
    setMessage(blindMsg);
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
    if (srv) {
      if (!srvQueue.length) { busy = false; setMessage('⚠️ Connexion perdue avec le serveur : recharge la page pour reprendre.'); return; }
      st = srvQueue.shift();
      loop();
      return;
    }
    const s = st.seats[i];
    B.play(st, i, s.style);
    loop();
  }

  // ---------- Actions du joueur ----------
  async function humanAct(action) {
    if (busy || !st || st.toAct !== ME) return;
    stopTimer();
    const L = P.legal(st, ME);
    if (action.type === 'raise' && action.to >= L.maxTo) action = { type: 'allin' };
    if (srv) {
      busy = true;
      if (st.street === 'preflop' && ['call', 'raise', 'allin'].includes(action.type)) vpipThisHand = true;
      $('raise-box').hidden = true;
      const r = await Casino.call('pk.act', { action });
      if (r.error) { busy = false; setMessage('⚠️ ' + r.error); render(); return; }
      T = r.T;
      st = r.frames.shift(); srvQueue = r.frames; srvHand = r.hand;
      busy = false;
      loop();
      return;
    }
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
    if (window.Casino && !srv) {
      const cat = me.score ? Math.floor(me.score / 759375) : -1; // catégorie de la main (0 = hauteur … 8 = quinte flush)
      Casino.track('pk', { won: me.won > 0, net, cat: me.won > 0 && !r.uncontested ? cat : -1, allinWon: me.allin && me.won > 0 });
      if (net >= cfg.stack * 0.8) setTimeout(() => Casino.bigWin(net, 'GROS POT !'), 1200);
    }
    if (coachOn() && handLog.length) renderSummary(net);
    // Statistiques de la partie, éliminations et fin de partie
    const out = srv ? ((srvHand && srvHand.out) || []) : Tourney.recordHand(T, st, (i) => 's' + i, (i) => st.seats[i].name, Date.now());
    if (srv && net >= cfg.stack * 0.8) setTimeout(() => Casino.bigWin(net, 'GROS POT !'), 1200);
    if (out.length) {
      const names = out.filter((i) => i !== ME).map((i) => st.seats[i].name);
      if (names.length) setMessage(msg + ' ' + names.join(' et ') + (names.length > 1 ? ' sont éliminés.' : ' est éliminé(e).'));
    }
    const alive = st.seats.filter((x) => x.stack > 0);
    render();
    if (me.stack <= 0) {
      const place = T.eliminated.find((e) => e.key === 's' + ME).place;
      const prize = payPrize(place);
      setTimeout(() => showRecap({ won: false, title: 'Tu es éliminé', subtitle: place + 'e place sur ' + st.seats.length + (prize ? ' — tu gagnes ' + prize.toLocaleString('fr-FR') + ' € !' : ''), winnerKey: null }), 1800);
      return;
    }
    if (alive.length === 1) {
      const prize = payPrize(1);
      setTimeout(() => showRecap({ won: true, title: 'Tu as gagné la partie !', subtitle: 'Tous tes adversaires sont éliminés' + (prize ? ' — cagnotte : +' + prize.toLocaleString('fr-FR') + ' €' : ''), winnerKey: 's' + ME }), 1500);
      return;
    }
    $('next-hand').hidden = false;
  }

  // Cagnotte du tournoi : droit d'entrée × nombre de joueurs ; seul le 1er gagne à 2 ou 3 joueurs,
  // sinon 65 % / 25 % / 10 % pour les trois premiers
  function prizeFor(place) {
    if (!cfg.buyIn) return 0;
    const pool = cfg.buyIn * cfg.players;
    const split = cfg.players <= 3 ? [1] : [0.65, 0.25, 0.1];
    return Math.round(pool * (split[place - 1] || 0));
  }
  function payPrize(place) {
    if (!window.Casino) return 0;
    if (srv) { // le serveur a déjà versé la cagnotte
      const prize = (srvHand && srvHand.prize) || 0;
      if (prize >= cfg.buyIn * 3) setTimeout(() => Casino.bigWin(prize, place === 1 ? 'VICTOIRE !' : 'BELLE PLACE !'), 4500);
      return prize;
    }
    const prize = prizeFor(place);
    if (Casino.session('poker')) { Casino.setStack('poker', prize); Casino.cashOut('poker'); }
    Casino.track('pk-tourney', { place, players: cfg.players });
    if (prize >= cfg.buyIn * 3) setTimeout(() => Casino.bigWin(prize, place === 1 ? 'VICTOIRE !' : 'BELLE PLACE !'), 4500);
    return prize;
  }

  // ---------- Fin de partie : animation et récapitulatif ----------
  /**
   * opts : { won, title, subtitle, winnerKey, T (stats), names, blinds, againLabel, onAgain }
   * Utilisé aussi par le mode « Entre amis ».
   */
  function showRecap(opts) {
    const Ts = opts.T || T;
    const box = $('recap');
    box.hidden = false;
    box.classList.remove('show-stats');
    box.classList.toggle('lost', !opts.won);
    $('recap-icon').textContent = opts.won ? '🏆' : '🃏';
    $('recap-title').textContent = opts.title;
    $('recap-sub').textContent = opts.subtitle || '';
    if (window.Sfx) { if (opts.won) { Sfx.win(); setTimeout(() => Sfx.win(), 450); } else Sfx.lose(); }
    if (opts.won) confetti();
    // Statistiques
    const grid = $('recap-stats');
    grid.innerHTML = '';
    const add = (label, value) => {
      const d = document.createElement('div'); d.className = 'stat';
      const v = document.createElement('span'); v.textContent = value;
      const l = document.createElement('small'); l.textContent = label;
      d.append(v, l); grid.appendChild(d);
    };
    add('Mains jouées', Ts.hands);
    add('Durée', Tourney.duration(Date.now() - Ts.startedAt));
    add('Blindes atteintes', opts.blinds || (st ? st.sb + ' / ' + st.bb : '–'));
    add('Tapis (all-in)', Ts.allins);
    add('Abattages', Ts.showdowns);
    if (Ts.biggestPot) add('Plus gros pot', Ts.biggestPot.amount + ' (' + Ts.biggestPot.name + ')');
    // Classement
    const tb = $('recap-ranking');
    tb.innerHTML = '';
    const winnerName = opts.winnerName || (opts.winnerKey && Ts.players[opts.winnerKey] ? Ts.players[opts.winnerKey].name : '');
    const rows = opts.winnerKey ? Tourney.ranking(Ts, opts.winnerKey, winnerName)
      : Ts.eliminated.slice().sort((a, b) => a.place - b.place).map((e) => Object.assign({}, e, Ts.players[e.key] || {}));
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.key === opts.meKey || (!opts.meKey && r.key === 's' + ME)) tr.className = 'me';
      [r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : r.place + 'e', r.name, r.handsWon || 0, r.biggestWin ? '+' + r.biggestWin : '–', r.allins || 0]
        .forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    $('recap-again').textContent = opts.againLabel || 'Nouvelle partie';
    $('recap-again').onclick = () => { box.hidden = true; (opts.onAgain || backToSetup)(); };
    $('recap-close').onclick = () => { box.hidden = true; };
    setTimeout(() => box.classList.add('show-stats'), 2200);
  }

  function backToSetup() {
    st = null;
    stopTimer();
    $('game').hidden = true;
    $('setup').hidden = false;
    $('feedback').className = 'feedback empty';
    $('feedback').textContent = 'Tes décisions seront analysées ici.';
  }

  // Confettis dorés (canvas), 4 secondes
  function confetti() {
    const c = $('confetti');
    const ctx2 = c.getContext('2d');
    const W = c.width = window.innerWidth, H = c.height = window.innerHeight;
    const colors = ['#f2c14e', '#ffffff', '#c62828', '#2e7d32', '#1565c0'];
    const parts = Array.from({ length: 160 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.5, r: 4 + Math.random() * 6,
      vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4, a: Math.random() * 6, va: -0.2 + Math.random() * 0.4,
      col: colors[Math.floor(Math.random() * colors.length)],
    }));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    function frame(t) {
      ctx2.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.a += p.va; p.vy += 0.03;
        ctx2.save(); ctx2.translate(p.x, p.y); ctx2.rotate(p.a);
        ctx2.fillStyle = p.col; ctx2.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx2.restore();
      });
      if (t - t0 < 4000 && !reduce) requestAnimationFrame(frame); else ctx2.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
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
      // À l'abattage, un perdant jette ses cartes sans les montrer, sauf s'il était à tapis (cartes déjà retournées)
      const mucked = showdown && P.inHand(s) && !s.won && !st.runout && i !== ME && !st.results.uncontested;
      if ((!s.folded || i === ME) && !mucked) {
        s.cards.forEach((c) => {
          // À tapis sans plus d'enchères possibles, toutes les cartes sont retournées avant la suite du tableau
          const faceUp = i === ME || (st.runout && P.inHand(s)) || (showdown && s.shown);
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
      last.textContent = showdown && s.won ? '+' + s.won : mucked ? 'Cartes jetées' : s.last || '';
      const elim = T && T.eliminated.find((e) => e.key === 's' + i);
      if (s.stack <= 0 && elim && !(showdown && s.won)) { el.classList.add('eliminated'); last.textContent = 'Éliminé · ' + elim.place + 'e'; }
      plate.append(nm, sk, last);
      if (showdown && s.shown && s.handName && !mucked) {
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
        const bp = seatPos(i, n, i === ME ? [betR[0], betR[1] * 0.45] : betR); // au-dessus de tes cartes
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
    renderBlinds();
    $('my-stack').textContent = st.seats[ME].stack;
    renderActions();
    renderLog();
    renderStats();
  }

  function renderBlinds() {
    if (!st || !cfg) return;
    const next = Tourney.nextLevelText(cfg.lv, cfg.rule, Date.now());
    $('blinds-info').textContent = 'Niveau ' + ((cfg.lv.level || 0) + 1) + ' · Blindes ' + st.sb + ' / ' + st.bb + (next ? ' · ' + next : '');
  }
  setInterval(() => { if (st && document.body.dataset.mode !== 'multi') renderBlinds(); }, 1000);

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
    fillLog(ol, st.log);
  }
  // Historique de la main en cours : tout ce qui s'est passé depuis la distribution
  function fillLog(ol, log) {
    ol.innerHTML = '';
    let start = 0;
    log.forEach((t, k) => { if (/^Main n°/.test(t)) start = k; });
    log.slice(start).forEach((t) => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); });
    if (!ol.children.length) { const li = document.createElement('li'); li.textContent = 'La main n\'a pas encore commencé.'; ol.appendChild(li); }
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
  // Le mode vient de l'accueil : Apprentissage (gratuit, coach) ou partie réelle (droit d'entrée)
  function pkMode() { return window.Casino && !Casino.learn ? 'real' : 'train'; }
  // Droit d'entrée et cagnotte (avec le portefeuille du Casino)
  if (window.Casino) {
    const info = () => {
      const real = pkMode() === 'real';
      $('setup').querySelector('h2').textContent = real ? '💰 Tournoi réel contre des bots' : '🎓 Apprentissage : partie contre des bots (gratuite, avec le coach)';
      $('buyin-row').hidden = !real;
      $('buyin-info').hidden = !real;
      $('start').textContent = real ? (Casino.session('poker') && Casino.server ? 'Reprendre le tournoi en cours' : 'Payer et commencer le tournoi') : 'Commencer l\'entraînement';
      const b = parseInt($('set-buyin').value, 10) || 0, n = parseInt($('set-opponents').value, 10) + 1;
      if (!b) { $('buyin-info').textContent = 'Partie gratuite : pas de cagnotte. Portefeuille : ' + Casino.wallet().toLocaleString('fr-FR') + ' €.'; return; }
      const pool = b * n;
      $('buyin-info').textContent = 'Cagnotte : ' + pool.toLocaleString('fr-FR') + ' € — ' + (n <= 3 ? 'le vainqueur remporte tout.' : '1er ' + Math.round(pool * 0.65).toLocaleString('fr-FR') + ' €, 2e ' + Math.round(pool * 0.25).toLocaleString('fr-FR') + ' €, 3e ' + Math.round(pool * 0.1).toLocaleString('fr-FR') + ' €.') + ' Portefeuille : ' + Casino.wallet().toLocaleString('fr-FR') + ' €.';
    };
    ['set-buyin', 'set-opponents'].forEach((id) => $(id).addEventListener('change', info));
    document.querySelectorAll('input[name="pk-mode"]').forEach((r) => r.addEventListener('change', info));
    Casino.onChange(info);
    info();
  }
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
    backToSetup();
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
    get cfg() { return cfg; },
    record: (res, action, street) => record(res, action, street),
    showHintRes,
    renderStats,
    showRecap,
    fillLog,
    cardEl,
  };
})();
