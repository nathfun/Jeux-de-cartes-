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
// version du serveur (affichée dans l'admin et sur /health) : à changer à chaque mise à jour du serveur
const SERVER_VERSION = '2026.11.27-7';
const TABLES = { blackjack: 'tables/', poker: 'ptables/', roulette: 'rtables/', loto: 'ltables/' };

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

// ---------- Notifications push (rappels : coffre plein, bonus, amis) ----------
const webpush = require('web-push');
const SITE = process.env.SITE_URL || 'https://nathfun.github.io/Jeux-de-cartes-/';
const vapid = (() => {
  if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) return { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
  const f = require('path').join(DATA_DIR, 'vapid.json');
  try { return JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch (e) { /* première fois */ }
  const k = webpush.generateVAPIDKeys();
  try { require('fs').writeFileSync(f, JSON.stringify(k), { mode: 0o600 }); } catch (e) { console.error('[casino] clés push non enregistrées', e.message); }
  return k;
})();
webpush.setVapidDetails(SITE, vapid.publicKey, vapid.privateKey);
const PUSH_PREFS = ['chest', 'bonus', 'friends', 'social'];
/** Envoie une notification à tous les appareils d'un joueur (type : chest, bonus, friends, social). */
async function pushTo(uid, type, msg) {
  let n = 0;
  for (const s of db.pushOf(uid)) {
    if (s.prefs && s.prefs[type] === false) continue;
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title: msg.title, body: msg.body, url: msg.url || SITE, tag: msg.tag || type }), { TTL: 6 * 3600, urgency: 'normal' });
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.pushRemove(s.endpoint); // abonnement expiré
      else console.error('[casino] push', e.statusCode || '', e.message);
    }
  }
  return n;
}
function parisHour(t) { try { return Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date(t))); } catch (e) { return new Date(t).getHours(); } }
let pushBusy = false;
async function pushRound() {
  if (pushBusy) return; pushBusy = true;
  try {
    const t = Date.now(), h = parisHour(t), day = R.today(t);
    const quiet = h < 9 || h >= 22; // pas de notification la nuit
    for (const uid of db.pushUids()) {
      const st = db.load(uid), P = st.player;
      if (!P) continue;
      // 🧰 coffre plein (une fois par remplissage)
      const c = R.chestInfo(P, t);
      if (c.full && !quiet && db.getState(uid, 'chest') !== String(P.chestAt)) {
        db.setState(uid, 'chest', P.chestAt);
        await pushTo(uid, 'chest', { title: '🧰 Ton coffre est plein !', body: c.cap + ' € t\'attendent. Ouvre-le pour qu\'il recommence à se remplir.', tag: 'chest' });
      }
      // 🎁 bonus du jour + roue (une fois par jour, en fin d'après-midi)
      if (h >= 17 && h < 21 && db.getState(uid, 'bonus') !== day && (!P.bonus || P.bonus.last !== day)) {
        db.setState(uid, 'bonus', day);
        const streak = P.bonus && P.bonus.last === R.yesterday(t) ? P.bonus.streak : 0;
        await pushTo(uid, 'bonus', { title: '🎁 Ton bonus du jour t\'attend', body: (streak ? 'Ne casse pas ta série de ' + streak + ' jour' + (streak > 1 ? 's' : '') + ' ! ' : '') + 'Et un tour de roue gratuit, jusqu\'à 1 000 €.', tag: 'bonus' });
      }
      // 🏆 un ami passe devant au classement « Gains du mois »
      const subs = db.pushOf(uid), friends = [...new Set(subs.flatMap((s) => (s.prefs && s.prefs.friendList) || []))].slice(0, 100);
      if (friends.length && !quiet) {
        const mine = monthNetOf(P, t);
        const ahead = friends.filter((f) => { const F = db.load(f).player; return F && monthNetOf(F, t) > mine; });
        const before = JSON.parse(db.getState(uid, 'ahead:' + R.seasonOf(t)) || 'null');
        if (before) {
          const fresh = ahead.filter((f) => !before.includes(f));
          if (fresh.length) {
            const F = db.load(fresh[0]).player;
            await pushTo(uid, 'friends', { title: '🏆 ' + (F.pseudo || 'Un ami') + ' t\'a dépassé !', body: 'Il est devant toi dans les gains du mois (+' + Math.round(monthNetOf(F, t)).toLocaleString('fr-FR') + ' €). Reprends ta place !', tag: 'friends' });
          }
        }
        db.setState(uid, 'ahead:' + R.seasonOf(t), JSON.stringify(ahead));
      }
    }
  } catch (e) { console.error('[casino] tournée des rappels', e.message); }
  pushBusy = false;
}
const monthNetOf = (P, t) => (P.season && P.season.id === R.seasonOf(t) ? P.season.net || 0 : 0);
setInterval(pushRound, 5 * 60000).unref();
setTimeout(pushRound, 30000).unref();

// ---------- Entre joueurs : marché, échanges, duels ----------
const publishProfile = (u, P) => { if (rtdb) rtdb.ref('profiles/' + u).update(R.publicProfile(P, P.friendCode)).catch(() => {}); };
let deals = null; // créé plus bas (a besoin de serial)

// ---------- Sauvegardes automatiques de la base ----------
// Chaque nuit (vers 4 h, heure de Paris) : une copie complète dans data/backups. On garde 7 jours + 4 dimanches.
const path = require('path');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 7), KEEP_WEEKS = Number(process.env.BACKUP_KEEP_WEEKS || 4);
function listBackups() {
  try {
    return require('fs').readdirSync(BACKUP_DIR).filter((f) => /^casino-\d{4}-\d{2}-\d{2}(-\d{4})?\.db$/.test(f)).sort().reverse()
      .map((f) => { const st = require('fs').statSync(path.join(BACKUP_DIR, f)); return { file: f, size: st.size, at: st.mtimeMs }; });
  } catch (e) { return []; }
}
function makeBackup(manual) {
  const fsx = require('fs');
  fsx.mkdirSync(BACKUP_DIR, { recursive: true });
  const t = Date.now(), day = R.today(t);
  const name = 'casino-' + day + (manual ? '-' + String(new Date(t).getHours()).padStart(2, '0') + String(new Date(t).getMinutes()).padStart(2, '0') : '') + '.db';
  const file = path.join(BACKUP_DIR, name), tmp = file + '.tmp';
  try { fsx.rmSync(tmp, { force: true }); } catch (e) { /* ignore */ }
  db.backup(tmp);
  fsx.renameSync(tmp, file);
  // les clés des notifications vont avec la base (sans elles, les abonnements ne marchent plus)
  try { fsx.copyFileSync(path.join(DATA_DIR, 'vapid.json'), path.join(BACKUP_DIR, 'vapid.json')); } catch (e) { /* pas encore de clés */ }
  // ménage : les KEEP_DAYS plus récentes + une par semaine (le dimanche) sur KEEP_WEEKS semaines
  const daily = listBackups().filter((b) => /^casino-\d{4}-\d{2}-\d{2}\.db$/.test(b.file));
  const keep = new Set(daily.slice(0, KEEP_DAYS).map((b) => b.file));
  daily.filter((b) => new Date(b.file.slice(7, 17) + 'T12:00:00Z').getUTCDay() === 0).slice(0, KEEP_WEEKS).forEach((b) => keep.add(b.file));
  daily.forEach((b) => { if (!keep.has(b.file)) try { fsx.rmSync(path.join(BACKUP_DIR, b.file)); } catch (e) { /* ignore */ } });
  listBackups().filter((b) => !/^casino-\d{4}-\d{2}-\d{2}\.db$/.test(b.file)).slice(5).forEach((b) => { try { fsx.rmSync(path.join(BACKUP_DIR, b.file)); } catch (e) { /* ignore */ } });
  const size = fsx.statSync(file).size;
  console.log('[casino] sauvegarde ' + name + ' (' + Math.round(size / 1024) + ' Ko)');
  return { file: name, size, at: t };
}
let lastBackupError = null;
function backupTick() {
  try {
    const t = Date.now(), day = R.today(t);
    if (parisHour(t) < 4) return;
    if (listBackups().some((b) => b.file === 'casino-' + day + '.db')) return;
    makeBackup(false); lastBackupError = null;
  } catch (e) { lastBackupError = { at: Date.now(), msg: e.message }; console.error('[casino] sauvegarde impossible', e.message); }
}
setInterval(backupTick, 10 * 60000).unref();
setTimeout(backupTick, 60000).unref();

// ---------- Mesures (page « État du serveur » de l'admin) ----------
const os = require('os');
const fs = require('fs');
const M = { start: Date.now(), reqs: [], errors: [], seen: new Map(), limited: 0 };
function measure(code, ms, uid, op, msg) {
  const t = Date.now();
  M.reqs.push({ t, code, ms, op });
  if (M.reqs.length > 20000 || (M.reqs[0] && t - M.reqs[0].t > 3600000)) M.reqs = M.reqs.filter((r) => t - r.t <= 3600000);
  if (uid) M.seen.set(uid, t);
  if (code === 429) M.limited++;
  if (code >= 500) { M.errors.push({ t, op: op || '', msg: String(msg || 'erreur').slice(0, 200) }); if (M.errors.length > 30) M.errors.shift(); }
}
function status() {
  const t = Date.now(), last = (ms) => M.reqs.filter((r) => t - r.t <= ms);
  const h = last(3600000), lat = h.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
  const minutes = []; for (let k = 59; k >= 0; k--) { const a = t - (k + 1) * 60000, b = t - k * 60000; const rs = h.filter((r) => r.t > a && r.t <= b); minutes.push({ n: rs.length, err: rs.filter((r) => r.code >= 500).length, ms: rs.length ? Math.round(rs.reduce((x, r) => x + r.ms, 0) / rs.length) : 0 }); }
  const ops = {}; h.forEach((r) => { if (r.op) ops[r.op] = (ops[r.op] || 0) + 1; });
  let dbSize = 0; try { ['casino.db', 'casino.db-wal'].forEach((f) => { try { dbSize += fs.statSync(require('path').join(DATA_DIR, f)).size; } catch (e) { /* absent */ } }); } catch (e) { /* ignore */ }
  const mem = process.memoryUsage();
  const online = (ms) => [...M.seen.values()].filter((v) => t - v <= ms).length;
  return {
    at: t, version: SERVER_VERSION, uptime: t - M.start, node: process.version, firebase: !!rtdb,
    memory: { rss: mem.rss, heap: mem.heapUsed, limit: Number(process.env.MEM_LIMIT_MB || 256) * 1048576 },
    load: os.loadavg().map((x) => Math.round(x * 100) / 100), cpus: os.cpus().length,
    db: Object.assign({ size: dbSize, push: db.pushCount() }, db.stats()),
    requests: { m5: last(300000).length, h1: h.length, rejected: h.filter((r) => r.code === 422).length, errors: h.filter((r) => r.code >= 500).length, limited: M.limited },
    latency: { avg: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0, p50: pct(0.5), p95: pct(0.95), max: lat.length ? lat[lat.length - 1] : 0 },
    online: { m5: online(300000), h1: online(3600000) },
    minutes, topOps: Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 8), errors: M.errors.slice().reverse(),
  };
}

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

deals = require('./deals.js')({ db, serial, R, core, rtdb, TABLES, pushTo, userError: (m) => Object.assign(new Error(m), { userMessage: m }), publish: publishProfile });
setInterval(() => { deals.expire().catch((e) => console.error('[casino] expiration', e.message)); }, 10 * 60000).unref();

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
  // abonnements aux notifications : gérés ici (pas d'argent en jeu)
  if (op === 'push.sub' || op === 'push.unsub') {
    if (token.firebase && token.firebase.sign_in_provider === 'anonymous') throw userError('Connecte-toi à ton compte.');
    const d = data || {}, sub = d.sub || {};
    if (typeof sub.endpoint !== 'string' || !/^https:\/\/[^\s]{10,500}$/.test(sub.endpoint)) throw userError('Abonnement invalide.');
    if (op === 'push.unsub') { db.pushRemove(sub.endpoint); return { result: { ok: true } }; }
    if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string' || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) throw userError('Abonnement invalide.');
    const prefs = {}; PUSH_PREFS.forEach((k) => { prefs[k] = !(d.prefs && d.prefs[k] === false); });
    prefs.friendList = Array.isArray(d.friends) ? d.friends.filter((f) => typeof f === 'string' && /^[A-Za-z0-9]{10,40}$/.test(f) && f !== uid).slice(0, 100) : [];
    db.pushAdd(uid, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, prefs);
    if (d.test) await pushTo(uid, 'chest', { title: '🔔 Notifications activées', body: 'Tu seras prévenu quand ton coffre est plein, pour ton bonus et quand un ami te dépasse.', tag: 'test' });
    return { result: { ok: true } };
  }
  // un visiteur sans compte (connexion anonyme) ne crée rien sur le serveur : il faut un compte pour jouer
  if (token.firebase && token.firebase.sign_in_provider === 'anonymous') throw userError('Connecte-toi à ton compte pour jouer.');
  if (await isBanned(uid)) throw userError('Ton compte a été bloqué par l\'administrateur du Casino.');
  // marché, échanges, duels : plusieurs joueurs à la fois (module deals.js)
  if (deals.isDealOp(op)) {
    // refonte (version 3) : marché, échanges, duels, cotes et Loto entre amis payant sont retirés
    if (/^(mk|trade|duel|col)\./.test(op) || op === 'loto.buy') throw userError('Cette fonction a été retirée du Casino.');
    if (!db.has(uid)) throw userError('Joue d\'abord une partie pour créer ton compte sur le serveur.');
    const result = await deals.OPS[op](uid, data || {});
    const P = db.load(uid).player, notes = [];
    if (P && Array.isArray(P.inbox) && P.inbox.length && op === 'deals.list') {
      await serial(uid, async () => { const st = db.load(uid); const before = JSON.parse(JSON.stringify(st)); (st.player.inbox || []).forEach((x) => notes.push({ title: x.title, text: x.text, icon: x.icon, kind: 'gold' })); st.player.inbox = []; db.save(uid, 'inbox', before, st, Date.now()); });
    }
    return { result, notes, player: db.load(uid).player };
  }
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
  if (op === 'pk.buyin' || op === 'pk.refund' || op === 'pk.claim') {
    let id = String(ctx.data.table || '');
    if (op === 'pk.refund' && db.has(uid)) { const cur = db.load(uid).player; if (cur && cur.pkt) id = cur.pkt.table; }
    if (/^[A-Za-z0-9_-]{3,40}$/.test(id) && rtdb) {
      const t = (await rtdb.ref(TABLES.poker + id).get()).val();
      ctx.table = t ? Object.assign({ id }, t) : null;
    }
  }
  if (op === 'mt.sit' || op === 'mt.leave') {
    // table en jetons : le serveur lit la table (réglages, jetons du joueur) dans Firebase
    let game = String(ctx.data.game || ''), id = String(ctx.data.table || '');
    if (op === 'mt.leave' && db.has(uid)) { const cur = db.load(uid).player; if (cur && cur.mt) { game = cur.mt.game; id = cur.mt.table; } }
    if (TABLES[game] && /^[A-Za-z0-9_-]{3,40}$/.test(id) && rtdb) {
      const t = (await rtdb.ref(TABLES[game] + id).get()).val();
      ctx.table = t ? Object.assign({ id }, t) : null;
    }
  }
  if (op === 'ref.link') {
    const code = String(ctx.data.code || '').trim().toUpperCase();
    if (rtdb && /^[A-Z0-9]{6}$/.test(code)) {
      ctx.refUid = (await rtdb.ref('friendcodes/' + code).get()).val() || null;
      if (ctx.refUid) ctx.refName = (await rtdb.ref('profiles/' + ctx.refUid + '/pseudo').get()).val() || 'Un ami';
      if (ctx.refUid && !db.has(ctx.refUid)) ctx.refUid = null; // le parrain doit être un vrai joueur du serveur
    }
  }
  if (op === 'profile.set' && typeof ctx.data.code === 'string' && /^[A-Z0-9]{6}$/.test(ctx.data.code)) {
    ctx.codeOk = rtdb ? (await rtdb.ref('friendcodes/' + ctx.data.code).get()).val() === uid : false;
  }
  // premier passage d'un joueur sur ce serveur : on reprend sa progression depuis Firebase (une seule fois)
  const imported = db.has(uid) ? null : await importFromFirebase(uid);
  let payReferrer = null;
  const res = await serial(uid, async () => {
    let before = db.load(uid);
    if (!before.player && imported) before = { player: imported, secret: {} };
    // passage à la nouvelle économie (version 3 : jetons + La Dette) : noté à part dans le journal, une seule fois
    if (before.player && (before.player.econ || 1) !== 3) {
      const conv = { player: R.normalize(JSON.parse(JSON.stringify(before.player)), Date.now()), secret: {} };
      db.save(uid, 'econ', before, Object.assign({}, conv, { player: Object.assign({}, conv.player, { _econMigrated: undefined }) }), Date.now());
      before = conv; // garde _econMigrated : le cœur du jeu affichera l'avis au joueur
    }
    const copy = JSON.parse(JSON.stringify(before));
    ctx.now = Date.now();
    const out = core.handle(copy, ctx);          // lève une GameError si l'action est refusée : rien n'est enregistré
    const P = out.state.player;
    // parrainage : le filleul a assez joué → +REF_BONUS pour lui (et pour son parrain juste après)
    if (P.refBy && !P.refPaid && R.refDone(P)) {
      P.refPaid = ctx.now;
      P.wallet = Math.round((P.wallet + R.REF_BONUS) * 100) / 100;
      out.notes.push({ title: 'Parrainage débloqué !', text: '+' + R.REF_BONUS.toLocaleString('fr-FR') + ' jetons grâce à ' + (P.refByName || 'ton parrain') + '. Il reçoit la même chose !', icon: '🎁', kind: 'gold' });
      payReferrer = { uid: P.refBy, name: P.pseudo || 'Un ami' };
    }
    // avis au parrain : ses filleuls qui ont débloqué la récompense depuis sa dernière visite
    if (Array.isArray(P.inbox) && P.inbox.length) { P.inbox.forEach((x) => out.notes.push({ title: x.title, text: x.text, icon: x.icon, kind: 'gold' })); P.inbox = []; }
    if (Array.isArray(P.refInbox) && P.refInbox.length) {
      P.refInbox.forEach((x) => out.notes.push({ title: 'Ton filleul a débloqué le parrainage', text: x.name + ' a réussi son premier palier : +' + R.REF_BONUS.toLocaleString('fr-FR') + ' jetons pour toi !', icon: '🎁', kind: 'gold' }));
      P.refInbox = [];
    }
    db.save(uid, op, before, out.state, ctx.now);
    // record du mois des machines à sous (affiché sur la page de choix des machines)
    if (op === 'sl.spin' || op === 'gd.spin') {
      const won = op === 'gd.spin' ? out.result.total : out.result.res && out.result.res.total;
      if (won > 0) db.record('slots', R.seasonOf(ctx.now), { uid, name: P.pseudo || 'Un joueur', amount: won, machine: op === 'gd.spin' ? 'Ruée vers l\'Or' : 'Casino Royal', jackpot: op === 'gd.spin' ? out.result.jackpot : (out.result.res && out.result.res.jackpot ? 'jackpot' : null), at: ctx.now });
    }
    if (rtdb) rtdb.ref('profiles/' + uid).update(R.publicProfile(P, P.friendCode)).catch((e) => console.error('[casino] profil', e.message));
    return { result: out.result, notes: out.notes, player: P };
  });
  if (payReferrer && payReferrer.uid !== uid && db.has(payReferrer.uid)) {
    await serial(payReferrer.uid, async () => {
      const before = db.load(payReferrer.uid);
      if (!before.player) return;
      const after = JSON.parse(JSON.stringify(before)), Q = R.normalize(after.player, Date.now());
      Q.refCount = (Q.refCount || 0) + 1;
      if (Q.refCount <= R.REF_MAX) {
        Q.wallet = Math.round((Q.wallet + R.REF_BONUS) * 100) / 100;
        Q.refInbox = (Q.refInbox || []).concat([{ name: payReferrer.name, at: Date.now() }]).slice(-10);
      }
      after.player = Q;
      db.save(payReferrer.uid, 'ref', before, after, Date.now());
      if (rtdb) rtdb.ref('profiles/' + payReferrer.uid).update(R.publicProfile(Q, Q.friendCode)).catch(() => {});
    }).catch((e) => console.error('[casino] parrainage', e.message));
  }
  return res;
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
    // la banque protégée (bank/<uid>) fait foi ; l'argent laissé sur une table est rendu
    if (b && typeof b.wallet === 'number') { data.wallet = b.wallet + Object.values(b.ses || {}).reduce((a, v) => a + (Number(v) || 0), 0); data.sessions = {}; }
    if (!data.pseudo && pr && pr.pseudo) data.pseudo = String(pr.pseudo).slice(0, 16);
    if (!data.avatar && pr && pr.avatar) data.avatar = pr.avatar;
    const P = R.normalize(data, Date.now()); // applique aussi le passage à la nouvelle économie (÷ 10) si besoin
    delete P._econMigrated;
    P.sessions = {};
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
    hands: (P.totals && P.totals.hands) || 0, vipUntil: R.isVip(P, Date.now()) ? P.vipUntil : 0, created, updated };
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
// ---------- Tableau de bord (page admin) : activité, économie, jeux, alertes ----------
const GAME_OF = { bj: 'Blackjack', pk: 'Poker', rl: 'Roulette', sl: 'Casino Royal', gd: 'Ruée vers l\'Or', cr: 'Rocket Crash', pl: 'Plinko', mn: 'Mines', tr: 'Bourse Flash', lo: 'Loto Express' };
function categoryOf(r) {
  if (!r.wb && !r.tb) return 'Nouveaux comptes';
  const op = r.op, pre = op.split('.')[0];
  if (op.startsWith('admin:')) return 'Admin';
  if (op === 'ref') return 'Parrainage';
  if (op.startsWith('mk.')) return 'Marché (frais)';
  if (op.startsWith('trade')) return 'Échanges';
  if (op.startsWith('duel')) return 'Duels';
  if (op.startsWith('loto')) return 'Loto entre amis';
  if (GAME_OF[pre] && op !== 'session.start') return 'Jeux';
  return { 'bonus.claim': 'Bonus du jour', 'challenge.claim': 'Défis', 'time.claim': 'Banque du temps', 'chest.claim': 'Coffre', 'wheel.spin': 'Roue du jour', 'vip.buy': 'Pass VIP', 'rescue.claim': 'Aide de secours', 'multi.prize': 'Entre amis', 'shop.buy': 'Boutique', 'session.start': 'Tables (aller)', 'session.cashout': 'Tables (retour)', 'run.start': 'La Dette', 'run.end': 'La Dette', 'run.over': 'La Dette', 'run.abandon': 'La Dette' }[op] || 'Autre';
}
function dashboard() {
  const now = Date.now(), DAY = 864e5, day = (t) => R.today(t);
  const all = db.all();
  const days = []; for (let k = 29; k >= 0; k--) days.push(day(now - k * DAY));
  const active = Object.fromEntries(days.map((d) => [d, new Set()])), fresh = Object.fromEntries(days.map((d) => [d, 0]));
  const rows = db.ledgerSince(now - 30 * DAY).filter((r) => r.op !== 'econ');
  rows.forEach((r) => { const d = day(r.at); if (active[d]) active[d].add(r.uid); });
  all.forEach((p) => { const d = day(p.created); if (fresh[d] !== undefined) fresh[d]++; });
  // économie : argent créé / détruit par catégorie, par jour
  const cats = {}, perDay = Object.fromEntries(days.map((d) => [d, { created: 0, destroyed: 0 }]));
  const games = {}, gain24 = {};
  rows.forEach((r) => {
    const delta = (r.wa + r.ta) - (r.wb + r.tb);
    const c = categoryOf(r);
    cats[c] = (cats[c] || 0) + delta;
    const d = day(r.at);
    if (perDay[d]) { if (delta > 0) perDay[d].created += delta; else perDay[d].destroyed += -delta; }
    const pre = r.op.split('.')[0];
    if (GAME_OF[pre] && r.op !== 'session.start') { const g = games[pre] = games[pre] || { name: GAME_OF[pre], ops: 0, net: 0, players: new Set() }; g.ops++; g.net += delta; g.players.add(r.uid); }
    if (r.at >= now - DAY && delta > 0 && c !== 'Nouveaux comptes' && c !== 'Tables (retour)') gain24[r.uid] = (gain24[r.uid] || 0) + delta;
  });
  const name = Object.fromEntries(all.map((p) => [p.uid, (p.state.player && p.state.player.pseudo) || '(sans pseudo)']));
  const money = (p) => { const P = p.state.player || {}; return (P.wallet || 0) + Object.values(P.sessions || {}).reduce((a, s) => a + (s.stack || 0), 0); };
  const total = all.reduce((a, p) => a + money(p), 0);
  const ALERT = 5000;
  const alerts = Object.entries(gain24).filter(([, v]) => v >= ALERT).sort((a, b) => b[1] - a[1]).map(([uid, v]) => ({ uid, name: name[uid] || uid.slice(0, 6), gained: r2(v) }));
  return {
    at: now,
    players: { total: all.length, active1: all.filter((p) => now - p.updated < DAY).length, active7: all.filter((p) => now - p.updated < 7 * DAY).length, active30: all.filter((p) => now - p.updated < 30 * DAY).length },
    money: { total: r2(total), avg: all.length ? r2(total / all.length) : 0 },
    days: days.map((d) => ({ d, active: active[d].size, fresh: fresh[d], created: r2(perDay[d].created), destroyed: r2(perDay[d].destroyed) })),
    categories: Object.entries(cats).map(([k, v]) => ({ k, v: r2(v) })).sort((a, b) => b.v - a.v),
    games: Object.values(games).map((g) => ({ name: g.name, ops: g.ops, net: r2(g.net), players: g.players.size })).sort((a, b) => b.ops - a.ops),
    richest: all.map((p) => ({ uid: p.uid, name: name[p.uid], money: r2(money(p)), level: R.levelOf((p.state.player || {}).xp || 0) })).sort((a, b) => b.money - a.money).slice(0, 10),
    alerts, alertThreshold: ALERT,
  };
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
    case 'dashboard': return dashboard();
    case 'status': return Object.assign(status(), { backups: { dir: BACKUP_DIR, list: listBackups().slice(0, 12), error: lastBackupError } });
    case 'backup': { const b = makeBackup(true); return { ok: true, backup: b, list: listBackups().slice(0, 12) }; }
    case 'vip': {
      const days = Math.round(Number(d.days));
      if (!(days >= -365 && days <= 365 && days !== 0)) throw userError('Nombre de jours invalide.');
      return adminEdit(target, 'vip', (P) => { if (days > 0) R.grantVip(P, days, now, 'admin'); else P.vipUntil = Math.max(now, (P.vipUntil || now) + days * 864e5); });
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
    case 'close': return adminEdit(target, 'close', (P, st) => { if (P.run) P.run.cash = r2((P.run.cash || 0) + sum(P.sessions)); P.sessions = {}; st.secret = {}; });
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
  const t0 = Date.now(); let mUid = null, mOp = null;
  const done = res.end.bind(res);
  res.end = (...a) => { try { if (req.url && req.url.startsWith('/api/')) measure(res.statusCode, Date.now() - t0, mUid, mOp, res._mErr); } catch (e) { /* ignore */ } return done(...a); };
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, headers(req)); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/hall') {
      const month = R.seasonOf(Date.now());
      send(req, res, 200, { month, slots: db.hall('slots', month) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/push-key') { send(req, res, 200, { key: vapid.publicKey }); return; }
    if (req.method === 'GET' && url.pathname === '/health') { send(req, res, 200, Object.assign({ ok: true, version: SERVER_VERSION, at: Date.now() }, db.stats())); return; }
    if (req.method !== 'POST' || (url.pathname !== '/api/casino' && url.pathname !== '/api/admin')) { send(req, res, 404, { error: 'Introuvable.' }); return; }
    if (req.headers.origin && !ORIGINS.includes(req.headers.origin) && !ORIGINS.includes('*')) { send(req, res, 403, { error: 'Origine non autorisée.' }); return; }
    if (!perIp(clientIp(req))) { send(req, res, 429, { error: 'Trop de requêtes : ralentis un peu.' }); return; }
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) { send(req, res, 401, { error: 'Connexion requise.' }); return; }
    let token;
    try { token = await admin.auth().verifyIdToken(auth.slice(7)); } catch (e) { send(req, res, 401, { error: 'Session expirée : reconnecte-toi.' }); return; }
    mUid = token.uid;
    if (!perUser(token.uid)) { send(req, res, 429, { error: 'Trop de requêtes : ralentis un peu.' }); return; }
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { send(req, res, e.status || 400, { error: 'Requête invalide.' }); return; }
    if (!body || typeof body.op !== 'string' || body.op.length > 40) { send(req, res, 400, { error: 'Opération manquante.' }); return; }
    mOp = (url.pathname === '/api/admin' ? 'admin:' : '') + body.op;
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
    res._mErr = e && e.message;
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
