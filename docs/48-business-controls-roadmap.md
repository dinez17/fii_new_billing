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

## Completion update — 31 October 2026

All remaining implementation items have now been added locally:
- Automatic, idempotent source journals for sales, notes, receipts, purchases,
  supplier payments, purchase returns, expenses/payroll, write-offs and manual cash.
  Corrections retain the original journal and post a balanced reversal.
- Named cash/bank selection on receipt, supplier payment, expense, salary and
  manual daybook entry; reviewed assignment of old money entries. Non-cash entries
  without a known account remain explicitly unassigned.
- Bank CSV upload with delimiter/date/column mapping, preview and duplicate handling.
- Reviewed held-purchase posting with own supplier/product mapping, linked actual
  supplier receipts, and explicit locked-history correction permission. Sales
  corrections can classify a verified write-off without inventing cash or TDS.
- Receivable write-off and reversal history. GST and original sales remain intact.
- Verified TDS application against recorded income-tax liability, or actual refund
  to a selected bank; reversal history, verified-credit limits and cash-only refunds.
- Controlled year-end preview, reconciliation blockers, income/expense closing,
  retained earnings, calculated next-year openings and audited reopen/reversal.
  Existing profit-reset settings are preserved; opening journals are not duplicated.
- Scheduled pause/resume/termination, due-action processing and future-period
  eligibility checks. Plan edits show old/new cycle prices before confirmation;
  mid-period changes require reviewed manual proration.
- Browser coverage extended to CSV, quotation conversion, portal sign-in and denied
  tenant-source access. Actual tenant boundaries are separately tested in PostgreSQL.

See [49-accounting-completion.md](49-accounting-completion.md) for setup and use.

## Deferred by the user
Recovery and monitoring configuration is explicitly excluded from this completion:
encrypted off-server destination/keys, failure alerts and the complete production
restore drill covering objects, keys, login and PDFs. Existing recovery utilities
are retained. SMS/WhatsApp remain out of scope (email only).

## Validation and release state
- 98 unit tests and 124 PostgreSQL integration tests passed.
- Lint, workspace type checks and production builds passed.
- 16 browser checks passed using built applications with mocked API responses at mobile and
  desktop widths; these use mocked APIs and do not claim production authentication or delivery testing.
- Additive migrations 24 and 25 were applied only to the disposable test database.
- No production release, live historical posting, bank allocation or profit reset
  was performed by this completion task. Deployment and user financial review are
  still required. Bank names/opening balances must be entered by the user.
