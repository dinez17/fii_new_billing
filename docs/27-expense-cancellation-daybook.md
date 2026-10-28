# Expense cancellation and Day Book reconciliation

Expense cancellation previously updated only Expense.status, leaving the creation event's CASH_OUT posting and any stored day closing untouched. Cancellation now locks Tenant then Expense, updates status and removes only matching tenant/refType=EXPENSE/refId postings in one transaction. It recalculates affected DayBookClosing balances without reopening days or changing their identities. Audit records preserve the removed posting details; expense records remain CANCELLED.

The ledger worker takes the same locks, reads the saved expense, skips cancelled/missing expenses and already-posted references, and posts using the expense date, amount and payment mode. This prevents delayed creation messages, duplicate delivery and cancellation races from restoring cancelled expenses. Closed-day creation shares the tenant lock. New or late postings also recalculate affected closing snapshots.

The expense UI invalidates Day Book and affected reports after cancellation; Day Book always refetches on window focus. FY totals, opening/closing balances, CSV exports and Balance Sheet cash/bank balances consequently use the corrected underlying entries.

`scripts/repair-fii-cancelled-expenses.mjs` is dry-run by default; applying requires a verified EXPENSE_REPAIR_BACKUP_SHA256. It repairs only FII's already-cancelled expenses, preserves all other expenses and records, compares unrelated Day Book entries, preserves closed-day metadata and verifies other tenants remain unchanged. Rehearsal uses a separately restored database.

Tests cover normal cancellation, duplicate/delayed creation events, concurrent post/cancel, expense-date posting, prior stale entries, subsequent closed-day snapshots and tenant isolation.
