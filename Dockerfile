FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache git python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN \
    --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV DATABASE_URL="file:/tmp/build.db"
RUN pnpm prisma migrate deploy
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:/data/fractal-ui.db"

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
