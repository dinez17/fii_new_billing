# Deployment — Docker Compose (production)

## Architecture in containers

One shared **app image** (root `Dockerfile`) contains the whole pnpm workspace with the
Prisma client pre-generated; every service and worker is the same image with a different
`command:`. Frontends are static vite builds served by nginx, which also proxies `/api`
to the gateway (same-origin → no CORS in production).

| Container | Port (host) | Notes |
|---|---|---|
| admin-web | 8000 | staff UI |
| customer-portal | 8001 | customer UI |
| api-gateway | 18080 | direct API access (webhooks!) |
| 11 services + 5 workers | internal | see docker-compose.prod.yml |
| postgres / kafka / redis / minio | internal | volumes: pgdata, kafkadata, … |
| migrate | one-shot | `prisma migrate deploy` + idempotent seed, runs before services |

## First deployment

```bash
cp .env.example .env
# EDIT .env:
#  - MASTER_ENCRYPTION_KEY  (openssl rand -hex 32)  — never change after go-live
#  - SEED_SUPERADMIN_* / SEED_DEMO_TENANT
node scripts/generate-keys.mjs        # JWT keypair → ./keys (mounted read-only)

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f migrate   # wait for seed OK
```

Production traffic is terminated by Caddy on ports 80/443 using `ADMIN_DOMAIN`
and `PORTAL_DOMAIN`. Direct UI and gateway ports bind only to localhost for
diagnostics. Start the optional monitoring stack with profile `observability`.

```bash
docker compose -f docker-compose.prod.yml --profile observability up -d --build
```

## Production hardening checklist

- **Secrets**: change the postgres password (compose + DATABASE_URL) and MinIO creds;
  keep `.env` and `keys/` out of git (already ignored) and backed up securely.
- **TLS**: Caddy provisions and renews certificates for the configured domains.
  Razorpay webhooks use `https://$ADMIN_DOMAIN/api/v1/webhooks/razorpay`.
- **Scheduler**: exactly ONE replica (it is a cron producer). Everything else scales
  horizontally (`docker compose up -d --scale billing-worker=3`); Kafka consumer groups
  and the SKIP LOCKED outbox relay handle concurrency.
- **Backups**: nightly `pg_dump` (the in-app Backup module covers on-demand); volumes
  pgdata/kafkadata must be on durable storage. Test restores.
- **Upgrades**: `git pull && docker compose -f docker-compose.prod.yml up -d --build`
  — the migrate one-shot applies new migrations before services restart.
- **Timezone**: containers default to UTC; set `TZ=Asia/Kolkata` in the x-app env if
  the cron times (1st 01:00, month-end 23:00, reminders 09:00) must follow IST.
- **Logs**: JSON (pino) on stdout — ship with Loki/CloudWatch etc.; correlate by
  tenantId / requestId / eventId.
- **High availability**: Compose is the single-node reference deployment. For
  HA, run multiple replicas of stateless services on an orchestrator and use
  managed multi-AZ PostgreSQL, Redis, Kafka and S3. Keep exactly one scheduler
  replica. Shared Redis throttling makes gateway replicas consistent.

## Sizing (starting point)

Single 4 vCPU / 8 GB VM comfortably runs the full stack for thousands of subscribers.
Postgres and Kafka are the ones to watch; move them to managed services when needed —
only DATABASE_URL / KAFKA_BROKERS change.
