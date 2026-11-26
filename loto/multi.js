/*
 * Loto entre amis : un vrai loto de salle des fêtes, en ligne.
 * - Chaque joueur achète un pack de cartons (6 à 24) ; l'argent va dans une cagnotte gardée par le serveur du Casino.
 * - Deux styles : « séries » (chaque série de 6 cartons contient les 90 numéros une seule fois) ou « classiques ».
 * - Les boules sortent une par une ; chacun TAMPONNE ses numéros en les touchant. La boule suivante sort dès que
 *   tous ceux qui avaient le numéro l'ont tamponné, sinon au bout du temps maximum (on peut tamponner en retard).
 * - Chaque partie : 1re quine, 2e quine, double quine, carton plein (avec les numéros tamponnés). Le premier qui
 *   annonce gagne ; un lot non annoncé est attribué après 3 boules à un joueur qui l'a.
 * - À la fin, le serveur partage la cagnotte entre les gagnants (sans frais). Sans serveur : on joue aux points.
 * Pas d'hôte nécessaire pour tirer : le premier appareil qui voit l'heure du tirage le fait, dans une transaction.
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
  const AUTO_AFTER = 3;          // lot non annoncé : donné après 3 boules
  const QUICK_NEXT = 1600;       // tout le monde a tamponné : boule suivante 1,6 s après
  const NOBODY_NEXT = 2600;      // personne n'a le numéro : boule suivante 2,6 s après
  const LOTO = (window.Casino && Casino.LOTO) || { PRICES: [0, 1, 2, 5], PACKS: { serie: [6, 12, 18, 24], classique: [6, 10, 14, 24] }, SHARES: { q1: 0.15, q2: 0.15, dq: 0.25, cp: 0.45 } };
  const packCost = (price, n) => (window.Casino && Casino.lotoPackCost ? Casino.lotoPackCost(price, n) : Math.round(price * n * (1 - (n >= 24 ? 0.25 : n >= 14 ? 0.15 : n >= 10 ? 0.1 : 0)) * 100) / 100);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const now = () => Date.now();
  let net = null, me = null, tableId = null, st = null, unsub = [], stopPresence = null, timer = null, autoT = null;
  let lastBall = null, lastWinCount = 0, podiumShown = false, settled = false, gains = null;

  function myName() { try { return ((window.Casino && Casino.profile.pseudo) || localStorage.getItem('bj-pseudo') || 'Joueur').trim().slice(0, 16); } catch (e) { return 'Joueur'; } }
  function rndInt(n) { const a = new Uint32Array(1); (window.crypto || window.msCrypto).getRandomValues(a); return a[0] % n; }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rndInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const colRange = (c) => { const lo = c === 0 ? 1 : c * 10, hi = c === 8 ? 90 : c * 10 + 9, r = []; for (let n = lo; n <= hi; n++) r.push(n); return r; };

  // ---------- Cartons ----------
  /** Place les numéros de chaque colonne (1 à 3) sur 3 lignes de 5 : pour chaque colonne, les lignes occupées. */
  function layout(counts) {
    for (let t = 0; t < 500; t++) {
      const rowLeft = [5, 5, 5], rows = Array(9).fill(null);
      const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).sort((a, b) => counts[b] - counts[a]);
      let ok = true;
      for (const c of order) {
        const cand = [0, 1, 2].filter((r) => rowLeft[r] > 0);
        if (cand.length < counts[c]) { ok = false; break; }
        const pick = shuffle(cand).sort((a, b) => rowLeft[b] - rowLeft[a]).slice(0, counts[c]).sort((a, b) => a - b);
        pick.forEach((r) => rowLeft[r]--); rows[c] = pick;
      }
      if (ok && rowLeft.every((x) => x === 0)) return rows;
    }
    return null;
  }
  function build(counts, numsByCol) {
    const rows = layout(counts), grid = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0)];
    for (let c = 0; c < 9; c++) { const ns = numsByCol[c].slice().sort((a, b) => a - b); rows[c].forEach((r, i) => { grid[r][c] = ns[i]; }); }
    return grid;
  }
  /** Carton classique : 15 numéros au hasard (5 par ligne, au moins un par colonne). */
  function genCard() {
    let counts;
    do { counts = Array(9).fill(1); for (let k = 0; k < 6; k++) { const free = counts.map((v, i) => i).filter((i) => counts[i] < 3); counts[free[rndInt(free.length)]]++; } } while (!layout(counts));
    return build(counts, counts.map((k, c) => shuffle(colRange(c)).slice(0, k)));
  }
  /** Série de 6 cartons : les 90 numéros, chacun une seule fois. */
  function genSerie() {
    const TOT = [9, 10, 10, 10, 10, 10, 10, 10, 11];
    for (let t = 0; t < 400; t++) {
      const M = Array.from({ length: 6 }, () => Array(9).fill(1)), need = Array(6).fill(6);
      const extras = []; TOT.forEach((n, c) => { for (let k = 0; k < n - 6; k++) extras.push(c); });
      let ok = true;
      for (const c of shuffle(extras)) {
        const cand = [0, 1, 2, 3, 4, 5].filter((i) => need[i] > 0 && M[i][c] < 3);
        if (!cand.length) { ok = false; break; }
        const best = Math.max(...cand.map((i) => need[i])), top = cand.filter((i) => need[i] === best);
        const i = top[rndInt(top.length)]; M[i][c]++; need[i]--;
      }
      if (!ok || !M.every((cnt) => layout(cnt))) continue;
      const pools = TOT.map((n, c) => shuffle(colRange(c)));
      return M.map((cnt) => build(cnt, cnt.map((k, c) => pools[c].splice(0, k))));
    }
    return Array.from({ length: 6 }, genCard);
  }
  const hasNum = (p, n) => (p.cards || []).some((g) => g.some((row) => row.includes(n)));
  const linesDone = (grid, set) => grid.filter((row) => row.every((n) => !n || set.has(n))).length;
  const bestLines = (p, set) => Math.max(0, ...((p && p.cards) || []).map((g) => linesDone(g, set)));
  const marksOf = (p) => new Set((p && p.marks) || []);
  function canClaim(x, uid) {
    const p = x.players[uid], s = STAGES[x.stage];
    if (!p || !p.cards || !p.cards.length || !s || x.phase !== 'playing') return false;
    if (s.id === 'q2' && (x.gameWins || []).some((w) => w.stage === 'q1' && w.uid === uid)) return false; // une seule quine par joueur et par partie
    return bestLines(p, marksOf(p)) >= s.lines;
  }

  // ---------- État partagé ----------
  const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  function normalize(x) {
    x.players = x.players || {}; x.drawn = arr(x.drawn); x.winners = arr(x.winners); x.gameWins = arr(x.gameWins);
    x.settings = Object.assign({ games: 3, style: 'serie', price: 0, timeout: 10000 }, x.settings || {});
    Object.values(x.players).forEach((p) => {
      p.cards = arr(p.cards).map((g) => arr(g).map((r) => Array.from({ length: 9 }, (_, i) => (r && r[i]) || 0)));
      p.marks = arr(p.marks); p.pts = p.pts || 0; p.pack = p.pack || 0; p.paid = p.paid || 0;
    });
    x.phase = x.phase || 'waiting'; x.game = x.game || 0; x.stage = x.stage || 0;
    return x;
  }
  const initial = (name, settings) => ({ name, creator: me, settings, started: false, phase: 'waiting', game: 0, stage: 0, drawn: [], winners: [], gameWins: [], players: {}, createdAt: now(), updatedAt: now() });
  function deal(x) {
    Object.values(x.players).forEach((p) => {
      if (x.settings.style === 'serie') { p.cards = []; for (let k = 0; k < Math.max(1, Math.round(p.pack / 6)); k++) p.cards.push(...genSerie()); }
      else p.cards = Array.from({ length: p.pack }, genCard);
      p.marks = [];
    });
    x.drawn = []; x.stage = 0; x.gameWins = []; x.pend = null;
  }
  function award(x, uid, auto) {
    const s = STAGES[x.stage], p = x.players[uid];
    p.pts = (p.pts || 0) + s.pts;
    p.won = p.won || {}; p.won[s.id] = (p.won[s.id] || 0) + 1;
    const w = { stage: s.id, label: s.label, uid, name: p.name, pts: s.pts, game: x.game, at: now(), n: x.drawn.length, auto: !!auto };
    x.gameWins.push(w); x.winners.push(w);
    x.stage++; x.pend = null;
    if (x.stage >= STAGES.length) {
      if (x.game >= x.settings.games) { x.phase = 'over'; x.overAt = now(); }
      else { x.phase = 'break'; x.breakUntil = now() + 9000; }
    }
  }
  /** Qui doit encore tamponner la dernière boule ? */
  const waitingFor = (x) => { const n = x.drawn[x.drawn.length - 1]; return n ? Object.keys(x.players).filter((u) => hasNum(x.players[u], n) && !x.players[u].marks.includes(n)) : []; };

  // opérations (transactions)
  function opJoin(x) {
    if (x.players[me]) { x.players[me].name = myName(); return; }
    if (x.started) return false; // la partie a commencé : on regarde
    if (Object.keys(x.players).length >= 12) return false;
    x.players[me] = { name: myName(), color: COLORS[Object.keys(x.players).length % COLORS.length], ready: false, pts: 0, pack: 0, paid: 0, cards: [], marks: [] };
  }
  const opPack = (n, paid) => (x) => { const p = x.players[me]; if (!p || x.started) return false; p.pack = n; p.paid = paid; if (!n) p.ready = false; };
  const opReady = (v) => (x) => { const p = x.players[me]; if (!p || x.started || (v && !p.pack)) return false; p.ready = v; };
  function opLeave(x) { if (x.started || !x.players[me]) return false; delete x.players[me]; }
  function opStart(x) {
    if (x.started || x.creator !== me) return false;
    Object.keys(x.players).forEach((u) => { if (!x.players[u].pack) delete x.players[u]; }); // sans carton : spectateur
    if (Object.keys(x.players).length < 3) return false;
    x.started = true; x.phase = 'playing'; x.game = 1; deal(x); x.nextAt = now() + 4000;
  }
  function opDraw(x) {
    if (x.phase !== 'playing' || now() < (x.nextAt || 0) - 250) return false;
    // lot pas annoncé depuis AUTO_AFTER boules : donné automatiquement
    const elig = Object.keys(x.players).filter((u) => canClaim(x, u));
    if (elig.length) {
      if (!x.pend || x.pend.stage !== x.stage) x.pend = { stage: x.stage, since: x.drawn.length };
      else if (x.drawn.length - x.pend.since >= AUTO_AFTER) { award(x, elig[rndInt(elig.length)], true); if (x.phase !== 'playing') return; }
    }
    const set = new Set(x.drawn), left = [];
    for (let n = 1; n <= 90; n++) if (!set.has(n)) left.push(n);
    if (!left.length) return false;
    const n = left[rndInt(left.length)];
    x.drawn.push(n);
    const someone = Object.values(x.players).some((p) => hasNum(p, n));
    x.nextAt = now() + (someone ? x.settings.timeout : NOBODY_NEXT);
  }
  const opMark = (n) => (x) => {
    const p = x.players[me];
    if (!p || x.phase !== 'playing' || !x.drawn.includes(n) || p.marks.includes(n) || !hasNum(p, n)) return false;
    p.marks.push(n);
    // tout le monde a tamponné la dernière boule : on n'attend plus
    if (n === x.drawn[x.drawn.length - 1] && !waitingFor(x).length) x.nextAt = Math.min(x.nextAt || Infinity, now() + QUICK_NEXT);
  };
  /** Tamponne d'un coup plusieurs numéros sortis (tamponnage automatique). */
  const opMarkMany = (list) => (x) => {
    const p = x.players[me];
    if (!p || x.phase !== 'playing') return false;
    const add = list.filter((n) => x.drawn.includes(n) && !p.marks.includes(n) && hasNum(p, n));
    if (!add.length) return false;
    p.marks.push(...add);
    if (!waitingFor(x).length) x.nextAt = Math.min(x.nextAt || Infinity, now() + QUICK_NEXT);
  };
  function opClaim(x) { if (!canClaim(x, me)) return false; award(x, me, false); }
  function opNextGame(x) {
    if (x.phase !== 'break' || now() < (x.breakUntil || 0) - 250) return false;
    x.game++; x.phase = 'playing'; deal(x); x.nextAt = now() + 3500;
  }
  function opRestart(x) {
    if (x.phase !== 'over' || x.creator !== me) return false;
    Object.values(x.players).forEach((p) => { p.pts = 0; p.won = {}; p.ready = false; p.cards = []; p.marks = []; p.pack = 0; p.paid = 0; });
    x.started = false; x.phase = 'waiting'; x.game = 0; x.stage = 0; x.drawn = []; x.winners = []; x.gameWins = [];
    x.round = (x.round || 0) + 1; // nouvelle cagnotte
  }
  async function act(fn) {
    if (!net || !tableId) return false;
    try { return await net.transact(tableId, fn); } catch (e) { $('feed').textContent = 'Action non envoyée : vérifie ta connexion.'; return false; }
  }
  const potId = () => tableId; // le serveur lit la salle ; une nouvelle manche = nouvelle cagnotte (voir round)
  const paying = () => !!(st && st.settings.price > 0 && window.Casino && Casino.server);

  // ---------- Horloge partagée ----------
  function schedule() {
    clearTimeout(timer);
    if (!st) return;
    if (st.phase === 'playing') timer = setTimeout(() => act(opDraw), Math.max(150, (st.nextAt || now()) - now() + rndInt(200)));
    else if (st.phase === 'break') timer = setTimeout(() => act(opNextGame), Math.max(150, (st.breakUntil || now()) - now() + rndInt(200)));
  }
  setInterval(() => { // barre du temps restant avant la prochaine boule
    const bar = document.getElementById('timer-bar');
    if (!bar) return;
    if (!st || st.phase !== 'playing') { bar.style.width = '0'; return; }
    bar.style.width = Math.min(100, Math.max(0, (st.nextAt || now()) - now()) / st.settings.timeout * 100) + '%';
  }, 250);

  // ---------- Affichage ----------
  function onState(raw) {
    if (!raw) { showLobby('Cette salle n\'existe plus.'); return; }
    const prev = st;
    st = normalize(raw);
    if (!st.players[me] && !st.started) act(opJoin);
    const ball = st.drawn[st.drawn.length - 1];
    if (ball && ball !== lastBall && prev) announce(ball);
    lastBall = ball;
    if (prev && st.winners.length > lastWinCount) st.winners.slice(lastWinCount).forEach(celebrateWin);
    lastWinCount = st.winners.length;
    render(); schedule(); lobbyTick();
    if ($('auto-mark').checked) autoMark();
    if (st.phase === 'over' && !podiumShown) { podiumShown = true; settle().then(() => setTimeout(showPodium, 600)); }
    if (st.phase !== 'over') { podiumShown = false; settled = false; gains = null; $('podium').hidden = true; }
  }
  function announce(n) {
    const b = $('ball'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (window.Sfx) { if (Sfx.card) Sfx.card(); if (Sfx.say) Sfx.say(String(n)); }
    const p = st.players[me];
    if (p && hasNum(p, n)) {
      if (window.Casino) Casino.vibrate([30, 40, 30]);
      if ($('auto-mark').checked) autoMark();
    }
  }
  // tamponnage automatique : rattrape tous les numéros sortis pas encore tamponnés (et réessaie si besoin)
  function autoMark() {
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      const p = st && st.players[me];
      if (!p || st.phase !== 'playing') return;
      const todo = st.drawn.filter((n) => hasNum(p, n) && !p.marks.includes(n));
      if (todo.length) act(opMarkMany(todo));
    }, 600);
  }
  const potTotal = () => (st ? Object.values(st.players).reduce((a, p) => a + (p.paid || 0), 0) : 0);
  const shareOf = (stage) => potTotal() / st.settings.games * (LOTO.SHARES[stage] || 0);
  function celebrateWin(w) {
    const mine = w.uid === me;
    const f = document.createElement('div'); f.className = 'flash-win';
    const d = document.createElement('div'); d.textContent = (w.stage === 'cp' ? '🎉 CARTON PLEIN !' : w.stage === 'dq' ? 'DOUBLE QUINE !' : 'QUINE !');
    const sm = document.createElement('small'); sm.textContent = (mine ? 'Bravo, c\'est toi !' : w.name) + ' · +' + w.pts + ' pts' + (st.settings.price > 0 ? ' · ' + fmt(shareOf(w.stage)) + ' €' : '') + (w.auto ? ' (annoncé automatiquement)' : ''); d.appendChild(sm);
    f.appendChild(d); document.body.appendChild(f); setTimeout(() => f.remove(), 2100);
    if (window.Sfx) { if (mine) { Sfx.win(); setTimeout(() => Sfx.win(), 300); } else if (Sfx.push) Sfx.push(); if (Sfx.say) Sfx.say((w.stage === 'cp' ? 'Carton plein' : w.stage === 'dq' ? 'Double quine' : 'Quine') + ' pour ' + w.name); }
    if (mine && window.Casino) Casino.vibrate([60, 40, 120]);
  }
  function render() {
    if (!st) return;
    const meP = st.players[me], s = STAGES[st.stage], drawnSet = new Set(st.drawn), marks = marksOf(meP);
    $('code').textContent = tableId; $('code-box').hidden = false;
    // salle d'attente + packs
    if (window.Social && Social.waitingRoom) Social.waitingRoom({
      container: $('wait-host'), started: st.started, me, hostUid: st.creator, minPlayers: 3,
      players: Object.keys(st.players).map((u) => ({ uid: u, name: st.players[u].name + (st.players[u].pack ? ' · ' + st.players[u].pack + ' cartons' : ' · pas de pack'), ready: st.players[u].ready })),
      onStart: () => act(opStart), onReady: (v) => { if (v && meP && !meP.pack) { $('feed').textContent = 'Choisis d\'abord ton pack de cartons.'; return; } act(opReady(v)); },
    });
    $('wait-host').hidden = st.started;
    renderPacks();
    // annonceur
    const ball = st.drawn[st.drawn.length - 1];
    $('ball').firstElementChild.textContent = ball || '–';
    $('stage').textContent = st.phase === 'waiting' ? 'Salle d\'attente : choisissez vos cartons (3 joueurs minimum)' : st.phase === 'break' ? '⏸ Prochaine partie dans quelques secondes…' : st.phase === 'over' ? '🏁 Fin du loto !' : '🎯 En jeu : ' + s.label + (st.settings.price > 0 ? ' · ' + fmt(shareOf(s.id)) + ' €' : ' (' + s.pts + ' pts)');
    const wf = st.phase === 'playing' ? waitingFor(st).length : 0;
    $('gameno').textContent = st.started ? 'Partie ' + st.game + ' / ' + st.settings.games + ' · ' + st.drawn.length + ' boule' + (st.drawn.length > 1 ? 's' : '') + (wf ? ' · on attend ' + wf + ' joueur' + (wf > 1 ? 's' : '') + ' ✍️' : '') : '';
    const last = $('last'); last.innerHTML = '';
    st.drawn.slice(-7, -1).reverse().forEach((n) => { const b = document.createElement('span'); b.textContent = n; last.appendChild(b); });
    if (!document.getElementById('timer-bar')) { const t = document.createElement('div'); t.className = 'timer'; t.innerHTML = '<div id="timer-bar"></div>'; $('last').after(t); }
    // bouton d'annonce
    const cl = $('claim'), ok = canClaim(st, me);
    cl.hidden = !meP || !st.started || st.phase === 'over';
    cl.textContent = s ? s.btn : 'QUINE !'; cl.disabled = !ok; cl.classList.toggle('ready', ok);
    const lw = st.gameWins[st.gameWins.length - 1];
    $('feed').textContent = lw ? '🏆 ' + lw.label + ' : ' + lw.name + ' (+' + lw.pts + ' pts)' : st.started ? 'Tamponne tes numéros dès qu\'ils sortent !' : '';
    // à tamponner
    const tip = $('call-tip');
    if (meP && st.phase === 'playing' && meP.cards.length) {
      const todo = st.drawn.filter((n) => hasNum(meP, n) && !marks.has(n));
      tip.hidden = false;
      tip.className = 'call-tip' + (todo.length ? '' : ' ok');
      tip.textContent = todo.length ? '👆 À tamponner : ' + todo.slice(-6).join(', ') + (todo.length > 6 ? '…' : '') : ball && hasNum(meP, ball) ? '✅ Le ' + ball + ' est tamponné' : ball ? 'Pas de ' + ball + ' sur tes cartons' : '🎱 Les boules vont sortir…';
    } else tip.hidden = true;
    // mes cartons (les plus avancés d'abord)
    const box = $('cards'); box.innerHTML = '';
    if (!meP) box.innerHTML = '<p class="muted">' + (st.started ? '👀 Tu regardes la partie (elle a commencé avant ton arrivée).' : 'Installation…') + '</p>';
    else if (!meP.cards.length) box.innerHTML = '<p class="muted">Tes cartons seront distribués au lancement de la partie.</p>';
    else meP.cards.map((g, i) => ({ g, i, done: g.flat().filter((n) => n && marks.has(n)).length })).sort((a, b) => b.done - a.done)
      .forEach(({ g, i }) => box.appendChild(cardEl(g, i, marks, drawnSet, meP.color, meP.cards.length > 8)));
    const bl = meP && meP.cards.length ? bestLines(meP, marks) : 0;
    $('mine-info').textContent = meP && meP.cards.length ? '· ' + meP.cards.length + ' cartons · meilleur : ' + bl + ' ligne' + (bl > 1 ? 's' : '') : '';
    // joueurs
    $('pot').textContent = st.settings.price > 0 ? '· cagnotte ' + fmt(potTotal()) + ' €' : '· pour le fun';
    const ol = $('players'); ol.innerHTML = '';
    const wait = new Set(st.phase === 'playing' ? waitingFor(st) : []);
    Object.keys(st.players).sort((a, b) => (st.players[b].pts || 0) - (st.players[a].pts || 0)).forEach((u) => {
      const p = st.players[u], li = document.createElement('li');
      const d = document.createElement('span'); d.className = 'dot'; d.style.background = p.color;
      const n = document.createElement('span'); n.textContent = (u === st.creator ? '👑 ' : '') + p.name + (u === me ? ' (toi)' : '') + (wait.has(u) ? ' ✍️' : '');
      const w = p.won || {}, sm = document.createElement('small'); sm.textContent = [p.pack ? p.pack + ' 🎫' : '', w.q1 || w.q2 ? '🎯×' + ((w.q1 || 0) + (w.q2 || 0)) : '', w.dq ? '✌️×' + w.dq : '', w.cp ? '🎉×' + w.cp : ''].filter(Boolean).join(' ');
      const pts = document.createElement('b'); pts.textContent = (p.pts || 0) + ' pts';
      li.append(d, n, sm, pts); ol.appendChild(li);
    });
    // tableau des 90
    const bd = $('board');
    if (!bd.children.length) for (let n = 1; n <= 90; n++) { const sp = document.createElement('span'); sp.textContent = n; bd.appendChild(sp); }
    Array.from(bd.children).forEach((sp, i) => { sp.classList.toggle('on', drawnSet.has(i + 1)); sp.classList.toggle('just', i + 1 === ball); });
  }
  function renderPacks() {
    const box = $('packs'), meP = st.players[me];
    box.hidden = st.started || !meP;
    if (box.hidden) return;
    const price = st.settings.price, style = st.settings.style, list = LOTO.PACKS[style] || [6, 12, 18, 24];
    box.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = '🎫 Choisis ton pack de cartons' + (price > 0 ? ' (' + fmt(price) + ' € le carton)' : ' (gratuit)');
    const p = document.createElement('p'); p.className = 'muted small';
    p.textContent = (style === 'serie' ? 'Cartons en séries : dans chaque série de 6, les 90 numéros sont tous présents une seule fois.' : 'Cartons classiques : 15 numéros au hasard par carton (un numéro peut être sur plusieurs cartons).') + (price > 0 ? ' Plus tu prends de cartons, plus tu as de chances… et moins le carton coûte cher.' : '');
    const row = document.createElement('div'); row.className = 'pack-row';
    list.forEach((n) => {
      const cost = packCost(price, n), b = document.createElement('button'); b.type = 'button'; b.className = 'pack' + (meP.pack === n ? ' on' : '');
      const disc = price > 0 ? Math.round((1 - cost / (price * n)) * 100) : 0;
      b.innerHTML = '<b>' + n + '</b><small>cartons</small><span>' + (price > 0 ? fmt(cost) + ' €' : 'gratuit') + '</span><small>' + (disc > 0 ? '−' + disc + ' %' : '&nbsp;') + '</small>';
      b.onclick = () => choosePack(n);
      row.appendChild(b);
    });
    box.append(h, p, row);
    if (meP.pack) { const ok = document.createElement('p'); ok.className = 'small'; ok.textContent = '✅ Pack de ' + meP.pack + ' cartons' + (price > 0 ? ' payé (' + fmt(meP.paid) + ' €). Tu peux en changer avant le lancement.' : '.') + (meP.ready || st.creator === me ? '' : ' Clique maintenant sur « Je suis prêt ».'); box.appendChild(ok); }
  }
  async function choosePack(n) {
    if (!st || st.started) return;
    const price = st.settings.price, cost = packCost(price, n), meP = st.players[me];
    if (!meP || meP.pack === n) return;
    if (price > 0) {
      if (!paying()) { $('feed').textContent = 'Les cartons payants demandent le serveur du Casino.'; return; }
      const diff = Math.round((cost - (meP.paid || 0)) * 100) / 100;
      const ok = await Casino.confirm({ icon: '🎫', title: 'Prendre ' + n + ' cartons ?', text: 'Ton argent va dans la cagnotte de la salle, partagée entre les gagnants à la fin (sans frais). Si le loto n\'a pas lieu, tu es remboursé.', price: diff, ok: diff >= 0 ? 'Payer ' + fmt(diff) + ' €' : 'Récupérer ' + fmt(-diff) + ' €' });
      if (!ok) return;
      const r = await Casino.deal('loto.buy', { table: potId(), pack: n });
      if (r.error) { Casino.toast('Loto', r.error, '⚠️'); return; }
      await act(opPack(n, r.paid));
    } else await act(opPack(n, 0));
    if (window.Sfx) Sfx.chips();
  }
  function cardEl(g, ci, marks, drawnSet, color, many) {
    const el = document.createElement('div'); el.className = 'carton' + (many ? ' many' : ''); el.style.setProperty('--cc', color);
    const lines = linesDone(g, marks);
    if (lines) el.classList.add('win');
    const h = document.createElement('div'); h.className = 'ct-head';
    const filled = g.flat().filter((n) => n && marks.has(n)).length;
    h.innerHTML = '<span>CARTON ' + (ci + 1) + '</span><span>' + filled + ' / 15 · ' + lines + ' ligne' + (lines > 1 ? 's' : '') + '</span>';
    const grid = document.createElement('div'); grid.className = 'ct-grid';
    g.forEach((row) => {
      const done = row.every((x) => !x || marks.has(x));
      row.forEach((n) => {
        const c = document.createElement('div');
        if (!n) { c.className = 'c e'; grid.appendChild(c); return; }
        const marked = marks.has(n), call = !marked && drawnSet.has(n);
        c.className = 'c n' + (marked ? ' m' : '') + (call ? ' call' : '');
        if (done) c.style.background = '#bbf7d0';
        const b = document.createElement('b'); b.textContent = n; c.appendChild(b);
        c.onclick = () => {
          if (marked) return;
          if (!drawnSet.has(n)) { c.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 220); $('feed').textContent = 'Le ' + n + ' n\'est pas encore sorti !'; return; }
          c.classList.add('m'); c.classList.remove('call'); if (window.Sfx && Sfx.chips) Sfx.chips();
          act(opMark(n));
        };
        grid.appendChild(c);
      });
    });
    el.append(h, grid);
    return el;
  }
  async function settle() {
    if (settled || !st || !(st.settings.price > 0) || !window.Casino || !Casino.server) return;
    settled = true;
    const r = await Casino.deal('loto.settle', { table: potId() });
    if (r && r.gains) gains = r.gains;
    Casino.deal('deals.list').catch(() => {}); // affiche le message du gain
  }
  function showPodium() {
    if (!st || st.phase !== 'over') return;
    const pod = $('podium'); pod.innerHTML = '';
    const box = document.createElement('div'); box.className = 'box';
    const h = document.createElement('h2'); h.textContent = '🏆 Classement final';
    const ol = document.createElement('ol');
    const ranks = Object.keys(st.players).sort((a, b) => (st.players[b].pts || 0) - (st.players[a].pts || 0) || ((st.players[b].won || {}).cp || 0) - ((st.players[a].won || {}).cp || 0));
    const pot = potTotal(), won = {};
    st.winners.forEach((w) => { won[w.uid] = (won[w.uid] || 0) + shareOf(w.stage); });
    ranks.forEach((u, i) => {
      const li = document.createElement('li'); li.textContent = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
      const n = document.createElement('span'); n.textContent = st.players[u].name + (u === me ? ' (toi)' : '');
      const b = document.createElement('b'); b.textContent = (st.players[u].pts || 0) + ' pts' + (pot > 0 ? ' · ' + fmt((gains && gains[u] !== undefined ? gains[u] : won[u]) || 0) + ' €' : '');
      li.append(n, b); ol.appendChild(li);
    });
    const p = document.createElement('p'); p.className = 'muted small';
    p.textContent = st.settings.games + ' partie' + (st.settings.games > 1 ? 's' : '') + (pot > 0 ? ' · cagnotte de ' + fmt(pot) + ' € partagée (quines 15 % + 15 %, double quine 25 %, carton plein 45 %), sans frais' : ' · quine 3 et 2 pts, double quine 5 pts, carton plein 10 pts');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = st.creator === me ? '🔁 Rejouer avec les mêmes' : 'Fermer';
    close.onclick = () => { pod.hidden = true; if (st.creator === me) act(opRestart); };
    box.append(h, ol, p, close); pod.appendChild(box); pod.hidden = false;
    if (ranks[0] === me && window.Casino) { Casino.vibrate([80, 50, 160]); if (window.Sfx) Sfx.win(); }
    if (window.Casino && st.players[me] && !Casino.server) Casino.track('multi', { game: 'loto' });
  }

  // ---------- Liste des salles (onglet Multijoueur) ----------
  let lobbyLast = null;
  function lobbyTick() {
    if (!st || !tableId || !window.Social || !Social.lobbyBeat) return;
    if (st.creator !== me || st.phase === 'over') { if (lobbyLast) { Social.lobbyRemove('loto', tableId, lobbyLast); lobbyLast = null; } return; }
    lobbyLast = { name: (st.name + (st.settings.price > 0 ? ' · ' + st.settings.price + ' €/carton' : '')).slice(0, 30), host: myName(), players: Object.keys(st.players).length, max: 12, pub: st.settings.public !== false, lk: st.settings.lk, live: st.started };
    Social.lobbyBeat('loto', tableId, lobbyLast);
  }
  setInterval(lobbyTick, 30000);

  // ---------- Entrée / sortie ----------
  function cleanup() { unsub.forEach((u) => { try { u(); } catch (e) { /* ignore */ } }); unsub = []; clearTimeout(timer); if (stopPresence) { stopPresence(); stopPresence = null; } }
  function setUrl(code) { try { const u = new URL(location.href); if (code) u.searchParams.set('table', code); else u.searchParams.delete('table'); u.searchParams.delete('multi'); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ } }
  function showLobby(note) { cleanup(); st = null; tableId = null; $('room').hidden = true; $('lobby').hidden = false; $('code-box').hidden = true; $('note').textContent = note || ''; setUrl(null); }
  async function openTable(id) {
    cleanup();
    tableId = id; st = null; lastBall = null; lastWinCount = 0; podiumShown = false; settled = false; gains = null;
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
  async function leave() {
    if (st && !st.started && st.players[me]) {
      if (st.players[me].paid > 0 && paying()) { const r = await Casino.deal('loto.refund', { table: potId() }); if (r && r.refunded) Casino.toast('Loto', 'Tes ' + fmt(r.refunded) + ' € te sont rendus.', '↩️'); }
      await act(opLeave);
    }
    if (lobbyLast && window.Social) Social.lobbyRemove('loto', tableId, lobbyLast);
    lobbyLast = null; showLobby(); location.href = '../index.html#multi';
  }
  $('create').addEventListener('click', async () => {
    if (!net) return;
    $('create').disabled = true;
    const price = +$('f-price').value;
    if (price > 0 && !(window.Casino && Casino.server)) { $('note').textContent = 'Les cartons payants demandent le serveur du Casino : choisis « Gratuit ».'; $('create').disabled = false; return; }
    const settings = { games: +$('f-games').value, style: $('f-style').value, price, timeout: +$('f-timeout').value, public: $('f-public').checked, lk: Math.random().toString(36).slice(2, 10) };
    try { const id = await net.createTable(initial($('f-name').value.trim().slice(0, 30) || 'Loto de ' + myName(), settings)); await openTable(id); }
    catch (e) { $('note').textContent = 'Impossible de créer la salle : vérifie ta connexion (et que les règles Firebase sont à jour).'; }
    $('create').disabled = false;
  });
  $('join').addEventListener('submit', (e) => { e.preventDefault(); const c = $('join-code').value.trim().toUpperCase(); if (c.length >= 4) openTable(c); });
  $('claim').addEventListener('click', async () => { $('claim').disabled = true; const ok = await act(opClaim); if (!ok) $('feed').textContent = 'Trop tard : quelqu\'un a annoncé avant toi !'; });
  $('auto-mark').addEventListener('change', () => {
    if ($('auto-mark').checked) autoMark();
  });
  $('leave').addEventListener('click', leave);
  $('invite').addEventListener('click', () => { if (window.Social && Social.inviteDialog) Social.inviteDialog('loto', tableId); });
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault(); const t = $('chat-input').value.trim(); $('chat-input').value = '';
    if (t && net && tableId) net.sendChat(tableId, { uid: me, name: myName(), text: t.slice(0, 300), ts: now() }).catch(() => {});
  });

  (async function start() {
    $('f-name').placeholder = 'Loto de ' + myName();
    if (!(window.Casino && Casino.server)) { Array.from($('f-price').options).forEach((o) => { if (o.value !== '0') o.disabled = true; }); $('f-price').value = '0'; }
    net = await window.createNet({ ns: 'l', normalize });
    if (!net || net.error) { $('note').textContent = 'Le multijoueur a besoin d\'une connexion (Firebase).'; $('create').disabled = true; return; }
    me = net.me;
    if (window.Social && Social.reactionBar) Social.reactionBar($('chat-form').parentNode, (emoji) => { if (net && tableId) net.sendChat(tableId, { uid: me, name: myName(), text: emoji, ts: now(), reaction: true }).catch(() => {}); });
    const code = new URLSearchParams(location.search).get('table');
    if (code) openTable(code.toUpperCase());
  })();
  window.LotoMulti = { get state() { return st; }, genCard, genSerie, linesDone, act };
})();
