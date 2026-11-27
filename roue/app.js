/* Roue de la fortune : un jeu de la partie La Dette (débloqué dès le palier 1). Le serveur tire la case. */
(function () {
  'use strict';
  const R = window.CasinoRules, SEG = R.FORTUNE;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const S = { mode: null, stack: 0, betIx: 0, busy: false, angle: 0, hist: [] };
  const TOTAL = SEG.reduce((a, x) => a + x.w, 0);
  // cases étalées sur la roue : les grosses cases sont réparties entre les petites
  const ORDER = [];
  (function build() {
    // les cases gagnantes (×1,5 et plus) sont découpées en morceaux et intercalées entre les cases ×0 et ×0,5
    const groups = SEG.map((x, i) => i).filter((i) => SEG[i].m >= 1.5).map((i) => { const k = Math.max(1, Math.round(SEG[i].w / 6)); return Array.from({ length: k }, () => ({ i, w: SEG[i].w / k })); });
    const big = [];
    while (groups.some((g) => g.length)) groups.forEach((g) => { if (g.length) big.push(g.shift()); });
    const n = big.length, half = Math.ceil(n / 2);
    big.forEach((p, k) => { ORDER.push(p); ORDER.push({ i: 0, w: SEG[0].w / n }); if (k % 2 === 0) ORDER.push({ i: 1, w: SEG[1].w / half }); });
  })();
  // angles de départ de chaque morceau
  let acc = 0; ORDER.forEach((p) => { p.a0 = acc / TOTAL * Math.PI * 2; acc += p.w; p.a1 = acc / TOTAL * Math.PI * 2; });
  const label = (m) => (m === 0 ? '×0' : '×' + String(m).replace('.', ','));

  const cv = $('wheel'), cx = cv.getContext('2d');
  function draw() {
    const W = cv.width, r = W / 2 - 12;
    cx.clearRect(0, 0, W, W);
    cx.save(); cx.translate(W / 2, W / 2); cx.rotate(S.angle);
    ORDER.forEach((p) => {
      const s = SEG[p.i];
      cx.beginPath(); cx.moveTo(0, 0); cx.arc(0, 0, r, p.a0 - Math.PI / 2, p.a1 - Math.PI / 2); cx.closePath();
      cx.fillStyle = s.c; cx.fill(); cx.strokeStyle = 'rgba(0,0,0,.35)'; cx.lineWidth = 2; cx.stroke();
      if (p.a1 - p.a0 > 0.09) {
        cx.save(); cx.rotate((p.a0 + p.a1) / 2); cx.fillStyle = '#fff'; cx.font = '800 ' + (p.a1 - p.a0 > 0.25 ? 30 : 22) + 'px system-ui'; cx.textAlign = 'center';
        cx.fillText(label(s.m), 0, -r + 42); cx.restore();
      }
    });
    cx.restore();
    // jante et moyeu
    cx.beginPath(); cx.arc(W / 2, W / 2, r + 4, 0, Math.PI * 2); cx.lineWidth = 10; cx.strokeStyle = '#b45309'; cx.stroke();
    cx.beginPath(); cx.arc(W / 2, W / 2, 46, 0, Math.PI * 2); cx.fillStyle = '#facc15'; cx.fill();
    cx.fillStyle = '#1c1300'; cx.font = '900 34px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('🎡', W / 2, W / 2 + 2); cx.textBaseline = 'alphabetic';
  }
  $('legend').innerHTML = SEG.map((s) => '<span><i style="background:' + s.c + '"></i>' + label(s.m) + ' · ' + (s.w / TOTAL * 100).toFixed(1).replace('.', ',') + ' %</span>').join('');

  const bets = () => {
    const max = window.Casino && S.mode === 'real' ? Casino.maxBet() : 500, min = window.Casino && S.mode === 'real' ? Casino.minBet('wheel') : 1;
    return R.BET_STEPS.filter((b) => b >= min && b <= max);
  };
  const bet = () => bets()[Math.min(S.betIx, bets().length - 1)];
  function ui() {
    $('bet').textContent = fmt(bet()) + ' €';
    $('stack').textContent = fmt(S.stack) + ' €';
    $('spin').disabled = S.busy || bet() > S.stack;
    $('bet-minus').disabled = S.busy || S.betIx <= 0; $('bet-plus').disabled = S.busy || S.betIx >= bets().length - 1;
    $('end-btn').disabled = S.busy;
    $('history').innerHTML = S.hist.slice(-14).reverse().map((h) => '<li style="background:' + SEG[h].c + '">' + label(SEG[h].m) + '</li>').join('');
  }
  function showWallet() { $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–'; $('stack-label').textContent = S.mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table'; }

  function animateTo(idx) {
    // un morceau de la case tirée, au hasard, puis un point au hasard dedans
    const ps = ORDER.filter((p) => p.i === idx), p = ps[Math.floor(Math.random() * ps.length)];
    const target = p.a0 + (p.a1 - p.a0) * (0.15 + Math.random() * 0.7);
    const from = S.angle, base = from - (from % (Math.PI * 2));
    const end = base + Math.PI * 2 * 6 + (Math.PI * 2 - target);
    const t0 = performance.now(), dur = 4200;
    return new Promise((res) => {
      let lastTick = 0;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        S.angle = from + (end - from) * e; draw();
        if (window.Sfx && Sfx.peg && t - lastTick > 40 + 260 * e) { lastTick = t; Sfx.peg(6, 12); }
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }
  async function spin() {
    const b = bet();
    if (S.busy || !(b <= S.stack)) return;
    S.busy = true; $('rw-result').textContent = ''; $('rw-result').className = 'rw-result';
    S.stack -= b; ui();
    let idx, win;
    if (S.mode === 'real' && window.Casino && Casino.server) {
      const r = await Casino.call('wh.spin', { bet: b });
      if (!r || r.error || r.index === undefined) { S.stack += b; S.busy = false; ui(); if (r && r.error) Casino.toast('Roue', r.error, '⚠️', 'loss'); return; }
      idx = r.index; win = r.win;
      await animateTo(idx); S.stack = r.stack;
    } else {
      let x = Math.floor(Math.random() * TOTAL); idx = 0;
      while (x >= SEG[idx].w) { x -= SEG[idx].w; idx++; }
      win = Math.round(b * SEG[idx].m * 100) / 100;
      await animateTo(idx); S.stack += win;
      if (S.mode === 'real' && window.Casino) Casino.setStack('wheel', S.stack);
    }
    S.hist.push(idx);
    const el = $('rw-result');
    el.textContent = win > 0 ? '+' + fmt(win) + ' €' : 'Perdu';
    el.className = 'rw-result' + (win > b ? ' win' : '');
    if (window.Sfx) { if (win > b) Sfx.win(); else if (!win && Sfx.lose) Sfx.lose(); }
    if (SEG[idx].m >= 10 && window.Casino && Casino.bigWin) Casino.bigWin(win, b);
    S.busy = false; ui(); showWallet();
  }
  $('spin').addEventListener('click', spin);
  $('bet-minus').addEventListener('click', () => { S.betIx = Math.max(0, S.betIx - 1); ui(); if (window.Sfx) Sfx.chips(); });
  $('bet-plus').addEventListener('click', () => { S.betIx = Math.min(bets().length - 1, S.betIx + 1); ui(); if (window.Sfx) Sfx.chips(); });

  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount; S.hist = [];
    if (window.Casino) Casino.training = mode === 'train';
    const bs = bets(); S.betIx = Math.max(0, bs.findIndex((b) => b >= amount / 20)) ; if (bs[S.betIx] > amount) S.betIx = 0;
    $('setup').hidden = true; $('game').hidden = false;
    const badge = $('mode-badge'); badge.hidden = false;
    badge.textContent = mode === 'real' ? '🕴️ La Dette · ta caisse' : '🎓 Apprentissage · crédit illimité';
    $('end-btn').hidden = mode === 'train';
    draw(); ui(); showWallet();
  }
  async function endSession() {
    if (S.busy) return;
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('wheel');
      if (r && r.error) { Casino.toast('Roue', r.error, '⚠️', 'loss'); return; }
      const diff = r ? r.diff : 0;
      msg = 'Tu ramènes ' + fmt(r ? r.end : S.stack) + ' € dans ta caisse (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' €).';
    }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false;
    renderPicker(msg); showWallet();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 1000); return; }
    Casino.modePicker(box, { game: 'wheel', min: 1, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  draw(); renderPicker(); showWallet();
  if (window.Casino) Casino.onChange(() => showWallet());
  window.Roue = { get state() { return S; }, spin };
})();
