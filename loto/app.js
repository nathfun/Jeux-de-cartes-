/*
 * Loto Express — interface : grille de 30 numéros, sphère animée, tirage de 10 boules, table des gains.
 * En partie réelle, c'est le serveur du Casino qui tire les boules ; l'app les fait sortir une à une.
 */
(function () {
  'use strict';
  const E = window.LotoEngine, C = E.CONFIG;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: Math.abs(n % 1) > 0.001 ? 2 : 0, maximumFractionDigits: 2 });
  const fmtM = (m) => '×' + m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const KEY = 'loto-v1';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Données enregistrées ----------
  const blankStats = () => ({ rounds: 0, wagered: 0, won: 0, best: 0 });
  let store = { picks: [3, 9, 14, 22, 27], hist: [], seeds: null, stats: { real: blankStats(), train: blankStats() }, bets: { real: [], train: [] } };
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw) store = Object.assign(store, raw); } catch (e) { /* ignore */ }
  // grilles enregistrées avant le passage à 30 numéros : on retire ce qui dépasse
  store.picks = (store.picks || []).filter((n) => Number.isInteger(n) && n >= 1 && n <= C.N).slice(0, C.MAX_PICK);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };
  async function ensureSeeds() {
    if (store.seeds && store.seeds.server) return store.seeds;
    const server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: E.randomSeed().slice(0, 16), nonce: 0 };
    persist(); return store.seeds;
  }

  // ---------- État ----------
  const S = { mode: null, stack: 0 };
  let busy = false, auto = 0, lastDraw = null;
  const statsOf = () => store.stats[S.mode === 'real' ? 'real' : 'train'];
  const betsKey = () => (S.mode === 'real' ? 'real' : 'train');
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  function setStack(v) { S.stack = Math.max(0, Math.round(v * 100) / 100); if (S.mode === 'real' && window.Casino) Casino.setStack('loto', S.stack); }
  const readBet = () => Math.floor(Number($('bet').value));
  function maxB() { return Math.min(C.MAX_BET, window.Casino && S.mode === 'real' ? Casino.maxBet() : C.MAX_BET); }
  // Le Parrain : mise minimale du palier (10 € au palier 1) ; apprentissage : celle du jeu
  function minB() { return window.Casino && S.mode === 'real' && Casino.minBet ? Math.max(C.MIN_BET, Casino.minBet('loto')) : C.MIN_BET; }

  // ---------- Grille ----------
  const nums = [];
  for (let n = 1; n <= C.N; n++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lo-num'; b.textContent = n; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => toggle(n));
    $('grid').appendChild(b); nums.push(b);
  }
  function toggle(n) {
    if (busy) return;
    clearDraw();
    const i = store.picks.indexOf(n);
    if (i >= 0) store.picks.splice(i, 1);
    else if (store.picks.length >= C.MAX_PICK) { toast('Au plus ' + C.MAX_PICK + ' numéros.', true); return; }
    else store.picks.push(n);
    persist(); if (window.Sfx) Sfx.chips(); ui();
  }
  function flash(k) {
    if (busy) return;
    clearDraw();
    const all = Array.from({ length: C.N }, (_, i) => i + 1), out = [];
    while (out.length < k) out.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
    store.picks = out.sort((a, b) => a - b); persist();
    if (window.Sfx) Sfx.chips(); ui();
  }
  function clearDraw() {
    if (!lastDraw) return;
    lastDraw = null;
    nums.forEach((b) => b.classList.remove('drawn', 'hit'));
    renderTray([]); $('hits').textContent = '–'; $('result').hidden = true;
  }
  function renderTray(balls, hits) {
    const t = $('tray'); t.innerHTML = '';
    for (let i = 0; i < C.DRAW; i++) {
      if (i < balls.length) { const b = document.createElement('div'); b.className = 'lo-ball' + (hits && hits.has(balls[i]) ? ' hit' : ''); b.textContent = balls[i]; t.appendChild(b); }
      else { const s = document.createElement('div'); s.className = 'slot'; t.appendChild(s); }
    }
  }

  // ---------- Sphère (les boules s'agitent, plus fort pendant le tirage) ----------
  const cv = $('drum'), cx = cv.getContext('2d');
  const R = 150, BR = 14;
  const balls = Array.from({ length: C.N }, (_, i) => ({ n: i + 1, x: (Math.random() - 0.5) * 160, y: 40 + Math.random() * 60, vx: (Math.random() - 0.5) * 2, vy: 0, out: false }));
  let energy = 0.6, popping = null;
  function drumStep() {
    const g = 0.18;
    balls.forEach((b) => {
      if (b.out) return;
      b.vy += g; b.x += b.vx; b.y += b.vy;
      // souffle d'air depuis le bas pendant le tirage
      if (Math.random() < energy * 0.08 && b.y > 40) { b.vy -= 4 + Math.random() * 6 * energy; b.vx += (Math.random() - 0.5) * 6 * energy; }
      const d = Math.hypot(b.x, b.y), lim = R - BR - 6;
      if (d > lim) { const nx = b.x / d, ny = b.y / d, dot = b.vx * nx + b.vy * ny; b.vx -= 1.8 * dot * nx; b.vy -= 1.8 * dot * ny; b.x = nx * lim; b.y = ny * lim; b.vx *= 0.92; b.vy *= 0.92; }
    });
  }
  const COLORS = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc'];
  function drumDraw() {
    const w = cv.width, h = cv.height;
    cx.clearRect(0, 0, w, h);
    cx.save(); cx.translate(w / 2, h / 2);
    const gr = cx.createRadialGradient(-40, -50, 20, 0, 0, R);
    gr.addColorStop(0, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(34,197,94,.08)');
    cx.fillStyle = gr; cx.beginPath(); cx.arc(0, 0, R - 2, 0, Math.PI * 2); cx.fill();
    balls.forEach((b) => {
      if (b.out) return;
      const bg = cx.createRadialGradient(b.x - 4, b.y - 5, 2, b.x, b.y, BR);
      bg.addColorStop(0, '#fff'); bg.addColorStop(1, COLORS[b.n % COLORS.length]);
      cx.fillStyle = bg; cx.beginPath(); cx.arc(b.x, b.y, BR, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#1f2937'; cx.font = 'bold 11px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(b.n, b.x, b.y + 0.5);
    });
    if (popping) {
      const p = popping, t = Math.min(1, (performance.now() - p.t0) / 420);
      const y = p.y0 + (-R - 10 - p.y0) * t, x = p.x0 * (1 - t), r = BR * (1 + t * 0.8);
      const bg = cx.createRadialGradient(x - 4, y - 5, 2, x, y, r); bg.addColorStop(0, '#fff'); bg.addColorStop(1, p.hit ? '#facc15' : '#e5e7eb');
      cx.fillStyle = bg; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#1f2937'; cx.font = 'bold 14px system-ui'; cx.fillText(p.n, x, y + 0.5);
      if (t >= 1) popping = null;
    }
    // reflet de la vitre et cerclage
    cx.strokeStyle = 'rgba(250,204,21,.85)'; cx.lineWidth = 5; cx.beginPath(); cx.arc(0, 0, R - 3, 0, Math.PI * 2); cx.stroke();
    cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.lineWidth = 6; cx.beginPath(); cx.arc(0, 0, R - 18, Math.PI * 1.1, Math.PI * 1.45); cx.stroke();
    cx.restore();
  }
  function loop() { drumStep(); drumDraw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  function popBall(n, hit) {
    const b = balls.find((x) => x.n === n && !x.out);
    if (b) { b.out = true; popping = { n, hit, x0: b.x, y0: b.y, t0: performance.now() }; }
  }
  function refillDrum() { balls.forEach((b) => { b.out = false; b.x = (Math.random() - 0.5) * 160; b.y = 40 + Math.random() * 60; b.vx = (Math.random() - 0.5) * 2; b.vy = 0; }); }

  // ---------- Un tirage ----------
  async function play() {
    if (!S.mode || busy) return;
    const picks = store.picks.slice().sort((a, b) => a - b), v = readBet();
    if (!E.validPicks(picks)) { toast('Coche au moins un numéro (jusqu\'à ' + C.MAX_PICK + ').', true); stopAuto(); return; }
    if (!(v >= minB() && v <= maxB())) { toast('Mise entre ' + minB() + ' et ' + maxB() + ' €.', true); stopAuto(); return; }
    if (S.mode === 'train' && S.stack < v) setStack(Math.max(S.stack, window.Casino ? Casino.TRAIN_BANK : 1000));
    if (v > S.stack) { toast('Pas assez d\'argent sur la table.', true); stopAuto(); return; }
    busy = true; clearDraw(); ui();
    let res;
    if (srv()) {
      Casino.hold();
      const r = await Casino.call('lo.draw', { bet: v, picks });
      if (r.error) { Casino.release(); busy = false; toast(r.error, true); stopAuto(); ui(); return; }
      res = { drawn: r.drawn, hits: r.hits, mult: r.mult, payout: r.payout, net: r.net, jackpot: r.jackpot, hash: r.hash, nonce: r.nonce, stackAfter: r.stack };
      S.stack = Math.round((r.stack - r.payout) * 100) / 100; // la mise part tout de suite, le gain arrive à la fin de l'animation
    } else {
      setStack(S.stack - v);
      const s = await ensureSeeds(); s.nonce++; persist();
      const drawn = await E.drawFromSeeds(s.server, s.client, s.nonce);
      res = Object.assign({ drawn, hash: s.hash, nonce: s.nonce }, E.settle(v, picks, drawn));
    }
    if (window.Sfx) Sfx.chips();
    // animation : la sphère s'emballe, les boules sortent une à une
    refillDrum(); energy = 2.2;
    const hitSet = new Set(res.hits), shown = [];
    let found = 0;
    await wait(650);
    const near = (n) => picks.some((p) => !hitSet.has(p) && Math.abs(p - n) === 1);
    const gainNow = () => { const m = (E.PAY[picks.length] || {})[found] || 0; return m * v; };
    const nextTier = () => { const pay = E.PAY[picks.length] || {}; for (let m = found + 1; m <= picks.length; m++) if (pay[m] && (pay[m] > (pay[found] || 0))) return { m, mult: pay[m] }; return null; };
    for (let k = 0; k < res.drawn.length; k++) {
      const n = res.drawn[k], hit = hitSet.has(n), left = C.DRAW - k;
      // suspense : les 3 dernières boules ralentissent quand un palier de gain est encore possible
      const tier = nextTier(), decisive = !auto && tier && left <= 3 && tier.m - found <= left;
      if (decisive) {
        suspense(left === 1 ? '🎱 DERNIÈRE BOULE…' : left + ' boules restantes…', tier.m - found === 1 ? 'Encore 1 bon numéro pour ' + fmtM(tier.mult) + ' !' : 'Il t\'en faut encore ' + (tier.m - found) + ' pour ' + fmtM(tier.mult));
        energy = 3.2; if (window.Sfx && Sfx.drumroll) Sfx.drumroll(left === 1 ? 1.6 : 0.9);
        if (window.Sfx && Sfx.heartbeat) Sfx.heartbeat();
        await wait(left === 1 ? 1600 : 900);
      }
      popBall(n, hit);
      await wait(auto ? 260 : decisive ? 700 : 380);
      shown.push(n); renderTray(shown, hitSet);
      nums[n - 1].classList.add('drawn');
      if (hit) {
        found++; nums[n - 1].classList.add('hit');
        const h = $('hits'); h.textContent = found + ' / ' + picks.length; h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump');
        if (window.Sfx) { if (Sfx.gem) Sfx.gem(found); else Sfx.win(); }
        if (window.Casino) Casino.vibrate(25);
        if (decisive) suspense('✅ ' + n + ' !', gainNow() > 0 ? 'Gain en cours : ' + fmt(gainNow()) + ' €' : '', true);
      } else {
        if (window.Sfx && Sfx.tick) Sfx.tick();
        if (!auto && near(n)) { const el = nums[n - 1]; el.classList.add('near'); setTimeout(() => el.classList.remove('near'), 900); if (!decisive) flashNear(n); }
        if (decisive) suspense('✕ ' + n, 'Raté…', false);
      }
      liveGain(gainNow(), shown.length);
      if (decisive) { await wait(650); energy = 2.2; }
    }
    hideSuspense();
    energy = 0.6;
    $('hits').textContent = found + ' / ' + picks.length;
    if (res.stackAfter !== undefined) S.stack = res.stackAfter; else setStack(S.stack + res.payout);
    lastDraw = res;
    finish(v, picks, res);
    busy = false; ui();
    if (auto > 0) { auto--; renderAuto(); if (auto > 0) setTimeout(play, res.payout > 0 ? 1200 : 700); }
  }
  // ---------- Suspense : bandeau, gain en direct, « presque ! » ----------
  function stageBox() { return document.querySelector('.lo-stage'); }
  function suspense(title, sub, good) {
    let b = document.getElementById('lo-suspense');
    if (!b) { b = document.createElement('div'); b.id = 'lo-suspense'; b.className = 'lo-suspense'; b.innerHTML = '<b></b><small></small>'; stageBox().appendChild(b); }
    b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub || '';
    b.className = 'lo-suspense show' + (good === true ? ' good' : good === false ? ' bad' : '');
    stageBox().classList.add('tense');
  }
  function hideSuspense() { const b = document.getElementById('lo-suspense'); if (b) b.className = 'lo-suspense'; stageBox().classList.remove('tense'); }
  function liveGain(g, k) {
    let e = document.getElementById('lo-live');
    if (!e) { e = document.createElement('div'); e.id = 'lo-live'; e.className = 'lo-live'; stageBox().appendChild(e); }
    e.textContent = 'Boule ' + k + ' / ' + C.DRAW + (g > 0 ? ' · gain en cours ' + fmt(g) + ' €' : '');
    e.classList.toggle('on', g > 0);
  }
  function flashNear(n) {
    let e = document.getElementById('lo-near');
    if (!e) { e = document.createElement('div'); e.id = 'lo-near'; e.className = 'lo-near'; stageBox().appendChild(e); }
    e.textContent = 'Presque ! ' + n; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  }
  function finish(bet, picks, res) {
    const st = statsOf(), won = res.payout > 0;
    st.rounds++; st.wagered += bet; st.won += res.payout;
    if (res.mult > st.best) st.best = res.mult;
    store.hist.unshift(res.mult || 0); store.hist = store.hist.slice(0, 24);
    store.bets[betsKey()].unshift({ amount: bet, k: picks.length, hits: res.hits.length, mult: res.mult, net: res.net, at: Date.now() });
    store.bets[betsKey()] = store.bets[betsKey()].slice(0, 30);
    persist();
    if (window.Casino && S.mode === 'real' && !Casino.server) Casino.track('lo', { bet, net: res.net, mult: res.mult, hits: res.hits.length, picks: picks.length, jackpot: res.jackpot });
    const box = $('result');
    box.className = 'lo-result' + (won ? '' : ' lose');
    box.innerHTML = '';
    box.append(won ? fmtM(res.mult) : res.hits.length + ' bon' + (res.hits.length > 1 ? 's' : '') + ' numéro' + (res.hits.length > 1 ? 's' : ''));
    const sm = document.createElement('small'); sm.textContent = won ? res.hits.length + ' / ' + picks.length + ' · +' + fmt(res.payout) + ' €' : 'Pas de gain cette fois'; box.appendChild(sm);
    box.hidden = false;
    setTimeout(() => { box.hidden = true; }, 2200);
    if (won && window.Sfx) Sfx.win();
    if (res.jackpot && window.Casino) setTimeout(() => Casino.bigWin(res.payout, 'CARTON PLEIN !'), 300);
    else if (won && res.mult >= 20 && window.Casino) setTimeout(() => Casino.bigWin(res.payout, 'LOTO ' + fmtM(res.mult) + ' !'), 300);
    $('pf-hash').textContent = res.hash || '–'; $('pf-nonce').textContent = String(res.nonce || 0);
    renderHistory(); renderStats();
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 800);
  }
  function stopAuto() { auto = 0; renderAuto(); }
  function renderAuto() { const b = $('auto-btn'); b.classList.toggle('on', auto > 0); b.textContent = auto > 0 ? '⏹ Stop (' + auto + ')' : '🔁 Auto ×10'; }

  // ---------- Actions ----------
  $('play-btn').addEventListener('click', play);
  $('auto-btn').addEventListener('click', () => { if (auto > 0) { stopAuto(); return; } auto = 10; renderAuto(); if (!busy) play(); });
  $('clear-btn').addEventListener('click', () => { if (busy) return; clearDraw(); store.picks = []; persist(); ui(); });
  document.querySelectorAll('#flash button').forEach((b) => b.addEventListener('click', () => flash(Number(b.dataset.k))));
  document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => { $('bet').value = b.dataset.v; if (window.Sfx) Sfx.chips(); ui(); }));
  $('bet-half').addEventListener('click', () => { $('bet').value = Math.max(minB(), Math.floor(readBet() / 2)); ui(); });
  $('bet-double').addEventListener('click', () => { $('bet').value = Math.min(maxB(), Math.max(minB(), readBet() * 2)); ui(); });
  $('bet').addEventListener('input', () => ui());
  $('bet').addEventListener('change', () => { const v = readBet(); $('bet').value = Math.min(maxB(), Math.max(minB(), isFinite(v) ? v : minB())); ui(); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) return;
    e.preventDefault(); play();
  });

  // ---------- Affichage ----------
  let toastTimer = null;
  function toast(text, err) {
    const t = $('toast'); t.textContent = text; t.className = 'stage-toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  let maxShown = null;
  function applyMax() {
    const m = maxB(); if (m === maxShown) return; maxShown = m;
    $('bet').max = m; if (readBet() > m) $('bet').value = m;
    document.querySelectorAll('#quick button').forEach((b) => { const v = Number(b.dataset.v); b.disabled = v > m || v < minB(); b.hidden = v < minB(); b.title = v > m ? 'Mise maximale à ce palier : ' + m + ' €' : ''; });
    if ($('bet') && readBet() < minB() && document.activeElement !== $('bet')) $('bet').value = minB();
  }
  function renderPay() {
    const k = store.picks.length, box = $('paytable'); box.innerHTML = '';
    if (!k) { const p = document.createElement('div'); p.className = 'empty'; p.textContent = 'Coche des numéros pour voir les gains.'; box.appendChild(p); return; }
    const hits = lastDraw ? lastDraw.hits.length : -1, v = readBet() || 0;
    Object.keys(E.PAY[k]).map(Number).sort((a, b) => b - a).forEach((m) => {
      const d = document.createElement('div'); if (m === hits) d.className = 'on';
      const t = document.createElement('span'); t.textContent = m + ' bon' + (m > 1 ? 's' : '');
      const b = document.createElement('b'); b.textContent = fmtM(E.PAY[k][m]);
      const g = document.createElement('span'); g.textContent = fmt(Math.min(v * E.PAY[k][m], v + C.MAX_WIN)) + ' €';
      d.append(t, b, g); box.appendChild(d);
    });
  }
  function ui() {
    if (!S.mode) return;
    applyMax();
    const k = store.picks.length, v = readBet() || 0;
    nums.forEach((b, i) => { const on = store.picks.includes(i + 1); b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('grid').classList.toggle('locked', busy);
    setText($('picked'), k + ' / ' + C.MAX_PICK);
    setText($('maxwin'), k ? fmt(Math.min(v * E.PAY[k][k], v + C.MAX_WIN)) + ' €' : '–');
    $('play-btn').disabled = busy || !k;
    $('play-btn').innerHTML = (busy ? 'TIRAGE…' : 'TIRAGE') + '<small style="display:block;font-size:.85rem;font-weight:700;letter-spacing:0;opacity:.85">' + fmt(v) + ' € · ' + k + ' numéro' + (k > 1 ? 's' : '') + '</small>';
    document.querySelectorAll('#flash button, #clear-btn').forEach((b) => { b.disabled = busy; });
    setText($('stack'), fmt(S.stack) + ' €');
    $('end-btn').disabled = busy;
    document.querySelectorAll('#quick button').forEach((q) => q.classList.toggle('on', Number(q.dataset.v) === readBet()));
    showWallet(); renderPay(); renderAides();
  }
  function renderHistory() {
    const h = $('history'); h.innerHTML = '';
    store.hist.slice(0, 24).forEach((x) => { const s = document.createElement('span'); s.className = 'hchip ' + (x === 0 ? 'low' : x < 2 ? 'mid' : x < 20 ? 'high' : 'epic'); s.textContent = x === 0 ? '·' : fmtM(x); h.appendChild(s); });
  }
  function renderStats() {
    const st = statsOf(), net = st.won - st.wagered;
    setText($('stats-mode'), S.mode === 'real' ? '· parties réelles' : '· apprentissage');
    setText($('s-rounds'), String(st.rounds));
    setText($('s-wagered'), fmt(st.wagered) + ' €');
    setText($('s-won'), fmt(st.won) + ' €');
    const n = $('s-net'); setText(n, (net >= 0 ? '+' : '−') + fmt(Math.abs(net)) + ' €'); n.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    setText($('s-best'), st.best ? 'Meilleur gain : ' + fmtM(st.best) + (st.wagered ? ' · retour réel : ' + Math.round(st.won / st.wagered * 100) + ' % (en moyenne, le jeu rend 95 %)' : '') : '');
    const ol = $('my-bets'); ol.innerHTML = '';
    const list = store.bets[betsKey()].slice(0, 15);
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Aucun tirage pour l\'instant.'; ol.appendChild(li); }
    list.forEach((x) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = fmt(x.amount) + ' € · ' + (x.mult ? fmtM(x.mult) : '—');
      const c = document.createElement('span'); c.className = 'muted'; c.textContent = x.hits + ' / ' + x.k + ' 🎱';
      const r = document.createElement('span'); r.className = x.net >= 0 ? 'w' : 'l'; r.textContent = (x.net >= 0 ? '+' : '−') + fmt(Math.abs(x.net)) + ' €';
      li.append(a, c, r); ol.appendChild(li);
    });
  }
  let lastAid = '';
  function renderAides() {
    if (S.mode !== 'train') return;
    const k = store.picks.length; if (String(k) === lastAid) return; lastAid = String(k);
    if (!k) { $('aides-body').innerHTML = '<div class="tip">Coche entre 1 et 8 numéros sur la grille, ou utilise une <b>grille flash</b>.</div>'; return; }
    const pct = (x) => (x * 100 < 0.1 ? (x * 100).toLocaleString('fr-FR', { maximumSignificantDigits: 2 }) : (x * 100).toFixed(1).replace('.', ',')) + ' %';
    const win = Object.keys(E.PAY[k]).reduce((a, m) => a + (E.PAY[k][m] >= 1 ? E.prob(k, +m) : 0), 0);
    const parts = [
      'Avec <b>' + k + ' numéro' + (k > 1 ? 's' : '') + '</b>, tu repars gagnant dans <b>' + pct(win) + '</b> des tirages.',
      'Chance du carton plein (' + k + ' sur ' + k + ') : <b>1 sur ' + Math.round(1 / E.prob(k, k)).toLocaleString('fr-FR') + '</b>, pour <b>' + fmtM(E.PAY[k][k]) + '</b> ta mise.',
      'Quel que soit le nombre de numéros, le jeu rend environ <b>' + Math.round(E.rtp(k) * 100) + ' %</b> des mises en moyenne. Peu de numéros = des petits gains fréquents ; beaucoup = de rares gros coups.',
      'Les numéros n\'ont pas de mémoire : un numéro sorti au tirage précédent a exactement la même chance de ressortir.',
    ];
    $('aides-body').innerHTML = parts.map((x) => '<div class="tip">' + x + '</div>').join('');
  }
  $('pf-check').addEventListener('click', async () => {
    const seed = $('pf-v-seed').value.trim(), cl = $('pf-v-client').value.trim(), n = Number($('pf-v-nonce').value);
    if (!seed || !cl || !(n >= 1)) { $('pf-result').textContent = 'Remplis les trois champs.'; return; }
    $('pf-result').textContent = 'Boules : ' + (await E.drawFromSeeds(seed, cl, n)).join(', ');
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
    badge.textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse · sans aides' : '🎓 Apprentissage · crédit illimité, aides et conseils';
    $('end-btn').hidden = mode === 'train';
    maxShown = null; renderTray([]); renderHistory(); renderStats(); lastAid = ''; ui();
  }
  async function endSession() {
    if (busy) return;
    stopAuto();
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('loto');
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
    if (!window.Casino) { startGame('train', 1000); return; }
    Casino.modePicker(box, { game: 'loto', min: minB(), suggest: 100, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  renderPicker(); showWallet();
  if (window.Casino) Casino.onChange(() => showWallet());
  window.Loto = { get state() { return { S, store, lastDraw }; }, play, flash };
})();
