/* Le Braquage (La Dette, palier 10) : machine à sous 3 × 3, 5 lignes, bonus « Le Coffre ». */
(function () {
  'use strict';
  const R = window.CasinoRules, E = window.HeistEngine;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = { mode: null, stack: 0, betIx: 0, busy: false };
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const cells = [];
  for (let i = 0; i < 9; i++) { const c = document.createElement('div'); c.className = 'hs-cell'; c.textContent = E.SYMBOLS[i % 6].s; $('grid').appendChild(c); cells.push(c); }
  $('pay').innerHTML = E.SYMBOLS.filter((x) => x.pay).map((x) => '<span>' + x.s + x.s + x.s + ' ×' + x.pay + '</span>').join('') + '<span style="grid-column:1/-1">🔐🔐🔐 = Le Coffre : ×5 à ×100 la mise · gains de ligne = mise ÷ 5 × le multiplicateur</span>';

  const bets = () => { const min = S.mode === 'real' ? Casino.minBet('heist') : 1, max = S.mode === 'real' ? Casino.maxBet() : 500; return R.BET_STEPS.filter((b) => b >= min && b <= max); };
  const bet = () => bets()[Math.min(S.betIx, bets().length - 1)];
  function ui() {
    $('bet').textContent = fmt(bet()) + ' €'; $('stack').textContent = fmt(S.stack) + ' €';
    $('spin').disabled = S.busy || bet() > S.stack; $('end-btn').disabled = S.busy;
    $('bet-minus').disabled = S.busy || S.betIx <= 0; $('bet-plus').disabled = S.busy || S.betIx >= bets().length - 1;
    $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–';
  }
  async function safes(bonus) {
    const box = $('safes'); box.hidden = false; box.innerHTML = '';
    const w = document.createElement('div'); w.className = 'box';
    w.innerHTML = '<h3>🔐 LE COFFRE</h3><p>Choisis un coffre-fort à braquer' + (bonus.double ? ' (×2 avec quatre 🔐 !)' : '') + '</p><div class="row"></div>';
    box.appendChild(w);
    const row = w.querySelector('.row');
    const others = E.SAFE.map((x) => x.m).filter((m) => m !== bonus.mult).sort(() => Math.random() - 0.5).slice(0, 2);
    await new Promise((done) => {
      [0, 1, 2].forEach((i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'hs-safe'; b.textContent = '🔒';
        b.onclick = async () => {
          if (row.dataset.done) return; row.dataset.done = '1';
          b.classList.add('shake'); if (window.Sfx && Sfx.heartbeat) Sfx.heartbeat();
          await sleep(1400);
          b.classList.remove('shake'); b.classList.add('open'); b.textContent = '×' + bonus.mult;
          let k = 0; row.querySelectorAll('.hs-safe').forEach((o) => { if (o !== b) { o.classList.add('other'); o.textContent = '×' + others[k++]; } });
          if (window.Sfx) Sfx.win();
          const p = document.createElement('p'); p.innerHTML = '<b style="font-size:1.4rem;color:#fde047">+' + fmt(bonus.win) + ' €</b>';
          const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'go'; ok.textContent = 'Encaisser le butin';
          ok.onclick = () => { box.hidden = true; done(); };
          w.append(p, ok);
        };
        row.appendChild(b);
      });
    });
  }
  async function spin() {
    const b = bet();
    if (S.busy || b > S.stack) return;
    S.busy = true; S.stack = Math.round((S.stack - b) * 100) / 100; ui();
    cells.forEach((c) => c.classList.remove('win', 'sc'));
    $('win').textContent = '';
    let r;
    if (srv()) {
      Casino.hold();
      r = await Casino.call('hs.spin', { bet: b });
      if (!r || r.error) { Casino.release(); S.stack += b; S.busy = false; $('win').textContent = '⚠️ ' + ((r && r.error) || 'Erreur'); ui(); return; }
    } else {
      r = E.spin(b, Math.random); r.stack = Math.round((S.stack + r.total) * 100) / 100;
      if (S.mode === 'real' && window.Casino) Casino.setStack('heist', r.stack);
    }
    if (window.Sfx) Sfx.chips();
    const timer = setInterval(() => cells.forEach((c) => { if (c.classList.contains('spin')) c.textContent = E.SYMBOLS[Math.floor(Math.random() * E.SYMBOLS.length)].s; }), 80);
    cells.forEach((c) => c.classList.add('spin'));
    for (let col = 0; col < 3; col++) {
      await sleep(col ? 380 : 650);
      [0, 3, 6].forEach((row) => { const i = row + col; cells[i].classList.remove('spin'); cells[i].textContent = r.grid[i]; if (r.grid[i] === '🔐') cells[i].classList.add('sc'); });
      if (window.Sfx && Sfx.clack) Sfx.clack(0.5);
    }
    clearInterval(timer);
    r.wins.forEach((w) => w.cells.forEach((i) => cells[i].classList.add('win')));
    const lines = Math.round(r.wins.reduce((a, w) => a + w.win, 0) * 100) / 100;
    if (lines > 0) { $('win').textContent = '+' + fmt(lines) + ' € · ' + r.wins.length + ' ligne' + (r.wins.length > 1 ? 's' : ''); if (window.Sfx) Sfx.win(); }
    else $('win').textContent = r.bonus ? '🔐 🔐 🔐 LE COFFRE !' : 'Pas de butin cette fois.';
    if (r.bonus) { await sleep(700); await safes(r.bonus); $('win').textContent = 'Butin total : +' + fmt(r.total) + ' €'; }
    S.stack = r.stack;
    if (r.total >= b * 20 && window.Casino && Casino.bigWin) Casino.bigWin(r.total, 'GROS BRAQUAGE !');
    S.busy = false; ui();
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 600);
  }
  $('spin').addEventListener('click', spin);
  $('bet-minus').addEventListener('click', () => { S.betIx = Math.max(0, S.betIx - 1); ui(); });
  $('bet-plus').addEventListener('click', () => { S.betIx = Math.min(bets().length - 1, S.betIx + 1); ui(); });
  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount;
    if (window.Casino) Casino.training = mode === 'train';
    const bs = bets(); S.betIx = Math.max(0, bs.findIndex((x) => x >= amount / 40)); if (bs[S.betIx] > amount) S.betIx = 0;
    $('setup').hidden = true; $('game').hidden = false;
    $('mode-badge').textContent = mode === 'real' ? '🕴️ La Dette · ta caisse' : '🎓 Apprentissage · crédit illimité';
    $('end-btn').hidden = mode === 'train';
    ui();
  }
  async function endSession() {
    if (S.busy) return;
    if (S.mode === 'real') { const r = await Casino.cashOut('heist'); if (r && r.error) { $('win').textContent = r.error; return; } }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false; renderPicker();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker() { Casino.modePicker($('mode-picker'), { game: 'heist', min: 1, onStart: (mode, amount) => startGame(mode, amount) }); }
  renderPicker(); ui();
  if (window.Casino) Casino.onChange(() => { if (!S.busy) $('wallet').textContent = fmt(Casino.wallet()); });
  window.Heist = { get state() { return S; }, spin };
})();
