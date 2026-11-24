# Blackjack Coach

Jeu de blackjack dans le navigateur, avec un coach qui analyse chaque décision
selon la stratégie de base et donne des conseils personnalisés pour progresser.

## Lancer le jeu

Ouvre `index.html` dans un navigateur (aucune installation nécessaire).

## Fonctionnalités

- **Partie complète** : sabot de 6 jeux, mises par jetons, tirer / rester / doubler / séparer
  (jusqu'à 4 mains), blackjack payé 3:2, le croupier reste sur 17.
- **Coach en direct** : après chaque décision, indique si elle était correcte et pourquoi.
- **Conseil avant de jouer** (bouton 💡 ou touche C) pour apprendre.
- **Statistiques** : précision globale et par type de main (dures, souples, paires),
  victoires/défaites, gain net — sauvegardées dans le navigateur.
- **Conseils pour progresser** : détection de tes erreurs récurrentes (rester trop sur 12-16,
  ne pas assez doubler, mauvaises séparations…), gestion de la banque, suivi de progression.
- **Tableau de stratégie de base** avec la case de la situation en cours surlignée.

Raccourcis : `T` tirer · `R` rester · `D` doubler · `S` séparer · `C` conseil · `Entrée` distribuer.

## Fichiers

- `strategy.js` — moteur de stratégie de base (utilisable aussi sous Node).
- `app.js` — logique de jeu, coach et statistiques.
- `index.html`, `style.css` — interface.
