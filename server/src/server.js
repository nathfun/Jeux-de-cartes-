/*
 * Serveur du Casino pour un NAS (ou n'importe quel hébergeur) : Node.js + SQLite, dans un conteneur Docker.
 *
 * Une seule route utile : POST /api/casino  { op, data }  avec l'en-tête  Authorization: Bearer <jeton Firebase>.
 * Le serveur vérifie le jeton (le compte reste chez Firebase Auth : aucun mot de passe n'est stocké ici),
 * applique l'opération avec la même logique que l'app (functions/core.js : banque, défis, tirages des jeux),
 * enregistre le résultat dans SQLite et le journal d'argent, puis publie le profil public dans Firebase
 * (classement entre amis).
 *
 * Sécurité : pas de port à ouvrir sur la box (le trafic arrive par Tailscale Funnel ou Cloudflare Tunnel),
 * origines autorisées (CORS), taille des requêtes limitée, nombre de requêtes limité par joueur et par adresse,
 * conteneur sans droits root et en lecture seule (sauf /data).
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const core = require('../core/core.js');
const R = require('../core/shared/casino-rules.js');
const store = require('./store.js');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/data';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://nathfun.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'jeux-de-cartes-81cdf';
const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://jeux-de-cartes-81cdf-default-rtdb.europe-west1.firebasedatabase.app';
const MAX_BODY = 32 * 1024;
const TABLES = { blackjack: 'tables/', poker: 'ptables/', roulette: 'rtables/' };

// ---------- Firebase (vérification des comptes, profil public, lecture des tables entre amis) ----------
const admin = require('firebase-admin');
const hasCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
admin.initializeApp(Object.assign({ projectId: PROJECT_ID, databaseURL: DB_URL },
  process.env.GOOGLE_APPLICATION_CREDENTIALS ? { credential: admin.credential.applicationDefault() } : {}));
const rtdb = hasCreds ? admin.database() : null;
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.warn('[casino] Pas de compte de service Firebase : le profil public et les prix entre amis ne seront pas publiés.');
}

const db = store.open(DATA_DIR);

// ---------- Limites anti-abus ----------
// seau de jetons : `rate` requêtes par seconde en moyenne, `burst` d'un coup
function limiter(rate, burst) {
  const m = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of m) if (t - v.t > 600000) m.delete(k); }, 60000).unref();
  return (key) => {
    const t = Date.now();
    const b = m.get(key) || { n: burst, t };
    b.n = Math.min(burst, b.n + ((t - b.t) / 1000) * rate); b.t = t;
    if (b.n < 1) { m.set(key, b); return false; }
    b.n -= 1; m.set(key, b); return true;
  };
}
const perUser = limiter(12, 40);   // un joueur : 12 actions/s en moyenne (lâcher des billes en rafale…)
const perIp = limiter(40, 120);    // une adresse : un peu plus (plusieurs joueurs derrière la même box)

// Une opération à la fois par joueur : deux requêtes simultanées ne peuvent pas dépenser deux fois le même argent
const queues = new Map();
function serial(uid, fn) {
  const prev = queues.get(uid) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(uid, next);
  next.finally(() => { if (queues.get(uid) === next) queues.delete(uid); }).catch(() => {});
  return next;
}

// ---------- Réponses ----------
function headers(req) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000',
    'Vary': 'Origin',
  };
  const o = req.headers.origin;
  if (o && (ORIGINS.includes(o) || ORIGINS.includes('*'))) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
function send(req, res, code, body) { res.writeHead(code, headers(req)); res.end(JSON.stringify(body)); }
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- Opération d'un joueur ----------
// Comptes bloqués par l'administrateur (banned/<uid> dans Firebase), relus au plus toutes les 30 s
const banCache = new Map();
async function isBanned(uid) {
  if (!rtdb) return false;
  const c = banCache.get(uid);
  if (c && Date.now() - c.t < 30000) return c.v;
  const v = !!(await rtdb.ref('banned/' + uid).get().then((x) => x.val()).catch(() => null));
  banCache.set(uid, { v, t: Date.now() });
  return v;
}
// Administrateurs : admins/<uid> = true dans Firebase
async function isAdmin(uid) { return !!rtdb && (await rtdb.ref('admins/' + uid).get().then((x) => x.val()).catch(() => null)) === true; }

async function casino(uid, token, op, data) {
  // un visiteur sans compte (connexion anonyme) ne crée rien sur le serveur : il faut un compte pour jouer
  if (token.firebase && token.firebase.sign_in_provider === 'anonymous') throw userError('Connecte-toi à ton compte pour jouer.');
  if (await isBanned(uid)) throw userError('Ton compte a été bloqué par l\'administrateur du Casino.');
  const ctx = {
    uid, op, data: data || {}, anon: token.firebase && token.firebase.sign_in_provider === 'anonymous',
    rnd: (n) => crypto.randomInt(n),
  };
  // lectures préalables dans Firebase : table entre amis (prix), code ami (profil public)
  if (op === 'multi.prize') {
    const game = String(ctx.data.game), id = String(ctx.data.table || '');
    if (!TABLES[game] || !/^[A-Z0-9]{3,8}$/.test(id)) throw userError('Table invalide.');
    const t = rtdb ? (await rtdb.ref(TABLES[game] + id).get()).val() : null;
    ctx.table = t ? Object.assign({ id }, t) : null;
  }
  if (op === 'profile.set' && typeof ctx.data.code === 'string' && /^[A-Z0-9]{6}$/.test(ctx.data.code)) {
    ctx.codeOk = rtdb ? (await rtdb.ref('friendcodes/' + ctx.data.code).get()).val() === uid : false;
  }
  // premier passage d'un joueur sur ce serveur : on reprend sa progression depuis Firebase (une seule fois)
  const imported = db.has(uid) ? null : await importFromFirebase(uid);
  return serial(uid, async () => {
    let before = db.load(uid);
    if (!before.player && imported) before = { player: imported, secret: {} };
    const copy = JSON.parse(JSON.stringify(before));
    ctx.now = Date.now();
    const out = core.handle(copy, ctx);          // lève une GameError si l'action est refusée : rien n'est enregistré
    db.save(uid, op, before, out.state, ctx.now);
    const P = out.state.player;
    if (rtdb) rtdb.ref('profiles/' + uid).update(R.publicProfile(P, P.friendCode)).catch((e) => console.error('[casino] profil', e.message));
    return { result: out.result, notes: out.notes, player: P };
  });
}
/**
 * Reprise d'un joueur qui jouait avant le serveur du NAS : sa sauvegarde de compte (saves/<uid> : niveau, succès,
 * objets, statistiques) et sa banque protégée (bank/<uid>). L'argent laissé sur une table en cours lui est rendu.
 */
async function importFromFirebase(uid) {
  if (!rtdb) return null;
  try {
    const [sv, bank, pub] = await Promise.all([rtdb.ref('saves/' + uid).get(), rtdb.ref('bank/' + uid).get(), rtdb.ref('profiles/' + uid).get()]);
    const save = sv.val(), b = bank.val(), pr = pub.val();
    if (!save && !b) return null;
    const data = save && save.data ? JSON.parse(save.data) : {};
    const P = R.normalize(data, Date.now());
    if (!P.pseudo && pr && pr.pseudo) P.pseudo = String(pr.pseudo).slice(0, 16);
    if (!P.avatar && pr && pr.avatar) P.avatar = pr.avatar;
    if (b && typeof b.wallet === 'number') {
      const onTables = Object.values(b.ses || {}).reduce((a, v) => a + (Number(v) || 0), 0);
      P.wallet = Math.round((b.wallet + onTables) * 100) / 100;
    } else {
      P.wallet = Math.round(((P.wallet || 0) + Object.values(P.sessions || {}).reduce((a, x) => a + (x.stack || 0), 0)) * 100) / 100;
    }
    P.sessions = {};
    P.timebank = (b && b.tb) ? P.timebank : null;
    console.log('[casino] joueur repris depuis Firebase : ' + uid.slice(0, 6) + '…');
    return P;
  } catch (e) { console.error('[casino] reprise impossible', e.message); return null; }
}
const userError = (msg) => Object.assign(new Error(msg), { userMessage: msg });

// ---------- Administration (page admin/) ----------
const sum = (o) => Object.values(o || {}).reduce((a, s) => a + (s.stack || 0), 0);
const r2 = (v) => Math.round(v * 100) / 100;
function brief(uid, st, created, updated) {
  const P = st.player || {};
  return { uid, pseudo: P.pseudo || '(sans pseudo)', avatar: P.avatar || '🎩', xp: P.xp || 0, level: R.levelOf(P.xp || 0), wallet: r2(P.wallet || 0), onTables: r2(sum(P.sessions)),
    sessions: Object.fromEntries(Object.entries(P.sessions || {}).map(([g, x]) => [g, x.stack])), achievements: Object.keys(P.achievements || {}).length, owned: Object.keys(P.owned || {}).length,
    hands: (P.totals && P.totals.hands) || 0, created, updated };
}
// applique une modification de l'administrateur à un joueur, avec une ligne au journal de l'argent
function adminEdit(target, op, fn) {
  return serial(target, async () => {
    const before = db.load(target);
    if (!before.player) throw userError('Joueur introuvable sur le serveur.');
    const after = JSON.parse(JSON.stringify(before));
    after.player = R.normalize(after.player, Date.now());
    fn(after.player, after);
    db.save(target, 'admin:' + op, before, after, Date.now());
    if (rtdb) rtdb.ref('profiles/' + target).update(R.publicProfile(after.player, after.player.friendCode)).catch(() => {});
    return brief(target, after);
  });
}
async function adminOp(uid, op, d) {
  if (!(await isAdmin(uid))) throw userError('Réservé aux administrateurs.');
  const target = typeof d.uid === 'string' ? d.uid : '';
  const now = Date.now();
  switch (op) {
    case 'list': {
      const bans = rtdb ? ((await rtdb.ref('banned').get()).val() || {}) : {};
      const players = db.all().map((r) => Object.assign(brief(r.uid, r.state, r.created, r.updated), { banned: !!bans[r.uid] }));
      return { players, stats: db.stats() };
    }
    case 'get': {
      const st = db.load(target);
      if (!st.player) throw userError('Joueur introuvable sur le serveur.');
      return { brief: brief(target, st), owned: st.player.owned || {}, achievements: st.player.achievements || {}, ledger: db.ledgerOf(target, 40) };
    }
    case 'wallet': {
      const v = Math.max(0, Math.min(1e9, Math.round(Number(d.wallet))));
      if (!Number.isFinite(v)) throw userError('Montant invalide.');
      return adminEdit(target, 'wallet', (P) => { P.wallet = v; });
    }
    case 'profile': {
      return adminEdit(target, 'profile', (P) => {
        if (typeof d.pseudo === 'string' && d.pseudo.trim()) P.pseudo = d.pseudo.trim().slice(0, 16);
        if (Number.isInteger(d.level) && d.level >= 1 && d.level <= 99 && R.levelOf(P.xp || 0) !== d.level) P.xp = R.need(d.level);
        if (d.owned && typeof d.owned === 'object') { const o = {}; Object.keys(d.owned).forEach((k) => { if (/^[a-z]+:[^:]{1,40}$/.test(k)) o[k] = (P.owned || {})[k] || now; }); P.owned = o; }
        if (d.achievements && typeof d.achievements === 'object') { const a = {}; R.ACHIEVEMENTS.forEach((x) => { if (d.achievements[x.id]) a[x.id] = (P.achievements || {})[x.id] || now; }); P.achievements = a; }
      });
    }
    case 'close': return adminEdit(target, 'close', (P, st) => { P.wallet = r2((P.wallet || 0) + sum(P.sessions)); P.sessions = {}; st.secret = {}; });
    case 'reset': return adminEdit(target, 'reset', (P, st) => {
      const keep = { pseudo: P.pseudo, avatar: P.avatar, friendCode: P.friendCode };
      Object.keys(P).forEach((k) => delete P[k]); Object.assign(P, R.fresh(now), keep); st.secret = {};
    });
    case 'delete': {
      if (target === uid) throw userError('Tu ne peux pas supprimer ton propre compte.');
      await serial(target, async () => { db.remove(target); });
      if (rtdb) await Promise.all(['profiles/', 'saves/', 'bank/', 'invites/'].map((p) => rtdb.ref(p + target).remove().catch(() => {})));
      return { deleted: true };
    }
    case 'gift': {
      const v = Math.round(Number(d.amount));
      if (!(v > 0 && v <= 1e6)) throw userError('Montant invalide.');
      const bans = rtdb ? ((await rtdb.ref('banned').get()).val() || {}) : {};
      let n = 0;
      for (const r of db.all()) { if (bans[r.uid]) continue; await adminEdit(r.uid, 'gift', (P) => { P.wallet = r2((P.wallet || 0) + v); }); n++; }
      return { count: n };
    }
    default: throw userError('Opération inconnue.');
  }
}

// ---------- Serveur HTTP ----------
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, headers(req)); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/health') { send(req, res, 200, Object.assign({ ok: true, at: Date.now() }, db.stats())); return; }
    if (req.method !== 'POST' || (url.pathname !== '/api/casino' && url.pathname !== '/api/admin')) { send(req, res, 404, { error: 'Introuvable.' }); return; }
    if (req.headers.origin && !ORIGINS.includes(req.headers.origin) && !ORIGINS.includes('*')) { send(req, res, 403, { error: 'Origine non autorisée.' }); return; }
    if (!perIp(clientIp(req))) { send(req, res, 429, { error: 'Trop de requêtes : ralentis un peu.' }); return; }
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) { send(req, res, 401, { error: 'Connexion requise.' }); return; }
    let token;
    try { token = await admin.auth().verifyIdToken(auth.slice(7)); } catch (e) { send(req, res, 401, { error: 'Session expirée : reconnecte-toi.' }); return; }
    if (!perUser(token.uid)) { send(req, res, 429, { error: 'Trop de requêtes : ralentis un peu.' }); return; }
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { send(req, res, e.status || 400, { error: 'Requête invalide.' }); return; }
    if (!body || typeof body.op !== 'string' || body.op.length > 40) { send(req, res, 400, { error: 'Opération manquante.' }); return; }
    if (body.data !== undefined && (typeof body.data !== 'object' || Array.isArray(body.data))) { send(req, res, 400, { error: 'Données invalides.' }); return; }
    if (url.pathname === '/api/admin') {
      const out = await adminOp(token.uid, body.op, body.data || {});
      console.log('[casino] admin ' + token.uid.slice(0, 6) + '… ' + body.op + (body.data && body.data.uid ? ' → ' + String(body.data.uid).slice(0, 6) + '…' : ''));
      send(req, res, 200, out);
      return;
    }
    const out = await casino(token.uid, token, body.op, body.data);
    send(req, res, 200, out);
  } catch (e) {
    if (e && e.userMessage) { send(req, res, 422, { error: e.userMessage }); return; }
    console.error('[casino] erreur', e);
    send(req, res, 500, { error: 'Erreur du serveur.' });
  }
});
server.headersTimeout = 15000;
server.requestTimeout = 20000;
server.keepAliveTimeout = 5000;
server.listen(PORT, () => console.log('[casino] serveur prêt sur le port ' + PORT + ' · origines : ' + ORIGINS.join(', ')));

// arrêt propre (mise à jour du conteneur) : on termine les requêtes en cours puis on ferme la base
function stop() { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
