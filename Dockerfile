# RobMine – Spielserver + Client in einem Container.
#   docker build -t robmine .
#   docker run -d --name robmine -p 8080:8080 -v robmine-data:/data robmine
# Danach: http://<server>:8080 (für HTTPS einen Reverse-Proxy wie Caddy davor setzen).
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @robmine/client build

ENV NODE_ENV=production \
    PORT=8080 \
    SEED=42 \
    DATA_DIR=/data \
    STATIC_DIR=/app/apps/client/dist \
    MAX_PLAYERS=16
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
