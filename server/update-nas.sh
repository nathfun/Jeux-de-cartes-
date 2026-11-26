#!/bin/sh
# Mise à jour du serveur du Casino sur le NAS, en une commande :
#   sudo sh /volume1/docker/casino/update.sh
# Télécharge la dernière version de la branche, garde ta config (.env), ta clé, la base des joueurs et Tailscale,
# et ne reconstruit le conteneur que si le serveur a vraiment changé.
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"
BRANCH="claude/blackjack-app-feedback-appqgy"
URL="https://codeload.github.com/nathfun/Jeux-de-cartes-/zip/refs/heads/$BRANCH"
cd "$BASE"
echo "→ Téléchargement de la dernière version…"
rm -rf _new && mkdir _new
# wget/unzip viennent d'un mini-conteneur Alpine : rien à installer sur le NAS
docker run --rm -v "$BASE/_new:/w" alpine:3.20 sh -c "wget -qO /w/src.zip '$URL' && cd /w && unzip -q src.zip && rm src.zip"
NEW="$(ls -d _new/*/ | head -1)"
NEW="${NEW%/}"
if [ ! -f "$NEW/server/docker-compose.yml" ]; then echo "✗ Téléchargement incomplet, rien n'a été changé."; rm -rf _new; exit 1; fi
same() { diff -rq "$NEW/server/$1" "app/server/$1" >/dev/null 2>&1; }
if [ -d app/server ] && same src && same core && same Dockerfile && same docker-compose.yml && same package.json; then
  echo "✓ Le serveur est déjà à jour : rien à faire."
  rm -rf _new
  exit 0
fi
echo "→ Nouvelle version du serveur : installation…"
for f in .env secrets data; do [ -e "app/server/$f" ] && cp -a "app/server/$f" "$NEW/server/"; done
mkdir -p "$NEW/server/tailscale" && [ -d app/server/tailscale/state ] && cp -a app/server/tailscale/state "$NEW/server/tailscale/"
[ -d app/server ] && (cd app/server && docker compose down)
rm -rf app-old
[ -d app ] && mv app app-old
mv "$NEW" app
rm -rf _new
cp app/server/update-nas.sh "$BASE/update.sh" 2>/dev/null || true
cd app/server && docker compose up -d --build
echo "✓ Serveur mis à jour. L'ancienne version est gardée dans app-old (tu peux la supprimer)."
