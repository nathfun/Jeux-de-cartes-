# Casino

App web installable sur téléphone (PWA) : blackjack, poker, roulette, machine à sous, Rocket Crash, Plinko, Bourse Flash et Mines, en solo ou entre amis. Tout se joue en argent virtuel.

| Jeu | Solo | Entre amis |
| --- | --- | --- |
| [Blackjack](blackjack/) | Coach (stratégie de base, écarts liés au comptage), comptage Hi-Lo, paris annexes | Tables de 5 places avec code d'entrée, chat |
| [Roulette](roulette/) | Roulette européenne (règles françaises, partage), roue animée, aides sur chaque mise, statistiques | Table à code, même roue pour tous, compte à rebours, classement final |
| [Machine à sous](slots/) | 5 rouleaux, 10 lignes, joker, tours gratuits (gains doublés), jackpot ; taux de retour ~94 % vérifié par simulation | – |
| [Rocket Crash](crash/) | Fusée qui décolle, multiplicateur en direct, retrait avant l'explosion (manuel ou automatique) ; RTP 97 % (P(atteindre ×m) = 0,97/m), tirage cryptographique « Provably Fair » | – |
| [Plinko](plinko/) | Billes qui rebondissent sur 8 à 16 rangées de picots jusqu'aux cases à multiplicateurs (jusqu'à ×1 000) ; 3 niveaux de risque, mode automatique, RTP ≈ 97 %, chemin de chaque bille vérifiable (« Provably Fair ») | – |
| [Bourse Flash](trader/) | Trois actions fictives cotent en direct (marche aléatoire équitable, krachs et envolées) : achat ou vente, effet de levier ×1 à ×20, objectif de gain / limite de perte, liquidation ; le casino gagne par les frais (0,3 % × levier) et la liquidation | – |
| [Mines](mines/) | Grille de 25 cases, 1 à 24 mines : chaque diamant fait monter le multiplicateur (0,97 ÷ chance d'en arriver là), on encaisse quand on veut ; positions des mines vérifiables (« Provably Fair ») | – |
| [Poker](poker/) | Texas Hold'em contre 1 à 5 bots, coach (position, outs, équité, cotes du pot), résumé de chaque main | 6 places avec code d'entrée, cartes privées, minuteur, chat |

## L'argent du Casino

- **Banque** : 10 000 € au départ, une seule banque pour tous les jeux, gardée par le **compte** (pseudo + mot de passe, sur l'accueil) et retrouvée sur n'importe quel appareil.
- **Accueil** : onglet **Jeux** (toucher un jeu lance une partie réelle avec sa banque) et onglet **Multijoueur** (créer une table, rejoindre avec un code, liste des parties ouvertes publiques 🌐 ou privées 🔒).
- **Apprentissage** (interrupteur sur l'accueil) : tous les jeux en crédit illimité avec les aides et conseils ; rien ne compte pour les niveaux, défis et succès.
- **Partie réelle** : on apporte une somme de sa banque, sans aides. « Encaisser » ramène ce qui reste sur la table ; si on perd tout, c'est perdu. Au poker : tournoi avec droit d'entrée et cagnotte.
- **Gagner de l'argent** : bonus du jour, défis du jour, **banque du temps** (100 € contre 5 min d'attente… 20 000 € contre 8 h : plus c'est long, plus chaque minute rapporte), et les parties entre amis.
- **Protection** : la banque est rangée en ligne et les règles de la base refusent les montants impossibles (voir FIREBASE.md).
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

## Rocket Crash : réglages et équité

- Réglages dans [`crash/engine.js`](crash/engine.js) (`CONFIG`) : `RTP` (0,97 par défaut, soit 3 % d'avantage maison),
  vitesse de la fusée, mise minimale/maximale, gain maximal par manche, durée du compte à rebours.
- Tirage : `crash = max(1, ⌊100·RTP/(1−r)⌋/100)` avec `r` uniforme cryptographique ; pour tout ×m, P(atteindre ×m) = RTP/m,
  donc tout retrait rend en moyenne RTP × mise, quelle que soit la stratégie. Vérifié par simulation (4 millions de manches).
- Provably Fair : `r` vient de HMAC-SHA256(server seed, « client seed:nonce ») ; l'empreinte SHA-256 du server seed est affichée
  avant de jouer, le seed est révélé au changement, et le panneau « Équité vérifiable » recalcule n'importe quelle manche.
- Avec le serveur (`window.CASINO_SERVER = true`), les opérations `cr.round`, `cr.cashout`, `cr.status`, `cr.seed` de
  `functions/core.js` tirent les manches, encaissent les mises et jugent chaque retrait à l'heure du serveur (un retrait
  ne peut être payé qu'une fois). Sans serveur, le tirage se fait dans l'app et la banque reste protégée par les règles de la base.
