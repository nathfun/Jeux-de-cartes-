// Copie dans functions/shared les règles et moteurs de jeu de l'app : le serveur applique exactement les mêmes.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'shared');
const files = {
  'casino-rules.js': 'casino-rules.js',
  'roulette/bets.js': 'bets.js',
  'slots/engine.js': 'slots-engine.js',
  'crash/engine.js': 'crash-engine.js',
  'blackjack/strategy.js': 'strategy.js',
  'blackjack/sidebets.js': 'sidebets.js',
  'poker/eval.js': 'eval.js',
  'poker/engine.js': 'engine.js',
  'poker/coach.js': 'coach.js',
  'poker/bots.js': 'bots.js',
  'poker/tourney.js': 'tourney.js',
};
fs.mkdirSync(out, { recursive: true });
for (const [src, dst] of Object.entries(files)) fs.copyFileSync(path.join(root, src), path.join(out, dst));
console.log('shared : ' + Object.keys(files).length + ' fichiers copiés');
