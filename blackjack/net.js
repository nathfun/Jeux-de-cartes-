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
 */
(function () {
  'use strict';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      async deleteTable(id) { await db.doc('tables/' + id).delete(); },
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
  async function firebaseNet() {
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
          const res = await dbMod.runTransaction(R('tables/' + code), (cur) => (cur ? undefined : state));
          if (res.committed) return code;
        }
        throw { code: 'no_code' };
      },
      watchTable(id, cb, onErr) {
        return dbMod.onValue(R('tables/' + id), (s) => cb(s.exists() ? s.val() : null), onErr);
      },
      async transact(id, fn) {
        let aborted = false;
        const res = await dbMod.runTransaction(R('tables/' + id), (cur) => {
          if (cur === null) return cur; // valeur pas encore connue : Firebase relance avec la vraie
          const st = JSON.parse(JSON.stringify(cur));
          if (window.Multi) window.Multi.normalize(st);
          if (fn(st) === false) { aborted = true; return undefined; }
          st.updatedAt = Date.now();
          return st;
        }, { applyLocally: false });
        if (!res.committed && !aborted && !res.snapshot.exists()) throw { code: 'gone' };
        return res.committed;
      },
      watchChat(id, cb) {
        const q = dbMod.query(R('chats/' + id), dbMod.orderByChild('ts'), dbMod.limitToLast(50));
        return dbMod.onValue(q, (s) => {
          const list = [];
          s.forEach((c) => { list.push(c.val()); });
          cb(list);
        });
      },
      async sendChat(id, msg) { await dbMod.push(R('chats/' + id), msg); },
      async deleteTable(id) { await dbMod.remove(R('tables/' + id)); await dbMod.remove(R('chats/' + id)); },
      async profiles() { return {}; },
    };
  }

  // ---------- Local (onglets du même navigateur) ----------
  function localNet() {
    let me = null;
    try {
      me = sessionStorage.getItem('bj-local-me');
      if (!me) { me = 'L' + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('bj-local-me', me); }
    } catch (e) { me = 'L' + Math.random().toString(36).slice(2, 9); }
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('bj-local') : null;
    const subs = new Set();
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
    const write = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); };
    const fire = (k) => { subs.forEach((s) => s(k)); if (bc) bc.postMessage(k); };
    if (bc) bc.onmessage = (e) => subs.forEach((s) => s(e.data));
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
        while (read('bj-t-' + code)) code = randomCode();
        write('bj-t-' + code, state);
        fire('bj-t-' + code);
        return code;
      },
      watchTable(id, cb) { return watch('bj-t-' + id, cb); },
      transact(id, fn) {
        return withLock('bj-t-' + id, async () => {
          const cur = read('bj-t-' + id);
          if (!cur) throw { code: 'gone' };
          if (window.Multi) window.Multi.normalize(cur);
          if (fn(cur) === false) return false;
          cur.updatedAt = Date.now();
          write('bj-t-' + id, cur);
          fire('bj-t-' + id);
          return true;
        });
      },
      watchChat(id, cb) { return watch('bj-c-' + id, (v) => cb(v || [])); },
      async sendChat(id, msg) {
        const list = (read('bj-c-' + id) || []).concat([msg]).slice(-50);
        write('bj-c-' + id, list);
        fire('bj-c-' + id);
      },
      async deleteTable(id) { localStorage.removeItem('bj-t-' + id); fire('bj-t-' + id); },
      async profiles() { return {}; },
    };
  }

  window.createNet = async function () {
    const forceLocal = /[?&]backend=local\b/.test(location.search);
    if (!forceLocal) {
      const c = await claudeNet();
      if (c) return c;
      try {
        const f = await firebaseNet();
        if (f) return f;
      } catch (e) {
        console.error('Firebase indisponible', e);
        return { error: 'firebase' };
      }
    }
    if (forceLocal) return localNet();
    return null;
  };
})();
