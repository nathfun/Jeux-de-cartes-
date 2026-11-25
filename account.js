/*
 * Compte du joueur : un pseudo et un mot de passe pour garder sa progression
 * (banque, niveau, succès, amis…) et la retrouver sur n'importe quel appareil.
 *
 * Firebase Authentication (méthode « Adresse e-mail/Mot de passe ») avec une adresse
 * fabriquée à partir du pseudo : personne n'a besoin de donner son vrai e-mail.
 * La sauvegarde est rangée dans saves/<uid>, lisible et modifiable par son seul propriétaire.
 * Sans compte, tout reste dans le navigateur (comme avant).
 */
(function () {
  'use strict';
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const KEY = 'casino-account';
  const DOMAIN = '@joueurs.casino-entre-amis.app';

  const info = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const setInfo = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };

  // Identifiant de connexion tiré du pseudo : minuscules, sans accents, lettres/chiffres/-/_
  function loginId(pseudo) {
    return String(pseudo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  let fbp = null;
  function fb() {
    if (!fbp) {
      fbp = (async () => {
        const cfg = window.FIREBASE_CONFIG;
        if (!cfg || !cfg.databaseURL || /[?&]backend=local\b/.test(location.search)) return null;
        const [appMod, authMod, dbMod] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-database.js')]);
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
        const auth = authMod.getAuth(app);
        if (auth.authStateReady) await auth.authStateReady();
        if (!auth.currentUser) await authMod.signInAnonymously(auth);
        const db = dbMod.getDatabase(app);
        return { auth, authMod, dbMod, db, ref: (p) => dbMod.ref(db, p) };
      })().catch(() => null);
    }
    return fbp;
  }

  function errorText(e) {
    const c = (e && e.code) || '';
    if (c.includes('email-already-in-use') || c.includes('credential-already-in-use')) return 'Ce pseudo est déjà pris : choisis-en un autre, ou connecte-toi si c\'est ton compte.';
    if (c.includes('weak-password')) return 'Mot de passe trop court : 6 caractères minimum.';
    if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return 'Pseudo ou mot de passe incorrect.';
    if (c.includes('operation-not-allowed')) return 'Les comptes ne sont pas encore activés sur le serveur : le propriétaire doit activer « Adresse e-mail/Mot de passe » dans Firebase (voir FIREBASE.md).';
    if (c.includes('too-many-requests')) return 'Trop d\'essais : attends quelques minutes.';
    if (c.includes('network')) return 'Pas de connexion internet.';
    if (c === 'PERMISSION_DENIED' || c.includes('permission')) return 'Le serveur refuse la sauvegarde : le propriétaire doit mettre à jour les règles Firebase (database.rules.json).';
    return 'Erreur : ' + (e && e.message ? e.message : 'inconnue');
  }

  async function push() {
    const a = info();
    const f = await fb();
    if (!a || !f || !f.auth.currentUser || f.auth.currentUser.uid !== a.uid || !window.Casino) return false;
    const data = Casino.exportSave();
    // ne jamais écraser une modification de l'administrateur que cet appareil n'a pas encore reçue
    const cur = (await f.dbMod.get(f.ref('saves/' + a.uid))).val();
    if (cur && cur.adminAt && cur.adminAt > (data.adminSeen || 0)) { await pull(true); return false; }
    await f.dbMod.set(f.ref('saves/' + a.uid), { data: JSON.stringify(data), at: data.savedAt || Date.now() });
    a.syncedAt = Date.now();
    setInfo(a);
    return true;
  }
  // Récupère la sauvegarde en ligne si elle est plus récente que celle de l'appareil
  async function pull(force) {
    const a = info();
    const f = await fb();
    if (!a || !f || !window.Casino) return false;
    const snap = (await f.dbMod.get(f.ref('saves/' + a.uid))).val();
    if (!snap || !snap.data) return false;
    const local = Casino.exportSave();
    // une modification faite par l'administrateur passe toujours devant la sauvegarde de l'appareil
    const forced = snap.adminAt && snap.adminAt > (local.adminSeen || 0);
    if (!force && !forced && (local.savedAt || 0) >= (snap.at || 0)) return false;
    const data = JSON.parse(snap.data);
    if (snap.adminAt) data.adminSeen = snap.adminAt;
    Casino.importSave(data);
    return true;
  }

  async function check(pseudo, pwd) {
    const id = loginId(pseudo);
    if (id.length < 3) throw { code: 'local', message: 'Pseudo trop court : au moins 3 lettres ou chiffres.' };
    if (!pwd || pwd.length < 6) throw { code: 'auth/weak-password' };
    const f = await fb();
    if (!f) throw { code: 'local', message: 'Les comptes ont besoin du serveur de jeu (Firebase), qui n\'est pas joignable.' };
    return { id, f };
  }

  const Account = {
    info,
    loginId,
    errorText,
    async available() { return !!(await fb()); },
    // Création : le profil actuel de l'appareil devient celui du compte
    async create(pseudo, pwd) {
      const { id, f } = await check(pseudo, pwd);
      const cred = f.authMod.EmailAuthProvider.credential(id + DOMAIN, pwd);
      const u = f.auth.currentUser;
      let user;
      if (u && u.isAnonymous) user = (await f.authMod.linkWithCredential(u, cred)).user;
      else user = (await f.authMod.createUserWithEmailAndPassword(f.auth, id + DOMAIN, pwd)).user;
      setInfo({ pseudo: String(pseudo).trim().slice(0, 16), id, uid: user.uid });
      if (window.Casino) Casino.setPseudo(String(pseudo).trim().slice(0, 16));
      await push();
      startSync(false);
      return true;
    },
    // Connexion : on récupère la progression du compte (elle remplace celle de l'appareil)
    async login(pseudo, pwd) {
      const { id, f } = await check(pseudo, pwd);
      const user = (await f.authMod.signInWithEmailAndPassword(f.auth, id + DOMAIN, pwd)).user;
      setInfo({ pseudo: String(pseudo).trim().slice(0, 16), id, uid: user.uid });
      pulling = true;
      try { const got = await pull(true); if (!got) await push(); } finally { pulling = false; }
      if (window.Casino && Casino.server) await Casino.sync(); // la banque du compte vient du serveur
      startSync(false);
      return true;
    },
    async logout() {
      try { await push(); } catch (e) { /* ignore */ }
      const f = await fb();
      setInfo(null);
      clearTimeout(timer);
      if (f) { await f.authMod.signOut(f.auth); await f.authMod.signInAnonymously(f.auth); }
      if (window.Casino) Casino.resetLocal();
    },
    push,
    pull,
  };
  window.Account = Account;

  // Synchronisation automatique quand on est connecté : récupération au chargement,
  // envoi quelques secondes après chaque changement et quand on quitte la page.
  let syncing = false, pulling = false, timer = null;
  function startSync(initialPull) {
    if (!window.Casino) return;
    if (initialPull) { pulling = true; pull(false).catch(() => {}).finally(() => { pulling = false; }); }
    if (syncing) return;
    syncing = true;
    Casino.onChange(() => {
      if (pulling || !info()) return;
      clearTimeout(timer);
      timer = setTimeout(() => push().catch(() => {}), 3000);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !pulling && info()) push().catch(() => {}); });
  }
  if (info()) startSync(true);
})();
