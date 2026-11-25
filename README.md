# Casino

App web installable sur téléphone (PWA) : blackjack, poker, roulette et machine à sous, en solo ou entre amis. Tout se joue en argent virtuel.

| Jeu | Solo | Entre amis |
| --- | --- | --- |
| [Blackjack](blackjack/) | Coach (stratégie de base, écarts liés au comptage), comptage Hi-Lo, paris annexes | Tables de 5 places avec code d'entrée, chat |
| [Roulette](roulette/) | Roulette européenne (règles françaises, partage), roue animée, aides sur chaque mise, statistiques | Table à code, même roue pour tous, compte à rebours, classement final |
| [Machine à sous](slots/) | 5 rouleaux, 10 lignes, joker, tours gratuits (gains doublés), jackpot ; taux de retour ~94 % vérifié par simulation | – |
| [Poker](poker/) | Texas Hold'em contre 1 à 5 bots, coach (position, outs, équité, cotes du pot), résumé de chaque main | 6 places avec code d'entrée, cartes privées, minuteur, chat |

## L'argent du Casino

- **Banque** : 10 000 € au départ, une seule banque pour tous les jeux, gardée par le **compte** (pseudo + mot de passe, sur l'accueil) et retrouvée sur n'importe quel appareil.
- **Entraînement** : crédit illimité et toutes les aides ; rien ne compte pour les niveaux, défis et succès.
- **Partie réelle** : on apporte une somme de sa banque, sans aides. « Encaisser » ramène ce qui reste sur la table ; si on perd tout, c'est perdu. Au poker : tournoi avec droit d'entrée et cagnotte.
- **Gagner de l'argent** : bonus du jour, défis du jour, **banque du temps** (100 € contre 5 min d'attente… 20 000 € contre 8 h : plus c'est long, plus chaque minute rapporte), et les parties entre amis.
- **Entre amis** : les jetons de la table ne servent qu'à la table ; le classement final rapporte 500 € au 1er et 200 € au 2e (à deux joueurs : 300 € au gagnant).

- **Mise en ligne et serveur de jeu** : voir [FIREBASE.md](FIREBASE.md) (GitHub Pages + Firebase, gratuit).
- **Hors ligne** : le mode solo fonctionne sans connexion une fois l'app ouverte.
- **Test local du multijoueur** : ouvre `blackjack/index.html?backend=local` dans deux onglets.

## Structure

- `index.html` — accueil de l'app. `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/` — installation sur téléphone.
- `firebase-config.js` — configuration Firebase (à remplir). `database.rules.json` — règles de sécurité.
- `blackjack/` — le jeu (voir son [README](blackjack/README.md)).
- `roulette/` — `bets.js` (tapis, mises, gains), `wheel.js` (roue et bille animées), `app.js` (interface et solo), `multi.js` (entre amis).
- `poker/` — `eval.js` (évaluation des mains, équité), `engine.js` (règles du No-Limit Hold'em, pots secondaires),
  `coach.js` (analyse et conseils), `bots.js` (adversaires), `app.js` (interface solo), `multi.js` (entre amis).
