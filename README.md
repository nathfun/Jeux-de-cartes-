# Casino

App web installable sur téléphone (PWA) : blackjack, poker et roulette, en solo avec des aides ou entre amis.

| Jeu | Solo | Entre amis |
| --- | --- | --- |
| [Blackjack](blackjack/) | Coach (stratégie de base, écarts liés au comptage), comptage Hi-Lo, paris annexes | Tables de 5 places avec code d'entrée, chat |
| [Roulette](roulette/) | Roulette européenne (règles françaises, partage), roue animée, aides sur chaque mise, statistiques | Table à code, même roue pour tous, compte à rebours, classement final |
| [Poker](poker/) | Texas Hold'em contre 1 à 5 bots, coach (position, outs, équité, cotes du pot), résumé de chaque main | 6 places avec code d'entrée, cartes privées, minuteur, chat |

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
