# TriagePulse production image: the API serves the web app on one port (3001).
# Database migrations run on every start (new tables/columns are added, nothing is removed).
#
#   docker build -t triagepulse .
#   docker run -p 3001:3001 --env-file .env triagepulse
#
# See deploy/gcp/README.md for the Google Cloud (Dammam) server.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install libraries first so this layer is reused when only source code changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/clinical/package.json packages/clinical/
RUN npm ci --no-audit --no-fund

COPY . .
# Web calls the API on the same address (no VITE_API_URL), so one origin serves both.
ENV VITE_API_URL=""
RUN npm run build --workspace=@triagepulse/clinical \
  && npm run db:generate --workspace=@triagepulse/api \
  && npm run build --workspace=@triagepulse/api \
  && npm run build --workspace=@triagepulse/web


FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/packages/clinical/package.json ./packages/clinical/
COPY --from=build /app/packages/clinical/dist ./packages/clinical/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/tsconfig.json ./apps/api/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/triagepulse-start

ENV NODE_ENV=production \
    PORT=3001 \
    SERVE_WEB_DIR=/app/apps/web/dist
EXPOSE 3001
USER node
WORKDIR /app/apps/api
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "triagepulse-start"]
