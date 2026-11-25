// Il faut un compte pour jouer : sans compte, on est renvoyé vers l'accueil pour se connecter ou s'inscrire.
// (Pas de contrôle en mode test ?backend=local ou sans serveur de jeu configuré.)
(function () {
  'use strict';
  const cfg = window.FIREBASE_CONFIG;
  const off = /[?&]backend=local\b/.test(location.search) || !!window.claude || !cfg || !cfg.databaseURL;
  window.CASINO_GATE = !off;
  if (off) return;
  let acc = null;
  try { acc = JSON.parse(localStorage.getItem('casino-account')); } catch (e) { /* ignore */ }
  if (acc) return;
  if (document.querySelector('meta[name="casino-hub"]')) return; // l'accueil affiche lui-même la connexion
  const next = location.pathname + location.search;
  location.replace(new URL('../index.html?next=' + encodeURIComponent(next), location.href).href);
})();
