/* 421 (Le Parrain, dès le palier 3) : le serveur lance les dés ; on garde, on relance une fois, ou on s'arrête (×1,5). */
(function () {
  'use strict';
  const R = window.CasinoRules, E = window.DiceEngine;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = { mode: null, stack: 0, betIx: 0, busy: false, game: null, keep: [false, false, false] };
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const rf = () => Math.random();
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  // ---------- même déroulé que le serveur (Apprentissage) ----------
  const local = {
    roll(data) {
      const g = S.game;
      if (!g || !g.active) {
        S.stack -= data.bet;
        S.game = { bet: data.bet, dice: [E.roll(rf), E.roll(rf), E.roll(rf)], throws: 1, active: true };
        return { dice: S.game.dice, throws: 1, combo: E.evaluate(S.game.dice), mult: E.payMult(S.game.dice, 1), done: false, stack: S.stack };
      }
      g.dice = g.dice.map((x, i) => (data.keep[i] ? x : E.roll(rf))); g.throws++;
      let payout = 0, m = E.payMult(g.dice, g.throws), done = false;
      if (g.throws >= E.ROLLS) { const f = this.stop(); payout = f.payout; done = true; }
      return { dice: g.dice, throws: g.throws, combo: E.evaluate(g.dice), mult: m, payout, done, stack: S.stack };
    },
    stop() { const g = S.game, m = E.payMult(g.dice, g.throws), pay = Math.round(g.bet * m * 100) / 100; S.stack += pay; g.active = false; return { dice: g.dice, throws: g.throws, combo: E.evaluate(g.dice), mult: m, payout: pay, done: true, stack: S.stack }; },
  };
  async function api(op, data) {
    if (srv()) return Casino.call(op, data || {});
    const r = op === 'dq.roll' ? local.roll(data) : local.stop();
    if (S.mode === 'real' && window.Casino) Casino.setStack('des', S.stack);
    return r;
  }

  const bets = () => { const min = S.mode === 'real' ? Casino.minBet('des') : 1, max = S.mode === 'real' ? Casino.maxBet() : 500; return R.BET_STEPS.filter((b) => b >= min && b <= max); };
  const bet = () => bets()[Math.min(S.betIx, bets().length - 1)];
  const on = () => !!(S.game && S.game.active);

  function dieEl(v, i) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dq-die' + (v === 1 || v === 4 ? ' red' : '');
    for (let k = 0; k < 9; k++) { const p = document.createElement('i'); if (v && PIPS[v].includes(k)) p.className = 'on'; b.appendChild(p); }
    b.setAttribute('aria-label', 'Dé ' + (v || '?') + (S.keep[i] ? ', gardé' : ''));
    if (S.keep[i]) b.classList.add('held');
    b.disabled = !on() || S.busy;
    b.onclick = () => { if (!on() || S.busy) return; S.keep[i] = !S.keep[i]; if (window.Sfx) Sfx.tick(); renderDice(); ui(); };
    return b;
  }
  function renderDice(rolling) {
    const box = $('dice'); box.innerHTML = '';
    const d = S.game ? S.game.dice : [0, 0, 0];
    d.forEach((v, i) => { const el = dieEl(v, i); if (rolling && rolling[i]) { el.classList.add('rolling'); el.style.animationDelay = (i * 0.07) + 's'; } box.appendChild(el); });
    // conseil du coach (Apprentissage) : quels dés garder
    const coach = $('coach');
    if (S.mode === 'train' && on() && S.game.throws < E.ROLLS) {
      const b = E.best(S.game.dice, E.ROLLS - S.game.throws);
      coach.hidden = false;
      coach.textContent = b.stop ? '💡 Le coach : arrête-toi, c\'est le meilleur choix ici.' : b.keep.some(Boolean) ? '💡 Le coach : garde le ' + S.game.dice.filter((_, i) => b.keep[i]).join(' et le ') + ', relance le reste.' : '💡 Le coach : relance les trois dés.';
      [...box.children].forEach((el, i) => el.classList.toggle('tip', !b.stop && b.keep[i] && !S.keep[i]));
    } else coach.hidden = true;
  }
  function renderPays() {
    const b = bet();
    $('pay-bet').textContent = fmt(b) + ' €';
    const cur = on() || (S.game && S.game.dice) ? E.evaluate(S.game ? S.game.dice : [0, 0, 0]).id : '';
    $('pays').innerHTML = '<span class="h">Combinaison</span><span class="h">1er lancer</span><span class="h">2e lancer</span>'
      + E.PAYS.map((p) => '<span class="' + (p.id === cur ? 'hit' : '') + '">' + p.name + '</span><b>' + fmt(b * p.mult * E.BONUS[0]) + ' €</b><b>' + fmt(b * p.mult) + ' €</b>').join('');
  }
  function ui() {
    const g = S.game;
    $('bet').textContent = fmt(bet()) + ' €'; $('stack').textContent = fmt(S.stack) + ' €';
    $('bet-minus').disabled = S.busy || on() || S.betIx <= 0; $('bet-plus').disabled = S.busy || on() || S.betIx >= bets().length - 1;
    $('end-btn').disabled = S.busy || on();
    const relaunch = on() && g.throws < E.ROLLS;
    $('roll').textContent = relaunch ? '🎲 Relancer ' + (3 - S.keep.filter(Boolean).length) + ' dé' + (3 - S.keep.filter(Boolean).length > 1 ? 's' : '') : '🎲 Lancer · ' + fmt(bet()) + ' €';
    $('roll').disabled = S.busy || (relaunch ? S.keep.every(Boolean) : bet() > S.stack);
    $('stop').hidden = !on();
    $('stop').disabled = S.busy;
    if (on()) { const m = E.payMult(g.dice, g.throws); $('stop').textContent = m ? '✋ Je garde · +' + fmt(g.bet * m) + ' €' : '✋ Je m\'arrête (rien)'; }
    document.querySelector('.dq-acts').classList.toggle('two', on());
    $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–';
    renderPays();
  }
  function msg(t) { $('msg').textContent = t; }
  function showCombo(c, mult, final) {
    const el = $('combo'); el.className = 'dq-combo';
    el.textContent = c.mult ? c.name + (mult ? ' · ×' + String(mult).replace('.', ',') : '') : (final ? 'Rien…' : '');
    if (c.mult) { void el.offsetWidth; el.classList.add('big'); }
  }

  async function roll() {
    if (S.busy) return;
    const relaunch = on();
    if (!relaunch && bet() > S.stack) return;
    if (relaunch && S.keep.every(Boolean)) return;
    S.busy = true; ui();
    if (srv()) Casino.hold();
    $('dice').classList.add('shaking'); if (window.Sfx && Sfx.drumroll) Sfx.drumroll(0.5);
    const data = relaunch ? { keep: S.keep.slice() } : { bet: bet() };
    const [r] = await Promise.all([api('dq.roll', data), sleep(550)]);
    $('dice').classList.remove('shaking');
    if (!r || r.error) { S.busy = false; if (window.Casino && Casino.holding) Casino.release(); msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    const rolled = relaunch ? S.keep.map((k) => !k) : [true, true, true];
    if (!relaunch) { S.game = { bet: data.bet, dice: r.dice, throws: 1, active: true }; S.keep = [false, false, false]; }
    S.game.dice = r.dice; S.game.throws = r.throws; S.stack = r.stack;
    if (window.Sfx) { Sfx.clack ? [0, 1, 2].forEach((k) => setTimeout(() => Sfx.clack(0.6), k * 90)) : Sfx.chips(); }
    renderDice(rolled);
    await sleep(500);
    if (r.done) {
      S.game.active = false;
      showCombo(r.combo, r.mult, true);
      if (r.payout > 0) { msg('+' + fmt(r.payout) + ' € !'); if (window.Sfx) Sfx.win(); if (r.combo.id === '421' && window.Casino && Casino.bigWin) Casino.bigWin(r.payout, '4-2-1 !'); }
      else { msg('Pas de combinaison cette fois.'); if (window.Sfx && Sfx.lose) Sfx.lose(); }
    } else {
      showCombo(r.combo, r.mult, false);
      msg(r.combo.mult ? 'Tu gardes (×1,5) ou tu tentes mieux ?' : 'Touche les dés à garder, puis relance.');
    }
    S.busy = false; renderDice(); ui();
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 600);
  }
  async function stop() {
    if (S.busy || !on()) return;
    S.busy = true; ui();
    const r = await api('dq.stop');
    S.busy = false;
    if (!r || r.error) { msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    S.game.active = false; S.stack = r.stack;
    showCombo(r.combo, r.mult, true);
    if (r.payout > 0) { msg('+' + fmt(r.payout) + ' € !' + (r.throws === 1 ? ' (bonus ×1,5)' : '')); if (window.Sfx) Sfx.win(); if (r.combo.id === '421' && window.Casino && Casino.bigWin) Casino.bigWin(r.payout, '4-2-1 !'); }
    else msg('Rien cette fois.');
    renderDice(); ui();
  }
  $('roll').addEventListener('click', roll);
  $('stop').addEventListener('click', stop);
  $('bet-minus').addEventListener('click', () => { S.betIx = Math.max(0, S.betIx - 1); ui(); if (window.Sfx) Sfx.chips(); });
  $('bet-plus').addEventListener('click', () => { S.betIx = Math.min(bets().length - 1, S.betIx + 1); ui(); if (window.Sfx) Sfx.chips(); });

  // ---------- secouer le téléphone pour lancer ----------
  let lastShake = 0, shakeOn = false;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
    const f = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
    if (f > 32 && Date.now() - lastShake > 1200 && !$('game').hidden && !S.busy) { lastShake = Date.now(); roll(); }
  }
  function enableShake() {
    if (shakeOn) return;
    shakeOn = true; window.addEventListener('devicemotion', onMotion); $('shake-btn').hidden = true;
  }
  if (typeof DeviceMotionEvent !== 'undefined') {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      // iPhone : il faut l'autorisation de l'utilisateur
      $('shake-btn').hidden = false;
      $('shake-btn').onclick = () => DeviceMotionEvent.requestPermission().then((s) => { if (s === 'granted') enableShake(); else $('shake-btn').textContent = 'Secousses refusées : utilise le bouton Lancer'; }).catch(() => {});
    } else if ('ontouchstart' in window) enableShake();
  }

  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount; S.game = null; S.keep = [false, false, false];
    if (window.Casino) Casino.training = mode === 'train';
    const bs = bets(); S.betIx = Math.max(0, bs.findIndex((x) => x >= amount / 40)); if (bs[S.betIx] > amount) S.betIx = 0;
    $('setup').hidden = true; $('game').hidden = false;
    $('mode-badge').textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse · secoue pour lancer !' : '🎓 Apprentissage · crédit illimité · conseils du coach';
    $('end-btn').hidden = mode === 'train';
    showCombo({ mult: 0 }, 0, false); renderDice(); ui();
  }
  async function endSession() {
    if (S.busy || on()) return;
    if (S.mode === 'real') { const r = await Casino.cashOut('des'); if (r && r.error) { msg(r.error); return; } }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false; renderPicker();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker() { Casino.modePicker($('mode-picker'), { game: 'des', min: 1, onStart: (mode, amount) => startGame(mode, amount) }); }
  renderPicker(); renderDice(); ui();
  if (window.Casino) Casino.onChange(() => { if (!S.busy) $('wallet').textContent = fmt(Casino.wallet()); });
  window.Des421 = { get state() { return S; }, roll, stop };
})();
