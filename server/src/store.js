/*
 * Stockage du serveur : une base SQLite (fichier unique, sauvegardable) dans /data.
 *  - players : l'état complet de chaque joueur (profil, banque, parties en cours, secrets des jeux) ;
 *  - ledger  : le journal de TOUS les mouvements d'argent (qui, quand, quelle opération, avant / après) :
 *              chaque euro virtuel est traçable, une triche ou un bug d'argent se voit immédiatement.
 * node:sqlite est inclus dans Node.js : aucune dépendance à installer.
 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'casino.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS players (
      uid TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      at INTEGER NOT NULL,
      op TEXT NOT NULL,
      wallet_before REAL NOT NULL,
      wallet_after REAL NOT NULL,
      table_before REAL NOT NULL,
      table_after REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_uid ON ledger(uid, at);
    CREATE TABLE IF NOT EXISTS hall (
      month TEXT NOT NULL,
      board TEXT NOT NULL,
      uid TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      machine TEXT NOT NULL,
      jackpot TEXT,
      at INTEGER NOT NULL,
      PRIMARY KEY (month, board)
    );
  `);
  // notifications push : abonnements (un par appareil) et derniers rappels envoyés
  db.exec(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, uid TEXT NOT NULL, sub TEXT NOT NULL, prefs TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS push_uid ON push_subs(uid);
    CREATE TABLE IF NOT EXISTS push_state (uid TEXT NOT NULL, k TEXT NOT NULL, v TEXT, PRIMARY KEY (uid, k));`);
  // entre joueurs : marché, échanges et duels (l'objet complet en JSON, quelques colonnes pour chercher)
  db.exec(`CREATE TABLE IF NOT EXISTS market (id TEXT PRIMARY KEY, seller TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL, rarity TEXT, price REAL NOT NULL, created INTEGER NOT NULL, obj TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS market_open ON market(status, kind, price);
    CREATE TABLE IF NOT EXISTS deals (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, obj TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS deals_a ON deals(a, status); CREATE INDEX IF NOT EXISTS deals_b ON deals(b, status);`);
  // loto entre amis : ce que chaque joueur a payé pour ses cartons (cagnotte d'une salle)
  db.exec(`CREATE TABLE IF NOT EXISTS loto (tid TEXT NOT NULL, uid TEXT NOT NULL, name TEXT, paid REAL NOT NULL, cards INTEGER NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (tid, uid));`);
  // nouvelle économie (÷ 10) : les records déjà enregistrés sont convertis une seule fois
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  if (!db.prepare("SELECT v FROM meta WHERE k = 'econ'").get()) {
    db.exec('UPDATE hall SET amount = ROUND(amount / 10.0, 2)');
    db.exec("INSERT INTO meta (k, v) VALUES ('econ', '2')");
  }
  const get = db.prepare('SELECT state FROM players WHERE uid = ?');
  const ins = db.prepare('INSERT INTO players (uid, state, created, updated) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET state = excluded.state, updated = excluded.updated');
  const led = db.prepare('INSERT INTO ledger (uid, at, op, wallet_before, wallet_after, table_before, table_after) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // « table » du journal = la caisse de la partie du Parrain en cours (caisse + argent posé sur les jeux), en €
  const tableSum = (P) => (P && P.run && P.run.status !== 'over' ? P.run.cash || 0 : 0) + (P && P.sessions ? Object.values(P.sessions).reduce((a, s) => a + (s.stack || 0), 0) : 0);
  const money = (P) => ({ w: P ? Math.round((P.wallet || 0) * 100) / 100 : 0, t: Math.round(tableSum(P) * 100) / 100 });

  return {
    db,
    load(uid) { const row = get.get(uid); return row ? JSON.parse(row.state) : {}; },
    has(uid) { return !!get.get(uid); },
    /** Enregistre le nouvel état et, si l'argent a bougé, une ligne de journal — le tout en une transaction. */
    save(uid, op, before, after, now) {
      const a = money(before.player), b = money(after.player);
      db.exec('BEGIN IMMEDIATE');
      try {
        ins.run(uid, JSON.stringify(after), now, now);
        if (a.w !== b.w || a.t !== b.t) led.run(uid, now, op, a.w, b.w, a.t, b.t);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    /** Liste de tous les joueurs (pour l'administration). */
    all() { return db.prepare('SELECT uid, state, created, updated FROM players ORDER BY updated DESC').all().map((r) => ({ uid: r.uid, state: JSON.parse(r.state), created: r.created, updated: r.updated })); },
    remove(uid) { db.prepare('DELETE FROM players WHERE uid = ?').run(uid); },
    ledgerOf(uid, n) { return db.prepare('SELECT at, op, wallet_before, wallet_after, table_before, table_after FROM ledger WHERE uid = ? ORDER BY id DESC LIMIT ?').all(uid, n || 50).map((r) => Object.assign({}, r)); },
    /** Record du mois (le plus gros gain) : remplacé seulement s'il est battu. */
    record(board, month, rec) {
      const cur = db.prepare('SELECT amount FROM hall WHERE month = ? AND board = ?').get(month, board);
      if (cur && cur.amount >= rec.amount) return false;
      db.prepare('INSERT INTO hall (month, board, uid, name, amount, machine, jackpot, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(month, board) DO UPDATE SET uid = excluded.uid, name = excluded.name, amount = excluded.amount, machine = excluded.machine, jackpot = excluded.jackpot, at = excluded.at')
        .run(month, board, rec.uid, rec.name, rec.amount, rec.machine, rec.jackpot || null, rec.at);
      return true;
    },
    hall(board, month) { const r = db.prepare('SELECT name, amount, machine, jackpot, at FROM hall WHERE month = ? AND board = ?').get(month, board); return r ? Object.assign({}, r) : null; },
    /** Mouvements d'argent depuis `since` (tableau de bord). */
    ledgerSince(since) { return db.prepare('SELECT uid, at, op, wallet_before wb, wallet_after wa, table_before tb, table_after ta FROM ledger WHERE at >= ? ORDER BY at').all(since).map((r) => Object.assign({}, r)); },
    stats() {
      return {
        players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
        ledger: db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,
      };
    },
    pushAdd(uid, sub, prefs) { db.prepare('INSERT INTO push_subs (endpoint, uid, sub, prefs, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET uid = excluded.uid, sub = excluded.sub, prefs = excluded.prefs').run(sub.endpoint, uid, JSON.stringify(sub), JSON.stringify(prefs || {}), Date.now()); },
    pushRemove(endpoint) { db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint); },
    pushOf(uid) { return db.prepare('SELECT endpoint, sub, prefs FROM push_subs WHERE uid = ?').all(uid).map((r) => ({ endpoint: r.endpoint, sub: JSON.parse(r.sub), prefs: JSON.parse(r.prefs) })); },
    pushUids() { return db.prepare('SELECT DISTINCT uid FROM push_subs').all().map((r) => r.uid); },
    pushCount() { return db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n; },
    getState(uid, k) { const r = db.prepare('SELECT v FROM push_state WHERE uid = ? AND k = ?').get(uid, k); return r ? r.v : null; },
    setState(uid, k, v) { db.prepare('INSERT INTO push_state (uid, k, v) VALUES (?, ?, ?) ON CONFLICT(uid, k) DO UPDATE SET v = excluded.v').run(uid, k, String(v)); },
    // ----- marché -----
    marketPut(l) { db.prepare('INSERT INTO market (id, seller, status, kind, rarity, price, created, obj) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(l.id, l.seller, l.status, l.kind, l.rarity || '', l.price, l.created, JSON.stringify(l)); },
    marketGet(id) { const r = db.prepare('SELECT obj FROM market WHERE id = ?').get(id); return r ? JSON.parse(r.obj) : null; },
    marketSet(id, patch) { const l = Object.assign(this.marketGet(id) || {}, patch); db.prepare('UPDATE market SET status = ?, obj = ? WHERE id = ?').run(l.status, JSON.stringify(l), id); return l; },
    marketOpen(kind, rarity, n) { return db.prepare("SELECT obj FROM market WHERE status = 'open' AND (? = '' OR kind = ?) AND (? = '' OR rarity = ?) ORDER BY price ASC LIMIT ?").all(kind, kind, rarity, rarity, n || 100).map((r) => JSON.parse(r.obj)); },
    marketOpenOf(uid) { return db.prepare("SELECT obj FROM market WHERE status = 'open' AND seller = ? ORDER BY created DESC").all(uid).map((r) => JSON.parse(r.obj)); },
    marketSoldSince(t) { return db.prepare("SELECT obj FROM market WHERE status = 'sold' AND created >= ?").all(t).map((r) => JSON.parse(r.obj)); },
    // ----- échanges et duels -----
    dealPut(t) { db.prepare('INSERT INTO deals (id, a, b, status, created, obj) VALUES (?, ?, ?, ?, ?, ?)').run(t.id, t.a, t.b, t.status, t.created, JSON.stringify(t)); },
    dealGet(id) { const r = db.prepare('SELECT obj FROM deals WHERE id = ?').get(id); return r ? JSON.parse(r.obj) : null; },
    dealSet(id, patch) { const t = Object.assign(this.dealGet(id) || {}, patch); db.prepare('UPDATE deals SET status = ?, obj = ? WHERE id = ?').run(t.status, JSON.stringify(t), id); return t; },
    dealsOpenOf(uid) { return db.prepare("SELECT obj FROM deals WHERE (a = ? OR b = ?) AND status IN ('open', 'accepted')").all(uid, uid).map((r) => JSON.parse(r.obj)); },
    dealsOf(uid, since) { return db.prepare("SELECT obj FROM deals WHERE (a = ? OR b = ?) AND (status IN ('open', 'accepted') OR created >= ?) ORDER BY created DESC LIMIT 60").all(uid, uid, since).map((r) => JSON.parse(r.obj)); },
    dealsStale(acceptedBefore, openBefore) { return db.prepare("SELECT obj FROM deals WHERE status IN ('open', 'accepted')").all().map((r) => JSON.parse(r.obj)).filter((t) => (t.status === 'accepted' ? (t.acceptedAt || t.created) < acceptedBefore : t.created < openBefore)); },
    /** Copie complète et cohérente de la base (même pendant que le serveur tourne). */
    backup(file) { const q = String(file).replace(/'/g, "''"); db.exec("VACUUM INTO '" + q + "'"); },
    lotoGet(tid) { return db.prepare('SELECT tid, uid, name, paid, cards, at, status FROM loto WHERE tid = ?').all(tid).map((r) => Object.assign({}, r)); },
    lotoPut(r) { db.prepare('INSERT INTO loto (tid, uid, name, paid, cards, at, status) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tid, uid) DO UPDATE SET name = excluded.name, paid = excluded.paid, cards = excluded.cards, at = excluded.at, status = excluded.status').run(r.tid, r.uid, r.name || '', r.paid, r.cards, r.at, r.status); },
    lotoSetStatus(tid, status) { db.prepare('UPDATE loto SET status = ? WHERE tid = ?').run(status, tid); },
    lotoStale(before) { return db.prepare("SELECT DISTINCT tid FROM loto WHERE status = 'paid' AND at < ?").all(before).map((r) => r.tid); },
    close() { db.close(); },
  };
}
module.exports = { open };
