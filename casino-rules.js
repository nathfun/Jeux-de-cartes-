/*
 * Règles du Casino, partagées par l'app (mode sans serveur) et par le serveur (functions/) :
 * niveaux, défis du jour, succès, bonus, banque du temps, parties réelles, prix entre amis.
 * Toutes les fonctions travaillent sur un objet profil P et ajoutent leurs notifications à N
 * (tableau de { kind, title, text, icon }), affichées ensuite par l'app.
 */
(function (root) {
  'use strict';
  const AVATARS = ['🎩', '🦊', '🐯', '🦁', '🐼', '🐸', '🦄', '🐙', '🦉', '🐺', '👑', '😎', '🤠', '🧙', '🥷', '🚀'];
  const need = (n) => 50 * n * (n - 1); // XP totale pour atteindre le niveau n (niveau 2 : 100, 10 : 4 500, 20 : 19 000)
  function levelOf(xp) { let n = 1; while (need(n + 1) <= xp) n++; return n; }
  function title(lv) {
    return lv >= 35 ? 'Légende' : lv >= 20 ? 'High Roller' : lv >= 10 ? 'Joueur confirmé' : lv >= 5 ? 'Habitué' : 'Débutant';
  }
  // ---------- Boutique et déblocages ----------
  // Chaque objet : level = niveau minimum ; price = prix en € de la banque (0 = offert dès ce niveau).
  const FELTS = [
    { id: 'vert', name: 'Vert classique', level: 1, price: 0, a: '#0f5132', b: '#0a3a24' },
    { id: 'turquoise', name: 'Lagon', level: 2, price: 2000, a: '#0e7c7b', b: '#08504f' },
    { id: 'bleu', name: 'Bleu nuit', level: 3, price: 0, a: '#123a6b', b: '#0b2546' },
    { id: 'bordeaux', name: 'Bordeaux', level: 4, price: 3000, a: '#5c1a2e', b: '#3a0f1d' },
    { id: 'ocean', name: 'Océan profond', level: 5, price: 4000, a: '#0b4a6f', b: '#06283d' },
    { id: 'rouge', name: 'Rouge velours', level: 6, price: 0, a: '#6b1220', b: '#460a14' },
    { id: 'carbone', name: 'Carbone', level: 8, price: 6000, a: '#2b2f36', b: '#121417' },
    { id: 'violet', name: 'Violet royal', level: 10, price: 0, a: '#43206b', b: '#2b1446' },
    { id: 'etoile', name: 'Nuit étoilée', level: 12, price: 10000, a: '#1b2a5e', b: '#070b24' },
    { id: 'or', name: 'Or royal', level: 15, price: 15000, a: '#6b5214', b: '#3d2e08' },
    { id: 'noir', name: 'Noir et or', level: 20, price: 0, a: '#1c1c1c', b: '#0b0b0b' },
    { id: 'neon', name: 'Néon', level: 25, price: 30000, a: '#3b0a6b', b: '#0a2a4a' },
    { id: 'cosmos', name: 'Cosmos', level: 30, price: 50000, a: '#2a0f4f', b: '#050816' },
  ];
  const BACKS = [
    { id: 'bleu', name: 'Bleu', level: 1, price: 0, a: '#1c3d7a', b: '#24519e' },
    { id: 'violet', name: 'Améthyste', level: 2, price: 2000, a: '#4c1d95', b: '#6d28d9' },
    { id: 'rouge', name: 'Rouge', level: 4, price: 0, a: '#7a1c24', b: '#9e2430' },
    { id: 'noir', name: 'Onyx', level: 5, price: 3000, a: '#111827', b: '#374151' },
    { id: 'turquoise', name: 'Turquoise', level: 7, price: 5000, a: '#0e7490', b: '#14b8a6' },
    { id: 'vert', name: 'Émeraude', level: 8, price: 0, a: '#145c3a', b: '#1d7a4e' },
    { id: 'rose', name: 'Flamant', level: 10, price: 8000, a: '#9d174d', b: '#db2777' },
    { id: 'damier', name: 'Damier', level: 12, price: 10000, a: '#7f1d1d', b: '#0b0b0b' },
    { id: 'or', name: 'Or', level: 15, price: 0, a: '#8a6a1c', b: '#c9a24a' },
    { id: 'royal', name: 'Royal', level: 18, price: 20000, a: '#1e3a8a', b: '#d4a017' },
    { id: 'diamant', name: 'Diamant', level: 25, price: 35000, a: '#a5f3fc', b: '#e0f2fe' },
  ];
  // Avatars à débloquer (en plus des 16 de départ)
  const AVATAR_ITEMS = [
    { id: '👻', name: 'Fantôme', level: 2, price: 1000 },
    { id: '🐉', name: 'Dragon', level: 3, price: 1500 },
    { id: '🦈', name: 'Requin', level: 4, price: 2000 },
    { id: '👽', name: 'Alien', level: 5, price: 2500 },
    { id: '🎰', name: 'Jackpot', level: 5, price: 0 },
    { id: '🤖', name: 'Robot', level: 6, price: 3000 },
    { id: '🦩', name: 'Flamant', level: 7, price: 3500 },
    { id: '🦖', name: 'T-Rex', level: 8, price: 4000 },
    { id: '🃏', name: 'Joker', level: 10, price: 0 },
    { id: '🧛', name: 'Vampire', level: 10, price: 6000 },
    { id: '🧞', name: 'Génie', level: 12, price: 8000 },
    { id: '🚀', name: 'Fusée', level: 15, price: 0 },
    { id: '🐲', name: 'Dragon d\'or', level: 15, price: 12000 },
    { id: '🦹', name: 'Super-vilain', level: 18, price: 15000 },
    { id: '🏆', name: 'Trophée', level: 20, price: 0 },
    { id: '💎', name: 'Diamant', level: 22, price: 25000 },
    { id: '🔥', name: 'En feu', level: 28, price: 40000 },
    { id: '🌌', name: 'Galaxie', level: 35, price: 60000 },
  ];
  // Cadres autour de l'avatar (accueil et classement)
  const FRAMES = [
    { id: 'none', name: 'Simple', level: 1, price: 0 },
    { id: 'or', name: 'Or', level: 5, price: 0 },
    { id: 'neon', name: 'Néon', level: 8, price: 4000 },
    { id: 'glace', name: 'Glace', level: 10, price: 6000 },
    { id: 'feu', name: 'Feu', level: 14, price: 10000 },
    { id: 'arcenciel', name: 'Arc-en-ciel', level: 18, price: 15000 },
    { id: 'diamant', name: 'Diamant', level: 25, price: 30000 },
    { id: 'legende', name: 'Légende', level: 35, price: 0 },
  ];
  // Fusées de Rocket Crash : corps, nez, ailerons, flamme
  const ROCKETS = [
    { id: 'classique', name: 'Classique', level: 1, price: 0, body: ['#cbd5e1', '#ffffff', '#94a3b8'], nose: '#ec4899', fin: '#7c3aed', flame: ['#ffd166', '#ff7a00'] },
    { id: 'furtive', name: 'Furtive', level: 3, price: 2000, body: ['#1f2937', '#4b5563', '#111827'], nose: '#ef4444', fin: '#111827', flame: ['#93c5fd', '#3b82f6'] },
    { id: 'doree', name: 'Dorée', level: 6, price: 5000, body: ['#b7791f', '#fde68a', '#92400e'], nose: '#fbbf24', fin: '#b45309', flame: ['#fff7ad', '#f59e0b'] },
    { id: 'neon', name: 'Néon', level: 9, price: 7000, body: ['#0f172a', '#22d3ee', '#0f172a'], nose: '#f472b6', fin: '#a855f7', flame: ['#a5f3fc', '#22d3ee'] },
    { id: 'lave', name: 'Lave', level: 12, price: 9000, body: ['#450a0a', '#dc2626', '#1c1917'], nose: '#f97316', fin: '#7f1d1d', flame: ['#fde047', '#ef4444'] },
    { id: 'glace', name: 'Glace', level: 16, price: 12000, body: ['#bae6fd', '#f0f9ff', '#7dd3fc'], nose: '#38bdf8', fin: '#0284c7', flame: ['#e0f2fe', '#38bdf8'] },
    { id: 'arcenciel', name: 'Arc-en-ciel', level: 20, price: 20000, body: ['#f472b6', '#facc15', '#22d3ee'], nose: '#a855f7', fin: '#22c55e', flame: ['#fef08a', '#f472b6'] },
    { id: 'galactique', name: 'Galactique', level: 30, price: 40000, body: ['#1e1b4b', '#7c3aed', '#020617'], nose: '#22d3ee', fin: '#f0abfc', flame: ['#f5d0fe', '#a855f7'] },
  ];
  // Billes du Plinko : cœur, reflet et halo
  const BALLS = [
    { id: 'classique', name: 'Néon rose', level: 1, price: 0, c: ['#f472b6', '#fff0f7', '#ec4899'] },
    { id: 'cyan', name: 'Cyan', level: 2, price: 1500, c: ['#22d3ee', '#ecfeff', '#06b6d4'] },
    { id: 'or', name: 'Or', level: 5, price: 4000, c: ['#fbbf24', '#fffbeb', '#f59e0b'] },
    { id: 'emeraude', name: 'Émeraude', level: 8, price: 6000, c: ['#34d399', '#ecfdf5', '#10b981'] },
    { id: 'plasma', name: 'Plasma', level: 11, price: 9000, c: ['#a78bfa', '#f5f3ff', '#7c3aed'] },
    { id: 'braise', name: 'Braise', level: 15, price: 12000, c: ['#fb923c', '#fff7ed', '#ef4444'] },
    { id: 'perle', name: 'Perle', level: 19, price: 18000, c: ['#e2e8f0', '#ffffff', '#94a3b8'] },
    { id: 'nebuleuse', name: 'Nébuleuse', level: 28, price: 35000, c: ['#f0abfc', '#ffffff', '#22d3ee'] },
  ];
  // Titres affichés sous le pseudo (et dans le classement)
  const TITLES = [
    { id: '', name: 'Titre du niveau', level: 1, price: 0 },
    { id: 'croupier', name: 'Croupier en herbe', level: 2, price: 0 },
    { id: 'flambeur', name: 'Flambeur', level: 3, price: 1500 },
    { id: 'chanceux', name: 'Chanceux', level: 4, price: 2500 },
    { id: 'requin', name: 'Requin des tables', level: 5, price: 3000 },
    { id: 'astronaute', name: 'Astronaute', level: 6, price: 4000 },
    { id: 'bluff', name: 'Roi du bluff', level: 7, price: 5000 },
    { id: 'compteur', name: 'Compteur de cartes', level: 9, price: 6000 },
    { id: 'highroller', name: 'High Roller', level: 12, price: 12000 },
    { id: 'millionnaire', name: 'Millionnaire', level: 20, price: 30000 },
    { id: 'legende', name: 'Légende du Casino', level: 35, price: 0 },
  ];
  // Thèmes de toute l'app (couleurs de fond, panneaux, accent)
  const THEMES = [
    { id: 'classique', name: 'Classique', level: 1, price: 0, bg: '#10151c', panel: '#1a2129', border: '#2a333d', accent: '#f2c14e' },
    { id: 'nuit', name: 'Nuit bleue', level: 3, price: 2500, bg: '#0a1020', panel: '#121b33', border: '#22325a', accent: '#60a5fa' },
    { id: 'emeraude', name: 'Émeraude', level: 6, price: 5000, bg: '#07140f', panel: '#0f2219', border: '#1d3b2c', accent: '#34d399' },
    { id: 'neon', name: 'Néon', level: 8, price: 8000, bg: '#0b0617', panel: '#160d2b', border: '#3b1f6b', accent: '#e879f9' },
    { id: 'vegas', name: 'Las Vegas', level: 12, price: 12000, bg: '#170707', panel: '#2a0d0d', border: '#5a1a1a', accent: '#fbbf24' },
    { id: 'monte', name: 'Monte-Carlo', level: 18, price: 20000, bg: '#0c1210', panel: '#16201c', border: '#2f4a3e', accent: '#d4af37' },
    { id: 'arctique', name: 'Arctique', level: 22, price: 25000, bg: '#08131a', panel: '#10222d', border: '#1f4152', accent: '#7dd3fc' },
    { id: 'or', name: 'Or massif', level: 30, price: 45000, bg: '#120e04', panel: '#221a08', border: '#4a3a12', accent: '#facc15' },
  ];
  // Jetons : apparence des jetons dans tous les jeux (filtre de couleur)
  const CHIPS = [
    { id: 'classique', name: 'Classiques', level: 1, price: 0, filter: 'none' },
    { id: 'or', name: 'Dorés', level: 4, price: 3000, filter: 'sepia(1) saturate(3) brightness(1.1) hue-rotate(-10deg)' },
    { id: 'pastel', name: 'Pastel', level: 6, price: 4000, filter: 'saturate(.55) brightness(1.25)' },
    { id: 'neon', name: 'Néon', level: 9, price: 7000, filter: 'hue-rotate(160deg) saturate(2) drop-shadow(0 0 6px #22d3ee)' },
    { id: 'onyx', name: 'Onyx', level: 14, price: 10000, filter: 'grayscale(1) contrast(1.4) brightness(.8)' },
    { id: 'arcenciel', name: 'Arc-en-ciel', level: 24, price: 30000, filter: 'hue-rotate(90deg) saturate(2.5) drop-shadow(0 0 5px #f472b6)', anim: true },
  ];
  // Effets de victoire : ce qui pleut lors d'un gros gain
  const EFFECTS = [
    { id: 'pieces', name: 'Pluie de pièces', level: 1, price: 0, emojis: ['🪙', '💰', '💎', '⭐'] },
    { id: 'confettis', name: 'Confettis', level: 3, price: 2000, emojis: ['🎉', '🎊', '✨', '🎈'] },
    { id: 'coeurs', name: 'Cœurs', level: 5, price: 3000, emojis: ['❤️', '💖', '💘', '💝'] },
    { id: 'etoiles', name: 'Étoiles filantes', level: 7, price: 5000, emojis: ['⭐', '🌟', '✨', '💫'] },
    { id: 'feu', name: 'Feu d\'artifice', level: 11, price: 9000, emojis: ['🎆', '🎇', '🔥', '💥'] },
    { id: 'diamants', name: 'Diamants', level: 16, price: 14000, emojis: ['💎', '💠', '🔷', '✨'] },
    { id: 'espace', name: 'Espace', level: 20, price: 20000, emojis: ['🚀', '🌠', '🪐', '✨'] },
  ];
  // Récompenses exclusives (saisons, tournoi de la semaine) : ni achetables ni débloquées par niveau
  FRAMES.push({ id: 'saison', name: 'Champion de saison', level: 1, price: 0, exclusive: 'Saison : palier or' });
  TITLES.push(
    { id: 'saison_bronze', name: 'Saison bronze', level: 1, price: 0, exclusive: 'Saison : palier bronze' },
    { id: 'saison_argent', name: 'Saison argent', level: 1, price: 0, exclusive: 'Saison : palier argent' },
    { id: 'saison_or', name: 'Saison or', level: 1, price: 0, exclusive: 'Saison : palier or' },
    { id: 'saison_diamant', name: 'Saison diamant', level: 1, price: 0, exclusive: 'Saison : palier diamant' },
    { id: 'roi_semaine', name: 'Roi du poker de la semaine', level: 1, price: 0, exclusive: 'Tournoi de poker de la semaine : 1re place' });
  const SHOP = { felt: FELTS, back: BACKS, avatar: AVATAR_ITEMS, frame: FRAMES, rocket: ROCKETS, ball: BALLS, title: TITLES, theme: THEMES, chips: CHIPS, effect: EFFECTS };
  const SHOP_LABELS = { felt: 'Tapis', back: 'Dos de cartes', avatar: 'Avatars', frame: 'Cadres', rocket: 'Fusées', ball: 'Billes', title: 'Titres', theme: 'Thèmes', chips: 'Jetons', effect: 'Effets de victoire' };
  const DEFAULT_EQUIP = { felt: 'vert', back: 'bleu', frame: 'none', rocket: 'classique', ball: 'classique', title: '', theme: 'classique', chips: 'classique', effect: 'pieces' };
  const itemOf = (kind, id) => (SHOP[kind] || []).find((x) => x.id === id) || null;
  const ownKey = (kind, id) => kind + ':' + id;
  /** L'objet est-il utilisable : niveau atteint, et offert ou acheté. */
  function canUse(P, kind, id) {
    const it = itemOf(kind, id);
    if (!it) return false;
    if (it.exclusive) return !!(P.owned && P.owned[ownKey(kind, id)]);
    if (levelOf(P.xp) < it.level) return false;
    return !it.price || !!(P.owned && P.owned[ownKey(kind, id)]);
  }
  /** Achat : vérifie le niveau, le prix et la banque. Renvoie le prix payé, ou un message d'erreur. */
  function buyItem(P, kind, id, N) {
    const it = itemOf(kind, id);
    if (!it || !it.price) return { error: 'Objet introuvable.' };
    P.owned = P.owned || {};
    if (P.owned[ownKey(kind, id)]) return { error: 'Tu l\'as déjà.' };
    if (levelOf(P.xp) < it.level) return { error: 'Débloqué au niveau ' + it.level + '.' };
    if (P.wallet < it.price) return { error: 'Il te manque ' + Math.ceil(it.price - P.wallet).toLocaleString('fr-FR') + ' €.' };
    P.wallet -= it.price;
    P.owned[ownKey(kind, id)] = Date.now();
    const n = Object.keys(P.owned).length;
    if (n >= 1) unlock(P, 'shop1', N);
    if (n >= 10) unlock(P, 'shop10', N);
    if (n >= 25) unlock(P, 'shop25', N);
    return { price: it.price };
  }
  /** Ce que chaque niveau débloque (offert ou disponible à l'achat). */
  function unlocksAt(level) {
    const out = [];
    Object.keys(SHOP).forEach((k) => SHOP[k].forEach((it) => { if (it.level === level && level > 1 && !it.exclusive) out.push(Object.assign({ kind: k }, it)); }));
    return out;
  }

  const CHALLENGES = [
    { id: 'bj_wins3', game: 'Blackjack', text: 'Gagne 3 mains de blackjack', target: 3, reward: 400, xp: 60, on: (t, d) => (t === 'bj' && d.net > 0 ? 1 : 0) },
    { id: 'bj_hands15', game: 'Blackjack', text: 'Joue 15 mains de blackjack', target: 15, reward: 300, xp: 50, on: (t) => (t === 'bj' ? 1 : 0) },
    { id: 'bj_double', game: 'Blackjack', text: 'Gagne une main en doublant', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'bj' && d.doubledWin ? 1 : 0) },
    { id: 'bj_natural', game: 'Blackjack', text: 'Obtiens un blackjack', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'bj' && d.blackjack ? 1 : 0) },
    { id: 'pk_hands12', game: 'Poker', text: 'Joue 12 mains de poker', target: 12, reward: 300, xp: 50, on: (t) => (t === 'pk' ? 1 : 0) },
    { id: 'pk_trips', game: 'Poker', text: 'Gagne une main avec un brelan ou mieux', target: 1, reward: 600, xp: 80, on: (t, d) => (t === 'pk' && d.won && d.cat >= 3 ? 1 : 0) },
    { id: 'pk_top3', game: 'Poker', text: 'Termine dans les 3 premiers d\'un tournoi', target: 1, reward: 700, xp: 90, on: (t, d) => (t === 'pk-tourney' && d.place <= 3 ? 1 : 0) },
    { id: 'rl_spins10', game: 'Roulette', text: 'Joue 10 tours de roulette', target: 10, reward: 300, xp: 50, on: (t, d) => (t === 'rl' && d.staked > 0 ? 1 : 0) },
    { id: 'rl_plein', game: 'Roulette', text: 'Touche un plein à la roulette', target: 1, reward: 700, xp: 90, on: (t, d) => (t === 'rl' && d.pleinHit ? 1 : 0) },
    { id: 'rl_win200', game: 'Roulette', text: 'Gagne au moins 200 € en un seul tour', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'rl' && d.net >= 200 ? 1 : 0) },
    { id: 'any_win1000', game: 'Tous les jeux', text: 'Gagne 1 000 € au total aujourd\'hui', target: 1000, reward: 600, xp: 80, on: (t, d) => (['bj', 'rl', 'sl', 'cr', 'pl', 'tr', 'mn'].includes(t) && d.net > 0 ? d.net : 0) },
    { id: 'cr_rounds15', game: 'Rocket Crash', text: 'Joue 15 manches de Rocket Crash', target: 15, reward: 300, xp: 50, on: (t) => (t === 'cr' ? 1 : 0) },
    { id: 'cr_x3', game: 'Rocket Crash', text: 'Retire ta mise à ×3 ou plus', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'cr' && d.mult >= 3 ? 1 : 0) },
    { id: 'cr_wins5', game: 'Rocket Crash', text: 'Réussis 5 retraits avant l\'explosion', target: 5, reward: 400, xp: 60, on: (t, d) => (t === 'cr' && d.mult > 0 ? 1 : 0) },
    { id: 'pl_balls30', game: 'Plinko', text: 'Lâche 30 billes au Plinko', target: 30, reward: 300, xp: 50, on: (t) => (t === 'pl' ? 1 : 0) },
    { id: 'pl_x5', game: 'Plinko', text: 'Fais tomber une bille sur ×5 ou plus', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'pl' && d.mult >= 5 ? 1 : 0) },
    { id: 'pl_win300', game: 'Plinko', text: 'Gagne 300 € au Plinko aujourd\'hui', target: 300, reward: 500, xp: 70, on: (t, d) => (t === 'pl' && d.net > 0 ? d.net : 0) },
    { id: 'tr_trades10', game: 'Bourse Flash', text: 'Clôture 10 positions en bourse', target: 10, reward: 300, xp: 50, on: (t) => (t === 'tr' ? 1 : 0) },
    { id: 'tr_short', game: 'Bourse Flash', text: 'Gagne de l\'argent en vendant (pari sur la baisse)', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'tr' && d.dir < 0 && d.net > 0 ? 1 : 0) },
    { id: 'tr_win200', game: 'Bourse Flash', text: 'Gagne 200 € en bourse aujourd\'hui', target: 200, reward: 500, xp: 70, on: (t, d) => (t === 'tr' && d.net > 0 ? d.net : 0) },
    { id: 'mn_rounds10', game: 'Mines', text: 'Joue 10 manches de Mines', target: 10, reward: 300, xp: 50, on: (t) => (t === 'mn' ? 1 : 0) },
    { id: 'mn_x3', game: 'Mines', text: 'Encaisse à ×3 ou plus aux Mines', target: 1, reward: 500, xp: 70, on: (t, d) => (t === 'mn' && d.mult >= 3 ? 1 : 0) },
    { id: 'mn_gems20', game: 'Mines', text: 'Retourne 20 diamants aux Mines', target: 20, reward: 400, xp: 60, on: (t, d) => (t === 'mn' ? d.reveals : 0) },
    { id: 'sl_spins20', game: 'Machine à sous', text: 'Fais 20 tours de machine à sous', target: 20, reward: 300, xp: 50, on: (t) => (t === 'sl' ? 1 : 0) },
    { id: 'sl_free', game: 'Machine à sous', text: 'Déclenche des tours gratuits', target: 1, reward: 600, xp: 80, on: (t, d) => (t === 'sl' && d.freeTrigger ? 1 : 0) },
    { id: 'sl_x10', game: 'Machine à sous', text: 'Gagne au moins 10 fois ta mise en un tour', target: 1, reward: 600, xp: 80, on: (t, d) => (t === 'sl' && d.bet > 0 && d.net + d.bet >= 10 * d.bet ? 1 : 0) },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_win', icon: '🌟', name: 'Première victoire', text: 'Gagner une main ou un tour' },
    { id: 'bj_first', icon: '🂡', name: 'Blackjack !', text: 'Obtenir son premier blackjack' },
    { id: 'bj_10', icon: '🃏', name: 'Collectionneur', text: 'Obtenir 10 blackjacks' },
    { id: 'bj_100', icon: '♠️', name: 'Pilier du blackjack', text: 'Jouer 100 mains de blackjack' },
    { id: 'pk_quads', icon: '🎴', name: 'Carré', text: 'Gagner une main de poker avec un carré' },
    { id: 'pk_sflush', icon: '🌈', name: 'Quinte flush', text: 'Gagner avec une quinte flush' },
    { id: 'pk_champion', icon: '🏆', name: 'Champion', text: 'Gagner un tournoi de poker' },
    { id: 'pk_allin', icon: '💥', name: 'Tout ou rien', text: 'Gagner un tapis au poker' },
    { id: 'rl_plein', icon: '🎯', name: 'En plein dans le mille', text: 'Toucher un plein à la roulette' },
    { id: 'rl_zero', icon: '0️⃣', name: 'Ami du zéro', text: 'Gagner une mise sur le 0' },
    { id: 'rl_cashout', icon: '💰', name: 'Savoir s\'arrêter', text: 'Encaisser à la roulette avec +1 000 €' },
    { id: 'big_win', icon: '🤑', name: 'Gros gain', text: 'Gagner 10 fois sa mise en un coup' },
    { id: 'shop1', icon: '🛍️', name: 'Premier achat', text: 'Acheter un objet à la boutique' },
    { id: 'shop10', icon: '🎨', name: 'Collectionneur', text: 'Posséder 10 objets de la boutique' },
    { id: 'shop25', icon: '👑', name: 'Grand collectionneur', text: 'Posséder 25 objets de la boutique' },
    { id: 'lvl30', icon: '🌟', name: 'Vétéran', text: 'Atteindre le niveau 30' },
    { id: 'hands1000', icon: '🏋️', name: 'Infatigable', text: 'Jouer 1 000 mains ou tours en partie réelle' },
    { id: 'wins100', icon: '🥇', name: 'Gagnant', text: 'Gagner 100 mains ou tours' },
    { id: 'high_bet', icon: '💸', name: 'Gros joueur', text: 'Miser 250 € ou plus en une seule fois' },
    { id: 'daily30', icon: '📆', name: 'Pilier du Casino', text: 'Venir 30 jours d\'affilée' },
    { id: 'time_night', icon: '🛌', name: 'Gros dormeur', text: 'Encaisser une nuit complète à la banque du temps' },
    { id: 'season_gold', icon: '🏆', name: 'Saison en or', text: 'Finir une saison au palier or ou mieux' },
    { id: 'week_king', icon: '♚', name: 'Roi de la semaine', text: 'Finir 1er du tournoi de poker de la semaine entre amis' },
    { id: 'streak7', icon: '🍀', name: 'Sept à la suite', text: 'Gagner 7 fois d\'affilée', secret: true },
    { id: 'night_owl', icon: '🦉', name: 'Oiseau de nuit', text: 'Jouer entre minuit et 5 h du matin', secret: true },
    { id: 'cr_100', icon: '🌌', name: 'Vers l\'infini', text: 'Retirer à ×100 ou plus à Rocket Crash', secret: true },
    { id: 'cr_boom', icon: '💥', name: 'Pas de bol', text: 'Voir sa fusée exploser au décollage (×1,00) avec une mise', secret: true },
    { id: 'broke', icon: '🕳️', name: 'Au fond du trou', text: 'Avoir moins de 100 € en banque', secret: true },
    { id: 'pl_edge', icon: '🎯', name: 'Tout au bord', text: 'Faire tomber une bille dans une case du bord au Plinko' },
    { id: 'pl_1000', icon: '🔮', name: 'Bille en or', text: 'Toucher ×1 000 au Plinko', secret: true },
    { id: 'pl_500', icon: '⚪', name: 'Pluie de billes', text: 'Lâcher 500 billes au Plinko' },
    { id: 'tr_double', icon: '📈', name: 'Loup de Wall Street', text: 'Doubler sa mise sur une seule position en bourse' },
    { id: 'tr_liq', icon: '🧯', name: 'Appel de marge', text: 'Se faire liquider en bourse', secret: true },
    { id: 'tr_x10', icon: '💎', name: 'Mains de diamant', text: 'Clôturer une position à 10 fois la mise', secret: true },
    { id: 'mn_clear', icon: '💎', name: 'Démineur', text: 'Retourner toutes les cases sûres d\'une grille aux Mines' },
    { id: 'mn_x10', icon: '💠', name: 'Nerfs d\'acier', text: 'Encaisser à ×10 ou plus aux Mines' },
    { id: 'mn_first', icon: '🧨', name: 'Mauvais pied', text: 'Tomber sur une mine dès la première case', secret: true },
    { id: 'rocket10', icon: '🚀', name: 'Dans les étoiles', text: 'Retirer à ×10 ou plus à Rocket Crash' },
    { id: 'jackpot', icon: '🎰', name: 'Jackpot', text: 'Décrocher le jackpot à la machine à sous' },
    { id: 'friends', icon: '🤝', name: 'Entre potes', text: 'Jouer une partie entre amis' },
    { id: 'daily7', icon: '📅', name: 'Fidèle', text: 'Venir 7 jours d\'affilée' },
    { id: 'challenges10', icon: '✅', name: 'Relevé !', text: 'Terminer 10 défis du jour' },
    { id: 'lvl10', icon: '⭐', name: 'Joueur confirmé', text: 'Atteindre le niveau 10' },
    { id: 'lvl20', icon: '💎', name: 'High Roller', text: 'Atteindre le niveau 20' },
    { id: 'rich25', icon: '🏦', name: 'Grosse banque', text: 'Avoir 25 000 € en banque' },
    { id: 'rich100', icon: '👑', name: 'Millionnaire en herbe', text: 'Avoir 100 000 € en banque' },
  ];

  const TIME_PACKS = [
    // plus l'attente est longue, plus chaque minute rapporte : enchaîner les petites pauses n'est jamais plus rentable
    { id: 'cafe', icon: '☕', name: 'Pause café', minutes: 5, amount: 100 },       // 20 €/min
    { id: 'repas', icon: '🍔', name: 'Pause repas', minutes: 30, amount: 1000 },   // 33 €/min
    { id: 'soiree', icon: '🌙', name: 'Soirée', minutes: 120, amount: 4500 },      // 37,5 €/min
    { id: 'nuit', icon: '🛌', name: 'Nuit complète', minutes: 480, amount: 20000 }, // 41,7 €/min
  ];

  const START_WALLET = 10000;
  // Parrainage : le filleul et son parrain reçoivent REF_BONUS chacun quand le filleul a joué REF_MIN_HANDS mains ou tours
  const REF_BONUS = 2000, REF_MIN_HANDS = 10, REF_MAX = 25;
  const GAMES = { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette', slots: 'Machine à sous', crash: 'Rocket Crash', plinko: 'Plinko', trader: 'Bourse Flash', mines: 'Mines' };
  const pad = (n) => String(n).padStart(2, '0');
  // Date du jour (et de la veille) à l'heure de Paris : les défis et le bonus changent à minuit
  function dayOf(ms) {
    try {
      const p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
      return p.slice(0, 10);
    } catch (e) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  }
  const today = (now) => dayOf(now);
  const yesterday = (now) => dayOf(now - 86400000);

  function fresh(now) {
    return {
      pseudo: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], wallet: START_WALLET, xp: 0,
      totals: { hands: 0, wins: 0, bjHands: 0, bjBlackjacks: 0, pkHands: 0, rlSpins: 0, slSpins: 0, biggestWin: 0, challenges: 0 },
      achievements: {}, owned: {}, daily: null, bonus: { last: null, streak: 0 }, sessions: {}, timebank: null, prizes: {}, createdAt: now || Date.now(),
    };
  }
  function normalize(P, now) {
    const f = fresh(now);
    P = Object.assign(f, P || {});
    P.totals = Object.assign(fresh(now).totals, P.totals || {});
    P.achievements = P.achievements || {};
    P.sessions = P.sessions || {};
    P.prizes = P.prizes || {};
    P.bonus = P.bonus || { last: null, streak: 0 };
    return P;
  }

  function addXP(P, n, N) {
    const before = levelOf(P.xp);
    P.xp += Math.round(n);
    ensureSeason(P, Date.now(), N).xp += Math.round(n);
    const after = levelOf(P.xp);
    if (after > before) {
      const unlocked = [];
      for (let l = before + 1; l <= after; l++) unlocksAt(l).forEach((it) => unlocked.push(it.name + (it.price ? ' (boutique)' : '')));
      N.push({ kind: 'level', title: 'Niveau ' + after + ' !', text: title(after) + (unlocked.length ? ' — nouveau : ' + unlocked.slice(0, 4).join(', ') + (unlocked.length > 4 ? '…' : '') : ''), icon: '⬆️' });
      if (after >= 10) unlock(P, 'lvl10', N);
      if (after >= 20) unlock(P, 'lvl20', N);
      if (after >= 30) unlock(P, 'lvl30', N);
    }
  }
  function unlock(P, id, N) {
    if (P.achievements[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    P.achievements[id] = Date.now();
    N.push({ kind: 'achievement', title: 'Succès débloqué : ' + a.name, text: a.text + ' (+100 XP)', icon: a.icon });
    addXP(P, 100, N);
  }
  // ---------- Saisons (un mois) ----------
  const SEASON_TIERS = [
    { id: 'bronze', name: 'Bronze', xp: 300, icon: '🥉' },
    { id: 'argent', name: 'Argent', xp: 1500, icon: '🥈' },
    { id: 'or', name: 'Or', xp: 5000, icon: '🥇' },
    { id: 'diamant', name: 'Diamant', xp: 12000, icon: '💎' },
  ];
  function seasonOf(now) { return dayOf(now).slice(0, 7); }
  // Semaine du tournoi de poker : identifiée par la date du lundi (heure de Paris)
  function weekOf(now) {
    const d = new Date(dayOf(now) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  const weekPoints = (place) => (place === 1 ? 10 : place === 2 ? 6 : place === 3 ? 3 : 1);
  function ensureWeek(P, now) {
    const id = weekOf(now);
    if (!P.pokerWeek || P.pokerWeek.id !== id) { if (P.pokerWeek && P.pokerWeek.pts) P.pokerWeekPrev = P.pokerWeek; P.pokerWeek = { id, pts: 0, games: 0 }; }
    return P.pokerWeek;
  }
  function seasonTier(xp) { let t = null; SEASON_TIERS.forEach((x) => { if (xp >= x.xp) t = x; }); return t; }
  function seasonName(id) { const [y, m] = id.split('-').map(Number); return ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][m - 1] + ' ' + y; }
  /** Change de saison si besoin : récompenses de la saison finie selon le palier atteint. */
  function ensureSeason(P, now, N) {
    const id = seasonOf(now || Date.now());
    if (P.season && P.season.id === id) return P.season;
    const old = P.season;
    P.season = { id, xp: 0, net: 0 }; // d'abord la nouvelle saison (les récompenses donnent de l'XP)
    if (old && old.xp > 0) {
      const tier = seasonTier(old.xp);
      P.lastSeason = { id: old.id, xp: old.xp, net: old.net || 0, tier: tier ? tier.id : null };
      if (tier) {
        P.owned = P.owned || {};
        SEASON_TIERS.slice(0, SEASON_TIERS.indexOf(tier) + 1).forEach((t) => { P.owned['title:saison_' + t.id] = Date.now(); });
        (N || []).push({ kind: 'achievement', title: 'Saison de ' + seasonName(old.id) + ' terminée', text: 'Palier ' + tier.name + ' : récompenses exclusives ajoutées à ta collection', icon: tier.icon });
        if (SEASON_TIERS.indexOf(tier) >= 2) { P.owned['frame:saison'] = Date.now(); unlock(P, 'season_gold', N || []); }
      }
    }
    return P.season;
  }
  function checkWallet(P, N) {
    if (P.wallet < 100) unlock(P, 'broke', N);
    if (P.wallet >= 25000) unlock(P, 'rich25', N);
    if (P.wallet >= 100000) unlock(P, 'rich100', N);
  }

  // Les 3 défis du jour (choisis selon la date ; 3 jeux sur 4, qui tournent)
  function ensureDaily(P, now) {
    const d = today(now);
    if (P.daily && P.daily.date === d) return P.daily;
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (game) => { const list = CHALLENGES.filter((c) => c.game === game); return list[h % list.length]; };
    const all = ['Blackjack', 'Poker', 'Roulette', 'Machine à sous', 'Rocket Crash', 'Plinko', 'Bourse Flash', 'Mines'];
    const games = all.filter((g, i) => i !== (h >>> 3) % all.length);
    const ids = games.map((g) => pick(g).id);
    if (h % 3 === 0) ids[h % 3] = 'any_win1000';
    P.daily = { date: d, list: ids.map((id) => ({ id, progress: 0, done: false, claimed: false })) };
    return P.daily;
  }

  /**
   * Événements de jeu (parties réelles uniquement) :
   *  bj { net, bet, blackjack, doubledWin } · pk { won, net, cat, allinWon } · pk-tourney { place, players }
   *  rl { staked, net, pleinHit, zeroWin } · rl-cashout { diff } · sl { bet, net, jackpot, freeTrigger } · multi { game }
   */
  function track(P, type, d, now, N) {
    d = d || {};
    const T = P.totals;
    const isRound = ['bj', 'pk', 'rl', 'sl', 'cr', 'pl', 'tr', 'mn'].includes(type);
    if (isRound) {
      T.hands++;
      T.netBy = T.netBy || {};
      T.netBy[type] = Math.round(((T.netBy[type] || 0) + (d.net || 0)) * 100) / 100;
      ensureSeason(P, now, N).net = Math.round(((P.season.net || 0) + (d.net || 0)) * 100) / 100;
      if (d.net > 0) T.streak = (T.streak || 0) + 1; else if (d.net < 0) T.streak = 0;
      if (T.streak >= 7) unlock(P, 'streak7', N);
      if (T.hands >= 1000) unlock(P, 'hands1000', N);
      if (d.bet >= 250) unlock(P, 'high_bet', N);
      try { const h = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now))); if (h < 5) unlock(P, 'night_owl', N); } catch (e) { /* ignore */ }
      const lite = type === 'pl' || type === 'tr' || type === 'mn'; // Plinko : on lâche des billes très vite, chaque bille rapporte moins d'XP
      addXP(P, lite ? (d.bet >= 10 ? 2 : 1) : 5, N);
      if (d.net > 0) {
        T.wins++;
        addXP(P, Math.min(40, (lite ? 0 : 3) + d.net / 25), N);
        unlock(P, 'first_win', N);
        if (T.wins >= 100) unlock(P, 'wins100', N);
        if (d.net > T.biggestWin) T.biggestWin = d.net;
      }
    }
    if (type === 'bj') {
      T.bjHands++;
      if (d.blackjack) { T.bjBlackjacks++; unlock(P, 'bj_first', N); if (T.bjBlackjacks >= 10) unlock(P, 'bj_10', N); }
      if (T.bjHands >= 100) unlock(P, 'bj_100', N);
    }
    if (type === 'pk') {
      T.pkHands++;
      if (d.won && d.cat === 7) unlock(P, 'pk_quads', N);
      if (d.won && d.cat === 8) unlock(P, 'pk_sflush', N);
      if (d.allinWon) unlock(P, 'pk_allin', N);
    }
    if (type === 'pk-tourney') { addXP(P, d.place === 1 ? 150 : 40, N); if (d.place === 1) unlock(P, 'pk_champion', N); }
    if (type === 'rl') { T.rlSpins++; if (d.pleinHit) unlock(P, 'rl_plein', N); if (d.zeroWin) unlock(P, 'rl_zero', N); }
    if (type === 'rl-cashout' && d.diff >= 1000) unlock(P, 'rl_cashout', N);
    if (type === 'cr') {
      T.crRounds = (T.crRounds || 0) + 1;
      if (d.mult >= 10) unlock(P, 'rocket10', N);
      if (d.mult >= 100) unlock(P, 'cr_100', N);
      if (d.crash === 1 && d.bet > 0) unlock(P, 'cr_boom', N);
    }
    if (type === 'pl') {
      T.plBalls = (T.plBalls || 0) + 1;
      if (d.edge) unlock(P, 'pl_edge', N);
      if (d.mult >= 1000) unlock(P, 'pl_1000', N);
      if (T.plBalls >= 500) unlock(P, 'pl_500', N);
    }
    if (type === 'tr') {
      T.trTrades = (T.trTrades || 0) + 1;
      if (d.mult >= 2) unlock(P, 'tr_double', N);
      if (d.mult >= 10) unlock(P, 'tr_x10', N);
      if (d.liq) unlock(P, 'tr_liq', N);
    }
    if (type === 'mn') {
      T.mnRounds = (T.mnRounds || 0) + 1;
      if (d.clear) unlock(P, 'mn_clear', N);
      if (d.mult >= 10) unlock(P, 'mn_x10', N);
      if (d.firstBust) unlock(P, 'mn_first', N);
    }
    if (type === 'sl') { T.slSpins++; if (d.jackpot) unlock(P, 'jackpot', N); }
    if (type === 'multi') { unlock(P, 'friends', N); addXP(P, 20, N); }
    if (isRound && d.bet > 0 && d.net >= d.bet * 9) unlock(P, 'big_win', N);
    const daily = ensureDaily(P, now);
    daily.list.forEach((c) => {
      if (c.done) return;
      const def = CHALLENGES.find((x) => x.id === c.id);
      const inc = def ? def.on(type, d) : 0;
      if (!inc) return;
      c.progress = Math.min(def.target, c.progress + inc);
      if (c.progress >= def.target) {
        c.done = true;
        N.push({ kind: 'challenge', title: 'Défi du jour réussi !', text: def.text + ' — récupère ta récompense sur l\'accueil', icon: '✅' });
      }
    });
    checkWallet(P, N);
  }

  // Bonus quotidien : 500 €, +250 € par jour consécutif (jusqu'à 2 000 €)
  function bonusInfo(P, now) {
    if (P.bonus.last === today(now)) return { available: false, streak: P.bonus.streak };
    const streak = P.bonus.last === yesterday(now) ? P.bonus.streak + 1 : 1;
    return { available: true, streak, amount: Math.min(2000, 500 + 250 * (streak - 1)) };
  }
  function claimBonus(P, now, N) {
    const b = bonusInfo(P, now);
    if (!b.available) return 0;
    P.bonus = { last: today(now), streak: b.streak };
    P.wallet += b.amount;
    addXP(P, 30, N);
    if (b.streak >= 7) unlock(P, 'daily7', N);
    if (b.streak >= 30) unlock(P, 'daily30', N);
    checkWallet(P, N);
    return b.amount;
  }
  function claimChallenge(P, id, now, N) {
    const daily = ensureDaily(P, now);
    const c = daily.list.find((x) => x.id === id);
    const def = CHALLENGES.find((x) => x.id === id);
    if (!c || !c.done || c.claimed || !def) return 0;
    c.claimed = true;
    P.wallet += def.reward;
    P.totals.challenges++;
    addXP(P, def.xp, N);
    if (P.totals.challenges >= 10) unlock(P, 'challenges10', N);
    checkWallet(P, N);
    return def.reward;
  }

  // Banque du temps
  function timeInfo(P, now) {
    const t = P.timebank;
    if (!t) return null;
    const pack = TIME_PACKS.find((x) => x.id === t.pack);
    if (!pack) return null;
    return { pack, start: t.start, end: t.end, left: Math.max(0, t.end - now), ready: now >= t.end };
  }
  function startTime(P, id, now) {
    const pack = TIME_PACKS.find((x) => x.id === id);
    if (!pack || P.timebank) return false;
    P.timebank = { pack: id, start: now, end: now + pack.minutes * 60000 };
    return true;
  }
  function claimTime(P, now, N) {
    const t = timeInfo(P, now);
    if (!t || !t.ready) return 0;
    P.timebank = null;
    P.wallet += t.pack.amount;
    if (t.pack.id === 'nuit') unlock(P, 'time_night', N);
    checkWallet(P, N);
    return t.pack.amount;
  }

  // Parties réelles : on apporte une somme de la banque, on encaisse quand on veut
  function startSession(P, game, amount, now) {
    amount = Math.floor(amount);
    if (!GAMES[game]) return null;
    if (P.sessions[game]) return P.sessions[game];
    if (!(amount > 0) || amount > P.wallet) return null;
    P.wallet -= amount;
    P.sessions[game] = { stack: amount, start: amount, at: now };
    return P.sessions[game];
  }
  function cashOut(P, game, N) {
    const ss = P.sessions[game];
    if (!ss) return null;
    delete P.sessions[game];
    P.wallet += ss.stack;
    const diff = Math.round((ss.stack - ss.start) * 100) / 100;
    if (diff > 0) { P.totals.cashouts = (P.totals.cashouts || 0) + 1; addXP(P, Math.min(80, 10 + diff / 50), N); }
    checkWallet(P, N);
    return { start: ss.start, end: ss.stack, diff };
  }

  // Entre amis : 1er +500 €, 2e +200 € ; à deux joueurs, le gagnant +300 €
  function prizeFor(place, players) {
    if (players >= 3) return place === 1 ? 500 : place === 2 ? 200 : 0;
    if (players === 2) return place === 1 ? 300 : 0;
    return 0;
  }
  function prizeText(players) {
    return players >= 3 ? '1er : +500 €, 2e : +200 € sur ta banque' : players === 2 ? 'Le gagnant : +300 € sur sa banque' : 'Il faut au moins 2 joueurs pour gagner un prix';
  }
  function applyPrize(P, key, place, players, now, N) {
    if (P.prizes[key]) return 0;
    const v = prizeFor(place, players);
    P.prizes[key] = now;
    const keys = Object.keys(P.prizes).sort((a, b) => P.prizes[a] - P.prizes[b]);
    while (keys.length > 60) delete P.prizes[keys.shift()];
    unlock(P, 'friends', N);
    // historique des parties entre amis (affiché sur le profil public)
    const pre = String(key).split(':')[0];
    P.multiHist = [{ game: { bj: 'blackjack', pk: 'poker', rl: 'roulette' }[pre] || pre, place, players, prize: v, at: now }].concat(P.multiHist || []).slice(0, 15);
    if (v > 0) {
      P.wallet += v;
      P.totals.multiWins = (P.totals.multiWins || 0) + (place === 1 ? 1 : 0);
      addXP(P, place === 1 ? 120 : 50, N);
      checkWallet(P, N);
    } else addXP(P, 20, N);
    return v;
  }

  // Profil public (classement entre amis)
  function publicProfile(P, code) {
    return {
      pseudo: P.pseudo || 'Joueur', avatar: P.avatar, xp: P.xp, level: levelOf(P.xp), wallet: Math.round(P.wallet),
      biggestWin: Math.round(P.totals.biggestWin || 0), hands: P.totals.hands, achievements: Object.keys(P.achievements).length,
      code: code || null, updatedAt: Date.now(),
    };
  }

  const api = {
    weekOf, weekPoints, ensureWeek, SEASON_TIERS, seasonOf, seasonTier, seasonName, ensureSeason,
    AVATARS, FELTS, BACKS, SHOP, SHOP_LABELS, DEFAULT_EQUIP, itemOf, canUse, buyItem, unlocksAt, CHALLENGES, ACHIEVEMENTS, TIME_PACKS, START_WALLET, GAMES,
    need, levelOf, title, today, fresh, normalize, addXP, unlock, checkWallet, ensureDaily, track,
    bonusInfo, claimBonus, claimChallenge, timeInfo, startTime, claimTime, startSession, cashOut,
    prizeFor, prizeText, applyPrize, publicProfile, REF_BONUS, REF_MIN_HANDS, REF_MAX,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CasinoRules = api;
})(typeof window !== 'undefined' ? window : this);
