/* Le Parrain : l'écran de la partie en cours. Une fois la partie lancée, on y reste jusqu'au bout
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

  const GAME_PATH = { hilo: 'plusmoins/index.html', casse: 'casse/index.html', des: 'des/index.html', horses: 'courses/index.html', heist: 'heist/index.html', boosters: 'boosters/index.html', wheel: 'roue/index.html', blackjack: 'blackjack/index.html', roulette: 'roulette/index.html', slots: 'slots/index.html', gold: 'gold/index.html', crash: 'crash/index.html', plinko: 'plinko/index.html', trader: 'trader/index.html', mines: 'mines/index.html', loto: 'loto/index.html' };
  const NAME = (g) => (Casino.GAMES[g] || { boosters: 'Boosters', horses: 'Course de chevaux', slots: 'Casino Royal' }[g] || g);

  // ---------- Histoire ----------
  // scènes de la cinématique : décor (classe CSS), emojis, titre, texte
  const STORY = [
    { bg: 'rain', art: '🌧️🏙️', t: 'Marseille, 2 h du matin.', x: 'La pluie tombe sur le Vieux-Port. Ton frère a disparu… en laissant une ardoise énorme chez le parrain du quartier.' },
    { bg: 'smoke', art: '🕴️', t: 'Le parrain te reçoit.', x: '« Ton frère me doit beaucoup. Toi, tu vas me rembourser. Une journée à la fois. »' },
    { bg: 'casino', art: '🎰🃏🎲', t: 'Le Lucky Lounge.', x: 'Il te confie une caisse. Chaque journée dure 10 minutes : fais-la fructifier aux tables et atteins le quota du soir.' },
    { bg: 'deal', art: '🤝💼', t: 'Le marché.', x: 'Chaque palier réussi : une prime du parrain, des objets chez le receleur et de nouveaux jeux. Mais les quotas montent.' },
    { bg: 'blood', art: '🕴️🔪', t: 'Pas de seconde chance.', x: 'Quota raté ou caisse vide : la mafia passe, et la partie s\'arrête. Tu gardes les jetons gagnés. Jusqu\'où iras-tu ?' },
  ];
  const PALIER_TEXT = [
    '',
    'Premier soir. Le parrain t\'a confié sa mise de départ : ramène-lui le quota avant la fermeture.',
    'Le parrain est satisfait… pour l\'instant. De nouvelles tables s\'ouvrent à toi : Le Casse, Plinko, boosters et la Ruée vers l\'Or.',
    'On commence à parler de toi au Lounge. L\'hippodrome du parrain, le Loto et la table de 421 t\'ouvrent leurs portes.',
    'Un rival du parrain t\'observe depuis le bar. La Bourse Flash est à toi.',
    'Le parrain t\'ouvre son coffre-fort : la machine « Le Braquage » t\'attend. Les mises montent… la pression aussi.',
    'Le parrain t\'invite à sa table. Il veut voir si tu as les nerfs solides.',
    'La police rôde autour du casino. Il faut faire vite et gros.',
    'Ton nom circule dans toute la ville. Les quotas grimpent.',
    'Ton nom circule dans toute la ville. Les quotas deviennent démesurés.',
    'Dixième soir. Rares sont ceux qui sont allés aussi loin. Le parrain commence à te respecter.',
  ];
  const palierText = (n) => PALIER_TEXT[n] || ['La dette n\'en finit pas. Le parrain en veut toujours plus.', 'Les hommes du parrain ne te quittent plus des yeux.', 'Encore une journée, encore un quota. Tiens bon.'][n % 3];
  const storySeen = () => { try { return localStorage.getItem('dette-story') === '1'; } catch (e) { return false; } };

  function full(cls) { const o = el('div', 'full ' + (cls || '')); const b = el('div', 'box'); o.appendChild(b); document.body.appendChild(o); return [o, b]; }
  /** Cinématique de lancement : scènes plein écran, texte tapé à la machine, bouton « Passer ». */
  function showStory(short) {
    return new Promise((done) => {
      const scenes = short ? [STORY[1], STORY[4]] : STORY;
      let k = 0, timer = null, typing = null, amb = null;
      const stopAmb = () => { if (amb) { amb.stop(); amb = null; } };
      const ov = el('div', 'cine'); ov.setAttribute('role', 'dialog');
      const stage = el('div', 'cine-stage'), bars = [el('i', 'cine-bar top'), el('i', 'cine-bar bot')];
      const skip = el('button', 'cine-skip', 'Passer ⏭'); skip.type = 'button';
      const tap = el('div', 'cine-tap', 'Touche pour continuer');
      ov.append(stage, bars[0], bars[1], skip, tap);
      document.body.appendChild(ov);
      const finish = () => { clearTimeout(timer); clearInterval(typing); stopAmb(); ov.classList.add('out'); try { localStorage.setItem('dette-story', '1'); } catch (e) { /* ignore */ } setTimeout(() => { ov.remove(); done(); }, 500); };
      const draw = () => {
        const sc = scenes[k];
        clearInterval(typing); clearTimeout(timer);
        stage.className = 'cine-stage ' + sc.bg; stage.innerHTML = '';
        const fx = el('div', 'cine-fx'), art = el('div', 'cine-art', sc.art), t = el('h2', 'cine-t', sc.t), x = el('p', 'cine-x', '');
        const dots = el('div', 'cine-dots'); scenes.forEach((_, i) => dots.appendChild(el('i', i === k ? 'on' : i < k ? 'done' : '')));
        stage.append(fx, art, t, x, dots);
        if (sc.bg === 'rain') for (let i = 0; i < 40; i++) { const d = el('i'); d.style.left = Math.random() * 100 + '%'; d.style.animationDelay = (-Math.random() * 1.2) + 's'; d.style.animationDuration = (0.6 + Math.random() * 0.6) + 's'; fx.appendChild(d); }
        if (sc.bg === 'casino') for (let i = 0; i < 14; i++) { const d = el('b', '', ['🪙', '💵', '🎲', '♠️', '♥️'][i % 5]); d.style.left = Math.random() * 100 + '%'; d.style.animationDelay = (-Math.random() * 4) + 's'; fx.appendChild(d); }
        stopAmb(); if (window.Sfx && Sfx.ambience) amb = Sfx.ambience(sc.bg);
        let i = 0;
        typing = setInterval(() => { i++; x.textContent = sc.x.slice(0, i); if (window.Sfx && Sfx.type && i % 2 === 0 && sc.x[i - 1] !== ' ') Sfx.type(); if (i >= sc.x.length) { clearInterval(typing); timer = setTimeout(next, 2600); } }, 24);
      };
      const next = () => { if (k < scenes.length - 1) { k++; draw(); } else finish(); };
      ov.addEventListener('click', (e) => {
        if (e.target === skip) { finish(); return; }
        const x = stage.querySelector('.cine-x'), sc = scenes[k];
        if (x && x.textContent.length < sc.x.length) { clearInterval(typing); x.textContent = sc.x; clearTimeout(timer); timer = setTimeout(next, 2600); } else next();
      });
      draw();
    });
  }
  /** Annonce d'un palier : « PALIER 2 », la petite histoire, le quota et les nouveautés, puis « Commencer ». */
  function showPalier(n, quota, cash) {
    return new Promise((done) => {
      const [ov, box] = full('palier');
      const news = Object.keys(R.RUN.UNLOCK).filter((g) => R.RUN.UNLOCK[g] === n && (n > 1));
      const facts = el('div', 'facts');
      const q = el('span', '', '🎯 Quota : 0 €');
      facts.append(q, el('span', '', '⏱ 10 min'), el('span', '', '💼 Caisse : ' + fmt(cash) + ' €'));
      const t0 = performance.now();
      const up = (t) => { const f = Math.min(1, (t - t0 - 600) / 900); if (f > 0) q.textContent = '🎯 Quota : ' + fmt(quota * (1 - Math.pow(1 - f, 3))) + ' €'; if (f < 1 && q.isConnected) requestAnimationFrame(up); };
      requestAnimationFrame(up);
      if (news.length) facts.appendChild(el('span', '', '🔓 ' + news.map(NAME).join(', ')));
      const b = el('button', 'cta pulse', '▶ Commencer la journée'); b.type = 'button';
      b.onclick = () => { ov.remove(); done(); };
      box.append(el('div', 'icons', '🕴️'), el('div', 'kicker', 'LE PARRAIN · JOUR ' + n), el('div', 'pal', 'PALIER ' + n), el('p', '', palierText(n)), facts, b);
      if (window.Sfx) { if (Sfx.sting) setTimeout(() => Sfx.sting(), 200); else Sfx.chips(); }
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
    if (r && r.error) Casino.toast('Le Parrain', r.error, '🕴️');
    key = ''; render();
    return r;
  }
  async function startRun() {
    await showStory(storySeen());
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
      // débloqué mais trop cher pour ce qu'il reste dans la caisse (jeux en cours compris)
      const entry = R.gameEntry(P, g), poor = !locked && entry > R.runTotal(P);
      a.classList.toggle('locked', locked); a.classList.toggle('poor', poor); a.dataset.entry = entry;
      let lb = a.querySelector('.lock-badge');
      if (locked || poor) { if (!lb) { lb = el('span', 'lock-badge'); a.appendChild(lb); } lb.textContent = locked ? '🔒 Palier ' + need : '💸 ' + fmt(entry) + ' € min.'; lb.classList.toggle('poor-badge', poor); } else if (lb) lb.remove();
      void ses;
    });
  }
  function drawShop(P, r) {
    const card = $('shop-card'); card.innerHTML = '';
    const next = r.palier + 1, nq = R.nextQuota(r);
    const head = el('div', 'done-head');
    head.append(el('div', 'big', '✅'), el('h2', '', 'Palier ' + r.palier + ' remboursé !'), el('p', 'sub', 'Les hommes du parrain ont compté la caisse : le compte est bon.' + (r.prime ? ' Il te verse une prime de ' + fmt(r.prime) + ' €.' : '') + ' Le receleur t\'attend dans l\'arrière-salle.'));
    card.appendChild(head);
    // palier réussi : fanfare et confettis (une seule fois par palier)
    const fk = 'fanfare-' + r.id + '-' + r.palier;
    let played = false; try { played = sessionStorage.getItem(fk) === '1'; sessionStorage.setItem(fk, '1'); } catch (e) { /* ignore */ }
    if (!played) {
      if (window.Sfx && Sfx.fanfare) Sfx.fanfare();
      const cf = el('div', 'confetti'); const cols = ['#facc15', '#f59e0b', '#22c55e', '#38bdf8', '#f472b6', '#fff'];
      for (let i = 0; i < 70; i++) { const c = el('i'); c.style.left = Math.random() * 100 + '%'; c.style.background = cols[i % cols.length]; c.style.animationDelay = Math.random() * 0.6 + 's'; c.style.animationDuration = 1.8 + Math.random() * 1.6 + 's'; c.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px'); cf.appendChild(c); }
      document.body.appendChild(cf); setTimeout(() => cf.remove(), 4200);
    }
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
    const pa = e.target.closest('a.game.poor');
    if (pa) { e.preventDefault(); Casino.toast('Pas assez dans ta caisse', 'Il te faut au moins ' + fmt(pa.dataset.entry) + ' € pour jouer ici. Essaie un jeu à plus petite mise.', '💸'); return; }
    const a = e.target.closest('a.game.locked'); if (!a) return;
    e.preventDefault();
    const need = R.RUN.UNLOCK[a.dataset.game];
    Casino.toast('Le Parrain', need ? 'Ce jeu se débloque au palier ' + need + '.' : 'Ce jeu arrive bientôt.', '🔒');
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
