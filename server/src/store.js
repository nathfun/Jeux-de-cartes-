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
  `);
  const get = db.prepare('SELECT state FROM players WHERE uid = ?');
  const ins = db.prepare('INSERT INTO players (uid, state, created, updated) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET state = excluded.state, updated = excluded.updated');
  const led = db.prepare('INSERT INTO ledger (uid, at, op, wallet_before, wallet_after, table_before, table_after) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const tableSum = (P) => (P && P.sessions ? Object.values(P.sessions).reduce((a, s) => a + (s.stack || 0), 0) : 0);
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
    stats() {
      return {
        players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
        ledger: db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,
      };
    },
    close() { db.close(); },
  };
}
module.exports = { open };
