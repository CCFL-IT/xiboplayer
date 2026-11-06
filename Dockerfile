# syntax=docker/dockerfile:1
#
# xiboplayer — PWA player + proxy in one image.
#
# The proxy serves the built PWA at /player/ and provides the same-origin
# endpoints the PWA depends on (/xmds-proxy, /api/*, /config, /store/*),
# so both run together in a single container.
#
# Build:  docker build -t xiboplayer .
# Run:    docker compose up -d        (see docker-compose.yml / .env.example)

ARG NODE_VERSION=22

# ─── Build: install workspace, build PWA, extract proxy prod deps ───────────
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src

RUN npm install -g pnpm@10.27.0

COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build:pwa \
 && pnpm --filter @xiboplayer/proxy deploy --prod --legacy /out/proxy \
 && node -p "require('./packages/pwa/package.json').version" > /out/version

# ─── Runtime ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=8765 \
    LISTEN_ADDRESS=0.0.0.0 \
    CONFIG_FILE=/config/config.json \
    DATA_DIR=/data \
    PWA_PATH=/app/pwa

WORKDIR /app
COPY --from=build /out/proxy ./proxy
COPY --from=build /src/packages/pwa/dist ./pwa
COPY docker/entrypoint.js ./proxy/bin/docker-entrypoint.js
COPY --from=build /out/version ./VERSION

RUN mkdir -p /config /data && chown -R node:node /config /data
USER node

VOLUME ["/config", "/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8765)+'/player/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "APP_VERSION=${APP_VERSION:-$(cat /app/VERSION)} exec node /app/proxy/bin/docker-entrypoint.js"]
