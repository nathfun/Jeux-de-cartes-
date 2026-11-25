#!/usr/bin/env bash
# Met en ligne le serveur anti-triche du Casino (Cloud Functions) et les règles de la base.
# À lancer dans Google Cloud Shell (https://shell.cloud.google.com) après avoir cloné le dépôt.
set -e
cd "$(dirname "$0")"
echo "1/3 Installation des dépendances du serveur…"
npm --prefix functions install --no-audit --no-fund
echo "2/3 Connexion à Firebase (suis le lien affiché, puis colle le code ici)…"
npx -y firebase-tools@15 login --no-localhost
echo "3/3 Déploiement du serveur et des règles…"
npx -y firebase-tools@15 deploy --only functions,database --project jeux-de-cartes-81cdf --force
echo "Terminé ! Dis-le à Claude : il activera le serveur dans l'app (window.CASINO_SERVER = true)."
