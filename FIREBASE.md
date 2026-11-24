# Mettre en ligne « Jeux de cartes » (une seule fois, environ 10 minutes)

Tu es le seul à faire ces étapes. Tes amis, eux, ouvrent juste le lien : pas de compte,
pas d'installation obligatoire (ils peuvent ajouter l'app à leur écran d'accueil s'ils veulent).

## 1. Publier le site avec GitHub Pages

1. Sur GitHub, ouvre le dépôt **Jeux-de-cartes-** → **Settings** → **Pages** (menu de gauche).
2. Dans **Build and deployment** → **Source**, choisis **Deploy from a branch**.
3. Dans **Branch**, choisis la branche où se trouve l'app (`claude/blackjack-app-feedback-appqgy`,
   ou `main` une fois la branche fusionnée), dossier **/ (root)**, puis **Save**.
4. Après une à deux minutes, l'adresse s'affiche en haut de la page, du type
   `https://nathfun.github.io/Jeux-de-cartes-/`.

À ce stade, le blackjack **solo** marche déjà. Le mode **Entre amis** a besoin de Firebase (étape 2).

## 2. Créer le serveur de jeu Firebase (gratuit)

1. Va sur <https://console.firebase.google.com> et connecte-toi avec un compte Google.
2. **Créer un projet** → nom : `jeux-de-cartes` → tu peux **désactiver Google Analytics** → **Créer**.
3. **Connexion anonyme** (pour que tes amis n'aient pas besoin de compte) :
   menu **Créer** (Build) → **Authentication** → **Commencer** → onglet **Sign-in method** →
   **Anonyme** → **Activer** → **Enregistrer**.
4. **Base de données** : menu **Créer** → **Realtime Database** → **Créer une base de données** →
   emplacement **Belgique (europe-west1)** → **Démarrer en mode verrouillé** → **Activer**.
5. **Règles de sécurité** : dans la Realtime Database, onglet **Règles**, remplace tout le texte par
   le contenu du fichier [`database.rules.json`](database.rules.json) de ce dépôt, puis **Publier**.
6. **Récupérer la configuration** : roue dentée ⚙ → **Paramètres du projet** → en bas,
   **Vos applications** → icône **`</>`** (Web) → surnom `jeux-de-cartes` → **Enregistrer l'application**
   (pas besoin de Firebase Hosting).
   Firebase affiche un bloc `const firebaseConfig = { apiKey: ..., authDomain: ..., databaseURL: ..., ... }`.
   Vérifie qu'il contient bien `databaseURL` (sinon, recharge la page après l'étape 4).
7. **Autoriser ton site** : **Authentication** → **Settings** → **Domaines autorisés** →
   **Ajouter un domaine** → `nathfun.github.io`.

## 3. Brancher l'app sur Firebase

Copie le bloc `firebaseConfig` et envoie-le à Claude, ou colle-le toi-même dans
[`firebase-config.js`](firebase-config.js) à la place de `null` :

```js
window.FIREBASE_CONFIG = {
  apiKey: "…",
  authDomain: "…",
  databaseURL: "https://jeux-de-cartes-…europe-west1.firebasedatabase.app",
  projectId: "…",
  storageBucket: "…",
  messagingSenderId: "…",
  appId: "…"
};
```

Ces valeurs ne sont **pas secrètes** (elles sont visibles par tout navigateur qui ouvre le site) :
la protection vient des règles de l'étape 2.5 et de la connexion anonyme.

## Jouer entre amis

1. Ouvre le site → **Blackjack** → onglet **Entre amis** → choisis un pseudo → **Créer une table**.
2. Un **code** de 4 caractères s'affiche (ex. `KQ7P`). Le bouton **Inviter** envoie le lien
   (WhatsApp, SMS…) ; tes amis peuvent aussi taper le code dans **Rejoindre**.
3. Chacun choisit une ou plusieurs places, mise, et c'est parti.

## Limites de l'offre gratuite

Largement suffisantes entre amis : 100 joueurs connectés en même temps, 1 Go de données stockées.
