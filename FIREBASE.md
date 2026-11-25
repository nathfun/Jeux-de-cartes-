# Mettre en ligne « Casino » (une seule fois, environ 10 minutes)

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
7. **Comptes joueurs (pseudo + mot de passe)** : **Authentication** → onglet **Sign-in method** →
   **Ajouter un fournisseur** → **Adresse e-mail/Mot de passe** → active le premier interrupteur
   (pas besoin du « lien par e-mail ») → **Enregistrer**. Les joueurs n'entrent jamais de vrai e-mail :
   l'app fabrique une adresse à partir du pseudo.
8. **Autoriser ton site** : **Authentication** → **Settings** → **Domaines autorisés** →
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

1. Ouvre le site → **Blackjack**, **Poker** ou **Roulette** → onglet **Entre amis** → choisis un pseudo → **Créer une table**.
2. Un **code** de 4 caractères s'affiche (ex. `KQ7P`). Le bouton **Inviter** envoie le lien
   (WhatsApp, SMS…) ; tes amis peuvent aussi taper le code dans **Rejoindre**.
3. Chacun choisit une ou plusieurs places, mise, et c'est parti.

## Fermeture automatique des tables

Chaque joueur présent envoie un petit signal toutes les 45 secondes. Quand plus personne n'est
présent depuis 2 minutes (tout le monde a quitté la table ou fermé l'app), la table est fermée :
elle est supprimée et son code ne fonctionne plus.

## Poker entre amis : le secret des cartes

- Les cartes de chaque joueur sont rangées dans un coffre (`phands`) que **lui seul** peut lire.
- Le paquet (`pdeck`) n'est lisible que par l'**hôte** de la table, dont l'appareil distribue le flop,
  le turn, la river et révèle les cartes des joueurs encore en jeu à l'abattage.
- Si l'hôte quitte la table, un autre joueur présent devient hôte ; une main en cours est annulée
  et les mises sont rendues.
- Limite honnête : sans serveur payant (Cloud Functions, offre Blaze), l'appareil de l'hôte connaît
  le paquet. Un joueur qui fouillerait dans les outils développeur de son navigateur pendant qu'il est
  hôte pourrait le lire. Entre amis, c'est un compromis raisonnable.

## Protection de la banque (gratuit)

La banque de chaque joueur est rangée dans la base (`bank/<uid>`) et les **règles de la base** refusent
tout mouvement d'argent qui n'a pas de raison valable :

- départ à 10 000 €, une seule fois ;
- bonus : 2 000 € au plus, et au moins 6 h entre deux bonus ;
- banque du temps : l'heure de départ est celle du serveur, et l'argent ne se touche qu'une fois l'attente finie ;
- partie réelle : la somme apportée est notée en ligne ; à l'encaissement, le **bénéfice** est compté ;
- défis et prix entre amis : 700 € au plus à la fois ;
- au plus **100 000 € de gains encaissés par 24 h** (bénéfices des parties + défis + prix) ;
- impossible de modifier la banque d'un autre joueur, ou d'écrire directement un montant.

Le classement entre amis affiche la banque protégée. Limite honnête : les parties elles-mêmes se jouent sur le
téléphone, donc un tricheur déterminé peut gonfler ses gains, mais jamais au-delà de 100 000 € par jour.
Le niveau, les succès et les défis du jour restent calculés sur le téléphone.

Pour l'activer : recopie [`database.rules.json`](database.rules.json) dans **Realtime Database → Règles** → **Publier**.

### Option payante : serveur complet (offre Blaze)

Le dossier `functions/` contient un serveur qui joue lui-même les parties réelles (tirages, cartes, bots) :
plus aucune triche possible, mais il faut l'offre Blaze de Firebase (carte bancaire). Il est désactivé
(`window.CASINO_SERVER = false` dans `firebase-config.js`). Pour l'utiliser un jour : `deploy.sh` dans Google Cloud Shell,
puis `window.CASINO_SERVER = true`.

## Comptes et sauvegarde

- Sur l'accueil, **Mon compte** : un pseudo et un mot de passe. Le compte garde la banque, le niveau,
  les succès, les défis, les amis et les parties en cours ; on les retrouve en se connectant sur un autre appareil.
- `saves/<uid>` : la sauvegarde de chaque joueur, lisible et modifiable par lui seul.
- Mot de passe oublié : dans la console Firebase, **Authentication** → **Users**, tu peux supprimer
  le compte (le joueur en recrée un) ; il n'y a pas d'e-mail de récupération puisque l'adresse est fictive.

## Amis, classement et défis

- `invites/<uid>` : les invitations reçues (« Léa t'invite à sa table de Blackjack »), lisibles par le seul destinataire.

- `profiles` : le profil public de chaque joueur (pseudo, avatar, niveau, portefeuille…), modifiable par lui seul.
- `friendcodes` : les codes amis (6 caractères).
- `challenges` : les défis entre amis et leurs résultats (chacun n'écrit que son propre score).

## Limites de l'offre gratuite

Largement suffisantes entre amis : 100 joueurs connectés en même temps, 1 Go de données stockées.
