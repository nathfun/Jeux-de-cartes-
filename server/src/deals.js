/*
 * Entre joueurs : marché (vendre une carte), échanges (objets + argent) et duels (pari sur une partie entre amis).
 *
 * Principe de sécurité : tout ce qui est mis en jeu est BLOQUÉ par le serveur dès le départ (retiré de la banque ou
 * de la collection), puis remis au bon joueur à la fin. On ne peut donc ni dépenser deux fois, ni se rétracter après
 * avoir perdu. Chaque mouvement d'argent passe par le journal (ledger).
 */
'use strict';
const crypto = require('crypto');

const r2 = (v) => Math.round(v * 100) / 100;
const DUEL_GAMES = { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette' };
const DAY = 864e5;

module.exports = function makeDeals({ db, serial, R, core, rtdb, TABLES, pushTo, userError, publish }) {
  const fail = (m) => { throw userError(m); };
  const nameOf = (P) => (P && P.pseudo) || 'Un joueur';
  const itemName = (k, id) => { const it = R.itemOf(k, id); return it ? it.name : id; };
  const keyName = (key) => { const i = key.indexOf(':'); return itemName(key.slice(0, i), key.slice(i + 1)); };
  const parseKey = (x) => { const m = /^([a-z]+):(.{1,40})$/.exec(String(x || '')); if (!m || !R.tradeable(m[1], m[2])) fail('Objet non échangeable : seules les cartes (Légendes et boosters) et les objets rares du jour s\'échangent.'); return { kind: m[1], id: m[2], key: m[1] + ':' + m[2] }; };
  const money = (v, max) => { const n = Math.round(Number(v || 0)); if (!Number.isFinite(n) || n < 0 || n > (max || 1e6)) fail('Montant invalide.'); return n; };

  // ----- verrous : plusieurs joueurs modifiés ensemble, toujours dans le même ordre (pas d'interblocage) -----
  function withPlayers(uids, fn) {
    const list = [...new Set(uids)].sort();
    const run = (i) => (i >= list.length ? fn() : serial(list[i], () => run(i + 1)));
    return run(0);
  }
  /** Charge des joueurs, applique fn, enregistre ceux qui ont changé (avec une ligne de journal par joueur). */
  async function edit(uids, op, fn) {
    return withPlayers(uids, async () => {
      const st = {}, P = {};
      for (const u of uids) {
        st[u] = db.load(u);
        if (!st[u].player) fail('Joueur introuvable sur le serveur.');
        P[u] = R.normalize(JSON.parse(JSON.stringify(st[u].player)), Date.now());
      }
      const out = await fn(P);
      const now = Date.now();
      for (const u of new Set(uids)) {
        const after = Object.assign({}, st[u], { player: P[u] });
        db.save(u, typeof op === 'function' ? op(u) : op, st[u], after, now);
        if (publish) publish(u, P[u]);
      }
      return out;
    });
  }
  const inbox = (P, title, text, icon) => { P.inbox = (P.inbox || []).concat([{ title, text, icon, at: Date.now() }]).slice(-20); };
  const split = (key) => { const i = key.indexOf(':'); return [key.slice(0, i), key.slice(i + 1)]; };
  const takeItem = (P, key) => {
    const [k, id] = split(key);
    if (k === 'col') { P.col = P.col || {}; if (!(P.col[id] > 0)) fail('Tu n\'as pas la carte « ' + itemName(k, id) + ' ».'); P.col[id]--; if (!P.col[id]) delete P.col[id]; return; }
    P.owned = P.owned || {}; if (!P.owned[key]) fail('Tu n\'as pas « ' + itemName(k, id) + ' ».'); delete P.owned[key];
  };
  const giveItem = (P, key) => {
    const [k, id] = split(key);
    if (k === 'col') { P.col = P.col || {}; P.col[id] = (P.col[id] || 0) + 1; return; }
    P.owned = P.owned || {}; if (!P.owned[key]) P.owned[key] = Date.now(); else { const it = R.itemOf(k, id); if (it && it.card) { P.cards = P.cards || {}; P.cards.shards = (P.cards.shards || 0) + R.RARITY[it.card].shard; } }
  };
  const takeMoney = (P, v) => { if (v > 0) { if ((P.wallet || 0) < v) fail('Il te manque ' + Math.ceil(v - P.wallet).toLocaleString('fr-FR') + ' € en banque.'); P.wallet = r2(P.wallet - v); } };
  const giveMoney = (P, v) => { if (v > 0) P.wallet = r2((P.wallet || 0) + v); };
  const notify = (uid, msg) => { if (pushTo) pushTo(uid, 'social', msg).catch(() => {}); };
  const newId = () => crypto.randomBytes(6).toString('base64url');
  const brief = (k) => ({ key: k, name: keyName(k), rarity: R.rarityOfKey(k) || null });

  // ===================== Marché =====================
  async function marketList(uid, d) {
    const { kind, id, key } = parseKey(d.item);
    const price = money(d.price);
    if (price < 10) fail('Prix minimum : 10 €.');
    if (db.marketOpenOf(uid).length >= 20) fail('Au plus 20 objets en vente à la fois.');
    const lid = newId();
    await edit([uid], 'mk.list', (P) => {
      takeItem(P[uid], key);
      db.marketPut({ id: lid, seller: uid, sellerName: nameOf(P[uid]), kind, item: id, rarity: R.rarityOfKey(key) || 'rare', price, created: Date.now(), status: 'open' });
    });
    return { id: lid };
  }
  async function marketCancel(uid, d) {
    const l = db.marketGet(String(d.id));
    if (!l || l.seller !== uid || l.status !== 'open') fail('Annonce introuvable.');
    await edit([uid], 'mk.cancel', (P) => { if (db.marketGet(l.id).status !== 'open') fail('Déjà vendu.'); giveItem(P[uid], l.kind + ':' + l.item); db.marketSet(l.id, { status: 'cancelled' }); });
    return { ok: true };
  }
  async function marketBuy(uid, d) {
    const l = db.marketGet(String(d.id));
    if (!l || l.status !== 'open') fail('Cette annonce n\'est plus disponible.');
    if (l.seller === uid) fail('C\'est ton annonce.');
    let fee = 0;
    await edit([uid, l.seller], (u) => (u === uid ? 'mk.buy' : 'mk.sale'), (P) => {
      const cur = db.marketGet(l.id);
      if (!cur || cur.status !== 'open') fail('Cette annonce vient d\'être vendue.');
      const key = l.kind + ':' + l.item;
      if (l.kind !== 'col' && P[uid].owned && P[uid].owned[key]) fail('Tu as déjà cet objet.');
      takeMoney(P[uid], l.price);
      fee = Math.ceil(l.price * (R.isVip(P[l.seller]) ? R.MARKET_FEE_VIP : R.MARKET_FEE));
      giveMoney(P[l.seller], l.price - fee);
      giveItem(P[uid], key);
      inbox(P[l.seller], '🏪 Vendu !', nameOf(P[uid]) + ' a acheté « ' + itemName(l.kind, l.item) + ' » : +' + (l.price - fee).toLocaleString('fr-FR') + ' € sur ton compte.', '💰');
      db.marketSet(l.id, { status: 'sold', buyer: uid, soldAt: Date.now() });
      coteCache = null;
    });
    notify(l.seller, { title: '🏪 Ton objet est vendu !', body: '« ' + itemName(l.kind, l.item) + ' » : +' + (l.price - fee).toLocaleString('fr-FR') + ' €', tag: 'market' });
    return { ok: true, item: l.kind + ':' + l.item, price: l.price };
  }
  function marketBrowse(uid, d) {
    const rows = db.marketOpen(String(d.kind || ''), String(d.rarity || ''), 120).map((l) => ({ id: l.id, kind: l.kind, item: l.item, name: itemName(l.kind, l.item), rarity: l.rarity, price: l.price, seller: l.sellerName, mine: l.seller === uid, at: l.created }));
    const stats = {}; db.marketSoldSince(Date.now() - 30 * DAY).forEach((s) => { const k = s.kind + ':' + s.item; (stats[k] = stats[k] || []).push(s.price); });
    const avg = {}; Object.keys(stats).forEach((k) => { const a = stats[k]; avg[k] = Math.round(a.reduce((x, y) => x + y, 0) / a.length); });
    return { listings: rows, avg };
  }

  // ===================== Cotes et vente immédiate =====================
  let coteCache = null;
  /** Cote de chaque carte : rareté + ventes du marché (30 jours), tendance sur 7 jours, nombre d'exemplaires en circulation. */
  function cotes() {
    if (coteCache && Date.now() - coteCache.at < 5 * 60000) return coteCache.data;
    const now = Date.now(), sold = db.marketSoldSince(now - 30 * DAY), by = {}, recent = {}, older = {};
    sold.forEach((l) => { const k = l.kind + ':' + l.item; (by[k] = by[k] || []).push(l.price); ((l.soldAt || l.created) >= now - 7 * DAY ? recent : older)[k] = (((l.soldAt || l.created) >= now - 7 * DAY ? recent : older)[k] || []).concat([l.price]); });
    const circ = {};
    db.all().forEach((p) => { const P = p.state.player || {}; Object.entries(P.col || {}).forEach(([id, n]) => { circ['col:' + id] = (circ['col:' + id] || 0) + n; }); Object.keys(P.owned || {}).forEach((k) => { circ[k] = (circ[k] || 0) + 1; }); });
    db.marketOpen('', '', 10000).forEach((l) => { const k = l.kind + ':' + l.item; circ[k] = (circ[k] || 0) + 1; });
    const data = {}, med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const keys = R.COLLECTION.map((c) => 'col:' + c.id);
    Object.keys(R.SHOP).forEach((k) => R.SHOP[k].forEach((it) => { if (it.card || it.daily) keys.push(k + ':' + it.id); }));
    keys.forEach((k) => {
      const cote = R.coteOf(k, by[k]);
      const trend = recent[k] && older[k] && recent[k].length >= 2 && older[k].length >= 2 ? Math.round((med(recent[k]) - med(older[k])) / med(older[k]) * 100) : 0;
      data[k] = { cote, sales: (by[k] || []).length, trend, circ: circ[k] || 0, instant: R.instantPrice(k, cote) };
    });
    coteCache = { at: now, data };
    return data;
  }
  async function instantSell(uid, d) {
    const { key } = parseKey(d.item), n = Math.max(1, Math.min(50, Math.floor(Number(d.n) || 1)));
    const c = cotes()[key];
    let out;
    await edit([uid], 'col.sell', (P) => { out = R.instantSell(P[uid], key, c && c.cote, n); if (out.error) fail(out.error); });
    return out;
  }

  // ===================== Loto entre amis : cagnotte =====================
  // Chaque joueur paie son pack de cartons au serveur (argent bloqué) ; à la fin, la cagnotte est partagée entre
  // les gagnants des lots (quines, double quine, carton plein), sans frais. Salle abandonnée : tout est remboursé.
  async function lotoTable(tid) {
    if (!/^[A-Z0-9]{4,8}$/.test(tid)) fail('Salle invalide.');
    const t = rtdb ? (await rtdb.ref(TABLES.loto + tid).get()).val() : null;
    return t;
  }
  const listOf = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter(Boolean);
  async function lotoBuy(uid, d) {
    const tid = String(d.table || ''), t = await lotoTable(tid);
    if (!t) fail('Salle introuvable.');
    if (t.started) fail('La partie a déjà commencé.');
    const sets = t.settings || {}, price = Number(sets.price || 0), style = sets.style === 'classique' ? 'classique' : 'serie';
    if (!R.LOTO.PRICES.includes(price)) fail('Prix de carton invalide.');
    const n = Math.floor(Number(d.pack));
    if (!R.LOTO.PACKS[style].includes(n)) fail('Pack invalide.');
    const cost = R.lotoPackCost(price, n);
    const prev = db.lotoGet(tid).find((r) => r.uid === uid && r.status === 'paid');
    await edit([uid], 'loto.buy', (P) => {
      const diff = Math.round((cost - (prev ? prev.paid : 0)) * 100) / 100;
      if (diff > 0) takeMoney(P[uid], diff); else giveMoney(P[uid], -diff);
      db.lotoPut({ tid, uid, name: nameOf(P[uid]), paid: cost, cards: n, at: Date.now(), status: 'paid' });
    });
    return { paid: cost, cards: n, pot: db.lotoGet(tid).filter((r) => r.status === 'paid').reduce((a, r) => a + r.paid, 0) };
  }
  async function lotoRefundOne(uid, d) {
    const tid = String(d.table || ''), t = await lotoTable(tid);
    if (t && t.started && t.phase !== 'over') fail('La partie est en cours : impossible de se faire rembourser.');
    const row = db.lotoGet(tid).find((r) => r.uid === uid && r.status === 'paid');
    if (!row) return { refunded: 0 };
    if (t && t.phase === 'over') return lotoSettle(uid, d);
    await edit([uid], 'loto.refund', (P) => { const cur = db.lotoGet(tid).find((r) => r.uid === uid); if (!cur || cur.status !== 'paid') fail('Déjà remboursé.'); giveMoney(P[uid], row.paid); db.lotoPut(Object.assign({}, row, { status: 'refunded' })); });
    return { refunded: row.paid };
  }
  async function lotoRefundAll(tid, why) {
    const rows = db.lotoGet(tid).filter((r) => r.status === 'paid');
    if (!rows.length) return;
    await edit(rows.map((r) => r.uid), 'loto.refund', (P) => {
      if (!db.lotoGet(tid).some((r) => r.status === 'paid')) fail('Déjà réglé.');
      rows.forEach((r) => { giveMoney(P[r.uid], r.paid); inbox(P[r.uid], '🎱 Loto remboursé', (why || 'La salle a été abandonnée') + ' : tes ' + r.paid.toLocaleString('fr-FR') + ' € te sont rendus.', '↩️'); });
      db.lotoSetStatus(tid, 'refunded');
    });
  }
  async function lotoSettle(uid, d) {
    const tid = String(d.table || ''), t = await lotoTable(tid);
    if (!t) fail('Salle introuvable.');
    if (t.phase !== 'over') fail('Le loto n\'est pas fini.');
    const rows = db.lotoGet(tid).filter((r) => r.status === 'paid');
    if (!rows.length) return { settled: false, already: db.lotoGet(tid).some((r) => r.status === 'settled') };
    const pot = rows.reduce((a, r) => a + r.paid, 0), games = Math.max(1, Number((t.settings || {}).games) || 1);
    const payers = new Set(rows.map((r) => r.uid)), gain = {};
    let orphan = 0;
    listOf(t.winners).forEach((w) => {
      const share = Math.floor(pot / games * (R.LOTO.SHARES[w.stage] || 0) * 100) / 100;
      if (payers.has(w.uid)) gain[w.uid] = (gain[w.uid] || 0) + share; else orphan += share;
    });
    const paidOut = Object.values(gain).reduce((a, v) => a + v, 0) + orphan;
    orphan += Math.max(0, Math.round((pot - paidOut) * 100) / 100); // arrondis et lots non attribués
    // la part des gagnants qui n'avaient pas payé (et les arrondis) est rendue aux joueurs, au prorata
    rows.forEach((r) => { gain[r.uid] = Math.round(((gain[r.uid] || 0) + orphan * r.paid / pot) * 100) / 100; });
    await edit(rows.map((r) => r.uid), (u) => (gain[u] > (rows.find((r) => r.uid === u) || {}).paid ? 'loto.win' : 'loto.lose'), (P) => {
      if (!db.lotoGet(tid).some((r) => r.status === 'paid')) fail('Déjà réglé.');
      rows.forEach((r) => {
        const g = gain[r.uid] || 0;
        giveMoney(P[r.uid], g);
        inbox(P[r.uid], g > r.paid ? '🎱 Loto : tu gagnes !' : '🎱 Loto terminé', 'Cagnotte de ' + Math.round(pot).toLocaleString('fr-FR') + ' € : tu récupères ' + g.toLocaleString('fr-FR') + ' € (tu avais payé ' + r.paid.toLocaleString('fr-FR') + ' €).', g > r.paid ? '🏆' : '🎱');
      });
      db.lotoSetStatus(tid, 'settled');
    });
    rows.forEach((r) => { if ((gain[r.uid] || 0) > r.paid) notify(r.uid, { title: '🎱 Tu gagnes au loto !', body: '+' + (gain[r.uid] || 0).toLocaleString('fr-FR') + ' € sur ta banque.', tag: 'loto' }); });
    return { settled: true, pot, gains: gain };
  }
  function lotoInfo(uid, d) {
    const tid = String(d.table || ''), rows = db.lotoGet(tid);
    const paid = rows.filter((r) => r.status === 'paid');
    return { pot: paid.reduce((a, r) => a + r.paid, 0), players: paid.map((r) => ({ uid: r.uid, name: r.name, cards: r.cards, paid: r.paid })), status: rows.length ? rows[0].status : 'none' };
  }
  async function lotoExpire() {
    for (const tid of db.lotoStale(Date.now() - 12 * 3600000)) {
      try {
        const t = await lotoTable(tid);
        if (t && t.phase === 'over') await lotoSettle('', { table: tid });
        else await lotoRefundAll(tid, 'Le loto ne s\'est pas terminé');
      } catch (e) { /* ignore */ }
    }
  }

  // ===================== Échanges =====================
  function side(o) {
    o = o || {};
    const items = (Array.isArray(o.items) ? o.items : []).slice(0, 6).map((x) => parseKey(x).key);
    if (new Set(items).size !== items.length) fail('Un objet est en double dans l\'échange.');
    return { items, money: money(o.money) };
  }
  async function tradeNew(uid, d) {
    const to = String(d.to || '');
    if (!to || to === uid || !db.has(to)) fail('Ce joueur n\'est pas encore passé sur le serveur.');
    const give = side(d.give), want = side(d.want);
    if (!give.items.length && !give.money && !want.items.length && !want.money) fail('Échange vide.');
    if (db.dealsOpenOf(uid).filter((x) => x.a === uid).length >= 10) fail('Au plus 10 propositions en attente.');
    const id = newId();
    let toName = '';
    await edit([uid], 'trade.offer', (P) => {
      give.items.forEach((k) => takeItem(P[uid], k)); takeMoney(P[uid], give.money);
      toName = nameOf(db.load(to).player);
      db.dealPut({ id, type: 'trade', a: uid, b: to, status: 'open', created: Date.now(), data: { aName: nameOf(P[uid]), bName: toName, give, want } });
    });
    notify(to, { title: '🔁 Proposition d\'échange', body: nameOf(db.load(uid).player) + ' te propose un échange. Ouvre le Lounge pour répondre.', tag: 'trade' });
    return { id };
  }
  async function tradeAnswer(uid, d, accept) {
    const t = db.dealGet(String(d.id));
    if (!t || t.type !== 'trade' || t.status !== 'open') fail('Proposition introuvable ou déjà traitée.');
    const isA = t.a === uid, isB = t.b === uid;
    if (!isA && !isB) fail('Cette proposition ne te concerne pas.');
    if (accept && !isB) fail('Seul le destinataire peut accepter.');
    const { give, want } = t.data;
    if (!accept) {
      await edit([t.a], 'trade.refund', (P) => { if (db.dealGet(t.id).status !== 'open') fail('Déjà traité.'); give.items.forEach((k) => giveItem(P[t.a], k)); giveMoney(P[t.a], give.money); db.dealSet(t.id, { status: isA ? 'cancelled' : 'declined' }); if (isB) inbox(P[t.a], '🔁 Échange refusé', t.data.bName + ' a refusé ton échange : tes objets et ton argent te sont rendus.', '↩️'); });
      return { ok: true };
    }
    await edit([t.a, t.b], 'trade', (P) => {
      if (db.dealGet(t.id).status !== 'open') fail('Déjà traité.');
      want.items.forEach((k) => takeItem(P[t.b], k)); takeMoney(P[t.b], want.money);
      want.items.forEach((k) => giveItem(P[t.a], k)); giveMoney(P[t.a], want.money);
      give.items.forEach((k) => giveItem(P[t.b], k)); giveMoney(P[t.b], give.money);
      inbox(P[t.a], '🔁 Échange accepté !', t.data.bName + ' a accepté ton échange.', '🤝');
      db.dealSet(t.id, { status: 'done', doneAt: Date.now() });
    });
    notify(t.a, { title: '🤝 Échange accepté', body: t.data.bName + ' a accepté ton échange.', tag: 'trade' });
    return { ok: true };
  }
  /** Ce qu'un joueur peut échanger (pour composer une proposition). */
  function inventory(uid, d) {
    const who = String(d.uid || uid), P = db.load(who).player;
    if (!P) fail('Joueur introuvable.');
    const items = Object.keys(P.owned || {}).filter((k) => { const [kind, id] = split(k); return R.tradeable(kind, id); }).map(brief)
      .concat(Object.keys(P.col || {}).filter((id) => P.col[id] > 0).map((id) => Object.assign(brief('col:' + id), { count: P.col[id] })));
    return { uid: who, name: nameOf(P), items, wallet: who === uid ? Math.floor(P.wallet || 0) : undefined };
  }

  // ===================== Duels =====================
  async function duelNew(uid, d) {
    const to = String(d.to || ''), game = String(d.game || '');
    if (!DUEL_GAMES[game]) fail('Jeu invalide pour un duel.');
    if (!to || to === uid || !db.has(to)) fail('Ce joueur n\'est pas encore passé sur le serveur.');
    const stake = money(d.money, 100000);
    const item = d.item ? parseKey(d.item).key : null;
    if (!stake && !item) fail('Mets au moins de l\'argent ou un objet en jeu.');
    if (db.dealsOpenOf(uid).filter((x) => x.type === 'duel' && x.a === uid).length >= 5) fail('Au plus 5 duels lancés à la fois.');
    const id = newId();
    await edit([uid], 'duel.stake', (P) => {
      takeMoney(P[uid], stake); if (item) takeItem(P[uid], item);
      db.dealPut({ id, type: 'duel', a: uid, b: to, status: 'open', created: Date.now(), data: { game, stake, aItem: item, bItem: null, aName: nameOf(P[uid]), bName: nameOf(db.load(to).player) } });
    });
    notify(to, { title: '⚔️ Tu es défié !', body: nameOf(db.load(uid).player) + ' te défie au ' + DUEL_GAMES[game] + (stake ? ' pour ' + stake.toLocaleString('fr-FR') + ' €' : '') + '.', tag: 'duel' });
    return { id };
  }
  async function duelAnswer(uid, d, accept) {
    const t = db.dealGet(String(d.id));
    if (!t || t.type !== 'duel' || t.status !== 'open') fail('Duel introuvable ou déjà commencé.');
    const isA = t.a === uid, isB = t.b === uid;
    if (!isA && !isB) fail('Ce duel ne te concerne pas.');
    if (!accept) {
      await edit([t.a], 'duel.refund', (P) => { if (db.dealGet(t.id).status !== 'open') fail('Déjà traité.'); giveMoney(P[t.a], t.data.stake); if (t.data.aItem) giveItem(P[t.a], t.data.aItem); db.dealSet(t.id, { status: isA ? 'cancelled' : 'declined' }); if (isB) inbox(P[t.a], '⚔️ Duel refusé', t.data.bName + ' a refusé ton duel : ta mise t\'est rendue.', '↩️'); });
      return { ok: true };
    }
    if (!isB) fail('Seul le joueur défié peut accepter.');
    const item = d.item ? parseKey(d.item).key : null;
    await edit([t.b], 'duel.stake', (P) => {
      if (db.dealGet(t.id).status !== 'open') fail('Déjà traité.');
      takeMoney(P[t.b], t.data.stake); if (item) takeItem(P[t.b], item);
      db.dealSet(t.id, { status: 'accepted', acceptedAt: Date.now(), data: Object.assign({}, t.data, { bItem: item }) });
    });
    notify(t.a, { title: '⚔️ Duel accepté !', body: t.data.bName + ' accepte ton duel au ' + DUEL_GAMES[t.data.game] + '. Crée la table et invite-le !', tag: 'duel' });
    return { ok: true };
  }
  /** Fin d'une partie entre amis : règle les duels acceptés entre des joueurs de cette table. */
  async function duelSettle(uid, d) {
    const game = String(d.game || ''), tid = String(d.table || '');
    if (!TABLES[game] || !/^[A-Z0-9]{3,8}$/.test(tid)) fail('Table invalide.');
    const duels = db.dealsOpenOf(uid).filter((x) => x.type === 'duel' && x.status === 'accepted' && x.data.game === game);
    if (!duels.length) return { settled: [] };
    const raw = rtdb ? (await rtdb.ref(TABLES[game] + tid).get()).val() : null;
    if (!raw) fail('Table introuvable.');
    const t = Object.assign({ id: tid }, raw), now = Date.now();
    const endAt = game === 'blackjack' ? t.gameEnd && t.gameEnd.at : game === 'poker' ? t.gameOver && t.gameOver.at : t.over && t.over.at;
    const settled = [];
    for (const du of duels) {
      if (!endAt || endAt < du.acceptedAt) continue; // la partie doit avoir été jouée après l'acceptation du duel
      let pa, pb;
      try { pa = core.verifyTable(du.a, game, t, now); pb = core.verifyTable(du.b, game, t, now); } catch (e) { continue; } // l'un des deux n'y était pas
      let winner = pa.place < pb.place ? du.a : pb.place < pa.place ? du.b : null;
      if (game === 'roulette' && t.players && t.players[du.a] && t.players[du.b] && t.players[du.a].bankroll === t.players[du.b].bankroll) winner = null;
      const loser = winner === du.a ? du.b : du.a;
      await edit([du.a, du.b], (u) => (winner ? (u === winner ? 'duel.win' : 'duel.lose') : 'duel.draw'), (P) => {
        const cur = db.dealGet(du.id);
        if (!cur || cur.status !== 'accepted') fail('Déjà réglé.');
        const D = cur.data;
        if (winner) {
          giveMoney(P[winner], D.stake * 2);
          [D.aItem, D.bItem].filter(Boolean).forEach((k) => giveItem(P[winner], k));
          const what = (D.stake ? (D.stake * 2).toLocaleString('fr-FR') + ' €' : '') + ([D.aItem, D.bItem].filter(Boolean).length ? (D.stake ? ' + ' : '') + [D.aItem, D.bItem].filter(Boolean).map((k) => '« ' + keyName(k) + ' »').join(', ') : '');
          inbox(P[winner], '⚔️ Duel gagné !', 'Tu remportes ' + what + ' contre ' + nameOf(P[loser]) + '.', '🏆');
          inbox(P[loser], '⚔️ Duel perdu', nameOf(P[winner]) + ' remporte le duel. Revanche ?', '😤');
          R.unlock(P[winner], 'duel_win', []);
        } else {
          giveMoney(P[du.a], D.stake); giveMoney(P[du.b], D.stake);
          if (D.aItem) giveItem(P[du.a], D.aItem); if (D.bItem) giveItem(P[du.b], D.bItem);
          [du.a, du.b].forEach((u) => inbox(P[u], '⚔️ Égalité', 'Duel nul : chacun récupère sa mise.', '🤝'));
        }
        db.dealSet(du.id, { status: 'done', doneAt: Date.now(), winner: winner || '', table: tid });
      }).then(() => settled.push({ id: du.id, winner }), () => {});
    }
    return { settled };
  }
  /** Duels acceptés mais jamais joués (48 h) et propositions trop vieilles (7 jours) : tout est rendu. */
  async function expire() {
    await lotoExpire().catch(() => {});
    const now = Date.now();
    for (const t of db.dealsStale(now - 2 * DAY, now - 7 * DAY)) {
      try {
        if (t.type === 'duel' && t.status === 'accepted') {
          await edit([t.a, t.b], 'duel.refund', (P) => { const c = db.dealGet(t.id); if (c.status !== 'accepted') fail('x'); giveMoney(P[t.a], c.data.stake); giveMoney(P[t.b], c.data.stake); if (c.data.aItem) giveItem(P[t.a], c.data.aItem); if (c.data.bItem) giveItem(P[t.b], c.data.bItem); [t.a, t.b].forEach((u) => inbox(P[u], '⚔️ Duel annulé', 'Le duel n\'a pas été joué à temps : chacun récupère sa mise.', '↩️')); db.dealSet(t.id, { status: 'expired' }); });
        } else if (t.status === 'open') {
          await edit([t.a], t.type + '.refund', (P) => { const c = db.dealGet(t.id); if (c.status !== 'open') fail('x'); if (t.type === 'duel') { giveMoney(P[t.a], c.data.stake); if (c.data.aItem) giveItem(P[t.a], c.data.aItem); } else { c.data.give.items.forEach((k) => giveItem(P[t.a], k)); giveMoney(P[t.a], c.data.give.money); } inbox(P[t.a], '⏳ Proposition expirée', 'Pas de réponse : ce que tu avais mis en jeu t\'est rendu.', '↩️'); db.dealSet(t.id, { status: 'expired' }); });
        }
      } catch (e) { /* déjà traité */ }
    }
  }
  function list(uid) {
    const mine = db.dealsOf(uid, Date.now() - 7 * DAY).map((t) => ({
      id: t.id, type: t.type, status: t.status, created: t.created, acceptedAt: t.acceptedAt || null, me: t.a === uid ? 'a' : 'b', winner: t.winner ? (t.winner === uid ? 'me' : 'other') : null,
      other: t.a === uid ? { uid: t.b, name: t.data.bName } : { uid: t.a, name: t.data.aName },
      game: t.data.game || null, stake: t.data.stake || 0,
      aItem: t.data.aItem ? brief(t.data.aItem) : null, bItem: t.data.bItem ? brief(t.data.bItem) : null,
      give: t.data.give ? { items: t.data.give.items.map(brief), money: t.data.give.money } : null,
      want: t.data.want ? { items: t.data.want.items.map(brief), money: t.data.want.money } : null,
    }));
    return { deals: mine, market: db.marketOpenOf(uid).map((l) => ({ id: l.id, kind: l.kind, item: l.item, name: itemName(l.kind, l.item), rarity: l.rarity, price: l.price })) };
  }

  const OPS = {
    'mk.list': marketList, 'mk.cancel': marketCancel, 'mk.buy': marketBuy, 'mk.browse': marketBrowse,
    'trade.new': tradeNew, 'trade.accept': (u, d) => tradeAnswer(u, d, true), 'trade.decline': (u, d) => tradeAnswer(u, d, false),
    'trade.inventory': inventory,
    'duel.new': duelNew, 'duel.accept': (u, d) => duelAnswer(u, d, true), 'duel.decline': (u, d) => duelAnswer(u, d, false), 'duel.settle': duelSettle,
    'deals.list': list,
    'mk.of': (u, d) => ({ listings: db.marketOpenOf(String(d.uid || '')).slice(0, 20).map((l) => ({ id: l.id, kind: l.kind, item: l.item, name: itemName(l.kind, l.item), rarity: l.rarity, price: l.price })) }),
    'col.cotes': () => ({ cotes: cotes() }), 'col.sell': instantSell,
    'loto.buy': lotoBuy, 'loto.refund': lotoRefundOne, 'loto.settle': lotoSettle, 'loto.info': lotoInfo,
  };
  return { OPS, expire, isDealOp: (op) => Object.prototype.hasOwnProperty.call(OPS, op) };
};
