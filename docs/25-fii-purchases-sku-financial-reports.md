# FII supplier reset, SKU codes and financial reports

The subscriber customer picker sends `activity=active` to CRM before pagination, while retaining its local inactive-option guard. Existing customer/supplier ledger selectors can still retrieve historical parties.

Customer/supplier ledgers, Profit & Loss and Tally P&L default to the saved active FY start through today's Asia/Kolkata date. The Balance Sheet defaults to that FY as of today. It preserves cumulative opening assets/liabilities, separates current FY profit from retained earnings, and shares the same computation with exports.

GET `/gst/gstr1-file-counts?year=YYYY&month=M` requires `gst_report:read`. It uses the exact CSV collector: each section returns `rows` and `documents` (distinct invoice/note count where applicable; null for grouped sections). Docs includes cancelled document counts. The offline-files screen displays both counts, differentiating rate rows from invoice counts. Empty amendment templates show zero rows.

`scripts/reset-fii-purchases-skus.mjs` is dry-run by default. Applying requires a verified `FII_PURCHASE_RESET_BACKUP_SHA256`. It guards FII's exact tenant ID/name/subdomain, locks the maintenance transaction, deletes suppliers/purchase invoices and dependent payment allocations, supplier payments, purchase returns/orders/GRNs, supplier ledger/day-book rows and related vendor/purchase legacy archive rows. Number-series counters, sales/customer records and stock remain intact. Pending supplier financial outbox events are removed and their IDs marked processed to prevent late reposting. All other tenants are compared before/after, including child rows.

The same operation renumbers FII product display SKUs as `PRD-00001` onward, retaining product IDs and relationships. Reapplying preserves valid PRD codes. Product Edit permits future manual SKU correction with tenant uniqueness checks. Mapping and result are saved beside the backup. No stock quantity is reset when clearing purchases.

The reset was rehearsed on a separately restored production backup before live application. Financial report fixtures cover current/prior-year profit and carry-forward balances; GST fixtures cover multiple rates on one invoice and cancelled-document counts.
