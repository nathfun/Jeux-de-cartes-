// Machine à sous « Casino Royal » : interface, animations, portefeuille commun.
(function () {
  'use strict';
  const E = window.SlotEngine;
  const $ = (id) => document.getElementById(id);
  // mises possibles ; en partie réelle on garde celles permises par le salon VIP (elles montent avec le niveau)
  const ALL_BETS = [1, 2, 5, 10, 20, 50, 100, 250, 500];
  let BETS = ALL_BETS.slice(0, 5);
  const LINE_COLORS = ['#ffd76a', '#4fc3f7', '#81c784', '#f06292', '#ba68c8', '#ff8a65', '#4db6ac', '#e57373', '#9575cd', '#aed581'];
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR');
  const icon = (id) => E.byId[id].icon;

  // Argent sur la table : entraînement (crédit illimité) ou partie réelle (somme apportée de la banque)
  const wallet = () => S.stack;
  const addWallet = (v) => {
    S.stack = Math.round((S.stack + v) * 100) / 100;
    if (S.mode === 'real' && window.Casino) Casino.setStack('slots', S.stack);
    showWallet();
  };
  function showWallet() {
    if (!S.mode) { $('bank-label').textContent = 'Banque'; $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–'; return; }
    $('bank-label').textContent = S.mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table';
    $('wallet').textContent = fmt(S.stack);
  }

  const S = {
    mode: null, stack: 0, start: 0, betIndex: 1, spinning: false, free: 0, freeBet: 0, freeWon: 0, auto: 0,
    grid: E.spinGrid(), spins: 0, staked: 0, won: 0, best: 0,
  };
  const bet = () => BETS[S.betIndex];

  // ---------- Rouleaux ----------
  const reels = [];
  function cellEl(id) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.textContent = icon(id);
    c.dataset.sym = id;
    return c;
  }
  function buildReels() {
    const box = $('reels');
    box.innerHTML = '';
    for (let r = 0; r < 5; r++) {
      const reel = document.createElement('div');
      reel.className = 'reel';
      const strip = document.createElement('div');
      strip.className = 'strip';
      S.grid[r].forEach((id) => strip.appendChild(cellEl(id)));
      reel.appendChild(strip);
      box.appendChild(reel);
      reels.push({ reel, strip });
    }
  }
  const cellSize = () => reels[0].reel.getBoundingClientRect().height / 3;

  // Fait tourner un rouleau : les symboles défilent vers le bas et s'arrêtent sur la nouvelle colonne
  function spinReel(r, finalCol, duration) {
    const { strip } = reels[r];
    const old = S.grid[r];
    const filler = [];
    const n = Math.max(8, Math.round(duration / 45));
    for (let k = 0; k < n; k++) filler.push(E.spinGrid()[r][0]);
    strip.innerHTML = '';
    [...finalCol, ...filler, ...old].forEach((id) => strip.appendChild(cellEl(id)));
    const h = cellSize();
    const start = -(finalCol.length + filler.length) * h;
    strip.classList.add('moving');
    return new Promise((resolve) => {
      const done = () => {
        strip.classList.remove('moving');
        strip.style.transform = '';
        while (strip.children.length > 3) strip.lastChild.remove();
        if (window.Sfx) Sfx.clack(0.5);
        resolve();
      };
      if (!strip.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { setTimeout(done, Math.min(duration, 150)); return; }
      const a = strip.animate(
        [{ transform: `translateY(${start}px)` }, { transform: `translateY(${h * 0.12}px)`, offset: 0.92 }, { transform: 'translateY(0)' }],
        { duration, easing: 'cubic-bezier(.15,.55,.35,1)' }
      );
      setTimeout(() => strip.classList.remove('moving'), duration * 0.8);
      a.onfinish = done;
    });
  }

  // ---------- Affichage des gains ----------
  function clearWins() {
    $('lines').innerHTML = '';
    document.querySelectorAll('.cell.hit').forEach((c) => c.classList.remove('hit'));
    $('win-text').classList.remove('big');
    $('reels').closest('.cabinet').classList.remove('winning');
  }
  function showWins(res) {
    const svg = $('lines');
    res.wins.forEach((w) => {
      w.cells.forEach(([reel, row]) => { const c = reels[reel].strip.children[row]; if (c) c.classList.add('hit'); });
      if (w.scatter) return;
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', E.LINES[w.line].map((row, reel) => `${reel * 100 + 50},${row * 100 + 50}`).join(' '));
      pl.setAttribute('stroke', LINE_COLORS[w.line]);
      svg.appendChild(pl);
    });
    if (res.total > 0) $('reels').closest('.cabinet').classList.add('winning');
  }
  function countUp(el, amount, ms) {
    const t0 = performance.now();
    (function step(t) {
      const u = Math.min(1, (t - t0) / ms);
      el.textContent = 'Gain : ' + fmt(Math.round(amount * u * 100) / 100) + ' €';
      if (u < 1) requestAnimationFrame(step);
    })(t0);
  }

  // Explication en clair de ce qui vient de se passer (aides)
  function explain(res, b, free) {
    const box = $('explain');
    box.innerHTML = '';
    const add = (text) => { const d = document.createElement('div'); d.textContent = text; box.appendChild(d); };
    if (!res.wins.length) {
      add('Aucune combinaison. C\'est normal : environ 3 tours sur 4 ne rapportent rien, les gains viennent par à-coups.');
      return;
    }
    const lb = b / E.LINES.length;
    res.wins.forEach((w) => {
      if (w.scatter) add(`${w.count} × 🎰 bonus : ${E.SCATTER[Math.min(5, w.count)].mult} × la mise${free ? ' × 2' : ''} = ${fmt(w.amount)} € et ${res.freeSpins} tours gratuits.`);
      else add(`Ligne ${w.line + 1} : ${w.count} × ${icon(w.symbol)} → ${E.byId[w.symbol].pays[w.count]} × ${fmt(lb)} €${free ? ' × 2' : ''} = ${fmt(w.amount)} €${w.jackpot ? ' (JACKPOT !)' : ''}`);
    });
    const ratio = res.total / b;
    if (ratio >= 10) add(`Tu gagnes ${fmt(ratio)} fois ta mise : ce genre de coup arrive rarement, c'est lui qui « paie » les nombreux tours perdants.`);
    else if (ratio < 1) add(`Gain inférieur à la mise (${fmt(ratio)} ×) : tu récupères une partie, mais le tour reste perdant.`);
  }

  // ---------- Un tour ----------
  async function spin() {
    if (S.spinning) return;
    const free = S.free > 0;
    const b = free ? S.freeBet : bet();
    if (!S.mode) return;
    if (!free && wallet() < b && S.mode === 'train') { S.stack = S.start = window.Casino ? Casino.TRAIN_BANK : 1000; showWallet(); }
    if (!free && wallet() < b) {
      $('win-text').textContent = wallet() < BETS[0] ? 'Plus rien sur la table : la partie est perdue.' : 'Mise trop élevée pour ce qui reste sur la table : baisse la mise.';
      stopAuto();
      if (wallet() < BETS[0]) setTimeout(() => endSession(true), 1500);
      return;
    }
    S.spinning = true;
    renderControls();
    clearWins();
    if (!free) { addWallet(-b); S.staked += b; }
    else { S.free--; }
    renderFree();
    $('win-text').textContent = free ? 'Tour gratuit…' : 'Bonne chance !';
    if (window.Sfx) Sfx.chips();

    // Partie réelle avec le serveur : c'est lui qui tire les rouleaux et compte l'argent
    let srv = null;
    if (S.mode === 'real' && window.Casino && Casino.server) {
      srv = await Casino.call('sl.spin', { bet: b });
      if (srv.error) {
        if (!free) { addWallet(b); S.staked -= b; } else S.free++;
        S.spinning = false;
        $('win-text').textContent = '⚠️ ' + srv.error;
        stopAuto(); renderFree(); renderControls();
        return;
      }
    }
    const grid = srv ? srv.grid : window.__forceGrid ? window.__forceGrid.shift() || E.spinGrid() : E.spinGrid();
    const turbo = $('turbo').checked;
    const base = turbo ? 320 : 800, step = turbo ? 90 : 260;
    if (window.Sfx) Sfx.tick();
    await Promise.all([0, 1, 2, 3, 4].map((r) => spinReel(r, grid[r], base + r * step)));
    S.grid = grid;

    const res = srv ? srv.res : E.evaluate(grid, b, free);
    S.spins++;
    if (res.total > 0) { addWallet(res.total); S.won += res.total; S.best = Math.max(S.best, res.total); }
    if (free) S.freeWon += res.total;
    showWins(res);
    explain(res, b, free);

    const net = res.total - (free ? 0 : b);
    if (window.Casino) Casino.track('sl', { bet: free ? 0 : b, net, jackpot: res.jackpot, freeTrigger: res.freeSpins > 0 });

    const wt = $('win-text');
    if (res.total > 0) {
      countUp(wt, res.total, Math.min(1500, 300 + res.total / b * 60));
      if (window.Sfx) Sfx.win();
      if (window.Casino) Casino.vibrate(res.total >= 5 * b ? [40, 30, 80] : 30);
    } else wt.textContent = free ? 'Rien sur ce tour gratuit.' : 'Pas de gain cette fois.';
    if (res.total >= 10 * b) wt.classList.add('big');

    if (res.freeSpins) {
      if (!free) S.freeBet = b;
      if (S.free === 0 && !free) S.freeWon = 0;
      S.free += res.freeSpins;
      if (window.Sfx) Sfx.say(res.freeSpins + ' tours gratuits !');
      if (window.Casino) Casino.toast('Tours gratuits !', `+${res.freeSpins} tours, gains doublés`, '🎰', 'gold');
    }
    if (res.jackpot) setTimeout(() => window.Casino && Casino.bigWin(res.total, 'JACKPOT !'), 900);
    else if (res.total >= 15 * b) setTimeout(() => window.Casino && Casino.bigWin(res.total, 'MÉGA GAIN !'), 900);

    if (srv) { S.stack = srv.stack; S.free = srv.free; S.freeBet = srv.freeBet || S.freeBet; showWallet(); } // le serveur fait foi
    S.spinning = false;
    renderFree();
    renderStats();
    renderControls();
    if (free && S.free === 0) {
      setTimeout(() => { $('win-text').textContent = `Tours gratuits terminés : ${fmt(S.freeWon)} € gagnés.`; }, 1600);
    }
    // Suite automatique : tours gratuits, puis auto-jeu
    const pause = res.total >= 10 * b ? 2600 : res.total > 0 ? (turbo ? 500 : 1100) : (turbo ? 250 : 500);
    if (S.free > 0) setTimeout(spin, pause + (res.freeSpins ? 1200 : 0));
    else if (S.auto > 0 && res.total < 15 * b) setTimeout(() => { if (S.auto > 0 && !S.spinning) { S.auto--; spin(); } }, pause);
    else if ($('auto').classList.contains('on')) stopAuto(); // série finie, ou gros gain : on s'arrête pour savourer
  }
  function stopAuto() { S.auto = 0; $('auto').classList.remove('on'); renderControls(); }

  // ---------- Rendu ----------
  function renderControls() {
    const locked = S.spinning || S.free > 0;
    $('spin').disabled = locked;
    $('cashout').disabled = locked || S.auto > 0;
    $('cashout').textContent = S.mode === 'train' ? 'Terminer' : 'Encaisser';
    $('cashout').hidden = S.mode === 'train';
    $('bet-minus').disabled = locked || S.auto > 0 || S.betIndex === 0;
    $('bet-plus').disabled = locked || S.auto > 0 || S.betIndex === BETS.length - 1;
    $('bet').textContent = S.free > 0 ? S.freeBet : bet();
    $('jackpot-value').textContent = fmt(E.byId.sept.pays[5] * (S.free > 0 ? S.freeBet : bet()) / E.LINES.length) + ' €';
    $('auto').textContent = S.auto > 0 ? `Stop (${S.auto})` : 'Auto ×10';
    $('spin').textContent = S.free > 0 ? 'GRATUIT' : 'JOUER';
    $('spin').classList.toggle('free', S.free > 0);
  }
  function renderFree() {
    const fb = $('free-badge');
    fb.hidden = S.free <= 0;
    fb.textContent = `🎰 ${S.free} tour${S.free > 1 ? 's' : ''} gratuit${S.free > 1 ? 's' : ''} · gains × 2`;
  }
  function renderStats() {
    $('s-spins').textContent = S.spins;
    $('s-bet').textContent = fmt(S.staked);
    $('s-won').textContent = fmt(S.won);
    $('s-rtp').textContent = S.staked ? Math.round(S.won / S.staked * 100) + ' %' : '–';
    $('s-best').textContent = S.best ? `Meilleur gain : ${fmt(S.best)} €. Sur une courte session, le retour réel peut être très loin de 94 % (dans un sens ou dans l'autre).` : '';
  }
  function renderPaytable() {
    const t = $('paytable');
    const head = document.createElement('tr');
    ['', '×3', '×4', '×5'].forEach((h) => { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); });
    t.appendChild(head);
    E.SYMBOLS.filter((s) => s.pays).slice().reverse().forEach((s) => {
      const tr = document.createElement('tr');
      const td0 = document.createElement('td'); td0.textContent = s.icon; tr.appendChild(td0);
      [3, 4, 5].forEach((k) => { const td = document.createElement('td'); td.textContent = s.pays[k] + (s.id === 'sept' && k === 5 ? ' 🏆' : ''); tr.appendChild(td); });
      t.appendChild(tr);
    });
  }

  // ---------- Commandes ----------
  $('spin').addEventListener('click', () => { if (window.Sfx && Sfx.unlock) Sfx.unlock(); spin(); });
  $('bet-minus').addEventListener('click', () => { if (S.betIndex > 0) { S.betIndex--; if (window.Sfx) Sfx.chips(); renderControls(); } });
  $('bet-plus').addEventListener('click', () => { if (S.betIndex < BETS.length - 1) { S.betIndex++; if (window.Sfx) Sfx.chips(); renderControls(); } });
  $('auto').addEventListener('click', () => {
    if (S.auto > 0) { stopAuto(); return; }
    S.auto = 10;
    $('auto').classList.add('on');
    renderControls();
    if (!S.spinning && S.free === 0) { S.auto--; spin(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|BUTTON|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); spin(); }
  });
  const aides = $('opt-aides');
  try { aides.checked = localStorage.getItem('slots-aides') !== '0'; } catch (e) { /* ignore */ }
  const applyAides = () => { document.body.classList.toggle('no-aides', !aides.checked || S.mode === 'real'); try { localStorage.setItem('slots-aides', aides.checked ? '1' : '0'); } catch (e) { /* ignore */ } };
  aides.addEventListener('change', applyAides);
  applyAides();
  try { $('turbo').checked = localStorage.getItem('slots-turbo') === '1'; } catch (e) { /* ignore */ }
  $('turbo').addEventListener('change', () => { try { localStorage.setItem('slots-turbo', $('turbo').checked ? '1' : '0'); } catch (e) { /* ignore */ } });

  // ---------- Début et fin de partie ----------
  function startGame(mode, amount, resumed, info) {
    S.mode = mode;
    if (window.Casino) Casino.training = mode === 'train';
    const cap = window.Casino ? Casino.maxBet() : 500;
    BETS = ALL_BETS.filter((b) => b <= cap);
    S.betIndex = Math.min(BETS.indexOf(5), BETS.length - 1);
    S.stack = amount;
    S.start = mode === 'real' && window.Casino && Casino.session('slots') ? Casino.session('slots').start : amount;
    S.spins = 0; S.staked = 0; S.won = 0; S.best = 0;
    $('setup').hidden = true;
    $('cabinet').hidden = false;
    const badge = $('mode-badge');
    badge.hidden = false;
    badge.className = 'cm-badge mode-line' + (mode === 'real' ? ' real' : '');
    badge.textContent = mode === 'real' ? '💰 Partie réelle · sans aides · « Encaisser » ramène tes gains à la banque' : '🎓 Apprentissage · crédit illimité, aides et conseils · ne compte pas';
    $('aides-panel').hidden = mode !== 'train';
    document.body.classList.toggle('no-aides', mode !== 'train' || !aides.checked);
    $('win-text').textContent = resumed ? 'Partie reprise : ' + fmt(S.stack) + ' € sur la table.' : 'Bonne chance !';
    S.free = 0;
    if (info && info.free > 0) { S.free = info.free; S.freeBet = info.freeBet; }
    renderFree();
    showWallet(); renderStats(); renderControls();
    if (S.free > 0) setTimeout(spin, 800); // tours gratuits restés en attente
  }
  async function endSession(broke) {
    if (S.spinning || S.free > 0) return;
    stopAuto();
    let msg;
    if (S.mode === 'real' && window.Casino) {
      const r0 = await Casino.cashOut('slots');
      if (r0 && r0.error) { $('win-text').textContent = '⚠️ ' + r0.error; return; }
      const r = r0;
      const diff = r ? r.diff : 0;
      msg = broke ? 'Tout est perdu : les ' + fmt(S.start) + ' € apportés sont partis.' :
        'Tu encaisses ' + fmt(r ? r.end : S.stack) + ' € (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' € par rapport à ta mise de départ).';
      Casino.toast(broke ? 'Partie perdue' : 'Encaissé !', msg, broke ? '💸' : '💰', diff > 0 ? 'gold' : '');
    } else msg = 'Entraînement terminé : ' + S.spins + ' tours, retour réel ' + (S.staked ? Math.round(S.won / S.staked * 100) : 0) + ' %.';
    S.mode = null;
    if (window.Casino) Casino.training = false;
    clearWins();
    $('cabinet').hidden = true;
    $('mode-badge').hidden = true;
    $('setup').hidden = false;
    $('aides-panel').hidden = false;
    renderPicker(msg);
    showWallet();
  }
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 10000); return; }
    Casino.modePicker(box, { game: 'slots', min: 1, suggest: 100, onStart: startGame });
    if (msg) { const p = document.createElement('p'); p.className = 'end-msg'; p.textContent = msg; box.prepend(p); }
  }
  $('cashout').addEventListener('click', () => {
    if ($('cashout').dataset.confirm) { delete $('cashout').dataset.confirm; endSession(false); return; }
    $('cashout').dataset.confirm = '1';
    $('cashout').textContent = S.mode === 'train' ? 'Sûr ?' : 'Encaisser ' + fmt(S.stack) + ' € ?';
    setTimeout(() => { delete $('cashout').dataset.confirm; renderControls(); }, 3000);
  });

  buildReels();
  renderPicker();
  renderPaytable();
  renderControls();
  renderStats();
  showWallet();
  if (window.Casino) Casino.onChange(() => { if (!S.mode) showWallet(); });
  $('explain').textContent = '';
  window.Slots = { get state() { return S; }, spin };
})();
