// Copie la logique du jeu (functions/core.js, poker.js et les moteurs de l'app) dans server/core :
// le serveur du NAS applique exactement les mêmes règles que l'app et que la version Cloud Functions.
// À relancer après chaque modification d'un jeu (le dossier server/core est versionné pour que l'image Docker
// se construise même sans le reste du dépôt).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'functions', 'sync-shared.js')], { stdio: 'inherit' });
const out = path.join(__dirname, 'core');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'shared'), { recursive: true });
for (const f of ['core.js', 'poker.js']) fs.copyFileSync(path.join(root, 'functions', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'functions', 'shared'))) fs.copyFileSync(path.join(root, 'functions', 'shared', f), path.join(out, 'shared', f));
console.log('core : prêt dans server/core');
