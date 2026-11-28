/* Plus ou Moins (Le Parrain, dès le palier 1) : le serveur retourne les cartes ; en Apprentissage, même règles dans le navigateur. */
(function () {
  'use strict';
  const R = window.CasinoRules, E = window.HiloEngine;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = { mode: null, stack: 0, betIx: 0, busy: false, round: null, hist: [] };
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const rnd = (n) => Math.floor(Math.random() * n);

  // ---------- même déroulé que le serveur, pour l'Apprentissage (et le mode sans serveur) ----------
  const local = {
    start(bet) { S.stack -= bet; S.round = { bet, card: E.draw(rnd), fair: 1, steps: 0, skips: E.SKIPS, active: true }; return { card: S.round.card, skips: E.SKIPS, fair: 1, steps: 0, stack: S.stack }; },
    guess(dir) {
      const h = S.round, o = E.odds(h.card.r)[dir], next = E.draw(rnd), out = E.judge(h.card.r, next.r, dir);
      if (out === 'win') { h.fair *= o; h.steps++; }
      const prev = h.card; h.card = next; let payout = 0;
      if (out === 'lose') h.active = false;
      if (out === 'win' && h.fair >= E.MAX_FAIR) payout = this.cash().payout;
      return { prev, card: next, out, fair: h.fair, steps: h.steps, mult: E.payMult(h.fair), active: h.active, payout, stack: S.stack };
    },
    skip() { const h = S.round; h.skips--; h.card = E.draw(rnd); return { card: h.card, skips: h.skips, fair: h.fair, steps: h.steps, stack: S.stack }; },
    cash() { const h = S.round, pay = Math.round(h.bet * E.payMult(h.fair) * 100) / 100; S.stack += pay; h.active = false; return { cashed: true, payout: pay, stack: S.stack }; },
  };
  async function api(op, data) {
    if (srv()) return Casino.call(op, data || {});
    const r = op === 'hl.start' ? local.start(data.bet) : op === 'hl.guess' ? local.guess(data.dir) : op === 'hl.skip' ? local.skip() : local.cash();
    if (S.mode === 'real' && window.Casino) Casino.setStack('hilo', S.stack);
    return r;
  }

  // ---------- affichage ----------
  const bets = () => { const min = S.mode === 'real' ? Casino.minBet('hilo') : 1, max = S.mode === 'real' ? Casino.maxBet() : 500; return R.BET_STEPS.filter((b) => b >= min && b <= max); };
  const bet = () => bets()[Math.min(S.betIx, bets().length - 1)];
  const red = (c) => c.s === 1 || c.s === 2;
  function showCard(c, cls) {
    const el = $('card');
    el.className = 'hl-card' + (c ? (red(c) ? ' red' : '') : ' back') + (cls ? ' ' + cls : '');
    if (c) { el.querySelector('.r').textContent = E.RANKS[c.r]; el.querySelector('.s').textContent = E.SUITS[c.s]; }
    void el.offsetWidth; if (c) el.classList.add('flip');
  }
  function ui() {
    const h = S.round, on = !!(h && h.active);
    $('bet').textContent = fmt(bet()) + ' €'; $('stack').textContent = fmt(S.stack) + ' €';
    $('deal').disabled = S.busy || on || bet() > S.stack;
    $('bet-minus').disabled = S.busy || on || S.betIx <= 0; $('bet-plus').disabled = S.busy || on || S.betIx >= bets().length - 1;
    $('end-btn').disabled = S.busy || on;
    const o = on ? E.odds(h.card.r) : {};
    ['hi', 'lo', 'eq'].forEach((d) => {
      const b = $(d); b.disabled = S.busy || !on || !o[d];
      b.querySelector('small').textContent = on && o[d] ? 'gain ' + fmt(h.bet * E.payMult(h.fair * o[d])) + ' €' : on ? 'impossible' : '';
    });
    $('skip').disabled = S.busy || !on || !(h.skips > 0); $('skips').textContent = h ? '(' + Math.max(0, h.skips || 0) + ')' : '';
    $('take').disabled = S.busy || !on || !(h.steps > 0);
    $('take').textContent = on && h.steps > 0 ? '💰 Prendre ' + fmt(h.bet * E.payMult(h.fair)) + ' €' : '💰 Prendre le gain';
    $('pot').textContent = on ? fmt(h.steps ? h.bet * E.payMult(h.fair) : h.bet) + ' €' : '–';
    $('pot-mult').textContent = on ? (h.steps ? '×' + String(E.payMult(h.fair)).replace('.', ',') + ' ta mise' : 'trouve une première carte') : '';
    $('streak').textContent = on && h.steps ? '🔥 ' + h.steps + ' bonne' + (h.steps > 1 ? 's' : '') + ' réponse' + (h.steps > 1 ? 's' : '') : '';
    $('hist').innerHTML = S.hist.slice(-12).map((c) => '<li class="' + (red(c) ? 'red' : '') + '">' + E.label(c) + '</li>').join('');
    $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–';
  }
  function msg(t) { $('msg').textContent = t; }

  // ---------- actions ----------
  async function deal() {
    const b = bet(); if (S.busy || b > S.stack) return;
    S.busy = true; ui();
    const r = await api('hl.start', { bet: b });
    S.busy = false;
    if (!r || r.error) { msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    S.stack = r.stack; S.round = { bet: b, card: r.card, fair: 1, steps: 0, skips: r.skips, active: true }; S.hist = [r.card];
    if (window.Sfx) Sfx.card();
    showCard(r.card); msg('Plus haut ou plus bas ?'); ui();
  }
  async function guess(dir) {
    const h = S.round; if (S.busy || !h || !h.active) return;
    S.busy = true; ui();
    if (window.Casino && srv()) Casino.hold();
    const r = await api('hl.guess', { dir });
    if (!r || r.error) { S.busy = false; if (window.Casino && Casino.holding) Casino.release(); msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    if (window.Sfx) Sfx.flip ? Sfx.flip() : Sfx.card();
    await sleep(120);
    showCard(r.card, r.out === 'win' ? 'win' : r.out === 'lose' ? 'lose' : '');
    S.hist.push(r.card);
    h.card = r.card; h.fair = r.fair; h.steps = r.steps; h.active = r.active !== false && r.out !== 'lose';
    if (r.out === 'win') { msg(['Bien vu !', 'Encore !', 'Ça grimpe !', 'Tu es en feu 🔥'][Math.min(3, h.steps - 1)]); if (window.Sfx) Sfx.chips(); const p = $('pot'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
    else if (r.out === 'push') msg('Égalité : on continue !');
    else { msg('Raté… ' + E.label(r.card) + '. Tu perds ta mise.'); if (window.Sfx && Sfx.lose) Sfx.lose(); }
    if (r.payout) { msg('Plafond atteint : +' + fmt(r.payout) + ' € encaissés !'); h.active = false; }
    S.stack = r.stack; S.busy = false; ui();
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 500);
  }
  async function skip() {
    if (S.busy || !S.round || !S.round.active) return;
    S.busy = true; const r = await api('hl.skip'); S.busy = false;
    if (!r || r.error) { msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    S.round.card = r.card; S.round.skips = r.skips; S.hist.push(r.card);
    if (window.Sfx) Sfx.card(); showCard(r.card); msg('Nouvelle carte. Plus haut ou plus bas ?'); ui();
  }
  async function take() {
    const h = S.round; if (S.busy || !h || !h.active || !h.steps) return;
    S.busy = true; const r = await api('hl.cash'); S.busy = false;
    if (!r || r.error) { msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    h.active = false; S.stack = r.stack;
    msg('💰 +' + fmt(r.payout) + ' € empochés !'); if (window.Sfx) Sfx.win();
    if (r.payout >= h.bet * 10 && window.Casino && Casino.bigWin) Casino.bigWin(r.payout, 'QUELLE SÉRIE !');
    ui();
  }
  $('deal').addEventListener('click', deal);
  ['hi', 'lo', 'eq'].forEach((d) => $(d).addEventListener('click', () => guess(d)));
  $('skip').addEventListener('click', skip);
  $('take').addEventListener('click', take);
  $('bet-minus').addEventListener('click', () => { S.betIx = Math.max(0, S.betIx - 1); ui(); if (window.Sfx) Sfx.chips(); });
  $('bet-plus').addEventListener('click', () => { S.betIx = Math.min(bets().length - 1, S.betIx + 1); ui(); if (window.Sfx) Sfx.chips(); });

  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount; S.round = null; S.hist = [];
    if (window.Casino) Casino.training = mode === 'train';
    const bs = bets(); S.betIx = Math.max(0, bs.findIndex((x) => x >= amount / 40)); if (bs[S.betIx] > amount) S.betIx = 0;
    $('setup').hidden = true; $('game').hidden = false;
    $('mode-badge').textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse' : '🎓 Apprentissage · crédit illimité';
    $('end-btn').hidden = mode === 'train';
    showCard(null); msg('Mise, puis retourne la première carte.'); ui();
  }
  async function endSession() {
    if (S.busy) return;
    if (S.mode === 'real') { const r = await Casino.cashOut('hilo'); if (r && r.error) { msg(r.error); return; } }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false; renderPicker();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker() { Casino.modePicker($('mode-picker'), { game: 'hilo', min: 1, onStart: (mode, amount) => startGame(mode, amount) }); }
  renderPicker(); ui();
  if (window.Casino) Casino.onChange(() => { if (!S.busy) $('wallet').textContent = fmt(Casino.wallet()); });
  window.Hilo = { get state() { return S; }, guess, deal };
})();
