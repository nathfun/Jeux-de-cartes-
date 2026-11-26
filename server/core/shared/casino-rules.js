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
  };
  const RARITY_ORDER = ['commun', 'rare', 'epique', 'legendaire', 'mythique'];
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
    const pool = [];
    Object.keys(SHOP).forEach((k) => SHOP[k].forEach((it) => { if (it.daily) pool.push({ kind: k, id: it.id }); }));
    let h = 0; for (const c of dayOf(now || Date.now())) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const out = [], left = pool.slice();
    for (let i = 0; i < 3 && left.length; i++) { h = (h * 1103515245 + 12345) >>> 0; out.push(left.splice(h % left.length, 1)[0]); }
    return out;
  }
  /** L'objet est-il utilisable : niveau atteint, et offert ou acheté. */
  function canUse(P, kind, id) {
    const it = itemOf(kind, id);
    if (!it) return false;
    if (it.vipOnly) return isVip(P);
    if (it.exclusive || it.daily || it.card) return !!(P.owned && P.owned[ownKey(kind, id)]);
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
    if (it.daily && !dailyOffer(Date.now()).some((x) => x.kind === kind && x.id === id)) return { error: 'Cet objet n\'est pas dans la boutique du jour.' };
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
    { id: 'any_win1000', game: 'Tous les jeux', text: 'Gagne 100 € au total aujourd\'hui', target: 100, reward: 60, xp: 80, on: (t, d) => (['bj', 'rl', 'sl', 'cr', 'pl', 'tr', 'mn'].includes(t) && d.net > 0 ? d.net : 0) },
    { id: 'cr_rounds15', game: 'Rocket Crash', text: 'Joue 15 manches de Rocket Crash', target: 15, reward: 30, xp: 50, on: (t) => (t === 'cr' ? 1 : 0) },
    { id: 'cr_x3', game: 'Rocket Crash', text: 'Retire ta mise à ×3 ou plus', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'cr' && d.mult >= 3 ? 1 : 0) },
    { id: 'cr_wins5', game: 'Rocket Crash', text: 'Réussis 5 retraits avant l\'explosion', target: 5, reward: 40, xp: 60, on: (t, d) => (t === 'cr' && d.mult > 0 ? 1 : 0) },
    { id: 'pl_balls30', game: 'Plinko', text: 'Lâche 30 billes au Plinko', target: 30, reward: 30, xp: 50, on: (t) => (t === 'pl' ? 1 : 0) },
    { id: 'pl_x5', game: 'Plinko', text: 'Fais tomber une bille sur ×5 ou plus', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'pl' && d.mult >= 5 ? 1 : 0) },
    { id: 'pl_win300', game: 'Plinko', text: 'Gagne 30 € au Plinko aujourd\'hui', target: 30, reward: 50, xp: 70, on: (t, d) => (t === 'pl' && d.net > 0 ? d.net : 0) },
    { id: 'tr_trades10', game: 'Bourse Flash', text: 'Clôture 10 positions en bourse', target: 10, reward: 30, xp: 50, on: (t) => (t === 'tr' ? 1 : 0) },
    { id: 'tr_short', game: 'Bourse Flash', text: 'Gagne de l\'argent en vendant (pari sur la baisse)', target: 1, reward: 50, xp: 70, on: (t, d) => (t === 'tr' && d.dir < 0 && d.net > 0 ? 1 : 0) },
    { id: 'tr_win200', game: 'Bourse Flash', text: 'Gagne 20 € en bourse aujourd\'hui', target: 20, reward: 50, xp: 70, on: (t, d) => (t === 'tr' && d.net > 0 ? d.net : 0) },
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
    { id: 'cards10', icon: '🃏', name: 'Collectionneur', text: 'Ouvrir 10 cartes de booster' },
    { id: 'mythic', icon: '🔴', name: 'Mythique !', text: 'Obtenir une carte mythique' },
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
    { id: 'week', name: 'Pass VIP · 7 jours', days: 7, price: 1500 },
    { id: 'month', name: 'Pass VIP · 30 jours', days: 30, price: 4500, best: true },
  ];
  const VIP_PERKS = [
    { icon: '💰', text: 'Mises maximales doublées dans ton salon' },
    { icon: '🧰', text: 'Coffre deux fois plus rapide et deux fois plus grand' },
    { icon: '🎡', text: 'Deux tours de roue par jour au lieu d\'un' },
    { icon: '⭐', text: '+25 % d\'XP sur tout ce que tu fais' },
    { icon: '🃏', text: 'Une carte de booster offerte en plus chaque jour' },
    { icon: '🥂', text: 'Clubs privés en multijoueur : prix doublés' },
    { icon: '🃏', text: 'Boosters 10 % moins chers' },
    { icon: '👑', text: 'Couronne, cadre, titre et thème VIP réservés aux membres' },
  ];
  const isVip = (P, now) => !!(P && P.vipUntil && P.vipUntil > (now || Date.now()));
  const maxBet = (P, now) => vipOf(P).max * (isVip(P, now) ? 2 : 1);
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

  const START_WALLET = 1000;
  // Parrainage : le filleul et son parrain reçoivent REF_BONUS chacun quand le filleul a joué REF_MIN_HANDS mains ou tours
  const REF_BONUS = 200, REF_MIN_HANDS = 10, REF_MAX = 25;
  const GAMES = { blackjack: 'Blackjack', poker: 'Poker', roulette: 'Roulette', slots: 'Machine à sous', crash: 'Rocket Crash', plinko: 'Plinko', trader: 'Bourse Flash', mines: 'Mines', gold: 'Ruée vers l\'Or' };
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
      econ: 2, chestAt: now || Date.now(),
    };
  }
  function normalize(P, now) {
    const f = fresh(now);
    const oldEcon = P ? (P.econ || 1) : 2; // profil existant d'avant la version 2 de l'économie ?
    P = Object.assign(f, P || {});
    P.econ = oldEcon;
    P.totals = Object.assign(fresh(now).totals, P.totals || {});
    P.achievements = P.achievements || {};
    P.sessions = P.sessions || {};
    P.prizes = P.prizes || {};
    P.bonus = P.bonus || { last: null, streak: 0 };
    // Nouvelle économie (version 2) : tout l'argent ÷ 10, une seule fois. L'argent laissé sur les tables revient en banque.
    if (P.econ !== 2) {
      const d10 = (v) => Math.round((Number(v) || 0) * 10) / 100;
      const onTables = Object.values(P.sessions).reduce((a, x) => a + (Number(x.stack) || 0), 0);
      P.wallet = d10((Number(P.wallet) || 0) + onTables);
      P.sessions = {};
      if (P.bankHist) Object.keys(P.bankHist).forEach((k) => { P.bankHist[k] = d10(P.bankHist[k]); });
      P.totals.biggestWin = d10(P.totals.biggestWin);
      if (P.totals.netBy) Object.keys(P.totals.netBy).forEach((k) => { P.totals.netBy[k] = d10(P.totals.netBy[k]); });
      if (P.season) P.season.net = d10(P.season.net);
      P.timebank = null;
      P.chestAt = now || Date.now();
      P.econ = 2;
      P._econMigrated = true;
    }
    if (!P.chestAt) P.chestAt = now || Date.now();
    return P;
  }

  function addXP(P, n, N) {
    const before = levelOf(P.xp), salonBefore = vipOf(P);
    if (isVip(P)) n *= 1.25;
    P.xp += Math.round(n);
    ensureSeason(P, Date.now(), N).xp += Math.round(n);
    const after = levelOf(P.xp);
    if (after >= 10 && before < 10) unlock(P, 'vip', N);
    if (after > before) {
      const unlocked = [];
      for (let l = before + 1; l <= after; l++) unlocksAt(l).forEach((it) => unlocked.push(it.name + (it.price ? ' (boutique)' : '')));
      N.push({ kind: 'level', title: 'Niveau ' + after + ' !', text: title(after) + (unlocked.length ? ' — nouveau : ' + unlocked.slice(0, 4).join(', ') + (unlocked.length > 4 ? '…' : '') : ''), icon: '⬆️' });
      const salon = vipOf(P);
      if (salon.id !== salonBefore.id) N.push({ kind: 'salon', title: 'Nouveau salon : ' + salon.name, text: 'Tu peux maintenant miser jusqu\'à ' + salon.max + ' € par coup' + (isVip(P) ? ' (' + salon.max * 2 + ' € avec ton pass VIP)' : '') + '.', icon: salon.icon, salon: salon.id, max: salon.max });
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
    return { available: true, streak, amount: Math.min(200, 50 + 25 * (streak - 1)) };
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
  ].map(([id, cat, rarity, icon, name, fact], i) => ({ id, cat, rarity, icon, name, fact, n: i + 1 }));
  const COL_BY_ID = Object.fromEntries(COLLECTION.map((c) => [c.id, c]));
  // Cote de départ selon la rareté (le marché la fait bouger) ; vente immédiate au Casino : 40 % de la cote, plafonnée
  const COTE_BASE = { commun: 20, rare: 60, epique: 200, legendaire: 800, mythique: 4000 };
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
    if (diff > 0) { P.totals.cashouts = (P.totals.cashouts || 0) + 1; addXP(P, Math.min(80, 10 + diff / 5), N); }
    checkWallet(P, N);
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
      biggestWin: Math.round(P.totals.biggestWin || 0), hands: P.totals.hands, achievements: Object.keys(P.achievements).length,
      code: code || null, updatedAt: Date.now(),
      monthNet: P.season && P.season.id === seasonOf(Date.now()) ? Math.round(P.season.net || 0) : 0, month: seasonOf(Date.now()),
      vipUntil: isVip(P) ? P.vipUntil : 0,
    };
  }

  const api = {
    weekOf, weekPoints, ensureWeek, SEASON_TIERS, seasonOf, seasonTier, seasonName, ensureSeason,
    AVATARS, FELTS, BACKS, SHOP, SHOP_LABELS, DEFAULT_EQUIP, itemOf, canUse, buyItem, unlocksAt, CHALLENGES, ACHIEVEMENTS, TIME_PACKS, START_WALLET, GAMES,
    need, levelOf, title, today, fresh, normalize, addXP, unlock, checkWallet, ensureDaily, track,
    bonusInfo, claimBonus, claimChallenge, timeInfo, startTime, claimTime, startSession, cashOut,
    prizeFor, prizeText, applyPrize, publicProfile, REF_BONUS, REF_MIN_HANDS, REF_MAX,
    COL_CATS, COLLECTION, COL_BY_ID, COTE_BASE, INSTANT_RATE, instantPrice, coteOf, rarityOfKey, countOf, instantSell,
    tradeable, MARKET_FEE, MARKET_FEE_VIP, RARITY, RARITY_ORDER, BOOSTER, boosterInfo, openBooster, craftCard,
    VIP_PASS, VIP_PERKS, isVip, buyVip, grantVip, WHEEL, wheelInfo, spinWheel,
    CHEST_RATE, CHEST_CAP, RESCUE_BELOW, RESCUE_AMOUNT, VIP, vipOf, maxBet, chestInfo, claimChest, rescueInfo, claimRescue, challengeReward, dailyOffer,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CasinoRules = api;
})(typeof window !== 'undefined' ? window : this);
