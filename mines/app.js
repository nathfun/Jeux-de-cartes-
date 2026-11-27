/*
 * Mines — logique du jeu et interface.
 * Une manche : on mise, les mines sont placées (tirage vérifiable), on retourne des cases une par une ;
 * chaque diamant fait monter le multiplicateur ; une mine fait tout perdre ; on encaisse quand on veut.
 */
(function () {
  'use strict';
  const E = window.MinesEngine, C = E.CONFIG;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: Math.abs(n % 1) > 0.001 ? 2 : 0, maximumFractionDigits: 2 });
  const fmtM = (m) => m.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
  const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + ' %';
  const KEY = 'mines-v1';

  // ---------- Données enregistrées ----------
  const blankStats = () => ({ rounds: 0, wagered: 0, won: 0, best: 0 });
  let store = { hist: [], seeds: null, mines: 3, stats: { real: blankStats(), train: blankStats() }, bets: { real: [], train: [] } };
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw) store = Object.assign(store, raw); } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };

  async function ensureSeeds() {
    if (store.seeds && store.seeds.server) return store.seeds;
    const server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: E.randomSeed().slice(0, 16), nonce: 0, prev: store.seeds ? store.seeds.prev : null };
    persist();
    return store.seeds;
  }
  async function rotateSeeds(client) {
    if (round && round.active) { toast('Termine la manche en cours d\'abord.', true); return; }
    const old = store.seeds, server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: (client || E.randomSeed().slice(0, 16)).slice(0, 32), nonce: 0,
      prev: old ? { server: old.server, client: old.client, nonce: old.nonce } : null };
    persist(); renderFair();
  }

  // ---------- État ----------
  const S = { mode: null, stack: 0 };
  let round = null; // { bet, m, mines: Set, open: [], active, nonce }
  let busy = false;
  const statsOf = () => store.stats[S.mode === 'real' ? 'real' : 'train'];
  // partie réelle avec le serveur du Casino : les mines restent cachées sur le serveur jusqu'à la fin de la manche
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const betsKey = () => (S.mode === 'real' ? 'real' : 'train');
  function setStack(v) {
    S.stack = Math.max(0, Math.round(v * 100) / 100);
    if (S.mode === 'real' && window.Casino) Casino.setStack('mines', S.stack);
  }
  const readBet = () => Math.floor(Number($('bet').value));
  const minesN = () => store.mines;

  // ---------- Grille ----------
  const cells = [];
  for (let i = 0; i < C.SIZE; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mn-cell'; b.setAttribute('aria-label', 'Case ' + (i + 1));
    b.innerHTML = '<span class="f"></span><span class="b"></span>';
    b.addEventListener('click', () => reveal(i));
    $('grid').appendChild(b); cells.push(b);
  }
  function resetGrid() {
    cells.forEach((c) => { c.className = 'mn-cell'; c.querySelector('.b').textContent = ''; });
    $('result').hidden = true;
  }
  function showCell(i, kind, ghost) {
    const c = cells[i];
    c.querySelector('.b').textContent = kind === 'mine' ? '💣' : '💎';
    c.classList.add(kind, 'open'); if (ghost) c.classList.add('ghost');
  }
  function revealRest() {
    let d = 0;
    for (let i = 0; i < C.SIZE; i++) {
      if (cells[i].classList.contains('open')) continue;
      const kind = round.mines.has(i) ? 'mine' : 'gem';
      setTimeout(() => showCell(i, kind, true), 120 + (d++) * 28);
    }
  }

  // ---------- Manche ----------
  async function play() {
    if (!S.mode || busy || (round && round.active)) return;
    const v = readBet(), m = minesN();
    if (!(v >= C.MIN_BET && v <= maxB())) { toast('Mise entre ' + C.MIN_BET + ' et ' + maxB() + ' €.', true); return; }
    if (S.mode === 'train' && S.stack < v) setStack(Math.max(S.stack, window.Casino ? Casino.TRAIN_BANK : 1000));
    if (v > S.stack) { toast('Pas assez d\'argent sur la table.', true); return; }
    busy = true;
    if (srv()) {
      try {
        let r = await Casino.call('mn.start', { bet: v, mines: m });
        if (r.error && /déjà en cours/.test(r.error)) { await Casino.call('mn.cashout'); toast('Ta manche précédente a été réglée.'); r = await Casino.call('mn.start', { bet: v, mines: m }); }
        if (r.error) { toast(r.error, true); return; }
        S.stack = r.stack;
        round = { bet: v, m, mines: null, open: [], active: true, nonce: r.nonce, srv: true };
      } finally { busy = false; }
      resetGrid(); if (window.Sfx) Sfx.chips(); ui();
      return;
    }
    setStack(S.stack - v);
    try {
      const s = await ensureSeeds();
      s.nonce++; persist();
      const mines = await E.minesFromSeeds(s.server, s.client, s.nonce, m);
      round = { bet: v, m, mines: new Set(mines), open: [], active: true, nonce: s.nonce };
    } finally { busy = false; }
    resetGrid();
    if (window.Sfx) Sfx.chips();
    renderFair(); ui();
  }
  async function reveal(i) {
    if (!round || !round.active || busy || cells[i].classList.contains('open')) return;
    if (round.srv) {
      busy = true; cells[i].classList.add('wait');
      let r;
      try { r = await Casino.call('mn.reveal', { cell: i }); } finally { busy = false; cells[i].classList.remove('wait'); }
      if (r.error) { toast(r.error, true); return; }
      if (r.over) round.mines = new Set(r.mines);
      if (!r.gem) { boomAt(i); S.stack = r.stack; finish(0); return; }
      gemAt(i);
      if (r.over) { round.active = false; S.stack = r.stack; if (window.Sfx && Sfx.cashout) Sfx.cashout(); revealRest(); finish(r.payout, r.mult); return; }
      ui();
      return;
    }
    if (round.mines.has(i)) {
      round.active = false;
      showCell(i, 'mine'); cells[i].classList.add('boom');
      $('grid').classList.add('shake'); setTimeout(() => $('grid').classList.remove('shake'), 520);
      if (window.Sfx && Sfx.explosion) Sfx.explosion();
      revealRest();
      finish(0);
      return;
    }
    round.open.push(i);
    showCell(i, 'gem');
    if (window.Sfx && Sfx.gem) Sfx.gem(round.open.length);
    const mu = $('mult'); mu.classList.remove('bump'); void mu.offsetWidth; mu.classList.add('bump');
    if (round.open.length >= E.maxReveals(round.m)) { cashout(); return; }
    ui();
  }
  function boomAt(i) {
    round.active = false;
    showCell(i, 'mine'); cells[i].classList.add('boom');
    $('grid').classList.add('shake'); setTimeout(() => $('grid').classList.remove('shake'), 520);
    if (window.Sfx && Sfx.explosion) Sfx.explosion();
    revealRest();
  }
  function gemAt(i) {
    round.open.push(i);
    showCell(i, 'gem');
    if (window.Sfx && Sfx.gem) Sfx.gem(round.open.length);
    const mu = $('mult'); mu.classList.remove('bump'); void mu.offsetWidth; mu.classList.add('bump');
  }
  async function cashout() {
    if (!round || !round.active || !round.open.length || busy) return;
    if (round.srv) {
      busy = true;
      let r;
      try { r = await Casino.call('mn.cashout'); } finally { busy = false; }
      if (r.error) { toast(r.error, true); return; }
      round.active = false; round.mines = new Set(r.mines || []); S.stack = r.stack;
      if (window.Sfx && Sfx.cashout) Sfx.cashout();
      revealRest();
      finish(r.payout, r.mult);
      return;
    }
    round.active = false;
    const res = E.settle(round.bet, round.m, round.open.length);
    setStack(S.stack + res.payout);
    if (window.Sfx && Sfx.cashout) Sfx.cashout();
    revealRest();
    finish(res.payout, res.mult);
  }
  function randomCell() {
    if (!round || !round.active) return;
    const free = cells.map((c, i) => i).filter((i) => !cells[i].classList.contains('open'));
    if (free.length) reveal(free[Math.floor(Math.random() * free.length)]);
  }
  // Fin de manche : statistiques, progression, affichage du résultat
  function finish(payout, mult) {
    const r = round, net = Math.round((payout - r.bet) * 100) / 100, won = payout > 0;
    const st = statsOf();
    st.rounds++; st.wagered += r.bet; st.won += payout;
    if (won && mult > st.best) st.best = mult;
    store.hist.unshift(won ? mult : 0); store.hist = store.hist.slice(0, 24);
    store.bets[betsKey()].unshift({ amount: r.bet, m: r.m, k: r.open.length, mult: won ? mult : 0, net, at: Date.now() });
    store.bets[betsKey()] = store.bets[betsKey()].slice(0, 30);
    persist();
    if (window.Casino && S.mode === 'real' && !Casino.server) Casino.track('mn', { bet: r.bet, net, mines: r.m, reveals: r.open.length, mult: won ? mult : 0, bust: !won, clear: r.open.length >= E.maxReveals(r.m), firstBust: !won && r.open.length === 0 });
    const box = $('result');
    box.className = 'mn-result' + (won ? '' : ' lose');
    box.innerHTML = '';
    box.append(won ? fmtM(mult) : '💥 Boum !');
    const sm = document.createElement('small'); sm.textContent = won ? '+' + fmt(payout) + ' €' : '−' + fmt(r.bet) + ' €'; box.appendChild(sm);
    box.hidden = false;
    setTimeout(() => { if (!round || !round.active) box.hidden = true; }, 2200);
    if (won && mult >= 10 && window.Casino) setTimeout(() => Casino.bigWin(payout, 'MINES ' + fmtM(mult) + ' !'), 300);
    renderHistory(); renderStats(); ui();
  }

  // ---------- Actions ----------
  $('play-btn').addEventListener('click', play);
  $('cash-btn').addEventListener('click', cashout);
  $('random-btn').addEventListener('click', randomCell);
  document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => { $('bet').value = b.dataset.v; if (window.Sfx) Sfx.chips(); ui(); }));
  $('bet-half').addEventListener('click', () => { $('bet').value = Math.max(C.MIN_BET, Math.floor(readBet() / 2)); ui(); });
  $('bet-double').addEventListener('click', () => { $('bet').value = Math.min(maxB(), Math.max(C.MIN_BET, readBet() * 2)); ui(); });
  $('bet').addEventListener('input', () => ui());
  $('bet').addEventListener('change', () => { const v = readBet(); $('bet').value = Math.min(maxB(), Math.max(C.MIN_BET, isFinite(v) ? v : C.MIN_BET)); ui(); });
  const setMines = (v) => { if (round && round.active) return; store.mines = Math.max(1, Math.min(24, Number(v) || 3)); persist(); ui(); renderAides(); };
  $('mines').addEventListener('input', (e) => setMines(e.target.value));
  document.querySelectorAll('#mines-quick button').forEach((b) => b.addEventListener('click', () => setMines(b.dataset.v)));
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    if (round && round.active && round.open.length) cashout(); else play();
  });

  // ---------- Affichage ----------
  let toastTimer = null;
  function toast(text, err) {
    const t = $('toast'); t.textContent = text; t.className = 'stage-toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  // mise maximale : salon VIP en partie réelle (le serveur vérifie aussi)
  function maxB() { return (window.Casino && S.mode === 'real' ? Casino.maxBet() : 500); }
  let maxShown = null;
  function applyMax() {
    const m = maxB(); if (m === maxShown) return; maxShown = m;
    $('bet').max = m;
    if (readBet() > m) $('bet').value = m;
    document.querySelectorAll('#quick button').forEach((b) => { b.disabled = Number(b.dataset.v) > m; b.title = b.disabled ? 'Mise maximale à ce palier : ' + m + ' €' : ''; });
    let hint = document.getElementById('vip-hint');
    if (!hint) { hint = document.createElement('div'); hint.id = 'vip-hint'; hint.className = 'vip-hint'; $('quick').after(hint); }
    if (window.Casino && S.mode === 'real') { hint.textContent = '🕴️ Palier ' + ((Casino.run || {}).palier || 1) + ' · mise max ' + m.toLocaleString('fr-FR') + ' € (elle monte avec les paliers)'; hint.hidden = false; }
    else hint.hidden = true;
  }
  function ui() {
    if (!S.mode) return;
    applyMax();
    const live = !!(round && round.active), m = live ? round.m : minesN(), k = live ? round.open.length : 0;
    $('grid').classList.toggle('live', live);
    setText($('mines-n'), String(minesN()));
    $('mines').value = minesN(); $('mines').disabled = live;
    document.querySelectorAll('#mines-quick button').forEach((b) => { b.classList.toggle('on', Number(b.dataset.v) === minesN()); b.disabled = live; });
    setText($('mult'), fmtM(E.multAt(m, k)));
    const g = $('gain');
    if (live && k) { setText(g, fmt(E.settle(round.bet, m, k).payout) + ' €'); g.className = 'pos'; } else { setText(g, live ? fmt(round.bet) + ' €' : '–'); g.className = ''; }
    setText($('next'), k < E.maxReveals(m) ? fmtM(E.multAt(m, k + 1)) + ' · ' + pct(E.nextSafe(m, k)) : '–');
    const v = readBet() || 0;
    setText($('potential'), fmt(Math.min(C.MAX_WIN, v * E.multAt(minesN(), E.maxReveals(minesN())))) + ' €');
    $('play-btn').hidden = live; $('cash-btn').hidden = !live; $('random-btn').hidden = !live;
    $('cash-btn').disabled = !k;
    $('cash-btn').innerHTML = k ? 'ENCAISSER<small>' + fmt(E.settle(round.bet, m, k).payout) + ' €</small>' : 'Retourne une case…';
    $('play-btn').innerHTML = 'JOUER<small style="display:block;font-size:.85rem;font-weight:700;letter-spacing:0;opacity:.85">' + fmt(v) + ' € · ' + minesN() + ' mine' + (minesN() > 1 ? 's' : '') + '</small>';
    setText($('stack'), fmt(S.stack) + ' €');
    $('end-btn').disabled = live;
    document.querySelectorAll('#quick button').forEach((q) => q.classList.toggle('on', Number(q.dataset.v) === readBet()));
    showWallet();
    renderAides();
  }
  function renderHistory() {
    const h = $('history'); h.innerHTML = '';
    store.hist.slice(0, 24).forEach((x) => { const s = document.createElement('span'); s.className = 'hchip ' + (x === 0 ? 'low' : x < 2 ? 'mid' : x < 10 ? 'high' : 'epic'); s.textContent = x === 0 ? '💥' : fmtM(x); h.appendChild(s); });
  }
  function renderStats() {
    const st = statsOf(), net = st.won - st.wagered;
    setText($('stats-mode'), S.mode === 'real' ? '· parties réelles' : '· apprentissage');
    setText($('s-rounds'), String(st.rounds));
    setText($('s-wagered'), fmt(st.wagered) + ' €');
    setText($('s-won'), fmt(st.won) + ' €');
    const n = $('s-net'); setText(n, (net >= 0 ? '+' : '−') + fmt(Math.abs(net)) + ' €'); n.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    setText($('s-best'), st.best ? 'Meilleur encaissement : ' + fmtM(st.best) + (st.wagered ? ' · retour réel : ' + Math.round(st.won / st.wagered * 100) + ' % (en moyenne, le jeu rend 97 %)' : '') : '');
    const ol = $('my-bets'); ol.innerHTML = '';
    const list = store.bets[betsKey()].slice(0, 15);
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Aucune manche pour l\'instant.'; ol.appendChild(li); }
    list.forEach((x) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = fmt(x.amount) + ' € · ' + (x.mult ? fmtM(x.mult) : '💥 mine');
      const c = document.createElement('span'); c.className = 'muted'; c.textContent = x.m + ' mine' + (x.m > 1 ? 's' : '') + ' · ' + x.k + ' 💎';
      const r = document.createElement('span'); r.className = x.net >= 0 ? 'w' : 'l'; r.textContent = (x.net >= 0 ? '+' : '−') + fmt(Math.abs(x.net)) + ' €';
      li.append(a, c, r); ol.appendChild(li);
    });
  }
  let lastAid = '';
  function renderAides() {
    if (S.mode !== 'train') return;
    const live = !!(round && round.active), m = live ? round.m : minesN(), k = live ? round.open.length : 0;
    const key = m + ':' + k + ':' + live; if (key === lastAid) return; lastAid = key;
    const parts = [
      'Avec <b>' + m + ' mine' + (m > 1 ? 's' : '') + '</b> sur 25 cases, la prochaine case est sûre dans <b>' + pct(E.nextSafe(m, k)) + '</b> des cas.',
      'Chance de retourner <b>' + Math.min(3, E.maxReveals(m)) + ' diamants</b> d\'affilée : <b>' + pct(E.probSafe(m, Math.min(3, E.maxReveals(m)))) + '</b> pour un gain de <b>' + fmtM(E.multAt(m, Math.min(3, E.maxReveals(m)))) + '</b>.',
      'Chaque multiplicateur vaut <b>0,97 ÷ la chance d\'en arriver là</b> : quel que soit ton choix (nombre de mines, moment où tu encaisses), le jeu rend <b>97 %</b> en moyenne.',
      'Plus de mines = de gros multiplicateurs très vite, mais une chance sur deux (ou pire) d\'exploser dès les premières cases.',
    ];
    if (live && k) parts.unshift('Si tu encaisses maintenant : <b>+' + fmt(E.settle(round.bet, m, k).net) + ' €</b>. Si tu continues, tu as <b>' + pct(1 - E.nextSafe(m, k)) + '</b> de risque de tout perdre.');
    $('aides-body').innerHTML = parts.map((x) => '<div class="tip">' + x + '</div>').join('');
  }
  function renderFair() {
    const s = store.seeds;
    $('pf-hash').textContent = s ? s.hash : '–';
    if (document.activeElement !== $('pf-client')) $('pf-client').value = s ? s.client : '';
    $('pf-nonce').textContent = s ? String(s.nonce) : '0';
    $('pf-prev').textContent = s && s.prev ? s.prev.server + ' (client « ' + s.prev.client + ' », manches 1 à ' + s.prev.nonce + ')' : '–';
  }
  $('pf-rotate').addEventListener('click', () => rotateSeeds($('pf-client').value.trim()));
  $('pf-check').addEventListener('click', async () => {
    const seed = $('pf-v-seed').value.trim(), cl = $('pf-v-client').value.trim(), n = Number($('pf-v-nonce').value), m = Number($('pf-v-mines').value);
    if (!seed || !cl || !(n >= 1) || !(m >= 1 && m <= 24)) { $('pf-result').textContent = 'Remplis les champs (mines entre 1 et 24).'; return; }
    const list = await E.minesFromSeeds(seed, cl, n, m);
    $('pf-result').textContent = 'Mines sur les cases : ' + list.map((x) => x + 1).join(', ') + ' (numérotées de 1 à 25, ligne par ligne)';
  });

  // ---------- Début et fin de partie ----------
  function showWallet() {
    setText($('bank-label'), 'Caisse'); setText($('wallet'), window.Casino ? fmt(Casino.wallet()) : '–');
    setText($('stack-label'), S.mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table');
  }
  function startGame(mode, amount) {
    S.mode = mode;
    if (window.Casino) Casino.training = mode === 'train';
    S.stack = amount;
    document.body.classList.toggle('real-mode', mode === 'real');
    $('setup').hidden = true; $('game').hidden = false;
    const badge = $('mode-badge'); badge.hidden = false;
    badge.className = 'mode-badge' + (mode === 'real' ? ' real' : '');
    badge.textContent = mode === 'real' ? '🕴️ La Dette · ta caisse · sans aides' : '🎓 Apprentissage · crédit illimité, aides et conseils';
    $('end-btn').hidden = mode === 'train';
    resetGrid(); renderHistory(); renderStats(); lastAid = ''; ui();
    ensureSeeds().then(renderFair);
  }
  async function endSession() {
    if (round && round.active) { toast('Termine la manche en cours d\'abord.', true); return; }
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('mines');
      if (r && r.error) { toast(r.error, true); return; }
      const diff = r ? r.diff : 0;
      msg = 'Tu encaisses ' + fmt(r ? r.end : S.stack) + ' € (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' € par rapport à la somme apportée).';
      Casino.toast('Encaissé !', msg, '💰', diff > 0 ? 'gold' : '');
    }
    S.mode = null;
    $('game').hidden = true; $('setup').hidden = false;
    renderPicker(msg); showWallet();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 10000); return; }
    Casino.modePicker(box, { game: 'mines', min: C.MIN_BET, suggest: 100, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  // Quitter la page en pleine manche : on encaisse ce qui est gagné (ou on rend la mise si aucune case n'est retournée)
  window.addEventListener('pagehide', () => {
    if (!round || !round.active || !S.mode) return;
    if (round.srv) return; // le serveur garde la manche : elle sera réglée à la prochaine visite
    if (round.open.length) cashout(); else { round.active = false; setStack(S.stack + round.bet); }
  });
  renderPicker(); showWallet();
  if (window.Casino) Casino.onChange(() => showWallet());
  window.Mines = { get state() { return { S, round, store }; }, play, reveal, cashout };
})();
