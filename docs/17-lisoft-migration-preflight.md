# Selected Li-Soft migration: staging and reconciliation

Source backup: `C:\Users\DINEZ17\Downloads\lisoft_billing (2).sql`.
SHA-256: `ac3341389490e32ebdbe7d409b6b5414218eef0b1973858fa01c41096613c08e`.
Only companies 1 and 30 are selected; see `scripts/migration/lisoft-mapping.json`
for the verified target UUIDs/subdomains. SKY NETWORK now exists as `skynet`.

## Completed

- Parsed literal INSERT values without executing any source SQL.
- Excluded user credentials, connection strings, tokens and other companies.
- Staged 6,767 source rows in **fii_lisoft_migration** on the separate
  **fii-postgres** validation container, not the live production PostgreSQL.
- Verified exact selected-row/value equality after PostgreSQL round-trip.
- Repeated the import: still 6,767 rows (idempotent).
- Parser tests cover quotes, delimiters inside strings, company filtering,
  credential exclusion and malformed column counts.
- Saved read-only live target snapshots for comparison. No live billing data,
  company license, user account or company setting was changed.

Staging retains raw source JSON records. It is not a native application ledger
import and does not populate tenant billing screens. Conversion is pending
resolution of the actual financial exceptions, not a blanket permission prompt.

## Selected totals and actual blockers

| Source type | Company 1 | Company 30 |
|---|---:|---:|
| Customer/vendor master rows | 69 | 52 |
| Products | 69 | 42 |
| Sales invoices, including cancellations | 899 | 626 |
| Customer receipt/settlement rows | 873 | 646 |
| Purchase bills | 61 | 0 |
| Supplier payment rows | 36 | 0 |
| Quotes | 144 | 201 |
| Invoice balance differences | 22 | 35 |

Each company has one reused sales invoice number shared by an active invoice
and a zero-value cancelled entry. Other duplicate bill numbers in preflight are
purchase numbers and must be checked per supplier rather than globally.
There are 87 reused customer-receipt numbers in company 1 and 4 in company 30;
same numbers alone do not prove duplicated payments. Receipt rows must not be
discarded solely because a receipt number repeats.

All line-less sales invoices in these selected companies are cancelled. The
single missing customer reference is on a zero-value cancelled FIRST IDEA
invoice. These can remain in the raw archive while agreeing on native cancelled
document handling. Existing native invoice numbers do not exactly match the old
numbers, but customer/product/transaction identity matching still needs review.

Financially material: 57 stored invoice remaining amounts differ from total less
linked receipts. FIRST IDEA also has receipts against cancelled invoices. Both
companies have bad-debt/kasar settlements; FIRST IDEA has TDS settlements. Treating
these as cash or inventing balancing adjustments would misstate the ledger.
Obtain authoritative customer outstanding reports and confirm the listed receipt
corrections/classifications before converting into live financial tables.

## Reproducible local commands

```powershell
python scripts/migration/audit_lisoft.py 'C:\Users\DINEZ17\Downloads\lisoft_billing (2).sql'
python scripts/migration/stage_lisoft.py 'C:\Users\DINEZ17\Downloads\lisoft_billing (2).sql'
python scripts/migration/reconcile_lisoft.py
python -m unittest discover -s scripts/migration -p 'test_*.py'
```

Before staging SQL, verify the selected Docker container and database are the
isolated validation instance. Run with `psql -v ON_ERROR_STOP=1`. Never execute
the MySQL dump in the live database. `review_lisoft.py` verifies a round-trip
export saved as `reports/migration/lisoft/staging-roundtrip.json` and creates
`migration-review.html` plus `verification.json`. Local source extracts,
financial details and generated SQL remain under git-ignored `reports/`.

Before the requested live reset, FIRST IDEA had 3 customers, 17 invoices,
8 payments, 2 products and 4 purchase bills. On 2026-10-27 the user requested
deleting its existing live records. The FII-only business reset completed after
successful backup restoration and rehearsal, preserving staff accounts,
company settings, license, financial years and numbering configuration. Linked
customer-portal, HR, expense and helpdesk operational records were included.
SKY NETWORK was hash-verified unchanged. Both tenants now have no customer,
product or financial transactions; the legacy migration remains pending.

Restorable pre-reset backup:
`backups/fii-reset-20261027/before-live-reset-final.dump`.
SHA-256: `1323DF8953C4EDB440CA7E9DFD6025D0993BF610513E772343CF72DF35B0A677`.
The exact deleted counts and preservation checks are recorded in
`backups/fii-reset-20261027/reset-result.json`. Audit history was retained and
the reset was recorded. Old FII outbox events were marked processed for each
worker so replay cannot recreate deleted business records.

Next: resolve the report's exceptions, convert into native models in a separate
application database copy, reconcile financial-year totals and party balances,
then perform a backed-up, traceable live import. Preserve source IDs, original
numbers, dates and fiscal-year membership throughout; do not send historical
notifications or replay inventory side effects as new business transactions.
