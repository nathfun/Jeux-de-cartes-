# Serveur du Casino — image légère (≈ 60 à 100 Mo de RAM), compatible ARM (DH4300 Plus) et x86.
# À construire depuis la racine du dépôt :  docker compose -f server/docker-compose.yml up -d --build
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
# server/core (la logique des jeux) est livré tout prêt dans le dépôt ; on ne le régénère que s'il manque
RUN [ -f server/core/core.js ] || node server/prepare-core.js
WORKDIR /src/server
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY --from=build /src/server/node_modules ./node_modules
COPY --from=build /src/server/core ./core
COPY --from=build /src/server/src ./src
COPY --from=build /src/server/package.json ./package.json
# l'application tourne sans droits root ; seul /data (la base) est modifiable.
# Les fichiers sont rendus lisibles par tous (un ZIP décompressé sur le NAS peut avoir des droits trop stricts).
RUN chmod -R a+rX /app && mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
# mémoire JavaScript plafonnée à 128 Mo : le ramasse-miettes nettoie plus tôt (le conteneur est limité à 256 Mo au total)
CMD ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=128", "src/server.js"]
