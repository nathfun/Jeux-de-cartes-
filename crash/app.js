/*
 * Rocket Crash — logique du jeu et interface.
 *
 * États d'une manche : countdown (on peut miser) → launch (allumage) → flight (le multiplicateur grimpe)
 *                      → crashed (explosion, résultat) → countdown…
 * La logique avance sur l'horloge (performance.now), pas sur les images : si l'affichage rame ou si
 * l'onglet passe en arrière-plan, la manche se règle quand même au bon moment et au bon multiplicateur.
 *
 * Qui décide du résultat :
 *  - avec le serveur du Casino (Casino.server) : le serveur tire la manche, encaisse la mise, accepte ou refuse
 *    chaque retrait (functions/core.js, opérations cr.*) ; l'app ne fait qu'afficher ;
 *  - sinon : tirage dans l'app avec le générateur cryptographique, au format « Provably Fair »
 *    (server seed / client seed / nonce), et la banque est protégée par les règles de la base.
 */
(function () {
  'use strict';
  const E = window.CrashEngine, C = E.CONFIG;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const fmtM = (m) => m.toFixed(2) + '×';
  const now = () => performance.now();
  const KEY = 'crash-v1';

  // ---------- Données enregistrées sur l'appareil ----------
  const blankStats = () => ({ rounds: 0, wagered: 0, won: 0, best: 0 });
  let store = { hist: [], seeds: null, stats: { real: blankStats(), train: blankStats() }, bets: { real: [], train: [] } };
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw) store = Object.assign(store, raw); } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };

  // ---------- Équité vérifiable (tirage dans l'app) ----------
  async function ensureSeeds() {
    if (store.seeds && store.seeds.server) return store.seeds;
    const server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: E.randomSeed().slice(0, 16), nonce: 0, prev: store.seeds ? store.seeds.prev : null };
    persist();
    return store.seeds;
  }
  async function rotateSeeds(client) {
    const old = store.seeds;
    const server = E.randomSeed();
    store.seeds = { server, hash: await E.sha256(server), client: (client || E.randomSeed().slice(0, 16)).slice(0, 32), nonce: 0,
      prev: old ? { server: old.server, client: old.client, nonce: old.nonce } : null };
    persist();
    renderFair();
  }
  // Prochaine manche : on calcule le résultat pendant le compte à rebours (rien n'est montré avant l'explosion)
  async function localRound() {
    const s = await ensureSeeds();
    s.nonce++;
    persist();
    return { crash: await E.crashFromSeeds(s.server, s.client, s.nonce), nonce: s.nonce, hash: s.hash };
  }

  // ---------- État ----------
  const S = { mode: null, stack: 0, start: 0 };                 // argent sur la table
  const G = { phase: 'idle', at: 0, cdEnd: 0, flightStart: 0, crash: null, next: null, round: null, bet: null, queued: null, markers: [], lastM: 1 };
  // bet : { amount, auto, cashed, cashAt, payout, settled, pending }
  const srv = () => S.mode === 'real' && window.Casino && Casino.server;
  const statsOf = () => store.stats[S.mode === 'real' ? 'real' : 'train'];
  const betsOf = () => store.bets[S.mode === 'real' ? 'real' : 'train'];

  function setStack(v) {
    S.stack = Math.max(0, Math.round(v * 100) / 100);
    if (S.mode === 'real' && window.Casino && !Casino.server) Casino.setStack('crash', S.stack);
  }

  // ---------- Déroulé des manches ----------
  function toCountdown() {
    G.phase = 'countdown'; G.at = now(); G.cdEnd = G.at + C.COUNTDOWN_MS;
    G.crash = null; G.bet = null; G.markers = []; G.lastM = 1; G.round = null;
    G.next = srv() ? null : localRound();  // résultat de la prochaine manche, calculé à l'avance
    if (G.queued == null && autoRebet && lastBet) G.queued = lastBet; // « miser à chaque manche »
    ui();
  }

  async function launch() {
    G.phase = 'launch'; G.at = now();
    // la mise réservée pendant le compte à rebours est maintenant engagée
    const amount = G.queued;
    G.queued = null;
    if (amount) {
      if (amount > S.stack) toast('Pas assez d\'argent sur la table pour ' + fmt(amount) + ' €.', true);
      else {
        G.bet = { amount, auto: readAuto(), cashed: false, cashAt: null, payout: 0, settled: false, pending: false };
        lastBet = amount;
        if (!srv()) setStack(S.stack - amount);
      }
    }
    if (window.Sfx && Sfx.engineStart) Sfx.engineStart();
    if (srv()) {
      // le serveur encaisse la mise, tire la manche et fixe l'heure du décollage
      const r = await Casino.call('cr.round', { bet: G.bet ? G.bet.amount : 0, auto: G.bet ? G.bet.auto || 0 : 0 });
      if (r.error) { toast(r.error, true); G.bet = null; G.round = null; }
      else { G.round = r; if (G.bet) setStack(r.stack); G.serverLaunch = now(); }
    } else {
      const r = await G.next;
      G.crash = r.crash; G.round = r;
    }
    ui();
  }

  function startFlight() {
    G.phase = 'flight'; G.flightStart = now(); G.at = G.flightStart;
    if (srv()) poll();
    ui();
  }

  // Explosion : les mises non retirées sont perdues
  function bust(crash) {
    if (G.phase === 'crashed') return;
    G.crash = crash;
    G.phase = 'crashed'; G.at = now();
    G.lastM = crash;
    if (window.Sfx) { if (Sfx.engineStop) Sfx.engineStop(true); if (Sfx.explosion) Sfx.explosion(); }
    store.hist.unshift(crash); store.hist = store.hist.slice(0, 20);
    if (G.bet && !G.bet.cashed && !G.bet.settled) record(G.bet, false);
    persist();
    renderHistory();
    ui();
  }

  // Retrait : accepté une seule fois, seulement en vol et avant l'explosion
  async function cashout(atMult) {
    const b = G.bet;
    if (!b || b.cashed || b.settled || b.pending || G.phase !== 'flight') return;
    const m = atMult || E.multiplierAt(now() - G.flightStart);
    if (srv()) {
      b.pending = true; ui();
      const r = await Casino.call('cr.cashout', { id: G.round && G.round.id });
      b.pending = false;
      if (r.error) { toast(r.error, true); ui(); return; }
      if (r.busted) { bust(r.crash); return; }
      b.cashed = true; b.cashAt = r.cashAt; b.payout = r.payout;
      setStack(r.stack);
      cashedFx(b);
      return;
    }
    if (G.crash == null || m > G.crash) return;   // trop tard : l'explosion sera réglée par la boucle
    const res = E.settle(b.amount, m, G.crash);
    if (!res.won) return;
    b.cashed = true; b.cashAt = m; b.payout = res.payout;
    setStack(S.stack + res.payout);
    cashedFx(b);
  }
  function cashedFx(b) {
    G.markers.push({ t: E.timeFor(b.cashAt), m: b.cashAt, text: '+' + fmt(b.payout) + ' €' });
    if (window.Sfx && Sfx.cashout) Sfx.cashout();
    toast('Retiré à ' + fmtM(b.cashAt) + ' : +' + fmt(b.payout) + ' €');
    record(b, true);
    if (b.payout >= b.amount * 10 && window.Casino) setTimeout(() => Casino.bigWin(b.payout, 'DÉCOLLAGE ' + fmtM(b.cashAt) + ' !'), 300);
    ui();
  }

  // Statistiques, historique et progression (XP, défis) : une seule fois par mise
  function record(b, won) {
    if (b.settled) return;
    b.settled = true;
    const net = won ? Math.round((b.payout - b.amount) * 100) / 100 : -b.amount;
    const st = statsOf();
    st.rounds++; st.wagered += b.amount; st.won += won ? b.payout : 0;
    if (won && b.cashAt > st.best) st.best = b.cashAt;
    betsOf().unshift({ amount: b.amount, cashAt: won ? b.cashAt : null, crash: G.crash, net, at: Date.now() });
    store.bets[S.mode === 'real' ? 'real' : 'train'] = betsOf().slice(0, 30);
    persist();
    if (window.Casino && S.mode === 'real' && !Casino.server) Casino.track('cr', { bet: b.amount, net, mult: won ? b.cashAt : 0, crash: G.crash });
    renderStats();
  }

  // Boucle logique : indépendante de l'affichage (20 fois par seconde, et à chaque image)
  let ticking = false;
  function tick() {
    if (ticking || !S.mode) return;
    ticking = true;
    try {
      const t = now();
      if (G.phase === 'countdown' && t >= G.cdEnd) launch();
      else if (G.phase === 'launch' && t - G.at >= C.LAUNCH_MS && G.round) {
        if (!srv() && G.crash <= 1) bust(1); // explosion au décollage
        else startFlight();
      } else if (G.phase === 'flight') {
        const ft = t - G.flightStart, m = E.multiplierAt(ft);
        G.lastM = m;
        const b = G.bet;
        if (!srv()) {
          const tCrash = E.timeFor(G.crash);
          // retrait automatique (au multiplicateur exact demandé) et gain maximal
          if (b && !b.cashed && !b.settled) {
            const cap = E.maxWinMult(b.amount);
            if (b.auto && b.auto <= G.crash && m >= b.auto) cashout(b.auto);
            else if (cap <= G.crash && m >= cap) cashout(cap);
          }
          if (ft >= tCrash) bust(G.crash);
        } else if (b && !b.cashed && !b.pending && b.auto && m >= b.auto) cashout(); // le serveur applique le retrait auto
        if (window.Sfx && Sfx.engineSet) Sfx.engineSet(m);
      } else if (G.phase === 'crashed' && t - G.at >= C.CRASH_SHOW_MS) toCountdown();
    } finally { ticking = false; }
  }
  setInterval(tick, 50);

  // Mode serveur : on demande régulièrement si la fusée a explosé (le serveur seul le sait)
  async function poll() {
    while (G.phase === 'flight' && srv() && G.round) {
      await new Promise((r) => setTimeout(r, 400));
      if (G.phase !== 'flight') return;
      const r = await Casino.call('cr.status', { id: G.round.id });
      if (r.error) continue;
      if (r.cashed && G.bet && !G.bet.cashed) { G.bet.cashed = true; G.bet.cashAt = r.cashAt; G.bet.payout = r.payout; setStack(r.stack); cashedFx(G.bet); }
      if (r.busted) { bust(r.crash); return; }
    }
  }

  // ---------- Actions du joueur ----------
  let lastBet = null, autoRebet = false;
  const readBet = () => Math.floor(Number($('bet').value));
  const readAuto = () => { const v = Number(String($('auto').value).replace(',', '.')); return v >= 1.01 ? E.floor2(v) : 0; };
  function mainAction() {
    if (!S.mode) return;
    const canCash = G.phase === 'flight' && G.bet && !G.bet.cashed && !G.bet.settled;
    if (canCash) { cashout(); return; }
    if (G.queued != null) { G.queued = null; ui(); return; } // annuler la mise réservée
    const v = readBet();
    if (!(v >= C.MIN_BET && v <= maxB())) { toast('Mise entre ' + C.MIN_BET + ' et ' + maxB() + ' €.', true); return; }
    if (S.mode === 'train' && S.stack < v) setStack(Math.max(S.stack, window.Casino ? Casino.TRAIN_BANK : 1000));
    if (v > S.stack) { toast('Pas assez d\'argent sur la table.', true); return; }
    G.queued = v;
    if (window.Sfx) Sfx.chips();
    ui();
  }
  $('bet-btn').addEventListener('click', mainAction);
  $('cash-btn').addEventListener('click', () => cashout());
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); mainAction(); }
  });
  document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => { $('bet').value = b.dataset.v; if (window.Sfx) Sfx.chips(); ui(); }));
  $('bet-half').addEventListener('click', () => { $('bet').value = Math.max(C.MIN_BET, Math.floor(readBet() / 2)); ui(); });
  $('bet-double').addEventListener('click', () => { $('bet').value = Math.min(maxB(), Math.max(C.MIN_BET, readBet() * 2)); ui(); });
  $('bet').addEventListener('input', () => ui());
  $('bet').addEventListener('change', () => { const v = readBet(); $('bet').value = Math.min(maxB(), Math.max(C.MIN_BET, isFinite(v) ? v : C.MIN_BET)); ui(); });
  $('auto').addEventListener('input', () => { renderAides(); });

  // ---------- Affichage ----------
  let toastTimer = null;
  function toast(text, err) {
    const t = $('toast'); t.textContent = text; t.className = 'stage-toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  function currentM() {
    if (G.phase === 'flight') return Math.min(G.crash || C.MAX_MULT, E.multiplierAt(now() - G.flightStart));
    if (G.phase === 'crashed') return G.crash || G.lastM;
    return 1;
  }
  // mise maximale : salon VIP en partie réelle (le serveur vérifie aussi)
  function maxB() { return Math.min(500, window.Casino && S.mode === 'real' ? Casino.maxBet() : 500); }
  let maxShown = null;
  function applyMax() {
    const m = maxB(); if (m === maxShown) return; maxShown = m;
    $('bet').max = m;
    if (readBet() > m) $('bet').value = m;
    document.querySelectorAll('#quick button').forEach((b) => { b.disabled = Number(b.dataset.v) > m; b.title = b.disabled ? 'Mise maximale de ton salon : ' + m + ' €' : ''; });
    let hint = document.getElementById('vip-hint');
    if (!hint) { hint = document.createElement('div'); hint.id = 'vip-hint'; hint.className = 'vip-hint'; $('quick').after(hint); }
    if (window.Casino && S.mode === 'real') { const v = Casino.vip(), nx = Casino.VIP.find((x) => x.lvl > v.lvl); hint.textContent = v.icon + ' ' + v.name + ' · mise max ' + m + ' €' + (nx ? ' · ' + nx.name + ' (' + nx.max + ' €) au niveau ' + nx.lvl : ''); hint.hidden = false; }
    else hint.hidden = true;
  }
  function ui() {
    if (!S.mode) return;
    applyMax();
    const m = currentM(), b = G.bet;
    const mult = $('mult'), label = $('state-label'), sub = $('sub');
    mult.classList.toggle('crashed', G.phase === 'crashed');
    mult.classList.toggle('cashed', G.phase === 'flight' && !!b && b.cashed);
    mult.classList.toggle('waiting', G.phase === 'countdown');
    mult.classList.toggle('hot', G.phase === 'flight' && m >= 2);
    if (G.phase === 'countdown') {
      setText(label, 'Prochain décollage');
      setText(mult, Math.max(0, (G.cdEnd - now()) / 1000).toFixed(1) + ' s');
      setText(sub, G.queued ? 'Mise réservée : ' + fmt(G.queued) + ' €' : 'Place ta mise !');
      sub.className = 'sub';
    } else if (G.phase === 'launch') {
      setText(label, 'Allumage des moteurs'); setText(mult, '1.00×'); setText(sub, b ? 'Mise : ' + fmt(b.amount) + ' €' : ''); sub.className = 'sub';
    } else if (G.phase === 'flight') {
      setText(label, 'En vol');
      setText(mult, fmtM(m));
      if (b && b.cashed) { setText(sub, 'Retiré à ' + fmtM(b.cashAt) + ' · +' + fmt(b.payout) + ' €'); sub.className = 'sub win'; }
      else if (b) { setText(sub, 'Gain : ' + fmt(b.amount * m) + ' €' + (b.auto ? ' · auto à ' + fmtM(b.auto) : '')); sub.className = 'sub'; }
      else { setText(sub, G.queued ? 'Mise réservée pour la prochaine manche' : 'Tu regardes cette manche'); sub.className = 'sub'; }
    } else if (G.phase === 'crashed') {
      setText(label, 'La fusée a explosé');
      setText(mult, '💥 ' + fmtM(G.crash || m));
      if (b && b.cashed) { setText(sub, 'Gagné : +' + fmt(b.payout - b.amount) + ' €'); sub.className = 'sub win'; }
      else if (b) { setText(sub, 'Perdu : −' + fmt(b.amount) + ' €'); sub.className = 'sub lose'; }
      else { setText(sub, ''); sub.className = 'sub'; }
    }
    // boutons
    const canCash = G.phase === 'flight' && b && !b.cashed && !b.settled;
    $('cash-btn').hidden = !canCash;
    $('bet-btn').hidden = !!canCash;
    $('cash-btn').disabled = !!(b && b.pending);
    if (canCash) $('cash-btn').innerHTML = 'RETIRER<small>' + fmt(Math.min(C.MAX_WIN, b.amount * m)) + ' €</small>';
    const btn = $('bet-btn');
    if (G.queued != null) { setText(btn, G.phase === 'countdown' ? 'ANNULER LA MISE' : 'ANNULER (prochaine manche)'); btn.classList.add('queued'); }
    else { setText(btn, G.phase === 'countdown' ? 'PARIER ' + fmt(readBet() || 0) + ' €' : 'PARIER (prochaine manche)'); btn.classList.remove('queued'); }
    // gain potentiel
    const auto = readAuto(), amount = b && !b.settled ? b.amount : (G.queued || readBet() || 0);
    setText($('potential'), canCash ? fmt(Math.min(C.MAX_WIN, b.amount * m)) + ' €' : auto ? fmt(Math.min(C.MAX_WIN, amount * auto)) + ' € à ' + fmtM(auto) : '–');
    setText($('stack'), fmt(S.stack) + ' €');
    showWallet();
    const busy = (G.phase === 'flight' || G.phase === 'launch') && b && !b.settled;
    $('end-btn').disabled = !!busy || G.queued != null;
    document.querySelectorAll('#quick button').forEach((q) => q.classList.toggle('on', Number(q.dataset.v) === readBet()));
    if (G.phase !== lastAidPhase || G.phase === 'flight') renderAides();
  }

  function renderHistory() {
    const h = $('history'); h.innerHTML = '';
    store.hist.slice(0, 20).forEach((m) => { const s = document.createElement('span'); s.className = 'hchip ' + E.tier(m); s.textContent = fmtM(m); h.appendChild(s); });
  }
  function renderStats() {
    const st = statsOf(), net = st.won - st.wagered;
    setText($('stats-mode'), S.mode === 'real' ? '· parties réelles' : '· apprentissage');
    setText($('s-rounds'), String(st.rounds));
    setText($('s-wagered'), fmt(st.wagered) + ' €');
    setText($('s-won'), fmt(st.won) + ' €');
    const n = $('s-net'); setText(n, (net >= 0 ? '+' : '−') + fmt(Math.abs(net)) + ' €'); n.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    setText($('s-best'), st.best ? 'Meilleur retrait : ' + fmtM(st.best) + (st.wagered ? ' · retour réel : ' + Math.round(st.won / st.wagered * 100) + ' % (en moyenne, le jeu rend ' + Math.round(C.RTP * 100) + ' %)' : '') : '');
    const ol = $('my-bets'); ol.innerHTML = '';
    const list = betsOf().slice(0, 15);
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Aucune mise pour l\'instant.'; ol.appendChild(li); }
    list.forEach((x) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = fmt(x.amount) + ' € · ' + (x.cashAt ? 'retrait ' + fmtM(x.cashAt) : 'explosé ' + fmtM(x.crash || 1));
      const c = document.createElement('span'); c.className = 'muted'; c.textContent = x.crash ? '💥 ' + fmtM(x.crash) : '';
      const r = document.createElement('span'); r.className = x.net >= 0 ? 'w' : 'l'; r.textContent = (x.net >= 0 ? '+' : '−') + fmt(Math.abs(x.net)) + ' €';
      li.append(a, c, r); ol.appendChild(li);
    });
  }
  let lastAidPhase = null;
  function renderAides() {
    lastAidPhase = G.phase;
    if (S.mode !== 'train') return;
    const box = $('aides-body'), auto = readAuto() || 2;
    const p = E.probReach(auto) * 100;
    const parts = [
      'Le casino garde en moyenne <b>' + Math.round((1 - C.RTP) * 100) + ' %</b> des mises : chaque retrait, quel que soit le moment, rend <b>' + Math.round(C.RTP * 100) + ' %</b> en moyenne. Aucune stratégie ne bat cet avantage.',
      'Chance que la fusée atteigne <b>' + fmtM(auto) + '</b> : <b>' + p.toFixed(1).replace('.', ',') + ' %</b>. Plus on vise haut, plus on gagne gros… et plus c\'est rare.',
    ];
    if (G.phase === 'flight' && G.bet && !G.bet.settled) {
      const m = currentM(), tgt = Math.max(auto, E.floor2(m * 1.5));
      parts.push('La fusée est déjà à <b>' + fmtM(m) + '</b> : chance d\'atteindre <b>' + fmtM(tgt) + '</b> à partir de maintenant = <b>' + (m / tgt * 100).toFixed(0) + ' %</b>. Le passé ne change rien : chaque instant est un nouveau pari.');
    }
    parts.push('Environ <b>' + ((1 - C.RTP / 1.01) * 100).toFixed(1).replace('.', ',') + ' %</b> des fusées explosent dès le décollage (×1,00).');
    box.innerHTML = parts.map((x) => '<div class="tip">' + x + '</div>').join('');
  }
  function renderFair() {
    const s = store.seeds;
    $('pf-hash').textContent = s ? s.hash : '–';
    if (document.activeElement !== $('pf-client')) $('pf-client').value = s ? s.client : '';
    $('pf-nonce').textContent = s ? String(s.nonce) : '0';
    $('pf-prev').textContent = s && s.prev ? s.prev.server + ' (client « ' + s.prev.client + ' », manches 1 à ' + s.prev.nonce + ')' : '–';
    $('pf-note').textContent = window.Casino && Casino.server && S.mode === 'real'
      ? 'Parties réelles : c\'est le serveur du Casino qui tire les manches avec ses propres seeds.'
      : 'Sans serveur, ces seeds sont générées sur ton appareil : la vérification montre que les manches suivent bien la formule annoncée.';
  }
  $('pf-rotate').addEventListener('click', () => rotateSeeds($('pf-client').value.trim()));
  $('pf-check').addEventListener('click', async () => {
    const seed = $('pf-v-seed').value.trim(), cl = $('pf-v-client').value.trim(), n = Number($('pf-v-nonce').value);
    if (!seed || !cl || !(n >= 1)) { $('pf-result').textContent = 'Remplis les trois champs.'; return; }
    $('pf-result').textContent = 'Résultat de la manche : ' + fmtM(await E.crashFromSeeds(seed, cl, n)) + ' · empreinte ' + (await E.sha256(seed)).slice(0, 16) + '…';
  });

  // Boucle d'affichage : la scène lit l'état, le texte suit
  const scene = new window.CrashScene($('scene'), E);
  // fusée équipée à la boutique
  const applySkin = () => { if (window.Casino && Casino.itemOf) scene.skin = Casino.itemOf('rocket', Casino.equipped('rocket')); };
  applySkin();
  if (window.Casino) Casino.onChange(applySkin);
  scene.start(() => {
    if (!S.mode) return { phase: 'countdown' };
    const t = G.phase === 'flight' ? now() - G.flightStart : G.phase === 'crashed' ? E.timeFor(G.crash || 1) : 0;
    return {
      phase: G.phase === 'idle' ? 'countdown' : G.phase, t, m: G.phase === 'flight' ? Math.min(G.crash || C.MAX_MULT, E.exactAt(t)) : G.phase === 'crashed' ? (G.crash || 1) : 1,
      cd: Math.max(0, (G.cdEnd - now()) / 1000), cdTotal: C.COUNTDOWN_MS / 1000, launch: G.phase === 'launch' ? Math.min(1, (now() - G.at) / C.LAUNCH_MS) : 0, markers: G.markers,
    };
  });
  (function hudLoop() { tick(); ui(); requestAnimationFrame(hudLoop); })();

  // ---------- Début et fin de partie (même fonctionnement que les autres jeux) ----------
  function showWallet() {
    if (!S.mode) { setText($('bank-label'), 'Banque'); setText($('wallet'), window.Casino ? fmt(Casino.wallet()) : '–'); return; }
    setText($('bank-label'), 'Banque'); setText($('wallet'), window.Casino ? fmt(Casino.wallet()) : '–');
    setText($('stack-label'), S.mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table');
  }
  function startGame(mode, amount) {
    S.mode = mode;
    if (window.Casino) Casino.training = mode === 'train';
    S.stack = amount;
    S.start = amount;
    document.body.classList.toggle('real-mode', mode === 'real');
    $('setup').hidden = true; $('game').hidden = false;
    const badge = $('mode-badge'); badge.hidden = false;
    badge.className = 'mode-badge' + (mode === 'real' ? ' real' : '');
    badge.textContent = mode === 'real' ? '💰 Partie réelle · ta banque · sans aides' : '🎓 Apprentissage · crédit illimité, aides et conseils';
    $('end-btn').hidden = mode === 'train';
    renderHistory(); renderStats(); renderFair();
    setTimeout(() => scene.resize(), 0);
    toCountdown();
  }
  async function endSession() {
    if (G.bet && !G.bet.settled && (G.phase === 'flight' || G.phase === 'launch')) { toast('Attends la fin de la manche.', true); return; }
    G.queued = null;
    let msg = '';
    if (S.mode === 'real' && window.Casino) {
      const r = await Casino.cashOut('crash');
      if (r && r.error) { toast(r.error, true); return; }
      const diff = r ? r.diff : 0;
      msg = 'Tu encaisses ' + fmt(r ? r.end : S.stack) + ' € (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' € par rapport à la somme apportée).';
      Casino.toast('Encaissé !', msg, '💰', diff > 0 ? 'gold' : '');
    }
    S.mode = null;
    if (window.Sfx && Sfx.engineStop) Sfx.engineStop(true);
    G.phase = 'idle';
    $('game').hidden = true; $('setup').hidden = false;
    renderPicker(msg);
    showWallet();
  }
  $('end-btn').addEventListener('click', endSession);
  function renderPicker(msg) {
    const box = $('mode-picker');
    if (!window.Casino) { startGame('train', 10000); return; }
    Casino.modePicker(box, { game: 'crash', min: C.MIN_BET, suggest: 100, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; box.prepend(p); }
  }
  // Quitter la page en pleine manche : la mise engagée est perdue (elle est déjà retirée de la table)
  window.addEventListener('pagehide', () => { if (window.Sfx && Sfx.engineStop) Sfx.engineStop(true); });
  renderPicker();
  showWallet();
  if (window.Casino) Casino.onChange(() => showWallet());
  // pour les tests
  window.RocketCrash = { get state() { return { S, G, store }; }, cashout, mainAction, bust };
})();
