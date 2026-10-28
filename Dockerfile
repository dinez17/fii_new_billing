# ── FII Billing — shared workspace image ─────────────────────────────
# One image runs ANY service or worker; docker-compose picks the command:
#   command: ["pnpm", "--filter", "@fii/auth-service", "exec", "tsx", "src/index.ts"]
#
# bookworm-slim (glibc) keeps Prisma engines happy; tsx executes the
# TypeScript sources directly (the workspace packages resolve via main: src).
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# install with good layer caching: manifests first
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY workers ./workers
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# generate the Prisma client (no DB connection needed)
RUN pnpm --filter @fii/database exec prisma generate
RUN pnpm build

ENV NODE_ENV=production
USER node
# service/worker chosen by compose `command:`
CMD ["node", "-e", "console.error('set a command, e.g. pnpm --filter @fii/api-gateway exec tsx src/index.ts'); process.exit(1)"]
