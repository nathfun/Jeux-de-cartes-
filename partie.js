/* La Dette : l'écran de la partie en cours. Une fois la partie lancée, on y reste jusqu'au bout
   (journée → quota → boutique du receleur → palier suivant… jusqu'au passage de la mafia). */
(function () {
  'use strict';
  const R = window.CasinoRules;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => Math.round(v || 0).toLocaleString('fr-FR');
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const wantStart = /[?&]start=1\b/.test(location.search);
  const QS = location.search.replace(/([?&])start=1(&|$)/, (m, a, b) => (b ? a : '')).replace(/^&/, '?');
  if (wantStart) history.replaceState(null, '', location.pathname + QS);
  Casino.setLearn(false);

  const GAME_PATH = { boosters: 'boosters/index.html', wheel: 'roue/index.html', blackjack: 'blackjack/index.html', roulette: 'roulette/index.html', slots: 'slots/index.html', gold: 'gold/index.html', crash: 'crash/index.html', plinko: 'plinko/index.html', trader: 'trader/index.html', mines: 'mines/index.html', loto: 'loto/index.html' };
  const NAME = (g) => (Casino.GAMES[g] || { boosters: 'Boosters', horses: 'Course de chevaux', slots: 'Casino Royal' }[g] || g);

  // ---------- Histoire ----------
  const STORY = [
    ['🌧️', 'Une nuit, à Marseille…', 'Ton frère a disparu en laissant une ardoise énorme chez le parrain du quartier. Et le parrain veut son argent.'],
    ['🕴️', 'Le parrain te reçoit', '« Ton frère me doit beaucoup. Tu vas rembourser, une journée à la fois. Chaque soir, mes hommes passent compter la caisse. »'],
    ['💼', 'Les règles du jeu', 'Chaque journée dure 10 minutes avec un quota à atteindre. Tu prends l\'argent de ta caisse, tu le poses sur les tables du Lounge… et tu le fais fructifier.'],
    ['🛍️', 'Entre deux journées', 'Le surplus sert à acheter des objets chez le receleur. Chaque palier débloque de nouveaux jeux, mais les quotas grimpent vite.'],
    ['🔫', 'Et si tu échoues…', 'Quota raté ou caisse vide : la mafia passe, la partie s\'arrête. Tu gardes les jetons et l\'XP gagnés. Jusqu\'où iras-tu ?'],
  ];
  const PALIER_TEXT = [
    '',
    'Premier soir. Le parrain t\'a confié sa mise de départ : ramène-lui le quota avant la fermeture.',
    'Le parrain est satisfait… pour l\'instant. Il double presque la mise : ses hommes surveillent la salle.',
    'On commence à parler de toi au Lounge. Le receleur a reçu de la nouvelle marchandise.',
    'Un rival du parrain t\'observe depuis le bar. Pas le droit à l\'erreur.',
    'Les grosses tables s\'ouvrent. Les mises montent… la pression aussi.',
    'Le parrain t\'invite à sa table. Il veut voir si tu as les nerfs solides.',
    'La police rôde autour du casino. Il faut faire vite et gros.',
    'Les chevaux arrivent à l\'hippodrome du parrain. Une nouvelle façon de rembourser.',
    'Ton nom circule dans toute la ville. Les quotas deviennent démesurés.',
    'Dixième soir. Rares sont ceux qui sont allés aussi loin. Le parrain commence à te respecter.',
  ];
  const palierText = (n) => PALIER_TEXT[n] || ['La dette n\'en finit pas. Le parrain en veut toujours plus.', 'Les hommes du parrain ne te quittent plus des yeux.', 'Encore une journée, encore un quota. Tiens bon.'][n % 3];
  const storySeen = () => { try { return localStorage.getItem('dette-story') === '1'; } catch (e) { return false; } };

  function full(cls) { const o = el('div', 'full ' + (cls || '')); const b = el('div', 'box'); o.appendChild(b); document.body.appendChild(o); return [o, b]; }
  function showStory() {
    return new Promise((done) => {
      let k = 0;
      const [ov, box] = full();
      const draw = () => {
        const [ic, t, x] = STORY[k];
        box.innerHTML = '';
        const dots = el('div', 'dots'); STORY.forEach((_, i) => dots.appendChild(el('i', i === k ? 'on' : '')));
        const b = el('button', 'cta', k < STORY.length - 1 ? 'Suite ›' : 'J\'accepte la dette');
        b.type = 'button';
        b.onclick = () => { if (window.Sfx) Sfx.chips(); if (k < STORY.length - 1) { k++; draw(); } else { ov.remove(); try { localStorage.setItem('dette-story', '1'); } catch (e) { /* ignore */ } done(); } };
        box.append(el('div', 'icons', ic), el('h3', '', t), el('p', '', x), dots, b);
      };
      draw();
    });
  }
  /** Annonce d'un palier : « PALIER 2 », la petite histoire, le quota et les nouveautés, puis « Commencer ». */
  function showPalier(n, quota, cash) {
    return new Promise((done) => {
      const [ov, box] = full();
      const news = Object.keys(R.RUN.UNLOCK).filter((g) => R.RUN.UNLOCK[g] === n && (n > 1));
      const facts = el('div', 'facts');
      facts.append(el('span', '', '🎯 Quota : ' + fmt(quota) + ' €'), el('span', '', '⏱ 10 min'), el('span', '', '💼 Caisse : ' + fmt(cash) + ' €'));
      if (news.length) facts.appendChild(el('span', '', '🔓 ' + news.map(NAME).join(', ')));
      const b = el('button', 'cta pulse', '▶ Commencer la journée'); b.type = 'button';
      b.onclick = () => { ov.remove(); done(); };
      box.append(el('div', 'icons', '🕴️'), el('div', 'kicker', 'LA DETTE'), el('div', 'pal', 'PALIER ' + n), el('p', '', palierText(n)), facts, b);
      if (window.Sfx) Sfx.chips();
    });
  }
  function showMafia(run) {
    if (document.querySelector('.full.mafia')) return;
    const why = { quota: 'Tu n\'as pas atteint le quota de la journée.', banqueroute: 'Ta caisse est vide : banqueroute.', abandon: 'Tu as jeté l\'éponge.' }[run.why] || '';
    const rw = run.reward || { jetons: 0, xp: 0 };
    const [, box] = full('mafia');
    const facts = el('div', 'facts'); facts.append(el('span', '', '🪙 +' + fmt(rw.jetons) + ' jetons'), el('span', '', '⭐ +' + fmt(rw.xp) + ' XP'));
    const done = run.done !== undefined ? run.done : Math.max(0, (run.reached || run.palier) - 1);
    const sum = (done ? 'Tu as remboursé ' + done + ' palier' + (done > 1 ? 's' : '') + '.' : 'Tu es tombé dès le premier palier.') + ' Meilleur palier : ' + (Casino.profile.bestPalier || 0) + '.';
    const b = el('button', 'cta', 'Retour au lobby'); b.type = 'button';
    b.onclick = async () => { b.disabled = true; await Casino.runCall('run.seen'); location.replace('index.html' + QS); };
    box.append(el('div', 'icons', run.why === 'abandon' ? '🏳️' : '🕴️🕴️🕴️'), el('h3', '', run.why === 'abandon' ? 'Fin de la partie' : 'La mafia est passée…'), el('p', '', why), el('p', '', sum), facts, b);
    if (run.why !== 'abandon' && window.Sfx && Sfx.lose) Sfx.lose();
  }

  // ---------- Actions ----------
  let busy = false;
  async function op(name, data) {
    if (busy) return null; busy = true;
    const r = await Casino.runCall(name, data);
    busy = false;
    if (r && r.error) Casino.toast('La Dette', r.error, '🕴️');
    key = ''; render();
    return r;
  }
  async function startRun() {
    if (!storySeen()) await showStory();
    const cash = Casino.isVip() ? R.RUN.START_CASH_VIP : R.RUN.START_CASH;
    await showPalier(1, R.quotaOf(1), cash);
    await op('run.start');
  }

  // ---------- Affichage ----------
  let key = '', ticking = false, starting = false;
  function render() {
    const P = Casino.profile, r = P.run;
    $('loading').hidden = true;
    if (!r || (r.status === 'over' && r.seen)) {
      if (wantStart && !starting) { starting = true; startRun().finally(() => { starting = false; }); return; }
      if (!starting) location.replace('index.html' + QS);
      return;
    }
    if (r.status === 'over') { ['day', 'day-card', 'games', 'shop-card', 'abandon'].forEach((id) => { $(id).hidden = true; }); showMafia(r); return; }
    const k = JSON.stringify([r.status, r.palier, Math.floor(r.cash), r.offer, r.items, Object.keys(P.sessions || {}).map((g) => g + Math.floor(P.sessions[g].stack))]);
    if (k === key) { tick(); return; }
    key = k;
    const playing = r.status === 'playing';
    $('day').hidden = !playing; $('day-card').hidden = !playing; $('games').hidden = !playing;
    $('shop-card').hidden = playing; $('abandon').hidden = false;
    $('abandon').textContent = playing ? 'Abandonner la partie' : 'Encaisser et arrêter là';
    if (playing) drawDay(P, r); else drawShop(P, r);
    tick();
  }
  function drawDay(P, r) {
    const tot = R.runTotal(P), ok = tot >= r.quota;
    $('chip').textContent = 'Palier ' + r.palier;
    $('cash').textContent = fmt(r.cash) + ' €';
    const bar = $('qbar'); bar.classList.toggle('ok', ok);
    bar.firstChild.style.width = Math.min(100, tot / r.quota * 100) + '%';
    bar.lastChild.textContent = fmt(tot) + ' € / ' + fmt(r.quota) + ' €' + (ok ? ' ✔ quota atteint' : ' · encore ' + fmt(r.quota - tot) + ' €');
    const card = $('day-card'); card.innerHTML = '';
    card.appendChild(el('h2', '', ok ? '✅ Quota atteint !' : '🎯 Atteins le quota'));
    card.appendChild(el('p', 'sub', ok
      ? 'Tu peux clôturer le palier maintenant… ou continuer à jouer pour gonfler ta caisse (le surplus rapporte des jetons et sert chez le receleur). Attention : la journée se clôture toute seule à la fin du chrono.'
      : 'Choisis un jeu ci-dessous et apporte de l\'argent de ta caisse. Mises de ' + R.gameMin(P, 'blackjack') + ' à ' + fmt(R.maxBet(P, Date.now())) + ' € à ce palier.'));
    const ses = P.sessions || {};
    if (Object.keys(ses).length) {
      const tb = el('div', 'tables');
      Object.keys(ses).forEach((g) => { const a = el('a', '', '⏸ ' + NAME(g) + ' : ' + fmt(ses[g].stack) + ' €'); a.href = GAME_PATH[g] || '#'; tb.appendChild(a); });
      card.appendChild(tb);
    }
    const own = Object.keys(r.items || {}).filter((x) => R.runItem(x));
    if (own.length) card.appendChild(el('p', 'owned', 'Dans ta poche : ' + own.map((x) => R.runItem(x).icon + ' ' + R.runItem(x).name).join(', ')));
    const b = el('button', 'cta' + (ok ? ' pulse' : ''), ok ? '🔒 Clôturer le palier ' + r.palier : '🔒 Fermer la journée…'); b.type = 'button';
    b.style.marginTop = '.8rem';
    if (!ok) { b.style.background = '#2a2015'; b.style.color = '#b8a77e'; b.style.boxShadow = 'none'; }
    b.onclick = async () => {
      const go = ok || await Casino.confirm({ icon: '🔫', title: 'Fermer la journée sans le quota ?', text: 'Il te manque ' + fmt(r.quota - tot) + ' €. Si tu fermes maintenant, la mafia passe et la partie est terminée.', ok: 'Fermer quand même' });
      if (go) op('run.end');
    };
    card.appendChild(b);
    // vignettes : débloquées selon le palier (les jeux ouverts d'abord), argent resté sur les tables
    const grid = $('games');
    Array.from(grid.querySelectorAll('a.game[data-game]')).sort((x, y) => (R.RUN.UNLOCK[x.dataset.game] || 99) - (R.RUN.UNLOCK[y.dataset.game] || 99)).forEach((a) => grid.appendChild(a));
    document.querySelectorAll('#games a.game[data-game]').forEach((a) => {
      const g = a.dataset.game, need = R.RUN.UNLOCK[g], locked = !(need <= r.palier);
      a.classList.toggle('locked', locked);
      let lb = a.querySelector('.lock-badge');
      if (locked) { if (!lb) { lb = el('span', 'lock-badge'); a.appendChild(lb); } lb.textContent = '🔒 Palier ' + need; } else if (lb) lb.remove();
      const live = ses[g]; a.classList.toggle('live', !!live);
      let bd = a.querySelector('.live-badge');
      if (live) { if (!bd) { bd = el('span', 'live-badge'); a.prepend(bd); } bd.textContent = '⏸ ' + fmt(live.stack) + ' € sur la table · Reprendre ›'; } else if (bd) bd.remove();
    });
  }
  function drawShop(P, r) {
    const card = $('shop-card'); card.innerHTML = '';
    const next = r.palier + 1, nq = Math.round(R.quotaOf(next) * (r.items && r.items.pret ? 1.15 : 1));
    const head = el('div', 'done-head');
    head.append(el('div', 'big', '✅'), el('h2', '', 'Palier ' + r.palier + ' remboursé !'), el('p', 'sub', 'Les hommes du parrain ont compté la caisse : le compte est bon. Le receleur t\'attend dans l\'arrière-salle.'));
    card.appendChild(head);
    const facts = el('div', 'tables');
    facts.append(el('a', '', '💼 Caisse : ' + fmt(r.cash) + ' €'), el('a', '', '🎯 Prochain quota : ' + fmt(nq) + ' €'));
    card.appendChild(facts);
    card.appendChild(el('h2', '', '🛍️ Le receleur'));
    const shop = el('div', 'shop');
    (r.offer || []).forEach((id) => {
      const it = R.runItem(id); if (!it) return;
      const price = R.itemPrice(it, r.palier);
      const c = el('div', 'item');
      c.append(el('span', 'ic', it.icon), el('b', '', it.name), el('p', '', it.text));
      const b = el('button', '', id === 'pret' ? 'Accepter le prêt' : 'Acheter · ' + fmt(price) + ' €'); b.type = 'button';
      b.disabled = r.cash < price;
      b.onclick = async () => {
        if (!(await Casino.confirm({ icon: it.icon, title: (id === 'pret' ? 'Accepter « ' : 'Acheter « ') + it.name + ' » ?', text: it.text, price, from: r.cash, unit: '€', fromLabel: 'Ta caisse', ok: id === 'pret' ? 'Accepter' : 'Acheter' }))) return;
        const res = await op('run.buy', { id });
        if (res && !res.error) Casino.toast('Receleur', it.name + ' : c\'est dans ta poche.', it.icon, 'gold');
      };
      c.appendChild(b); shop.appendChild(c);
    });
    if (!shop.children.length) shop.appendChild(el('p', 'owned', 'Le receleur n\'a plus rien pour toi.'));
    card.appendChild(shop);
    const own = Object.keys(r.items || {}).filter((x) => R.runItem(x));
    if (own.length) card.appendChild(el('p', 'owned', 'Dans ta poche : ' + own.map((x) => R.runItem(x).icon + ' ' + R.runItem(x).name).join(', ')));
    const b = el('button', 'cta pulse', '▶ Passer au palier ' + next); b.type = 'button'; b.style.marginTop = '.8rem';
    b.onclick = async () => { await showPalier(next, nq, r.cash); op('run.next'); };
    card.appendChild(b);
  }
  function tick() {
    const r = Casino.profile.run;
    if (!r || r.status !== 'playing') return;
    const left = r.dayEnd - Date.now(), t = Math.max(0, Math.ceil(left / 1000));
    $('clock').textContent = '⏱ ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    $('clock').classList.toggle('late', left < 60000);
    if (left <= 0 && !ticking) { ticking = true; Casino.runTick().finally(() => { ticking = false; key = ''; render(); }); }
  }
  $('abandon').addEventListener('click', async () => {
    const r = Casino.profile.run; if (!r) return;
    const shop = r.status === 'shop';
    if (await Casino.confirm({ icon: '🏳️', title: shop ? 'Arrêter la partie ?' : 'Abandonner la partie ?', text: shop ? 'Tu touches les jetons des ' + r.palier + ' paliers réussis. La partie se termine.' : 'La mafia passe tout de suite. Tu gardes les jetons des paliers déjà réussis.', ok: shop ? 'Arrêter' : 'Abandonner' })) op('run.abandon');
  });
  document.getElementById('games').addEventListener('click', (e) => {
    const a = e.target.closest('a.game.locked'); if (!a) return;
    e.preventDefault();
    const need = R.RUN.UNLOCK[a.dataset.game];
    Casino.toast('La Dette', need ? 'Ce jeu se débloque au palier ' + need + '.' : 'Ce jeu arrive bientôt.', '🔒');
  });
  setInterval(tick, 500);
  Casino.onChange(() => render());
  // avec le serveur : on attend l'état officiel de la partie avant de décider quoi afficher
  (async () => {
    if (Casino.server) { try { await Casino.sync(); } catch (e) { /* ignore */ } }
    render();
  })();
  window.Partie = { render };
})();
