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
  const isAdmin = await get('admins/' + me).catch(() => null);
  if (isAdmin !== true) { $('denied').hidden = false; return; }
  $('list-panel').hidden = false;

  let players = [], sortKey = 'updatedAt', sel = null, saveData = null;
  async function load() {
    const [profiles, banks] = await Promise.all([get('profiles').catch(() => null), get('bank').catch(() => null)]);
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
      td(p.avatar + ' ' + p.pseudo); td(String(p.level)); td(fmt(p.wallet) + ' €', 'num');
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

  load();
})();
