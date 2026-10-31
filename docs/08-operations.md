# Operations — monitoring, backup, hardening (Phase 11)

## Health & metrics

Every HTTP service exposes:

| Endpoint | Purpose | Semantics |
|---|---|---|
| `GET /healthz` | liveness | always 200 while the process is up |
| `GET /readyz` | readiness | 200 only if dependency checks pass (e.g. DB `SELECT 1`); 503 otherwise |
| `GET /metrics` | Prometheus | default Node/process metrics + app metrics |

Workers have no HTTP API, so they run a tiny ops server on a fixed port
exposing the same three routes.

| Component | Ops port |
|---|---|
| api-gateway / services | their own HTTP port (e.g. gateway `8080`) |
| billing-worker | `9101` (`BILLING_WORKER_OPS_PORT`) |
| ledger-worker | `9102` (`LEDGER_WORKER_OPS_PORT`) |
| notification-worker | `9103` |
| scheduler | `9104` |
| report-worker | `9105` (`REPORT_WORKER_OPS_PORT`) |

App metrics (from `@fii/common`): `http_request_duration_seconds` (histogram,
labelled by service/method/route/status), `domain_events_total`
(published|consumed|dlq), and `dlq_depth` (alerting target).

### Adding ops to a service or worker

Services (Express):

```ts
import { httpMetrics, mountOps } from "@fii/common";
import { prisma } from "@fii/database";

app.use(httpMetrics("my-service"));
mountOps(app, { name: "my-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });
```

Workers:

```ts
import { startOpsServer } from "@fii/common";
const stopOps = startOpsServer({ name: "my-worker", port: 9106 });
// call stopOps() on SIGINT
```

Wired so far: api-gateway, billing-service, payment-service, accounting-service,
billing-worker, ledger-worker, report-worker. Apply the snippet above to the
remaining services (auth, crm, settings, purchase, inventory, expense, hr,
helpdesk) and workers (notification, scheduler).

## Alerting

Scrape every `/metrics` with Prometheus and alert on:

- `dlq_depth > 0` for 5m — poison messages piling up in a DLQ.
- `rate(http_requests…{status=~"5.."}[5m])` elevated — service errors.
- `up == 0` — a target is down (readiness failing or process dead).
- `histogram_quantile(0.95, http_request_duration_seconds) > 1s` — latency.

Pipe pino logs (already JSON) to Loki/ELK via the container log driver; no code
change needed.

The production Compose `observability` profile provisions Prometheus,
Alertmanager, Loki, Promtail and Grafana. Replace Alertmanager's placeholder
webhook with the organization's pager or email integration before go-live.

## Backup & restore

```bash
# nightly (cron / scheduled task)
DATABASE_URL=postgres://user:pass@host:5432/fii ./scripts/backup.sh
# → backups/<timestamp>/db.dump (+ objects/ if MinIO mc is configured)

# restore into a fresh/target DB
DATABASE_URL=postgres://user:pass@host:5432/fii ./scripts/restore.sh backups/<timestamp>/db.dump
```

`backup.sh` keeps the newest `BACKUP_KEEP` (default 14) folders. `restore.sh`
runs in a single transaction with `--clean --if-exists`, so a bad restore rolls
back instead of half-applying.

With `BACKUP_AGE_RECIPIENT`, backups are encrypted before plaintext is removed.
`BACKUP_S3_URI` copies the encrypted artifact to off-host S3. Encrypted restores
require the offline `BACKUP_AGE_IDENTITY` private-key file.

### Restore drill (run quarterly)

1. `./scripts/backup.sh` on production.
2. Spin up a scratch Postgres: `docker run --rm -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:16-alpine`.
3. `DATABASE_URL=postgres://postgres:x@localhost:5433/postgres ./scripts/restore.sh backups/<stamp>/db.dump`.
4. Point a gateway at it and smoke-test login + an invoice list.
5. Record the wall-clock restore time — that's your RTO.

## Testing

```bash
pnpm test:unit
RUN_INTEGRATION_TESTS=true DATABASE_URL=postgres://... pnpm test:integration
pnpm check          # typecheck + unit tests + production builds
```

Integration suites require the explicit `RUN_INTEGRATION_TESTS=true` guard so
an ordinary developer or production-like `DATABASE_URL` is never modified by
the default test command. CI provisions a disposable PostgreSQL service.

## Load testing

See `scripts/loadtest/README.md` — seed 10k subscribers, drive the gateway with
k6, and trigger a billing run to load the worker.
# Login throttling

The gateway trusts one immediate nginx proxy hop and uses the rightmost
`X-Forwarded-For` address for client limits. Keep its published port bound to
loopback as configured in Compose. Staff and customer login endpoints allow ten
unsuccessful requests per client address per 15 minutes. Successful responses do
not consume that allowance. A blocked request returns HTTP 429 with a
`Retry-After` header and a JSON error; the admin consoles display the wait time.


## Recovery controls added 31 October 2026

Set BACKUP_REQUIRE_OBJECTS=true when object files are required, and
BACKUP_REQUIRE_OFFSITE=true only after configuring BACKUP_AGE_RECIPIENT and
BACKUP_S3_URI. Object-copy errors fail the backup. Relative checksums cover the
database and object files. Retention removes only completed backup folders inside
the configured root; older folders without .complete require operator review.

Run scripts/recovery-drill.sh <db.dump> <expected-sha256> <evidence.json> to restore
into a disposable network-isolated PostgreSQL container. It never accepts a live
target database URL. It verifies the dump checksum and records restore duration
and business counts; object files, key recovery, application login and PDFs still
require separate rehearsal. Off-server storage is deferred by the user.

Email notifications retry per persisted log with a two-minute lease, exponential
backoff and a five-attempt cap. Failed emails can be queued again from Send log
with settings:update; the action is audited. Retries rebuild financial PDFs and
check document validity. A stable Message-ID assists deduplication, but SMTP
acceptance followed by a worker crash can still cause duplicate delivery. Check
provider logs before manually retrying an ambiguous final attempt. SMS/WhatsApp
providers are not activated; the current scope is email only.
