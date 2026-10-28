# Admin web — vite build served by nginx; /api proxied to the gateway.
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-web ./apps/admin-web
RUN pnpm install --frozen-lockfile
ARG VITE_CONSOLE_MODE=tenant
ENV VITE_CONSOLE_MODE=$VITE_CONSOLE_MODE
RUN pnpm --filter admin-web exec vite build

FROM nginx:1.27-alpine
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 80
