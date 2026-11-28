/*
 * Le Casse — moteur partagé app / serveur.
 * Une tour de 8 étages : à chaque étage, des portes dont certaines déclenchent l'alarme. Chaque porte franchie
 * fait monter le butin ; on peut s'enfuir (encaisser) à tout moment après le premier étage.
 * Butin après k étages = mise × RTP × (1 / chance de passer)^k : le jeu rend RTP quel que soit le moment où l'on s'arrête.
 */
(function (root) {
  'use strict';
  const FLOORS = 8, RTP = 0.97;
  const MODES = {
    facile: { name: 'Discret', doors: 4, alarms: 1, icon: '🕶️' },
    normal: { name: 'Classique', doors: 3, alarms: 1, icon: '🔦' },
    risque: { name: 'Audacieux', doors: 2, alarms: 1, icon: '💣' },
    extreme: { name: 'Kamikaze', doors: 3, alarms: 2, icon: '🔥' },
  };
  const pass = (m) => (MODES[m].doors - MODES[m].alarms) / MODES[m].doors;
  /** Multiplicateur du butin après k étages franchis. */
  const multAt = (mode, k) => (k <= 0 ? 0 : Math.floor(RTP * Math.pow(1 / pass(mode), k) * 100) / 100);
  /** Nouvelle tour : pour chaque étage, la liste des portes piégées. rnd(n) → entier dans [0, n[. */
  function newTower(mode, rnd) {
    const M = MODES[mode];
    return Array.from({ length: FLOORS }, () => {
      const doors = Array.from({ length: M.doors }, (_, i) => i);
      for (let i = doors.length - 1; i > 0; i--) { const j = rnd(i + 1); [doors[i], doors[j]] = [doors[j], doors[i]]; }
      return doors.slice(0, M.alarms).sort((a, b) => a - b);
    });
  }
  const api = { FLOORS, RTP, MODES, pass, multAt, newTower };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CasseEngine = api;
})(typeof window !== 'undefined' ? window : this);
