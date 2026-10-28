# Build from repo root: docker build -f services/api-gateway/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api-gateway ./services/api-gateway
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @fii/common build && pnpm --filter @fii/api-gateway build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 8080
CMD ["node", "services/api-gateway/dist/index.js"]
