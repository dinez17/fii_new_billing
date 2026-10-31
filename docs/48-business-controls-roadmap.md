# Business controls implementation and release status

## Implemented in source
- April–March calendar cycles, paged read-only billing preview, transactional
  subscriber-period overlap checks and explicit manual invoice service periods.
- Audited manual receipt reversal with cash/TDS separated, restored outstanding,
  retained receipt and reversal label, and delayed-worker/repeated-request guards.
  Gateway refunds and locked-year corrections are deliberately rejected.
- Corrected held **sales** invoice posting with linked receipts, preview token,
  source approval/mapping checks, exact balance reconciliation and audit evidence.
  No automatic classification, stock backfill or customer notification. Locked
  historical years and cancelled/duplicate sources remain blocked. Purchase-held
  posting still requires its own supplier/product reconciliation workflow.
- Persistent email retries: per-message leases, five attempts with backoff,
  regenerated PDFs, failed-send retry button and audited manual retry. SMS and
  WhatsApp remain disabled/unimplemented, as requested (email only).
- Named journal accounts, balanced double-entry journals, exact reversals,
  fiscal trial balance, bank statement rows and explicit matching. A bank debit
  matches a book credit and vice versa. Bank transfers are balanced journals.
  No opening figures are invented. Setup is available from Settings → Cash /
  bank accounts and Accounting → Financial Controls.
- Database constraints reject unbalanced and cross-tenant journals, including
  tenant restores. Tenant backup schema includes journal/account/statement data.
- TDS certificate/statement reviews, verified credit and encrypted PDF evidence.
  Reviews do not clear TDS receivable or change financial balances.
- Year-end reconciliation checklist with saved evidence and change fingerprint.
  Review is separate from Settings financial-year locking; existing profit basis
  is preserved. It does not certify unresolved migration or bank balances.
- Next unbilled subscription period shown in the subscriber list.
- Browser regression command and CI step, using mocked API contracts; financial
  behavior is separately covered by real PostgreSQL integration tests.
- Backup hardening: relative checksums, private permissions, required-object and
  required-encrypted-offsite flags; isolated Docker restore-drill utility.

## Remaining implementation / operations
- Reconciled held purchase posting and richer correction workflows for write-offs.
- Automatic source-document posting into the new general journal. The trial
  balance clearly covers explicit journals only; operational reports are retained.
- Named money-account assignment on every operational money entry and automatic
  synchronization. Existing daybook remains combined cash/bank, not fabricated
  account-wise history. Bank statement CSV mapping/import UI (API accepts batches).
- TDS tax-liability/refund clearing and verified accounting allocations.
- Scheduled pause/resume/termination dates and billing-impact preview for plan
  changes (existing immediate lifecycle actions remain available).
- Configure encrypted off-server backup destination/keys and notification alerts;
  run full production database/object/key/application restore drill with evidence.
- Broader browser coverage for portal, tenant isolation and quotation conversions.

## Validation and deployment
Validation completed on 31 October 2026:
- Lint and all workspace type checks passed.
- 96 unit tests and 115 integration tests passed; the ten affected integration
  tests were rerun after the final corrections, followed by the journal constraint
  checks after migration 23.
- Production builds passed; the final tenant-web build also passed.
- Nine mocked-API browser checks passed at mobile and desktop widths, including
  unauthenticated routing, billing-preview invalidation, receipt reversal,
  balanced-journal entry and bank-match selection.
- A test-database dump was restored into a network-isolated disposable Docker
  container; checksum/count/time evidence is in ignored local output. This is not
  evidence of a complete production/object/key recovery drill.
- Backup and recovery Bash syntax checks passed.

The user explicitly deferred off-server backup storage configuration and selected
email-only delivery. Bank names/opening balances will be entered by the user.
 No production release or live
financial posting has been performed for this work. New migrations are additive;
existing tenant backups require their matching schema version. Never infer bank
opening balances, repost historical receipts or reset profit basis during deploy.
