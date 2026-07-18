FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY prisma ./prisma
COPY apps/api ./apps/api
COPY apps/web ./apps/web

RUN npm run db:generate \
  && npm run build -w @amigo/api \
  && STATIC_EXPORT=true NEXT_PUBLIC_ENABLE_BAILEYS=false npm run build -w @amigo/web

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=10000 \
    SERVE_STATIC_WEB=true \
    STATIC_WEB_DIR=/app/apps/web/out \
    RUN_INBOUND_WORKER=true \
    ENABLE_BAILEYS=false

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/out ./apps/web/out

USER node

CMD ["sh", "-c", "node apps/api/dist/bootstrap-db.js && npx prisma migrate deploy && exec node apps/api/dist/server.js"]
