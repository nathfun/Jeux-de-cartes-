/*
 * Plinko — logique du jeu et interface.
 *
 * Chaque bille est une mise indépendante : la mise est retirée de la table quand on la lâche, son chemin
 * est tiré tout de suite (format « Provably Fair » : server seed / client seed / nonce), et le gain est
 * crédité quand elle arrive dans sa case. On peut lâcher plusieurs billes à la fois, ou en automatique.
 * La logique avance sur l'horloge (performance.now), pas sur les images de l'animation.
 */
(function () {
  'use strict';
  const E = window.PlinkoEngine, C = E.CONFIG;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const fmtM = (m) => String(m).replace('.', ',') + '×';
  const now = () => performance.now();
  const KEY = 'plinko-v1';
  const MAX_IN_PLAY = 40;

  // ---------- Données enregistrées sur l'appareil ----------
  const blankStats = () => ({ rounds: 0, wagered: 0, won: 0, best: 0 });
  let store = { hist: [], seeds: null, rows: 12, risk: 'medium', stats: { real: blankStats(), train: blankStats() }, bets: { real: [], train: [] } };
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw) store = Object.assign(store, raw); } catch (e) { /* ignore */ }
  if (!C.ROWS.includes(store.rows)) store.rows = 12;
  if (!C.RISKS.includes(store.risk)) store.risk = 'medium';
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };

  // ---------- Équité vérifiable ----------
  async function ensureSeeds() {
    if (store.seeds && store.seeds.server) return store.seeds;
    const server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: E.randomSeed().slice(0, 16), nonce: 0, prev: store.seeds ? store.seeds.prev : null };
    persist();
    return store.seeds;
  }
  async function rotateSeeds(client) {
    if (inPlay().length) { toast('Attends que toutes les billes soient tombées.', true); return; }
    const old = store.seeds, server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: (client || E.randomSeed().slice(0, 16)).slice(0, 32), nonce: 0,
      prev: old ? { server: old.server, client: old.client, nonce: old.nonce } : null };
    persist(); renderFair();
  }

  // ---------- État ----------
  const S = { mode: null, stack: 0 };
  let balls = [];          // { id, bet, rows, risk, path, slot, mult, payout, at, landAt, settled }
  let seq = 0;
  const inPlay = () => balls.filter((b) => !b.settled);
  // partie réelle avec le serveur du Casino : c'est lui qui tire le chemin de chaque bille et tient la table
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const statsOf = () => store.stats[S.mode === 'real' ? 'real' : 'train'];
  const betsKey = () => (S.mode === 'real' ? 'real' : 'train');
  function setStack(v) {
    S.stack = Math.max(0, Math.round(v * 100) / 100);
    if (S.mode === 'real' && window.Casino) Casino.setStack('plinko', S.stack);
  }

  // ---------- Lâcher une bille ----------
  const readBet = () => Math.floor(Number($('bet').value));
  let dropping = 0;
  async function drop() {
    if (!S.mode) return false;
    const v = readBet();
    if (!(v >= C.MIN_BET && v <= C.MAX_BET)) { toast('Mise entre ' + C.MIN_BET + ' et ' + C.MAX_BET + ' € par bille.', true); return false; }
    if (inPlay().length + dropping >= MAX_IN_PLAY) { toast('Déjà ' + MAX_IN_PLAY + ' billes sur le plateau !', true); return false; }
    if (S.mode === 'train' && S.stack < v) setStack(Math.max(S.stack, window.Casino ? Casino.TRAIN_BANK : 10000));
    if (v > S.stack) { toast('Pas assez d\'argent sur la table.', true); return false; }
    setStack(S.stack - v); // la mise est engagée tout de suite
    dropping++;
    const rows = store.rows, risk = store.risk;
    try {
      let nonce, path, slot, res, srvStack = null;
      if (srv()) {
        const r = await Casino.call('pl.drop', { bet: v, rows, risk });
        if (r.error) { setStack(S.stack + v); toast(r.error, true); return false; }
        nonce = r.nonce; path = r.path; slot = r.slot; res = { mult: r.mult, payout: r.payout, net: r.net };
        srvStack = r.stack; // la table du serveur, gains de toutes les billes compris
      } else {
        const s = await ensureSeeds();
        s.nonce++; nonce = s.nonce; persist();
        path = await E.pathFromSeeds(s.server, s.client, nonce, rows);
        slot = E.slotOf(path); res = E.settle(v, rows, risk, slot);
      }
      const at = now();
      const b = { id: ++seq, nonce, bet: v, rows, risk, path, slot, mult: res.mult, payout: res.payout, net: res.net, at, landAt: at + window.PlinkoScene.durationOf(rows), settled: false,
        label: res.mult >= 1 ? '+' + fmt(res.payout) + ' €' : fmtM(res.mult) };
      balls.push(b);
      // serveur : la table affichée = celle du serveur moins les gains des billes encore en l'air
      if (srvStack !== null) S.stack = Math.round((srvStack - inPlay().reduce((x, q) => x + q.payout, 0)) * 100) / 100;
      scene.drop(b);
      if (window.Sfx) Sfx.chips();
    } finally { dropping--; }
    ui();
    return true;
  }

  // Une bille arrive dans sa case : gain crédité, statistiques, progression
  function settle(b) {
    if (b.settled) return;
    b.settled = true;
    setStack(S.stack + b.payout);
    store.hist.unshift(b.mult); store.hist = store.hist.slice(0, 24);
    const st = statsOf();
    st.rounds++; st.wagered += b.bet; st.won += b.payout;
    if (b.mult > st.best) st.best = b.mult;
    store.bets[betsKey()].unshift({ amount: b.bet, mult: b.mult, rows: b.rows, risk: b.risk, net: b.net, at: Date.now() });
    store.bets[betsKey()] = store.bets[betsKey()].slice(0, 30);
    persist();
    if (window.Sfx && Sfx.plinkLand) Sfx.plinkLand(b.mult);
    if (window.Casino && S.mode === 'real' && !Casino.server) Casino.track('pl', { bet: b.bet, net: b.net, mult: b.mult, edge: b.slot === 0 || b.slot === b.rows });
    if (b.mult >= 25 && window.Casino) setTimeout(() => Casino.bigWin(b.payout, 'PLINKO ' + fmtM(b.mult) + ' !'), 250);
    const last = $('last');
    last.textContent = fmtM(b.mult) + (b.mult >= 1 ? ' · +' + fmt(b.payout) + ' €' : '');
    last.className = b.mult >= 10 ? 'epic' : b.mult >= 1 ? 'win' : 'lose';
    renderHistory(); renderStats();
  }
  function settleAll() { inPlay().forEach(settle); }

  // Boucle logique : indépendante de l'affichage
  function tick() {
    if (!S.mode) return;
    const t = now();
    let changed = false;
    balls.forEach((b) => { if (!b.settled && t >= b.landAt) { settle(b); changed = true; } });
    if (balls.length > 80) balls = balls.filter((b) => !b.settled);
    if (changed) ui();
  }
  setInterval(tick, 50);

  // ---------- Automatique ----------
  let autoLeft = 0, autoTimer = null;
  function stopAuto() { autoLeft = 0; clearInterval(autoTimer); autoTimer = null; ui(); }
  function startAuto() {
    autoLeft = Number($('auto-n').value) || 10;
    clearInterval(autoTimer);
    autoTimer = setInterval(async () => {
      if (!S.mode || autoLeft <= 0) { stopAuto(); return; }
      if (inPlay().length + dropping >= MAX_IN_PLAY) return;
      const ok = await drop();
      if (!ok) { stopAuto(); return; }
      autoLeft--;
      if (autoLeft <= 0) stopAuto(); else ui();
    }, 280);
    ui();
  }

  // ---------- Actions du joueur ----------
  $('drop-btn').addEventListener('click', () => drop());
  $('auto-btn').addEventListener('click', () => (autoTimer ? stopAuto() : startAuto()));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); drop(); }
  });
  document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => { $('bet').value = b.dataset.v; if (window.Sfx) Sfx.chips(); ui(); }));
  $('bet-half').addEventListener('click', () => { $('bet').value = Math.max(C.MIN_BET, Math.floor(readBet() / 2)); ui(); });
  $('bet-double').addEventListener('click', () => { $('bet').value = Math.min(C.MAX_BET, Math.max(C.MIN_BET, readBet() * 2)); ui(); });
  $('bet').addEventListener('input', () => ui());
  $('bet').addEventListener('change', () => { const v = readBet(); $('bet').value = Math.min(C.MAX_BET, Math.max(C.MIN_BET, isFinite(v) ? v : C.MIN_BET)); ui(); });
  function pick(kind, v) {
    if (inPlay().length || autoTimer) { toast('Attends que les billes soient tombées pour changer le plateau.', true); return; }
    store[kind] = kind === 'rows' ? Number(v) : v; persist();
    applyBoard(); ui(); renderAides();
  }
  document.querySelectorAll('#risk button').forEach((b) => b.addEventListener('click', () => pick('risk', b.dataset.v)));
  document.querySelectorAll('#rows button').forEach((b) => b.addEventListener('click', () => pick('rows', b.dataset.v)));

  // ---------- Affichage ----------
  let toastTimer = null;
  function toast(text, err) {
    const t = $('toast'); t.textContent = text; t.className = 'stage-toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  function applyBoard() {
    scene.setBoard(store.rows, store.risk, E.table(store.rows, store.risk));
    document.querySelectorAll('#risk button').forEach((b) => b.classList.toggle('on', b.dataset.v === store.risk));
    document.querySelectorAll('#rows button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === store.rows));
  }
  function ui() {
    if (!S.mode) return;
    const n = inPlay().length, busy = n > 0 || !!autoTimer;
    const v = readBet() || 0, maxM = E.table(store.rows, store.risk)[0];
    $('drop-btn').innerHTML = 'LÂCHER<span class="drop-sub">' + fmt(v) + ' € par bille</span>';
    setText($('potential'), fmt(Math.min(C.MAX_WIN, v * maxM)) + ' € (' + fmtM(maxM) + ')');
    setText($('stack'), fmt(S.stack) + ' €');
    const ip = $('inplay'); ip.hidden = !n; setText(ip, n + ' bille' + (n > 1 ? 's' : '') + ' en jeu');
    const ab = $('auto-btn'); ab.classList.toggle('on', !!autoTimer); setText(ab, autoTimer ? '■ Stop (' + autoLeft + ')' : '▶ Auto');
    $('auto-n').disabled = !!autoTimer;
    document.querySelectorAll('#risk button, #rows button').forEach((b) => { b.disabled = busy && !b.classList.contains('on'); });
    $('end-btn').disabled = busy;
    document.querySelectorAll('#quick button').forEach((q) => q.classList.toggle('on', Number(q.dataset.v) === readBet()));
    showWallet();
  }
  function renderHistory() {
    const h = $('history'); h.innerHTML = '';
    store.hist.slice(0, 24).forEach((m) => { const s = document.createElement('span'); s.className = 'hchip ' + E.tier(m); s.textContent = fmtM(m); h.appendChild(s); });
  }
  function renderStats() {
    const st = statsOf(), net = st.won - st.wagered;
    setText($('stats-mode'), S.mode === 'real' ? '· parties réelles' : '· apprentissage');
    setText($('s-rounds'), String(st.rounds));
    setText($('s-wagered'), fmt(st.wagered) + ' €');
    setText($('s-won'), fmt(st.won) + ' €');
    const n = $('s-net'); setText(n, (net >= 0 ? '+' : '−') + fmt(Math.abs(net)) + ' €'); n.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    setText($('s-best'), st.best ? 'Meilleure case : ' + fmtM(st.best) + (st.wagered ? ' · retour réel : ' + Math.round(st.won / st.wagered * 100) + ' % (en moyenne, le jeu rend 97 %)' : '') : '');
    const ol = $('my-bets'); ol.innerHTML = '';
    const list = store.bets[betsKey()].slice(0, 15);
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Aucune bille pour l\'instant.'; ol.appendChild(li); }
    list.forEach((x) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = fmt(x.amount) + ' € · ' + fmtM(x.mult);
      const c = document.createElement('span'); c.className = 'muted'; c.textContent = x.rows + ' rangées · ' + (E.RISK_NAMES[x.risk] || '').toLowerCase();
      const r = document.createElement('span'); r.className = x.net >= 0 ? 'w' : 'l'; r.textContent = (x.net >= 0 ? '+' : '−') + fmt(Math.abs(x.net)) + ' €';
      li.append(a, c, r); ol.appendChild(li);
    });
  }
  function renderAides() {
    if (S.mode !== 'train') return;
    const rows = store.rows, risk = store.risk, t = E.table(rows, risk), p = E.probs(rows);
    const pct = (x) => (x * 100 >= 1 ? (x * 100).toFixed(1) : (x * 100).toPrecision(2)).replace('.', ',') + ' %';
    const lose = t.reduce((a, m, k) => a + (m < 1 ? p[k] : 0), 0);
    const edge = p[0] * 2;
    const parts = [
      'À chaque picot, la bille part à gauche ou à droite avec <b>une chance sur deux</b>. Elle finit donc le plus souvent <b>au centre</b> : c\'est la courbe en cloche.',
      'Avec ce plateau (' + rows + ' rangées, risque ' + E.RISK_NAMES[risk].toLowerCase() + '), le jeu rend <b>' + (E.rtpOf(rows, risk) * 100).toFixed(1).replace('.', ',') + ' %</b> des mises en moyenne. Aucun réglage ne bat l\'avantage du casino.',
      'Une bille sur ' + Math.round(1 / edge).toLocaleString('fr-FR') + ' environ tombe dans une case du bord (<b>' + fmtM(t[0]) + '</b>). Tu perds une partie de ta mise dans <b>' + pct(lose) + '</b> des cas (cases sous ×1).',
      'Plus de rangées et plus de risque = des gains énormes mais très rares, et un centre qui rend peu. Moins de risque = des résultats plus réguliers.',
    ];
    let rowsHtml = '';
    for (let k = 0; k <= rows / 2; k++) rowsHtml += '<tr><td>' + (k === 0 ? 'Bords' : k === rows / 2 ? 'Centre' : 'Case ' + (k + 1)) + '</td><td>' + fmtM(t[k]) + '</td><td>' + pct(k === rows / 2 ? p[k] : p[k] * 2) + '</td></tr>';
    $('aides-body').innerHTML = parts.map((x) => '<div class="tip">' + x + '</div>').join('')
      + '<table class="odds"><thead><tr><th>Case</th><th>Gain</th><th>Chance</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
  }
  function renderFair() {
    const s = store.seeds;
    $('pf-hash').textContent = s ? s.hash : '–';
    if (document.activeElement !== $('pf-client')) $('pf-client').value = s ? s.client : '';
    $('pf-nonce').textContent = s ? String(s.nonce) : '0';
    $('pf-prev').textContent = s && s.prev ? s.prev.server + ' (client « ' + s.prev.client + ' », billes 1 à ' + s.prev.nonce + ')' : '–';
    $('pf-note').textContent = window.Casino && Casino.server && S.mode === 'real'
      ? 'Parties réelles : c\'est le serveur du Casino qui tire chaque bille avec ses propres seeds.'
      : 'Les seeds sont générées sur ton appareil : la vérification montre que chaque bille suit bien le chemin tiré.';
  }
  $('pf-rotate').addEventListener('click', () => rotateSeeds($('pf-client').value.trim()));
  $('pf-check').addEventListener('click', async () => {
    const seed = $('pf-v-seed').value.trim(), cl = $('pf-v-client').value.trim(), n = Number($('pf-v-nonce').value), rows = Number($('pf-v-rows').value) || store.rows;
    if (!seed || !cl || !(n >= 1) || !(rows >= 8 && rows <= 16)) { $('pf-result').textContent = 'Remplis les champs (rangées entre 8 et 16).'; return; }
    const path = await E.pathFromSeeds(seed, cl, n, rows);
    $('pf-result').textContent = 'Chemin : ' + path.map((d) => (d ? 'D' : 'G')).join('') + ' → case ' + (E.slotOf(path) + 1) + ' sur ' + (rows + 1);
  });

  // Scène
  const scene = new window.PlinkoScene($('scene'));
  const applySkin = () => { if (window.Casino && Casino.itemOf) scene.skin = Casino.itemOf('ball', Casino.equipped('ball')); };
  applySkin();
  if (window.Casino) Casino.onChange(applySkin);
  let lastPeg = 0;
  scene.start((row, rows) => { const t = now(); if (t - lastPeg > 35 && window.Sfx && Sfx.peg) { lastPeg = t; Sfx.peg(row, rows); } });
  applyBoard();

  // ---------- Début et fin de partie ----------
  function showWallet() {
    setText($('bank-label'), 'Banque'); setText($('wallet'), window.Casino ? fmt(Casino.wallet()) : '–');
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
    badge.textContent = mode === 'real' ? '💰 Partie réelle · ta banque · sans aides' : '🎓 Apprentissage · crédit illimité, aides et conseils';
    $('end-btn').hidden = mode === 'train';
    renderHistory(); renderStats(); renderFair(); renderAides();
    setTimeout(() => scene.resize(), 0);
    ensureSeeds().then(renderFair);
    ui();
  }
  async function endSession() {
    if (inPlay().length || autoTimer) { toast('Attends que toutes les billes soient tombées.', true); return; }
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('plinko');
      if (r && r.error) { toast(r.error, true); return; }
      const diff = r ? r.diff : 0;
      msg = 'Tu encaisses ' + fmt(r ? r.end : S.stack) + ' € (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' € par rapport à la somme apportée).';
      Casino.toast('Encaissé !', msg, '💰', diff > 0 ? 'gold' : '');
    }
    S.mode = null;
    $('game').hidden = true; $('setup').hidden = false;
    renderPicker(msg);
    showWallet();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 10000); return; }
    Casino.modePicker(box, { game: 'plinko', min: C.MIN_BET, suggest: 500, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  // Quitter la page avec des billes en l'air : leur chemin est déjà tiré, on règle tout de suite
  window.addEventListener('pagehide', () => { if (S.mode) settleAll(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.mode) settleAll(); });
  renderPicker();
  showWallet();
  if (window.Casino) Casino.onChange(() => showWallet());
  // pour les tests
  window.Plinko = { get state() { return { S, balls, store }; }, drop, settleAll };
})();
