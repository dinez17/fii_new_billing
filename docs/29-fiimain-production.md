# Moving this installation to fii-main

Repository: https://github.com/dinez17/fii_new_billing.git

## Preflight findings (28-10-2026)

SSH alias fiimain reaches Linux host fii-main. It currently has two logical CPUs, approximately 4 GiB RAM (2.6 GiB available) and 80 GiB free on its root filesystem. Existing nginx occupies ports 80 and 443. Docker Compose is installed; the current SSH account cannot access the Docker socket and noninteractive sudo requires a password. No existing server service or permission was changed during inspection.

The local billing stack currently uses approximately 1.9 GiB of container memory at idle, including Kafka, PostgreSQL and MinIO, excluding build peaks, host overhead and production load. The current server has limited memory headroom. Increase capacity or validate peak load before accepting production traffic. Build images off-server if capacity is tight. GitHub source storage does not move application data or configure deployment automatically.

## Deployment layout

Use a dedicated checkout such as `/opt/fii-billing` and the existing nginx reverse proxy. Use both Compose files on every command:

```sh
docker compose -f docker-compose.prod.yml -f deploy/fiimain.compose.yml config --quiet
docker compose -f docker-compose.prod.yml -f deploy/fiimain.compose.yml build
```

The override disables bundled Caddy by default and makes the migration job migrations-only. It must not seed demo records or reset credentials on an imported installation. Keep app, superadmin, portal and gateway ports bound to loopback. Check port availability immediately before startup. Do not use `down -v` on an installation containing data.

Set separate actual DNS names for tenant app, superadmin and customer portal. Adapt `deploy/fiimain.nginx.conf.example` as additional sites, retaining unrelated existing sites. Add valid HTTPS certificates before cutover; the example intentionally is not an active TLS site. Verify request size and timeout settings on every proxy hop. Use a DNS or host mapping rehearsal before switching public DNS.

## Move current data separately from GitHub

1. Make an operator backup of the entire current PostgreSQL database, plus object storage and encrypted off-host copies of `.env` and `keys/`. The tenant `.fiibak` download alone is not an installation migration: it intentionally omits users, roles, licenses, audit and runtime state.
2. Preserve the exact original MASTER_ENCRYPTION_KEY, JWT keys, stable tenant/user IDs and required tenant settings. Changing the encryption key makes existing KYC/secret fields and tenant backups unreadable. Never commit or send these through GitHub.
3. Prepare the server-only `.env` with container-network DB/Redis URLs and actual public application URLs. Use unique non-demo login credentials before accepting public traffic. Keep configuration files readable only by the deployment administrator; the JWT mount must remain readable by the application container's node user.
4. Start only PostgreSQL/Redis/Kafka/MinIO initially. Restore the full operator database backup into this new, verified destination. Restore object files as necessary. Apply migrations without seeding. Check for unpublished outbox events before starting workers so no migration triggers unintended historical notifications or financial postings.
5. Start app services and workers behind nginx. Verify tenant and platform login, tenant isolation, invoice PDFs, uploaded documents, outstanding balances, day book, license details, tenant backup and a restore rehearsal on an isolated copy. Configure email/payment webhook URLs and verify them before enabling live financial integrations.
6. During final cutover, pause writes on the old installation, take a fresh backup and restore it to the prepared destination. Prevent both installations from running schedulers or accepting writes simultaneously. Switch traffic only after comparing counts and financial totals. Keep the old installation stopped and recoverable for rollback.

## Release and recovery

GitHub Actions runs source checks and database integration tests; it does not automatically deploy to fii-main. Use reviewed commit/tag revisions for deployments. Retain full operator backups and encryption keys off-host, and rehearse full recovery separately from tenant self-service restore. A code rollback may require a matching database restore if schema migrations are not backward compatible.

Production activation remains pending actual domain choices, administrative Docker/nginx access and a verified data-transfer/cutover window. No live server data was overwritten during repository preparation.
