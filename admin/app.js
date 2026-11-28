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
  $('dash-panel').hidden = !String(window.CASINO_API || '');
  $('status-panel').hidden = !String(window.CASINO_API || '');
  // Avec le serveur du Casino (NAS) : la banque et la progression des joueurs sont sur le serveur, on passe par lui
  const API = String(window.CASINO_API || '').replace(/\/+$/, '');
  async function adm(op, data) {
    const r = await fetch(API + '/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await f.auth.currentUser.getIdToken()) }, body: JSON.stringify({ op, data: data || {} }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'erreur ' + r.status);
    return j;
  }
  if (API) document.querySelector('#list-panel h2').textContent = 'Comptes (serveur du Casino)';
  const tmsg = (t, cls) => { $('tools-msg').textContent = t || ''; $('tools-msg').className = 'msg ' + (cls || ''); };
  let banned = {};

  let players = [], sortKey = 'updatedAt', sel = null, saveData = null;
  async function load() {
    const [profiles, banks, bans, lobby] = await Promise.all([get('profiles').catch(() => null), get('bank').catch(() => null), get('banned').catch(() => null), get('lobby').catch(() => null)]);
    banned = bans || {};
    $('lobby-count').textContent = Object.keys(lobby || {}).length + ' partie(s) dans la liste du Multijoueur.';
    if (API) {
      let r;
      try { r = await adm('list'); } catch (e) { $('stats').textContent = 'Serveur du Casino injoignable : ' + e.message; return; }
      players = r.players.map((p) => ({ uid: p.uid, pseudo: p.pseudo, avatar: p.avatar, level: p.level, xp: p.xp, wallet: p.wallet, onTables: p.onTables, updatedAt: p.updated, vipUntil: p.vipUntil || 0, ses: Object.keys(p.sessions).length ? p.sessions : null, bestPalier: p.bestPalier || 0, runs: p.runs || 0, run: p.run || null, runP: p.run ? p.run.palier : 0, lastRun: p.lastRun || null, mt: p.mt || null, bestGain: p.bestGain || 0 }));
      r.players.forEach((p) => { if (p.banned) banned[p.uid] = banned[p.uid] || true; });
      const total = players.reduce((a, p) => a + p.wallet + (p.mt ? p.mt.amount || 0 : 0), 0);
      const notYet = Object.keys(profiles || {}).filter((u) => !players.some((p) => p.uid === u)).length;
      $('stats').innerHTML = '<span>Comptes : <b>' + players.length + '</b></span><span>Jetons de tous les joueurs : <b>' + fmt(total) + ' 🪙</b></span><span>Actifs (7 j) : <b>' + players.filter((p) => Date.now() - p.updatedAt < 7 * 864e5).length + '</b></span><span>En partie maintenant : <b>' + players.filter((p) => p.run).length + '</b></span>'
        + (notYet ? '<span>Pas encore passés sur le serveur : <b>' + notYet + '</b></span>' : '');
      draw();
      return;
    }
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
      td(p.avatar + ' ' + p.pseudo + (p.vipUntil ? ' 👑' : '') + (banned[p.uid] ? ' ⛔' : '')); td(String(p.level)); td(fmt(p.wallet), 'num'); td(p.bestPalier ? String(p.bestPalier) : '–', 'num');
      td(p.run ? 'Palier ' + p.run.palier + ' · ' + fmt(p.run.caisse) + ' €' + (p.run.status === 'shop' ? ' (boutique)' : '') : '–');
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
    setTimeout(() => $('edit-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    $('ed-title').textContent = p.avatar + ' ' + p.pseudo;
    $('ed-uid').textContent = p.uid;
    $('ed-wallet').value = Math.round(p.wallet);
    $('ed-vip').textContent = !API ? 'Nécessite le serveur.' : p.vipUntil ? 'Membre jusqu\'au ' + new Date(p.vipUntil).toLocaleDateString('fr-FR') : 'Pas membre';
    $('act-ban').textContent = banned[p.uid] ? '✅ Débloquer' : '⛔ Bloquer';
    $('ed-sessions').textContent = p.ses ? 'Argent posé sur les jeux : ' + Object.entries(p.ses).map(([g, v]) => (R.GAMES[g] || g) + ' ' + fmt(v) + ' €').join(', ') : '';
    const run = p.run, lr = p.lastRun;
    $('ed-run').innerHTML = '';
    const line = (t) => { const d = document.createElement('div'); d.textContent = t; $('ed-run').appendChild(d); };
    line(run ? '🕴️ Partie en cours : palier ' + run.palier + (run.status === 'shop' ? ' (chez le receleur)' : '') + ' · caisse ' + fmt(run.caisse) + ' € / quota ' + fmt(run.quota) + ' €' + (run.lives !== undefined && run.lives !== null ? ' · ' + '❤️'.repeat(run.lives) : '') : '🕴️ Pas de partie en cours.');
    line('🏆 Meilleur palier : ' + (p.bestPalier || 0) + ' · ' + fmt(p.runs || 0) + ' partie(s) jouée(s)' + (lr ? ' · dernière : palier ' + lr.palier + ' (' + ({ quota: 'quota raté', banqueroute: 'banqueroute', abandon: 'abandon' }[lr.why] || lr.why || '') + ', +' + fmt(lr.jetons) + ' jetons)' : ''));
    line('🪙 Meilleur gain : +' + fmt(p.bestGain || 0) + ' jetons' + (p.mt ? ' · ' + fmt(p.mt.amount) + ' jetons posés à une table multijoueur (' + p.mt.game + ')' : '') + (p.vipUntil ? ' · 👑 VIP jusqu\'au ' + new Date(p.vipUntil).toLocaleDateString('fr-FR') : ''));
    let led = $('ed-ledger');
    if (!led) { led = document.createElement('details'); led.id = 'ed-ledger'; led.className = 'small'; $('ed-sessions').after(led); }
    led.hidden = !API; led.innerHTML = '';
    if (API) {
      let r;
      try { r = await adm('get', { uid: p.uid }); } catch (e) { msg('Serveur : ' + e.message, 'err'); return; }
      saveData = { pseudo: r.brief.pseudo, xp: r.brief.xp, owned: r.owned, achievements: r.achievements };
      const sm = document.createElement('summary'); sm.textContent = '📒 Journal des mouvements (' + r.ledger.length + ' derniers)'; led.appendChild(sm);
      const ul = document.createElement('ul'); ul.style.cssText = 'margin:.4rem 0;padding-left:1rem;max-height:220px;overflow:auto';
      r.ledger.forEach((x) => { const li = document.createElement('li'); const dw = x.wallet_after - x.wallet_before, dt = x.table_after - x.table_before;
        li.textContent = new Date(x.at).toLocaleString('fr-FR') + ' · ' + opName(x.op) + (dw ? ' · jetons ' + (dw >= 0 ? '+' : '') + fmt(dw) + ' → ' + fmt(x.wallet_after) : '') + (dt ? ' · caisse ' + (dt >= 0 ? '+' : '') + fmt(dt) + ' €' : ''); ul.appendChild(li); });
      led.appendChild(ul);
    } else {
      const sv = await get('saves/' + p.uid).catch(() => null);
      saveData = sv && sv.data ? JSON.parse(sv.data) : null;
    }
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
    if (API) { try { await adm('wallet', { uid: sel.uid, wallet: v }); await refresh('Jetons mis à jour : ' + fmt(v) + '. Le joueur les voit à sa prochaine action.', 'ok'); } catch (e) { msg('Refusé : ' + e.message, 'err'); } return; }
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
    if (API) {
      try { await adm('profile', { uid: sel.uid, pseudo: saveData.pseudo, level: lvl, owned, achievements: ach }); await refresh('Profil enregistré sur le serveur : le joueur le voit à sa prochaine action (ou en rechargeant l\'app).', 'ok'); }
      catch (e) { msg('Refusé : ' + e.message, 'err'); }
      return;
    }
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
    if (API) { try { await adm('close', { uid: sel.uid }); await refresh('Jeux débloqués : l\'argent posé sur les jeux est revenu dans la caisse de sa partie.', 'ok'); } catch (e) { msg('Refusé : ' + e.message, 'err'); } return; }
    try {
      let back = 0;
      await bankSet(sel.uid, (o) => { back = sesTotal(o.ses); o.wallet = Math.round((o.wallet + back) * 100) / 100; delete o.ses; });
      if (saveData) { saveData.sessions = {}; saveData.wallet = (saveData.wallet || 0) + back; saveData.savedAt = Date.now(); await D.set(ref('saves/' + sel.uid), { data: JSON.stringify(saveData), at: saveData.savedAt, adminAt: saveData.savedAt }); }
      await refresh(back ? fmt(back) + ' € (somme apportée sur ses tables) rendus à la banque du joueur.' : 'Aucune partie en cours.', 'ok');
    } catch (e) { msg('Refusé : ' + e.message, 'err'); }
  });

  $('act-reset').addEventListener('click', async () => {
    if (!sel || !sure('Remettre ' + sel.pseudo + ' à zéro ? Jetons de départ, niveau 1, objets et succès retirés, partie arrêtée. Le pseudo et le compte sont gardés.')) return;
    if (API) { try { await adm('reset', { uid: sel.uid }); await refresh('Compte remis à zéro.', 'ok'); } catch (e) { msg('Refusé : ' + e.message, 'err'); } return; }
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
      if (API) await adm('delete', { uid: sel.uid });
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
  // maintenance
  async function mtState() { if (!API) { $('mt-state').textContent = 'Demande le serveur du NAS.'; return; } try { const r = await adm('maintenance.get', {}); $('mt-state').textContent = r.maintenance.on ? '🟠 Maintenance ACTIVE' + (r.maintenance.msg ? ' : « ' + r.maintenance.msg + ' »' : '') : '🟢 Le Casino est ouvert.'; if (r.maintenance.msg && !$('mt-msg').value) $('mt-msg').value = r.maintenance.msg; } catch (e) { $('mt-state').textContent = 'Serveur pas à jour pour la maintenance.'; } }
  $('mt-on').addEventListener('click', async () => { try { await adm('maintenance', { on: true, msg: $('mt-msg').value.trim() }); tmsg('Maintenance activée.', 'ok'); } catch (e) { tmsg('Refusé : ' + e.message, 'err'); } mtState(); });
  $('mt-off').addEventListener('click', async () => { try { await adm('maintenance', { on: false, msg: '' }); tmsg('Maintenance terminée : le Casino est rouvert.', 'ok'); } catch (e) { tmsg('Refusé : ' + e.message, 'err'); } mtState(); });
  setTimeout(mtState, 1500);
  $('gift-go').addEventListener('click', async () => {
    const v = Math.round(Number($('gift').value) || 0);
    if (!(v > 0)) return;
    const list = players.filter((p) => !banned[p.uid]);
    if (!sure('Offrir ' + fmt(v) + ' jetons à ' + list.length + ' compte(s) ?')) return;
    $('gift-go').disabled = true;
    if (API) { try { const r = await adm('gift', { amount: v }); tmsg(fmt(v) + ' jetons crédités à ' + r.count + ' compte(s).', 'ok'); load(); } catch (e) { tmsg('Refusé : ' + e.message, 'err'); } $('gift-go').disabled = false; return; }
    let ok = 0;
    for (const p of list) { try { await bankSet(p.uid, (o) => { o.wallet = Math.round(((o.wallet || 0) + v) * 100) / 100; }); ok++; } catch (e) { /* compte suivant */ } }
    $('gift-go').disabled = false;
    tmsg(fmt(v) + ' jetons crédités à ' + ok + ' compte(s).', 'ok'); load();
  });
  $('lobby-clear').addEventListener('click', async () => {
    try { const l = (await get('lobby')) || {}; await Promise.all(Object.keys(l).map((k) => D.remove(ref('lobby/' + k)))); tmsg('Liste des parties vidée.', 'ok'); load(); }
    catch (e) { tmsg('Refusé : ' + e.message, 'err'); }
  });

  // noms lisibles des actions du journal
  const OPN = { 'run.start': '🕴️ Partie lancée', 'run.end': '🕴️ Fin de journée', 'run.next': '🕴️ Palier suivant', 'run.buy': '🛍️ Receleur', 'run.abandon': '🏳️ Abandon', 'session.start': '🎲 Assis à un jeu', 'session.cashout': '💼 Retour à la caisse', 'box.open': '🎁 Coffre', 'shop.buy': '🎨 Boutique', 'vip.buy': '👑 Pass VIP', 'bonus.claim': '🎁 Bonus du jour', 'challenge.claim': '🎯 Défi', 'wheel.spin': '🎡 Roue du jour', 'mt.sit': '👥 Table multi (assis)', 'mt.leave': '👥 Table multi (parti)', 'pk.buyin': '♠ Poker (entrée)', 'pk.claim': '♠ Poker (gain)', 'pk.refund': '♠ Poker (remboursé)', 'ev.bet': '🏇 Grand Prix (pari)', 'ev.info': '🏇 Grand Prix (gain)', 'ev.claim': '🏇 Grand Prix (gain)', 'ref': '🎁 Parrainage', econ: '🔄 Passage aux jetons' };
  const opName = (op) => OPN[op] || (op.startsWith('admin:') ? '🛠️ Admin (' + op.slice(6) + ')' : op);
  // ---------- Tableau de bord ----------
  const fmt2 = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
  function barChart(box, items, series, opts) {
    // items : [{ label, values: [..] }] ; series : [{ name, color }]
    const W = 600, H = 220, padL = 60, padB = 30, padT = 10, n = items.length, k = series.length;
    const max = Math.max(1, ...items.flatMap((x) => x.values));
    const step = (W - padL) / n, bw = Math.max(2, (step - 2) / k - 2);
    const y = (v) => H - padB - (v / max) * (H - padB - padT);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + opts.aria + '">';
    [0, .5, 1].forEach((f) => { const v = max * f, yy = y(v); svg += '<line x1="' + padL + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="#2a333d" stroke-width="1"/><text x="' + (padL - 6) + '" y="' + (yy + 4) + '" fill="#9aa5b1" font-size="18" text-anchor="end">' + (opts.short ? opts.short(v) : fmt(v)) + '</text>'; });
    items.forEach((it, i) => {
      it.values.forEach((v, j) => {
        const x = padL + i * step + 1 + j * (bw + 2), yy = y(v), h = Math.max(0, H - padB - yy);
        svg += '<rect data-i="' + i + '" x="' + x + '" y="' + yy + '" width="' + bw + '" height="' + h + '" rx="' + Math.min(4, bw / 2) + '" fill="' + series[j].color + '"/>';
      });
      if (opts.every || i % 5 === 0 || i === n - 1) svg += '<text x="' + (padL + i * step + step / 2) + '" y="' + (H - 8) + '" fill="#9aa5b1" font-size="18" text-anchor="middle">' + it.label + '</text>';
    });
    // zones de survol (plus larges que les barres)
    items.forEach((it, i) => { svg += '<rect class="hit" data-i="' + i + '" x="' + (padL + i * step) + '" y="0" width="' + step + '" height="' + (H - padB) + '" fill="transparent"/>'; });
    box.innerHTML = svg + '</svg><div class="tip" hidden></div>';
    const tip = box.querySelector('.tip'), sv = box.querySelector('svg');
    sv.addEventListener('mousemove', (e) => {
      const t = e.target.closest('rect.hit'); if (!t) { tip.hidden = true; return; }
      const it = items[+t.dataset.i], r = box.getBoundingClientRect();
      tip.innerHTML = '<b>' + it.title + '</b><br>' + series.map((s, j) => s.name + ' : ' + (opts.fmt ? opts.fmt(it.values[j]) : fmt(it.values[j]))).join('<br>');
      tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'; tip.hidden = false;
    });
    sv.addEventListener('mouseleave', () => { tip.hidden = true; });
  }
  function table(el, head, rows) {
    el.innerHTML = '<thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + h + '</th>').join('') + '</tr></thead><tbody></tbody>';
    const tb = el.querySelector('tbody');
    rows.forEach((r) => { const tr = document.createElement('tr'); r.forEach((c, i) => { const td = document.createElement('td'); if (i) td.className = 'num'; if (c && typeof c === 'object') { td.textContent = c.t; if (c.cls) td.classList.add(c.cls); } else td.textContent = c; tr.appendChild(td); }); tb.appendChild(tr); });
  }
  async function loadDash() {
    if (!API) return;
    let d;
    try { d = await adm('dashboard'); } catch (e) { $('dash-kpis').textContent = 'Tableau de bord indisponible : ' + e.message; return; }
    $('dash-at').textContent = 'mis à jour à ' + new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    // le serveur a-t-il les mêmes règles que l'app ?
    $('dash-ver').innerHTML = '';
    if (!d.jetons || d.rules !== R.RULES_VERSION) { const w = document.createElement('div'); w.className = 'ver-warn'; w.textContent = '⏳ Le serveur du NAS n\'a pas les dernières règles du jeu (paliers, mises…). Lance la mise à jour : sudo sh /volume1/docker/casino/update.sh'; $('dash-ver').appendChild(w); if (!d.jetons) return; }
    const net30 = d.days.reduce((a, x) => a + x.gained - x.spent, 0);
    const kpi = (label, val, sub) => '<div class="kpi"><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';
    $('dash-kpis').innerHTML = kpi('👥 Joueurs', fmt(d.players.total), '+' + fmt(d.days.reduce((a, x) => a + x.fresh, 0)) + ' nouveaux en 30 jours')
      + kpi('🟢 Actifs aujourd\'hui', fmt(d.players.active1), fmt(d.players.active7) + ' cette semaine · ' + fmt(d.players.active30) + ' ce mois')
      + kpi('👑 VIP', fmt(d.players.vip), d.players.total ? Math.round(d.players.vip / d.players.total * 100) + ' % des joueurs' : '')
      + kpi('🪙 Jetons des joueurs', fmt(d.jetons.total), 'en moyenne ' + fmt(d.jetons.avg) + ' par joueur')
      + kpi('📈 Jetons créés (30 j)', fmt2(net30), net30 > 0 ? 'les joueurs gagnent plus qu\'ils ne dépensent' : 'les joueurs dépensent plus qu\'ils ne gagnent')
      + kpi('🕴️ Parties du Parrain', fmt(d.parrain.live) + ' en cours', fmt(d.parrain.runs30) + ' lancées en 30 j · ' + fmt(d.parrain.runs) + ' au total')
      + kpi('🏆 Fin de partie moyenne', 'palier ' + String(d.parrain.avgDone).replace('.', ','), 'paliers réussis en moyenne à la dernière partie');
    $('dash-alerts').innerHTML = '';
    d.alerts.forEach((a) => { const x = document.createElement('div'); x.className = 'alert'; x.textContent = '⚠️ ' + a.name + ' a gagné ' + fmt(a.gained) + ' jetons en 24 h (seuil d\'alerte : ' + fmt(d.alertThreshold) + '). Vérifie son journal.'; $('dash-alerts').appendChild(x); });
    const lbl = (s) => s.slice(8) + '/' + s.slice(5, 7);
    const ttl = (x) => new Date(x.d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    barChart($('ch-active'), d.days.map((x) => ({ label: lbl(x.d), title: ttl(x), values: [x.active, x.runs] })), [{ name: 'Joueurs actifs', color: 'var(--s1)' }, { name: 'Parties lancées', color: 'var(--s3)' }], { aria: 'Joueurs actifs et parties lancées par jour' });
    const kshort = (v) => (v >= 1000 ? Math.round(v / 1000) + 'k' : fmt(v));
    barChart($('ch-money'), d.days.map((x) => ({ label: lbl(x.d), title: ttl(x), values: [x.gained, x.spent] })), [{ name: 'Gagnés', color: 'var(--s1)' }, { name: 'Dépensés', color: 'var(--s2)' }], { aria: 'Jetons gagnés et dépensés par jour', short: kshort, fmt: (v) => fmt(v) + ' jetons' });
    table($('tb-cats'), ['Source', 'Gagnés', 'Dépensés', 'Solde'], d.sources.map((c) => [c.k, c.gained ? '+' + fmt(c.gained) : '–', c.spent ? '−' + fmt(c.spent) : '–', { t: fmt2(c.net), cls: c.net >= 0 ? 'pos' : 'neg' }]));
    table($('tb-rich'), ['Joueur', 'Niv.', 'Jetons'], d.richest.map((r) => [r.name + (r.vip ? ' 👑' : ''), String(r.level), fmt(r.jetons)]));
    barChart($('ch-best'), d.parrain.best.map((b) => ({ label: b.k === '0' ? 'aucun' : b.k, title: b.k === '0' ? 'Aucun palier réussi' : 'Meilleur palier : ' + b.k, values: [b.n] })), [{ name: 'Joueurs', color: 'var(--s3)' }], { aria: 'Meilleur palier par joueur', every: 1 });
    table($('tb-live'), ['Joueur', 'Palier', 'Caisse / quota', 'Vies'], d.parrain.liveList.length ? d.parrain.liveList.map((r) => [r.name + (r.status === 'shop' ? ' 🛍️' : ''), String(r.palier), fmt(r.caisse) + ' / ' + fmt(r.quota) + ' €', r.lives != null ? '❤️'.repeat(r.lives) : '–']) : [['Personne en partie', '', '', '']]);
    table($('tb-top'), ['Joueur', 'Meilleur palier', 'Parties'], d.parrain.top.map((r) => [r.name, String(r.best), fmt(r.runs)]));
    table($('tb-games'), ['Jeu', 'Coups', 'Joueurs', 'Résultat des joueurs'], d.games.map((g) => [g.name, fmt(g.ops), fmt(g.players), { t: fmt2(g.net) + ' €', cls: g.net >= 0 ? 'pos' : 'neg' }]));
  }
  $('dash-reload').addEventListener('click', loadDash);
  document.querySelectorAll('[data-vip]').forEach((b) => b.addEventListener('click', async () => {
    if (!sel || !API) return;
    const days = +b.dataset.vip;
    try { await adm('vip', { uid: sel.uid, days }); await refresh('Pass VIP : ' + (days > 0 ? '+' : '') + days + ' jours.', 'ok'); } catch (e) { msg('Refusé : ' + e.message, 'err'); }
  }));
  // ---------- État du serveur ----------
  const bytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' Go' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.round(n / 1024) + ' Ko');
  const ago = (ms) => { const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24); return d ? d + ' j ' + (h % 24) + ' h' : h ? h + ' h ' + (m % 60) + ' min' : m + ' min'; };
  async function loadStatus() {
    if (!API || $('status-panel').hidden) return;
    let d;
    try { d = await adm('status'); } catch (e) { $('st-kpis').innerHTML = '<div class="alert">🔴 Serveur injoignable ou trop ancien (mets à jour le NAS) : ' + e.message + '</div>'; return; }
    $('st-at').textContent = '🟢 en ligne · mis à jour à ' + new Date(d.at).toLocaleTimeString('fr-FR');
    const kpi = (label, val, sub, warn) => '<div class="kpi' + (warn ? ' warn' : '') + '"><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';
    const memPct = Math.round(d.memory.rss / d.memory.limit * 100);
    $('st-kpis').innerHTML = kpi('Allumé depuis', ago(d.uptime), 'version ' + (d.version || 'ancienne (à mettre à jour)') + ' · Node ' + d.node + (d.firebase ? ' · Firebase ✓' : ' · ⚠️ Firebase absent'), !d.firebase)
      + kpi('Joueurs connectés', fmt(d.online.m5), fmt(d.online.h1) + ' sur la dernière heure')
      + kpi('Requêtes', fmt(d.requests.m5) + ' / 5 min', fmt(d.requests.h1) + ' sur 1 h · ' + fmt(d.requests.rejected) + ' refusées (règles)')
      + kpi('Temps de réponse', d.latency.p50 + ' ms', 'moyenne ' + d.latency.avg + ' ms · 95 % sous ' + d.latency.p95 + ' ms · max ' + d.latency.max + ' ms', d.latency.p95 > 800)
      + kpi('Erreurs (1 h)', fmt(d.requests.errors), fmt(d.requests.limited) + ' requêtes freinées (anti-abus) depuis le démarrage', d.requests.errors > 0)
      + kpi('Mémoire', bytes(d.memory.rss), memPct + ' % de la limite (' + bytes(d.memory.limit) + ')', memPct > 80)
      + kpi('Base de données', bytes(d.db.size), fmt(d.db.players) + ' joueurs · ' + fmt(d.db.ledger) + ' lignes au journal · ' + fmt(d.db.push || 0) + ' appareils abonnés aux notifications')
      + kpi('Charge du NAS', d.load[0].toFixed(2), d.cpus + ' cœurs · 5 min ' + d.load[1].toFixed(2) + ' · 15 min ' + d.load[2].toFixed(2), d.load[0] > d.cpus);
    barChart($('ch-req'), d.minutes.map((m, i) => ({ label: i === 59 ? 'maint.' : '−' + (59 - i) + ' min', title: (59 - i) ? 'il y a ' + (59 - i) + ' min' : 'cette minute', values: [m.n, m.err] })), [{ name: 'Requêtes', color: 'var(--s1)' }, { name: 'Erreurs', color: 'var(--s2)' }], { aria: 'Requêtes par minute', fmt: (v) => fmt(v) });
    table($('tb-ops'), ['Action', 'Nombre'], d.topOps.map(([k, v]) => [k, fmt(v)]));
    renderBackups(d.backups);
    $('st-errors').innerHTML = '';
    if (!d.errors.length) $('st-errors').textContent = '✅ Aucune erreur depuis le démarrage.';
    d.errors.forEach((e) => { const x = document.createElement('div'); x.className = 'alert'; x.textContent = new Date(e.t).toLocaleTimeString('fr-FR') + ' · ' + (e.op || '?') + ' · ' + e.msg; $('st-errors').appendChild(x); });
  }
  function renderBackups(b) {
    if (!b) return;
    const last = b.list[0];
    $('bk-msg').textContent = b.error ? '⚠️ Dernière sauvegarde ratée : ' + b.error.msg : last ? '✅ Dernière : ' + new Date(last.at).toLocaleString('fr-FR') : '⏳ Aucune sauvegarde pour l\'instant (la première est faite dans la minute qui suit le démarrage, après 4 h).';
    $('bk-msg').className = 'small' + (b.error || (last && Date.now() - last.at > 36 * 3600000) ? ' neg' : '');
    table($('tb-bk'), ['Fichier', 'Taille', 'Date'], b.list.map((x) => [x.file, bytes(x.size), new Date(x.at).toLocaleString('fr-FR')]));
  }
  $('bk-now').addEventListener('click', async () => {
    $('bk-now').disabled = true;
    try { const r = await adm('backup'); $('bk-msg').textContent = '✅ Sauvegarde faite : ' + r.backup.file + ' (' + bytes(r.backup.size) + ')'; table($('tb-bk'), ['Fichier', 'Taille', 'Date'], r.list.map((x) => [x.file, bytes(x.size), new Date(x.at).toLocaleString('fr-FR')])); }
    catch (e) { $('bk-msg').textContent = '⚠️ ' + e.message; }
    $('bk-now').disabled = false;
  });
  $('st-reload').addEventListener('click', loadStatus);
  loadStatus(); setInterval(loadStatus, 20000);
  loadDash();
  load();
})();
