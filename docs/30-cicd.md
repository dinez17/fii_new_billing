# CI/CD for fii-main

```text
Pull request ── lint / typecheck / tests / build / dependency audit
                      │
Merge or push main ────┘
                      ↓ only when both check jobs succeed
            Build on GitHub-hosted runners
            backend + tenant + platform + portal
                      ↓
            GHCR images + release-images artifact
            pinned to immutable sha256 digests
                      ↓ manual Deploy production workflow
            production environment / enable flag / DEPLOY confirmation
                      ↓
            SSH with pinned known host key → fii-main
            pull → stop writers → DB backup → migrate without seed
                      ↓
            start → readiness/UI/process checks → current release
```

## Repository behavior

`.github/workflows/ci.yml` checks pull requests and main. Image publication runs only on main push or a manual main CI run, after verify and integration succeed. PRs receive no package-write credentials. Production images target linux/amd64, matching fii-main. Separate frontend builds preserve tenant/platform console isolation. Integration files run serially because tenant restore tests take exclusive database table locks.

CI supplies a test-only database URL for Prisma validation and generates temporary JWT keys plus seed fixtures in its disposable PostgreSQL service. These test credentials are never production secrets. Production deployment uses migrations only and never runs that seed step.

The `release-images` artifact contains source SHA, repository, CI run ID and all four image digests. The Deploy production workflow accepts a successful CI run ID, verifies it belongs to this repository's main CI workflow and validates all image names/digests. It archives only tracked source from that exact SHA. There is no latest-tag deployment and no build on the production server. Release artifacts are retained 90 days; retain/promote a manifest separately for longer-term recovery.

## One-time GitHub configuration

Create the **production** Environment in Repository Settings → Environments. Restrict it to main and configure required reviewers if available for the account/repository plan. Keep `ENABLE_PRODUCTION_DEPLOY` unset until the server/data/domain rehearsal is complete. A reviewer rule is not automatically installed by this repository.

Environment variables:

| Name | Value |
|---|---|
| ENABLE_PRODUCTION_DEPLOY | `true` only after provisioning and migration rehearsal |
| PRODUCTION_SSH_HOST | reachable fii-main hostname/IP |
| PRODUCTION_SSH_PORT | external SSH port (current alias uses 5223) |
| PRODUCTION_SSH_USER | deployment account with Docker access |
| PRODUCTION_DEPLOY_ROOT | absolute dedicated path, for example `/opt/fii-billing` |

Environment secrets:

| Name | Purpose |
|---|---|
| PRODUCTION_SSH_KEY | dedicated deployment private key authorized on fii-main |
| PRODUCTION_KNOWN_HOSTS | verified SSH known_hosts entry, including `[host]:port` for a nonstandard port |

Verify the SSH host key out of band before saving it; deployment never trusts an unchecked ssh-keyscan result or disables host checking. Do not put server .env, DB credentials, MASTER_ENCRYPTION_KEY, JWT signing keys or customer data into GitHub. The workflow GITHUB_TOKEN publishes packages; no personal write token is required. Grant the repository Actions package-write access if GitHub policy restricts it. Keep packages private to match the intended source visibility.

## One-time server provisioning

Complete `29-fiimain-production.md` first, including domains/HTTPS, capacity validation, secure data migration and stopping old writers at cutover. The deployment account needs Docker access, bash, flock, curl, tar and sha256sum. Docker access is effectively privileged; an administrator must authorize/provision the deployment account. This workflow does not add it to sudo or Docker groups.

Provision:

```text
/opt/fii-billing/
  shared/.env          server-only runtime configuration
  shared/keys/         original JWT key pair
  releases/            exact code + image.env + release.json per attempt
  backups/             pre-deploy database dumps and SHA256 checksums
  current              symlink created only after a successful release
  previous             prior successful release reference
```

Ensure the deployment account can write releases/backups and read the runtime files; keep secrets private, while making JWT files readable by the application node UID. Log the same deployment account into GHCR on fii-main with **read:packages** access if packages are private. Registry read credentials remain on the server. No application secrets are copied by this pipeline.

Before the first CD deployment, the existing Compose project `fii-billing-prod` must already have healthy PostgreSQL, Redis, Kafka and MinIO with the migrated production data. CD deliberately refuses to initialize a blank server. Existing nginx proxies loopback ports 8000/8001/8002; Caddy stays disabled. The deployment code does not change DNS, TLS, firewall or unrelated services.

## Deploy a release

1. Push/merge main; wait for CI including all four image jobs and release assembly to finish successfully.
2. Open Actions → Deploy production → Run workflow on main. Enter that successful **CI run ID** and `DEPLOY`.
3. Approve the production environment when reviewers are configured.
4. Review the deployment log and verify production login, invoice balance/PDF and tenant access after the automated readiness checks.

Only one production deployment runs at a time; a server flock also prevents overlap. Images are pulled before stopping services. Application writers are stopped before the database backup, then migrations run without seeding. Database and object-store volumes are never deleted. Source archives contain no .env or private keys. The current symlink changes only after the gateway health/readiness, frontend responses and all app/worker processes pass startup checks. These checks are startup smoke checks, not full business validation or long-duration load tests. Configure monitoring separately.

## Failure and rollback

On failure after maintenance starts, application writers are stopped and the job fails with the pre-deploy backup path. The pipeline never automatically restores a database or assumes an old binary can read a newly migrated schema. Inspect migration status before recovery. Keep a full operator backup of data, object storage and encryption keys off-host; this deployment's database-only backup does not replace it. No backup retention/delete job is enabled automatically.

An earlier successful CI run can be selected for a code rollback **only after confirming schema compatibility**. Otherwise restore the matching operator backup during a controlled recovery. Never use `docker compose down -v` for deployment or rollback.

## Current activation status

Workflow and deployment scripts can be committed/pushed now. Production execution remains disabled until environment variables/secrets, administrative Docker access, domains and initial data migration have been configured. Adding these files does not deploy to fii-main automatically.

Local verification on 28-10-2026 passed: 54 unit tests; 58 integration tests on a freshly migrated/seeded disposable database; actionlint and ShellCheck; registry Compose validation; isolated mocked deployment success, image-pull failure, migration failure and startup failure. The test harness mounts no Docker socket and runs with networking disabled. It verifies stop/backup/migration ordering and that failures never automatically restore a database or move the current release pointer. Actual SSH deployment is pending server provisioning.

References: [GitHub environment protections](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [GitHub package publishing](https://docs.github.com/en/packages/learn-github-packages/publishing-a-package).
