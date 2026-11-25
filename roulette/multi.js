/*
 * Roulette « Entre amis » : une table avec un code, la même roue pour tous.
 * Chacun mise de son côté ; le compte à rebours démarre à la première mise de la table,
 * la bille part quand le temps est écoulé ou quand tout le monde a cliqué « Prêt ».
 * Les changements de phase (lancer, résultat, tour suivant) sont faits par le premier appareil
 * qui constate l'heure prévue, dans une transaction : pas besoin d'hôte.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const B = RouletteBets, UI = RouletteUI;
  const COLORS = ['#f2c14e', '#4fc3f7', '#ef5350', '#66bb6a', '#ab47bc', '#ff7043', '#26c6da', '#d4e157'];
  const now = () => Date.now();

  let net = null, me = null, tableId = null, st = null;
  let unsub = [], stopPresence = null, timers = [];
  let myLog = [], lastBets = {};
  let T = UI.createStats();             // mes statistiques (aides)
  let animatedSpin = null, recordedSpin = null, shownOver = null, saidBets = null;

  function myName() { try { return (localStorage.getItem('bj-pseudo') || (window.Casino && Casino.profile.pseudo) || '').trim().slice(0, 16); } catch (e) { return ''; } }
  function coachKey() { return 'rl-coach-' + tableId + '-' + me; }
  function coachChoice() { try { const v = localStorage.getItem(coachKey()); return v === null ? null : v === '1'; } catch (e) { return null; } }
  const coachOn = () => !!(st && st.settings.coach && coachChoice() !== false);

  function normalize(x) {
    x.players = x.players || {};
    x.bets = x.bets || {};
    x.history = x.history || [];
    x.settings = Object.assign({ bank: 1000, betTime: 25, rounds: 20, coach: true }, x.settings || {});
    x.phase = x.phase || 'waiting';
    x.round = x.round || 0;
    return x;
  }
  function initial(name, settings) {
    return { name, creator: me, settings, phase: 'waiting', round: 0, history: [], players: {}, bets: {}, createdAt: now(), updatedAt: now() };
  }
  const total = (bets) => Object.values(bets || {}).reduce((a, b) => a + b, 0);
  const canBet = (x) => x.phase === 'waiting' || x.phase === 'betting';
  const activePlayers = (x) => Object.keys(x.players).filter((u) => !x.players[u].out);

  // ---------- Opérations (transactions) ----------
  function opJoin(x) {
    if (x.players[me]) { if (myName()) x.players[me].name = myName(); return; }
    if (x.phase === 'over') return false;
    x.players[me] = { name: myName() || 'Joueur', bankroll: x.settings.bank, color: COLORS[Object.keys(x.players).length % COLORS.length], wagered: 0, biggestWin: 0, ready: false };
  }
  function opBet(key, amount) {
    return (x) => {
      const p = x.players[me];
      if (!p || p.out || !canBet(x) || p.bankroll < amount) return false;
      if (B.room(key, x.bets[me] && x.bets[me][key]) < amount) return false; // limite de table
      x.bets[me] = x.bets[me] || {};
      x.bets[me][key] = (x.bets[me][key] || 0) + amount;
      p.bankroll -= amount;
      if (x.phase === 'waiting') { x.phase = 'betting'; x.deadline = now() + x.settings.betTime * 1000; }
    };
  }
  function opRemove(key, amount) {
    return (x) => {
      const mine = x.bets[me];
      if (!mine || !mine[key] || !canBet(x)) return false;
      const a = Math.min(amount || mine[key], mine[key]);
      mine[key] -= a; x.players[me].bankroll += a;
      if (!mine[key]) delete mine[key];
    };
  }
  function opClear(x) {
    const mine = x.bets[me];
    if (!mine || !canBet(x)) return false;
    x.players[me].bankroll += total(mine);
    delete x.bets[me];
  }
  function opReady(x) {
    const p = x.players[me];
    if (!p || x.phase !== 'betting') return false;
    p.ready = true;
    if (activePlayers(x).every((u) => x.players[u].ready)) startSpin(x);
  }
  function startSpin(x) {
    const arr = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    x.phase = 'spinning';
    x.spin = { result: arr[0] % 37, at: now() + 900, dur: UI.SPIN_MS };
    x.deadline = null;
    Object.values(x.players).forEach((p) => { p.ready = false; });
  }
  function opTimeout(x) {
    if (x.phase !== 'betting' || !x.deadline || now() < x.deadline - 300) return false;
    startSpin(x);
  }
  function opResolve(x) {
    if (x.phase !== 'spinning' || !x.spin || now() < x.spin.at + x.spin.dur - 300) return false;
    const n = x.spin.result;
    x.lastWins = {};
    Object.keys(x.bets).forEach((u) => {
      const p = x.players[u];
      if (!p) return;
      const staked = total(x.bets[u]);
      let back = 0;
      Object.keys(x.bets[u]).forEach((k) => { back += B.payout(k, x.bets[u][k], n); });
      p.bankroll += back;
      p.wagered = (p.wagered || 0) + staked;
      if (back - staked > (p.biggestWin || 0)) p.biggestWin = back - staked;
      x.lastWins[u] = back - staked;
    });
    x.history.unshift(n);
    if (x.history.length > 30) x.history.length = 30;
    x.round++;
    x.phase = 'result';
    x.resultUntil = now() + UI.RESULT_MS;
  }
  function opNext(x) {
    if (x.phase !== 'result' || now() < (x.resultUntil || 0) - 300) return false;
    x.bets = {};
    x.phase = 'waiting';
    x.deadline = null;
    Object.keys(x.players).forEach((u) => { if (x.players[u].bankroll < 1) x.players[u].out = true; });
    const alive = activePlayers(x);
    if ((x.settings.rounds && x.round >= x.settings.rounds) || (Object.keys(x.players).length && !alive.length)) {
      x.phase = 'over';
      x.over = { at: now() };
    }
  }
  // Encaisser : le joueur quitte le jeu avec son solde (mises non jouées rendues), il reste au classement
  function opCashOut(x) {
    const p = x.players[me];
    if (!p || p.out || x.phase === 'spinning' || x.phase === 'over') return false;
    if (canBet(x) && x.bets[me]) { p.bankroll += total(x.bets[me]); delete x.bets[me]; }
    p.out = true; p.cashedOut = true; p.ready = false;
    if (!activePlayers(x).length) { x.phase = 'over'; x.over = { at: now() }; }
    else if (x.phase === 'betting' && activePlayers(x).every((u) => x.players[u].ready)) startSpin(x);
  }

  function opRestart(x) {
    if (x.phase !== 'over') return false;
    Object.values(x.players).forEach((p) => { p.bankroll = x.settings.bank; p.out = false; p.cashedOut = false; p.wagered = 0; p.biggestWin = 0; p.ready = false; });
    x.phase = 'waiting'; x.round = 0; x.history = []; x.bets = {}; x.over = null; x.spin = null;
  }

  async function act(fn) {
    if (!net || !tableId) return false;
    try { return await net.transact(tableId, fn); } catch (e) { $('sub-message').textContent = 'Action non envoyée. Vérifie ta connexion.'; return false; }
  }

  // ---------- Minuteurs : le premier appareil qui constate l'heure fait l'action ----------
  function schedule() {
    timers.forEach(clearTimeout);
    timers = [];
    if (!st) return;
    const at = (when, fn) => timers.push(setTimeout(() => act(fn), Math.max(0, when - now()) + 150 + Math.random() * 600));
    if (st.phase === 'betting' && st.deadline) at(st.deadline, opTimeout);
    if (st.phase === 'spinning' && st.spin) at(st.spin.at + st.spin.dur, opResolve);
    if (st.phase === 'result') at(st.resultUntil, opNext);
  }

  // ---------- Réception et affichage ----------
  function onState(raw) {
    setTimeout(befriend, 0);
    if (!raw) { showLobby('Cette table n\'existe pas ou a été fermée.'); return; }
    const prev = st;
    st = normalize(JSON.parse(JSON.stringify(raw)));
    if (!st.players[me] && st.phase !== 'over') act(opJoin);
    if (st.settings.coach && coachChoice() === null && !$('coach-dialog').open) {
      try { $('coach-dialog').showModal(); } catch (e) { $('coach-dialog').setAttribute('open', ''); }
    }
    const w = UI.ensureWheel();
    // Faites vos jeux (une fois par tour)
    if (st.phase === 'waiting' && saidBets !== st.round && prev && window.Sfx) { saidBets = st.round; Sfx.say('Faites vos jeux'); }
    // Lancer de la bille synchronisé sur l'heure prévue
    if (st.phase === 'spinning' && st.spin && animatedSpin !== st.spin.at) {
      animatedSpin = st.spin.at;
      const myBets = (st.bets && st.bets[me]) || {};
      UI.analyseBets(T, myBets, (st.players[me] ? st.players[me].bankroll : 0) + total(myBets), T.history);
      const go = () => {
        const elapsed = Math.max(0, now() - st.spin.at);
        if (elapsed < 1500) UI.rienNeVaPlus();
        w.spin(st.spin.result, { duration: st.spin.dur, elapsed });
      };
      const wait = st.spin.at - now();
      if (wait > 0) setTimeout(go, wait); else go();
    }
    if (st.phase === 'result' && st.history.length) {
      const n = st.history[0];
      if (animatedSpin === null) { animatedSpin = st.spin && st.spin.at; w.place(n); }
      if (recordedSpin !== st.round) {
        recordedSpin = st.round;
        const myBets = (st.bets && st.bets[me]) || {};
        const r = UI.recordSpin(T, myBets, n);
        if (st.players[me]) T.peak = Math.max(T.peak || 0, st.players[me].bankroll);
        if (prev && r.staked) {
          UI.trackSpin(myBets, n, r);
          if (window.Casino && !window.__multiTracked) { window.__multiTracked = true; Casino.track('multi', { game: 'roulette' }); }
        }
        if (prev) UI.announceResult(n);
        if (r.staked && prev) setTimeout(() => UI.showOutcome(r.net, r.staked), 700);
        if (r.staked) {
          if (window.Sfx) setTimeout(() => { if (r.net > 0) Sfx.win(); else if (r.net < 0) Sfx.lose(); }, 900);
          if (coachOn()) UI.coachRound([(r.net >= 0 ? '✔ ' : '✘ ') + 'Tour ' + st.round + ' : ' + B.describe(n), 'Tu as misé ' + UI.fmt(r.staked) + ' € et récupéré ' + UI.fmt(r.back) + ' €.', 'L\'avantage du casino sur ces mises : environ ' + UI.fmt(Math.round(r.expected * 100) / 100) + ' € par tour en moyenne.'], r.net > 0 ? 'good' : r.net < 0 ? 'bad' : 'hint');
        }
        UI.renderStats(T);
      }
    }
    if (st.phase === 'waiting') { w.clear(); if (prev && prev.phase === 'result' && prev.bets[me]) lastBets = prev.bets[me]; myLog = []; }
    render();
    schedule();
  }

  function view() {
    const x = st;
    const p = x.players[me];
    let announce = 'Faites vos jeux', sub = '';
    if (x.phase === 'waiting') sub = 'Le compte à rebours démarre à la première mise de la table.';
    if (x.phase === 'betting') sub = p && p.ready ? 'Tu es prêt : en attente des autres joueurs…' : 'Mise puis clique « Prêt » : la bille part quand tout le monde est prêt.';
    if (x.phase === 'spinning') { announce = 'Rien ne va plus'; sub = 'La bille tourne…'; }
    if (x.phase === 'result') {
      announce = B.describe(x.history[0]);
      const mine = x.lastWins ? x.lastWins[me] : undefined;
      sub = mine === undefined ? '' : mine > 0 ? 'Tu gagnes ' + UI.fmt(mine) + ' € !' : mine < 0 ? 'Tu perds ' + UI.fmt(-mine) + ' €.' : 'Mise récupérée.';
    }
    if (x.phase === 'over') { announce = 'Partie terminée'; sub = ''; }
    if (p && p.out) sub = p.cashedOut ? 'Tu as encaissé ' + UI.fmt(p.bankroll) + ' € : tu regardes la fin de la partie.' : 'Ton solde est épuisé : tu regardes la fin de la partie.';
    const others = [];
    Object.keys(x.bets).forEach((u) => {
      if (u === me || !x.players[u]) return;
      Object.keys(x.bets[u]).forEach((k) => others.push({ key: k, amount: x.bets[u][k], color: x.players[u].color, name: x.players[u].name }));
    });
    return {
      phase: x.phase, deadline: x.deadline, betTime: x.settings.betTime, bets: x.bets[me] || {}, others,
      bankroll: p ? p.bankroll : null, history: x.history,
      result: x.phase === 'result' ? x.history[0] : null, announce, sub,
      canBet: !!p && !p.out && canBet(x),
      players: Object.keys(x.players).map((u) => Object.assign({ me: u === me }, x.players[u])),
      readyLabel: p && p.ready ? 'Prêt ✔' : 'Prêt', readyDisabled: !p || p.out || x.phase !== 'betting' || p.ready,
      endDisabled: !p || p.out || x.phase === 'over',
    };
  }

  // ---------- Liste des parties ouvertes (onglet Multijoueur de l'accueil) ----------
  // Signal envoyé par l'hôte à chaque changement ET toutes les 30 s, même si la table attend sans bouger.
  // Les tables créées avant cette option sont considérées comme publiques.
  let lobbyLastInfo = null;
  function lobbyTick() {
    if (!st || !tableId || !window.Social || !Social.lobbyBeat) return;
    if (!(st.creator === me && st.phase !== 'over')) { if (lobbyLastInfo) { Social.lobbyRemove('roulette', tableId, lobbyLastInfo); lobbyLastInfo = null; } return; }
    const sets = st.settings || {};
    lobbyLastInfo = { name: st.name, host: myName(), players: Object.keys(st.players || {}).length, max: 8, pub: sets.public !== false, lk: sets.lk };
    Social.lobbyBeat('roulette', tableId, lobbyLastInfo);
  }
  setInterval(lobbyTick, 30000);

  function render() {
    if (!st || !tableId) return;
    lobbyTick();
    document.body.classList.toggle('no-coach', !coachOn());
    $('opt-info').checked = coachOn();
    $('aides-row').hidden = !st.settings.coach; // l'hôte a interdit les aides : pas d'interrupteur
    $('rm-table-name').textContent = st.name || 'Table';
    $('rm-table-code').textContent = tableId;
    $('rm-round').textContent = 'Tour ' + Math.min(st.round + (st.phase === 'result' || st.phase === 'over' ? 0 : 1), st.settings.rounds || Infinity) + (st.settings.rounds ? ' / ' + st.settings.rounds : '');
    UI.render(view());
    if (st.phase === 'over' && st.over && shownOver !== st.over.at) {
      shownOver = st.over.at;
      const ranking = Object.keys(st.players).map((u) => Object.assign({ me: u === me }, st.players[u], { name: st.players[u].name + (st.players[u].cashedOut ? ' 💰' : '') })).sort((a, b) => b.bankroll - a.bankroll);
      const won = ranking[0] && ranking[0].me;
      const myRank = ranking.findIndex((r) => r.me) + 1;
      const prize = myRank && window.Casino ? Casino.prizeFor(myRank, ranking.length) : 0;
      if (myRank && window.Casino) Casino.multiPrize('rl:' + tableId + ':' + st.over.at, myRank, ranking.length, { game: 'roulette', table: tableId });
      const counts = {};
      st.history.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
      const hot = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      setTimeout(() => UI.showRecap({
        won, title: won ? 'Tu gagnes la partie !' : (ranking[0] ? ranking[0].name + ' gagne la partie !' : 'Partie terminée'),
        subtitle: (myRank ? 'Tu termines ' + (myRank === 1 ? '1er' : myRank + 'e') + ' avec ' + UI.fmt(ranking[myRank - 1].bankroll) + ' €' : '') + (prize ? ' · +' + prize + ' € sur ta banque du Casino' : ''),
        stats: [['Tours', st.round], ['Joueurs', ranking.length], ['Numéro le plus sorti', hot !== undefined ? hot + ' (' + counts[hot] + '×)' : '–'],
          ['Plus gros gain', UI.fmt(Math.max(0, ...ranking.map((r) => r.biggestWin || 0))) + ' €'], ['Total misé', UI.fmt(ranking.reduce((a, r) => a + (r.wagered || 0), 0)) + ' €'], ['Zéros', st.history.filter((n) => n === 0).length]],
        ranking, againLabel: 'Rejouer', onAgain: () => act(opRestart),
      }), 800);
    }
  }

  // ---------- Actions du joueur ----------
  const handlers = {
    bet(key) {
      const amt = UI.chip;
      if (!st || !st.players[me] || st.players[me].bankroll < amt) { $('sub-message').textContent = 'Solde insuffisant pour ce jeton.'; return; }
      if (B.room(key, st.bets[me] && st.bets[me][key]) < amt) { $('sub-message').textContent = UI.limitText(key); return; }
      if (window.Sfx) Sfx.chips();
      myLog.push({ key, amount: amt });
      if (coachOn()) UI.coachInfo(key);
      act(opBet(key, amt));
    },
    remove(key) { act(opRemove(key)); },
    undo() { const l = myLog.pop(); if (l) act(opRemove(l.key, l.amount)); },
    clear() { myLog = []; act(opClear); },
    rebet() {
      const keys = Object.keys(lastBets);
      if (!keys.length) return;
      if (window.Sfx) Sfx.chips();
      act((x) => {
        const p = x.players[me];
        const need = total(lastBets);
        if (!p || !canBet(x) || p.bankroll < need) return false;
        keys.forEach((k) => opBet(k, lastBets[k])(x));
      });
    },
    double() {
      if (window.Sfx) Sfx.chips();
      act((x) => {
        const mine = Object.assign({}, x.bets[me] || {});
        const p = x.players[me];
        if (!p || !canBet(x) || !total(mine) || p.bankroll < total(mine)) return false;
        Object.keys(mine).forEach((k) => opBet(k, mine[k])(x));
      });
    },
    ready() { act(opReady); },
    setAides(on) { setCoach(on); },
    end() {
      if (!st || !st.players[me]) return;
      if (st.phase === 'spinning') { $('sub-message').textContent = 'La bille tourne : tu pourras encaisser juste après ce tour.'; return; }
      act(opCashOut).then((ok) => {
        if (!ok || !st) return;
        const p = st.players[me];
        const diff = p.bankroll - st.settings.bank;
        T.peak = Math.max(T.peak || 0, p.bankroll);
        UI.showRecap({
          won: diff > 0, icon: diff > 0 ? '💰' : '🎡',
          title: 'Tu encaisses ' + UI.fmt(p.bankroll) + ' €',
          subtitle: diff > 0 ? 'Tu repars avec ' + UI.fmt(diff) + ' € de plus qu\'au départ !' : diff < 0 ? 'Tu repars avec ' + UI.fmt(-diff) + ' € de moins qu\'au départ.' : 'Tu repars avec ton solde de départ.',
          stats: UI.bilanStats(T, st.settings.bank, p.bankroll),
          ranking: [{ name: 'Toi', me: true, bankroll: p.bankroll, biggestWin: p.biggestWin, wagered: p.wagered }],
          rankTitle: 'Ton bilan', againLabel: 'Quitter la table', closeLabel: 'Regarder la fin',
          onAgain: () => showLobby(),
        });
      });
    },
  };

  // ---------- Accueil ----------
  function cleanup() { unsub.forEach((u) => { try { u(); } catch (e) { /* ignore */ } }); unsub = []; timers.forEach(clearTimeout); }
  async function leaveTable(id) {
    const stop = stopPresence; stopPresence = null;
    if (!id || !stop) return;
    // les mises d'un joueur qui part pendant les mises lui sont rendues
    try { await net.transact(id, (x) => (canBet(x) && x.bets && x.bets[me] ? opClear(x) : false)); } catch (e) { /* ignore */ }
    await stop();
    try { if ((await net.activeCount(id)) === 0) await net.deleteTable(id); } catch (e) { /* ignore */ }
  }
  function showLobby(note) {
    if (tableId) leaveTable(tableId);
    cleanup();
    tableId = null; st = null;
    $('rm-head').hidden = true; $('game').hidden = true; $('chat-panel').hidden = true; $('rm-lobby').hidden = false;
    $('rm-note').textContent = note || '';
    document.body.classList.remove('no-coach');
    setUrl(null);
  }
  function setUrl(code) {
    try { const u = new URL(location.href); if (code) u.searchParams.set('table', code); else u.searchParams.delete('table'); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ }
  }
  async function openTable(id, justCreated) {
    cleanup();
    if (!justCreated) {
      $('rm-note').textContent = 'Recherche de la table…';
      let n = 1;
      try { n = await net.activeCount(id); } catch (e) { n = 1; }
      if (n === 0) { try { await net.deleteTable(id); } catch (e) { /* ignore */ } $('rm-note').textContent = 'Cette table est fermée : tout le monde l\'a quittée.'; return; }
    }
    if (window.Social && Social.tableReady) Social.tableReady('roulette', id);
    tableId = id; st = null; myLog = []; lastBets = {}; T = UI.createStats(); animatedSpin = null; recordedSpin = null; saidBets = null;
    $('rm-note').textContent = '';
    $('rm-lobby').hidden = true; $('rm-head').hidden = false; $('game').hidden = false; $('mode-badge').hidden = true; $('chat-panel').hidden = false;
    UI.setHandlers(handlers);
    UI.renderStats(T);
    setUrl(id);
    stopPresence = net.presenceStart(id);
    unsub.push(net.watchTable(id, onState, () => { $('sub-message').textContent = 'Connexion perdue.'; }));
    unsub.push(net.watchChat(id, renderChat));
  }
  function renderChat(list) {
    const log = $('chat');
    log.innerHTML = '';
    list.forEach((m) => { if (window.Social && Social.isReaction(m)) Social.floatReaction(m); });
    list.forEach((m) => {
      const el = document.createElement('div'); el.className = 'msg' + (m.uid === me ? ' me' : '');
      const b = document.createElement('b'); b.textContent = (m.uid === me ? 'Toi' : m.name || 'Joueur') + ' ';
      el.append(b, String(m.text || '')); log.appendChild(el);
    });
    log.scrollTop = log.scrollHeight;
  }
  function needPseudo() {
    if (myName()) return false;
    $('rm-pseudo').focus(); $('rm-note').textContent = 'Choisis d\'abord un pseudo.';
    return true;
  }

  $('rm-pseudo').addEventListener('change', (e) => { try { localStorage.setItem('bj-pseudo', e.target.value.trim().slice(0, 16)); } catch (err) { /* ignore */ } $('rm-note').textContent = ''; });
  $('rm-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('rm-join').addEventListener('submit', (e) => {
    e.preventDefault();
    if (needPseudo()) return;
    const code = $('rm-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { $('rm-note').textContent = 'Le code fait 4 caractères.'; return; }
    openTable(code);
  });
  $('rm-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (needPseudo()) return;
    const settings = { bank: +$('rm-bank').value, betTime: +$('rm-bettime').value, rounds: +$('rm-rounds').value, coach: $('rm-coach').checked, public: $('rm-public').checked, lk: Math.random().toString(36).slice(2, 10) };
    try {
      const id = await net.createTable(initial($('rm-name').value.trim().slice(0, 30) || 'Roulette de ' + myName(), settings));
      $('rm-name').value = '';
      openTable(id, true);
    } catch (err) { $('rm-note').textContent = 'Impossible de créer la table. Vérifie ta connexion.'; }
  });
  $('rm-leave').addEventListener('click', () => { if (lobbyLastInfo && window.Social) Social.lobbyRemove('roulette', tableId, lobbyLastInfo); lobbyLastInfo = null; showLobby(); if (window.Social && Social.hubLink) location.href = Social.hubLink('#multi'); });
  $('rm-invite').addEventListener('click', async () => {
    if (window.Social && Social.inviteDialog) { Social.inviteDialog('roulette', tableId); return; }
    const u = new URL(location.href); u.search = ''; u.searchParams.set('table', tableId);
    const text = 'Rejoins ma table de roulette ! Code : ' + tableId;
    if (navigator.share) { try { await navigator.share({ title: 'Roulette entre amis', text, url: u.toString() }); return; } catch (e) { /* annulé */ } }
    try { await navigator.clipboard.writeText(text + ' — ' + u.toString()); $('sub-message').textContent = 'Lien d\'invitation copié !'; } catch (e) { $('sub-message').textContent = 'Code de la table : ' + tableId; }
  });
  // Réactions rapides : envoyées par le chat de la table, elles s'envolent chez tout le monde
  if (window.Social) {
    Social.reactionBar($('chat-form').parentNode, (emoji) => {
      if (!net || !tableId) return;
      net.sendChat(tableId, { uid: me, name: myName(), text: emoji, ts: Date.now(), reaction: true }).catch(() => {});
    });
  }
  // Les joueurs croisés à une table deviennent des amis (classement de l'accueil)
  function befriend() {
    if (!window.Social) return;
    (st ? Object.keys(st.players) : []).forEach((u) => { if (u && u !== me) Social.addFriendUid(u); });
  }
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('chat-input').value.trim(); $('chat-input').value = '';
    if (t && net && tableId) net.sendChat(tableId, { uid: me, name: myName(), text: t.slice(0, 300), ts: now() }).catch(() => {});
  });
  const setCoach = (on) => { try { localStorage.setItem(coachKey(), on ? '1' : '0'); } catch (e) { /* ignore */ } render(); };
  $('coach-yes').addEventListener('click', () => { $('coach-dialog').close(); setCoach(true); });
  $('coach-no').addEventListener('click', () => { $('coach-dialog').close(); setCoach(false); });
  $('coach-dialog').addEventListener('cancel', (e) => e.preventDefault());

  // ---------- Onglets ----------
  function setMode(mode) {
    document.body.dataset.mode = mode;
    $('tab-solo').classList.toggle('active', mode === 'solo');
    $('tab-multi').classList.toggle('active', mode === 'multi');
    $('tab-solo').setAttribute('aria-selected', mode === 'solo');
    $('tab-multi').setAttribute('aria-selected', mode === 'multi');
    $('multi-view').hidden = mode !== 'multi';
    if (mode === 'solo') {
      $('chat-panel').hidden = true;
      RouletteSolo.activate();
    } else {
      if (window.Casino) Casino.training = false; // entre amis : ça compte pour la progression
      $('mode-badge').hidden = true;
      $('setup').hidden = true;
      $('game').hidden = !tableId;
      $('chat-panel').hidden = !tableId;
      if (tableId) { UI.setHandlers(handlers); render(); UI.renderStats(T); }
      start();
    }
  }
  $('tab-solo').addEventListener('click', () => setMode('solo'));
  $('tab-multi').addEventListener('click', () => setMode('multi'));

  let started = false;
  async function start() {
    if (started) { if (net && !tableId) $('rm-lobby').hidden = false; return; }
    started = true;
    $('rm-loading').hidden = false;
    let n = null;
    try { n = await window.createNet({ ns: 'r', normalize, needPrivate: true }); } catch (e) { n = null; }
    $('rm-loading').hidden = true;
    if (!n || n.error) {
      $('rm-unavailable').hidden = false;
      if (n && n.error) $('rm-unavailable-detail').textContent = 'Connexion au serveur impossible. Vérifie ta connexion Internet puis recharge la page.';
      return;
    }
    net = n; me = n.me;
    $('rm-pseudo').value = myName();
    const code = new URLSearchParams(location.search).get('table');
    showLobby();
    if (code) {
      if (myName()) openTable(code.toUpperCase());
      else { $('rm-code').value = code.toUpperCase(); needPseudo(); }
    }
  }
  if (new URLSearchParams(location.search).get('table') || new URLSearchParams(location.search).get('multi') || (window.Social && Social.wantsTable && Social.wantsTable())) { document.body.classList.add('multi-entry'); setMode('multi'); }

  window.RouletteMulti = { get state() { return st; }, get me() { return me; }, get net() { return net; }, get tableId() { return tableId; } };
})();
