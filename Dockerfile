# glibc base (not alpine) so better-sqlite3 binaries work.
FROM node:22-bookworm-slim AS build
# Toolchain only as a fallback in case no prebuilt better-sqlite3 binary matches; it stays in this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/popcorn.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
# Owned by the app user so a fresh named volume is writable.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/server/index.js"]
