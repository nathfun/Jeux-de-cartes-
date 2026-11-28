/* Boosters du Parrain (dès le palier 2) : on ouvre des paquets de 10 cartes, revendues aussitôt dans la caisse. */
(function () {
  'use strict';
  const R = window.CasinoRules;
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const S = { mode: null, stack: 0, series: null, busy: false, hist: [] };
  const RANK = { commun: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, ultime: 5 };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  // ---------- Séries ----------
  function renderSeries() {
    const box = $('series'); box.innerHTML = '';
    R.SERIES.forEach((se) => {
      const open = S.mode === 'train' || Casino.seriesOpen(se.id);
      const n = R.COLLECTION.filter((c) => c.series === se.id).length;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'serie' + (S.series === se.id ? ' on' : ''); b.style.setProperty('--sc', se.color);
      b.innerHTML = '<span class="ic"></span><b></b><small></small>';
      b.querySelector('.ic').textContent = se.icon; b.querySelector('b').textContent = se.name;
      b.querySelector('small').textContent = open ? n + ' cartes à collectionner' : '🔒 Palier ' + se.palier;
      b.disabled = !open;
      b.onclick = () => { S.series = se.id; renderSeries(); ui(); };
      box.appendChild(b);
    });
    const odds = $('odds'); odds.innerHTML = '';
    const pc = (w, r) => { const t = Object.values(w).reduce((a, x) => a + x, 0); return ((w[r] || 0) / t * 100); };
    ['rare', 'epique', 'legendaire', 'mythique', 'ultime'].forEach((r) => {
      const sp = document.createElement('span'); sp.style.borderColor = R.RARITY[r].color; sp.style.color = R.RARITY[r].color;
      const p = pc(R.PACK.HIGH, r);
      sp.textContent = R.RARITY[r].name + ' ' + (p >= 1 ? Math.round(p) : p.toFixed(1).replace('.', ',')) + ' %';
      odds.appendChild(sp);
    });
    const g = document.createElement('span'); g.style.borderColor = '#fde047'; g.style.color = '#fde047'; g.textContent = 'God Pack 1/' + R.PACK.GOD; odds.appendChild(g);
  }
  const price = () => (S.mode === 'train' ? 100 : Casino.packPrice());
  function ui() {
    $('stack').textContent = fmt(S.stack) + ' €';
    $('open').textContent = S.series ? '🃏 Ouvrir un paquet · ' + fmt(price()) + ' €' : 'Choisis une série';
    $('open').disabled = S.busy || !S.series || S.stack < price();
    $('end-btn').disabled = S.busy;
    $('wallet').textContent = fmt(Casino.wallet());
    const h = $('hist'); if (!S.hist.length) return;
    h.innerHTML = '';
    S.hist.slice(-8).reverse().forEach((x) => { const li = document.createElement('li'); const d = x.total - x.price; li.innerHTML = '<span></span><b></b>'; li.firstChild.textContent = (x.god ? '🌟 God Pack · ' : '') + x.best; li.lastChild.textContent = (d >= 0 ? '+' : '−') + fmt(Math.abs(d)) + ' €'; li.lastChild.className = d >= 0 ? 'up' : 'down'; h.appendChild(li); });
  }

  // ---------- Ouverture ----------
  async function open() {
    if (S.busy || !S.series) return;
    S.busy = true; ui();
    let r;
    if (S.mode === 'real') {
      Casino.hold();
      r = await Casino.openPack(S.series);
      if (!r || r.error) { Casino.release(); S.busy = false; ui(); Casino.toast('Boosters', (r && r.error) || 'Impossible d\'ouvrir le paquet.', '⚠️'); return; }
      S.stack = r.stack;
    } else {
      // apprentissage : paquet à 100 € (toutes les séries ouvertes), rien n'est gardé
      const fake = { stack: 1e15 }, P = { run: { palier: 99 }, totals: {}, col: {} };
      r = R.openPack(P, fake, S.series, (n) => Math.floor(Math.random() * n));
      if (!r || r.error) { S.busy = false; ui(); return; }
      const k = 100 / r.price; r.cards.forEach((c) => { c.value = Math.round(c.value * k * 100) / 100; });
      r.total = Math.round(r.total * k * 100) / 100; r.price = 100;
      if (S.stack < 100) { S.busy = false; ui(); return; }
      S.stack = Math.round((S.stack - 100 + r.total) * 100) / 100;
      const me = (window.Casino && Casino.profile) || {};
      r.cards.forEach((c) => { c.fresh = !((me.dex || {})[c.id] || (me.col || {})[c.id]); });
    }
    const best = r.cards.reduce((m, c) => (RANK[c.rarity] > RANK[m.rarity] ? c : m), r.cards[0]);
    S.hist.push({ price: r.price, total: r.total, god: r.god, best: R.RARITY[best.rarity].name + ' : ' + R.COL_BY_ID[best.id].name });
    await show(r);
    S.busy = false; ui();
    if (Casino.holding) Casino.release();
  }

  function cardFace(c, big) {
    const el = document.createElement('div'); el.className = 'bo-card r-' + c.rarity + (big ? ' bp-big' : ''); el.style.setProperty('--rc', R.RARITY[c.rarity].color);
    const inn = document.createElement('div'); inn.className = 'bo-in';
    const back = document.createElement('div'); back.className = 'bo-face bo-back'; back.innerHTML = '<span class="bp-logo">🍀</span><small>LUCKY LOUNGE</small>';
    const front = document.createElement('div'); front.className = 'bo-face bo-front col';
    front.appendChild(Casino.cardEl(c.id, { size: big ? 'big' : '', count: c.count > 1 ? c.count : 0, fact: big }));
    inn.append(back, front); el.appendChild(inn);
    if (c.fresh) { const nw = document.createElement('span'); nw.className = 'bo-new'; nw.textContent = 'NEW'; el.appendChild(nw); }
    return el;
  }
  function burst(layer, n, emojis, spread) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i'); p.className = 'bp-part'; p.textContent = emojis[i % emojis.length];
      const ang = Math.random() * Math.PI * 2, d = spread * (0.45 + Math.random() * 0.75);
      p.style.setProperty('--dx', Math.cos(ang) * d + 'px'); p.style.setProperty('--dy', Math.sin(ang) * d + 'px');
      p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg'); p.style.animationDelay = (Math.random() * 0.15) + 's';
      p.style.fontSize = (14 + Math.random() * 18) + 'px';
      layer.appendChild(p); setTimeout(() => p.remove(), 1900);
    }
  }
  /** Le paquet arrive, on le déchire, puis les 10 cartes une à une (le suspense monte avec la rareté). */
  function show(r) {
    return new Promise((done) => {
      const cards = r.cards, se = R.SERIES.find((x) => x.id === S.series);
      const o = document.createElement('div'); o.className = 'bp-open';
      const fx = document.createElement('div'); fx.className = 'bp-fx';
      const title = document.createElement('div'); title.className = 'bp-title'; title.textContent = 'Touche le paquet pour l\'ouvrir';
      const stage = document.createElement('div'); stage.className = 'bp-stage';
      const tag = document.createElement('div'); tag.className = 'bp-tag';
      const val = document.createElement('div'); val.className = 'bp-value';
      const bar = document.createElement('div'); bar.className = 'bp-bar';
      const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'icon-btn bp-skip'; skip.textContent = 'Tout révéler ⏭';
      o.append(fx, title, stage, tag, val, bar, skip);
      document.body.appendChild(o);
      const best = cards.reduce((m, c) => Math.max(m, RANK[c.rarity]), 0);
      const pk = document.createElement('div'); pk.className = 'bp-pack' + (best >= 3 || r.god ? ' hot' : '');
      pk.innerHTML = '<div class="bp-flap"></div><div class="bp-body"><span class="bp-clover"></span><b></b><small>BOOSTER · 10 CARTES</small></div><i class="bp-shine"></i>';
      pk.querySelector('.bp-clover').textContent = se.icon; pk.querySelector('b').textContent = se.name.toUpperCase();
      stage.appendChild(pk);
      if (window.Sfx && Sfx.whoosh) Sfx.whoosh();
      let i = 0, busy = true, ended = false, gained = 0;
      setTimeout(() => { busy = false; }, 900);
      const summary = () => {
        ended = true; o.classList.add('summary'); skip.remove(); stage.innerHTML = ''; fx.innerHTML = ''; tag.textContent = ''; tag.className = 'bp-tag'; fx.className = 'bp-fx'; o.classList.remove('dark', 'shake');
        title.textContent = r.god ? '🌟 GOD PACK 🌟' : 'Ton paquet';
        val.innerHTML = '';
        const t = document.createElement('div'); t.className = 'sum-total';
        const d = r.total - r.price;
        t.textContent = 'Revendu ' + fmt(r.total) + ' € (' + (d >= 0 ? '+' : '−') + fmt(Math.abs(d)) + ' € sur le paquet)';
        val.appendChild(t);
        const row = document.createElement('div'); row.className = 'bp-sum';
        cards.forEach((c) => { const f = cardFace(c, false); f.classList.add('flip'); row.appendChild(f); });
        stage.appendChild(row);
        bar.innerHTML = '';
        const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'bo-close'; ok.textContent = 'Continuer';
        ok.onclick = () => { o.remove(); done(); };
        bar.append(ok);
      };
      skip.onclick = (e) => { e.stopPropagation(); if (!ended) summary(); };
      async function tearPack() {
        busy = true; title.textContent = '';
        pk.classList.add('shake'); if (window.Sfx && Sfx.chips) Sfx.chips();
        await wait(550);
        pk.classList.add('torn'); if (window.Sfx && Sfx.tear) Sfx.tear();
        fx.className = 'bp-fx flash'; burst(fx, 18, ['✨', '⭐', '💫'], 160);
        if (r.god) { const g = document.createElement('div'); g.className = 'bp-god'; g.textContent = '🌟 GOD PACK 🌟'; fx.appendChild(g); burst(fx, 60, ['🌟', '💎', '👑', '✨'], 300); if (Casino.vibrate) Casino.vibrate([100, 60, 100, 60, 300]); await wait(1600); }
        await wait(650);
        showCard();
      }
      function showCard() {
        const c = cards[i], el = cardFace(c, true);
        stage.innerHTML = ''; fx.innerHTML = ''; fx.className = 'bp-fx'; tag.textContent = ''; tag.className = 'bp-tag'; val.textContent = '';
        el.classList.add('bp-in'); stage.appendChild(el);
        title.textContent = 'Carte ' + (i + 1) + ' / ' + cards.length + ' · touche pour la retourner';
        if (window.Sfx && Sfx.card) Sfx.card();
        busy = false;
        // une fois retournée, toucher la carte passe à la suivante (le clic remonte jusqu'au fond)
        el.onclick = (e) => { if (el.classList.contains('flip')) return; e.stopPropagation(); if (!busy) reveal(c, el); };
      }
      async function reveal(c, el) {
        busy = true; title.textContent = '';
        const rk = Math.min(RANK[c.rarity], 5);
        const charge = [0, 600, 1100, 1800, 3000, 4200][rk];
        if (rk >= 1) { el.classList.add('charge', 'c' + Math.min(rk, 4)); fx.className = 'bp-fx glow c' + Math.min(rk, 4); }
        if (rk >= 3) o.classList.add('dark');
        if (rk >= 2) { const beats = rk >= 4 ? 6 : rk === 3 ? 3 : 1; for (let k = 0; k < beats; k++) setTimeout(() => { if (window.Sfx && Sfx.heartbeat) Sfx.heartbeat(); }, k * (charge / beats)); }
        if (rk >= 4) { title.textContent = '…'; setTimeout(() => { title.textContent = rk === 5 ? '… l\'impossible arrive …' : '… quelque chose d\'incroyable …'; }, 1200); o.classList.add('shake'); }
        await wait(charge);
        el.classList.remove('charge'); el.classList.add('flip');
        o.classList.remove('shake'); title.textContent = '';
        if (window.Sfx) { if (rk >= 1 && Sfx.reveal) Sfx.reveal(rk >= 4 ? 'mythique' : c.rarity); else if (Sfx.flip) Sfx.flip(); }
        if (rk === 1) { fx.className = 'bp-fx ring c1'; burst(fx, 10, ['💠', '✨'], 140); }
        if (rk === 2) { fx.className = 'bp-fx ring c2'; burst(fx, 22, ['💜', '✨', '🔮', '⭐'], 190); }
        if (rk === 3) { fx.className = 'bp-fx rays c3 flash'; burst(fx, 40, ['🪙', '💰', '⭐', '✨', '👑'], 260); }
        if (rk >= 4) { fx.className = 'bp-fx rays c4 whiteout'; burst(fx, 70, ['💎', '🔥', '🌟', '✨', '💫', '❤️', '🌈'], 330); setTimeout(() => burst(fx, 40, ['💎', '🌟', '✨'], 280), 500); }
        if (rk >= 3 && Casino.vibrate) Casino.vibrate(rk >= 4 ? [120, 50, 120, 50, 300] : [60, 40, 60, 40, 120]);
        if (rk >= 3) { const big = document.createElement('div'); big.className = 'bp-slam c' + rk; big.textContent = rk === 5 ? 'ULTIME !' : rk === 4 ? 'MYTHIQUE !' : 'LÉGENDAIRE !'; fx.appendChild(big); }
        gained += c.value;
        if (c.fresh && window.Sfx && Sfx.sting) setTimeout(() => { if (Sfx.chips) Sfx.chips(); }, 250);
        val.textContent = '+' + fmt(c.value) + ' €  ·  total ' + fmt(gained) + ' €';
        if (c.keep) { tag.textContent = c.isNew ? '✨ NOUVELLE CARTE DANS TA COLLECTION' : 'Ajoutée à ta collection (×' + c.count + ')'; tag.className = 'bp-tag show' + (c.isNew ? '' : ' dup'); }
        await wait(rk >= 3 ? 1300 : 350);
        o.classList.remove('dark');
        title.textContent = i + 1 < cards.length ? 'Touche pour la carte suivante' : 'Touche pour le bilan';
        busy = false;
      }
      o.addEventListener('click', () => {
        if (busy || ended) return;
        if (stage.querySelector('.bp-pack')) { tearPack(); return; }
        const cur = stage.querySelector('.bo-card');
        if (cur && !cur.classList.contains('flip')) return;
        i++;
        if (i < cards.length) showCard(); else summary();
      });
    });
  }

  // ---------- Début et fin ----------
  function startGame(mode, amount) {
    S.mode = mode; S.stack = amount;
    if (window.Casino) Casino.training = mode === 'train';
    const open = R.SERIES.filter((se) => mode === 'train' || Casino.seriesOpen(se.id));
    S.series = open.length ? open[open.length - 1].id : null;
    $('setup').hidden = true; $('game').hidden = false;
    $('mode-badge').textContent = mode === 'real' ? '🕴️ Le Parrain · ta caisse · les cartes épiques et mieux vont dans ta collection' : '🎓 Apprentissage · crédit illimité · rien n\'est gardé';
    $('end-btn').hidden = mode === 'train';
    $('stack-label').textContent = mode === 'train' ? 'Crédit d\'apprentissage' : 'Sur la table';
    renderSeries(); ui();
  }
  async function endSession() {
    if (S.busy) return;
    let msg = '';
    if (S.mode === 'real') {
      const r = await Casino.cashOut('boosters');
      if (r && r.error) { Casino.toast('Boosters', r.error, '⚠️'); return; }
      msg = 'Tu ramènes ' + fmt(r ? r.end : S.stack) + ' € dans ta caisse.';
    }
    S.mode = null; $('game').hidden = true; $('setup').hidden = false;
    renderPicker(msg); ui();
  }
  function renderPicker(msg) {
    Casino.modePicker($('mode-picker'), { game: 'boosters', min: 1, onStart: (mode, amount) => startGame(mode, amount) });
    if (msg) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = msg; $('mode-picker').prepend(p); }
  }
  $('open').addEventListener('click', open);
  $('end-btn').addEventListener('click', endSession);
  renderPicker(); ui();
  Casino.onChange(() => { if (!S.busy) $('wallet').textContent = fmt(Casino.wallet()); });
  window.Boosters = { get state() { return S; }, open };
})();
