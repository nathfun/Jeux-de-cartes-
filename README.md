# Jeux de cartes

App web installable sur téléphone (PWA) pour jouer aux cartes entre amis et apprendre avec un coach.

| Jeu | Solo | Entre amis |
| --- | --- | --- |
| [Blackjack](blackjack/) | Coach (stratégie de base, écarts liés au comptage), comptage Hi-Lo, paris annexes | Tables de 5 places avec code d'entrée, chat |
| Poker | Bientôt | Bientôt |

- **Mise en ligne et serveur de jeu** : voir [FIREBASE.md](FIREBASE.md) (GitHub Pages + Firebase, gratuit).
- **Hors ligne** : le mode solo fonctionne sans connexion une fois l'app ouverte.
- **Test local du multijoueur** : ouvre `blackjack/index.html?backend=local` dans deux onglets.

## Structure

- `index.html` — accueil de l'app. `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/` — installation sur téléphone.
- `firebase-config.js` — configuration Firebase (à remplir). `database.rules.json` — règles de sécurité.
- `blackjack/` — le jeu (voir son [README](blackjack/README.md)).
