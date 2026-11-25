/*
 * Couche réseau des tables entre amis. Une seule interface, trois branchements :
 *  - « claude »   : la page tourne sur claude.ai (base de données de l'artifact) ;
 *  - « firebase » : l'app indépendante (GitHub Pages) avec Firebase Realtime Database ;
 *  - « local »    : plusieurs onglets du même navigateur (tests et démonstration).
 *
 * Interface commune (toutes les fonctions asynchrones renvoient des promesses) :
 *   kind, me, canWrite, usesCodes
 *   watchLobby(cb) -> unsub              (claude uniquement : liste des tables)
 *   createTable(state) -> id
 *   watchTable(id, cb(state|null)) -> unsub
 *   transact(id, fn(state) -> false pour annuler) -> bool
 *   watchChat(id, cb([{uid, name, text, ts}])) -> unsub
 *   sendChat(id, {uid, name, text, ts})
 *   deleteTable(id)
 *   profiles(ids) -> {id: nom}           (noms connus de la plateforme)
 *   presenceStart(id) -> stop()          signal de présence régulier tant qu'on est à la table
 *   activeCount(id) -> nombre de joueurs présents (signal de moins de 2 minutes)
 *
 * Une table où plus personne n'est présent est fermée : elle est supprimée et ne peut plus être rejointe.
 */
(function () {
  'use strict';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BEAT = 45000;     // un signal de présence toutes les 45 s
  const FRESH = 120000;   // présent si le dernier signal date de moins de 2 min
  // Démarre un battement régulier ; renvoie la fonction d'arrêt
  function heartbeat(beat, stop) {
    beat();
    const t = setInterval(beat, BEAT);
    const onHide = () => { stop(); };
    window.addEventListener('pagehide', onHide);
    return () => { clearInterval(t); window.removeEventListener('pagehide', onHide); return stop(); };
  }
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
  function randomCode() {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }

  // ---------- claude.ai ----------
  async function claudeNet() {
    if (!window.claude || typeof window.claude.use !== 'function') return null;
    let db, user;
    try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch (e) { return null; }
    if (!db || !user) return null;
    const me = await user.id();
    if (!me) return null;
    let canWrite = true;
    try { canWrite = (await user.can('data.write')) !== false; } catch (e) { /* inconnu : on essaie */ }
    const tabId = Math.random().toString(36).slice(2, 8);

    return {
      kind: 'claude', me, canWrite, usesCodes: false,
      watchLobby(cb, onErr) {
        return db.collection('tables').orderBy('updatedAt', 'desc').limit(30)
          .onSnapshot((snap) => cb(snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))), onErr);
      },
      async createTable(state) {
        const ref = db.collection('tables').doc();
        await ref.set(state);
        return ref.id;
      },
      watchTable(id, cb, onErr) {
        return db.doc('tables/' + id).onSnapshot((s) => cb(s.exists ? s.data() : null), onErr);
      },
      async transact(id, fn) {
        const lock = db.doc('tables/' + id + '/lock/main');
        let ok = false;
        for (let t = 0; t < 30 && !ok; t++) {
          const r = await lock.acquire({ holder: me + ':' + tabId, ttlMs: 1500 });
          ok = r.acquired;
          if (!ok) await sleep(120 + Math.random() * 200);
        }
        if (!ok) throw { code: 'busy' };
        const ref = db.doc('tables/' + id);
        const snap = await ref.get();
        if (!snap.exists) throw { code: 'gone' };
        const st = JSON.parse(JSON.stringify(snap.data()));
        if (fn(st) === false) return false;
        st.updatedAt = Date.now();
        await ref.set(st);
        return true;
      },
      watchChat(id, cb) {
        return db.collection('tables/' + id + '/chat').orderBy('ts', 'desc').limit(50)
          .onSnapshot((snap) => cb(snap.docs.map((d) => d.data()).reverse()), () => {});
      },
      async sendChat(id, msg) {
        const col = db.collection('tables/' + id + '/chat');
        await col.add(msg);
        const old = await col.where('ts', '<', Date.now() - 3 * 864e5).limit(20).get();
        for (const d of old.docs) await col.doc(d.id).delete();
      },
      async deleteTable(id) {
        await db.doc('tables/' + id).delete();
        try {
          const ps = await db.collection('tables/' + id + '/presence').get();
          for (const d of ps.docs) await db.doc('tables/' + id + '/presence/' + d.id).delete().catch(() => {});
        } catch (e) { /* ignore */ }
      },
      presenceStart(id) {
        const ref = db.doc('tables/' + id + '/presence/' + me);
        return heartbeat(() => { ref.set({ ts: Date.now() }).catch(() => {}); }, () => ref.delete().catch(() => {}));
      },
      async activeCount(id) {
        const ps = await db.collection('tables/' + id + '/presence').get();
        return ps.docs.filter((d) => (d.data().ts || 0) > Date.now() - FRESH).length;
      },
      async profiles(ids) {
        const out = {};
        try {
          const ps = await user.profiles(ids);
          ids.forEach((i) => { if (ps[i] && ps[i].name) out[i] = ps[i].name; });
        } catch (e) { /* noms indisponibles */ }
        return out;
      },
    };
  }

  // ---------- Firebase (app indépendante) ----------
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  async function firebaseNet(opts) {
    const ns = opts.ns || '';
    const norm = opts.normalize || ((x) => (window.Multi ? window.Multi.normalize(x) : x));
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || !cfg.databaseURL) return null;
    const [appMod, authMod, dbMod] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-database.js'),
    ]);
    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    await authMod.signInAnonymously(auth);
    const me = auth.currentUser.uid;
    const d = dbMod.getDatabase(app);
    const R = (p) => dbMod.ref(d, p);

    return {
      kind: 'firebase', me, canWrite: true, usesCodes: true,
      async createTable(state) {
        for (let t = 0; t < 10; t++) {
          const code = randomCode();
          const res = await dbMod.runTransaction(R(ns + 'tables/' + code), (cur) => (cur ? undefined : state));
          if (res.committed) return code;
        }
        throw { code: 'no_code' };
      },
      watchTable(id, cb, onErr) {
        return dbMod.onValue(R(ns + 'tables/' + id), (s) => cb(s.exists() ? s.val() : null), onErr);
      },
      async transact(id, fn) {
        let aborted = false;
        const res = await dbMod.runTransaction(R(ns + 'tables/' + id), (cur) => {
          if (cur === null) return cur; // valeur pas encore connue : Firebase relance avec la vraie
          const st = JSON.parse(JSON.stringify(cur));
          norm(st);
          if (fn(st) === false) { aborted = true; return undefined; }
          st.updatedAt = Date.now();
          return st;
        }, { applyLocally: false });
        if (!res.committed && !aborted && !res.snapshot.exists()) throw { code: 'gone' };
        return res.committed;
      },
      watchChat(id, cb) {
        const q = dbMod.query(R(ns + 'chats/' + id), dbMod.orderByChild('ts'), dbMod.limitToLast(50));
        return dbMod.onValue(q, (s) => {
          const list = [];
          s.forEach((c) => { list.push(c.val()); });
          cb(list);
        });
      },
      async sendChat(id, msg) { await dbMod.push(R(ns + 'chats/' + id), msg); },
      async deleteTable(id) {
        await dbMod.remove(R(ns + 'tables/' + id));
        await dbMod.remove(R(ns + 'chats/' + id)).catch(() => {});
        await dbMod.remove(R(ns + 'presence/' + id)).catch(() => {});
        await dbMod.remove(R(ns + 'hands/' + id)).catch(() => {});
        await dbMod.remove(R(ns + 'deck/' + id)).catch(() => {});
      },
      presenceStart(id) {
        const ref = R(ns + 'presence/' + id + '/' + me);
        dbMod.onDisconnect(ref).remove();
        return heartbeat(() => { dbMod.set(ref, Date.now()).catch(() => {}); }, () => dbMod.remove(ref).catch(() => {}));
      },
      async activeCount(id) {
        const snap = await dbMod.get(R(ns + 'presence/' + id));
        let n = 0;
        snap.forEach((c) => { if ((c.val() || 0) > Date.now() - FRESH) n++; });
        return n;
      },
      async profiles() { return {}; },
      async presenceList(id) {
        const snap = await dbMod.get(R(ns + 'presence/' + id));
        const out = {};
        snap.forEach((c) => { if ((c.val() || 0) > Date.now() - FRESH) out[c.key] = c.val(); });
        return out;
      },
      // Cartes privées : chaque joueur ne peut lire que les siennes (règles de sécurité)
      async setPrivate(id, uid, data) { await dbMod.set(R(ns + 'hands/' + id + '/' + uid), data); },
      watchPrivate(id, cb) { return dbMod.onValue(R(ns + 'hands/' + id + '/' + me), (s) => cb(s.val()), () => cb(null)); },
      // Paquet de cartes : lisible uniquement par l'hôte de la table
      async setSecret(id, data) { await dbMod.set(R(ns + 'deck/' + id), data); },
      async getSecret(id) { const s2 = await dbMod.get(R(ns + 'deck/' + id)); return s2.val(); },
    };
  }

  // ---------- Local (onglets du même navigateur) ----------
  function localNet(opts) {
    const ns = opts.ns || '';
    const norm = opts.normalize || ((x) => (window.Multi ? window.Multi.normalize(x) : x));
    let me = null;
    try {
      me = sessionStorage.getItem('bj-local-me');
      if (!me) { me = 'L' + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('bj-local-me', me); }
    } catch (e) { me = 'L' + Math.random().toString(36).slice(2, 9); }
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('bj-local') : null;
    const subs = new Set();
    // Les onglets ne voient pas toujours tout de suite ce qu'un autre vient d'écrire dans localStorage :
    // la valeur voyage donc avec le message, et chaque onglet garde la dernière valeur reçue.
    const cache = new Map();
    const read = (k) => {
      if (cache.has(k)) return cache.get(k) == null ? null : JSON.parse(cache.get(k));
      try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
    };
    const write = (k, v) => { const txt = JSON.stringify(v); cache.set(k, txt); localStorage.setItem(k, txt); };
    const remove = (k) => { cache.set(k, null); localStorage.removeItem(k); };
    const fire = (k) => {
      subs.forEach((s) => s(k));
      if (bc) bc.postMessage({ k, v: cache.has(k) ? cache.get(k) : localStorage.getItem(k) });
    };
    if (bc) bc.onmessage = (e) => {
      const m = e.data;
      if (m && typeof m === 'object') { cache.set(m.k, m.v); subs.forEach((s) => s(m.k)); }
    };
    const watch = (key, cb) => {
      const f = (k) => { if (k === key) cb(read(key)); };
      subs.add(f);
      setTimeout(() => cb(read(key)), 0);
      return () => subs.delete(f);
    };
    const withLock = (name, fn) => (navigator.locks ? navigator.locks.request(name, fn) : fn());

    return {
      kind: 'local', me, canWrite: true, usesCodes: true,
      async createTable(state) {
        let code = randomCode();
        while (read(ns + 'bj-t-' + code)) code = randomCode();
        write(ns + 'bj-t-' + code, state);
        fire(ns + 'bj-t-' + code);
        return code;
      },
      watchTable(id, cb) { return watch(ns + 'bj-t-' + id, cb); },
      transact(id, fn) {
        return withLock(ns + 'bj-t-' + id, async () => {
          const cur = read(ns + 'bj-t-' + id);
          if (!cur) throw { code: 'gone' };
          norm(cur);
          if (fn(cur) === false) return false;
          cur.updatedAt = Date.now();
          write(ns + 'bj-t-' + id, cur);
          fire(ns + 'bj-t-' + id);
          return true;
        });
      },
      watchChat(id, cb) { return watch(ns + 'bj-c-' + id, (v) => cb(v || [])); },
      async sendChat(id, msg) {
        const list = (read(ns + 'bj-c-' + id) || []).concat([msg]).slice(-50);
        write(ns + 'bj-c-' + id, list);
        fire(ns + 'bj-c-' + id);
      },
      async deleteTable(id) {
        remove(ns + 'bj-t-' + id); remove(ns + 'bj-c-' + id); remove(ns + 'bj-p-' + id);
        fire(ns + 'bj-t-' + id);
      },
      presenceStart(id) {
        const key = ns + 'bj-p-' + id;
        const upd = (fn) => { const p = read(key) || {}; fn(p); write(key, p); fire(key); };
        return heartbeat(() => upd((p) => { p[me] = Date.now(); }), async () => upd((p) => { delete p[me]; }));
      },
      async activeCount(id) {
        const p = read(ns + 'bj-p-' + id) || {};
        return Object.values(p).filter((ts) => ts > Date.now() - FRESH).length;
      },
      async profiles() { return {}; },
      async presenceList(id) {
        const p = read(ns + 'bj-p-' + id) || {};
        const out = {};
        Object.keys(p).forEach((u) => { if (p[u] > Date.now() - FRESH) out[u] = p[u]; });
        return out;
      },
      async setPrivate(id, uid, data) { write(ns + 'bj-h-' + id + '-' + uid, data); fire(ns + 'bj-h-' + id + '-' + uid); },
      watchPrivate(id, cb) { return watch(ns + 'bj-h-' + id + '-' + me, cb); },
      async setSecret(id, data) { write(ns + 'bj-d-' + id, data); },
      async getSecret(id) { return read(ns + 'bj-d-' + id); },
    };
  }

  /**
   * opts.ns        : préfixe des chemins (ex. 'p' pour le poker : ptables, pchats…)
   * opts.normalize : remet en forme l'état lu (Firebase supprime les listes vides)
   * opts.needPrivate : le jeu a besoin de cartes privées (non disponible sur claude.ai)
   */
  window.createNet = async function (opts) {
    opts = opts || {};
    const forceLocal = /[?&]backend=local\b/.test(location.search);
    if (!forceLocal) {
      const c = opts.needPrivate ? null : await claudeNet();
      if (c) return c;
      try {
        const f = await firebaseNet(opts);
        if (f) return f;
      } catch (e) {
        console.error('Firebase indisponible', e);
        return { error: 'firebase' };
      }
    }
    if (forceLocal) return localNet(opts);
    return null;
  };
})();
