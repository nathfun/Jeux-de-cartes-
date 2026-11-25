/*
 * Bourse Flash — logique du jeu et interface.
 *
 * Trois actions fictives cotent en continu (un pas de cours toutes les 0,25 s, rattrapé à l'horloge si la page
 * a été en arrière-plan). Le joueur ouvre des positions (achat = parie sur la hausse, vente = parie sur la baisse)
 * avec une mise et un effet de levier, puis les clôture quand il veut. La mise sort de la table à l'ouverture,
 * la valeur de la position y revient à la clôture (rien si elle a été liquidée).
 */
(function () {
  'use strict';
  const E = window.TraderEngine, C = E.CONFIG;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: Math.abs(n % 1) > 0.001 ? 2 : 0, maximumFractionDigits: 2 });
  const sgn = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
  const KEY = 'trader-v1';
  const HIST = 720; // points gardés par action (3 minutes)

  // ---------- Données enregistrées ----------
  const blankStats = () => ({ rounds: 0, wagered: 0, won: 0, best: 0 });
  let store = { asset: 'orbit', lev: 5, stats: { real: blankStats(), train: blankStats() }, bets: { real: [], train: [] } };
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw) store = Object.assign(store, raw); } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };
  const assetOf = (id) => E.ASSETS.find((a) => a.id === id) || E.ASSETS[1];
  if (!E.ASSETS.some((a) => a.id === store.asset)) store.asset = 'orbit';

  // ---------- Marchés ----------
  const M = {};
  let clock = 0; // temps du marché (s)
  E.ASSETS.forEach((a) => {
    const m = E.market(a); m.hist = [];
    // un peu d'historique pour que le graphique ne soit pas vide
    for (let i = 0; i < 400; i++) { E.step(m, a); }
    m.burst = null;
    for (let i = 0; i < 360; i++) { E.step(m, a); m.hist.push({ t: (i - 360) * C.DT, p: m.price }); }
    m.burst = null;
    M[a.id] = m;
  });
  const decimals = (p) => (p < 10 ? 3 : 2);

  // ---------- État ----------
  const S = { mode: null, stack: 0 };
  let positions = []; // { id, asset, dir, lev, bet, entry, fee, liq, tp, sl, at }
  let seq = 0;
  const statsOf = () => store.stats[S.mode === 'real' ? 'real' : 'train'];
  const betsKey = () => (S.mode === 'real' ? 'real' : 'train');
  function setStack(v) {
    S.stack = Math.max(0, Math.round(v * 100) / 100);
    if (S.mode === 'real' && window.Casino) Casino.setStack('trader', S.stack);
  }

  // Un pas de marché pour toutes les actions, puis liquidations et ordres automatiques
  function marketStep() {
    clock += C.DT;
    E.ASSETS.forEach((a) => {
      const m = M[a.id];
      const r = E.step(m, a);
      m.hist.push({ t: clock, p: m.price }); if (m.hist.length > HIST) m.hist.shift();
      if (r.jump) news(a, r.jump);
    });
    positions.slice().forEach((p) => {
      const m = M[p.asset];
      if (E.isLiquidated(p, m.price)) { settle(p, 0, 'liq'); return; }
      if (E.halted(m)) return; // cotation suspendue : les ordres automatiques attendent
      const v = E.valueAt(p, m.price);
      if (p.tp && v >= p.bet * (1 + p.tp / 100)) settle(p, E.payoutOf(p, m.price), 'tp');
      else if (p.sl && v <= p.bet * (1 - p.sl / 100)) settle(p, E.payoutOf(p, m.price), 'sl');
    });
  }
  let lastReal = performance.now(), acc = 0;
  function tick() {
    const t = performance.now();
    acc += Math.min(30 * 60 * 1000, t - lastReal); lastReal = t; // au plus 30 min de rattrapage
    let n = 0;
    while (acc >= C.DT * 1000) { acc -= C.DT * 1000; marketStep(); n++; }
    if (n) ui();
  }
  setInterval(tick, 50);

  // ---------- Positions ----------
  const readBet = () => Math.floor(Number($('bet').value));
  const readPct = (id, max) => { const v = Math.floor(Number($(id).value)); return v >= 1 ? Math.min(max, v) : 0; };
  function openPos(dir) {
    if (!S.mode) return;
    const a = assetOf(store.asset), m = M[a.id];
    const v = readBet(), lev = Math.min(store.lev, a.maxLev);
    if (E.halted(m)) { toast('Cotation suspendue : attends la fin du ' + (m.burst && m.burst.dir === 'up' ? 'rallye' : 'krach') + '.', true); return; }
    if (!(v >= C.MIN_BET && v <= C.MAX_BET)) { toast('Mise entre ' + C.MIN_BET + ' et ' + C.MAX_BET + ' €.', true); return; }
    if (positions.length >= C.MAX_POS) { toast(C.MAX_POS + ' positions au maximum : clôtures-en une.', true); return; }
    if (S.mode === 'train' && S.stack < v) setStack(Math.max(S.stack, window.Casino ? Casino.TRAIN_BANK : 10000));
    if (v > S.stack) { toast('Pas assez d\'argent sur la table.', true); return; }
    setStack(S.stack - v);
    const p = Object.assign(E.open(v, lev, dir, m.price), { id: ++seq, asset: a.id, tp: readPct('tp', 1000), sl: readPct('sl', 80), at: clock });
    p.liq = E.liqPrice(p);
    positions.push(p);
    if (window.Sfx) { Sfx.chips(); if (Sfx.tradeOpen) Sfx.tradeOpen(dir); }
    toast((dir > 0 ? '▲ Achat ' : '▼ Vente ') + a.short + ' ×' + lev + ' · ' + fmt(v) + ' €');
    renderPositions(true); ui();
  }
  function closePos(id) {
    const p = positions.find((x) => x.id === id);
    if (!p) return;
    const m = M[p.asset];
    if (E.halted(m)) { toast('Cotation suspendue : impossible de clôturer pendant 2 secondes.', true); return; }
    settle(p, E.payoutOf(p, m.price), 'close');
  }
  function settle(p, payout, why) {
    if (!positions.includes(p)) return;
    positions = positions.filter((x) => x !== p);
    const a = assetOf(p.asset), net = Math.round((payout - p.bet) * 100) / 100;
    setStack(S.stack + payout);
    const st = statsOf();
    st.rounds++; st.wagered += p.bet; st.won += payout;
    if (net > st.best) st.best = net;
    store.bets[betsKey()].unshift({ asset: p.asset, dir: p.dir, lev: p.lev, bet: p.bet, net, why, at: Date.now() });
    store.bets[betsKey()] = store.bets[betsKey()].slice(0, 30);
    persist();
    if (window.Casino && S.mode === 'real') Casino.track('tr', { bet: p.bet, net, lev: p.lev, dir: p.dir, liq: why === 'liq', mult: payout / p.bet });
    const label = (p.dir > 0 ? 'Achat ' : 'Vente ') + a.short + ' ×' + p.lev;
    if (why === 'liq') { toast('💥 ' + label + ' liquidé : −' + fmt(p.bet) + ' €', true); if (window.Sfx && Sfx.explosion) Sfx.explosion(); }
    else {
      const how = why === 'tp' ? 'Objectif atteint · ' : why === 'sl' ? 'Limite de perte · ' : '';
      toast(how + label + ' clôturé : ' + sgn(net) + ' €', net < 0);
      if (window.Sfx) { if (net > 0 && Sfx.cashout) Sfx.cashout(); else if (net < 0) Sfx.lose(); }
      if (net >= p.bet * 3 && net >= 300 && window.Casino) setTimeout(() => Casino.bigWin(payout, 'COUP DE MAÎTRE ' + sgn(net) + ' € !'), 200);
    }
    renderPositions(true); renderStats(); ui();
  }
  function closeAll() { positions.slice().forEach((p) => { if (!E.halted(M[p.asset])) settle(p, E.payoutOf(p, M[p.asset].price), 'close'); }); }
  // Quitter la page : les krachs en cours vont jusqu'au bout (sinon on pourrait fuir un krach), puis tout est clôturé
  function forceCloseAll() {
    let guard = 0;
    while (positions.some((p) => E.halted(M[p.asset])) && guard++ < 40) marketStep();
    positions.slice().forEach((p) => settle(p, E.payoutOf(p, M[p.asset].price), 'close'));
  }

  // ---------- Actualités (affichées quand un krach / une envolée commence) ----------
  let newsTimer = null;
  function news(a, dir) {
    const list = E.NEWS[dir], txt = list[Math.floor(E.rnd() * list.length)].replace('{n}', a.name);
    const n = $('news'); n.textContent = (dir === 'up' ? '🚀 ' : '📉 ') + txt; n.className = 'tr-news ' + dir; n.hidden = false;
    clearTimeout(newsTimer); newsTimer = setTimeout(() => { n.hidden = true; }, 4500);
    if (window.Sfx && (a.id === store.asset || positions.some((p) => p.asset === a.id))) Sfx.tick();
  }

  // ---------- Actions du joueur ----------
  $('buy-btn').addEventListener('click', () => openPos(1));
  $('sell-btn').addEventListener('click', () => openPos(-1));
  $('close-all').addEventListener('click', closeAll);
  document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => { $('bet').value = b.dataset.v; if (window.Sfx) Sfx.chips(); ui(); }));
  $('bet-half').addEventListener('click', () => { $('bet').value = Math.max(C.MIN_BET, Math.floor(readBet() / 2)); ui(); });
  $('bet-double').addEventListener('click', () => { $('bet').value = Math.min(C.MAX_BET, Math.max(C.MIN_BET, readBet() * 2)); ui(); });
  $('bet').addEventListener('input', () => ui());
  $('bet').addEventListener('change', () => { const v = readBet(); $('bet').value = Math.min(C.MAX_BET, Math.max(C.MIN_BET, isFinite(v) ? v : C.MIN_BET)); ui(); });
  // leviers
  C.LEVERS.forEach((l) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = l; b.textContent = '×' + l; b.addEventListener('click', () => { store.lev = l; persist(); ui(); renderAides(); }); $('lev').appendChild(b); });
  // actions
  E.ASSETS.forEach((a) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'asset'; b.dataset.id = a.id; b.setAttribute('role', 'tab');
    b.innerHTML = '<span class="a-name"></span><span class="a-price"></span><span class="a-chg"></span>';
    b.querySelector('.a-name').textContent = a.icon + ' ' + a.name;
    b.addEventListener('click', () => { store.asset = a.id; persist(); resetScale = true; ui(); renderAides(); });
    $('assets').appendChild(b);
  });

  // ---------- Affichage ----------
  let toastTimer = null;
  function toast(text, err) {
    const t = $('toast'); t.textContent = text; t.className = 'stage-toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const fmtP = (p) => p.toLocaleString('fr-FR', { minimumFractionDigits: decimals(p), maximumFractionDigits: decimals(p) });
  // variation sur la dernière minute
  function change(m) { const h = m.hist, i = Math.max(0, h.length - 1 - 240); return (m.price / h[i].p - 1) * 100; }
  const pctTxt = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2).replace('.', ',') + ' %';
  function ui() {
    if (!S.mode) return;
    const a = assetOf(store.asset), m = M[a.id];
    // onglets des actions
    document.querySelectorAll('.asset').forEach((b) => {
      const mm = M[b.dataset.id], ch = change(mm);
      b.classList.toggle('on', b.dataset.id === a.id); b.classList.toggle('halted', E.halted(mm));
      b.setAttribute('aria-selected', b.dataset.id === a.id ? 'true' : 'false');
      setText(b.querySelector('.a-price'), fmtP(mm.price) + ' €');
      const c = b.querySelector('.a-chg'); setText(c, pctTxt(ch) + ' (1 min)'); c.className = 'a-chg ' + (ch >= 0 ? 'up' : 'down');
    });
    setText($('q-name'), a.icon + ' ' + a.short);
    setText($('q-price'), fmtP(m.price) + ' €');
    const ch = change(m), qc = $('q-change'); setText(qc, pctTxt(ch)); qc.className = ch >= 0 ? 'up' : 'down';
    const halt = $('halt'), h = E.halted(m);
    halt.hidden = !h; if (h) { halt.className = 'tr-halt ' + m.burst.dir; setText(halt, m.burst.dir === 'up' ? '🚀 ENVOLÉE · COTATION SUSPENDUE' : '📉 KRACH · COTATION SUSPENDUE'); }
    // leviers disponibles pour cette action
    document.querySelectorAll('#lev button').forEach((b) => { const l = Number(b.dataset.v); b.disabled = l > a.maxLev; b.classList.toggle('on', l === Math.min(store.lev, a.maxLev)); b.title = l > a.maxLev ? 'Levier maximal pour ' + a.name + ' : ×' + a.maxLev : ''; });
    const v = readBet() || 0, lev = Math.min(store.lev, a.maxLev);
    setText($('potential'), '± ' + fmt(v * lev * 0.01) + ' €');
    setText($('fee'), fmt(E.feeOf(v, lev)) + ' €');
    $('buy-btn').disabled = h; $('sell-btn').disabled = h;
    setText($('stack'), fmt(S.stack) + ' €');
    $('end-btn').disabled = positions.some((p) => E.halted(M[p.asset]));
    document.querySelectorAll('#quick button').forEach((q) => q.classList.toggle('on', Number(q.dataset.v) === readBet()));
    renderPositions(false);
    showWallet();
  }
  // positions : les lignes sont gardées (les boutons ne bougent pas sous le doigt), seuls les chiffres changent
  const rows = new Map();
  function renderPositions(rebuild) {
    const box = $('positions');
    if (rebuild) {
      rows.clear(); box.innerHTML = '';
      if (!positions.length) box.innerHTML = '<p class="muted small">Aucune position ouverte. Choisis une action, une mise, un levier, puis achète ou vends.</p>';
      positions.forEach((p) => {
        const a = assetOf(p.asset), el = document.createElement('div');
        el.className = 'pos ' + (p.dir > 0 ? 'buy' : 'sell');
        el.innerHTML = '<span class="p-ic"></span><div class="p-main"><b></b><span></span></div><div class="p-pnl"></div><button type="button" class="p-close">Clôturer</button><div class="p-risk"><i></i></div><div class="p-risk-label"></div>';
        el.querySelector('.p-ic').textContent = a.icon;
        el.querySelector('b').textContent = (p.dir > 0 ? '▲ Achat ' : '▼ Vente ') + a.short + ' ×' + p.lev + ' · ' + fmt(p.bet) + ' €' + (p.tp ? ' · objectif +' + p.tp + ' %' : '') + (p.sl ? ' · limite −' + p.sl + ' %' : '');
        el.querySelector('.p-close').addEventListener('click', () => closePos(p.id));
        box.appendChild(el); rows.set(p.id, el);
      });
      setText($('pos-count'), positions.length ? positions.length + ' / ' + C.MAX_POS : '');
      $('close-all').hidden = positions.length < 2;
    }
    positions.forEach((p) => {
      const el = rows.get(p.id); if (!el) return;
      const m = M[p.asset], val = Math.max(0, E.valueAt(p, m.price)), pnl = val - p.bet;
      setText(el.querySelector('.p-main span'), 'Entrée ' + fmtP(p.entry) + ' → ' + fmtP(m.price) + ' · liquidation à ' + fmtP(p.liq));
      const pn = el.querySelector('.p-pnl');
      pn.innerHTML = ''; pn.className = 'p-pnl ' + (pnl >= 0 ? 'up' : 'down');
      pn.append(sgn(pnl) + ' €'); const sm = document.createElement('small'); sm.textContent = pctTxt(pnl / p.bet * 100); pn.appendChild(sm);
      // jauge : 0 % = valeur d'entrée, 100 % = liquidation
      const risk = Math.max(0, Math.min(1, (p.bet - p.fee - val) / (p.bet - p.fee - C.LIQ * p.bet)));
      el.querySelector('.p-risk i').style.width = Math.round(risk * 100) + '%';
      setText(el.querySelector('.p-risk-label'), risk > 0.01 ? 'Risque de liquidation : ' + Math.round(risk * 100) + ' %' : 'En gain : pas de risque de liquidation pour l\'instant');
      const btn = el.querySelector('.p-close'), h = E.halted(m);
      btn.disabled = h; setText(btn, h ? '⏸ Suspendu' : 'Clôturer ' + sgn(E.payoutOf(p, m.price) - p.bet) + ' €');
    });
  }
  function renderStats() {
    const st = statsOf(), net = st.won - st.wagered;
    setText($('stats-mode'), S.mode === 'real' ? '· parties réelles' : '· apprentissage');
    setText($('s-rounds'), String(st.rounds));
    setText($('s-wagered'), fmt(st.wagered) + ' €');
    setText($('s-won'), fmt(st.won) + ' €');
    const n = $('s-net'); setText(n, sgn(net) + ' €'); n.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    setText($('s-best'), st.best > 0 ? 'Meilleur coup : +' + fmt(st.best) + ' €' : '');
    const ol = $('my-bets'); ol.innerHTML = '';
    const list = store.bets[betsKey()].slice(0, 15);
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Aucune position pour l\'instant.'; ol.appendChild(li); }
    list.forEach((x) => {
      const a = assetOf(x.asset), li = document.createElement('li');
      const s = document.createElement('span'); s.textContent = (x.dir > 0 ? '▲ ' : '▼ ') + a.short + ' ×' + x.lev + ' · ' + fmt(x.bet) + ' €' + (x.why === 'liq' ? ' · 💥 liquidé' : x.why === 'tp' ? ' · 🎯 objectif' : x.why === 'sl' ? ' · 🛑 limite' : '');
      const r = document.createElement('span'); r.className = x.net >= 0 ? 'w' : 'l'; r.textContent = sgn(x.net) + ' €';
      li.append(s, r); ol.appendChild(li);
    });
  }
  function renderAides() {
    if (S.mode !== 'train') return;
    const a = assetOf(store.asset), lev = Math.min(store.lev, a.maxLev), v = readBet() || 20;
    const liqMove = ((1 - C.LIQ) * v - E.feeOf(v, lev)) / (v * lev) * 100;
    const parts = [
      '<b>Acheter</b> = tu gagnes si le cours <b>monte</b>. <b>Vendre</b> = tu gagnes s\'il <b>baisse</b>. Tu clôtures quand tu veux pour encaisser.',
      '<b>Effet de levier ×' + lev + '</b> : si ' + a.short + ' bouge de 1 %, ta position gagne ou perd ' + lev + ' % de ta mise (' + fmt(v * lev / 100) + ' € pour ' + fmt(v) + ' €).',
      '<b>Liquidation</b> : avec ×' + lev + ', un mouvement contre toi d\'environ <b>' + liqMove.toFixed(1).replace('.', ',') + ' %</b> et ta mise est perdue. Plus le levier est fort, plus c\'est proche !',
      '<b>Frais</b> : ' + fmt(E.feeOf(v, lev)) + ' € à l\'ouverture (0,3 % de mise × levier). Ouvrir et fermer sans arrêt coûte cher.',
      a.icon + ' <b>' + a.name + '</b> : ' + a.desc + ' Levier maximal ×' + a.maxLev + '.',
      'Le cours est tiré <b>au hasard</b> : les « tendances » du graphique ne prédisent rien. Les objectifs de gain et limites de perte servent à <b>contrôler ton risque</b>, pas à battre le hasard.',
    ];
    $('aides-body').innerHTML = parts.map((x) => '<div class="tip">' + x + '</div>').join('');
  }

  // Graphique
  let resetScale = true;
  const scene = new window.TraderScene($('scene'));
  scene.start(() => {
    if (!S.mode) return null;
    const a = assetOf(store.asset), m = M[a.id];
    const frac = Math.min(1, acc / (C.DT * 1000));
    const out = {
      hist: m.hist, now: clock + frac * C.DT * 0.999, decimals: decimals(m.price), reset: resetScale,
      halted: E.halted(m), haltDir: m.burst && m.burst.dir,
      positions: positions.filter((p) => p.asset === a.id).map((p) => ({ entry: p.entry, liq: p.liq, dir: p.dir, lev: p.lev, pnl: Math.max(0, E.valueAt(p, m.price)) - p.bet })),
    };
    resetScale = false;
    return out;
  });

  // ---------- Début et fin de partie ----------
  function showWallet() {
    setText($('bank-label'), 'Banque'); setText($('wallet'), window.Casino ? fmt(Casino.wallet()) : '–');
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
    badge.textContent = mode === 'real' ? '💰 Partie réelle · ta banque · sans aides' : '🎓 Apprentissage · crédit illimité, aides et conseils';
    $('end-btn').hidden = mode === 'train';
    renderStats(); renderAides(); renderPositions(true);
    setTimeout(() => scene.resize(), 0);
    resetScale = true;
    ui();
  }
  async function endSession() {
    if (positions.some((p) => E.halted(M[p.asset]))) { toast('Cotation suspendue : attends 2 secondes.', true); return; }
    closeAll();
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('trader');
      if (r && r.error) { toast(r.error, true); return; }
      const diff = r ? r.diff : 0;
      msg = 'Tu encaisses ' + fmt(r ? r.end : S.stack) + ' € (' + sgn(diff) + ' € par rapport à la somme apportée).';
      Casino.toast('Encaissé !', msg, '💰', diff > 0 ? 'gold' : '');
    }
    S.mode = null;
    $('game').hidden = true; $('setup').hidden = false;
    renderPicker(msg);
    showWallet();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 10000); return; }
    Casino.modePicker(box, { game: 'trader', min: C.MIN_BET, suggest: 500, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  window.addEventListener('pagehide', () => { if (S.mode && positions.length) forceCloseAll(); });
  renderPicker();
  showWallet();
  if (window.Casino) Casino.onChange(() => showWallet());
  // pour les tests
  window.Trader = { get state() { return { S, positions, M, store, clock }; }, openPos, closePos, marketStep };
})();
