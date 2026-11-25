/*
 * Poker « Entre amis » : Texas Hold'em à 6 places avec un code de table.
 *
 * Secret des cartes :
 *  - l'état public de la table (mises, tableau, tour de parole) est partagé par tous ;
 *  - les cartes de chaque joueur sont écrites dans un coffre que lui seul peut lire ;
 *  - le paquet n'est connu que de l'appareil de l'hôte, qui distribue le flop, le turn, la river
 *    et révèle les cartes des joueurs encore en jeu à l'abattage.
 * Si l'hôte quitte la table, un autre joueur présent devient hôte ; une main en cours est alors annulée
 * et les mises sont rendues.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const P = PokerEngine, C = PokerCoach;
  const SEATS = 6;
  const CARD_MS = 650;

  let net = null, me = null;
  let tableId = null;
  let pub = null;              // état public de la table
  let myHole = null;           // { hand, seat, cards } : mes cartes privées
  let specHoles = null;        // spectateur : { hand, holes: { siège: cartes } }
  let specUnsub = null;
  let unsub = [], stopPresence = null;
  let working = false, hostBusy = false;
  let boardShown = 0, shownHand = -1, revealTimer = null;
  let pending = null, pendingKey = '';
  let shownGameOver = null;
  const shown = new Map();
  const prevBets = {};
  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Pseudo et aides du coach ----------
  function myName() { try { return (localStorage.getItem('bj-pseudo') || (window.Casino && Casino.profile.pseudo) || '').trim().slice(0, 16); } catch (e) { return ''; } }
  function coachKey() { return 'pk-coach-' + tableId + '-' + me; }
  function coachChoice() { try { const v = localStorage.getItem(coachKey()); return v === null ? null : v === '1'; } catch (e) { return null; } }
  function coachOn() { return !!(pub && pub.settings.coach && coachChoice() !== false); }
  function setCoach(on) {
    try { localStorage.setItem(coachKey(), on ? '1' : '0'); } catch (e) { /* ignore */ }
    render();
  }

  // ---------- État public ----------
  function emptySeat() { return { owner: null, name: '', stack: 0, out: true, cards: [], bet: 0, total: 0, folded: false, allin: false, acted: false, last: '' }; }
  function normalize(st) {
    st.seats = st.seats || [];
    for (let i = 0; i < SEATS; i++) {
      const s = Object.assign(emptySeat(), st.seats[i] || {});
      s.cards = s.cards || [];
      st.seats[i] = s;
    }
    st.board = st.board || [];
    st.log = st.log || [];
    st.players = st.players || {};
    if (st.results) { st.results.pots = (st.results.pots || []).map((p) => Object.assign({ winners: [] }, p, { winners: p.winners || [] })); }
    st.settings = Object.assign({ sb: 10, bb: 20, stack: 2000, turnTime: 30, coach: true, blindRule: 'h8' }, st.settings || {});
    st.lv = st.lv || {};
    if (st.tstats) {
      st.tstats.eliminated = st.tstats.eliminated || [];
      st.tstats.players = st.tstats.players || {};
    }
    return st;
  }

  function initialPub(name, settings) {
    const st = P.createTable({ sb: settings.sb, bb: settings.bb });
    for (let i = 0; i < SEATS; i++) st.seats.push(emptySeat());
    return Object.assign(st, {
      name, creator: me, host: me, settings, players: {}, external: true, started: false,
      nextHandAt: null, turnDeadline: null, createdAt: now(), updatedAt: now(),
    });
  }

  const mySeatIn = (st) => st.seats.findIndex((s) => s.owner === me);
  const handLive = (st) => ['preflop', 'flop', 'turn', 'river'].includes(st.street);
  const seatedCount = (st) => st.seats.filter((s) => s.owner && s.stack > 0).length;

  // Une partie a commencé (au moins une main) et n'est pas terminée : on ne peut plus s'asseoir
  const gameRunning = (st) => !!(st.tstats && st.tstats.hands > 0 && !st.gameOver) || handLive(st);

  function opSit(st, i) {
    if (st.seats[i].owner || mySeatIn(st) >= 0 || gameRunning(st)) return false;
    const bank = st.players[me] && st.players[me].bank;
    st.seats[i] = Object.assign(emptySeat(), { owner: me, name: myName() || 'Joueur', stack: bank > 0 ? bank : st.settings.stack });
    if (st.started !== false && !st.nextHandAt && !handLive(st) && seatedCount(st) >= 2) st.nextHandAt = now() + 4000;
  }
  function opLeaveSeat(st) {
    const i = mySeatIn(st);
    if (i < 0) return false;
    const s = st.seats[i];
    if (handLive(st) && P.inHand(s)) return false; // on attend la fin de la main
    st.players[me] = { bank: s.stack };
    st.seats[i] = emptySeat();
  }
  // Nouvelle partie (hôte) : tous les joueurs assis repartent avec le tapis de départ
  function opRestart(st) {
    if (st.host !== me || !st.gameOver) return false;
    st.seats.forEach((s) => { if (s.owner) { s.stack = st.settings.stack; s.out = false; s.cards = []; s.total = 0; s.bet = 0; } });
    st.gameOver = null; st.tstats = null; st.lv = {};
    st.sb = st.settings.sb; st.bb = st.settings.bb;
    st.street = 'idle'; st.board = []; st.results = null;
    st.log.push('Nouvelle partie !');
    st.nextHandAt = seatedCount(st) >= 2 ? now() + 4000 : null;
  }

  // Fin de main : statistiques, éliminations, fin de partie
  function finishStats(st) {
    if (st.street !== 'showdown' || !st.tstats || st.statsHand === st.handNo) return;
    st.statsHand = st.handNo;
    const out = Tourney.recordHand(st.tstats, st, (i) => st.seats[i].owner, (i) => st.seats[i].name, now());
    out.forEach((i) => st.log.push(st.seats[i].name + ' est éliminé(e)'));
    const alive = st.seats.filter((s) => s.owner && s.stack > 0);
    if (alive.length <= 1 && st.tstats.hands > 0) {
      const w = alive[0];
      st.gameOver = { winner: w ? w.owner : null, name: w ? w.name : '', at: now(), blinds: st.sb + ' / ' + st.bb };
      st.nextHandAt = null;
      st.log.push((w ? w.name : 'Personne') + ' remporte la partie !');
    }
  }

  // Après la main, chacun peut choisir de montrer ses cartes (gagnant sans abattage, perdant, joueur couché)
  function opShow(cards) {
    return (st) => {
      const i = mySeatIn(st);
      if (i < 0 || st.street !== 'showdown' || !cards || !st.seats[i].cards.length) return false;
      const s = st.seats[i];
      if (s.cards.some((c) => c.rank)) return false; // déjà visibles
      s.cards = cards; s.shown = true; s.mucked = false; s.showedByChoice = true;
      s.handName = st.board.length >= 3 ? PokerEval.evaluate(cards.concat(st.board)).name : '';
      st.log.push((s.name || 'Un joueur') + ' montre ses cartes');
    };
  }

  function afterChange(st, extraMs) {
    if (st.street === 'showdown') {
      st.turnDeadline = null;
      st.nextHandAt = now() + 7000 + st.board.length * CARD_MS;
      finishStats(st);
    } else if (st.toAct >= 0) {
      st.turnDeadline = now() + st.settings.turnTime * 1000 + (extraMs || 0);
    }
  }

  function opAct(st, action, force) {
    if (!handLive(st) || st.pending || st.toAct < 0) return false;
    const i = st.toAct;
    if (!force && st.seats[i].owner !== me) return false;
    if (force && now() < (st.turnDeadline || 0) - 300) return false;
    if (!P.act(st, i, action)) return false;
    afterChange(st, 0);
  }

  // ---------- Rôle d'hôte (seul à connaître le paquet) ----------
  let lastSecret = null;
  function hostStartFn(present) {
    return (st) => {
      if (st.host !== me || handLive(st) || st.gameOver || !st.nextHandAt || now() < st.nextHandAt - 300) return false;
      // les joueurs partis libèrent leur place
      st.seats.forEach((s, i) => {
        if (s.owner && present && !present[s.owner]) {
          // un joueur parti pendant la partie est éliminé (ses jetons sont perdus)
          if (st.tstats && s.stack > 0) { s.stack = 0; st.log.push(s.name + ' a quitté la partie'); }
          st.seats[i] = emptySeat();
        }
      });
      if (seatedCount(st) < 2) { st.nextHandAt = null; st.street = 'idle'; return; }
      st.seats.forEach((s) => { s.out = !s.owner || s.stack <= 0; });
      st.external = true;
      st.runoutShown = false;
      if (!st.tstats) st.tstats = Tourney.createStats(now());
      // Montée des blindes (au nombre de mains ou de minutes, choisi par l'hôte)
      const b = Tourney.maybeLevelUp(st.lv, st.settings.blindRule, st.settings.sb, st.settings.bb, now());
      if (b) { st.sb = b.sb; st.bb = b.bb; st.log.push('Les blindes augmentent : ' + b.sb + ' / ' + b.bb); }
      if (!P.startHand(st)) { st.nextHandAt = null; return; }
      lastSecret = { hand: st.handNo, deck: st.deck, holes: {}, owners: {} };
      delete st.deck;
      st.seats.forEach((s, i) => {
        if (!s.cards.length) return;
        lastSecret.holes[i] = s.cards;
        lastSecret.owners[i] = s.owner;
        s.cards = s.cards.map((c) => ({ hidden: true, id: c.id }));
      });
      st.nextHandAt = null;
      st.results = null;
      afterChange(st, (seatedCount(st) * 2) * 350);
    };
  }

  function hostFulfillFn(secret) {
    return (st) => {
      if (st.host !== me || !st.pending || !secret || secret.hand !== st.handNo) return false;
      const deck = secret.deck.slice();
      let guard = 0, drawn = 0;
      // Plus aucune enchère possible (joueurs à tapis) : toutes les cartes sont retournées avant la suite du tableau
      const alive = st.seats.filter(P.inHand).length, actors = st.seats.filter(P.canAct).length;
      if (alive >= 2 && actors < 2 && !st.runoutShown) {
        st.runoutShown = true;
        st.seats.forEach((s, i) => { if (P.inHand(s) && secret.holes[i]) { s.cards = secret.holes[i]; s.shown = true; } });
      }
      while (st.pending && st.pending !== 'showdown' && guard++ < 5) {
        const n = st.pending === 'flop' ? 3 : 1;
        const cards = [];
        for (let k = 0; k < n; k++) { const raw = deck.pop(); st.cardSeq++; cards.push({ rank: raw.rank, suit: raw.suit, id: st.cardSeq }); }
        drawn += n;
        P.fulfill(st, cards);
      }
      if (st.pending === 'showdown') {
        st.seats.forEach((s, i) => { if (P.inHand(s) && secret.holes[i]) s.cards = secret.holes[i]; });
        P.showdown(st);
        // Les perdants jettent leurs cartes face cachée (ils peuvent choisir de les montrer ensuite)
        if (!st.runoutShown) {
          st.seats.forEach((s) => {
            if (P.inHand(s) && !s.won) { s.cards = s.cards.map((c) => ({ hidden: true, id: c.id })); s.shown = false; s.handName = ''; s.mucked = true; }
          });
        }
      }
      lastSecret = Object.assign({}, secret, { deck });
      afterChange(st, drawn * CARD_MS);
    };
  }

  async function hostWork() {
    if (!pub || pub.host !== me || hostBusy || !tableId) return;
    hostBusy = true;
    try {
      if (pub.pending && handLive(pub)) {
        const secret = await net.getSecret(tableId);
        if (secret && secret.hand === pub.handNo) {
          lastSecret = null;
          const ok = await net.transact(tableId, hostFulfillFn(secret));
          if (ok && lastSecret) await net.setSecret(tableId, lastSecret);
        } else {
          await net.transact(tableId, voidHandFn('cartes introuvables'));
        }
      } else if (!handLive(pub) && pub.nextHandAt && now() >= pub.nextHandAt - 300) {
        const present = await net.presenceList(tableId);
        lastSecret = null;
        const ok = await net.transact(tableId, hostStartFn(present));
        if (ok && lastSecret) {
          const sec = lastSecret;
          await net.setSecret(tableId, sec);
          await Promise.all(Object.keys(sec.holes).map((i) => net.setPrivate(tableId, sec.owners[i], { hand: sec.hand, seat: +i, cards: sec.holes[i] })));
          if (net.setSpectator) net.setSpectator(tableId, { hand: sec.hand, holes: sec.holes }).catch(() => {});
        }
      }
    } catch (e) { /* on réessaiera au prochain changement */ } finally { hostBusy = false; }
  }

  // Main annulée (hôte parti, paquet perdu) : chacun récupère ses mises
  function voidHandFn(reason) {
    return (st) => {
      if (!handLive(st) && !st.pending) return false;
      st.seats.forEach((s) => { s.stack += s.total; s.total = 0; s.bet = 0; s.cards = []; s.folded = false; s.allin = false; s.last = ''; });
      st.street = 'idle'; st.pending = null; st.toAct = -1; st.board = []; st.results = null;
      st.log.push('Main annulée (' + reason + ') : les mises sont rendues.');
      st.nextHandAt = now() + 4000;
    };
  }

  // Toutes les 10 s : si l'hôte n'est plus là, le premier joueur présent prend le relais
  async function checkHost() {
    if (!pub || !tableId || pub.host === me) return;
    try {
      const present = await net.presenceList(tableId);
      if (present[pub.host]) return;
      const candidates = Object.keys(present).sort();
      if (candidates[0] !== me) return;
      await net.transact(tableId, (st) => {
        if (st.host === me) return false;
        st.host = me;
        if (handLive(st) || st.pending) voidHandFn('l\'hôte a quitté la table')(st);
        if (!st.nextHandAt && seatedCount(st) >= 2) st.nextHandAt = now() + 4000;
      });
    } catch (e) { /* ignore */ }
  }
  setInterval(checkHost, 10000);

  // ---------- Minuteurs ----------
  let timers = [];
  function scheduleTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (!pub || !tableId) return;
    if (pub.host === me) {
      if (pub.pending) timers.push(setTimeout(hostWork, 50));
      else if (!handLive(pub) && pub.nextHandAt) timers.push(setTimeout(hostWork, Math.max(0, pub.nextHandAt - now()) + 50));
    }
    if (handLive(pub) && !pub.pending && pub.toAct >= 0 && pub.turnDeadline) {
      const mine = pub.seats[pub.toAct].owner === me;
      const key = pub.handNo + ':' + pub.toAct + ':' + pub.street + ':' + pub.currentBet;
      const delay = Math.max(0, pub.turnDeadline - now()) + (mine ? 100 : 1500 + Math.random() * 800);
      timers.push(setTimeout(() => net.transact(tableId, (st) => {
        if (st.handNo + ':' + st.toAct + ':' + st.street + ':' + st.currentBet !== key) return false;
        const L = P.legal(st, st.toAct);
        return opAct(st, { type: L.canCheck ? 'check' : 'fold' }, true); // temps écoulé : parole ou se coucher
      }).catch(() => {}), delay));
    }
  }

  let lastTick = -1;
  setInterval(() => {
    const box = $('pm-timer');
    if (!pub || !tableId || document.body.dataset.mode !== 'multi') { box.hidden = true; return; }
    let end = 0, total = 0, label = '', mine = false;
    if (handLive(pub) && !pub.pending && pub.toAct >= 0 && pub.turnDeadline && boardShown >= pub.board.length) {
      end = pub.turnDeadline; total = pub.settings.turnTime * 1000;
      mine = pub.seats[pub.toAct].owner === me;
      label = mine ? 'À toi' : pub.seats[pub.toAct].name;
    } else if (!handLive(pub) && pub.nextHandAt) {
      end = pub.nextHandAt; total = 8000; label = 'Prochaine main';
    }
    if (!end) { box.hidden = true; return; }
    const left = Math.max(0, end - now());
    box.hidden = false;
    $('pm-timer-bar').style.width = Math.min(100, (left / total) * 100) + '%';
    $('pm-timer-bar').classList.toggle('urgent', mine && left < 5000);
    $('pm-timer-text').textContent = label + ' : ' + Math.ceil(left / 1000) + ' s';
    const sec = Math.ceil(left / 1000);
    if (mine && left > 0 && left < 5000 && sec !== lastTick && window.Sfx) { lastTick = sec; Sfx.tick(); }
  }, 250);

  // ---------- Réception ----------
  function onPub(raw) {
    setTimeout(befriend, 0);
    if (!raw) { showLobby('Cette table n\'existe pas ou a été fermée.'); return; }
    const st = normalize(JSON.parse(JSON.stringify(raw)));
    if (pub && st.handNo !== pub.handNo) { boardShown = 0; }
    if (shownHand < 0) boardShown = st.board.length; // arrivée en cours de main : pas d'animation
    shownHand = st.handNo;
    pub = st;
    if (pub.settings.coach && coachChoice() === null && !$('pm-coach-dialog').open) {
      try { $('pm-coach-dialog').showModal(); } catch (e) { $('pm-coach-dialog').setAttribute('open', ''); }
    }
    revealBoard();
    render();
    scheduleTimers();
    if (pub.host === me) hostWork();
  }

  function revealBoard() {
    if (revealTimer || !pub || boardShown >= pub.board.length) return;
    revealTimer = setTimeout(() => {
      revealTimer = null;
      boardShown++;
      render();
      revealBoard();
    }, CARD_MS);
  }

  // ---------- Rendu ----------
  function cardEl(card, faceUp) {
    const el = document.createElement('div');
    const hidden = !faceUp || !card.rank;
    const prev = shown.get(card.id);
    const anim = !prev ? ' dealt' : (prev === 'hidden' && !hidden ? ' flip' : '');
    shown.set(card.id, hidden ? 'hidden' : 'shown');
    if (window.Sfx) { if (anim === ' dealt') Sfx.card(); else if (anim === ' flip') Sfx.flip(); }
    if (hidden) { el.className = 'card back' + anim; return el; }
    el.className = 'card' + (card.suit === '♥' || card.suit === '♦' ? ' red' : '') + anim;
    el.innerHTML = '<div class="tl">' + card.rank + '<br>' + card.suit + '</div><div class="mid">' + card.suit + '</div>';
    return el;
  }
  function seatPos(k, r) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / SEATS;
    return { left: 50 + r[0] * Math.cos(a), top: 50 + r[1] * Math.sin(a) };
  }
  const myCards = () => (myHole && pub && myHole.hand === pub.handNo ? myHole.cards : null);
  // Spectateur (pas assis, ou éliminé) : il voit les cartes de tout le monde
  const isSpectator = (st) => { const i = mySeatIn(st); return i < 0 || (st.seats[i].stack <= 0 && !handLive(st)) || (st.seats[i].stack <= 0 && st.seats[i].out); };
  const specCards = (i) => (specHoles && pub && specHoles.hand === pub.handNo && specHoles.holes ? specHoles.holes[i] : null);
  function syncSpectator() {
    const want = !!(pub && tableId && net && net.watchSpectator && isSpectator(pub));
    if (want && !specUnsub) specUnsub = net.watchSpectator(tableId, (v) => { specHoles = v; render(); });
    if (!want && specUnsub) { try { specUnsub(); } catch (e) { /* ignore */ } specUnsub = null; specHoles = null; }
  }

  // ---------- Liste des parties ouvertes (onglet Multijoueur de l'accueil) ----------
  // Signal envoyé par l'hôte à chaque changement ET toutes les 30 s, même si la table attend sans bouger.
  // Les tables créées avant cette option sont considérées comme publiques.
  let lobbyLastInfo = null;
  function lobbyTick() {
    const st = pub;
    if (!st || !tableId || !window.Social || !Social.lobbyBeat) return;
    if (!(st.host === me && !st.gameOver)) { if (lobbyLastInfo) { Social.lobbyRemove('poker', tableId, lobbyLastInfo); lobbyLastInfo = null; } return; }
    const sets = st.settings || {};
    lobbyLastInfo = { name: st.name, host: myName(), players: st.seats.filter((x) => x.owner).length, max: st.seats.length, pub: sets.public !== false, lk: sets.lk, live: gameRunning(st) };
    Social.lobbyBeat('poker', tableId, lobbyLastInfo);
  }
  setInterval(lobbyTick, 30000);

  function render() {
    if (!pub || !tableId) return;
    if (window.Social && Social.waitingRoom) Social.waitingRoom({
      container: $('pm-table'), started: pub.started !== false, me, hostUid: pub.host, minPlayers: 2,
      players: pub.seats.filter((x) => x.owner).map((x) => ({ uid: x.owner, name: x.name || 'Joueur', ready: !!(pub.wait && pub.wait[x.owner]) })),
      onReady: (on) => act((x) => { x.wait = x.wait || {}; x.wait[me] = on; }),
      onStart: () => act((x) => { if (x.host !== me) return false; x.started = true; if (!handLive(x) && seatedCount(x) >= 2) x.nextHandAt = now() + 3000; }),
    });
    document.body.classList.toggle('no-coach', !coachOn());
    const st = pub;
    lobbyTick();
    $('pm-table-name').textContent = st.name || 'Table';
    $('pm-table-code').textContent = tableId;
    $('pm-host').textContent = st.host === me ? 'Tu es l\'hôte (tu distribues)' : '';
    const mySeat = mySeatIn(st);
    const base = mySeat >= 0 ? mySeat : 0;
    syncSpectator();
    const spect = isSpectator(st);
    const sb = $('pm-spec');
    if (sb) { sb.hidden = !spect || !(st.started !== false && (handLive(st) || gameRunning(st))); }
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const seatR = narrow ? [40, 42] : [44, 40];
    const betR = narrow ? [24, 26] : [27, 25];
    const showdown = st.street === 'showdown';
    const boardDone = boardShown >= st.board.length;
    const winCards = new Set();
    if (showdown && boardDone && st.results && !st.results.uncontested) {
      st.results.pots.forEach((p) => p.winners.forEach((w) => (st.seats[w].bestCards || []).forEach((id) => winCards.add(id))));
    }
    const seats = $('pm-seats');
    seats.innerHTML = '';
    st.seats.forEach((s, i) => {
      const k = (i - base + SEATS) % SEATS;
      const pos = seatPos(k, seatR);
      const el = document.createElement('div');
      const isMe = i === mySeat;
      el.className = 'seat' + (isMe ? ' me' : '') + (s.folded ? ' folded' : '') + (!s.owner ? ' empty' : '') +
        (handLive(st) && st.toAct === i && boardDone ? ' turn' : '') + (showdown && boardDone && s.won > 0 ? ' winner' : '');
      el.style.left = pos.left + '%';
      el.style.top = isMe ? 'calc(100% - 6px)' : pos.top + '%';
      const hole = document.createElement('div');
      hole.className = 'hole';
      const seen = spect && i !== mySeat ? specCards(i) : null;
      if (s.cards.length && (!s.folded || isMe || s.showedByChoice || seen) && !(s.mucked && !isMe && !s.shown && !seen)) {
        const mine = isMe ? myCards() : seen;
        s.cards.forEach((c, j) => {
          const real = mine ? mine[j] : c;
          const faceUp = !!(real && real.rank) && (isMe || !!seen || st.runoutShown || (showdown && boardDone) || s.showedByChoice);
          const ce = cardEl(real || c, faceUp);
          if (winCards.has(c.id)) ce.classList.add('win');
          if (s.folded) ce.classList.add('dim');
          hole.appendChild(ce);
        });
      }
      const plate = document.createElement('div');
      plate.className = 'plate';
      if (!s.owner) {
        const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = 'Libre';
        plate.appendChild(nm);
        if (mySeat < 0 && gameRunning(st)) {
          const w = document.createElement('div'); w.className = 'last'; w.textContent = 'Partie en cours';
          plate.appendChild(w);
        } else if (mySeat < 0) {
          const b = document.createElement('button');
          b.className = 'sit'; b.textContent = 'S\'asseoir'; b.disabled = working;
          b.addEventListener('click', () => {
            if (!myName()) { toast('Choisis d\'abord un pseudo (← Tables).'); return; }
            act((x) => opSit(x, i));
          });
          plate.appendChild(b);
        }
      } else {
        const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = isMe ? 'Toi' : s.name;
        const sk = document.createElement('div'); sk.className = 'stack'; sk.textContent = s.allin && !showdown ? 'Tapis' : s.stack;
        const last = document.createElement('div'); last.className = 'last';
        last.textContent = showdown && boardDone && s.won ? '+' + s.won : showdown && boardDone && s.mucked && !s.shown ? 'Cartes jetées' : s.last || '';
        plate.append(nm, sk, last);
        const elim = st.tstats && s.stack <= 0 && st.tstats.eliminated.find((e) => e.key === s.owner);
        if (elim && !(showdown && boardDone && s.won)) { el.classList.add('eliminated'); last.textContent = 'Éliminé · ' + elim.place + 'e'; }
        if (showdown && boardDone && s.handName && s.shown) {
          const hn = document.createElement('div'); hn.className = 'hand-name'; hn.textContent = s.handName; plate.appendChild(hn);
        }
      }
      el.append(hole, plate);
      seats.appendChild(el);
      if (s.bet > (prevBets[i] || 0) && window.Sfx) Sfx.chips();
      prevBets[i] = s.bet;
      if (s.bet > 0 && !showdown) {
        const bp = seatPos(k, k === 0 ? [betR[0], betR[1] * 0.45] : betR); // devant ta place : plus haut, au-dessus de tes cartes
        const chip = document.createElement('div');
        chip.className = 'bet-chip'; chip.style.left = bp.left + '%'; chip.style.top = bp.top + '%'; chip.textContent = s.bet;
        seats.appendChild(chip);
      }
      if (i === st.button && st.handNo > 0) {
        const dp = seatPos(k + 0.32, [seatR[0] - 9, seatR[1] - 12]);
        const d = document.createElement('div');
        d.className = 'dealer-btn'; d.textContent = 'D'; d.style.left = dp.left + '%'; d.style.top = dp.top + '%';
        seats.appendChild(d);
      }
    });

    const board = $('pm-board');
    board.innerHTML = '';
    for (let k = 0; k < 5; k++) {
      if (k < boardShown && st.board[k]) {
        const ce = cardEl(st.board[k], true);
        if (winCards.has(st.board[k].id)) ce.classList.add('win');
        board.appendChild(ce);
      } else { const slot = document.createElement('div'); slot.className = 'slot'; board.appendChild(slot); }
    }
    const pot = P.pot(st);
    $('pm-pot').textContent = pot && handLive(st) ? 'Pot : ' + pot : '';
    const msg = $('pm-message');
    if (!msg.classList.contains('flash')) {
      if (seatedCount(st) < 2 && !handLive(st)) msg.textContent = 'En attente d\'au moins 2 joueurs assis…';
      else if (showdown && boardDone && st.results) {
        const r = st.results;
        const names = [...new Set(r.pots.flatMap((p) => p.winners))].map((w) => (w === mySeat ? 'Tu' : st.seats[w].name));
        msg.textContent = names.join(' et ') + (names.length === 1 && names[0] === 'Tu' ? ' remportes ' : names.length > 1 ? ' se partagent ' : ' remporte ') +
          r.pots.reduce((a, p) => a + p.amount, 0) + (!r.uncontested && r.pots[0].hand ? ' avec ' + r.pots[0].hand.toLowerCase() : '') + '.';
      } else if (handLive(st) && st.toAct >= 0 && boardDone) {
        msg.textContent = st.toAct === mySeat ? 'À toi de jouer !' : 'Au tour de ' + st.seats[st.toAct].name + '.';
      } else msg.textContent = st.pending ? 'Distribution…' : '';
    }
    $('my-stack').textContent = mySeat >= 0 ? st.seats[mySeat].stack : '–';
    $('pm-coach-row').hidden = !st.settings.coach;
    $('pm-opt-coach').checked = coachOn();
    renderActions(mySeat, boardDone);
    if (PokerApp.fillLog) PokerApp.fillLog($('log'), st.log);
    // Fin de partie : animation et récapitulatif pour tout le monde (une fois l'abattage affiché)
    if (st.gameOver && boardDone && shownGameOver !== st.gameOver.at) {
      shownGameOver = st.gameOver.at;
      const g = st.gameOver;
      const won = g.winner === me;
      const myElim = st.tstats.eliminated.find((e) => e.key === me);
      // Prix sur la banque du Casino (les jetons de la table, eux, restent sur la table)
      const nPlayers = (st.tstats.eliminated || []).length + 1;
      const myPlace = won ? 1 : myElim ? myElim.place : 0;
      const prize = myPlace && window.Casino ? Casino.prizeFor(myPlace, nPlayers) : 0;
      if (myPlace && window.Casino && Casino.pokerWeekAdd) Casino.pokerWeekAdd(myPlace, nPlayers); // tournoi de la semaine
      if (prize !== null && myPlace && window.Casino) Casino.multiPrize('pk:' + tableId + ':' + g.at, myPlace, nPlayers, { game: 'poker', table: tableId });
      setTimeout(() => PokerApp.showRecap({
        won, T: st.tstats, winnerKey: g.winner, winnerName: g.name, meKey: me, blinds: g.blinds,
        title: won ? 'Tu as gagné la partie !' : g.name + ' remporte la partie !',
        subtitle: (won ? 'Tous tes adversaires sont éliminés' : myElim ? 'Tu termines ' + myElim.place + 'e' : '') + (prize ? ' · +' + prize + ' € sur ta banque du Casino' : ''),
        againLabel: st.host === me ? 'Nouvelle partie' : 'Fermer',
        onAgain: () => { if (pub && pub.host === me) act(opRestart); },
      }), 1500);
    }
    endSounds(mySeat, boardDone);
  }

  function renderActions(mySeat, boardDone) {
    const st = pub;
    const myTurn = mySeat >= 0 && handLive(st) && !st.pending && st.toAct === mySeat && boardDone && !working && !!myCards();
    $('pm-main-actions').hidden = !myTurn;
    $('pm-hint').hidden = !myTurn;
    if (!myTurn) { $('pm-raise-box').hidden = true; pending = null; }
    const s = mySeat >= 0 ? st.seats[mySeat] : null;
    $('pm-leave-seat').hidden = !s || (handLive(st) && P.inHand(s));
    $('pm-rebuy').hidden = !(st.gameOver && st.host === me);
    $('pm-rebuy').textContent = 'Nouvelle partie';
    $('pm-show').hidden = !(s && st.street === 'showdown' && s.cards.length && !s.cards.some((c) => c.rank) && myCards());
    renderBlinds();
    if (!myTurn) return;
    const L = P.legal(st, mySeat);
    $('pm-fold').hidden = L.canCheck;
    $('pm-check').textContent = L.canCheck ? 'Parler' : (L.toCall >= s.stack ? 'Suivre (tapis)' : 'Suivre ' + L.toCall);
    $('pm-raise').hidden = !L.canRaise || L.minTo >= L.maxTo;
    $('pm-raise').textContent = L.isBet ? 'Miser' : 'Relancer';
    $('pm-allin').hidden = !L.canRaise && L.toCall < s.stack;
    $('pm-allin').textContent = 'Tapis (' + (s.stack + s.bet) + ')';
    const sl = $('pm-slider');
    sl.min = L.minTo; sl.max = L.maxTo; sl.step = Math.max(1, Math.round(st.bb / 2));
    if (+sl.value < L.minTo || +sl.value > L.maxTo) sl.value = L.minTo;
    updateRaise();
    // Analyse du coach pour cette décision (une seule fois)
    const key = st.handNo + ':' + st.street + ':' + st.currentBet + ':' + mySeat;
    if (coachOn() && pendingKey !== key) {
      pendingKey = key;
      pending = null;
      setTimeout(() => {
        if (pendingKey !== key || !pub) return;
        const local = JSON.parse(JSON.stringify(pub));
        local.seats[mySeat].cards = myCards();
        pending = C.analyze(local, mySeat, { iters: 600 });
        if ($('pm-opt-hint').checked) PokerApp.showHintRes(pending);
      }, 30);
    }
  }

  function renderBlinds() {
    if (!pub) return;
    const next = pub.tstats ? Tourney.nextLevelText(pub.lv, pub.settings.blindRule, now()) : 'hausse ' + Tourney.ruleLabel(pub.settings.blindRule);
    $('pm-blinds-info').textContent = 'Niveau ' + ((pub.lv.level || 0) + 1) + ' · Blindes ' + pub.sb + ' / ' + pub.bb + (next ? ' · ' + next : '');
  }
  setInterval(() => { if (pub && tableId) renderBlinds(); }, 1000);

  function updateRaise() {
    const mySeat = mySeatIn(pub);
    if (mySeat < 0) return;
    const L = P.legal(pub, mySeat);
    const v = +$('pm-slider').value;
    $('pm-value').textContent = v >= L.maxTo ? 'tapis (' + v + ')' : v;
    $('pm-confirm').firstChild.textContent = L.isBet ? 'Miser ' : 'Relancer à ';
  }

  let soundedHand = -1;
  function endSounds(mySeat, boardDone) {
    const st = pub;
    if (st.street !== 'showdown' || !boardDone || st.handNo === soundedHand || mySeat < 0) return;
    soundedHand = st.handNo;
    const s = st.seats[mySeat];
    if (!window.Sfx || !s.cards.length) return;
    if (s.won > 0) Sfx.win(); else if (s.total > 0) Sfx.lose();
    if (window.Casino) {
      if (!window.__multiTracked) { window.__multiTracked = true; Casino.track('multi', { game: 'poker' }); }
      Casino.track('pk', { won: s.won > 0, net: (s.won || 0) - s.total, cat: s.won > 0 && s.score ? Math.floor(s.score / 759375) : -1, allinWon: s.allin && s.won > 0 });
    }
  }

  function toast(text) {
    const m = $('pm-message');
    m.textContent = text;
    m.classList.add('flash');
    setTimeout(() => { m.classList.remove('flash'); render(); }, 1800);
  }

  async function act(fn) {
    if (!net || !tableId || working) return false;
    working = true;
    render();
    try { return await net.transact(tableId, fn); } catch (e) { toast('Action non envoyée. Vérifie ta connexion.'); return false; } finally { working = false; render(); }
  }

  function myAction(action) {
    const mySeat = mySeatIn(pub);
    if (mySeat < 0) return;
    const L = P.legal(pub, mySeat);
    if (action.type === 'raise' && action.to >= L.maxTo) action = { type: 'allin' };
    const res = coachOn() ? pending : null;
    const street = pub.street;
    const key = pub.handNo + ':' + pub.toAct + ':' + pub.street + ':' + pub.currentBet;
    $('pm-raise-box').hidden = true;
    act((st) => (st.handNo + ':' + st.toAct + ':' + st.street + ':' + st.currentBet === key ? opAct(st, action, false) : false)).then((ok) => {
      if (ok && res) PokerApp.record(res, action, street);
    });
  }

  // ---------- Chat ----------
  function renderChat(list) {
    const log = $('pm-chat');
    log.innerHTML = '';
    if (!list.length) { const p = document.createElement('div'); p.className = 'muted small'; p.textContent = 'Aucun message.'; log.appendChild(p); }
    list.forEach((m) => { if (window.Social && Social.isReaction(m)) Social.floatReaction(m); });
    list.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'msg' + (m.uid === me ? ' me' : '');
      const b = document.createElement('b'); b.textContent = (m.uid === me ? 'Toi' : m.name || 'Joueur') + ' ';
      el.append(b, String(m.text || ''));
      log.appendChild(el);
    });
    log.scrollTop = log.scrollHeight;
  }

  // ---------- Accueil et tables ----------
  function cleanup() {
    if (specUnsub) { try { specUnsub(); } catch (e) { /* ignore */ } specUnsub = null; specHoles = null; }
    unsub.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    unsub = [];
    timers.forEach(clearTimeout);
  }
  async function leaveTable(id) {
    const stop = stopPresence;
    stopPresence = null;
    if (!id || !stop) return;
    try { await net.transact(id, (st) => opLeaveSeat(st)); } catch (e) { /* ignore */ }
    await stop();
    try { if ((await net.activeCount(id)) === 0) await net.deleteTable(id); } catch (e) { /* ignore */ }
  }
  function showLobby(note) {
    if (tableId) leaveTable(tableId);
    cleanup();
    tableId = null; pub = null; myHole = null;
    document.body.classList.remove('no-coach');
    $('pm-table').hidden = true;
    $('pm-chat-panel').hidden = true;
    $('pm-lobby').hidden = false;
    $('pm-note').textContent = note || '';
    setUrl(null);
  }
  function setUrl(code) {
    try {
      const u = new URL(location.href);
      if (code) u.searchParams.set('table', code); else u.searchParams.delete('table');
      history.replaceState(null, '', u.toString());
    } catch (e) { /* ignore */ }
  }
  async function openTable(id, justCreated) {
    cleanup();
    if (!justCreated) {
      $('pm-note').textContent = 'Recherche de la table…';
      let n = 1;
      try { n = await net.activeCount(id); } catch (e) { n = 1; }
      if (n === 0) {
        try { await net.deleteTable(id); } catch (e) { /* ignore */ }
        $('pm-note').textContent = 'Cette table est fermée : tout le monde l\'a quittée.';
        return;
      }
    }
    tableId = id;
    if (window.Social && Social.tableReady) Social.tableReady('poker', id);
    pub = null; myHole = null; shownHand = -1; boardShown = 0;
    $('pm-note').textContent = '';
    $('pm-lobby').hidden = true;
    $('pm-table').hidden = false;
    $('pm-chat-panel').hidden = false;
    $('pm-message').textContent = 'Connexion à la table…';
    setUrl(id);
    stopPresence = net.presenceStart(id);
    unsub.push(net.watchTable(id, onPub, () => toast('Connexion perdue.')));
    unsub.push(net.watchPrivate(id, (v) => { myHole = v; render(); }));
    unsub.push(net.watchChat(id, renderChat));
  }
  function needPseudo() {
    if (myName()) return false;
    $('pm-pseudo').focus();
    $('pm-note').textContent = 'Choisis d\'abord un pseudo.';
    return true;
  }

  $('pm-pseudo').addEventListener('change', (e) => {
    try { localStorage.setItem('bj-pseudo', e.target.value.trim().slice(0, 16)); } catch (err) { /* ignore */ }
    $('pm-note').textContent = '';
  });
  $('pm-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('pm-join').addEventListener('submit', (e) => {
    e.preventDefault();
    if (needPseudo()) return;
    const code = $('pm-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { $('pm-note').textContent = 'Le code fait 4 caractères.'; return; }
    openTable(code);
  });
  $('pm-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (needPseudo()) return;
    const [sb, bb] = $('pm-blinds').value.split('/').map(Number);
    const settings = { sb, bb, stack: bb * parseInt($('pm-stack').value, 10), turnTime: parseInt($('pm-turn').value, 10), coach: $('pm-coach').checked,
      blindRule: $('pm-blindup').value, public: $('pm-public').checked, lk: Math.random().toString(36).slice(2, 10) };
    try {
      const id = await net.createTable(initialPub($('pm-name').value.trim().slice(0, 30) || 'Poker de ' + myName(), settings));
      $('pm-name').value = '';
      openTable(id, true);
    } catch (err) { $('pm-note').textContent = 'Impossible de créer la table. Vérifie ta connexion.'; }
  });
  $('pm-leave-table').addEventListener('click', () => { if (lobbyLastInfo && window.Social) Social.lobbyRemove('poker', tableId, lobbyLastInfo); lobbyLastInfo = null; showLobby(); if (window.Social && Social.hubLink) location.href = Social.hubLink('#multi'); });
  $('pm-invite').addEventListener('click', async () => {
    if (window.Social && Social.inviteDialog) { Social.inviteDialog('poker', tableId); return; }
    const u = new URL(location.href); u.search = ''; u.searchParams.set('table', tableId);
    const text = 'Rejoins ma table de poker ! Code : ' + tableId;
    if (navigator.share) { try { await navigator.share({ title: 'Poker entre amis', text, url: u.toString() }); return; } catch (e) { /* annulé */ } }
    try { await navigator.clipboard.writeText(text + ' — ' + u.toString()); toast('Lien d\'invitation copié !'); } catch (e) { toast('Code de la table : ' + tableId); }
  });
  // Réactions rapides : envoyées par le chat de la table, elles s'envolent chez tout le monde
  if (window.Social) {
    Social.reactionBar($('pm-chat-form').parentNode, (emoji) => {
      if (!net || !tableId) return;
      net.sendChat(tableId, { uid: me, name: myName(), text: emoji, ts: Date.now(), reaction: true }).catch(() => {});
    });
  }
  // Les joueurs croisés à une table deviennent des amis (classement de l'accueil)
  function befriend() {
    if (!window.Social) return;
    (pub ? pub.seats.map((x) => x.owner) : []).forEach((u) => { if (u && u !== me) Social.addFriendUid(u); });
  }
  $('pm-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('pm-chat-input').value.trim();
    $('pm-chat-input').value = '';
    if (t && net && tableId) net.sendChat(tableId, { uid: me, name: myName(), text: t.slice(0, 300), ts: now() }).catch(() => toast('Message non envoyé.'));
  });
  $('pm-fold').addEventListener('click', () => myAction({ type: 'fold' }));
  $('pm-check').addEventListener('click', () => { const L = P.legal(pub, mySeatIn(pub)); myAction({ type: L.canCheck ? 'check' : 'call' }); });
  $('pm-allin').addEventListener('click', () => myAction({ type: 'allin' }));
  $('pm-raise').addEventListener('click', () => {
    $('pm-raise-box').hidden = !$('pm-raise-box').hidden;
    const L = P.legal(pub, mySeatIn(pub));
    $('pm-slider').value = Math.min(L.maxTo, Math.max(L.minTo, Math.round((L.isBet ? L.pot * 0.66 : pub.currentBet * 3) / 5) * 5));
    updateRaise();
  });
  $('pm-slider').addEventListener('input', updateRaise);
  document.querySelectorAll('[data-pm-preset]').forEach((b) => b.addEventListener('click', () => {
    const L = P.legal(pub, mySeatIn(pub));
    const p = b.dataset.pmPreset;
    const to = p === 'max' ? L.maxTo : pub.currentBet + Math.round((L.pot + L.toCall) * parseFloat(p));
    $('pm-slider').value = Math.min(L.maxTo, Math.max(L.minTo, to));
    updateRaise();
  }));
  $('pm-confirm').addEventListener('click', () => myAction({ type: 'raise', to: +$('pm-slider').value }));
  $('pm-hint').addEventListener('click', () => { if (pending) PokerApp.showHintRes(pending); });
  $('pm-rebuy').addEventListener('click', () => act(opRestart));
  $('pm-show').addEventListener('click', () => act(opShow(myCards())));
  $('pm-leave-seat').addEventListener('click', () => act(opLeaveSeat));
  $('pm-opt-coach').addEventListener('change', (e) => setCoach(e.target.checked));
  $('pm-coach-yes').addEventListener('click', () => { $('pm-coach-dialog').close(); setCoach(true); });
  $('pm-coach-no').addEventListener('click', () => { $('pm-coach-dialog').close(); setCoach(false); });
  $('pm-coach-dialog').addEventListener('cancel', (e) => e.preventDefault());
  window.addEventListener('resize', () => render());

  // ---------- Onglets ----------
  function setMode(mode) {
    document.body.dataset.mode = mode;
    $('tab-solo').classList.toggle('active', mode === 'solo');
    $('tab-multi').classList.toggle('active', mode === 'multi');
    $('tab-solo').setAttribute('aria-selected', mode === 'solo');
    $('tab-multi').setAttribute('aria-selected', mode === 'multi');
    $('solo-view').hidden = mode !== 'solo';
    $('multi-view').hidden = mode !== 'multi';
    $('pm-chat-panel').hidden = mode !== 'multi' || !tableId;
    if (mode === 'solo') {
      const st = PokerApp.state, c = PokerApp.cfg;
      document.body.classList.toggle('no-coach', !!(st && c && !c.coach));
      if (window.Casino) Casino.training = !!(st && c && !c.real);
      $('my-stack').textContent = st ? st.seats[0].stack : '–';
    } else { if (window.Casino) Casino.training = false; start(); }
  }
  $('tab-solo').addEventListener('click', () => setMode('solo'));
  $('tab-multi').addEventListener('click', () => setMode('multi'));

  let started = false;
  async function start() {
    if (tableId) { render(); return; }
    if (started) { if (net) $('pm-lobby').hidden = false; return; }
    started = true;
    $('pm-loading').hidden = false;
    let n = null;
    try { n = await window.createNet({ ns: 'p', normalize, needPrivate: true }); } catch (e) { n = null; }
    $('pm-loading').hidden = true;
    if (!n || n.error) {
      $('pm-unavailable').hidden = false;
      if (n && n.error) $('pm-unavailable-detail').textContent = 'Connexion au serveur impossible. Vérifie ta connexion Internet puis recharge la page.';
      return;
    }
    net = n; me = n.me;
    $('pm-pseudo').value = myName();
    const code = new URLSearchParams(location.search).get('table');
    showLobby();
    if (code) {
      if (myName()) openTable(code.toUpperCase());
      else { $('pm-code').value = code.toUpperCase(); needPseudo(); }
    }
  }
  if (new URLSearchParams(location.search).get('table') || new URLSearchParams(location.search).get('multi') || (window.Social && Social.wantsTable && Social.wantsTable())) { document.body.classList.add('multi-entry'); setMode('multi'); }

  window.PokerMulti = { get pub() { return pub; }, get hole() { return myHole; }, get net() { return net; }, get me() { return me; }, get tableId() { return tableId; } };
})();
