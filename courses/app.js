/* Course de chevaux (Le Parrain, palier 3) : on parie sur un ou plusieurs chevaux, le serveur tire le vainqueur. */
(function () {
  'use strict';
  const R = window.CasinoRules, H = R.HORSES;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const S = { mode: null, stack: 0, card: null, bets: {}, chip: 0, busy: false, hist: [] };
  const rndLocal = (n) => Math.floor(Math.random() * n);
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;

  // ---------- Piste ----------
  const track = $('track');
  track.innerHTML = '<div class="hc-finish"></div>' + H.map((h, i) => '<div class="hc-lane"><span class="num" style="background:' + h.c + '">' + (i + 1) + '</span><span class="horse" id="h' + i + '">🏇</span></div>').join('');
  const horseEl = (i) => $('h' + i);
  function resetTrack() { H.forEach((h, i) => { horseEl(i).style.left = '28px'; }); }
  /** Anime la course : chaque cheval a son allure (tirée d'une graine), le vainqueur passe la ligne en premier. */
  function runRace(win, seed) {
    let a = seed >>> 0;
    const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const dur = 6500, K = 14;
    const finish = H.map((_, i) => (i === win ? 0 : 0.04 + rand() * 0.16)); // retard à l'arrivée (en part de la course)
    const curves = H.map((_, i) => { const steps = []; let tot = 0; for (let k = 0; k < K; k++) { const v = 0.6 + rand(); steps.push(v); tot += v; } return steps.map((v) => v / tot); });
    const width = track.clientWidth - 28 - 60;
    return new Promise((res) => {
      const t0 = performance.now();
      let lastGallop = 0;
      const frame = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        H.forEach((_, i) => {
          const local = Math.min(1, k / (1 - finish[i] * 0.6)), pos = local * K, n = Math.floor(pos);
          let x = 0; for (let j = 0; j < Math.min(n, K); j++) x += curves[i][j];
          if (n < K) x += curves[i][n] * (pos - n);
          const ahead = i === win ? 1 : 1 - finish[i];
          horseEl(i).style.left = (28 + Math.min(1, x) * width * ahead) + 'px';
        });
        if (window.Sfx && Sfx.peg && t - lastGallop > 140) { lastGallop = t; Sfx.peg(3, 12); }
        if (k < 1) requestAnimationFrame(frame); else res();
      };
      requestAnimationFrame(frame);
    });
  }

  // ---------- Paris ----------
  const chips = () => { const min = S.mode === 'real' ? Casino.minBet('horses') : 1, max = S.mode === 'real' ? Casino.maxBet() : 500; return [1, 5, 10, 25].map((m) => min * m).filter((v) => v <= max); };
  function renderChips() {
    const box = $('chips'); box.innerHTML = '';
    const list = chips(); if (!list.includes(S.chip)) S.chip = list[1] || list[0];
    const colors = ['#6d6d6d', '#b71c1c', '#1565c0', '#2e7d32'];
    list.forEach((v, k) => { const b = document.createElement('button'); b.type = 'button'; b.style.background = colors[k]; b.textContent = v >= 1000 ? v / 1000 + 'k' : v; b.className = v === S.chip ? 'on' : ''; b.onclick = () => { S.chip = v; renderChips(); if (window.Sfx) Sfx.chips(); }; box.appendChild(b); });
  }
  const staked = () => Object.values(S.bets).reduce((a, b) => a + b, 0);
  function renderCard() {
    const box = $('card'); box.innerHTML = '';
    if (!S.card) return;
    H.forEach((h, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hc-h' + (S.bets[i] ? ' bet' : '');
      const p = S.card.p[i];
      b.innerHTML = '<span class="dot"></span><span class="nm"><b></b><small></small></span><span class="od"></span><span class="mb"></span>';
      b.querySelector('.dot').style.background = h.c; b.querySelector('.dot').textContent = i + 1;
      b.querySelector('b').textContent = h.name;
      b.querySelector('small').textContent = p >= 0.25 ? 'Grand favori' : p >= 0.17 ? 'Favori' : p >= 0.12 ? 'Outsider' : 'Gros coup';
      b.querySelector('.od').textContent = '×' + String(S.card.odds[i]).replace('.', ',');
      b.querySelector('.mb').textContent = S.bets[i] ? fmt(S.bets[i]) + ' €' : '';
      b.onclick = () => {
        if (S.busy) return;
        const max = S.mode === 'real' ? Casino.maxBet() : 500;
        if ((S.bets[i] || 0) + S.chip > max) { result('Au plus ' + fmt(max) + ' € par cheval.', false); return; }
        if (staked() + S.chip > S.stack) { result('Pas assez d\'argent sur la table.', false); return; }
        S.bets[i] = (S.bets[i] || 0) + S.chip; if (window.Sfx) Sfx.chips(); renderCard(); ui();
      };
      box.appendChild(b);
    });
  }
  function result(t, good) { const r = $('hc-result'); r.textContent = t; r.className = 'hc-result' + (good ? ' win' : ''); }
  function ui() {
    $('stack').textContent = fmt(S.stack - staked()) + ' €';
    $('go').disabled = S.busy || !staked();
    $('go').textContent = staked() ? '🏁 Lancer la course · ' + fmt(staked()) + ' €' : '🏁 Choisis ton cheval';
    $('clear').disabled = S.busy || !staked();
    $('end-btn').disabled = S.busy;
    $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–';
    $('history').innerHTML = S.hist.slice(-12).reverse().map((w) => '<li style="background:' + H[w].c + '">' + (w + 1) + '</li>').join('');
  }
  async function loadCard() {
    if (srv()) { const r = await Casino.call('hc.card', {}); if (r && r.card) S.card = r.card; }
    else S.card = R.horseCard(rndLocal);
    renderCard(); ui();
  }
  async function go() {
    if (S.busy || !staked()) return;
    S.busy = true; result('', false); ui(); resetTrack();
    track.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let r;
    if (srv()) {
      Casino.hold();
      r = await Casino.call('hc.race', { bets: S.bets });
      if (!r || r.error) { Casino.release(); S.busy = false; result((r && r.error) || 'Course annulée.', false); ui(); return; }
    } else {
      const win = R.horseRace(S.card, rndLocal), back = Math.round((S.bets[win] || 0) * S.card.odds[win] * 100) / 100;
      r = { win, back, staked: staked(), seed: rndLocal(1e9), next: R.horseCard(rndLocal), stack: S.stack - staked() + back };
      if (S.mode === 'real' && window.Casino) Casino.setStack('horses', r.stack);
    }
    if (window.Sfx && Sfx.drumroll) Sfx.drumroll(0.8);
    await runRace(r.win, r.seed);
    S.hist.push(r.win);
    S.stack = r.stack;
    if (r.back > 0) { result('🏆 ' + H[r.win].name + ' gagne ! +' + fmt(r.back) + ' €', true); if (window.Sfx) Sfx.win(); if (r.back >= r.staked * 8 && Casino.bigWin) Casino.bigWin(r.back, 'GROS COUP !'); }
    else { result('🏁 ' + H[r.win].name + ' gagne… pas ton cheval.', false); if (window.Sfx && Sfx.lose) Sfx.lose(); }
    S.bets = {}; S.card = r.next;
    S.busy = false; renderCard(); ui();
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 700);
  }
  $('go').addEventListener('click', go);
  $('clear').addEventListener('click', () => { S.bets = {}; renderCard(); ui(); });

  // ---------- Début et fin ----------
  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount; S.bets = {}; S.hist = [];
    if (window.Casino) Casino.training = mode === 'train';
    $('setup').hidden = true; $('game').hidden = false;
    $('mode-badge').textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse' : '🎓 Apprentissage · crédit illimité';
    $('end-btn').hidden = mode === 'train';
    renderChips(); loadCard(); resetTrack(); ui();
  }
  async function endSession() {
    if (S.busy) return;
    if (S.mode === 'real') { const r = await Casino.cashOut('horses'); if (r && r.error) { result(r.error, false); return; } }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false; renderPicker();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker() { Casino.modePicker($('mode-picker'), { game: 'horses', min: 1, onStart: (mode, amount) => startGame(mode, amount) }); }
  renderPicker(); ui();
  if (window.Casino) Casino.onChange(() => { if (!S.busy) $('wallet').textContent = fmt(Casino.wallet()); });
  window.Courses = { get state() { return S; }, go };
})();
