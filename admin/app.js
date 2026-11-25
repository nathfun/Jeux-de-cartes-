// Page d'administration : liste des comptes, banque, niveau, objets et succès de chaque joueur.
// Les droits viennent des règles de la base : seul un compte listé dans admins/<uid> peut lire et modifier les autres.
(async function () {
  'use strict';
  const R = window.CasinoRules;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
  const msg = (t, cls) => { $('ed-msg').textContent = t || ''; $('ed-msg').className = 'msg ' + (cls || ''); };
  const f = await Casino.firebase().catch(() => null);
  if (!f) { document.body.insertAdjacentHTML('beforeend', '<p style="padding:1rem">Serveur Firebase injoignable.</p>'); return; }
  const { dbMod: D, db } = f;
  const ref = (p) => D.ref(db, p);
  const get = async (p) => (await D.get(ref(p))).val();
  const me = f.auth.currentUser.uid;
  $('my-uid').textContent = me;
  // Compte du propriétaire du casino : il s'inscrit tout seul comme administrateur à sa première visite
  const OWNER = 'pJ5ScZ8Y3QfdgosmUdve22LmSmt1';
  let isAdmin = await get('admins/' + me).catch(() => null);
  if (isAdmin !== true && me === OWNER) {
    try { await D.set(ref('admins/' + me), true); isAdmin = true; }
    catch (e) { $('denied').insertAdjacentHTML('beforeend', '<p style="color:#f85149">Inscription automatique refusée : recolle database.rules.json dans Firebase (Règles → Publier) puis recharge.</p>'); }
  }
  if (isAdmin !== true) { $('denied').hidden = false; return; }
  $('list-panel').hidden = false;
  $('tools-panel').hidden = false;
  const tmsg = (t, cls) => { $('tools-msg').textContent = t || ''; $('tools-msg').className = 'msg ' + (cls || ''); };
  let banned = {};

  let players = [], sortKey = 'updatedAt', sel = null, saveData = null;
  async function load() {
    const [profiles, banks, bans, lobby] = await Promise.all([get('profiles').catch(() => null), get('bank').catch(() => null), get('banned').catch(() => null), get('lobby').catch(() => null)]);
    banned = bans || {};
    $('lobby-count').textContent = Object.keys(lobby || {}).length + ' partie(s) dans la liste du Multijoueur.';
    const ids = new Set(Object.keys(profiles || {}).concat(Object.keys(banks || {})));
    players = [...ids].map((uid) => {
      const p = (profiles || {})[uid] || {}, b = (banks || {})[uid] || {};
      return { uid, pseudo: p.pseudo || '(sans profil)', avatar: p.avatar || '🎩', level: p.level || 1, xp: p.xp || 0, wallet: typeof b.wallet === 'number' ? b.wallet : p.wallet || 0, updatedAt: p.updatedAt || b.at || 0, ses: b.ses || null };
    });
    const total = players.reduce((a, p) => a + p.wallet, 0);
    $('stats').innerHTML = '<span>Comptes : <b>' + players.length + '</b></span><span>Argent total en banque : <b>' + fmt(total) + ' €</b></span><span>Actifs (7 j) : <b>' + players.filter((p) => Date.now() - p.updatedAt < 7 * 864e5).length + '</b></span>';
    draw();
  }
  function draw() {
    const q = $('search').value.trim().toLowerCase();
    const list = players.filter((p) => !q || p.pseudo.toLowerCase().includes(q) || p.uid.toLowerCase().includes(q))
      .sort((a, b) => (sortKey === 'pseudo' ? a.pseudo.localeCompare(b.pseudo) : (b[sortKey] || 0) - (a[sortKey] || 0)));
    const tb = $('rows'); tb.innerHTML = '';
    list.forEach((p) => {
      const tr = document.createElement('tr'); tr.className = 'row' + (sel && sel.uid === p.uid ? ' sel' : '');
      const td = (t, c) => { const x = document.createElement('td'); x.textContent = t; if (c) x.className = c; tr.appendChild(x); };
      td(p.avatar + ' ' + p.pseudo + (banned[p.uid] ? ' ⛔' : '')); td(String(p.level)); td(fmt(p.wallet) + ' €', 'num');
      td(p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('fr-FR') : '–');
      tr.addEventListener('click', () => open(p));
      tb.appendChild(tr);
    });
  }
  document.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => { sortKey = th.dataset.k; draw(); }));
  $('search').addEventListener('input', draw);
  $('reload').addEventListener('click', load);

  async function open(p) {
    sel = p; draw(); msg('');
    $('edit-panel').hidden = false;
    $('ed-title').textContent = p.avatar + ' ' + p.pseudo;
    $('ed-uid').textContent = p.uid;
    $('ed-wallet').value = Math.round(p.wallet);
    $('act-ban').textContent = banned[p.uid] ? '✅ Débloquer' : '⛔ Bloquer';
    $('ed-sessions').textContent = p.ses ? 'Parties réelles en cours : ' + Object.entries(p.ses).map(([g, v]) => g + ' (' + fmt(v) + ' € apportés)').join(', ') : '';
    const sv = await get('saves/' + p.uid).catch(() => null);
    saveData = sv && sv.data ? JSON.parse(sv.data) : null;
    $('save-zone').hidden = !saveData; $('no-save').hidden = !!saveData;
    if (!saveData) return;
    $('ed-pseudo').value = saveData.pseudo || p.pseudo;
    $('ed-level').value = R.levelOf(saveData.xp || 0);
    $('ed-xp').textContent = fmt(saveData.xp || 0) + ' XP';
    const owned = saveData.owned || {};
    const box = $('ed-owned'); box.innerHTML = '';
    Object.keys(R.SHOP).forEach((k) => R.SHOP[k].filter((it) => it.price).forEach((it) => {
      const key = k + ':' + it.id;
      const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.key = key; c.checked = !!owned[key];
      l.append(c, R.SHOP_LABELS[k] + ' · ' + (k === 'avatar' ? it.id + ' ' : '') + it.name); box.appendChild(l);
    }));
    const ach = saveData.achievements || {};
    const ab = $('ed-ach'); ab.innerHTML = '';
    R.ACHIEVEMENTS.forEach((a) => {
      const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.id = a.id; c.checked = !!ach[a.id];
      l.append(c, a.icon + ' ' + a.name); ab.appendChild(l);
    });
  }
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { $('ed-wallet').value = Math.max(0, (Number($('ed-wallet').value) || 0) + Number(b.dataset.add)); }));
  $('own-all').addEventListener('click', () => document.querySelectorAll('#ed-owned input').forEach((c) => { c.checked = true; }));
  $('own-none').addEventListener('click', () => document.querySelectorAll('#ed-owned input').forEach((c) => { c.checked = false; }));
  $('ed-level').addEventListener('input', () => { $('ed-xp').textContent = fmt(R.need(Math.max(1, Number($('ed-level').value) || 1))) + ' XP'; });

  // Banque : écrite dans bank/<uid> (les règles autorisent l'admin, raison « admin »)
  $('save-wallet').addEventListener('click', async () => {
    if (!sel) return;
    const v = Math.max(0, Math.round(Number($('ed-wallet').value) || 0));
    try {
      await D.runTransaction(ref('bank/' + sel.uid), (cur) => {
        const o = cur ? Object.assign({}, cur) : {};
        o.wallet = v; o.why = 'admin'; o.at = D.serverTimestamp(); o.x = 0; delete o.g;
        return o;
      }, { applyLocally: false });
      sel.wallet = v; draw(); msg('Banque mise à jour : ' + fmt(v) + ' €.', 'ok');
    } catch (e) { msg('Refusé : ' + e.message + ' (règles Firebase à jour ?)', 'err'); }
  });

  // Profil : niveau, pseudo, objets, succès dans la sauvegarde du compte (saves/<uid>) et le profil public
  $('save-profile').addEventListener('click', async () => {
    if (!sel || !saveData) return;
    const lvl = Math.max(1, Math.min(99, Number($('ed-level').value) || 1));
    if (R.levelOf(saveData.xp || 0) !== lvl) saveData.xp = R.need(lvl);
    saveData.pseudo = $('ed-pseudo').value.trim().slice(0, 16) || saveData.pseudo;
    const owned = {};
    document.querySelectorAll('#ed-owned input').forEach((c) => { if (c.checked) owned[c.dataset.key] = (saveData.owned || {})[c.dataset.key] || Date.now(); });
    saveData.owned = owned;
    const ach = {};
    document.querySelectorAll('#ed-ach input').forEach((c) => { if (c.checked) ach[c.dataset.id] = (saveData.achievements || {})[c.dataset.id] || Date.now(); });
    saveData.achievements = ach;
    saveData.savedAt = Date.now();
    try {
      await D.set(ref('saves/' + sel.uid), { data: JSON.stringify(saveData), at: saveData.savedAt, adminAt: saveData.savedAt });
      const pub = (await get('profiles/' + sel.uid).catch(() => null)) || {};
      await D.set(ref('profiles/' + sel.uid), Object.assign(pub, { pseudo: saveData.pseudo, xp: saveData.xp, level: lvl, achievements: Object.keys(ach).length, updatedAt: Date.now() }));
      sel.pseudo = saveData.pseudo; sel.level = lvl; draw();
      $('ed-xp').textContent = fmt(saveData.xp) + ' XP';
      msg('Profil enregistré. Le joueur le verra au prochain chargement de l\'app.', 'ok');
    } catch (e) { msg('Refusé : ' + e.message + ' (règles Firebase à jour ?)', 'err'); }
  });

  // ---------- Actions sur un compte ----------
  const sure = (t) => window.confirm(t);
  async function bankSet(uid, fn) {
    await D.get(ref('bank/' + uid)); // remplit le cache : la transaction part de la vraie valeur
    await D.runTransaction(ref('bank/' + uid), (cur) => {
      if (cur === null) return { e: 1 }; // pas de banque : écriture refusée par les règles, rien n'est créé
      const o = Object.assign({}, cur); fn(o); o.why = 'admin'; o.at = D.serverTimestamp(); o.x = 0; delete o.g; return o;
    }, { applyLocally: false });
  }
  async function refresh(text, cls) { await load(); const p = sel && players.find((x) => x.uid === sel.uid); if (p) await open(p); msg(text, cls); }
  const sesTotal = (ses) => Object.values(ses || {}).reduce((a, v) => a + (Number(v) || 0), 0);

  $('act-close').addEventListener('click', async () => {
    if (!sel) return;
    try {
      let back = 0;
      await bankSet(sel.uid, (o) => { back = sesTotal(o.ses); o.wallet = Math.round((o.wallet + back) * 100) / 100; delete o.ses; });
      if (saveData) { saveData.sessions = {}; saveData.wallet = (saveData.wallet || 0) + back; saveData.savedAt = Date.now(); await D.set(ref('saves/' + sel.uid), { data: JSON.stringify(saveData), at: saveData.savedAt, adminAt: saveData.savedAt }); }
      await refresh(back ? fmt(back) + ' € (somme apportée sur ses tables) rendus à la banque du joueur.' : 'Aucune partie en cours.', 'ok');
    } catch (e) { msg('Refusé : ' + e.message, 'err'); }
  });

  $('act-reset').addEventListener('click', async () => {
    if (!sel || !sure('Remettre ' + sel.pseudo + ' à zéro ? Banque à ' + fmt(R.START_WALLET) + ' €, niveau 1, objets et succès retirés. Le pseudo et le compte sont gardés.')) return;
    try {
      const now = Date.now();
      await D.set(ref('bank/' + sel.uid), { wallet: R.START_WALLET, why: 'admin', at: D.serverTimestamp(), x: 0 });
      const fresh = R.fresh(now); fresh.pseudo = sel.pseudo; fresh.avatar = sel.avatar; fresh.savedAt = now;
      await D.set(ref('saves/' + sel.uid), { data: JSON.stringify(fresh), at: now, adminAt: now });
      const pub = (await get('profiles/' + sel.uid).catch(() => null)) || {};
      await D.set(ref('profiles/' + sel.uid), Object.assign(pub, { xp: 0, level: 1, wallet: R.START_WALLET, achievements: 0, updatedAt: now }));
      await refresh('Compte remis à zéro.', 'ok');
    } catch (e) { msg('Refusé : ' + e.message, 'err'); }
  });

  $('act-ban').addEventListener('click', async () => {
    if (!sel) return;
    if (sel.uid === me) { msg('Tu ne peux pas bloquer ton propre compte.', 'err'); return; }
    const on = !banned[sel.uid];
    if (on && !sure('Bloquer ' + sel.pseudo + ' ? Il ne pourra plus jouer avec sa banque ni modifier son profil.')) return;
    try { await D.set(ref('banned/' + sel.uid), on ? Date.now() : null); await refresh(on ? 'Compte bloqué : il ne peut plus jouer avec sa banque.' : 'Compte débloqué.', 'ok'); }
    catch (e) { msg('Refusé : ' + e.message + ' (règles Firebase à jour ?)', 'err'); }
  });

  $('act-del').addEventListener('click', async () => {
    if (!sel) return;
    if (sel.uid === me) { msg('Tu ne peux pas supprimer ton propre compte.', 'err'); return; }
    const block = $('del-block').checked;
    if (!sure('Supprimer définitivement le compte de ' + sel.pseudo + ' (banque, progression, profil) ?' + (block ? '\nIl sera aussi bloqué.' : ''))) return;
    try {
      if (block) await D.set(ref('banned/' + sel.uid), Date.now());
      await Promise.all(['bank/', 'saves/', 'profiles/', 'invites/'].map((p) => D.remove(ref(p + sel.uid))));
      msg('Compte supprimé. Son pseudo reste réservé : pour le libérer, supprime aussi l\'utilisateur dans Firebase → Authentication.', 'ok');
      $('edit-panel').hidden = true; sel = null; await load();
    } catch (e) { msg('Refusé : ' + e.message + ' (règles Firebase à jour ?)', 'err'); }
  });

  // ---------- Outils ----------
  get('announce').then((a) => { if (a && a.text) $('ann-text').value = a.text; }).catch(() => {});
  $('ann-save').addEventListener('click', async () => {
    const t = $('ann-text').value.trim().slice(0, 300);
    if (!t) { tmsg('Écris un message.', 'err'); return; }
    try { await D.set(ref('announce'), { text: t, at: Date.now() }); tmsg('Annonce publiée : les joueurs la voient sur l\'accueil.', 'ok'); } catch (e) { tmsg('Refusé : ' + e.message + ' (règles Firebase à jour ?)', 'err'); }
  });
  $('ann-clear').addEventListener('click', async () => {
    try { await D.remove(ref('announce')); $('ann-text').value = ''; tmsg('Annonce retirée.', 'ok'); } catch (e) { tmsg('Refusé : ' + e.message, 'err'); }
  });
  $('gift-go').addEventListener('click', async () => {
    const v = Math.round(Number($('gift').value) || 0);
    if (!(v > 0)) return;
    const list = players.filter((p) => !banned[p.uid]);
    if (!sure('Créditer ' + fmt(v) + ' € à ' + list.length + ' compte(s) ?')) return;
    $('gift-go').disabled = true;
    let ok = 0;
    for (const p of list) { try { await bankSet(p.uid, (o) => { o.wallet = Math.round(((o.wallet || 0) + v) * 100) / 100; }); ok++; } catch (e) { /* compte suivant */ } }
    $('gift-go').disabled = false;
    tmsg(fmt(v) + ' € crédités à ' + ok + ' compte(s).', 'ok'); load();
  });
  $('lobby-clear').addEventListener('click', async () => {
    try { const l = (await get('lobby')) || {}; await Promise.all(Object.keys(l).map((k) => D.remove(ref('lobby/' + k)))); tmsg('Liste des parties vidée.', 'ok'); load(); }
    catch (e) { tmsg('Refusé : ' + e.message, 'err'); }
  });

  load();
})();
