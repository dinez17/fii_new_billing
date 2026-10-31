# Accounting and billing completion

Implemented locally on 31 October 2026. Recovery/monitoring remains deferred at the
user's request. This change does not itself approve or post held production data.

## Setup order
1. Deploy the application and additive database migrations 24 and 25 together.
   Backups from an earlier schema require that matching application/schema version.
2. Settings → Cash / bank accounts: create real accounts. Do not guess balances.
3. Accounting → Financial Controls → Source posting: choose the financial year
   and document kind. Review each page, assign actual bank accounts to old receipts,
   supplier payments and expenses, then reconcile its source journals. Repeating an
   unchanged source is safe and does not duplicate invoices, stock or email.
4. Reconcile the trial balance and enter verified opening adjustments as balanced
   manual journals. Source posting covers imported documents only; it cannot infer
   missing history or correct held records automatically. Manual opening journals
   must not duplicate customer/supplier openings or imported history.
5. Bank reconciliation: select the account, upload CSV, map Date, unique Reference,
   Narration, Withdrawal and Receipt columns. Verify the preview before importing.
   Import creates statement rows, not money or journals. Match actual book entries.

## TDS and write-offs
Record the customer's actual cash and TDS separately in Payment entry. In the TDS
report, save the verified certificate/statement credit. “Apply / refund TDS” can
then apply credit against an already recorded income-tax liability, or record a
refund actually received into the selected bank. Clearing cannot exceed verified
uncleared credit. Reverse an incorrect clearing from its history before reversing
the underlying receipt. A refund alone creates daybook cash movement; tax
application does not. No tax liability or opening bank amount is invented.

Invoice write-off records a non-cash receivable adjustment and bad-debt expense;
it preserves sales/GST and does not create a receipt. Financial Controls →
Write-offs shows the history and offers an audited reversal in an unlocked year.

## Held historical documents
Settings → Legacy import: approve the original parent invoice, then open financial
reconciliation. Sales require the mapped customer and every actual linked receipt;
a separately verified write-off is optional. Purchases require the verified own
supplier, each own product and every supplier receipt. Check interstate treatment,
amounts, balance and evidence. Review the read-only preview, record the backup
reference and explicitly confirm posting. Historical stock is not backfilled and
notifications are not sent.

Locked-history corrections require financial-year administration and the explicit
checkbox. They append reviewed financial records without unlocking the historical
year. A year closed through the controlled general-ledger workflow must first be
reopened. Cancelled sources, unresolved duplicate numbers, missing mappings and
unexplained balance differences remain blocked until corrected with evidence.

## Year-end close / reopen
After the year ends, activate/create its successor. Finish source posting, actual
bank assignments, statement matching and held-document review. Save the year-end
checklist, then inspect the controlled closing preview and next-year openings.
Closing rejects stale reviews and unresolved items, posts income/expense closing
into retained earnings, and locks the year. Existing asset/liability/equity balances
carry into the next year; a second opening journal is not created.

If the saved profit-reset basis applies, the preview separately identifies prior
profit to move into opening equity, requiring explicit confirmation. The saved
profit-reset setting and old customer/receipt history are not overwritten.
Reopening requires a reason, reverses the controlled closing and unlocks the year.
Later locked years must be reopened first. Review again before reclosing.

## Subscriber changes
In subscriber edit, Schedule service change supports future pause, resume and
termination. Pending actions can be cancelled; invalid changed timelines are
flagged failed. Scheduler and bill runs apply due actions idempotently. Billing
preview blocks affected partial periods for manual proration rather than charging
a full period. Future paused/terminated periods are excluded. Plan changes show
old/new monthly and cycle amounts before saving and affect future invoices only;
issued invoices retain their saved details.

## Release limits
Production has not been updated by this task. The user still supplies actual bank
accounts/balances and financial correction evidence. Off-server recovery storage,
failure alerts and the full production restore drill remain deliberately deferred.
