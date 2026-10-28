# fiitech.in production endpoints

| Purpose | Hostname | GoDaddy A record name | IPv4 |
|---|---|---|---|
| Tenant console | sales.fiitech.in | sales | 202.61.120.82 |
| Customer portal | customer.fiitech.in | customer | 202.61.120.82 |
| Platform superadmin | platform.fiitech.in | platform | 202.61.120.82 |

Use a 600-second TTL during cutover. No database, Redis, Kafka or object-store port needs a public DNS record. Keep application ports 8000, 8001, 8002 and 18080 on loopback. The existing nginx continues to own public 80/443; unrelated sites and the cable PHP container remain separate.

## Administrator steps

Stage the two `deploy/fiitech.nginx.*.conf` files and `scripts/cicd/install-fiitech-nginx.sh` in `/opt/fii-billing/shared/`. The administrator runs:

```sh
sudo bash /opt/fii-billing/shared/install-fiitech-nginx.sh prepare
```

This installs an ACME challenge/maintenance site for the three hostnames, checks nginx configuration and reloads only after validation. The application remains private. Confirm public routing by requesting `http://sales.fiitech.in/.well-known/acme-challenge/fii-probe`; it must return `fii-main-billing-48dcbf74`.

After DNS resolution and the fingerprint-verified final data cutover, the administrator can run:

```sh
sudo bash /opt/fii-billing/shared/install-fiitech-nginx.sh https
```

The command obtains one Let's Encrypt certificate covering all three hostnames, using the webroot challenge and cert-specific nginx reload hook. It accepts the ACME terms without registering an email contact. A certificate owner can add a verified contact email later with certbot. DNS and HTTP port 80 must reach this nginx instance. The helper requires the final data-cutover marker. HTTPS then remains in maintenance mode until `/var/lib/fii-billing-public/ready` exists. Only the deployment operator creates that marker after private application verification and default-credential review, also recording `/opt/fii-billing/shared/public-ready.flag`. This avoids exposing the known demo password while certificates are being prepared and allows final activation without another nginx reload.

The HTTPS configuration proxies API requests directly from public nginx to the loopback gateway. It overwrites incoming forwarded-address headers with the real peer address, maintaining the gateway's one-proxy trust setting. UI requests go to their respective tenant, customer and platform containers. This avoids treating every public user as the internal frontend proxy for login rate limiting. File uploads allow 256 MiB and API requests have a 180-second timeout.

Both nginx configurations and the installer are validated locally before staging. An isolated test certificate is used only for syntax validation; production always uses the ACME certificate. If nginx validation fails, the helper restores the previous billing site and does not reload. Other nginx sites are not rewritten.

## Data migration

Move the full operator database snapshot, required object files and original encryption/JWT keys over authenticated SSH, with the owner's explicit approval. GitHub receives no data or secrets. Keep the source installation authoritative during staging. Take a fresh stopped-writer snapshot for final cutover, verify both tenants and financial totals, then run exactly one scheduler/worker installation.

Initial infrastructure should use the source installation's image digests. If the exact MinIO image cannot be pulled from its original registry, export the existing image, verify its image ID after loading it on the target, and use a local source-version tag with pull_policy never. This preserves compatibility with the source object-storage data instead of silently changing its implementation.

The registry override supports server-only FII_POSTGRES_IMAGE, FII_REDIS_IMAGE, FII_KAFKA_IMAGE, FII_MINIO_IMAGE and FII_MINIO_PULL_POLICY pins. FII_POSTGRES_VOLUME, FII_REDIS_VOLUME, FII_KAFKA_VOLUME and FII_MINIO_VOLUME allow the final cutover to use new named volumes while retaining the staging copy. Keep these values in the server .env so later CI/CD deployments continue using the correct live storage.

`scripts/cicd/database-fingerprint.mjs` emits only model counts and checksums. Its business mode ignores operational logs/tokens and volatile login timestamps; full mode verifies every Prisma model before application writers resume. `bootstrap-fiimain-staging.sh` imports only into an empty database and deliberately leaves workers stopped. Compose migration commands use noninteractive stdin and supported run options.

For nightly operator database backups, `backup-fiimain.sh` uses the pg_dump binary inside the running matching-version PostgreSQL container. Its output is private, checksum-verified and retained without automatic deletion. On a UTC server, a user cron at 20:30 UTC corresponds to 02:00 Asia/Kolkata. Disable the application's in-container backup with INTERNAL_BACKUP_ENABLED=false when this host-side backup is configured; its application image does not include pg_dump. Copy encrypted operator backups and the encryption keys off-host separately.

Production prerequisites still include administrative nginx access, valid DNS/HTTPS, capacity monitoring and full off-host operator backups including the encryption keys. Self-service tenant backups do not replace full installation recovery.
