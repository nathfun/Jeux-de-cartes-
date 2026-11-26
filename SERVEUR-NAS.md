# Serveur du Casino sur ton NAS (UGREEN DH4300 Plus)

Le serveur devient **l'arbitre** du casino : il tire les cartes, la roue, la fusée, les billes et les mines, et il tient la banque.
Le téléphone ne fait plus qu'afficher et envoyer les clics : **impossible de tricher** en bricolant l'app.

- **Ce qui tourne** : 2 petits conteneurs Docker, le serveur (Node.js + SQLite, ≈ 60–100 Mo de RAM) et Tailscale (≈ 30 Mo).
- **Ce qui ne change pas** : l'app reste sur GitHub Pages, les comptes restent chez Firebase (aucun mot de passe sur ton NAS).
- **Aucun port à ouvrir sur ta box** : le serveur sort par Tailscale Funnel, en HTTPS.
- **Coût** : 0 €.

> Pour l'instant, Bourse Flash reste en Apprentissage quand le serveur est actif. Sa partie réelle arrivera avec un marché tiré par le serveur.

---

## 1. Préparer les comptes (une seule fois)

### a) La clé Firebase du serveur
1. Console Firebase → ⚙️ **Paramètres du projet** → onglet **Comptes de service**.
2. Clique **Générer une nouvelle clé privée**, puis **Générer la clé**. Un fichier `.json` est téléchargé.
3. ⚠️ Ce fichier donne un accès complet à ta base Firebase : ne l'envoie à personne, ne le mets jamais sur GitHub.
   Il ira uniquement sur ton NAS (étape 2).

### b) Tailscale
1. Va sur [login.tailscale.com/admin](https://login.tailscale.com/admin) (active la **double authentification** si ce n'est pas fait).
2. Onglet **DNS** : vérifie que **MagicDNS** est activé, puis clique **Enable HTTPS** (certificats).
3. Onglet **Access controls** : dans le fichier, ajoute (ou complète) la partie `nodeAttrs` pour autoriser Funnel :
   ```json
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```
   puis **Save**.
4. **Settings → Keys → Generate auth key**. Laisse les options par défaut et copie la clé `tskey-auth-…`.

---

## 2. Installer sur le NAS

### a) Activer SSH (le temps de l'installation)
UGOS Pro → **Panneau de configuration → Terminal** → active **SSH**. Tu pourras le désactiver à la fin.

Depuis ton ordinateur :
```bash
ssh ton-utilisateur@ip-du-nas
```

### b) Récupérer le projet
```bash
cd /volume1/docker            # ou le dossier où sont tes autres projets Docker
git clone https://github.com/nathfun/Jeux-de-cartes-.git casino
cd casino
git checkout claude/blackjack-app-feedback-appqgy
cd server
```
Si `git` n'est pas installé : télécharge le ZIP du projet depuis GitHub (bouton **Code → Download ZIP**, sur la bonne branche),
décompresse-le dans `/volume1/docker/casino` avec le gestionnaire de fichiers, puis `cd /volume1/docker/casino/server`.

### c) La configuration
```bash
cp .env.example .env
nano .env                     # colle ta clé Tailscale (TS_AUTHKEY=…), enregistre avec Ctrl+O puis Ctrl+X
mkdir -p secrets data tailscale/state
```
Copie le fichier `.json` de Firebase (étape 1a) dans `server/secrets/` et renomme-le **`firebase.json`**,
par exemple avec le gestionnaire de fichiers UGOS, puis :
```bash
chmod 600 secrets/firebase.json
sudo chown -R 1000:1000 data           # le serveur tourne sans droits root (utilisateur 1000)
sudo chown 1000:1000 secrets/firebase.json
```

### d) Lancer
```bash
sudo docker compose up -d --build
```
La première fois, la construction prend 2 à 5 minutes. Ensuite :
```bash
sudo docker compose logs -f casino     # tu dois voir « serveur prêt sur le port 8080 » (Ctrl+C pour quitter)
```

### e) Trouver l'adresse du serveur
Dans l'admin Tailscale, onglet **Machines**, une machine **casino** est apparue. Son adresse publique est :
```
https://casino.<ton-réseau>.ts.net
```
Ouvre `https://casino.<ton-réseau>.ts.net/health` dans un navigateur : tu dois voir `{"ok":true,…}`.

---

## 3. Brancher l'app sur le serveur

Envoie-moi l'adresse `https://casino.<ton-réseau>.ts.net` : je la mets dans `firebase-config.js` (`window.CASINO_API`) et je publie.
Ou fais-le toi-même dans ce fichier, à la ligne `window.CASINO_API = '';`.

À leur prochaine visite, les joueurs sont **repris automatiquement** depuis Firebase : banque, niveau, succès, objets, statistiques.
L'argent laissé sur une table en cours leur est rendu dans leur banque.

---

## 4. Au quotidien

| Action | Commande (dans `/volume1/docker/casino/server`) |
|---|---|
| Voir l'état | `sudo docker compose ps` |
| Voir les journaux | `sudo docker compose logs -f casino` |
| Mettre à jour (après une nouvelle version) | `git pull && sudo docker compose up -d --build` |
| Redémarrer | `sudo docker compose restart` |
| Arrêter | `sudo docker compose down` |

**Sauvegarde** : toute la base tient dans `server/data/` (fichier `casino.db`).
Ajoute ce dossier à une tâche de sauvegarde UGOS (quotidienne, vers un autre disque ou le cloud).

**Le journal de l'argent** : chaque mouvement (qui, quand, quelle action, banque et table avant/après) est enregistré dans la table `ledger`.
En cas de doute sur un joueur, on peut tout retracer.

---

## 5. Sécurité : ce qui est déjà fait

- Le serveur **ne stocke aucun mot de passe** ni e-mail : il vérifie le jeton de connexion Firebase à chaque requête.
- **Aucun port ouvert** sur la box ; le reste du NAS reste privé. Le conteneur est **isolé** :
  - pas d'accès à tes dossiers ;
  - pas de droits root, système de fichiers en lecture seule (sauf `data/`) ;
  - RAM limitée à 256 Mo.
- **Origines autorisées** : seule ton app (`ALLOWED_ORIGINS`) peut appeler le serveur depuis un navigateur.
- **Anti-abus** : requêtes limitées par joueur et par adresse, taille des requêtes limitée, une seule opération d'argent à la fois par joueur.

**À faire de ton côté** :
- double authentification sur Tailscale, GitHub, Google/Firebase et ton compte UGREEN ;
- mises à jour UGOS ;
- sauvegarde du dossier `data/` ;
- désactiver SSH après l'installation.

## 6. RAM et ressources
Le serveur est limité à 256 Mo et Tailscale à 128 Mo. En pratique : ≈ 100 Mo au total, avec un processeur presque au repos.
Tes autres projets Docker ne seront pas gênés.
