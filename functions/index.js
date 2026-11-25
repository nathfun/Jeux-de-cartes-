/*
 * Serveur du Casino (Firebase Cloud Functions).
 * Une seule fonction « casino », appelée par l'app avec { op, data } : toute modification de la banque,
 * des niveaux, des défis et tous les tirages des parties réelles passent par ici.
 * Les données du joueur sont rangées dans vault/<uid> (illisible par les joueurs) ; le profil public
 * (classement entre amis) est recopié dans profiles/<uid>.
 */
'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const core = require('./core.js');
const R = require('./shared/casino-rules.js');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10, memory: '256MiB' });

const TABLES = { blackjack: 'tables/', poker: 'ptables/', roulette: 'rtables/' };

exports.casino = onCall({ cors: true }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid;
  const { op, data } = req.data || {};
  if (typeof op !== 'string') throw new HttpsError('invalid-argument', 'Opération manquante.');
  const db = admin.database();
  const ctx = {
    uid, op, data: data || {}, anon: req.auth.token.firebase && req.auth.token.firebase.sign_in_provider === 'anonymous',
    rnd: (n) => crypto.randomInt(n),
  };
  // Lectures préalables : table entre amis (prix), code ami (profil public)
  if (op === 'multi.prize') {
    const game = String(ctx.data.game), id = String(ctx.data.table || '');
    if (!TABLES[game] || !/^[A-Z0-9]{3,8}$/.test(id)) throw new HttpsError('invalid-argument', 'Table invalide.');
    const t = (await db.ref(TABLES[game] + id).get()).val();
    ctx.table = t ? Object.assign({ id }, t) : null;
  }
  if (op === 'profile.set' && typeof ctx.data.code === 'string' && /^[A-Z0-9]{6}$/.test(ctx.data.code)) {
    ctx.codeOk = (await db.ref('friendcodes/' + ctx.data.code).get()).val() === uid;
  }

  let out = null, err = null;
  const res = await db.ref('vault/' + uid).transaction((cur) => {
    err = null;
    const state = cur && cur.v ? JSON.parse(cur.v) : {};
    try {
      ctx.now = Date.now();
      out = core.handle(state, ctx);
      return { v: JSON.stringify(out.state), at: ctx.now };
    } catch (e) {
      err = e;
      // Au premier passage, le SDK peut fournir une valeur vide (cache local) : on renvoie un marqueur pour que
      // Firebase compare avec la vraie valeur et rappelle cette fonction avec elle ; sinon on annule.
      return cur === null ? { e: 1 } : undefined;
    }
  });
  if (err) {
    if (err.userMessage) throw new HttpsError('failed-precondition', err.userMessage);
    console.error(err);
    throw new HttpsError('internal', 'Erreur du serveur.');
  }
  if (!res.committed || !out) throw new HttpsError('aborted', 'Réessaie.');
  const P = out.state.player;
  await db.ref('profiles/' + uid).set(R.publicProfile(P, P.friendCode)).catch((e) => console.error(e));
  return { result: out.result, notes: out.notes, player: P };
});
