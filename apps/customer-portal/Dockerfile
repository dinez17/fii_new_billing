# Customer portal — vite build served by nginx; /api proxied to the gateway.
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/customer-portal ./apps/customer-portal
RUN pnpm install --frozen-lockfile
RUN pnpm --filter customer-portal exec vite build

FROM nginx:1.27-alpine
COPY apps/customer-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/customer-portal/dist /usr/share/nginx/html
EXPOSE 80
