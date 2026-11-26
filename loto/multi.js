/*
 * Loto entre amis : un vrai loto de salle des fêtes.
 * Cartons de 3 lignes × 9 colonnes (5 numéros par ligne, 1 à 90). Les boules sortent à intervalle régulier.
 * Chaque partie : 1re quine, 2e quine, double quine, carton plein ; le premier qui annonce (bouton) gagne.
 * Pas d'hôte nécessaire pour tirer : le premier appareil qui voit l'heure du tirage le fait, dans une transaction.
 * Pour le plaisir : on joue aux points (pas d'argent).
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const COLORS = ['#16a34a', '#2563eb', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#059669'];
  const STAGES = [
    { id: 'q1', label: '1re quine', btn: 'QUINE !', lines: 1, pts: 3 },
    { id: 'q2', label: '2e quine', btn: 'QUINE !', lines: 1, pts: 2 },
    { id: 'dq', label: 'Double quine', btn: 'DOUBLE QUINE !', lines: 2, pts: 5 },
    { id: 'cp', label: 'Carton plein', btn: 'CARTON !', lines: 3, pts: 10 },
  ];
  const AUTO_AFTER = 3; // si personne n'annonce, le lot est donné au gagnant après 3 boules
  const now = () => Date.now();
  let net = null, me = null, tableId = null, st = null, unsub = [], stopPresence = null, timer = null, lastBall = null, lastWinCount = 0, podiumShown = false;

  function myName() { try { return ((window.Casino && Casino.profile.pseudo) || localStorage.getItem('bj-pseudo') || 'Joueur').trim().slice(0, 16); } catch (e) { return 'Joueur'; } }
  function rndInt(n) { const a = new Uint32Array(1); (window.crypto || window.msCrypto).getRandomValues(a); return a[0] % n; }

  // ---------- Cartons (règles du loto traditionnel) ----------
  function genCard() {
    // 1. choisir 5 colonnes par ligne, chaque colonne utilisée au moins une fois
    let rows;
    for (let t = 0; t < 200; t++) {
      rows = [0, 1, 2].map(() => { const c = [0, 1, 2, 3, 4, 5, 6, 7, 8]; for (let i = c.length - 1; i > 0; i--) { const j = rndInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, 5).sort((a, b) => a - b); });
      const used = new Set(rows.flat()); if (used.size === 9) break;
    }
    // 2. remplir chaque colonne avec des numéros de sa dizaine, triés de haut en bas
    const grid = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0)];
    for (let c = 0; c < 9; c++) {
      const lo = c === 0 ? 1 : c * 10, hi = c === 8 ? 90 : c * 10 + 9, pool = [];
      for (let n = lo; n <= hi; n++) pool.push(n);
      const who = [0, 1, 2].filter((r) => rows[r].includes(c)), picks = [];
      while (picks.length < who.length) picks.push(pool.splice(rndInt(pool.length), 1)[0]);
      picks.sort((a, b) => a - b); who.forEach((r, i) => { grid[r][c] = picks[i]; });
    }
    return grid;
  }
  const linesDone = (grid, set) => grid.filter((row) => row.every((n) => !n || set.has(n))).length;
  const bestLines = (p, set) => Math.max(0, ...((p && p.cards) || []).map((g) => linesDone(g, set)));
  function canClaim(x, uid) {
    const p = x.players[uid], s = STAGES[x.stage];
    if (!p || !p.cards || !s || x.phase !== 'playing') return false;
    if (s.id === 'q2' && (x.gameWins || []).some((w) => w.stage === 'q1' && w.uid === uid)) return false; // une seule quine par joueur et par partie
    return bestLines(p, new Set(x.drawn)) >= s.lines;
  }

  // ---------- État partagé ----------
  function normalize(x) {
    x.players = x.players || {}; x.drawn = x.drawn || []; x.winners = x.winners || []; x.gameWins = x.gameWins || [];
    x.settings = Object.assign({ games: 3, cards: 2, speed: 4000 }, x.settings || {});
    Object.values(x.players).forEach((p) => { p.cards = (p.cards || []).map((g) => (g || []).map((r) => Array.from({ length: 9 }, (_, i) => (r && r[i]) || 0))); p.pts = p.pts || 0; });
    x.phase = x.phase || 'waiting'; x.game = x.game || 0; x.stage = x.stage || 0;
    return x;
  }
  const initial = (name, settings) => ({ name, creator: me, settings, started: false, phase: 'waiting', game: 0, stage: 0, drawn: [], winners: [], gameWins: [], players: {}, createdAt: now(), updatedAt: now() });
  function deal(x) {
    Object.values(x.players).forEach((p) => { p.cards = Array.from({ length: x.settings.cards }, genCard); });
    x.drawn = []; x.stage = 0; x.gameWins = []; x.pend = null;
  }
  function award(x, uid, auto) {
    const s = STAGES[x.stage], p = x.players[uid];
    p.pts = (p.pts || 0) + s.pts;
    p.won = p.won || {}; p.won[s.id] = (p.won[s.id] || 0) + 1;
    const w = { stage: s.id, label: s.label, uid, name: p.name, pts: s.pts, game: x.game, at: now(), n: x.drawn.length, auto: !!auto };
    x.gameWins.push(w); x.winners.push(w);
    if (x.winners.length > 60) x.winners = x.winners.slice(-60);
    x.stage++; x.pend = null;
    if (x.stage >= STAGES.length) {
      if (x.game >= x.settings.games) { x.phase = 'over'; x.overAt = now(); }
      else { x.phase = 'break'; x.breakUntil = now() + 9000; }
    }
  }
  // opérations (transactions)
  function opJoin(x) {
    if (x.players[me]) { x.players[me].name = myName(); return; }
    if (x.started) return false; // la partie a commencé : on regarde
    if (Object.keys(x.players).length >= 10) return false;
    x.players[me] = { name: myName(), color: COLORS[Object.keys(x.players).length % COLORS.length], ready: false, pts: 0, cards: [] };
  }
  const opReady = (v) => (x) => { if (!x.players[me] || x.started) return false; x.players[me].ready = v; };
  function opStart(x) {
    if (x.started || x.creator !== me || Object.keys(x.players).length < 3) return false;
    x.started = true; x.phase = 'playing'; x.game = 1; deal(x); x.nextAt = now() + 3500;
  }
  function opDraw(x) {
    if (x.phase !== 'playing' || now() < (x.nextAt || 0) - 250) return false;
    // lot pas annoncé depuis AUTO_AFTER boules : donné automatiquement
    const elig = Object.keys(x.players).filter((u) => canClaim(x, u));
    if (elig.length) {
      if (!x.pend || x.pend.stage !== x.stage) x.pend = { stage: x.stage, since: x.drawn.length };
      else if (x.drawn.length - x.pend.since >= AUTO_AFTER) { award(x, elig[rndInt(elig.length)], true); if (x.phase !== 'playing') return; }
    }
    const left = []; const set = new Set(x.drawn);
    for (let n = 1; n <= 90; n++) if (!set.has(n)) left.push(n);
    if (!left.length) return false;
    x.drawn.push(left[rndInt(left.length)]);
    x.nextAt = now() + x.settings.speed;
  }
  function opClaim(x) {
    if (!canClaim(x, me)) return false;
    award(x, me, false);
  }
  function opNextGame(x) {
    if (x.phase !== 'break' || now() < (x.breakUntil || 0) - 250) return false;
    x.game++; x.phase = 'playing'; deal(x); x.nextAt = now() + 3000;
  }
  function opRestart(x) {
    if (x.phase !== 'over' || x.creator !== me) return false;
    Object.values(x.players).forEach((p) => { p.pts = 0; p.won = {}; p.ready = false; p.cards = []; });
    x.started = false; x.phase = 'waiting'; x.game = 0; x.stage = 0; x.drawn = []; x.winners = []; x.gameWins = [];
  }
  async function act(fn) {
    if (!net || !tableId) return false;
    try { return await net.transact(tableId, fn); } catch (e) { $('feed').textContent = 'Action non envoyée : vérifie ta connexion.'; return false; }
  }

  // ---------- Horloge partagée ----------
  function schedule() {
    clearTimeout(timer);
    if (!st) return;
    if (st.phase === 'playing') timer = setTimeout(() => act(opDraw), Math.max(150, (st.nextAt || now()) - now() + rndInt(200)));
    else if (st.phase === 'break') timer = setTimeout(() => act(opNextGame), Math.max(150, (st.breakUntil || now()) - now() + rndInt(200)));
  }

  // ---------- Affichage ----------
  const manualMarks = new Set();
  function onState(raw) {
    if (!raw) { showLobby('Cette salle n\'existe plus.'); return; }
    const prev = st;
    st = normalize(raw);
    if (!st.players[me] && !st.started) act(opJoin);
    // nouvelle boule : annonce
    const ball = st.drawn[st.drawn.length - 1];
    if (ball && ball !== lastBall && prev) announce(ball);
    if (!prev || (prev.game !== st.game)) manualMarks.clear();
    lastBall = ball;
    // nouveaux gagnants
    if (prev && st.winners.length > lastWinCount) st.winners.slice(lastWinCount).forEach(celebrateWin);
    lastWinCount = st.winners.length;
    render(); schedule();
    lobbyTick();
    if (st.phase === 'over' && !podiumShown) { podiumShown = true; setTimeout(showPodium, 1800); }
    if (st.phase !== 'over') { podiumShown = false; $('podium').hidden = true; }
  }
  function announce(n) {
    const b = $('ball'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (window.Sfx) { if (Sfx.card) Sfx.card(); if (Sfx.say) Sfx.say(String(n)); }
    if (st.players[me] && bestLines(st.players[me], new Set(st.drawn)) && window.Casino && canClaim(st, me)) Casino.vibrate([30, 40, 30]);
  }
  function celebrateWin(w) {
    const mine = w.uid === me;
    const f = document.createElement('div'); f.className = 'flash-win';
    const d = document.createElement('div'); d.textContent = (w.stage === 'cp' ? '🎉 CARTON PLEIN !' : w.stage === 'dq' ? 'DOUBLE QUINE !' : 'QUINE !');
    const sm = document.createElement('small'); sm.textContent = (mine ? 'Bravo, c\'est toi !' : w.name) + ' · +' + w.pts + ' pts' + (w.auto ? ' (annoncé automatiquement)' : ''); d.appendChild(sm);
    f.appendChild(d); document.body.appendChild(f); setTimeout(() => f.remove(), 2100);
    if (window.Sfx) { if (mine) { Sfx.win(); setTimeout(() => Sfx.win(), 300); } else if (Sfx.push) Sfx.push(); if (Sfx.say) Sfx.say((w.stage === 'cp' ? 'Carton plein' : w.stage === 'dq' ? 'Double quine' : 'Quine') + ' pour ' + w.name); }
    if (mine && window.Casino) Casino.vibrate([60, 40, 120]);
  }
  function render() {
    if (!st) return;
    const set = new Set(st.drawn), s = STAGES[st.stage], meP = st.players[me];
    $('code').textContent = tableId; $('code-box').hidden = false;
    // salle d'attente
    if (window.Social && Social.waitingRoom) Social.waitingRoom({
      container: $('wait-host'), started: st.started, me, hostUid: st.creator, minPlayers: 3,
      players: Object.keys(st.players).map((u) => ({ uid: u, name: st.players[u].name, ready: st.players[u].ready })),
      onStart: () => act(opStart), onReady: (v) => act(opReady(v)),
    });
    $('wait-host').hidden = st.started;
    // annonceur
    const ball = st.drawn[st.drawn.length - 1];
    $('ball').firstElementChild.textContent = ball || '–';
    $('stage').textContent = st.phase === 'waiting' ? 'En attente des joueurs (3 minimum)…' : st.phase === 'break' ? '⏸ Prochaine partie dans quelques secondes…' : st.phase === 'over' ? '🏁 Fin du loto !' : '🎯 En jeu : ' + s.label + ' (' + s.pts + ' pts)';
    $('gameno').textContent = st.started ? 'Partie ' + st.game + ' / ' + st.settings.games + ' · ' + st.drawn.length + ' boule' + (st.drawn.length > 1 ? 's' : '') + ' tirée' + (st.drawn.length > 1 ? 's' : '') : '';
    const last = $('last'); last.innerHTML = '';
    st.drawn.slice(-7, -1).reverse().forEach((n) => { const b = document.createElement('span'); b.textContent = n; last.appendChild(b); });
    // bouton d'annonce
    const cl = $('claim'), ok = canClaim(st, me);
    cl.hidden = !meP || !st.started || st.phase === 'over';
    cl.textContent = s ? s.btn : 'QUINE !'; cl.disabled = !ok; cl.classList.toggle('ready', ok);
    const lw = st.gameWins[st.gameWins.length - 1];
    $('feed').textContent = lw ? '🏆 ' + lw.label + ' : ' + lw.name + ' (+' + lw.pts + ' pts)' : st.started ? 'Les boules sortent… vise la première quine !' : '';
    // mes cartons
    const box = $('cards'); box.innerHTML = '';
    if (!meP) box.innerHTML = '<p class="muted">' + (st.started ? '👀 Tu regardes la partie (elle a commencé avant ton arrivée).' : 'Installation…') + '</p>';
    else if (!meP.cards.length) box.innerHTML = '<p class="muted">Tes cartons seront distribués au lancement de la partie.</p>';
    else meP.cards.forEach((g, ci) => box.appendChild(cardEl(g, ci, set, meP.color)));
    $('mine-info').textContent = meP && meP.cards.length ? '· meilleur : ' + bestLines(meP, set) + ' ligne' + (bestLines(meP, set) > 1 ? 's' : '') + ' complète' + (bestLines(meP, set) > 1 ? 's' : '') : '';
    // joueurs
    const ol = $('players'); ol.innerHTML = '';
    Object.keys(st.players).sort((a, b) => (st.players[b].pts || 0) - (st.players[a].pts || 0)).forEach((u) => {
      const p = st.players[u], li = document.createElement('li');
      const d = document.createElement('span'); d.className = 'dot'; d.style.background = p.color;
      const n = document.createElement('span'); n.textContent = (u === st.creator ? '👑 ' : '') + p.name + (u === me ? ' (toi)' : '');
      const w = p.won || {}, sm = document.createElement('small'); sm.textContent = [w.q1 || w.q2 ? '🎯×' + ((w.q1 || 0) + (w.q2 || 0)) : '', w.dq ? '✌️×' + w.dq : '', w.cp ? '🎉×' + w.cp : ''].filter(Boolean).join(' ');
      const pts = document.createElement('b'); pts.textContent = (p.pts || 0) + ' pts';
      li.append(d, n, sm, pts); ol.appendChild(li);
    });
    // tableau des 90
    const bd = $('board');
    if (!bd.children.length) for (let n = 1; n <= 90; n++) { const sp = document.createElement('span'); sp.textContent = n; bd.appendChild(sp); }
    Array.from(bd.children).forEach((sp, i) => { sp.classList.toggle('on', set.has(i + 1)); sp.classList.toggle('just', i + 1 === ball); });
  }
  function cardEl(g, ci, set, color) {
    const auto = $('auto-mark').checked;
    const el = document.createElement('div'); el.className = 'carton'; el.style.setProperty('--cc', color);
    const lines = linesDone(g, set);
    if (lines) el.classList.add('win');
    const h = document.createElement('div'); h.className = 'ct-head';
    h.innerHTML = '<span>CARTON ' + (ci + 1) + '</span><span>' + lines + ' / 3 ligne' + (lines > 1 ? 's' : '') + '</span>';
    const grid = document.createElement('div'); grid.className = 'ct-grid';
    g.forEach((row, r) => row.forEach((n) => {
      const c = document.createElement('div');
      const done = row.every((x) => !x || set.has(x));
      if (!n) { c.className = 'c e'; grid.appendChild(c); return; }
      const key = ci + ':' + n, marked = auto ? set.has(n) : manualMarks.has(key);
      c.className = 'c n' + (marked ? ' m' : '') + (done ? ' done' : '');
      if (done) c.style.background = '#bbf7d0';
      const b = document.createElement('b'); b.textContent = n; c.appendChild(b);
      c.onclick = () => { if (auto) return; if (manualMarks.has(key)) manualMarks.delete(key); else if (set.has(n)) manualMarks.add(key); else { c.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], 200); return; } render(); };
      grid.appendChild(c);
    }));
    el.append(h, grid);
    return el;
  }
  function showPodium() {
    if (!st || st.phase !== 'over') return;
    const pod = $('podium'); pod.innerHTML = '';
    const box = document.createElement('div'); box.className = 'box';
    const h = document.createElement('h2'); h.textContent = '🏆 Classement final';
    const ol = document.createElement('ol');
    const ranks = Object.keys(st.players).sort((a, b) => (st.players[b].pts || 0) - (st.players[a].pts || 0) || ((st.players[b].won || {}).cp || 0) - ((st.players[a].won || {}).cp || 0));
    ranks.forEach((u, i) => { const li = document.createElement('li'); li.textContent = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.'; const n = document.createElement('span'); n.textContent = st.players[u].name + (u === me ? ' (toi)' : ''); const b = document.createElement('b'); b.textContent = (st.players[u].pts || 0) + ' pts'; li.append(n, b); ol.appendChild(li); });
    const p = document.createElement('p'); p.className = 'muted small'; p.textContent = st.settings.games + ' partie' + (st.settings.games > 1 ? 's' : '') + ' · quine 3 et 2 pts, double quine 5 pts, carton plein 10 pts';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = st.creator === me ? '🔁 Rejouer avec les mêmes' : 'Fermer';
    close.onclick = () => { pod.hidden = true; if (st.creator === me) act(opRestart); };
    box.append(h, ol, p, close); pod.appendChild(box); pod.hidden = false;
    if (ranks[0] === me && window.Casino) { Casino.vibrate([80, 50, 160]); if (window.Sfx) Sfx.win(); }
    if (window.Casino && st.players[me]) Casino.track('multi', { game: 'loto' });
  }

  // ---------- Liste des salles (onglet Multijoueur) ----------
  let lobbyLast = null;
  function lobbyTick() {
    if (!st || !tableId || !window.Social || !Social.lobbyBeat) return;
    if (st.creator !== me || st.phase === 'over') { if (lobbyLast) { Social.lobbyRemove('loto', tableId, lobbyLast); lobbyLast = null; } return; }
    lobbyLast = { name: st.name, host: myName(), players: Object.keys(st.players).length, max: 10, pub: st.settings.public !== false, lk: st.settings.lk, live: st.started };
    Social.lobbyBeat('loto', tableId, lobbyLast);
  }
  setInterval(lobbyTick, 30000);

  // ---------- Entrée / sortie ----------
  function cleanup() { unsub.forEach((u) => { try { u(); } catch (e) { /* ignore */ } }); unsub = []; clearTimeout(timer); if (stopPresence) { stopPresence(); stopPresence = null; } }
  function setUrl(code) { try { const u = new URL(location.href); if (code) u.searchParams.set('table', code); else u.searchParams.delete('table'); u.searchParams.delete('multi'); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ } }
  function showLobby(note) { cleanup(); st = null; tableId = null; $('room').hidden = true; $('lobby').hidden = false; $('code-box').hidden = true; $('note').textContent = note || ''; setUrl(null); }
  async function openTable(id) {
    cleanup();
    $('note').textContent = 'Recherche de la salle…';
    tableId = id; st = null; lastBall = null; lastWinCount = 0; podiumShown = false;
    $('lobby').hidden = true; $('room').hidden = false; $('note').textContent = '';
    setUrl(id);
    if (window.Social && Social.tableReady) Social.tableReady('loto', id);
    stopPresence = net.presenceStart(id);
    unsub.push(net.watchTable(id, onState, () => { $('feed').textContent = 'Connexion perdue.'; }));
    unsub.push(net.watchChat(id, renderChat));
    await act(opJoin);
  }
  function renderChat(list) {
    const log = $('chat'); log.innerHTML = '';
    list.forEach((m) => {
      if (window.Social && Social.isReaction && Social.isReaction(m)) { Social.floatReaction(m); return; }
      const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = (m.name || '?') + ' : '; d.append(b, document.createTextNode(m.text || '')); log.appendChild(d);
    });
    log.scrollTop = log.scrollHeight;
  }
  $('create').addEventListener('click', async () => {
    if (!net) return;
    $('create').disabled = true;
    const settings = { games: +$('f-games').value, cards: +$('f-cards').value, speed: +$('f-speed').value, public: $('f-public').checked, lk: Math.random().toString(36).slice(2, 10) };
    try { const id = await net.createTable(initial($('f-name').value.trim().slice(0, 30) || 'Loto de ' + myName(), settings)); await openTable(id); }
    catch (e) { $('note').textContent = 'Impossible de créer la salle : vérifie ta connexion (et que les règles Firebase sont à jour).'; }
    $('create').disabled = false;
  });
  $('join').addEventListener('submit', (e) => { e.preventDefault(); const c = $('join-code').value.trim().toUpperCase(); if (c.length >= 4) openTable(c); });
  $('claim').addEventListener('click', async () => { $('claim').disabled = true; const ok = await act(opClaim); if (!ok) $('feed').textContent = 'Trop tard : quelqu\'un a annoncé avant toi !'; });
  $('auto-mark').addEventListener('change', render);
  $('leave').addEventListener('click', () => { if (lobbyLast && window.Social) Social.lobbyRemove('loto', tableId, lobbyLast); lobbyLast = null; showLobby(); location.href = '../index.html#multi'; });
  $('invite').addEventListener('click', () => { if (window.Social && Social.inviteDialog) Social.inviteDialog('loto', tableId); });
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault(); const t = $('chat-input').value.trim(); $('chat-input').value = '';
    if (t && net && tableId) net.sendChat(tableId, { uid: me, name: myName(), text: t.slice(0, 300), ts: now() }).catch(() => {});
  });

  (async function start() {
    $('f-name').placeholder = 'Loto de ' + myName();
    net = await window.createNet({ ns: 'l', normalize });
    if (!net || net.error) { $('note').textContent = 'Le multijoueur a besoin d\'une connexion (Firebase).'; $('create').disabled = true; return; }
    me = net.me;
    if (window.Social && Social.reactionBar) Social.reactionBar($('chat-form').parentNode, (emoji) => { if (net && tableId) net.sendChat(tableId, { uid: me, name: myName(), text: emoji, ts: now(), reaction: true }).catch(() => {}); });
    const code = new URLSearchParams(location.search).get('table');
    if (code) openTable(code.toUpperCase());
  })();
  window.LotoMulti = { get state() { return st; }, genCard, linesDone, act };
})();
