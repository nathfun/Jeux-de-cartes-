// Il faut un compte pour jouer : sans compte, on est renvoyé vers l'accueil pour se connecter ou s'inscrire.
// (Pas de contrôle en mode test ?backend=local ou sans serveur de jeu configuré.)
// Comme une vraie app : pas de zoom au double-tap ni au pincement, pas de zoom automatique sur les champs de saisie.
(function () {
  try {
    const st = document.createElement('style');
    st.textContent = 'html{touch-action:manipulation;-webkit-text-size-adjust:100%;text-size-adjust:100%}'
      + 'button,a,input,select,label,canvas{touch-action:manipulation}'
      + '@media (pointer:coarse){input,select,textarea{font-size:max(16px,1em)}}';
    document.head.appendChild(st);
    // iOS ignore parfois user-scalable=no : on bloque le pincement (le double-tap est coupé par touch-action, sans ralentir les clics rapides)
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  } catch (e) { /* ignore */ }
})();
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
