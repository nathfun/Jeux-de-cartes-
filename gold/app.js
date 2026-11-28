/*
 * « Ruée vers l'Or » — interface et animations.
 * En partie réelle avec le serveur, c'est le serveur qui tire la grille et joue tout le bonus (opération gd.spin) :
 * l'app ne fait qu'animer le résultat. Sinon (apprentissage, mode local), le même moteur tourne ici.
 */
(function () {
  'use strict';
  const E = window.GoldEngine;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: Math.abs(n % 1) > 0.001 ? 2 : 0, maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const crypto32 = new Uint32Array(1);
  const rng = () => { crypto.getRandomValues(crypto32); return crypto32[0] / 4294967296; };
  const ICON = (s) => E.SYMBOLS[s].icon;
  const RANDOM_POOL = ['P', 'S', 'T', 'M', 'X', 'C', 'L', 'R', 'N', 'W'];

  const S = { mode: null, stack: 0, betIx: 1, busy: false, auto: 0, stats: { spins: 0, bet: 0, won: 0, bonus: 0, best: 0 } };
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  // Le Parrain : pas de mise sous le minimum du palier (10 € au palier 1)
  const minIx = () => { if (!(window.Casino && S.mode === 'real' && Casino.minBet)) return 0; const m = Casino.minBet('gold'); const i = E.BETS.findIndex((b) => b >= m); return i < 0 ? 0 : i; };
  const bet = () => { if (S.betIx < minIx()) S.betIx = minIx(); return E.BETS[S.betIx]; };
  const turbo = () => $('turbo').checked;

  // ---------- Grille ----------
  const cells = [];
  for (let i = 0; i < E.CELLS; i++) { const d = document.createElement('div'); d.className = 'cell'; d.innerHTML = '<span></span><b class="val"></b>'; $('grid').appendChild(d); cells.push(d); }
  function paint(i, g, b) {
    const c = cells[i], sp = c.firstChild, val = c.lastChild;
    c.className = 'cell';
    val.textContent = '';
    if (!g) { c.classList.add('empty'); sp.textContent = ''; return; }
    if (g.s === 'N' || g.n || g.v !== undefined) {
      const n = g.n || g;
      c.classList.add('nug');
      if (n.kind === 'wagonDone' || n.kind === 'wagon') { sp.textContent = '🚃'; val.textContent = fmt(n.v * b) + ' €'; return; }
      if (n.kind === 'boostDone' || n.kind === 'boost') { sp.textContent = '💥'; val.textContent = '×2'; return; }
      sp.textContent = '🟡';
      if (n.jp) { c.classList.add('jp-' + n.jp); val.textContent = E.JACKPOTS[n.jp].name; } else val.textContent = fmt(n.v * b) + ' €';
      return;
    }
    if (g.s === 'W') c.classList.add('wild');
    sp.textContent = ICON(g.s);
  }
  function randomCell(i) { const s = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)]; paint(i, s === 'N' ? { s, n: { v: [1, 2, 5][Math.floor(Math.random() * 3)] } } : { s }, bet()); }
  for (let i = 0; i < E.CELLS; i++) randomCell(i);

  // ---------- Affichage ----------
  function renderJackpots() {
    const box = $('jackpots'); box.innerHTML = '';
    ['mini', 'minor', 'major', 'grand'].forEach((k) => { const d = document.createElement('div'); d.className = 'jp ' + k; d.dataset.k = k; d.innerHTML = '<small></small><b></b>'; d.firstChild.textContent = E.JACKPOTS[k].name; d.lastChild.textContent = fmt(E.JACKPOTS[k].x * bet()) + ' €'; box.appendChild(d); });
  }
  function renderPays() {
    const tb = $('pays'); tb.innerHTML = '';
    ['P', 'S', 'T', 'M', 'X', 'C', 'L', 'R'].forEach((s) => {
      const tr = document.createElement('tr'); const p = E.SYMBOLS[s].pay;
      [ICON(s), p[3] / E.UNIT, p[4] / E.UNIT, p[5] / E.UNIT].forEach((v, k) => { const td = document.createElement('td'); td.textContent = k ? String(Math.round(v * 100) / 100).replace('.', ',') + '×' : v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }
  function showWallet() {
    $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–';
    $('stack').textContent = fmt(S.stack) + ' €';
    $('stack-label').textContent = S.mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table';
    $('bet').textContent = fmt(bet());
  }
  function renderStats() {
    const st = S.stats;
    $('s-spins').textContent = st.spins; $('s-bet').textContent = fmt(st.bet) + ' €'; $('s-won').textContent = fmt(st.won) + ' €'; $('s-bonus').textContent = st.bonus;
    $('s-best').textContent = st.best ? 'Plus gros gain : ' + fmt(st.best) + ' €' + (st.bet ? ' · retour réel : ' + Math.round(st.won / st.bet * 100) + ' % (la machine rend environ 96 % en moyenne)' : '') : '';
  }
  function renderAides() {
    if (S.mode !== 'train') return;
    $('aides-body').innerHTML = [
      'Cette machine rend en moyenne environ <b>96 %</b> des mises, et <b>un tour sur trois</b> rapporte quelque chose. Aucun tour n\'est « dû » : chaque tour est tiré au hasard.',
      'Le bonus <b>Le Filon</b> arrive en moyenne <b>un tour sur 120</b> environ : c\'est lui qui fait les gros gains (plus d\'un tiers de ce que la machine rend).',
      'Les <b>jackpots</b> sont des pépites rares (MINI 20×, MINEUR 50×, MAJEUR 200×) ; le <b>GRAND</b> (1 000×) demande de remplir toute la grille pendant Le Filon.',
      'Monter la mise ne change pas tes chances : ça multiplie juste les gains… et les pertes.',
    ].map((x) => '<div class="tip">' + x + '</div>').join('');
  }
  function winText(t, big) { const w = $('win-text'); w.textContent = t; w.classList.toggle('big', !!big); }
  async function banner(text, sub, ms) {
    const b = $('banner'); b.innerHTML = '<div></div>'; b.firstChild.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; b.firstChild.appendChild(s); }
    b.hidden = false; await sleep(ms || 1400); b.hidden = true;
  }

  // ---------- Un tour ----------
  async function spin() {
    if (!S.mode || S.busy) return;
    const b = bet();
    if (S.mode === 'train' && S.stack < b) S.stack = window.Casino ? Casino.TRAIN_BANK : 1000;
    if (b > S.stack) { winText('Pas assez d\'argent sur la table : baisse la mise ou encaisse.'); stopAuto(); return; }
    S.busy = true; $('spin').disabled = true; $('cashout').disabled = true;
    winText('');
    let r;
    if (srv()) {
      Casino.hold();
      r = await Casino.call('gd.spin', { bet: b });
      if (r.error) { Casino.release(); winText('⚠️ ' + r.error); S.busy = false; $('spin').disabled = false; $('cashout').disabled = false; stopAuto(); return; }
    } else r = E.play(b, rng);
    if (!srv()) S.stack = Math.round((S.stack - b) * 100) / 100;
    else S.stack = Math.round((r.stack - r.total) * 100) / 100; // le gain s'affiche à la fin de l'animation
    showWallet();
    if (window.Sfx) Sfx.chips();
    // rouleaux qui tournent puis s'arrêtent un par un
    const spinTimer = setInterval(() => { cells.forEach((c, i) => { if (c.classList.contains('spin')) randomCell(i), c.classList.add('spin'); }); }, 70);
    cells.forEach((c) => c.classList.add('spin'));
    const t = turbo() ? 0.45 : 1;
    await sleep(380 * t);
    for (let col = 0; col < E.REELS; col++) {
      await sleep(200 * t);
      for (let row = 0; row < E.ROWS; row++) { const i = E.idx(col, row); cells[i].classList.remove('spin'); paint(i, r.grisou && r.grisou.includes(col) ? { s: RANDOM_POOL[(i * 7) % 8] } : r.grid[i], b); cells[i].classList.add('land'); }
      if (window.Sfx && Sfx.clack) Sfx.clack(0.5);
    }
    clearInterval(spinTimer);
    // coup de grisou : les rouleaux explosent en dynamite
    if (r.grisou) {
      await sleep(250 * t);
      $('window').classList.add('grisou'); setTimeout(() => $('window').classList.remove('grisou'), 520);
      if (window.Sfx && Sfx.explosion) Sfx.explosion();
      r.grisou.forEach((col) => { for (let row = 0; row < E.ROWS; row++) { const i = E.idx(col, row); paint(i, r.grid[i], b); cells[i].classList.add('boom'); } });
      winText('💥 COUP DE GRISOU !', true);
      await sleep(700 * t);
    }
    // gains du jeu de base
    if (r.wins.length) {
      const hit = new Set(); r.wins.forEach((w) => w.cells.forEach((i) => hit.add(i)));
      cells.forEach((c, i) => c.classList.toggle('win', hit.has(i)));
      const best = r.wins.slice().sort((a, x) => x.win - a.win)[0];
      winText('+' + fmt(r.base) + ' € · ' + ICON(best.s) + ' ×' + best.count + (best.ways > 1 ? ' (' + best.ways + ' façons)' : ''), r.base >= b * 5);
      if (window.Sfx) Sfx.win();
      await sleep((r.bonus ? 900 : 700) * t);
    } else if (!r.bonus) winText(r.nuggets >= 4 ? r.nuggets + ' pépites… il en faut 6 pour Le Filon !' : 'Pas de gain cette fois.');
    // bonus « Le Filon »
    if (r.bonus) await playBonus(r, b);
    // fin du tour
    S.stack = srv() ? r.stack : Math.round((S.stack + r.total) * 100) / 100;
    S.stats.spins++; S.stats.bet += b; S.stats.won += r.total; if (r.bonus) S.stats.bonus++; if (r.total > S.stats.best) S.stats.best = r.total;
    if (window.Casino && S.mode === 'real' && !Casino.server) Casino.track('sl', { bet: b, net: Math.round((r.total - b) * 100) / 100, jackpot: r.jackpot === 'grand', freeTrigger: !!r.bonus });
    if (r.total >= b * 15 && window.Casino) Casino.bigWin(r.total, r.jackpot ? 'JACKPOT ' + E.JACKPOTS[r.jackpot].name + ' !' : r.bonus ? 'LE FILON !' : 'GROS GAIN !');
    showWallet(); renderStats();
    S.busy = false; $('spin').disabled = false; $('cashout').disabled = false;
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 500);
    if (S.auto > 0) { S.auto--; updateAuto(); if (S.auto > 0) setTimeout(spin, turbo() ? 250 : 600); }
  }

  async function playBonus(r, b) {
    const bon = r.bonus, t = turbo() ? 0.5 : 1;
    await sleep(300 * t);
    if (window.Sfx) Sfx.win();
    winText('');
    await banner('⛏️ LE FILON !', r.nuggets + ' pépites : elles restent, 3 relances !', 1600 * t);
    winText('⛏️ Le Filon : chaque nouvelle pépite remet les relances à 3 !');
    $('bonus-head').hidden = false;
    cells.forEach((c, i) => paint(i, r.grid[i].s === 'N' ? r.grid[i].n : null, b));
    let sum = r.grid.reduce((a, g) => a + (g.s === 'N' ? g.n.v : 0), 0);
    const lamps = (n) => document.querySelectorAll('#lamps i').forEach((x, k) => x.classList.toggle('on', k < n));
    const setSum = (v) => { $('bonus-sum').textContent = fmt(v * b) + ' €'; };
    lamps(3); setSum(sum);
    for (const st of bon.steps) {
      await sleep(850 * t);
      st.added.forEach((i) => { paint(i, st.cells[i], b); cells[i].classList.add('new'); });
      if (st.added.length && window.Sfx) Sfx.chips();
      for (const ef of st.effects) {
        await sleep(450 * t);
        if (ef.kind === 'wagon') { cells.forEach((c) => c.classList.add('win')); if (window.Sfx && Sfx.cashout) Sfx.cashout(); winText('🚃 Le wagon ramasse ' + fmt(ef.v * b) + ' € !', true); await sleep(500 * t); cells.forEach((c) => c.classList.remove('win')); }
        if (ef.kind === 'boost') { cells.forEach((c) => c.classList.add('boom')); if (window.Sfx && Sfx.explosion) Sfx.explosion(); winText('💥 Filon d\'or : toutes les pépites doublent !', true); }
      }
      st.cells.forEach((x, i) => { if (x && !st.added.includes(i)) paint(i, x, b); });
      sum = st.cells.reduce((a, x) => a + (x ? x.v : 0), 0);
      setSum(sum); lamps(st.left);
    }
    await sleep(700 * t);
    if (bon.full) {
      document.querySelector('.jp.grand').classList.add('hit');
      if (window.Sfx && Sfx.explosion) Sfx.explosion();
      await banner('🏆 GRAND JACKPOT !', '+' + fmt(E.JACKPOTS.grand.x * b) + ' € : grille pleine !', 2200);
    } else if (r.jackpot) document.querySelector('.jp.' + r.jackpot).classList.add('hit');
    await banner('LE FILON : +' + fmt(bon.total) + ' €', 'fin du bonus', 1600);
    document.querySelectorAll('.jp.hit').forEach((x) => setTimeout(() => x.classList.remove('hit'), 3000));
    $('bonus-head').hidden = true;
    cells.forEach((c, i) => paint(i, r.grid[i], b));
    winText('Le Filon : +' + fmt(bon.total) + ' €' + (r.base ? ' (+' + fmt(r.base) + ' € de lignes)' : ''), true);
  }

  // ---------- Commandes ----------
  $('spin').addEventListener('click', spin);
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|BUTTON|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); spin(); } });
  $('bet-minus').addEventListener('click', () => { if (S.busy) return; S.betIx = Math.max(minIx(), S.betIx - 1); renderJackpots(); showWallet(); if (window.Sfx) Sfx.chips(); });
  $('bet-plus').addEventListener('click', () => { if (S.busy) return; const top = E.BETS.filter((b) => b <= (window.Casino && S.mode === 'real' ? Casino.maxBet() : 500)).length - 1; if (S.betIx >= top && S.mode === 'real' && window.Casino) Casino.toast('Mise maximale', E.BETS[top].toLocaleString('fr-FR') + ' € à ce palier (elle monte avec les paliers).', '🕴️'); S.betIx = Math.min(top, S.betIx + 1); renderJackpots(); showWallet(); if (window.Sfx) Sfx.chips(); });
  function updateAuto() { const a = $('auto'); a.classList.toggle('on', S.auto > 0); a.textContent = S.auto > 0 ? '■ Stop (' + S.auto + ')' : 'Auto ×10'; }
  function stopAuto() { S.auto = 0; updateAuto(); }
  $('auto').addEventListener('click', () => { if (S.auto > 0) { stopAuto(); return; } S.auto = 10; updateAuto(); if (!S.busy) spin(); });

  // ---------- Début et fin de partie ----------
  function startGame(mode, amount) {
    S.mode = mode;
    if (window.Casino) Casino.training = mode === 'train';
    S.stack = amount;
    document.body.classList.toggle('real-mode', mode === 'real');
    $('setup').hidden = true; $('cabinet').hidden = false;
    const badge = $('mode-badge'); badge.hidden = false;
    badge.textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse · sans aides' : '🎓 Apprentissage · crédit illimité, aides et conseils';
    $('cashout').textContent = mode === 'train' ? 'Terminer' : 'Encaisser';
    renderJackpots(); showWallet(); renderStats(); renderAides();
  }
  async function endSession() {
    if (S.busy) return;
    stopAuto();
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      if (!Casino.server) Casino.setStack('gold', S.stack);
      const r = await Casino.cashOut('gold');
      if (r && r.error) { winText('⚠️ ' + r.error); return; }
      const diff = r ? r.diff : 0;
      msg = 'Tu encaisses ' + fmt(r ? r.end : S.stack) + ' € (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' € par rapport à la somme apportée).';
      Casino.toast('Encaissé !', msg, '💰', diff > 0 ? 'gold' : '');
    }
    S.mode = null;
    $('cabinet').hidden = true; $('setup').hidden = false; $('mode-badge').hidden = true;
    renderPicker(msg); showWallet();
  }
  let cashArmed = false;
  $('cashout').addEventListener('click', () => {
    if (S.busy) return;
    if (!cashArmed) { cashArmed = true; $('cashout').textContent = 'Sûr ?'; setTimeout(() => { cashArmed = false; if (S.mode) $('cashout').textContent = S.mode === 'train' ? 'Terminer' : 'Encaisser'; }, 3000); return; }
    cashArmed = false; endSession();
  });
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 10000); return; }
    Casino.modePicker(box, { game: 'gold', min: E.BETS[0], suggest: 100, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  // la table en partie réelle (sans serveur) est sauvegardée en continu
  setInterval(() => { if (S.mode === 'real' && window.Casino && !Casino.server && !S.busy) Casino.setStack('gold', S.stack); }, 2000);
  renderPays(); renderJackpots(); renderPicker(); showWallet();
  if (window.Casino) Casino.onChange(() => { if (!S.busy) showWallet(); });
  window.Gold = { get state() { return S; }, spin };
})();
