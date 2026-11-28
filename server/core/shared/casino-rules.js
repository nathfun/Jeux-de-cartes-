/*
 * Règles du Casino, partagées par l'app (mode sans serveur) et par le serveur (functions/) :
 * niveaux, défis du jour, succès, bonus, coffre, aide de secours, salons VIP, parties réelles, prix entre amis.
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
    { id: 'turquoise', name: 'Lagon', level: 2, price: 200, a: '#0e7c7b', b: '#08504f' },
    { id: 'bleu', name: 'Bleu nuit', level: 3, price: 0, a: '#123a6b', b: '#0b2546' },
    { id: 'bordeaux', name: 'Bordeaux', level: 4, price: 300, a: '#5c1a2e', b: '#3a0f1d' },
    { id: 'ocean', name: 'Océan profond', level: 5, price: 400, a: '#0b4a6f', b: '#06283d' },
    { id: 'rouge', name: 'Rouge velours', level: 6, price: 0, a: '#6b1220', b: '#460a14' },
    { id: 'carbone', name: 'Carbone', level: 8, price: 600, a: '#2b2f36', b: '#121417' },
    { id: 'violet', name: 'Violet royal', level: 10, price: 0, a: '#43206b', b: '#2b1446' },
    { id: 'etoile', name: 'Nuit étoilée', level: 12, price: 1000, a: '#1b2a5e', b: '#070b24' },
    { id: 'or', name: 'Or royal', level: 15, price: 1500, a: '#6b5214', b: '#3d2e08' },
    { id: 'noir', name: 'Noir et or', level: 20, price: 0, a: '#1c1c1c', b: '#0b0b0b' },
    { id: 'neon', name: 'Néon', level: 25, price: 3000, a: '#3b0a6b', b: '#0a2a4a' },
    { id: 'cosmos', name: 'Cosmos', level: 30, price: 5000, a: '#2a0f4f', b: '#050816' },
  ];
  const BACKS = [
    { id: 'bleu', name: 'Bleu', level: 1, price: 0, a: '#1c3d7a', b: '#24519e' },
    { id: 'violet', name: 'Améthyste', level: 2, price: 200, a: '#4c1d95', b: '#6d28d9' },
    { id: 'rouge', name: 'Rouge', level: 4, price: 0, a: '#7a1c24', b: '#9e2430' },
    { id: 'noir', name: 'Onyx', level: 5, price: 300, a: '#111827', b: '#374151' },
    { id: 'turquoise', name: 'Turquoise', level: 7, price: 500, a: '#0e7490', b: '#14b8a6' },
    { id: 'vert', name: 'Émeraude', level: 8, price: 0, a: '#145c3a', b: '#1d7a4e' },
    { id: 'rose', name: 'Flamant', level: 10, price: 800, a: '#9d174d', b: '#db2777' },
    { id: 'damier', name: 'Damier', level: 12, price: 1000, a: '#7f1d1d', b: '#0b0b0b' },
    { id: 'or', name: 'Or', level: 15, price: 0, a: '#8a6a1c', b: '#c9a24a' },
    { id: 'royal', name: 'Royal', level: 18, price: 2000, a: '#1e3a8a', b: '#d4a017' },
    { id: 'diamant', name: 'Diamant', level: 25, price: 3500, a: '#a5f3fc', b: '#e0f2fe' },
  ];
  // Avatars à débloquer (en plus des 16 de départ)
  const AVATAR_ITEMS = [
    { id: '👻', name: 'Fantôme', level: 2, price: 100 },
    { id: '🐉', name: 'Dragon', level: 3, price: 150 },
    { id: '🦈', name: 'Requin', level: 4, price: 200 },
    { id: '👽', name: 'Alien', level: 5, price: 250 },
    { id: '🎰', name: 'Jackpot', level: 5, price: 0 },
    { id: '🤖', name: 'Robot', level: 6, price: 300 },
    { id: '🦩', name: 'Flamant', level: 7, price: 350 },
    { id: '🦖', name: 'T-Rex', level: 8, price: 400 },
    { id: '🃏', name: 'Joker', level: 10, price: 0 },
    { id: '🧛', name: 'Vampire', level: 10, price: 600 },
    { id: '🧞', name: 'Génie', level: 12, price: 800 },
    { id: '🚀', name: 'Fusée', level: 15, price: 0 },
    { id: '🐲', name: 'Dragon d\'or', level: 15, price: 1200 },
    { id: '🦹', name: 'Super-vilain', level: 18, price: 1500 },
    { id: '🏆', name: 'Trophée', level: 20, price: 0 },
    { id: '💎', name: 'Diamant', level: 22, price: 2500 },
    { id: '🔥', name: 'En feu', level: 28, price: 4000 },
    { id: '🌌', name: 'Galaxie', level: 35, price: 6000 },
  ];
  // Cadres autour de l'avatar (accueil et classement)
  const FRAMES = [
    { id: 'none', name: 'Simple', level: 1, price: 0 },
    { id: 'or', name: 'Or', level: 5, price: 0 },
    { id: 'neon', name: 'Néon', level: 8, price: 400 },
    { id: 'glace', name: 'Glace', level: 10, price: 600 },
    { id: 'feu', name: 'Feu', level: 14, price: 1000 },
    { id: 'arcenciel', name: 'Arc-en-ciel', level: 18, price: 1500 },
    { id: 'diamant', name: 'Diamant', level: 25, price: 3000 },
    { id: 'legende', name: 'Légende', level: 35, price: 0 },
  ];
  // Fusées de Rocket Crash : corps, nez, ailerons, flamme
  const ROCKETS = [
    { id: 'classique', name: 'Classique', level: 1, price: 0, body: ['#cbd5e1', '#ffffff', '#94a3b8'], nose: '#ec4899', fin: '#7c3aed', flame: ['#ffd166', '#ff7a00'] },
    { id: 'furtive', name: 'Furtive', level: 3, price: 200, body: ['#1f2937', '#4b5563', '#111827'], nose: '#ef4444', fin: '#111827', flame: ['#93c5fd', '#3b82f6'] },
    { id: 'doree', name: 'Dorée', level: 6, price: 500, body: ['#b7791f', '#fde68a', '#92400e'], nose: '#fbbf24', fin: '#b45309', flame: ['#fff7ad', '#f59e0b'] },
    { id: 'neon', name: 'Néon', level: 9, price: 700, body: ['#0f172a', '#22d3ee', '#0f172a'], nose: '#f472b6', fin: '#a855f7', flame: ['#a5f3fc', '#22d3ee'] },
    { id: 'lave', name: 'Lave', level: 12, price: 900, body: ['#450a0a', '#dc2626', '#1c1917'], nose: '#f97316', fin: '#7f1d1d', flame: ['#fde047', '#ef4444'] },
    { id: 'glace', name: 'Glace', level: 16, price: 1200, body: ['#bae6fd', '#f0f9ff', '#7dd3fc'], nose: '#38bdf8', fin: '#0284c7', flame: ['#e0f2fe', '#38bdf8'] },
    { id: 'arcenciel', name: 'Arc-en-ciel', level: 20, price: 2000, body: ['#f472b6', '#facc15', '#22d3ee'], nose: '#a855f7', fin: '#22c55e', flame: ['#fef08a', '#f472b6'] },
    { id: 'galactique', name: 'Galactique', level: 30, price: 4000, body: ['#1e1b4b', '#7c3aed', '#020617'], nose: '#22d3ee', fin: '#f0abfc', flame: ['#f5d0fe', '#a855f7'] },
  ];
  // Billes du Plinko : cœur, reflet et halo
  const BALLS = [
    { id: 'classique', name: 'Néon rose', level: 1, price: 0, c: ['#f472b6', '#fff0f7', '#ec4899'] },
    { id: 'cyan', name: 'Cyan', level: 2, price: 150, c: ['#22d3ee', '#ecfeff', '#06b6d4'] },
    { id: 'or', name: 'Or', level: 5, price: 400, c: ['#fbbf24', '#fffbeb', '#f59e0b'] },
    { id: 'emeraude', name: 'Émeraude', level: 8, price: 600, c: ['#34d399', '#ecfdf5', '#10b981'] },
    { id: 'plasma', name: 'Plasma', level: 11, price: 900, c: ['#a78bfa', '#f5f3ff', '#7c3aed'] },
    { id: 'braise', name: 'Braise', level: 15, price: 1200, c: ['#fb923c', '#fff7ed', '#ef4444'] },
    { id: 'perle', name: 'Perle', level: 19, price: 1800, c: ['#e2e8f0', '#ffffff', '#94a3b8'] },
    { id: 'nebuleuse', name: 'Nébuleuse', level: 28, price: 3500, c: ['#f0abfc', '#ffffff', '#22d3ee'] },
  ];
  // Titres affichés sous le pseudo (et dans le classement)
  const TITLES = [
    { id: '', name: 'Titre du niveau', level: 1, price: 0 },
    { id: 'croupier', name: 'Croupier en herbe', level: 2, price: 0 },
    { id: 'flambeur', name: 'Flambeur', level: 3, price: 150 },
    { id: 'chanceux', name: 'Chanceux', level: 4, price: 250 },
    { id: 'requin', name: 'Requin des tables', level: 5, price: 300 },
    { id: 'astronaute', name: 'Astronaute', level: 6, price: 400 },
    { id: 'bluff', name: 'Roi du bluff', level: 7, price: 500 },
    { id: 'compteur', name: 'Compteur de cartes', level: 9, price: 600 },
    { id: 'highroller', name: 'High Roller', level: 12, price: 1200 },
    { id: 'millionnaire', name: 'Millionnaire', level: 20, price: 3000 },
    { id: 'legende', name: 'Légende du Casino', level: 35, price: 0 },
  ];
  // Thèmes de toute l'app (couleurs de fond, panneaux, accent)
  const THEMES = [
    { id: 'classique', name: 'Classique', level: 1, price: 0, bg: '#10151c', panel: '#1a2129', border: '#2a333d', accent: '#f2c14e' },
    { id: 'nuit', name: 'Nuit bleue', level: 3, price: 250, bg: '#0a1020', panel: '#121b33', border: '#22325a', accent: '#60a5fa' },
    { id: 'emeraude', name: 'Émeraude', level: 6, price: 500, bg: '#07140f', panel: '#0f2219', border: '#1d3b2c', accent: '#34d399' },
    { id: 'neon', name: 'Néon', level: 8, price: 800, bg: '#0b0617', panel: '#160d2b', border: '#3b1f6b', accent: '#e879f9' },
    { id: 'vegas', name: 'Las Vegas', level: 12, price: 1200, bg: '#170707', panel: '#2a0d0d', border: '#5a1a1a', accent: '#fbbf24' },
    { id: 'monte', name: 'Monte-Carlo', level: 18, price: 2000, bg: '#0c1210', panel: '#16201c', border: '#2f4a3e', accent: '#d4af37' },
    { id: 'arctique', name: 'Arctique', level: 22, price: 2500, bg: '#08131a', panel: '#10222d', border: '#1f4152', accent: '#7dd3fc' },
    { id: 'or', name: 'Or massif', level: 30, price: 4500, bg: '#120e04', panel: '#221a08', border: '#4a3a12', accent: '#facc15' },
  ];
  // Jetons : apparence des jetons dans tous les jeux (filtre de couleur)
  const CHIPS = [
    { id: 'classique', name: 'Classiques', level: 1, price: 0, filter: 'none' },
    { id: 'or', name: 'Dorés', level: 4, price: 300, filter: 'sepia(1) saturate(3) brightness(1.1) hue-rotate(-10deg)' },
    { id: 'pastel', name: 'Pastel', level: 6, price: 400, filter: 'saturate(.55) brightness(1.25)' },
    { id: 'neon', name: 'Néon', level: 9, price: 700, filter: 'hue-rotate(160deg) saturate(2) drop-shadow(0 0 6px #22d3ee)' },
    { id: 'onyx', name: 'Onyx', level: 14, price: 1000, filter: 'grayscale(1) contrast(1.4) brightness(.8)' },
    { id: 'arcenciel', name: 'Arc-en-ciel', level: 24, price: 3000, filter: 'hue-rotate(90deg) saturate(2.5) drop-shadow(0 0 5px #f472b6)', anim: true },
  ];
  // Effets de victoire : ce qui pleut lors d'un gros gain
  const EFFECTS = [
    { id: 'pieces', name: 'Pluie de pièces', level: 1, price: 0, emojis: ['🪙', '💰', '💎', '⭐'] },
    { id: 'confettis', name: 'Confettis', level: 3, price: 200, emojis: ['🎉', '🎊', '✨', '🎈'] },
    { id: 'coeurs', name: 'Cœurs', level: 5, price: 300, emojis: ['❤️', '💖', '💘', '💝'] },
    { id: 'etoiles', name: 'Étoiles filantes', level: 7, price: 500, emojis: ['⭐', '🌟', '✨', '💫'] },
    { id: 'feu', name: 'Feu d\'artifice', level: 11, price: 900, emojis: ['🎆', '🎇', '🔥', '💥'] },
    { id: 'diamants', name: 'Diamants', level: 16, price: 1400, emojis: ['💎', '💠', '🔷', '✨'] },
    { id: 'espace', name: 'Espace', level: 20, price: 2000, emojis: ['🚀', '🌠', '🪐', '✨'] },
  ];
  // Prestige : très chers, pour les grosses banques
  FRAMES.push({ id: 'platine', name: 'Platine (prestige)', level: 25, price: 5000 });
  TITLES.push({ id: 'magnat', name: 'Magnat (prestige)', level: 20, price: 4000 }, { id: 'baron', name: 'Baron du Lounge (prestige)', level: 30, price: 8000 });
  THEMES.push({ id: 'platine', name: 'Platine (prestige)', level: 25, price: 6000, bg: '#0e1114', panel: '#1b2127', border: '#3d4852', accent: '#e5e7eb' });
  // ---------- Cartes à collectionner (boosters) : objets qu'on ne trouve QUE dans les boosters (ou entre joueurs) ----------
  // rareté : commune, rare, épique, légendaire, mythique
  const RARITY = {
    commun: { name: 'Commune', w: 600, shard: 5, craft: 40, color: '#9ca3af' },
    rare: { name: 'Rare', w: 250, shard: 15, craft: 120, color: '#3b82f6' },
    epique: { name: 'Épique', w: 105, shard: 50, craft: 400, color: '#a855f7' },
    legendaire: { name: 'Légendaire', w: 40, shard: 200, craft: 1600, color: '#f59e0b' },
    mythique: { name: 'Mythique', w: 5, shard: 1000, craft: 8000, color: '#ef4444' },
    ultime: { name: 'Ultime', w: 0, shard: 5000, craft: 40000, color: '#22d3ee' },
  };
  const RARITY_ORDER = ['commun', 'rare', 'epique', 'legendaire', 'mythique', 'ultime'];
  const card = (r, o) => Object.assign({ level: 1, price: 0, card: r }, o);
  FELTS.push(
    card('commun', { id: 'c_sable', name: 'Sable chaud', a: '#8a6d3b', b: '#5a4522' }), card('commun', { id: 'c_menthe', name: 'Menthe', a: '#2f7d6d', b: '#1b4d43' }), card('commun', { id: 'c_ardoise', name: 'Ardoise', a: '#3b4654', b: '#232b35' }),
    card('rare', { id: 'c_lagune', name: 'Lagune', a: '#0891b2', b: '#164e63' }), card('rare', { id: 'c_crepuscule', name: 'Crépuscule', a: '#9a3412', b: '#4c1d95' }), card('rare', { id: 'c_jade', name: 'Jade impérial', a: '#047857', b: '#022c22' }),
    card('epique', { id: 'c_magma', name: 'Magma', a: '#dc2626', b: '#1c0a05' }), card('epique', { id: 'c_velours', name: 'Velours de minuit', a: '#312e81', b: '#020617' }),
    card('legendaire', { id: 'c_orliquide', name: 'Or liquide', a: '#facc15', b: '#713f12' }), card('legendaire', { id: 'c_spirale', name: 'Galaxie spirale', a: '#7e22ce', b: '#0c0a1f' }),
    card('mythique', { id: 'c_prisme', name: 'Prisme', a: '#ec4899', b: '#0ea5e9' }));
  BACKS.push(
    card('commun', { id: 'c_brique', name: 'Brique', a: '#9a3412', b: '#7c2d12' }), card('commun', { id: 'c_olive', name: 'Olive', a: '#4d5b1f', b: '#65752a' }), card('commun', { id: 'c_gris', name: 'Graphite', a: '#374151', b: '#4b5563' }),
    card('rare', { id: 'c_corail', name: 'Corail', a: '#f43f5e', b: '#fb923c' }), card('rare', { id: 'c_glacier', name: 'Glacier', a: '#38bdf8', b: '#e0f2fe' }), card('rare', { id: 'c_lilas', name: 'Lilas', a: '#a78bfa', b: '#ddd6fe' }),
    card('epique', { id: 'c_tigre', name: 'Tigre', a: '#f97316', b: '#111827' }), card('epique', { id: 'c_cyber', name: 'Cyber', a: '#0f172a', b: '#22d3ee' }),
    card('legendaire', { id: 'c_soleil', name: 'Soleil royal', a: '#b45309', b: '#fde047' }), card('legendaire', { id: 'c_abysse', name: 'Abysse', a: '#020617', b: '#1d4ed8' }),
    card('mythique', { id: 'c_eclipse', name: 'Éclipse', a: '#000000', b: '#f59e0b' }));
  AVATAR_ITEMS.push(
    card('commun', { id: '🐨', name: 'Koala' }), card('commun', { id: '🐧', name: 'Pingouin' }), card('commun', { id: '🦝', name: 'Raton laveur' }), card('commun', { id: '🐻', name: 'Ours' }),
    card('rare', { id: '🦜', name: 'Perroquet' }), card('rare', { id: '🐢', name: 'Tortue' }), card('rare', { id: '🦋', name: 'Papillon' }), card('rare', { id: '🐬', name: 'Dauphin' }),
    card('epique', { id: '🧜', name: 'Sirène' }), card('epique', { id: '🦸', name: 'Super-héros' }), card('epique', { id: '🧚', name: 'Fée' }), card('epique', { id: '🐳', name: 'Baleine' }),
    card('legendaire', { id: '🦅', name: 'Aigle royal' }), card('legendaire', { id: '🪐', name: 'Planète' }), card('legendaire', { id: '🐆', name: 'Guépard' }),
    card('mythique', { id: '☄️', name: 'Comète' }), card('mythique', { id: '🧿', name: 'Œil porte-bonheur' }));
  FRAMES.push(
    card('commun', { id: 'c_bronze', name: 'Bronze', ring: '#b87333', glow: 'rgba(184,115,51,.5)' }), card('commun', { id: 'c_menthe', name: 'Menthe', ring: '#34d399', glow: 'rgba(52,211,153,.4)' }),
    card('rare', { id: 'c_saphir', name: 'Saphir', ring: '#2563eb', glow: 'rgba(37,99,235,.7)' }), card('rare', { id: 'c_rubis', name: 'Rubis', ring: '#e11d48', glow: 'rgba(225,29,72,.7)' }),
    card('epique', { id: 'c_amethyste', name: 'Améthyste', ring: '#a855f7', glow: 'rgba(168,85,247,.85)' }), card('epique', { id: 'c_toxique', name: 'Toxique', ring: '#84cc16', glow: 'rgba(132,204,22,.85)' }),
    card('legendaire', { id: 'c_solaire', name: 'Couronne solaire', ring: '#fbbf24', glow: 'rgba(251,191,36,1)', anim: 'pulse' }), card('legendaire', { id: 'c_glacial', name: 'Glacial', ring: '#a5f3fc', glow: 'rgba(165,243,252,1)', anim: 'pulse' }),
    card('mythique', { id: 'c_prisme', name: 'Prisme vivant', ring: '#ec4899', glow: 'rgba(236,72,153,1)', anim: 'hue' }));
  ROCKETS.push(
    card('commun', { id: 'c_cargo', name: 'Cargo', body: ['#78716c', '#d6d3d1', '#57534e'], nose: '#f59e0b', fin: '#44403c', flame: ['#fed7aa', '#f97316'] }),
    card('rare', { id: 'c_sapin', name: 'Sapin', body: ['#14532d', '#22c55e', '#052e16'], nose: '#ef4444', fin: '#15803d', flame: ['#fef9c3', '#facc15'] }),
    card('rare', { id: 'c_bonbon', name: 'Bonbon', body: ['#f9a8d4', '#fdf2f8', '#f472b6'], nose: '#a855f7', fin: '#ec4899', flame: ['#fbcfe8', '#f472b6'] }),
    card('epique', { id: 'c_requin', name: 'Requin', body: ['#475569', '#cbd5e1', '#1e293b'], nose: '#0f172a', fin: '#334155', flame: ['#bae6fd', '#0ea5e9'] }),
    card('legendaire', { id: 'c_chrome', name: 'Chrome', body: ['#9ca3af', '#ffffff', '#4b5563'], nose: '#e5e7eb', fin: '#6b7280', flame: ['#ffffff', '#a78bfa'] }),
    card('mythique', { id: 'c_phenix', name: 'Phénix céleste', body: ['#7f1d1d', '#fde047', '#450a0a'], nose: '#fff7ed', fin: '#f97316', flame: ['#ffffff', '#ef4444'] }));
  BALLS.push(
    card('commun', { id: 'c_menthe', name: 'Menthe', c: ['#6ee7b7', '#ffffff', '#10b981'] }), card('commun', { id: 'c_peche', name: 'Pêche', c: ['#fdba74', '#fff7ed', '#fb923c'] }),
    card('rare', { id: 'c_saphir', name: 'Saphir', c: ['#3b82f6', '#dbeafe', '#1d4ed8'] }), card('epique', { id: 'c_toxique', name: 'Toxique', c: ['#a3e635', '#f7fee7', '#65a30d'] }),
    card('legendaire', { id: 'c_soleil', name: 'Petit soleil', c: ['#fde047', '#ffffff', '#f97316'] }), card('mythique', { id: 'c_trounoir', name: 'Trou noir', c: ['#0f0f0f', '#a855f7', '#000000'] }));
  TITLES.push(
    card('commun', { id: 'c_curieux', name: 'Curieux' }), card('commun', { id: 'c_noctambule', name: 'Noctambule' }), card('commun', { id: 'c_touriste', name: 'Touriste' }),
    card('rare', { id: 'c_stratege', name: 'Stratège' }), card('rare', { id: 'c_trefle', name: 'Trèfle à quatre feuilles' }), card('rare', { id: 'c_collection', name: 'Collectionneur' }),
    card('epique', { id: 'c_pirate', name: 'Pirate du Lounge' }), card('epique', { id: 'c_maestro', name: 'Maestro' }),
    card('legendaire', { id: 'c_parrain', name: 'Le Parrain' }), card('legendaire', { id: 'c_oracle', name: 'L\'Oracle' }),
    card('mythique', { id: 'c_intouchable', name: 'L\'Intouchable' }));
  THEMES.push(
    card('rare', { id: 'c_sakura', name: 'Sakura', bg: '#1a0b12', panel: '#2a1220', border: '#5b2440', accent: '#f9a8d4' }),
    card('rare', { id: 'c_foret', name: 'Forêt', bg: '#07120a', panel: '#0f2014', border: '#24452b', accent: '#86efac' }),
    card('epique', { id: 'c_synthwave', name: 'Synthwave', bg: '#12051f', panel: '#1f0a35', border: '#5b21b6', accent: '#f472b6' }),
    card('legendaire', { id: 'c_palace', name: 'Palace', bg: '#0f0a05', panel: '#1f150a', border: '#7c5a1c', accent: '#fcd34d' }),
    card('mythique', { id: 'c_aurore', name: 'Aurore', bg: '#030d12', panel: '#08202a', border: '#0e7490', accent: '#5eead4' }));
  CHIPS.push(
    card('rare', { id: 'c_glace', name: 'Glacés', filter: 'hue-rotate(180deg) saturate(.7) brightness(1.3)' }),
    card('epique', { id: 'c_braise', name: 'Braise', filter: 'sepia(1) saturate(5) hue-rotate(-30deg) drop-shadow(0 0 5px #f97316)' }),
    card('legendaire', { id: 'c_platine', name: 'Platine', filter: 'grayscale(1) brightness(1.5) drop-shadow(0 0 6px #e5e7eb)' }),
    card('mythique', { id: 'c_cosmique', name: 'Cosmiques', filter: 'hue-rotate(250deg) saturate(3) drop-shadow(0 0 7px #a855f7)', anim: true }));
  EFFECTS.push(
    card('commun', { id: 'c_bulles', name: 'Bulles', emojis: ['🫧', '💧', '🫧', '✨'] }), card('rare', { id: 'c_fleurs', name: 'Pétales', emojis: ['🌸', '🌺', '🌷', '🌼'] }),
    card('rare', { id: 'c_fruits', name: 'Salade de fruits', emojis: ['🍒', '🍋', '🍉', '🍇'] }), card('epique', { id: 'c_neige', name: 'Tempête de neige', emojis: ['❄️', '☃️', '🌨️', '✨'] }),
    card('legendaire', { id: 'c_dragons', name: 'Dragons', emojis: ['🐉', '🔥', '🐲', '💥'] }), card('mythique', { id: 'c_galaxie', name: 'Big Bang', emojis: ['🌌', '🪐', '☄️', '🌠'] }));
  // Luxe : objets hors de prix de la boutique, pour les plus grosses banques
  FRAMES.push({ id: 'l_couronne', name: 'Couronne de diamants (luxe)', level: 30, price: 50000, ring: '#e0f2fe', glow: 'rgba(224,242,254,1)', anim: 'hue', luxe: true });
  TITLES.push({ id: 'l_empereur', name: 'Empereur du Lounge (luxe)', level: 35, price: 100000, luxe: true });
  THEMES.push({ id: 'l_diamant', name: 'Diamant noir (luxe)', level: 30, price: 75000, luxe: true, bg: '#050507', panel: '#101018', border: '#3f3f5a', accent: '#c7d2fe' });

  // Objets VIP : portés seulement tant que le pass VIP est actif
  FRAMES.push({ id: 'vip', name: 'Couronne VIP', level: 1, price: 0, vipOnly: true });
  TITLES.push({ id: 'membre_vip', name: 'Membre VIP', level: 1, price: 0, vipOnly: true });
  THEMES.push({ id: 'lounge', name: 'Lounge VIP', level: 1, price: 0, vipOnly: true, bg: '#0b0906', panel: '#17120a', border: '#5c4516', accent: '#f5c542' });
  EFFECTS.push({ id: 'champagne', name: 'Champagne VIP', level: 1, price: 0, vipOnly: true, emojis: ['🍾', '🥂', '✨', '👑'] });
  // Nouveautés de la refonte : Le Parrain et le club VIP (objets VIP portés tant que le pass est actif)
  TITLES.push({ id: 'rembourseur', name: 'Bon payeur', level: 3, price: 300 }, { id: 'parrain', name: 'Le Parrain', level: 1, price: 0, exclusive: 'Le Parrain : réussir le palier 10' });
  FELTS.push({ id: 'famille', name: 'Tapis de la Famille', level: 6, price: 800, a: '#3f3f46', b: '#09090b' },
    { id: 'or_vip', name: 'Or massif VIP', level: 1, price: 0, vipOnly: true, a: '#a16207', b: '#3a2a08' });
  BACKS.push({ id: 'vip_noir', name: 'Noir et or VIP', level: 1, price: 0, vipOnly: true, a: '#1c1917', b: '#ca8a04' });
  AVATAR_ITEMS.push({ id: '🕴️', name: 'Homme de main', level: 4, price: 400 }, { id: '🤵', name: 'Gentleman VIP', level: 1, price: 0, vipOnly: true });
  // Objets rares : vendus seulement le jour où ils sont dans la « boutique du jour »
  FELTS.push({ id: 'aurore', name: 'Aurore boréale', level: 1, price: 900, a: '#0f766e', b: '#4c1d95', daily: true });
  BACKS.push({ id: 'holo', name: 'Holographique', level: 1, price: 700, a: '#67e8f9', b: '#f0abfc', daily: true });
  AVATAR_ITEMS.push({ id: '🦚', name: 'Paon', level: 1, price: 600, daily: true });
  FRAMES.push({ id: 'cristal', name: 'Cristal', level: 1, price: 1200, daily: true });
  ROCKETS.push({ id: 'phoenix', name: 'Phénix', level: 1, price: 1500, body: ['#7c2d12', '#fb923c', '#450a0a'], nose: '#fde047', fin: '#dc2626', flame: ['#fef08a', '#f97316'], daily: true });
  BALLS.push({ id: 'arcenciel', name: 'Arc-en-ciel', level: 1, price: 800, c: ['#f472b6', '#ffffff', '#22d3ee'], daily: true });
  TITLES.push({ id: 'chanceux_du_jour', name: 'Né sous une bonne étoile', level: 1, price: 500, daily: true });
  EFFECTS.push({ id: 'trefles', name: 'Pluie de trèfles', level: 1, price: 1000, emojis: ['🍀', '☘️', '✨', '🌟'], daily: true });
  // Récompenses exclusives (saisons, tournoi de la semaine) : ni achetables ni débloquées par niveau
  FRAMES.push({ id: 'saison', name: 'Champion de saison', level: 1, price: 0, exclusive: 'Saison : palier or' });
  TITLES.push(
    { id: 'saison_bronze', name: 'Saison bronze', level: 1, price: 0, exclusive: 'Saison : palier bronze' },
    { id: 'saison_argent', name: 'Saison argent', level: 1, price: 0, exclusive: 'Saison : palier argent' },
    { id: 'saison_or', name: 'Saison or', level: 1, price: 0, exclusive: 'Saison : palier or' },
    { id: 'saison_diamant', name: 'Saison diamant', level: 1, price: 0, exclusive: 'Saison : palier diamant' },
    { id: 'roi_semaine', name: 'Roi du poker de la semaine', level: 1, price: 0, exclusive: 'Tournoi de poker de la semaine : 1re place' });
  const SHOP = { felt: FELTS, back: BACKS, avatar: AVATAR_ITEMS, frame: FRAMES, rocket: ROCKETS, ball: BALLS, title: TITLES, theme: THEMES, chips: CHIPS, effect: EFFECTS };
  const SHOP_LABELS = { col: 'Cartes Légendes', felt: 'Tapis', back: 'Dos de cartes', avatar: 'Avatars', frame: 'Cadres', rocket: 'Fusées', ball: 'Billes', title: 'Titres', theme: 'Thèmes', chips: 'Jetons', effect: 'Effets de victoire' };
  const DEFAULT_EQUIP = { felt: 'vert', back: 'bleu', frame: 'none', rocket: 'classique', ball: 'classique', title: '', theme: 'classique', chips: 'classique', effect: 'pieces' };
  const itemOf = (kind, id) => (kind === 'col' ? (typeof COL_BY_ID !== 'undefined' && COL_BY_ID[id]) || null : (SHOP[kind] || []).find((x) => x.id === id) || null);
  const ownKey = (kind, id) => kind + ':' + id;
  /** Boutique du jour : 3 objets rares, choisis selon la date (les mêmes pour tout le monde). */
  function dailyOffer(now) {
    const pool = [], promo = [];
    Object.keys(SHOP).forEach((k) => SHOP[k].forEach((it) => {
      if (it.daily) pool.push({ kind: k, id: it.id });
      else if (it.price > 0 && !it.card && !it.vipOnly && !it.exclusive && !it.luxe) promo.push({ kind: k, id: it.id, promo: SHOP_PROMO, early: true });
    }));
    let h = 0; for (const c of dayOf(now || Date.now())) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const out = [], left = pool.slice(), lp = promo.slice();
    for (let i = 0; i < 3 && left.length; i++) { h = (h * 1103515245 + 12345) >>> 0; out.push(left.splice(h % left.length, 1)[0]); }
    // 2 promotions du jour (même les objets d'un niveau pas encore atteint)
    for (let i = 0; i < 2 && lp.length; i++) { h = (h * 1103515245 + 12345) >>> 0; out.push(lp.splice(h % lp.length, 1)[0]); }
    return out;
  }
  const SHOP_PROMO = 30, VIP_DISCOUNT = 20;
  /** Prix payé : promotion du jour (−30 %) puis remise VIP (−20 %). */
  function priceOf(P, kind, id, now) {
    const it = itemOf(kind, id);
    if (!it || !it.price) return 0;
    const o = dailyOffer(now || Date.now()).find((x) => x.kind === kind && x.id === id && x.promo);
    let p = it.price * (o ? 1 - o.promo / 100 : 1);
    if (isVip(P, now)) p *= 1 - VIP_DISCOUNT / 100;
    return Math.max(1, Math.round(p / 10) * 10);
  }
  const inPromo = (kind, id, now) => dailyOffer(now || Date.now()).some((x) => x.kind === kind && x.id === id && x.promo);
  /** L'objet est-il utilisable : niveau atteint, et offert ou acheté. */
  function canUse(P, kind, id) {
    const it = itemOf(kind, id);
    if (!it) return false;
    if (it.vipOnly) return isVip(P);
    if (it.exclusive || it.daily || it.card) return !!(P.owned && P.owned[ownKey(kind, id)]);
    if (P.owned && P.owned[ownKey(kind, id)]) return true;
    if (levelOf(P.xp) < it.level) return false;
    return !it.price;
  }
  /** Achat : vérifie le niveau, le prix et la banque. Renvoie le prix payé, ou un message d'erreur. */
  function buyItem(P, kind, id, N) {
    const it = itemOf(kind, id);
    if (!it || !it.price) return { error: 'Objet introuvable.' };
    P.owned = P.owned || {};
    if (P.owned[ownKey(kind, id)]) return { error: 'Tu l\'as déjà.' };
    if (levelOf(P.xp) < it.level && !inPromo(kind, id)) return { error: 'Débloqué au niveau ' + it.level + '.' };
    if (it.daily && !dailyOffer(Date.now()).some((x) => x.kind === kind && x.id === id)) return { error: 'Cet objet n\'est pas dans la boutique du jour.' };
    const price = priceOf(P, kind, id, Date.now());
    if (P.wallet < price) return { error: 'Il te manque ' + Math.ceil(price - P.wallet).toLocaleString('fr-FR') + ' jetons.' };
    P.wallet -= price;
    P.owned[ownKey(kind, id)] = Date.now();
    const n = Object.keys(P.owned).length;
    if (n >= 1) unlock(P, 'shop1', N);
    if (n >= 10) unlock(P, 'shop10', N);
    if (n >= 25) unlock(P, 'shop25', N);
    return { price };
  }
  /** Ce que chaque niveau débloque (offert ou disponible à l'achat). */
  function unlocksAt(level) {
    const out = [];
    Object.keys(SHOP).forEach((k) => SHOP[k].forEach((it) => { if (it.level === level && level > 1 && !it.exclusive) out.push(Object.assign({ kind: k }, it)); }));
    return out;
  }

  const CHALLENGES = [
    { id: 'bj_wins3', game: 'Blackjack', text: 'Gagne 3 mains de blackjack', target: 3, reward: 40, xp: 60, on: (t, d) => (t === 'bj' && d.net > 0 ? 1 : 0) },
    { id: 'bj_hands15', game: 'Blackjack', text: 'Joue 15 mains de blackjack', target: 15, reward: 30, xp: 50, on: (t) => (t === 'bj' ? 1 : 0) },
    { id: 'bj_double', game: 'Blackjack', text: 'Gagne une main en doublant', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'bj' && d.doubledWin ? 1 : 0) },
    { id: 'bj_natural', game: 'Blackjack', text: 'Obtiens un blackjack', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'bj' && d.blackjack ? 1 : 0) },
    { id: 'pk_hands12', game: 'Poker', text: 'Joue 12 mains de poker', target: 12, reward: 30, xp: 50, on: (t) => (t === 'pk' ? 1 : 0) },
    { id: 'pk_trips', game: 'Poker', text: 'Gagne une main avec un brelan ou mieux', target: 1, reward: 60, xp: 80, on: (t, d) => (t === 'pk' && d.won && d.cat >= 3 ? 1 : 0) },
    { id: 'pk_top3', game: 'Poker', text: 'Termine dans les 3 premiers d\'un tournoi', target: 1, reward: 70, xp: 90, on: (t, d) => (t === 'pk-tourney' && d.place <= 3 ? 1 : 0) },
    { id: 'rl_spins10', game: 'Roulette', text: 'Joue 10 tours de roulette', target: 10, reward: 30, xp: 50, on: (t, d) => (t === 'rl' && d.staked > 0 ? 1 : 0) },
    { id: 'rl_plein', game: 'Roulette', text: 'Touche un plein à la roulette', target: 1, reward: 70, xp: 90, on: (t, d) => (t === 'rl' && d.pleinHit ? 1 : 0) },
    { id: 'rl_win200', game: 'Roulette', text: 'Gagne au moins 20 € en un seul tour', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'rl' && d.net >= 20 ? 1 : 0) },
    { id: 'any_win1000', game: 'Tous les jeux', text: 'Gagne 100 € au total aujourd\'hui', target: 100, reward: 60, xp: 80, on: (t, d) => (['bj', 'rl', 'sl', 'cr', 'pl', 'tr', 'mn', 'lo'].includes(t) && d.net > 0 ? d.net : 0) },
    { id: 'cr_rounds15', game: 'Rocket Crash', text: 'Joue 15 manches de Rocket Crash', target: 15, reward: 30, xp: 50, on: (t) => (t === 'cr' ? 1 : 0) },
    { id: 'cr_x3', game: 'Rocket Crash', text: 'Retire ta mise à ×3 ou plus', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'cr' && d.mult >= 3 ? 1 : 0) },
    { id: 'cr_wins5', game: 'Rocket Crash', text: 'Réussis 5 retraits avant l\'explosion', target: 5, reward: 40, xp: 60, on: (t, d) => (t === 'cr' && d.mult > 0 ? 1 : 0) },
    { id: 'pl_balls30', game: 'Plinko', text: 'Lâche 30 billes au Plinko', target: 30, reward: 30, xp: 50, on: (t) => (t === 'pl' ? 1 : 0) },
    { id: 'pl_x5', game: 'Plinko', text: 'Fais tomber une bille sur ×5 ou plus', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'pl' && d.mult >= 5 ? 1 : 0) },
    { id: 'pl_win300', game: 'Plinko', text: 'Gagne 30 € au Plinko aujourd\'hui', target: 30, reward: 50, xp: 70, on: (t, d) => (t === 'pl' && d.net > 0 ? d.net : 0) },
    { id: 'tr_trades10', game: 'Bourse Flash', text: 'Clôture 10 positions en bourse', target: 10, reward: 30, xp: 50, on: (t) => (t === 'tr' ? 1 : 0) },
    { id: 'tr_short', game: 'Bourse Flash', text: 'Gagne de l\'argent en vendant (pari sur la baisse)', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'tr' && d.dir < 0 && d.net > 0 ? 1 : 0) },
    { id: 'tr_win200', game: 'Bourse Flash', text: 'Gagne 20 € en bourse aujourd\'hui', target: 20, reward: 50, xp: 70, on: (t, d) => (t === 'tr' && d.net > 0 ? d.net : 0) },
    { id: 'lo_draws10', game: 'Loto Express', text: 'Joue 10 tirages au Loto Express', target: 10, reward: 30, xp: 50, on: (t) => (t === 'lo' ? 1 : 0) },
    { id: 'lo_hits4', game: 'Loto Express', text: 'Trouve 4 bons numéros (ou plus) en un tirage', target: 1, reward: 60, xp: 80, on: (t, d) => (t === 'lo' && d.hits >= 4 ? 1 : 0) },
    { id: 'mn_rounds10', game: 'Mines', text: 'Joue 10 manches de Mines', target: 10, reward: 30, xp: 50, on: (t) => (t === 'mn' ? 1 : 0) },
    { id: 'mn_x3', game: 'Mines', text: 'Encaisse à ×3 ou plus aux Mines', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'mn' && d.mult >= 3 ? 1 : 0) },
    { id: 'mn_gems20', game: 'Mines', text: 'Retourne 20 diamants aux Mines', target: 20, reward: 40, xp: 60, on: (t, d) => (t === 'mn' ? d.reveals : 0) },
    { id: 'sl_spins20', game: 'Machine à sous', text: 'Fais 20 tours de machine à sous', target: 20, reward: 30, xp: 50, on: (t) => (t === 'sl' ? 1 : 0) },
    { id: 'sl_free', game: 'Machine à sous', text: 'Déclenche des tours gratuits', target: 1, reward: 60, xp: 80, on: (t, d) => (t === 'sl' && d.freeTrigger ? 1 : 0) },
    { id: 'sl_x10', game: 'Machine à sous', text: 'Gagne au moins 10 fois ta mise en un tour', target: 1, reward: 60, xp: 80, on: (t, d) => (t === 'sl' && d.bet > 0 && d.net + d.bet >= 10 * d.bet ? 1 : 0) },
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
    { id: 'rl_cashout', icon: '💰', name: 'Savoir s\'arrêter', text: 'Encaisser à la roulette avec +100 €' },
    { id: 'big_win', icon: '🤑', name: 'Gros gain', text: 'Gagner 10 fois sa mise en un coup' },
    { id: 'shop1', icon: '🛍️', name: 'Premier achat', text: 'Acheter un objet à la boutique' },
    { id: 'shop10', icon: '🎨', name: 'Collectionneur', text: 'Posséder 10 objets de la boutique' },
    { id: 'shop25', icon: '👑', name: 'Grand collectionneur', text: 'Posséder 25 objets de la boutique' },
    { id: 'lvl30', icon: '🌟', name: 'Vétéran', text: 'Atteindre le niveau 30' },
    { id: 'hands1000', icon: '🏋️', name: 'Infatigable', text: 'Jouer 1 000 mains ou tours en partie réelle' },
    { id: 'wins100', icon: '🥇', name: 'Gagnant', text: 'Gagner 100 mains ou tours' },
    { id: 'high_bet', icon: '💸', name: 'Gros joueur', text: 'Miser 50 € ou plus en une seule fois' },
    { id: 'daily30', icon: '📆', name: 'Pilier du Casino', text: 'Venir 30 jours d\'affilée' },
    { id: 'time_night', icon: '🛌', name: 'Gros dormeur', text: 'Encaisser une nuit complète à la banque du temps' },
    { id: 'season_gold', icon: '🏆', name: 'Saison en or', text: 'Finir une saison au palier or ou mieux' },
    { id: 'week_king', icon: '♚', name: 'Roi de la semaine', text: 'Finir 1er du tournoi de poker de la semaine entre amis' },
    { id: 'streak7', icon: '🍀', name: 'Sept à la suite', text: 'Gagner 7 fois d\'affilée', secret: true },
    { id: 'night_owl', icon: '🦉', name: 'Oiseau de nuit', text: 'Jouer entre minuit et 5 h du matin', secret: true },
    { id: 'cr_100', icon: '🌌', name: 'Vers l\'infini', text: 'Retirer à ×100 ou plus à Rocket Crash', secret: true },
    { id: 'cr_boom', icon: '💥', name: 'Pas de bol', text: 'Voir sa fusée exploser au décollage (×1,00) avec une mise', secret: true },
    { id: 'broke', icon: '🕳️', name: 'Au fond du trou', text: 'Avoir moins de 10 € en banque', secret: true },
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
    { id: 'rich25', icon: '🏦', name: 'Grosse banque', text: 'Avoir 2 500 € en banque' },
    { id: 'rich100', icon: '👑', name: 'Millionnaire en herbe', text: 'Avoir 10 000 € en banque' },
    { id: 'vip', icon: '🥂', name: 'Salon VIP', text: 'Entrer dans le salon Argent (niveau 10)' },
    { id: 'vip_pass', icon: '👑', name: 'Membre du club', text: 'Prendre un pass VIP' },
    { id: 'run_p1', icon: '🕴️', name: 'Premier remboursement', text: 'Réussir le palier 1 du Parrain' },
    { id: 'run_p3', icon: '💼', name: 'Homme de confiance', text: 'Réussir le palier 3' },
    { id: 'run_p5', icon: '🎩', name: 'Bras droit', text: 'Réussir le palier 5' },
    { id: 'run_p10', icon: '👑', name: 'Le nouveau parrain', text: 'Réussir le palier 10' },
    { id: 'run_p15', icon: '💎', name: 'Intouchable', text: 'Réussir le palier 15' },
    { id: 'run_p20', icon: '🏛️', name: 'Empire du jeu', text: 'Réussir le palier 20' },
    { id: 'box1', icon: '🎁', name: 'Curieux', text: 'Ouvrir un coffre mystère' },
    { id: 'box25', icon: '🧰', name: 'Chasseur de trésors', text: 'Ouvrir 25 coffres mystères' },
    { id: 'box_myth', icon: '🌈', name: 'Le coffre des dieux', text: 'Trouver un objet mythique dans un coffre' },
    { id: 'god_pack', icon: '🌟', name: 'Béni des dieux', text: 'Ouvrir un God Pack' },
    { id: 'ultime', icon: '💠', name: 'L\'impossible', text: 'Trouver une carte Ultime' },
    { id: 'mt_win', icon: '🪙', name: 'Table gagnante', text: 'Quitter une table multijoueur avec plus de jetons qu\'en arrivant' },
    { id: 'pk_pot', icon: '♠', name: 'Rafle la cagnotte', text: 'Gagner une cagnotte de poker' },
    { id: 'cards10', icon: '🃏', name: 'Collectionneur', text: 'Ouvrir 10 cartes de booster' },
    { id: 'mythic', icon: '🔴', name: 'Mythique !', text: 'Obtenir une carte mythique' },
    { id: 'lo_five', icon: '🎱', name: 'Cinq sur la grille', text: 'Trouver 5 bons numéros au Loto Express' },
    { id: 'lo_jackpot', icon: '🍀', name: 'Carton plein', text: 'Trouver tous ses numéros au Loto Express (5 numéros ou plus)' },
    { id: 'duel_win', icon: '⚔️', name: 'Duelliste', text: 'Gagner un duel contre un ami' },
  ];

  // Coffre : il se remplit tout seul (CHEST_RATE € par heure, au plus CHEST_CAP €) ; on l'ouvre quand on veut
  const CHEST_RATE = 25, CHEST_CAP = 200;
  // Aide de secours : si banque + tables < RESCUE_BELOW €, RESCUE_AMOUNT € une fois par jour
  const RESCUE_BELOW = 50, RESCUE_AMOUNT = 200;
  // Salons VIP : la mise maximale par coup monte avec le niveau
  const VIP = [
    { lvl: 1, id: 'salle', name: 'Grande salle', icon: '🎲', max: 50 },
    { lvl: 10, id: 'argent', name: 'Salon Argent', icon: '🥈', max: 100 },
    { lvl: 20, id: 'or', name: 'Salon Or', icon: '🥇', max: 250 },
    { lvl: 30, id: 'diamant', name: 'Salon Diamant', icon: '💎', max: 500 },
  ];
  function vipOf(P) { const lv = levelOf(P.xp || 0); let v = VIP[0]; VIP.forEach((x) => { if (lv >= x.lvl) v = x; }); return v; }
  // Pass VIP (acheté avec l'argent du jeu ; prévu pour pouvoir être offert ou payé autrement plus tard)
  const VIP_PASS = [
    { id: 'week', name: 'Pass VIP · 7 jours', days: 7, price: 7000 },
    { id: 'month', name: 'Pass VIP · 30 jours', days: 30, price: 25000, best: true },
  ];
  const VIP_PERKS = [
    { icon: '💶', text: 'Le Parrain : 1 100 € au départ de chaque partie (au lieu de 1 000 €)' },
    { icon: '💰', text: 'Limites de mise relevées d\'environ 60 % à chaque palier' },
    { icon: '🎁', text: '2 coffres mystères gratuits par jour (au lieu d\'1)' },
    { icon: '🏷️', text: '−20 % sur toute la boutique et sur les coffres' },
    { icon: '🔒', text: 'Tables privées de blackjack et de roulette pour jouer entre amis' },
    { icon: '♠', text: 'Poker High Roller : grosses cagnottes, tapis noir et or' },
    { icon: '🎉', text: 'Bonus de connexion du jour ×1,5' },
    { icon: '👑', text: 'Couronne, titre, thème, tapis, dos de cartes, avatar et effet VIP offerts' },
  ];
  const isVip = (P, now) => !!(P && P.vipUntil && P.vipUntil > (now || Date.now()));
  const maxBet = (P, now) => runMaxBet(P, now);
  function buyVip(P, id, now, N) {
    const pass = VIP_PASS.find((x) => x.id === id);
    if (!pass) return { error: 'Pass inconnu.' };
    if (P.wallet < pass.price) return { error: 'Il te manque ' + Math.ceil(pass.price - P.wallet).toLocaleString('fr-FR') + ' €.' };
    P.wallet -= pass.price;
    grantVip(P, pass.days, now, 'jeu');
    unlock(P, 'vip_pass', N);
    N.push({ kind: 'vip', title: 'Bienvenue au club VIP 👑', text: 'Ton pass est actif jusqu\'au ' + new Date(P.vipUntil).toLocaleDateString('fr-FR') + '.', icon: '👑' });
    return { price: pass.price, until: P.vipUntil };
  }
  /** Prolonge le VIP de `days` jours (achat dans le jeu, cadeau de l'admin, et plus tard paiement réel). */
  function grantVip(P, days, now, source) {
    const from = Math.max(now, P.vipUntil || 0);
    P.vipUntil = from + days * 86400000;
    P.vipLog = (P.vipLog || []).concat([{ at: now, days, source: source || 'jeu' }]).slice(-20);
    return P.vipUntil;
  }
  // Roue de la fortune : un tour gratuit par jour (deux pour les VIP)
  const WHEEL = [
    { v: 20, w: 240 }, { v: 50, w: 200 }, { v: 30, w: 220 }, { v: 100, w: 100 }, { v: 75, w: 130 },
    { v: 250, w: 35 }, { v: 150, w: 60 }, { v: 1000, w: 3 }, { v: 500, w: 12 },
  ];
  function wheelInfo(P, now) {
    const d = today(now), used = P.wheel && P.wheel.day === d ? P.wheel.n : 0, max = isVip(P, now) ? 2 : 1;
    return { left: Math.max(0, max - used), max, used };
  }
  function spinWheel(P, now, rnd, N) {
    if (!wheelInfo(P, now).left) return null;
    const total = WHEEL.reduce((a, x) => a + x.w, 0);
    let r = rnd(total), idx = 0;
    while (r >= WHEEL[idx].w) { r -= WHEEL[idx].w; idx++; }
    const d = today(now);
    P.wheel = { day: d, n: (P.wheel && P.wheel.day === d ? P.wheel.n : 0) + 1 };
    P.wallet += WHEEL[idx].v;
    addXP(P, 10, N);
    checkWallet(P, N);
    return { index: idx, amount: WHEEL[idx].v };
  }
  const TIME_PACKS = []; // ancienne banque du temps (remplacée par le coffre)

  const START_WALLET = 500; // jetons de départ d'un nouveau compte
  // Parrainage : le filleul et son parrain reçoivent REF_BONUS jetons chacun quand le filleul réussit son premier palier du Parrain
  const REF_BONUS = 150, REF_MIN_HANDS = 10, REF_MAX = 25;
  const refDone = (P) => (P.bestPalier || 0) >= 1;
  // Tables multijoueur en jetons (blackjack, roulette) : mise d'entrée minimale, gain plafonné (×CAP de l'apport)
  const MT = { MIN: 50, CAP: 10, TABLES: 2, PRESETS: [100, 250, 500, 1000] };
  const GAMES = { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette', slots: 'Machine à sous', crash: 'Rocket Crash', plinko: 'Plinko', trader: 'Bourse Flash', mines: 'Mines', gold: 'Ruée vers l\'Or', loto: 'Loto Express', wheel: 'Roue de la fortune', boosters: 'Boosters', horses: 'Course de chevaux', heist: 'Le Braquage' };
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
      econ: 3, chestAt: now || Date.now(), run: null, bestPalier: 0,
    };
  }
  function normalize(P, now) {
    const f = fresh(now);
    const oldEcon = P ? (P.econ || 1) : 3; // profil existant d'avant la version 3 ?
    P = Object.assign(f, P || {});
    P.econ = oldEcon;
    P.totals = Object.assign(fresh(now).totals, P.totals || {});
    P.achievements = P.achievements || {};
    P.sessions = P.sessions || {};
    P.prizes = P.prizes || {};
    P.wallet = Math.round((Number(P.wallet) || 0) * 100) / 100; // pas de 1199,9999999 € (arrondi au centime)
    P.bonus = P.bonus || { last: null, streak: 0 };
    // Version 3 (jetons + mode « Le Parrain ») : tous les comptes repartent de zéro, on garde l'identité
    if (P.econ !== 3) {
      const keep = { pseudo: P.pseudo, avatar: P.avatar, friendCode: P.friendCode, friendCodeUid: P.friendCodeUid, createdAt: P.createdAt, refBy: P.refBy, refByName: P.refByName, equipped: P.equipped, settings: P.settings, friends: P.friends };
      Object.keys(P).forEach((k) => delete P[k]);
      Object.assign(P, fresh(now), keep);
      Object.keys(keep).forEach((k) => { if (keep[k] === undefined) delete P[k]; });
      P.econ = 3;
      P._econMigrated = true;
    }
    if (!P.chestAt) P.chestAt = now || Date.now();
    return P;
  }

  function addXP(P, n, N) {
    const before = levelOf(P.xp);
    if (isVip(P)) n *= 1.25;
    P.xp += Math.round(n);
    ensureSeason(P, Date.now(), N).xp += Math.round(n);
    const after = levelOf(P.xp);
    if (after >= 10 && before < 10) unlock(P, 'vip', N);
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
    if (P.wallet < 10) unlock(P, 'broke', N);
    if (P.wallet >= 2500) unlock(P, 'rich25', N);
    if (P.wallet >= 10000) unlock(P, 'rich100', N);
  }

  // Les 3 défis du jour (choisis selon la date ; 3 jeux sur 4, qui tournent)
  function ensureDaily(P, now) {
    const d = today(now);
    if (P.daily && P.daily.date === d && P.daily.list.length <= 3) return P.daily;
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (game) => { const list = CHALLENGES.filter((c) => c.game === game); return list[h % list.length]; };
    // 3 défis par jour, sur les jeux ouverts dès le palier 1 du Parrain
    const games = ['Blackjack', 'Roulette', 'Machine à sous'];
    const ids = games.map((g) => pick(g).id);
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
    const isRound = ['bj', 'pk', 'rl', 'sl', 'cr', 'pl', 'tr', 'mn', 'lo'].includes(type);
    if (isRound) {
      T.hands++;
      T.netBy = T.netBy || {};
      T.netBy[type] = Math.round(((T.netBy[type] || 0) + (d.net || 0)) * 100) / 100;
      ensureSeason(P, now, N).net = Math.round(((P.season.net || 0) + (d.net || 0)) * 100) / 100;
      if (d.net > 0) T.streak = (T.streak || 0) + 1; else if (d.net < 0) T.streak = 0;
      if (T.streak >= 7) unlock(P, 'streak7', N);
      if (T.hands >= 1000) unlock(P, 'hands1000', N);
      if (d.bet >= 50) unlock(P, 'high_bet', N);
      try { const h = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now))); if (h < 5) unlock(P, 'night_owl', N); } catch (e) { /* ignore */ }
      const lite = type === 'pl' || type === 'tr' || type === 'mn'; // Plinko : on lâche des billes très vite, chaque bille rapporte moins d'XP
      addXP(P, lite ? (d.bet >= 5 ? 2 : 1) : 5, N);
      if (d.net > 0) {
        T.wins++;
        addXP(P, Math.min(40, (lite ? 0 : 3) + d.net / 2.5), N);
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
    if (type === 'rl-cashout' && d.diff >= 100) unlock(P, 'rl_cashout', N);
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
    if (type === 'lo') {
      T.loDraws = (T.loDraws || 0) + 1;
      if (d.jackpot) unlock(P, 'lo_jackpot', N);
      if (d.hits >= 5) unlock(P, 'lo_five', N);
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
    return { available: true, streak, amount: Math.round(Math.min(400, 100 + 30 * (streak - 1)) * (isVip(P, now) ? 1.5 : 1)) };
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
    const reward = challengeReward(def, P);
    P.wallet += reward;
    P.totals.challenges++;
    addXP(P, def.xp, N);
    if (P.totals.challenges >= 10) unlock(P, 'challenges10', N);
    checkWallet(P, N);
    return reward;
  }
  const challengeReward = (def, P) => Math.round(def.reward * (1 + 0.5 * Math.floor(levelOf(P.xp || 0) / 10)));


  // ---------- Cartes Légendes : la collection (on peut en avoir plusieurs exemplaires, les vendre, les échanger) ----------
  const COL_CATS = {
    pays: { name: 'Pays', icon: '🌍', a: '#0e7490', b: '#082f49' },
    histoire: { name: "Légendes de l'Histoire", icon: '📜', a: '#92400e', b: '#2a1405' },
    sport: { name: 'Sport', icon: '🏆', a: '#15803d', b: '#052e16' },
    monument: { name: 'Monuments', icon: '🏛️', a: '#6b7280', b: '#1f2937' },
    mytho: { name: 'Mythologie', icon: '⚡', a: '#7c3aed', b: '#1e0b3b' },
    espace: { name: 'Espace', icon: '🪐', a: '#1d4ed8', b: '#020617' },
    // série 2 : Pègre & Casino (personnages et lieux inventés)
    pegre: { name: 'La Pègre', icon: '🕴️', a: '#3f3f46', b: '#09090b' },
    casino: { name: 'Le Casino', icon: '🎰', a: '#9f1239', b: '#1c0410' },
    // série 3 : L'Âge d'or (années folles et grandes heures de Las Vegas)
    folles: { name: 'Années folles', icon: '🎷', a: '#a16207', b: '#1c1003' },
    vegas: { name: 'Las Vegas', icon: '🌵', a: '#c026d3', b: '#1e0526' },
  };
  const COLLECTION = [
    ["pays_de", "pays", "commun", "🇩🇪", "Allemagne", "Le pays compte plus de 20 000 châteaux."],
    ["pays_es", "pays", "commun", "🇪🇸", "Espagne", "Le castillan, le catalan, le basque et le galicien y sont tous langues officielles dans leur région."],
    ["pays_it", "pays", "commun", "🇮🇹", "Italie", "C'est le pays qui compte le plus de sites classés au patrimoine mondial de l'UNESCO."],
    ["pays_gb", "pays", "commun", "🇬🇧", "Royaume-Uni", "Le premier timbre-poste du monde, le Penny Black, y a été émis en 1840."],
    ["pays_us", "pays", "commun", "🇺🇸", "États-Unis", "L'Alaska a été acheté à la Russie en 1867."],
    ["pays_cn", "pays", "commun", "🇨🇳", "Chine", "Le papier, la boussole et la poudre y ont été inventés."],
    ["pays_in", "pays", "commun", "🇮🇳", "Inde", "Le jeu d'échecs y serait né, sous le nom de chaturanga."],
    ["pays_br", "pays", "commun", "🇧🇷", "Brésil", "Seul pays à avoir gagné cinq Coupes du monde de football."],
    ["pays_mx", "pays", "commun", "🇲🇽", "Mexique", "Les Aztèques y buvaient déjà du chocolat, il y a plus de 500 ans."],
    ["pays_ca", "pays", "commun", "🇨🇦", "Canada", "C'est le pays qui compte le plus de lacs au monde."],
    ["pays_ru", "pays", "commun", "🇷🇺", "Russie", "Le plus grand pays du monde s'étend sur 11 fuseaux horaires."],
    ["pays_tr", "pays", "commun", "🇹🇷", "Turquie", "Istanbul est à cheval sur deux continents : l'Europe et l'Asie."],
    ["pays_eg", "pays", "commun", "🇪🇬", "Égypte", "La Grande Pyramide a été le plus haut monument du monde pendant près de 4 000 ans."],
    ["pays_ng", "pays", "commun", "🇳🇬", "Nigeria", "C'est le pays le plus peuplé d'Afrique."],
    ["pays_ar", "pays", "commun", "🇦🇷", "Argentine", "Le tango est né à Buenos Aires, à la fin du XIXe siècle."],
    ["pays_pl", "pays", "commun", "🇵🇱", "Pologne", "Marie Curie y est née, à Varsovie, en 1867."],
    ["pays_be", "pays", "commun", "🇧🇪", "Belgique", "Tintin y est né en 1929 : c'est le pays de la bande dessinée."],
    ["pays_pt", "pays", "commun", "🇵🇹", "Portugal", "La plus vieille librairie encore ouverte du monde est à Lisbonne (depuis 1732)."],
    ["pays_jp", "pays", "rare", "🇯🇵", "Japon", "Ses trains à grande vitesse, les Shinkansen, roulent jusqu'à 320 km/h."],
    ["pays_au", "pays", "rare", "🇦🇺", "Australie", "On y compte plus de kangourous que d'habitants."],
    ["pays_ch", "pays", "rare", "🇨🇭", "Suisse", "Quatre langues nationales : allemand, français, italien et romanche."],
    ["pays_gr", "pays", "rare", "🇬🇷", "Grèce", "Les premiers Jeux olympiques s'y sont tenus, à Olympie, en 776 av. J.-C."],
    ["pays_ma", "pays", "rare", "🇲🇦", "Maroc", "L'université Al Quaraouiyine de Fès, fondée en 859, est la plus ancienne encore en activité."],
    ["pays_sn", "pays", "rare", "🇸🇳", "Sénégal", "Dakar est le point le plus à l'ouest de l'Afrique continentale."],
    ["pays_se", "pays", "rare", "🇸🇪", "Suède", "On y trouve un hôtel entièrement fait de glace, reconstruit chaque hiver."],
    ["pays_no", "pays", "rare", "🇳🇴", "Norvège", "Au nord, en été, le soleil ne se couche pas pendant des semaines."],
    ["pays_kr", "pays", "rare", "🇰🇷", "Corée du Sud", "Jusqu'en 2023, on y avait déjà 1 an le jour de sa naissance."],
    ["pays_pe", "pays", "rare", "🇵🇪", "Pérou", "Le Machu Picchu, cité inca, s'y cache à 2 430 m d'altitude."],
    ["pays_is", "pays", "epique", "🇮🇸", "Islande", "Il n'y a quasiment pas de moustiques sur l'île."],
    ["pays_nz", "pays", "epique", "🇳🇿", "Nouvelle-Zélande", "Premier pays à donner le droit de vote aux femmes, en 1893."],
    ["pays_mg", "pays", "epique", "🇲🇬", "Madagascar", "Environ 90 % de ses animaux n'existent nulle part ailleurs."],
    ["pays_np", "pays", "epique", "🇳🇵", "Népal", "Son drapeau est le seul au monde qui n'est pas rectangulaire."],
    ["pays_mn", "pays", "epique", "🇲🇳", "Mongolie", "C'est le pays le moins densément peuplé du monde."],
    ["pays_jm", "pays", "epique", "🇯🇲", "Jamaïque", "La patrie du reggae et de certains des sprinteurs les plus rapides de l'histoire."],
    ["pays_fr", "pays", "legendaire", "🇫🇷", "France", "C'est le pays le plus visité au monde."],
    ["pays_lu", "pays", "legendaire", "🇱🇺", "Luxembourg", "C'est le seul grand-duché du monde."],
    ["pays_mv", "pays", "legendaire", "🇲🇻", "Maldives", "Le pays le plus plat du monde : son point culminant fait environ 2,4 m."],
    ["pays_sc", "pays", "legendaire", "🇸🇨", "Seychelles", "Le coco de mer, la plus grosse graine du monde, y pousse."],
    ["pays_mc", "pays", "mythique", "🇲🇨", "Monaco", "Le deuxième plus petit pays du monde… et l'un des casinos les plus célèbres."],
    ["pays_va", "pays", "mythique", "🇻🇦", "Vatican", "Le plus petit pays du monde : 0,44 km²."],
    ["histoire_charlemagne", "histoire", "rare", "👑", "Charlemagne", "Il a été couronné empereur à Rome le jour de Noël de l'an 800."],
    ["histoire_hugo", "histoire", "rare", "✒️", "Victor Hugo", "L'auteur des Misérables et de Notre-Dame de Paris."],
    ["histoire_moliere", "histoire", "rare", "🎭", "Molière", "On parle de « la langue de Molière » pour désigner le français."],
    ["histoire_ramses", "histoire", "rare", "🦅", "Ramsès II", "Il a régné environ 66 ans sur l'Égypte."],
    ["histoire_galilee", "histoire", "rare", "🔭", "Galilée", "Il a découvert les quatre grandes lunes de Jupiter en 1610."],
    ["histoire_shakespeare", "histoire", "rare", "📜", "Shakespeare", "Il a inventé ou popularisé des centaines de mots anglais."],
    ["histoire_colomb", "histoire", "rare", "⛵", "Christophe Colomb", "Il a atteint l'Amérique en 1492 en croyant arriver aux Indes."],
    ["histoire_jeanne", "histoire", "epique", "⚔️", "Jeanne d'Arc", "Elle avait 17 ans lors de la libération d'Orléans, en 1429."],
    ["histoire_mozart", "histoire", "epique", "🎼", "Mozart", "Il a composé ses premières œuvres à 5 ans."],
    ["histoire_gengis", "histoire", "epique", "🏹", "Gengis Khan", "Il a fondé l'Empire mongol, le plus grand empire d'un seul tenant de l'histoire."],
    ["histoire_louis14", "histoire", "epique", "☀️", "Louis XIV", "Le Roi-Soleil a régné 72 ans, un record en Europe."],
    ["histoire_toutankhamon", "histoire", "epique", "🏺", "Toutânkhamon", "Son tombeau, presque intact, a été découvert en 1922."],
    ["histoire_newton", "histoire", "epique", "🍎", "Isaac Newton", "Il a formulé la loi de la gravitation universelle."],
    ["histoire_hannibal", "histoire", "epique", "🐘", "Hannibal", "Il a traversé les Alpes avec des éléphants en 218 av. J.-C."],
    ["histoire_napoleon", "histoire", "legendaire", "🎖️", "Napoléon", "Son Code civil, de 1804, est encore à la base du droit français."],
    ["histoire_cesar", "histoire", "legendaire", "🗡️", "Jules César", "Le mois de juillet porte son nom."],
    ["histoire_alexandre", "histoire", "legendaire", "🐎", "Alexandre le Grand", "À 30 ans, il régnait sur un empire allant de la Grèce jusqu'à l'Inde."],
    ["histoire_curie", "histoire", "legendaire", "⚛️", "Marie Curie", "La seule personne à avoir reçu deux prix Nobel dans deux sciences différentes."],
    ["histoire_cleopatre", "histoire", "mythique", "🐍", "Cléopâtre", "Elle a vécu plus près de notre époque que de la construction de la Grande Pyramide."],
    ["histoire_vinci", "histoire", "mythique", "🎨", "Léonard de Vinci", "Il écrivait souvent à l'envers, en écriture miroir."],
    ["sport_football", "sport", "commun", "⚽", "Football", "Le sport le plus pratiqué au monde."],
    ["sport_basket", "sport", "commun", "🏀", "Basket-ball", "Inventé en 1891 par un professeur, avec des paniers à pêches."],
    ["sport_rugby", "sport", "commun", "🏉", "Rugby", "Selon la légende, il est né en 1823 quand un élève a pris le ballon à la main."],
    ["sport_tennis", "sport", "commun", "🎾", "Tennis", "Le score 15-30-40 viendrait des quarts d'heure d'une horloge."],
    ["sport_marathon", "sport", "rare", "🏃", "Marathon", "42,195 km : une distance fixée aux Jeux de Londres en 1908."],
    ["sport_superbowl", "sport", "rare", "🏈", "Super Bowl", "L'un des programmes les plus regardés de la télévision américaine."],
    ["sport_sumo", "sport", "rare", "🤼", "Sumo", "Le sport national du Japon, pratiqué depuis plus de 1 000 ans."],
    ["sport_echecs", "sport", "rare", "♟️", "Échecs", "Il y a plus de parties possibles que d'atomes dans l'univers observable."],
    ["sport_tour", "sport", "epique", "🚴", "Tour de France", "Créé en 1903 ; le maillot jaune est apparu en 1919."],
    ["sport_rolandgarros", "sport", "epique", "🧡", "Roland-Garros", "Le seul tournoi du Grand Chelem joué sur terre battue."],
    ["sport_f1", "sport", "epique", "🏎️", "Formule 1", "Une F1 peut dépasser 350 km/h."],
    ["sport_mans", "sport", "epique", "🏁", "24 Heures du Mans", "La course d'endurance la plus célèbre, créée en 1923."],
    ["sport_coupe", "sport", "legendaire", "🏆", "Coupe du monde", "Le trophée actuel est en or massif 18 carats."],
    ["sport_jo", "sport", "legendaire", "🥇", "Jeux Olympiques", "Les cinq anneaux représentent les continents réunis par le sport."],
    ["sport_ballondor", "sport", "mythique", "🌟", "Ballon d'Or", "Récompense créée en 1956 par le magazine France Football."],
    ["monument_bigben", "monument", "commun", "🕰️", "Big Ben", "Big Ben est le nom de la cloche, pas celui de la tour."],
    ["monument_liberte", "monument", "rare", "🗽", "Statue de la Liberté", "Un cadeau de la France aux États-Unis, inauguré en 1886."],
    ["monument_stonehenge", "monument", "rare", "🪨", "Stonehenge", "Ses plus grosses pierres pèsent plus de 25 tonnes."],
    ["monument_montstmichel", "monument", "rare", "🏰", "Mont-Saint-Michel", "Une île… seulement à marée haute."],
    ["monument_petra", "monument", "rare", "🏜️", "Pétra", "Une ville entière taillée dans la roche rose."],
    ["monument_acropole", "monument", "rare", "🏛️", "Acropole", "Le Parthénon a été achevé en 432 av. J.-C."],
    ["monument_sagrada", "monument", "rare", "⛪", "Sagrada Família", "Cette basilique de Barcelone est en construction depuis 1882."],
    ["monument_colisee", "monument", "epique", "🏟️", "Colisée", "Il pouvait accueillir environ 50 000 spectateurs."],
    ["monument_tajmahal", "monument", "epique", "🕌", "Taj Mahal", "Construit par un empereur en mémoire de son épouse."],
    ["monument_machupicchu", "monument", "epique", "⛰️", "Machu Picchu", "Le monde l'a redécouvert en 1911."],
    ["monument_angkor", "monument", "epique", "🛕", "Angkor Vat", "Le plus grand monument religieux du monde."],
    ["monument_moai", "monument", "epique", "🗿", "Moaïs", "Près de 900 statues géantes veillent sur l'île de Pâques."],
    ["monument_eiffel", "monument", "legendaire", "🗼", "Tour Eiffel", "Elle grandit jusqu'à 15 cm en été, à cause de la chaleur."],
    ["monument_muraille", "monument", "legendaire", "🧱", "Grande Muraille", "Contrairement à la légende, elle ne se voit pas à l'œil nu depuis l'espace."],
    ["monument_gizeh", "monument", "mythique", "🔺", "Pyramides de Gizeh", "La seule des sept merveilles du monde antique encore debout."],
    ["mytho_meduse", "mytho", "rare", "🐍", "Méduse", "Son regard changeait en pierre quiconque la regardait."],
    ["mytho_pegase", "mytho", "rare", "🪽", "Pégase", "Le cheval ailé serait né du sang de Méduse."],
    ["mytho_minotaure", "mytho", "rare", "🐂", "Minotaure", "Il était enfermé dans le labyrinthe de Crète."],
    ["mytho_licorne", "mytho", "rare", "🦄", "Licorne", "C'est l'animal national de l'Écosse !"],
    ["mytho_cerbere", "mytho", "rare", "🐕", "Cerbère", "Un chien à trois têtes qui garde l'entrée des Enfers."],
    ["mytho_thor", "mytho", "epique", "🔨", "Thor", "Le jeudi (« Thursday ») porte son nom en anglais."],
    ["mytho_anubis", "mytho", "epique", "🐺", "Anubis", "Le dieu égyptien à tête de chacal, gardien des morts."],
    ["mytho_poseidon", "mytho", "epique", "🔱", "Poséidon", "D'un coup de trident, le dieu des mers faisait trembler la terre."],
    ["mytho_kraken", "mytho", "epique", "🦑", "Kraken", "Un monstre marin géant des légendes scandinaves."],
    ["mytho_zeus", "mytho", "legendaire", "⚡", "Zeus", "Le roi des dieux de l'Olympe, maître de la foudre."],
    ["mytho_dragon", "mytho", "legendaire", "🐉", "Dragon", "En Chine, il porte chance, force et sagesse."],
    ["mytho_phenix", "mytho", "mythique", "🔥", "Phénix", "L'oiseau qui renaît de ses cendres."],
    ["espace_mercure", "espace", "commun", "⚪", "Mercure", "Une année y dure seulement 88 jours."],
    ["espace_venus", "espace", "commun", "🟡", "Vénus", "La planète la plus chaude : plus de 460 °C."],
    ["espace_terre", "espace", "commun", "🌍", "Terre", "La seule planète connue qui abrite la vie."],
    ["espace_lune", "espace", "rare", "🌙", "Lune", "Elle s'éloigne de la Terre d'environ 3,8 cm par an."],
    ["espace_mars", "espace", "rare", "🔴", "Mars", "Elle abrite Olympus Mons, le plus grand volcan connu du Système solaire."],
    ["espace_neptune", "espace", "rare", "🔵", "Neptune", "Ses vents, les plus rapides du Système solaire, dépassent 2 000 km/h."],
    ["espace_jupiter", "espace", "epique", "🟠", "Jupiter", "Sa Grande Tache rouge est une tempête plus grande que la Terre."],
    ["espace_saturne", "espace", "epique", "🪐", "Saturne", "Elle est si peu dense qu'elle flotterait dans une baignoire géante."],
    ["espace_halley", "espace", "epique", "☄️", "Comète de Halley", "Elle revient tous les 75 à 76 ans : prochain passage en 2061."],
    ["espace_soleil", "espace", "legendaire", "☀️", "Soleil", "Sa lumière met environ 8 minutes à nous parvenir."],
    ["espace_voielactee", "espace", "legendaire", "🌌", "Voie lactée", "Notre galaxie compte entre 100 et 400 milliards d'étoiles."],
    ["espace_trounoir", "espace", "mythique", "⚫", "Trou noir", "Rien, pas même la lumière, ne peut s'en échapper."],
    // ----- série 1 : cartes Ultimes -----
    ["espace_bigbang", "espace", "ultime", "💥", "Big Bang", "Il y a 13,8 milliards d'années, tout l'Univers tenait dans un point."],
    ["mytho_atlantide", "mytho", "ultime", "🔱", "Atlantide", "Platon décrivait une île engloutie en un seul jour et une seule nuit."],
    ["monument_merveilles", "monument", "ultime", "🏺", "Les 7 Merveilles", "Des sept merveilles du monde antique, seule la pyramide de Khéops existe encore."],
    // ----- série 2 : Pègre & Casino -----
    ["pg_jeton", "casino", "commun", "🪙", "Jeton d'un euro", "Le plus petit jeton du casino… et pourtant tout commence par lui."],
    ["pg_des", "casino", "commun", "🎲", "Paire de dés", "La somme 7 est la plus fréquente : 6 combinaisons sur 36."],
    ["pg_cigare", "pegre", "commun", "🚬", "Cigare", "Dans l'arrière-salle, l'air est toujours un peu bleu."],
    ["pg_feutre", "pegre", "commun", "🎩", "Chapeau de feutre", "On le garde sur la tête, même pour jouer aux cartes."],
    ["pg_croupier", "casino", "commun", "🧑‍💼", "Croupier", "« Faites vos jeux… rien ne va plus ! »"],
    ["pg_valet", "casino", "commun", "🃏", "Valet de pique", "Le joker du tripot : toujours là quand on ne l'attend pas."],
    ["pg_bandit", "casino", "commun", "🎰", "Bandit manchot", "On l'appelait ainsi à cause de son levier… et de son appétit."],
    ["pg_tapis", "casino", "commun", "🟩", "Tapis vert", "Le feutre vert repose les yeux des joueurs pendant des heures."],
    ["pg_billet", "pegre", "commun", "💵", "Billet froissé", "Il est passé par beaucoup de mains avant d'arriver dans la tienne."],
    ["pg_cle", "pegre", "commun", "🗝️", "Clé de l'arrière-salle", "Seuls les habitués savent quelle porte elle ouvre."],
    ["pg_videur", "pegre", "rare", "🦍", "Le Videur", "Il ne parle pas beaucoup. Il n'en a pas besoin."],
    ["pg_chanteuse", "casino", "rare", "🎤", "La Chanteuse du club", "Sa voix fait oublier aux joueurs qu'ils sont en train de perdre."],
    ["pg_comptable", "pegre", "rare", "🧮", "Le Comptable", "Il connaît chaque centime de la dette. Chaque centime."],
    ["pg_roulette", "casino", "rare", "🎡", "Roulette dorée", "37 cases, une seule bille, et tous les regards sur elle."],
    ["pg_valise", "pegre", "rare", "💼", "Valise de billets", "Ne demande pas d'où elle vient."],
    ["pg_consigliere", "pegre", "epique", "🧠", "Le Consigliere", "Le conseiller du parrain : il pense toujours trois coups d'avance."],
    ["pg_coffre", "casino", "epique", "🔐", "Le Coffre-fort", "Trois serrures, deux gardes, un seul code."],
    ["pg_limousine", "pegre", "epique", "🚘", "La Limousine", "Quand elle s'arrête devant le casino, la musique s'arrête aussi."],
    ["pg_tripot", "pegre", "epique", "🕯️", "Le Tripot clandestin", "Derrière une blanchisserie, on joue jusqu'à l'aube."],
    ["pg_parrain", "pegre", "legendaire", "🕴️", "Le Parrain", "Il n'oublie jamais une dette. Ni un service rendu."],
    ["pg_minuit", "casino", "legendaire", "🌃", "Le Casino de minuit", "À minuit, les vraies parties commencent."],
    ["pg_diamant", "pegre", "legendaire", "💎", "Le Diamant noir", "Volé trois fois, jamais retrouvé. Jusqu'à aujourd'hui."],
    ["pg_famille", "pegre", "mythique", "👨‍👩‍👦", "La Famille", "On n'entre pas dans la Famille. On y naît… ou on lui doit tout."],
    ["pg_jackpot", "casino", "mythique", "🍀", "Le Jackpot maudit", "Celui qui le touche gagne tout… sauf la paix."],
    ["pg_dette", "pegre", "ultime", "📜", "La Dette éternelle", "Le contrat signé par ton frère. L'encre n'a jamais séché."],
    // ----- série 3 : L'Âge d'or -----
    ["ao_charleston", "folles", "commun", "💃", "Charleston", "La danse qui a fait trembler les parquets des années 1920."],
    ["ao_gramophone", "folles", "commun", "📯", "Gramophone", "Il suffit de tourner la manivelle pour que la fête commence."],
    ["ao_plume", "folles", "commun", "🪶", "Boa de plumes", "Indispensable pour entrer au cabaret."],
    ["ao_cocktail", "folles", "commun", "🍸", "Cocktail", "Pendant la Prohibition, on le servait dans des tasses à thé."],
    ["ao_neon", "vegas", "commun", "💡", "Enseigne au néon", "Las Vegas brille si fort qu'on la voit de l'espace."],
    ["ao_decapotable", "vegas", "commun", "🚗", "Décapotable", "Cheveux au vent sur la route du désert."],
    ["ao_jukebox", "vegas", "commun", "📻", "Juke-box", "Une pièce, une chanson, et toute la salle chante."],
    ["ao_micro", "vegas", "commun", "🎙️", "Micro chromé", "Celui des crooners, brillant comme une étoile."],
    ["ao_smoking", "folles", "commun", "🤵", "Smoking", "La tenue obligatoire des grandes soirées."],
    ["ao_paillettes", "vegas", "commun", "✨", "Paillettes", "Il y en a partout, même là où on ne les cherche pas."],
    ["ao_saxo", "folles", "rare", "🎷", "Saxophone", "L'âme du jazz, née dans les clubs enfumés."],
    ["ao_speakeasy", "folles", "rare", "🚪", "Speakeasy", "Un bar secret : il fallait chuchoter le mot de passe."],
    ["ao_dancing", "folles", "rare", "🪩", "Le Dancing", "On y dansait jusqu'à ce que les musiciens s'endorment."],
    ["ao_showgirl", "vegas", "rare", "👑", "Meneuse de revue", "Une coiffe de plumes plus haute qu'une porte."],
    ["ao_strip", "vegas", "rare", "🛣️", "Le Strip", "Le boulevard des casinos, illuminé jour et nuit."],
    ["ao_bigband", "folles", "epique", "🎺", "Big band", "Vingt musiciens, un seul swing."],
    ["ao_hotel", "vegas", "epique", "🏨", "Hôtel-casino", "On peut y vivre une semaine sans jamais voir le soleil."],
    ["ao_desert", "vegas", "epique", "🏜️", "Désert du Nevada", "Au milieu de nulle part, une ville est sortie du sable."],
    ["ao_mariage", "vegas", "epique", "💒", "Mariage express", "Dix minutes, deux témoins, et un sosie de chanteur."],
    ["ao_prohibition", "folles", "legendaire", "🥃", "Prohibition", "De 1920 à 1933, l'alcool était interdit aux États-Unis… officiellement."],
    ["ao_vegas50", "vegas", "legendaire", "🌆", "Las Vegas 1950", "L'âge d'or des casinos : les plus grandes stars sur scène chaque soir."],
    ["ao_crooner", "vegas", "legendaire", "🎶", "Le Crooner", "Une voix de velours, un verre à la main, un chapeau penché."],
    ["ao_nuit", "vegas", "mythique", "🌙", "La Nuit éternelle", "À Vegas, il n'y a pas d'horloge : la nuit ne finit jamais."],
    ["ao_krach", "folles", "mythique", "📉", "Le Grand Krach", "Octobre 1929 : en quelques jours, la Bourse s'effondre et la fête s'arrête."],
    ["ao_agedor", "vegas", "ultime", "🏆", "L'Âge d'or", "La carte la plus rare du Lounge : la fête qui ne s'arrête jamais."],
  ].map(([id, cat, rarity, icon, name, fact], i) => ({ id, cat, rarity, icon, name, fact, n: i + 1, series: /^pg_/.test(id) ? 's2' : /^ao_/.test(id) ? 's3' : 's1' }));
  const COL_BY_ID = Object.fromEntries(COLLECTION.map((c) => [c.id, c]));
  // Cote de départ selon la rareté (le marché la fait bouger) ; vente immédiate au Casino : 40 % de la cote, plafonnée
  const COTE_BASE = { commun: 20, rare: 60, epique: 200, legendaire: 800, mythique: 4000, ultime: 20000 };
  const INSTANT_RATE = 0.4;
  const rarityOfKey = (key) => { const i = key.indexOf(':'), k = key.slice(0, i), id = key.slice(i + 1); if (k === 'col') return COL_BY_ID[id] ? COL_BY_ID[id].rarity : null; const it = itemOf(k, id); return it ? it.card || (it.daily ? 'rare' : null) : null; };
  /** Prix de vente immédiate au Casino (ne dépasse jamais la moitié de la cote de départ : pas de profit en revendant des boosters). */
  function instantPrice(key, cote) { const r = rarityOfKey(key); if (!r) return 0; const base = COTE_BASE[r]; return Math.max(1, Math.floor(INSTANT_RATE * Math.min(cote || base, base * 1.25))); }
  /** Cote d'une carte : cote de départ, puis mélange avec le prix médian des ventes récentes (au moins 3 ventes). */
  function coteOf(key, sales) {
    const r = rarityOfKey(key); if (!r) return 0;
    const base = COTE_BASE[r];
    if (!sales || sales.length < 3) return base;
    const s = sales.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
    return Math.round(Math.max(base * 0.5, Math.min(base * 5, 0.4 * base + 0.6 * med)));
  }
  // ---------- Loto entre amis : packs de cartons, cagnotte ----------
  const LOTO = {
    PRICES: [0, 1, 2, 5],                                   // prix d'un carton (0 = pour le fun)
    PACKS: { serie: [6, 12, 18, 24], classique: [6, 10, 14, 24] },
    SHARES: { q1: 0.15, q2: 0.15, dq: 0.25, cp: 0.45 },     // partage de la cagnotte de chaque partie
  };
  const lotoDiscount = (n) => (n >= 24 ? 0.25 : n >= 14 ? 0.15 : n >= 10 ? 0.1 : 0);
  /** Prix d'un pack de n cartons (remise sur les gros packs). */
  const lotoPackCost = (price, n) => Math.round(price * n * (1 - lotoDiscount(n)) * 100) / 100;
  // Objets qu'on peut vendre, échanger ou mettre en jeu entre joueurs : les cartes de booster et les objets rares du jour
  const tradeable = (kind, id) => { if (kind === 'col') return !!COL_BY_ID[id]; const it = itemOf(kind, id); return !!(it && (it.card || it.daily)); };
  /** Nombre d'exemplaires possédés (cartes Légendes : plusieurs ; objets : 0 ou 1). */
  const countOf = (P, key) => { const i = key.indexOf(':'); if (key.slice(0, i) === 'col') return (P.col && P.col[key.slice(i + 1)]) || 0; return P.owned && P.owned[key] ? 1 : 0; };
  const MARKET_FEE = 0, MARKET_FEE_VIP = 0; // pas de frais sur le marché : le vendeur touche tout
  // ---------- Boosters ----------
  const BOOSTER = { FREE: 2, FREE_VIP: 3, TIME_MS: 4 * 3600000, TIME_CAP: 2, PRICE1: 180, PRICE5: 750 };
  const boosterPrice = (P, src, now) => Math.round((src === 'buy5' ? BOOSTER.PRICE5 : BOOSTER.PRICE1) * (isVip(P, now) ? 0.9 : 1));
  const CARD_POOL = () => { const out = COLLECTION.map((c) => ({ kind: 'col', id: c.id, rarity: c.rarity })); Object.keys(SHOP).forEach((k) => SHOP[k].forEach((it) => { if (it.card) out.push({ kind: k, id: it.id, rarity: it.card }); })); return out; };
  function cardsOf(P, now) {
    P.cards = P.cards || {};
    if (!P.cards.timeAt) P.cards.timeAt = now;
    P.cards.shards = P.cards.shards || 0;
    return P.cards;
  }
  function boosterInfo(P, now) {
    const c = cardsOf(P, now), d = today(now);
    const freeMax = isVip(P, now) ? BOOSTER.FREE_VIP : BOOSTER.FREE;
    const freeLeft = Math.max(0, freeMax - (c.freeDay === d ? c.freeUsed || 0 : 0));
    const since = Math.min(now - c.timeAt, BOOSTER.TIME_MS * BOOSTER.TIME_CAP);
    const tokens = Math.floor(since / BOOSTER.TIME_MS);
    const pool = CARD_POOL(), owned = pool.filter((x) => countOf(P, ownKey(x.kind, x.id)) > 0);
    const by = {}; RARITY_ORDER.forEach((r) => { by[r] = { have: owned.filter((x) => x.rarity === r).length, all: pool.filter((x) => x.rarity === r).length }; });
    return { freeLeft, freeMax, tokens, tokenCap: BOOSTER.TIME_CAP, nextIn: tokens >= BOOSTER.TIME_CAP ? 0 : BOOSTER.TIME_MS - (since % BOOSTER.TIME_MS), shards: c.shards, opened: c.opened || 0,
      price1: boosterPrice(P, 'buy1', now), price5: boosterPrice(P, 'buy5', now), have: owned.length, all: pool.length, by };
  }
  function drawRarity(rnd, min) {
    const ok = RARITY_ORDER.slice(RARITY_ORDER.indexOf(min || 'commun'));
    const total = ok.reduce((a, r) => a + RARITY[r].w, 0);
    let x = rnd(total);
    for (const r of ok) { if (x < RARITY[r].w) return r; x -= RARITY[r].w; }
    return ok[0];
  }
  /** Ouvre des cartes : source = free (offertes du jour), time (sablier), buy1 (150 €), buy5 (600 €, une rare au moins). */
  function openBooster(P, source, now, rnd, N) {
    const c = cardsOf(P, now), info = boosterInfo(P, now), d = today(now);
    let n = 1;
    if (source === 'free') { if (!info.freeLeft) return { error: 'Plus de carte offerte aujourd\'hui : reviens demain !' }; c.freeUsed = (c.freeDay === d ? c.freeUsed || 0 : 0) + 1; c.freeDay = d; }
    else if (source === 'time') { if (!info.tokens) return { error: 'Le sablier n\'est pas encore prêt.' }; c.timeAt = Math.max(c.timeAt, now - BOOSTER.TIME_MS * BOOSTER.TIME_CAP) + BOOSTER.TIME_MS; }
    else if (source === 'buy1' || source === 'buy5') {
      const price = boosterPrice(P, source, now); n = source === 'buy5' ? 5 : 1;
      if (P.wallet < price) return { error: 'Il te manque ' + Math.ceil(price - P.wallet).toLocaleString('fr-FR') + ' €.' };
      P.wallet -= price;
    } else return { error: 'Booster inconnu.' };
    const pool = CARD_POOL(), out = [];
    P.owned = P.owned || {};
    for (let i = 0; i < n; i++) {
      const rarity = drawRarity(rnd, n === 5 && i === 4 && !out.some((x) => x.rarity !== 'commun') ? 'rare' : null);
      const list = pool.filter((x) => x.rarity === rarity), pick = list[rnd(list.length)];
      const key = ownKey(pick.kind, pick.id);
      if (pick.kind === 'col') {
        // carte Légende : on garde tous les exemplaires (à vendre, échanger ou mettre en jeu)
        P.col = P.col || {}; P.col[pick.id] = (P.col[pick.id] || 0) + 1;
        out.push({ kind: 'col', id: pick.id, rarity, dup: P.col[pick.id] > 1, count: P.col[pick.id], shards: 0 });
      } else {
        const dup = !!P.owned[key];
        if (dup) c.shards += RARITY[rarity].shard; else P.owned[key] = now;
        out.push({ kind: pick.kind, id: pick.id, rarity, dup, shards: dup ? RARITY[rarity].shard : 0 });
      }
      if (rarity === 'legendaire' || rarity === 'mythique') N.push({ kind: 'gold', title: (rarity === 'mythique' ? '🔴 Carte MYTHIQUE !' : '🟡 Carte légendaire !'), text: itemOf(pick.kind, pick.id).name + (out[out.length - 1].dup ? (pick.kind === 'col' ? ' (exemplaire n°' + out[out.length - 1].count + ')' : ' (doublon : +' + RARITY[rarity].shard + ' éclats)') : ''), icon: '🃏' });
    }
    c.opened = (c.opened || 0) + n;
    addXP(P, 5 * n, N);
    if (c.opened >= 10) unlock(P, 'cards10', N);
    if (out.some((x) => x.rarity === 'mythique')) unlock(P, 'mythic', N);
    return { cards: out, shards: c.shards };
  }
  /** Vente immédiate au Casino d'un exemplaire (cote fournie par le serveur, d'après le marché). */
  function instantSell(P, key, cote, n) {
    n = Math.max(1, Math.min(50, Math.floor(n || 1)));
    const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
    if (!tradeable(kind, id)) return { error: 'Cet objet ne peut pas être vendu.' };
    if (countOf(P, key) < n) return { error: 'Tu n\'en as pas assez.' };
    const price = instantPrice(key, cote) * n;
    if (kind === 'col') { P.col[id] -= n; if (P.col[id] <= 0) delete P.col[id]; } else delete P.owned[key];
    P.wallet += price;
    return { price, each: price / n, left: countOf(P, key) };
  }
  /** Fabrique une carte précise avec des éclats (obtenus avec les doublons). */
  function craftCard(P, kind, id, now) {
    const it = itemOf(kind, id);
    if (!it || !it.card) return { error: 'Carte introuvable.' };
    const c = cardsOf(P, now), cost = RARITY[it.card].craft;
    P.owned = P.owned || {};
    if (P.owned[ownKey(kind, id)]) return { error: 'Tu l\'as déjà.' };
    if (c.shards < cost) return { error: 'Il te manque ' + (cost - c.shards) + ' éclats.' };
    c.shards -= cost; P.owned[ownKey(kind, id)] = now;
    return { cost, shards: c.shards };
  }

  // Coffre qui se remplit tout seul
  function chestInfo(P, now) {
    const k = isVip(P, now) ? 2 : 1, cap = CHEST_CAP * k, rate = CHEST_RATE * k;
    const amount = Math.min(cap, Math.floor(((now - (P.chestAt || now)) / 3600000) * rate));
    const full = amount >= cap;
    return { amount, cap, rate, full, vip: k > 1, fullIn: full ? 0 : Math.ceil((cap - amount) / rate * 3600000), since: P.chestAt };
  }
  function claimChest(P, now, N) {
    const c = chestInfo(P, now);
    if (c.amount < 1) return 0;
    P.wallet += c.amount; P.chestAt = now;
    addXP(P, Math.round(c.amount / 20), N);
    checkWallet(P, N);
    return c.amount;
  }
  // Aide de secours (banque presque vide)
  function rescueInfo(P, now) {
    const total = (P.wallet || 0) + Object.values(P.sessions || {}).reduce((a, x) => a + (x.stack || 0), 0);
    return { available: total < RESCUE_BELOW && P.rescueDay !== today(now), amount: RESCUE_AMOUNT, below: RESCUE_BELOW, usedToday: P.rescueDay === today(now) };
  }
  function claimRescue(P, now) {
    if (!rescueInfo(P, now).available) return 0;
    P.rescueDay = today(now); P.wallet += RESCUE_AMOUNT;
    return RESCUE_AMOUNT;
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



  // ---------- Coffres mystères : un objet de style au hasard (rareté), et des jetons ----------
  const BOX = { FREE: 1, FREE_VIP: 2, PRICE: 400, JETONS: [20, 150], DUP: { commun: 40, rare: 100, epique: 250, legendaire: 800, mythique: 2500 } };
  const boxPool = () => { const out = []; Object.keys(SHOP).forEach((k) => SHOP[k].forEach((it) => { if (it.card) out.push({ kind: k, id: it.id, rarity: it.card }); })); return out; };
  function boxInfo(P, now) {
    const d = today(now), used = P.box && P.box.day === d ? P.box.n : 0, max = isVip(P, now) ? BOX.FREE_VIP : BOX.FREE;
    const pool = boxPool(), have = pool.filter((x) => P.owned && P.owned[ownKey(x.kind, x.id)]).length;
    return { free: Math.max(0, max - used), max, price: Math.round(BOX.PRICE * (isVip(P, now) ? 1 - VIP_DISCOUNT / 100 : 1)), have, all: pool.length, opened: P.totals.boxes || 0 };
  }
  function openBox(P, paid, now, rnd, N) {
    const info = boxInfo(P, now), d = today(now);
    if (paid) { if (P.wallet < info.price) return { error: 'Il te manque ' + Math.ceil(info.price - P.wallet).toLocaleString('fr-FR') + ' jetons.' }; P.wallet -= info.price; }
    else { if (!info.free) return { error: 'Plus de coffre gratuit aujourd\'hui : reviens demain !' }; P.box = { day: d, n: (P.box && P.box.day === d ? P.box.n : 0) + 1 }; }
    const w = { commun: 600, rare: 250, epique: 105, legendaire: 40, mythique: 5 };
    const keys = Object.keys(w), tot = keys.reduce((a, k) => a + w[k], 0);
    let x = rnd(tot), rarity = keys[0];
    for (const k of keys) { if (x < w[k]) { rarity = k; break; } x -= w[k]; }
    P.owned = P.owned || {};
    const pool = boxPool().filter((it) => it.rarity === rarity), fresh = pool.filter((it) => !P.owned[ownKey(it.kind, it.id)]);
    const list = fresh.length ? fresh : pool, pick = list[rnd(list.length)];
    const dup = !fresh.length;
    let jetons = BOX.JETONS[0] + rnd(BOX.JETONS[1] - BOX.JETONS[0] + 1);
    if (dup) jetons += BOX.DUP[rarity]; else P.owned[ownKey(pick.kind, pick.id)] = now;
    P.wallet = Math.round((P.wallet + jetons) * 100) / 100;
    P.totals.boxes = (P.totals.boxes || 0) + 1;
    unlock(P, 'box1', N);
    if (P.totals.boxes >= 25) unlock(P, 'box25', N);
    if (rarity === 'mythique') unlock(P, 'box_myth', N);
    return { kind: pick.kind, id: pick.id, rarity, dup, jetons, paid: !!paid };
  }


  // ---------- Course de chevaux (palier 8) : 6 chevaux, une cote chacun, le serveur tire le vainqueur ----------
  const HORSES = [
    { name: 'Éclair Noir', c: '#111827' }, { name: 'Petit Bluff', c: '#b91c1c' }, { name: 'Jackpot', c: '#ca8a04' },
    { name: 'Dame de Cœur', c: '#db2777' }, { name: 'Mistral', c: '#2563eb' }, { name: 'Va-Tout', c: '#16a34a' },
  ];
  const HORSE_P = [0.32, 0.22, 0.17, 0.13, 0.10, 0.06], HORSE_RTP = 0.92;
  /** Nouvelle course : les chances sont redistribuées entre les chevaux (la « forme du jour »). */
  function horseCard(rnd) {
    const order = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) { const j = rnd(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const p = []; order.forEach((h, k) => { p[h] = HORSE_P[k]; });
    return { p, odds: p.map((x) => Math.floor(HORSE_RTP / x * 10) / 10), id: rnd(1e9) };
  }
  /** Cotes « placé » : le cheval finit 1er ou 2e (même taux de retour que le pari gagnant). */
  function placeOdds(card) {
    return card.p.map((pi, i) => {
      let q = pi; card.p.forEach((pj, j) => { if (j !== i) q += pj * pi / (1 - pj); });
      return Math.max(1.1, Math.floor(HORSE_RTP / q * 10) / 10);
    });
  }
  /** Le 2e de la course, tiré parmi les autres chevaux selon leurs chances. */
  function horseSecond(card, win, rnd) {
    const rest = card.p.map((x, i) => (i === win ? 0 : x)), tot = rest.reduce((a, b) => a + b, 0);
    let x = rnd(1e6) / 1e6 * tot;
    for (let i = 0; i < 6; i++) { x -= rest[i]; if (x < 0 && i !== win) return i; }
    return win === 5 ? 4 : 5;
  }
  /** Gains d'une course : paris « gagnant » (clé « 0 »…« 5 ») et « placé » (clé « p0 »…« p5 »). */
  function horsePayout(card, bets, win, second) {
    const po = placeOdds(card); let back = 0;
    Object.keys(bets || {}).forEach((k) => {
      const v = Number(bets[k]) || 0;
      if (/^p\d$/.test(k)) { const i = +k.slice(1); if (i === win || i === second) back += v * po[i]; }
      else if (+k === win) back += v * card.odds[win];
    });
    return Math.round(back * 100) / 100;
  }
  function horseRace(card, rnd) {
    const x = rnd(1e6) / 1e6; let acc = 0, win = 5;
    for (let i = 0; i < 6; i++) { acc += card.p[i]; if (x < acc) { win = i; break; } }
    return win;
  }

  // =====================================================================================================
  // ---------- Boosters du Parrain : 10 cartes revendues tout de suite dans la caisse ----------
  // =====================================================================================================
  const SERIES = [
    { id: 's1', name: 'Légendes', icon: '📜', palier: 2, color: '#7c3aed' },
    { id: 's2', name: 'Pègre & Casino', icon: '🕴️', palier: 4, color: '#9f1239' },
    { id: 's3', name: "L'Âge d'or", icon: '🎷', palier: 6, color: '#a16207' },
  ];
  // 8 communes, puis 2 cartes rare ou mieux ; 1 paquet sur 200 est un « God Pack » (10 légendaires ou mieux)
  const PACK = { SIZE: 10, COMMONS: 8, GOD: 200, RTP: 0.94, PRICE_PCT: 0.04,
    HIGH: { rare: 700, epique: 220, legendaire: 65, mythique: 13, ultime: 2 },
    GODW: { legendaire: 800, mythique: 170, ultime: 30 } };
  // valeur de revente (en fraction du prix du paquet), recalée pour que le paquet rende PACK.RTP en moyenne
  const PACK_MULT = (() => {
    const base = { commun: 0.045, rare: 0.17, epique: 0.45, legendaire: 1.5, mythique: 6, ultime: 40 };
    const avg = (w) => { const t = Object.values(w).reduce((a, b) => a + b, 0); return Object.keys(w).reduce((a, r) => a + w[r] / t * base[r], 0); };
    const normal = PACK.COMMONS * base.commun + (PACK.SIZE - PACK.COMMONS) * avg(PACK.HIGH), god = PACK.SIZE * avg(PACK.GODW);
    const ev = (1 - 1 / PACK.GOD) * normal + god / PACK.GOD, k = PACK.RTP / ev;
    const out = {}; Object.keys(base).forEach((r) => { out[r] = base[r] * k; });
    return out;
  })();
  const packPrice = (P) => Math.max(10, niceDown(quotaOf(P && P.run ? P.run.palier : 3) * PACK.PRICE_PCT));
  const seriesOpen = (P, id) => { const se = SERIES.find((x) => x.id === id); return !!(se && P.run && P.run.palier >= se.palier); };
  function pickWeighted(w, rnd) { const keys = Object.keys(w), t = keys.reduce((a, k) => a + w[k], 0); let x = rnd(t); for (const k of keys) { if (x < w[k]) return k; x -= w[k]; } return keys[0]; }
  /** Ouvre un paquet de la série `id` avec l'argent de la table `ss` : les cartes sont revendues aussitôt, les épiques et mieux vont dans la collection. */
  function openPack(P, ss, id, rnd, N) {
    if (!seriesOpen(P, id)) return { error: 'Cette série n\'est pas encore ouverte.' };
    const price = packPrice(P);
    if (ss.stack < price) return { error: 'Il te faut ' + price.toLocaleString('fr-FR') + ' € sur la table.' };
    ss.stack = Math.round((ss.stack - price) * 100) / 100;
    const god = rnd(PACK.GOD) === 0, list = COLLECTION.filter((c) => c.series === id), cards = [];
    for (let i = 0; i < PACK.SIZE; i++) {
      let r = god ? pickWeighted(PACK.GODW, rnd) : i < PACK.COMMONS ? 'commun' : pickWeighted(PACK.HIGH, rnd);
      let pool = list.filter((c) => c.rarity === r);
      while (!pool.length && r !== 'commun') { r = RARITY_ORDER[RARITY_ORDER.indexOf(r) - 1]; pool = list.filter((c) => c.rarity === r); }
      const c = pool[rnd(pool.length)];
      const value = Math.round(price * PACK_MULT[r] * 100) / 100;
      const keep = RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf('epique');
      P.col = P.col || {}; P.dex = P.dex || {};
      const isNew = keep && !P.col[c.id];
      const fresh = !P.dex[c.id] && !P.col[c.id]; // jamais vue auparavant : autocollant « NEW »
      P.dex[c.id] = 1;
      if (keep) P.col[c.id] = (P.col[c.id] || 0) + 1;
      cards.push({ kind: 'col', id: c.id, rarity: r, value, keep, isNew, fresh, count: keep ? P.col[c.id] : 0 });
    }
    const total = Math.round(cards.reduce((a, c) => a + c.value, 0) * 100) / 100;
    ss.stack = Math.round((ss.stack + total) * 100) / 100;
    P.totals.packs = (P.totals.packs || 0) + 1;
    if (N) { if (god) unlock(P, 'god_pack', N); if (cards.some((c) => c.rarity === 'ultime')) unlock(P, 'ultime', N); }
    return { cards, total, price, god, stack: ss.stack };
  }

  // =====================================================================================================
  // ---------- Mode « Le Parrain » : monter le plus haut possible, un palier (une journée) à la fois ----------
  // =====================================================================================================
  const RUN = {
    START_CASH: 1000, START_CASH_VIP: 1100, DAY_MS: 10 * 60000, VIP_BET: 1.6,
    // jeux débloqués selon le palier (le reste viendra : boosters, loto, bourse, course de chevaux…)
    UNLOCK: { blackjack: 1, roulette: 1, slots: 1, wheel: 1, crash: 1, mines: 1, plinko: 2, boosters: 2, gold: 2, loto: 3, horses: 3, trader: 4, heist: 5 },
    PRIME: 0.1, // commission versée dans la caisse à chaque palier réussi (en % du quota)
  };
  const QUOTAS = [1200, 1500, 1900, 2400, 3000, 3800, 4800, 6000, 7500, 9500, 12000, 15000, 19000, 24000, 30000];
  /** Arrondi « joli » : 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10^k (vers le bas). */
  function niceDown(v) {
    if (!(v > 0)) return 0;
    const e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    let best = 1; steps.forEach((x) => { if (x <= m + 1e-9) best = x; });
    return Math.round(best * e);
  }
  /** Quota du palier p : la table ci-dessus, puis ×1,6 à chaque palier (sans fin). */
  function quotaOf(p) {
    if (p <= QUOTAS.length) return QUOTAS[p - 1];
    let q = QUOTAS[QUOTAS.length - 1];
    for (let k = QUOTAS.length; k < p; k++) q *= 1.25;
    return niceDown(q);
  }
  /** Les mises montent avec les quotas (blackjack : 5 à 250 € au palier 1) ; le VIP relève le plafond. */
  const palierFactor = (p) => quotaOf(Math.max(1, p || 1)) / QUOTAS[0];
  function runMaxBet(P, now) {
    const p = P && P.run && P.run.status !== 'over' ? P.run.palier : 1;
    return niceDown(250 * palierFactor(p) * (isVip(P, now) ? RUN.VIP_BET : 1));
  }
  const runMinBet = (P) => Math.max(1, niceDown(10 * palierFactor(P && P.run ? P.run.palier : 1)));
  // Mises possibles aux machines (de 1 € à plusieurs millions)
  const BET_STEPS = (() => { const a = []; for (let e = 1; e <= 1e8; e *= 10) [1, 2, 5].forEach((m) => a.push(m * e)); [25, 250, 2500, 25000, 250000].forEach((v) => a.push(v)); return a.sort((x, y) => x - y); })();
  /** Mise minimale d'un jeu au palier du joueur (10 € au palier 1, roulette 2 €). */
  function gameMin(P, game) {
    const m = runMinBet(P);
    // Le Parrain : 10 € minimum partout (grossit avec les paliers), sauf la roulette : 2 €
    return game === 'roulette' ? Math.max(1, niceDown(m / 5)) : m;
  }
  // Roue de la fortune : 12 cases égales, dans l'ordre de la roue (redistribution ≈ 95,8 %)
  const FORTUNE = [
    { m: 5, w: 1, c: '#c2410c' }, { m: 0, w: 1, c: '#1f2937' }, { m: 1.5, w: 1, c: '#0e7490' }, { m: 0, w: 1, c: '#374151' },
    { m: 2, w: 1, c: '#15803d' }, { m: 0, w: 1, c: '#1f2937' }, { m: 1.5, w: 1, c: '#0e7490' }, { m: 0, w: 1, c: '#374151' },
    { m: 0, w: 1, c: '#1f2937' }, { m: 1.5, w: 1, c: '#0e7490' }, { m: 0, w: 1, c: '#374151' }, { m: 0, w: 1, c: '#1f2937' },
  ];
  const runActive = (P) => !!(P && P.run && P.run.status === 'playing');
  const runTotal = (P) => Math.round(((P.run ? P.run.cash : 0) + Object.values(P.sessions || {}).reduce((a, x) => a + (x.stack || 0), 0)) * 100) / 100;
  const isUnlocked = (P, game) => !!(P && P.run && (RUN.UNLOCK[game] || 99) <= P.run.palier);

  // Les objets de la boutique entre deux paliers (prix en % du quota suivant)
  const RUN_ITEMS = [
    { id: 'totem', icon: '🛡️', name: 'Totem d\'immunité', text: 'Une fois : si tu rates le quota de peu (80 % atteints), la mafia te laisse filer.', pct: 0.12 },
    { id: 'montre', icon: '⏱️', name: 'Montre de gousset', text: '+2 minutes sur la prochaine journée.', pct: 0.05 },
    { id: 'trefle', icon: '🍀', name: 'Trèfle porte-bonheur', text: '+5 % sur le bénéfice de la prochaine journée.', pct: 0.06 },
    { id: 'pret', icon: '💼', name: 'Prêt du parrain', text: 'Le parrain t\'avance 30 % du prochain quota… mais ce quota augmente de 15 %.', pct: 0 },
    { id: 'parapluie', icon: '☂️', name: 'Parapluie', text: 'Si tu fais banqueroute, tu repars une fois avec 10 % du quota au lieu de perdre.', pct: 0.1 },
    { id: 'sablier', icon: '⌛', name: 'Sablier doré', text: '+4 minutes sur la prochaine journée.', pct: 0.09 },
  ];
  const runItem = (id) => RUN_ITEMS.find((x) => x.id === id);
  const itemPrice = (it, p) => Math.max(10, niceDown(quotaOf(p + 1) * it.pct));
  // jetons gagnés : base selon les paliers réussis + bonus de gourmandise (argent au-delà des quotas)
  const runReward = (done, greed) => ({ jetons: 40 * done + 8 * done * done + Math.round(greed || 0), xp: 40 * done + 10 * done * done });

  function runStart(P, now, N) {
    if (P.run && P.run.status !== 'over') return { error: 'Une partie est déjà en cours.' };
    const cash = isVip(P, now) ? RUN.START_CASH_VIP : RUN.START_CASH;
    P.sessions = {};
    P.run = { id: (P.totals.runs || 0) + 1, palier: 1, cash, quota: quotaOf(1), status: 'playing', dayStart: now, dayEnd: now + RUN.DAY_MS, dayStartTotal: cash, items: {}, greed: 0, startedAt: now };
    P.totals.runs = (P.totals.runs || 0) + 1;
    N.push({ kind: 'run', title: 'Palier 1', text: 'Atteins ' + quotaOf(1).toLocaleString('fr-FR') + ' € avant la fin de la journée. Le parrain compte sur toi…', icon: '🕴️' });
    return { run: P.run };
  }
  /** Fin de journée (temps écoulé ou fermée par le joueur) : quota atteint → boutique ; sinon la mafia. */
  function runEndDay(P, now, N, why) {
    const r = P.run;
    if (!r || r.status !== 'playing') return { error: 'Pas de journée en cours.' };
    // l'argent laissé sur les tables revient dans la caisse
    Object.keys(P.sessions || {}).forEach((g) => { r.cash += P.sessions[g].stack || 0; });
    P.sessions = {};
    r.cash = Math.round(r.cash * 100) / 100;
    if (r.items.trefle && r.cash > r.dayStartTotal) { const b = Math.round((r.cash - r.dayStartTotal) * 0.05); r.cash += b; delete r.items.trefle; N.push({ kind: 'gold', title: '🍀 Trèfle porte-bonheur', text: '+' + b.toLocaleString('fr-FR') + ' € de bonus sur ta journée.', icon: '🍀' }); }
    let ok = r.cash >= r.quota;
    if (!ok && r.items.totem && r.cash >= r.quota * 0.8) { ok = true; delete r.items.totem; N.push({ kind: 'gold', title: '🛡️ Totem d\'immunité', text: 'Il te manquait un peu… le parrain ferme les yeux pour cette fois.', icon: '🛡️' }); }
    if (!ok) return runOver(P, now, N, 'quota');
    const prime = Math.round(r.quota * RUN.PRIME);
    r.cash = Math.round((r.cash + prime) * 100) / 100; r.prime = prime;
    r.greed += Math.min(2, Math.max(0, (r.cash - r.quota) / r.quota)) * 40 * r.palier;
    r.status = 'shop';
    r.done = r.palier;
    // 3 objets au hasard dans la boutique du palier
    const pool = RUN_ITEMS.map((x) => x.id), off = [];
    let h = (r.id * 9301 + r.palier * 49297 + Math.floor(now / 1000)) % 233280;
    while (off.length < 3 && pool.length) { h = (h * 9301 + 49297) % 233280; off.push(pool.splice(h % pool.length, 1)[0]); }
    r.offer = off;
    unlock(P, 'run_p1', N);
    if (r.palier >= 3) unlock(P, 'run_p3', N);
    if (r.palier >= 5) unlock(P, 'run_p5', N);
    if (r.palier >= 10) { unlock(P, 'run_p10', N); P.owned = P.owned || {}; if (!P.owned['title:parrain']) { P.owned['title:parrain'] = now; N.push({ kind: 'gold', title: 'Titre exclusif : Le Parrain', text: 'Tu peux le porter dans « Mon style ».', icon: '🕴️' }); } }
    if (r.palier >= 15) unlock(P, 'run_p15', N);
    if (r.palier >= 20) unlock(P, 'run_p20', N);
    P.bestPalier = Math.max(P.bestPalier || 0, r.palier);
    N.push({ kind: 'gold', title: '✅ Palier ' + r.palier + ' réussi !', text: 'Quota atteint ! Le parrain te verse une prime de ' + prime.toLocaleString('fr-FR') + ' €. Prochain quota : ' + quotaOf(r.palier + 1).toLocaleString('fr-FR') + ' €.', icon: '🏆' });
    return { ok: true, run: r };
  }
  /** Meilleur gain du compte, en jetons (fin de partie, tables multijoueur, Grand Prix ; pas le poker). */
  function noteGain(P, v) { P.totals = P.totals || {}; if (v > (P.totals.bestJetons || 0)) P.totals.bestJetons = Math.round(v); }
  /** Fin de la partie : la mafia passe. On garde les jetons et l'XP gagnés. */
  function runOver(P, now, N, why) {
    const r = P.run;
    if (!r) return { error: 'Pas de partie.' };
    Object.keys(P.sessions || {}).forEach((g) => { r.cash += P.sessions[g].stack || 0; });
    P.sessions = {};
    const done = r.status === 'shop' ? r.palier : r.palier - 1;
    const rw = runReward(done, r.greed);
    r.status = 'over'; r.why = why; r.endedAt = now; r.reward = rw; r.reached = r.palier;
    P.wallet = Math.round(((P.wallet || 0) + rw.jetons) * 100) / 100;
    noteGain(P, rw.jetons);
    addXP(P, rw.xp, N);
    P.bestPalier = Math.max(P.bestPalier || 0, done);
    P.totals.bestRun = Math.max(P.totals.bestRun || 0, done);
    P.lastRun = { palier: r.palier, done, why, jetons: rw.jetons, at: now, cash: Math.round(r.cash) };
    return { over: true, why, reward: rw, run: r };
  }
  /** Banqueroute : plus assez d'argent nulle part pour miser. */
  function runCheckBroke(P, now, N) {
    const r = P.run;
    if (!runActive(P)) return null;
    if (runTotal(P) >= gameMin(P, 'roulette')) return null;
    if (r.items.parapluie) { delete r.items.parapluie; r.cash = Math.round(r.quota * 0.1); N.push({ kind: 'gold', title: '☂️ Parapluie', text: 'Le parrain te dépanne de ' + r.cash.toLocaleString('fr-FR') + ' €. Dernière chance !', icon: '☂️' }); return null; }
    return runOver(P, now, N, 'banqueroute');
  }
  /** À chaque action : la journée est-elle finie ? */
  function runTick(P, now, N) {
    if (runActive(P) && now >= P.run.dayEnd) return runEndDay(P, now, N, 'time');
    return null;
  }
  function runBuy(P, id) {
    const r = P.run;
    if (!r || r.status !== 'shop') return { error: 'La boutique est fermée.' };
    if (!(r.offer || []).includes(id)) return { error: 'Objet indisponible.' };
    const it = runItem(id), price = itemPrice(it, r.palier);
    if (r.cash < price) return { error: 'Il te manque ' + Math.ceil(price - r.cash).toLocaleString('fr-FR') + ' €.' };
    r.cash = Math.round((r.cash - price) * 100) / 100;
    r.offer = r.offer.filter((x) => x !== id);
    if (id === 'pret') { r.cash += Math.round(quotaOf(r.palier + 1) * 0.3); r.items.pret = 1; }
    else r.items[id] = (r.items[id] || 0) + 1;
    return { price, item: id };
  }
  function runNext(P, now, N) {
    const r = P.run;
    if (!r || r.status !== 'shop') return { error: 'Termine d\'abord la journée.' };
    r.palier++;
    r.quota = Math.round(quotaOf(r.palier) * (r.items.pret ? 1.15 : 1));
    delete r.items.pret;
    let extra = 0;
    if (r.items.montre) { extra += 2 * 60000 * r.items.montre; delete r.items.montre; }
    if (r.items.sablier) { extra += 4 * 60000 * r.items.sablier; delete r.items.sablier; }
    r.status = 'playing'; r.dayStart = now; r.dayEnd = now + RUN.DAY_MS + extra; r.dayStartTotal = r.cash; r.offer = null;
    const news = Object.keys(RUN.UNLOCK).filter((g) => RUN.UNLOCK[g] === r.palier);
    N.push({ kind: 'run', title: 'Palier ' + r.palier, text: 'Quota : ' + r.quota.toLocaleString('fr-FR') + ' €.' + (news.length ? ' Nouveau : ' + news.map((g) => GAMES[g] || g).join(', ') + ' !' : ''), icon: '🕴️' });
    return { run: r };
  }

  function startSession(P, game, amount, now) {
    amount = Math.round(amount * 100) / 100;
    if (!GAMES[game] || !runActive(P) || !isUnlocked(P, game)) return null;
    if (P.sessions[game]) return P.sessions[game];
    if (!(amount > 0) || amount > P.run.cash + 1e-9) return null;
    P.run.cash = Math.round((P.run.cash - amount) * 100) / 100;
    P.sessions[game] = { stack: amount, start: amount, at: now };
    return P.sessions[game];
  }
  function cashOut(P, game, N) {
    const ss = P.sessions[game];
    if (!ss) return null;
    delete P.sessions[game];
    if (P.run) P.run.cash = Math.round((P.run.cash + ss.stack) * 100) / 100;
    const diff = Math.round((ss.stack - ss.start) * 100) / 100;
    if (diff > 0) { P.totals.cashouts = (P.totals.cashouts || 0) + 1; addXP(P, Math.min(80, 10 + diff / 5 / palierFactor(P.run ? P.run.palier : 1)), N); }
    return { start: ss.start, end: ss.stack, diff };
  }

  // Entre amis : 1er +50 €, 2e +20 € ; à deux joueurs, le gagnant +30 €
  function prizeFor(place, players) {
    if (players >= 3) return place === 1 ? 50 : place === 2 ? 20 : 0;
    if (players === 2) return place === 1 ? 30 : 0;
    return 0;
  }
  function prizeText(players) {
    return players >= 3 ? '1er : +50 €, 2e : +20 € sur ta banque' : players === 2 ? 'Le gagnant : +30 € sur sa banque' : 'Il faut au moins 2 joueurs pour gagner un prix';
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
      biggestWin: Math.round(P.totals.bestJetons || 0), hands: P.totals.hands, achievements: Object.keys(P.achievements).length,
      code: code || null, updatedAt: Date.now(),
      monthNet: P.season && P.season.id === seasonOf(Date.now()) ? Math.round(P.season.net || 0) : 0, month: seasonOf(Date.now()),
      vipUntil: isVip(P) ? P.vipUntil : 0, bestPalier: P.bestPalier || 0,
    };
  }

  // version des règles : le serveur et l'app doivent avoir la même (sinon : serveur du NAS à mettre à jour)
  const RULES_VERSION = '2026.11.29-1';
  const api = {
    RULES_VERSION,
    weekOf, weekPoints, ensureWeek, SEASON_TIERS, seasonOf, seasonTier, seasonName, ensureSeason,
    AVATARS, FELTS, BACKS, SHOP, SHOP_LABELS, DEFAULT_EQUIP, itemOf, canUse, buyItem, unlocksAt, CHALLENGES, ACHIEVEMENTS, TIME_PACKS, START_WALLET, GAMES,
    need, levelOf, title, today, fresh, normalize, addXP, unlock, checkWallet, ensureDaily, track,
    bonusInfo, claimBonus, claimChallenge, timeInfo, startTime, claimTime, startSession, cashOut,
    prizeFor, prizeText, applyPrize, publicProfile, REF_BONUS, REF_MIN_HANDS, REF_MAX, refDone, MT,
    COL_CATS, COLLECTION, COL_BY_ID, COTE_BASE, INSTANT_RATE, instantPrice, coteOf, rarityOfKey, countOf, instantSell,
    HORSES, horseCard, horseRace, placeOdds, horseSecond, horsePayout,
    BOX, boxInfo, openBox, priceOf, inPromo, SHOP_PROMO, VIP_DISCOUNT,
    SERIES, PACK, PACK_MULT, packPrice, seriesOpen, openPack,
    RUN, QUOTAS, BET_STEPS, gameMin, FORTUNE, quotaOf, niceDown, palierFactor, runMaxBet, runMinBet, runActive, runTotal, isUnlocked, RUN_ITEMS, runItem, itemPrice, runReward,
    noteGain, runStart, runEndDay, runOver, runCheckBroke, runTick, runBuy, runNext,
    LOTO, lotoDiscount, lotoPackCost,
    tradeable, MARKET_FEE, MARKET_FEE_VIP, RARITY, RARITY_ORDER, BOOSTER, boosterInfo, openBooster, craftCard,
    VIP_PASS, VIP_PERKS, isVip, buyVip, grantVip, WHEEL, wheelInfo, spinWheel,
    CHEST_RATE, CHEST_CAP, RESCUE_BELOW, RESCUE_AMOUNT, VIP, vipOf, maxBet, chestInfo, claimChest, rescueInfo, claimRescue, challengeReward, dailyOffer,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CasinoRules = api;
})(typeof window !== 'undefined' ? window : this);
