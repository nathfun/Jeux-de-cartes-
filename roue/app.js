/* Roue de la fortune : un jeu de la partie Le Parrain (débloqué dès le palier 1). Le serveur tire la case. */
(function () {
  'use strict';
  const R = window.CasinoRules, SEG = R.FORTUNE;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const S = { mode: null, stack: 0, betIx: 0, busy: false, angle: 0, hist: [] };
  const TOTAL = SEG.reduce((a, x) => a + x.w, 0);
  // une case = une part égale de la roue, dans l'ordre défini par les règles
  const ORDER = SEG.map((x, i) => ({ i, w: x.w }));
  let acc = 0; ORDER.forEach((p) => { p.a0 = acc / TOTAL * Math.PI * 2; acc += p.w; p.a1 = acc / TOTAL * Math.PI * 2; });
  const label = (m) => (m === 0 ? '💀' : '×' + String(m).replace('.', ','));

  // palette « fête foraine » selon le multiplicateur (les règles gardent leurs couleurs pour le serveur)
  const PAL = { 5: ['#fde68a', '#f59e0b', '#92400e'], 2: ['#86efac', '#16a34a', '#14532d'], 1.5: ['#93c5fd', '#2563eb', '#1e3a8a'], 0: ['#3f1d2b', '#1f0f17', '#0b0508'] };
  const pal = (m, k) => (PAL[m] || PAL[0]);
  const colorOf = (m) => pal(m)[1];
  const cv = $('wheel'), cx = cv.getContext('2d');
  let winIdx = -1, winAt = 0, spinning = false;
  function draw(now) {
    now = now || performance.now();
    const W = cv.width, C = W / 2, R0 = W / 2 - 8, rim = 34, r = R0 - rim;
    cx.clearRect(0, 0, W, W);
    // halo
    const halo = cx.createRadialGradient(C, C, r * 0.8, C, C, R0 + 6);
    halo.addColorStop(0, 'rgba(250,204,21,0)'); halo.addColorStop(1, spinning ? 'rgba(250,204,21,.35)' : 'rgba(250,204,21,.15)');
    cx.fillStyle = halo; cx.beginPath(); cx.arc(C, C, R0 + 6, 0, Math.PI * 2); cx.fill();
    // jante dorée
    const g = cx.createLinearGradient(0, 0, W, W);
    g.addColorStop(0, '#fff3c4'); g.addColorStop(0.25, '#f59e0b'); g.addColorStop(0.5, '#92400e'); g.addColorStop(0.75, '#fbbf24'); g.addColorStop(1, '#78350f');
    cx.beginPath(); cx.arc(C, C, R0, 0, Math.PI * 2); cx.fillStyle = g; cx.fill();
    cx.beginPath(); cx.arc(C, C, R0 - rim + 3, 0, Math.PI * 2); cx.fillStyle = '#1a0d05'; cx.fill();
    // ampoules : chenillard (plus rapide pendant le tirage, tout clignote sur un gros gain)
    const N = 24, phase = Math.floor(now / (spinning ? 70 : 380));
    const flash = winIdx >= 0 && now - winAt < 2600 && SEG[winIdx].m >= 2;
    for (let k = 0; k < N; k++) {
      const a = k / N * Math.PI * 2 + S.angle * 0.0, x = C + Math.cos(a) * (R0 - rim / 2), y = C + Math.sin(a) * (R0 - rim / 2);
      const on = flash ? Math.floor(now / 140) % 2 === 0 : (k + phase) % 3 === 0;
      const bg = cx.createRadialGradient(x - 2, y - 2, 1, x, y, 9);
      bg.addColorStop(0, on ? '#fffbea' : '#7c5a1f'); bg.addColorStop(1, on ? '#facc15' : '#3b2a0f');
      if (on) { cx.shadowColor = '#fde047'; cx.shadowBlur = 16; }
      cx.beginPath(); cx.arc(x, y, 8, 0, Math.PI * 2); cx.fillStyle = bg; cx.fill(); cx.shadowBlur = 0;
    }
    // les cases
    cx.save(); cx.translate(C, C); cx.rotate(S.angle);
    ORDER.forEach((p, k) => {
      const s = SEG[p.i], [c0, c1, c2] = pal(s.m);
      const a0 = p.a0 - Math.PI / 2, a1 = p.a1 - Math.PI / 2;
      const zero = !s.m, alt = zero && k % 2;
      const gr = cx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
      gr.addColorStop(0, zero ? (alt ? '#2a1520' : '#331a26') : c0); gr.addColorStop(0.55, zero ? (alt ? '#1a0c12' : '#24121b') : c1); gr.addColorStop(1, zero ? '#0b0508' : c2);
      cx.beginPath(); cx.moveTo(0, 0); cx.arc(0, 0, r, a0, a1); cx.closePath(); cx.fillStyle = gr; cx.fill();
      // case gagnante : surbrillance qui pulse
      if (p.i === winIdx && now - winAt < 3500) { cx.fillStyle = 'rgba(255,255,255,' + (0.12 + 0.12 * Math.sin(now / 120)) + ')'; cx.fill(); }
      // liseré doré entre les cases
      cx.strokeStyle = 'rgba(253,230,138,.55)'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); cx.stroke();
      // étiquette le long du rayon
      cx.save(); cx.rotate((p.a0 + p.a1) / 2); cx.translate(0, -r * 0.66);
      const abs = (((p.a0 + p.a1) / 2 + S.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (abs > Math.PI / 2 && abs < Math.PI * 1.5) cx.rotate(Math.PI);
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      if (zero) { cx.font = '30px system-ui'; cx.globalAlpha = 0.55; cx.fillText('💀', 0, 0); cx.globalAlpha = 1; }
      else {
        cx.font = '900 ' + (s.m >= 5 ? 50 : 40) + 'px system-ui';
        cx.lineWidth = 7; cx.strokeStyle = 'rgba(0,0,0,.55)'; cx.strokeText(label(s.m), 0, 0);
        cx.fillStyle = s.m >= 5 ? '#fff7d6' : '#ffffff'; cx.fillText(label(s.m), 0, 0);
        if (s.m >= 5) { cx.font = '900 15px system-ui'; cx.fillStyle = '#fff3c4'; cx.fillText('JACKPOT', 0, 34); }
      }
      cx.restore();
      // picot doré au bord de chaque case
      cx.beginPath(); cx.arc(Math.cos(a0) * (r - 6), Math.sin(a0) * (r - 6), 5, 0, Math.PI * 2); cx.fillStyle = '#fde68a'; cx.fill();
      cx.strokeStyle = '#78350f'; cx.lineWidth = 1.5; cx.stroke();
    });
    cx.restore();
    // ombre intérieure (profondeur)
    const sh = cx.createRadialGradient(C, C, r * 0.55, C, C, r);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.35)');
    cx.beginPath(); cx.arc(C, C, r, 0, Math.PI * 2); cx.fillStyle = sh; cx.fill();
    // moyeu métallique
    const hub = cx.createRadialGradient(C - 14, C - 14, 4, C, C, 58);
    hub.addColorStop(0, '#fffbea'); hub.addColorStop(0.35, '#facc15'); hub.addColorStop(0.8, '#a16207'); hub.addColorStop(1, '#713f12');
    cx.beginPath(); cx.arc(C, C, 58, 0, Math.PI * 2); cx.fillStyle = hub; cx.shadowColor = 'rgba(0,0,0,.6)'; cx.shadowBlur = 18; cx.fill(); cx.shadowBlur = 0;
    cx.beginPath(); cx.arc(C, C, 44, 0, Math.PI * 2); cx.strokeStyle = 'rgba(120,53,15,.7)'; cx.lineWidth = 3; cx.stroke();
    cx.fillStyle = '#7c2d12'; cx.font = '900 40px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('★', C, C + 2); cx.textBaseline = 'alphabetic';
  }
  // animation permanente des ampoules (légère : ~25 images/s au repos)
  let lastIdle = 0;
  (function idle(t) { if (!spinning && t - lastIdle > 40) { lastIdle = t; draw(t); } requestAnimationFrame(idle); })(0);
  function tickPointer() { const p = document.querySelector('.rw-pointer'); if (!p) return; p.classList.remove('tick'); void p.offsetWidth; p.classList.add('tick'); }
  const groups = {}; SEG.forEach((s) => { groups[s.m] = groups[s.m] || { m: s.m, c: colorOf(s.m), w: 0 }; groups[s.m].w += s.w; });
  $('legend').innerHTML = Object.values(groups).sort((a, b) => b.m - a.m).map((g) => '<span><i style="background:' + g.c + '"></i>' + label(g.m) + ' · ' + g.w + ' case' + (g.w > 1 ? 's' : '') + ' sur ' + TOTAL + '</span>').join('');

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
    $('history').innerHTML = S.hist.slice(-14).reverse().map((h) => '<li style="background:' + colorOf(SEG[h].m) + '">' + label(SEG[h].m) + '</li>').join('');
  }
  function showWallet() { $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–'; $('stack-label').textContent = S.mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table'; }

  function animateTo(idx) {
    // un morceau de la case tirée, au hasard, puis un point au hasard dedans
    const p = ORDER[idx];
    const target = p.a0 + (p.a1 - p.a0) * (0.15 + Math.random() * 0.7);
    const from = S.angle, base = from - (from % (Math.PI * 2));
    const end = base + Math.PI * 2 * 6 + (Math.PI * 2 - target);
    const t0 = performance.now(), dur = 5200, segA = Math.PI * 2 / ORDER.length;
    spinning = true; winIdx = -1;
    return new Promise((res) => {
      let lastPeg = Math.floor(from / segA);
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        S.angle = from + (end - from) * e; draw(t);
        // l'aiguille claque sur chaque picot qui passe
        const peg = Math.floor(S.angle / segA);
        if (peg !== lastPeg) { lastPeg = peg; tickPointer(); if (window.Sfx && Sfx.peg) Sfx.peg(6, 12); }
        if (k < 1) requestAnimationFrame(step); else { spinning = false; winIdx = idx; winAt = performance.now(); res(); }
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
      Casino.hold();
      const r = await Casino.call('wh.spin', { bet: b });
      if (!r || r.error || r.index === undefined) { Casino.release(); S.stack += b; S.busy = false; ui(); if (r && r.error) Casino.toast('Roue', r.error, '⚠️', 'loss'); return; }
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
    el.className = 'rw-result' + (win > b ? ' win' : !win ? ' lose' : '');
    if (window.Sfx) { if (win > b) Sfx.win(); else if (!win && Sfx.lose) Sfx.lose(); }
    if (SEG[idx].m >= 5 && window.Casino && Casino.bigWin) setTimeout(() => Casino.bigWin(win, 'JACKPOT ×5 !'), 500);
    S.busy = false; ui(); showWallet();
    if (window.Casino && Casino.release) setTimeout(() => Casino.release(), 600);
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
    badge.textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse' : '🎓 Apprentissage · crédit illimité';
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
