/* Le Casse (Le Parrain, dès le palier 2) : la tour et ses alarmes restent secrètes sur le serveur. */
(function () {
  'use strict';
  const R = window.CasinoRules, E = window.CasseEngine;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = { mode: null, stack: 0, betIx: 0, busy: false, style: 'normal', heist: null };
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const rnd = (n) => Math.floor(Math.random() * n);

  // ---------- même déroulé que le serveur (Apprentissage) ----------
  const local = {
    start(bet, mode) { S.stack -= bet; S.heist = { bet, mode, tower: E.newTower(mode, rnd), floor: 0, active: true, picks: [] }; return { mode, floor: 0, stack: S.stack }; },
    pick(door) {
      const c = S.heist, alarms = c.tower[c.floor];
      if (alarms.includes(door)) { c.active = false; return { alarm: true, floor: c.floor, alarms, tower: c.tower, stack: S.stack }; }
      c.floor++; let payout = 0;
      if (c.floor >= E.FLOORS) payout = this.cash().payout;
      return { alarm: false, floor: c.floor, alarms, mult: E.multAt(c.mode, c.floor), active: c.active, payout, tower: c.active ? undefined : c.tower, stack: S.stack };
    },
    cash() { const c = S.heist, pay = Math.round(c.bet * E.multAt(c.mode, c.floor) * 100) / 100; S.stack += pay; c.active = false; return { cashed: true, payout: pay, floor: c.floor, tower: c.tower, stack: S.stack }; },
  };
  async function api(op, data) {
    if (srv()) return Casino.call(op, data || {});
    const r = op === 'cs.start' ? local.start(data.bet, data.mode) : op === 'cs.pick' ? local.pick(data.door) : local.cash();
    if (S.mode === 'real' && window.Casino) Casino.setStack('casse', S.stack);
    return r;
  }

  const bets = () => { const min = S.mode === 'real' ? Casino.minBet('casse') : 1, max = S.mode === 'real' ? Casino.maxBet() : 500; return R.BET_STEPS.filter((b) => b >= min && b <= max); };
  const bet = () => bets()[Math.min(S.betIx, bets().length - 1)];
  const on = () => !!(S.heist && S.heist.active);

  function renderModes() {
    const box = $('modes'); box.innerHTML = '';
    Object.keys(E.MODES).forEach((k) => {
      const M = E.MODES[k], b = document.createElement('button'); b.type = 'button'; b.className = k === S.style ? 'on' : '';
      b.innerHTML = '<span>' + M.icon + ' ' + M.name + '</span><small>' + M.doors + ' portes · ' + M.alarms + ' alarme' + (M.alarms > 1 ? 's' : '') + '</small>';
      b.disabled = on() || S.busy;
      b.onclick = () => { S.style = k; renderModes(); renderTower(); if (window.Sfx) Sfx.tick(); };
      box.appendChild(b);
    });
  }
  /** La tour : étages franchis (vert), étage courant (portes cliquables), étages à venir avec leur multiplicateur. */
  function renderTower(reveal) {
    const box = $('floors'); box.innerHTML = '';
    const h = S.heist, mode = h ? h.mode : S.style, M = E.MODES[mode], b = h ? h.bet : bet();
    for (let f = 0; f < E.FLOORS; f++) {
      const row = document.createElement('div'); row.className = 'cs-floor';
      if (h && f < h.floor) row.classList.add('done');
      if (h && h.active && f === h.floor) row.classList.add('current');
      const lvl = document.createElement('span'); lvl.className = 'lvl'; lvl.textContent = 'Étage ' + (f + 1);
      const doors = document.createElement('div'); doors.className = 'doors';
      for (let d = 0; d < M.doors; d++) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-door'; btn.textContent = '🚪';
        const picked = h && h.picks && h.picks[f];
        if (h && f < h.floor && picked === d) { btn.classList.add('safe'); btn.textContent = '💰'; }
        if (reveal && reveal[f]) {
          if (reveal[f].includes(d)) { btn.classList.add('alarm'); btn.textContent = '🚨'; if (picked !== d) btn.classList.add('ghost'); }
          else if (!(h && f < h.floor && picked === d)) btn.classList.add('ghost');
        }
        if (h && h.active && f === h.floor && !S.busy) btn.onclick = () => pick(d);
        else btn.disabled = true;
        doors.appendChild(btn);
      }
      const mult = document.createElement('span'); mult.className = 'mult'; mult.textContent = fmt(b * E.multAt(mode, f + 1)) + ' €';
      row.append(lvl, doors, mult); box.appendChild(row);
    }
  }
  // ---------- caméra : vue d'ensemble, ou zoom centré sur un étage ----------
  function cam(target, opts) {
    opts = opts || {};
    const b = $('building'), c = $('cam'), rows = [...$('floors').children];
    b.classList.toggle('zoomed', target !== 'full');
    const W = b.clientWidth, H = b.clientHeight, natural = c.scrollHeight;
    if (target === 'full' || !rows.length) {
      const s = Math.min(1, H / natural);
      c.style.transform = 'translate(' + (W - W * s) / 2 + 'px, ' + Math.max(0, (H - natural * s) / 2) + 'px) scale(' + s + ')';
      $('cam-hud').hidden = true;
      return;
    }
    // les étages sont dans l'ordre 1 → 8 (affichés de bas en haut)
    const row = rows[target]; if (!row) return;
    const s = opts.scale || 1.75, cy = row.offsetTop + row.offsetHeight / 2; // (position dans la caméra)
    const ty = Math.max(H - natural * s, Math.min(0, H / 2 - cy * s)); // la caméra ne sort jamais de l'immeuble
    c.style.transform = 'translate(' + (W - W * s) / 2 + 'px, ' + ty + 'px) scale(' + s + ')';
    const h = S.heist, hud = $('cam-hud');
    hud.hidden = false; $('cam-floor').textContent = 'ÉTAGE ' + (target + 1);
    $('cam-mult').textContent = h ? '→ ' + fmt(h.bet * E.multAt(h.mode, target + 1)) + ' €' : '';
    hud.classList.remove('pop'); void hud.offsetWidth; hud.classList.add('pop');
  }
  /** Effet ascenseur / drone : la caméra monte d'un étage. */
  async function liftTo(floor) {
    const c = $('cam'), l = $('lift');
    c.classList.add('lift'); l.hidden = false; l.style.animation = 'none'; void l.offsetWidth; l.style.animation = '';
    if (window.Sfx && Sfx.whoosh) Sfx.whoosh();
    cam(floor);
    await sleep(900);
    c.classList.remove('lift'); l.hidden = true;
    if (window.Sfx && Sfx.chime) Sfx.chime(); // « ding » de l'ascenseur
  }

  function ui() {
    const h = S.heist;
    $('bet').textContent = fmt(bet()) + ' €'; $('stack').textContent = fmt(S.stack) + ' €';
    $('go').disabled = S.busy || on() || bet() > S.stack;
    $('bet-minus').disabled = S.busy || on() || S.betIx <= 0; $('bet-plus').disabled = S.busy || on() || S.betIx >= bets().length - 1;
    $('end-btn').disabled = S.busy || on();
    $('flee').hidden = !on(); $('flee').disabled = S.busy || !(h && h.floor > 0);
    const loot = h && h.floor > 0 ? h.bet * E.multAt(h.mode, h.floor) : 0;
    $('flee').textContent = h && h.floor > 0 ? '🏃 S\'enfuir avec ' + fmt(loot) + ' €' : '🏃 Passe un étage pour pouvoir fuir';
    $('loot').textContent = on() ? (h.floor ? fmt(loot) + ' €' : '0 €') : '–';
    $('loot-next').textContent = on() && h.floor < E.FLOORS ? 'Étage suivant : ' + fmt(h.bet * E.multAt(h.mode, h.floor + 1)) + ' €' : '';
    $('wallet').textContent = window.Casino ? fmt(Casino.wallet()) : '–';
    renderModes();
  }
  function msg(t) { $('msg').textContent = t; }

  async function go() {
    const b = bet(); if (S.busy || on() || b > S.stack) return;
    S.busy = true; ui();
    const r = await api('cs.start', { bet: b, mode: S.style });
    S.busy = false;
    if (!r || r.error) { msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    S.stack = r.stack;
    if (srv()) S.heist = { bet: b, mode: r.mode, floor: 0, active: true, picks: [] };
    else S.heist.picks = [];
    $('siren').hidden = true;
    if (window.Sfx && Sfx.whoosh) Sfx.whoosh();
    msg('Étage 1 : choisis une porte…'); renderTower(); ui();
    $('building').scrollIntoView({ behavior: 'smooth', block: 'center' });
    cam(0); // zoom sur l'étage 1
  }
  async function pick(door) {
    const h = S.heist; if (S.busy || !on()) return;
    S.busy = true; renderTower(); ui();
    if (srv()) Casino.hold();
    if (window.Sfx && Sfx.heartbeat) Sfx.heartbeat();
    const f0 = h.floor;
    const [r] = await Promise.all([api('cs.pick', { door }), sleep(650)]);
    if (!r || r.error) { S.busy = false; if (window.Casino && Casino.holding) Casino.release(); msg('⚠️ ' + ((r && r.error) || 'Erreur')); renderTower(); ui(); return; }
    h.picks[f0] = door;
    if (r.alarm) {
      h.active = false; S.stack = r.stack;
      const rev = r.tower || []; rev[r.floor] = r.alarms;
      renderTower(rev); $('siren').hidden = false;
      const bd = $('building'); bd.classList.remove('quake'); void bd.offsetWidth; bd.classList.add('quake');
      setTimeout(() => cam('full'), 1300); // la caméra recule : tout l'immeuble
      msg('🚨 ALARME ! La police débarque… le butin est perdu.');
      if (window.Sfx) { if (Sfx.explosion) Sfx.explosion(); else if (Sfx.lose) Sfx.lose(); }
      if (window.Casino && Casino.vibrate) Casino.vibrate([200, 80, 200, 80, 200]);
    } else {
      h.floor = r.floor; S.stack = r.stack;
      if (window.Sfx) Sfx.chips();
      const lb = $('loot'); lb.classList.remove('bump'); void lb.offsetWidth; lb.classList.add('bump');
      if (r.payout) { h.active = false; renderTower(r.tower); setTimeout(() => cam('full'), 900); msg('🏆 LE COFFRE ! +' + fmt(r.payout) + ' € dans la camionnette !'); if (window.Sfx) Sfx.win(); if (Casino.bigWin && r.payout >= h.bet * 10) Casino.bigWin(r.payout, 'LE CASSE DU SIÈCLE !'); }
      else { msg('Ouf, la voie est libre ! On monte…'); await sleep(450); S.busy = false; renderTower(); await liftTo(h.floor); msg('Étage ' + (h.floor + 1) + ' : une porte… ou tu t\'enfuis ?'); }
    }
    S.busy = false; ui();
    if (window.Casino && Casino.holding) setTimeout(() => Casino.release(), 700);
  }
  async function flee() {
    const h = S.heist; if (S.busy || !on() || !h.floor) return;
    S.busy = true; const r = await api('cs.cash'); S.busy = false;
    if (!r || r.error) { msg('⚠️ ' + ((r && r.error) || 'Erreur')); ui(); return; }
    h.active = false; S.stack = r.stack;
    renderTower(r.tower); cam('full');
    msg('🚐 Fuite réussie : +' + fmt(r.payout) + ' € !'); if (window.Sfx) Sfx.win();
    if (r.payout >= h.bet * 10 && window.Casino && Casino.bigWin) Casino.bigWin(r.payout, 'BEAU CASSE !');
    ui();
  }
  $('go').addEventListener('click', go);
  $('flee').addEventListener('click', flee);
  $('bet-minus').addEventListener('click', () => { S.betIx = Math.max(0, S.betIx - 1); renderTower(); ui(); if (window.Sfx) Sfx.chips(); });
  $('bet-plus').addEventListener('click', () => { S.betIx = Math.min(bets().length - 1, S.betIx + 1); renderTower(); ui(); if (window.Sfx) Sfx.chips(); });

  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount; S.heist = null;
    if (window.Casino) Casino.training = mode === 'train';
    const bs = bets(); S.betIx = Math.max(0, bs.findIndex((x) => x >= amount / 40)); if (bs[S.betIx] > amount) S.betIx = 0;
    $('setup').hidden = true; $('game').hidden = false;
    $('mode-badge').textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse' : '🎓 Apprentissage · crédit illimité';
    $('end-btn').hidden = mode === 'train';
    renderTower(); ui(); setTimeout(() => cam('full'), 50);
  }
  async function endSession() {
    if (S.busy || on()) return;
    if (S.mode === 'real') { const r = await Casino.cashOut('casse'); if (r && r.error) { msg(r.error); return; } }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false; renderPicker();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker() { Casino.modePicker($('mode-picker'), { game: 'casse', min: 1, onStart: (mode, amount) => startGame(mode, amount) }); }
  renderPicker(); renderTower(); ui();
  window.addEventListener('resize', () => cam(on() ? S.heist.floor : 'full'));
  if (window.Casino) Casino.onChange(() => { if (!S.busy) $('wallet').textContent = fmt(Casino.wallet()); });
  window.Casse = { get state() { return S; }, pick, go };
})();
