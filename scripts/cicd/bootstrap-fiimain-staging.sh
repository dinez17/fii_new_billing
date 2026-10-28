#!/usr/bin/env bash
# Initial, approved migration rehearsal only; never starts workers/scheduler.
set -Eeuo pipefail
umask 077
root=/opt/fii-billing
release="$root/releases/48dcbf74-bootstrap"
cd "$release"
compose=(docker compose --env-file "$root/shared/.env" --env-file image.env -f docker-compose.prod.yml -f deploy/fiimain.compose.yml -f deploy/registry.compose.yml -f infrastructure.compose.yml)
[[ ! -e "$root/shared/staging-imported.flag" ]] || { echo 'Staging import already completed' >&2; exit 2; }
tables="$(docker exec fii-billing-prod-postgres-1 psql -U fii -d fii_billing -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
[[ "$tables" == 0 ]] || { echo 'Target database is not empty; refusing initial import.' >&2; exit 2; }
docker cp "$root/backups/staging-db.dump" fii-billing-prod-postgres-1:/tmp/fii-staging.dump
docker exec fii-billing-prod-postgres-1 pg_restore -U fii -d fii_billing --single-transaction --no-owner --no-privileges /tmp/fii-staging.dump
backend="$(sed -n 's/^FII_BACKEND_IMAGE=//p' image.env)"
[[ "$backend" == ghcr.io/dinez17/fii_new_billing-backend@sha256:* ]]
docker run --rm --network none --user 0 --entrypoint sh \
  --mount type=volume,source=fii-billing-prod_miniodata,target=/data \
  --mount "type=bind,source=$root/backups,target=/backup,readonly" \
  "$backend" -c 'test -z "$(find /data -mindepth 1 -print -quit)" && tar -xzf /backup/staging-objects.tar.gz -C /data'
"${compose[@]}" up -d --no-deps --no-build --pull never minio
"${compose[@]}" run --rm --no-deps -T --interactive=false --pull never migrate </dev/null
pending="$(docker exec fii-billing-prod-postgres-1 psql -U fii -d fii_billing -Atc 'SELECT count(*) FROM "OutboxEvent" WHERE "publishedAt" IS NULL')"
[[ "$pending" == 0 ]] || { echo 'Pending source events require review before starting services.' >&2; exit 2; }
"${compose[@]}" up -d --no-deps --no-build --pull never auth-service crm-service settings-service billing-service payment-service purchase-service
"${compose[@]}" up -d --no-deps --no-build --pull never inventory-service expense-service accounting-service hr-service helpdesk-service api-gateway
"${compose[@]}" up -d --no-deps --no-build --pull never admin-web superadmin-web customer-portal
printf 'Staging copy imported; workers/scheduler intentionally not started.\n' > "$root/shared/staging-imported.flag"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
