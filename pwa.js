// App installable : service worker (fonctionne hors ligne en solo) et lien de retour vers l'accueil.
(function () {
  'use strict';
  if (window.claude) return; // sur claude.ai, rien à faire
  const home = document.getElementById('home-link');
  if (home) {
    home.hidden = false;
    // retour : vers l'apprentissage, vers la partie de La Dette en cours, sinon vers le lobby
    try {
      const up = home.getAttribute('href').replace(/index\.html.*$/, '');
      const C = window.Casino, r = C && C.profile && C.profile.run;
      if (C && C.learn) home.setAttribute('href', up + 'apprendre.html');
      else if (r && r.status !== 'over') home.setAttribute('href', up + 'partie.html');
    } catch (e) { /* ignore */ }
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const base = document.querySelector('link[rel="manifest"]');
    const url = base ? new URL('sw.js', base.href) : new URL('sw.js', location.href);
    navigator.serviceWorker.register(url.href).catch(() => {});
  }
})();
