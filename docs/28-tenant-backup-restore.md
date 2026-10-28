# Tenant backup and restore

The tenant UI no longer exposes PostgreSQL database dumps. Operator disaster recovery remains in `scripts/backup.sh` and `scripts/restore.sh`.

## API contract

- `GET /api/v1/backup`: `backup:read`; availability, authenticated tenant identity and last ten recovery-copy IDs/dates.
- `GET /api/v1/backup/download`: `backup:export`; encrypted `.fiibak` attachment of this tenant's business data across every financial year.
- `POST /api/v1/backup/inspect`: `backup:update`; octet-stream upload, returns company, creation timestamp, model counts and SHA256 after encryption authentication, tenant, schema and relationship validation.
- `POST /api/v1/backup/restore`: same upload plus `X-Backup-Confirmation` matching the file SHA256 and `X-Restore-Confirm: RESTORE`. Returns restored counts and recoveryId. Replaces only this tenant's business records in one transaction.
- `GET /api/v1/backup/recovery/:id`: `backup:export`; tenant-scoped recovery copy. Foreign recovery IDs return 404.

Files use AES-256-GCM with the installation's MASTER_ENCRYPTION_KEY. Keep that key in the operator disaster-recovery vault. Altered, unencrypted, foreign-tenant, old whole-database dumps and incompatible-schema files are rejected. File limits: 256 MiB, including nginx upload configuration.

Business model ownership and insertion ordering derive from Prisma metadata. Child tables without tenantId use their owning parent. Restore takes exclusive table locks while retaining read access, deletes only scoped rows in reverse dependency order, then inserts typed PostgreSQL records. Validation checks every declared business foreign key against the snapshot. Any constraint, timeout or row error rolls the transaction back. Pending outbox events, billing runs and reports block restore; finish processing and pause tenant activity before restoring. Operator maintenance is appropriate if the queue is backlogged.

Authentication users/passwords/MFA/sessions/roles, platform license/subdomain/limits, audit history, webhook idempotency, notification history and jobs are preserved and excluded from business snapshots. Existing user/customer and user/employee links are retained when the corresponding restored record exists, otherwise detached. Restore cannot raise a license customer limit. Embedded encrypted KYC documents and data URLs are included; external storage files are represented by their existing URLs, not bundled bytes.

Before mutation, a current encrypted snapshot is stored in tenant-scoped AuditLog action TENANT_RESTORE_RECOVERY. It commits atomically with the restore and can be downloaded/restored through the same validation workflow. It is not included recursively in later business backups. Operator database backups remain necessary for account configuration, audit history, external object storage and full installation recovery.

## Date inputs

Native date inputs already expose browser calendars. The shared dd-mm-yyyy DateInput now also exposes a calendar button and a native picker while retaining manual formatted entry. Shared report dates, GST dates and Day Book use it; other create/edit screens retain their existing native pickers.

Superadmin license editing now uses a form with the same calendar control in place of the previous date prompt.

## Verification

Integration tests exercise two tenants, child documents/items, KYC, money, stock precision, arrays/JSON, credential/license preservation, automatic recovery and recovery restore, foreign tenant/schema/relationship rejection, pending-event blocking and transaction rollback. Live verification downloads and inspects only; no live tenant is restored during deployment.

Deployment verification on 28-10-2026: six new integration tests and all 50 existing unit tests passed. Full FII restore rehearsal in a separate database verified 48 business models / 10,805 rows with identical restored business data and unchanged other-tenant hashes, credentials and license. Live download/inspect succeeded with an 8,343,878-byte encrypted backup. Day Book calendar opened and native date changes updated the dd-mm-yyyy field; reload retained today's default for both dates. Evidence is in the ignored `backups/tenant-backup-20261028/` directory. The rehearsal database was dropped afterwards.
