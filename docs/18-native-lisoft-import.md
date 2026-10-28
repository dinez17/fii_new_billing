# Native Li-Soft historical import

The user explicitly selected the policy: **hold conflicting invoices and their
receipts for correction; import consistent records**. The source and tenant
mapping are pinned by SHA-256 and UUID in the migration scripts. No other old
company is imported and no live staff account, password, role or license is
replaced. Only blank company-profile fields are filled from source metadata.

## Contents and treatment

- Native customer/supplier identities are inferred from their source role and
  actual document references; a party used in both roles has separate records.
- Missing phones are NULL. Shared/invalid source contacts remain in altPhone,
  notes and the immutable source archive. No fabricated phone numbers or forced
  identity merges are used. Existing unique non-null phone checks remain.
- Consistent invoices, items, receipts, purchase bills, supplier payments and
  allocations retain their original dates and stored amounts. All totals and
  allocations are checked before commit. Ledger/day-book rows are created once,
  with original business dates, without publishing new-business events.
- Financial years are derived from the source dates. Past years are locked;
  original FY codes and document numbers remain. Reused receipt references get
  a traceable internal `~L<old-id>` suffix; original numbers remain in references
  and archived source data.
- Balance conflicts, TDS/write-offs without native classifications, incomplete
  credit-note references, unsupported references and duplicate financial numbers
  stay unposted. Their linked receipts/lines remain with them in review.
- Product stock is copied as a snapshot dated the backup day, including negative
  stock. Historical movements and historical stock valuation cannot be certified
  from this backup. Historical purchases/sales are not replayed into current stock.
  Period-denominated products are classified as services and explicitly noted.
- Quotes and every other selected source row are retained in `LegacyRecord`.
  There is no native quotation module. Old file paths do not supply logo/signature
  image files. The source outstanding snapshot is not added again as an opening
  balance on top of transaction history.
- No legacy passwords, portal users, recurring subscriptions or auto-billing
  schedules are imported. Portal access starts disabled. The scheduler excludes
  imported historical invoices from automatic reminder campaigns; explicit manual
  invoice emails remain possible.

## Tenant review UI and contract

Settings → Legacy import requires `backup:read`. It shows native counts,
financial years, limitations, held documents and paginated immutable originals.
Held records are excluded from financial reports; the UI warns that the posted
subset is not a complete historical closing balance.

- `GET /api/v1/settings/legacy-imports/summary`
- `GET /api/v1/settings/legacy-imports/records?page=1&limit=25&status=REVIEW`
  Optional `sourceTable` and search of source ID/review reason.
- `GET /api/v1/settings/legacy-imports/records/:id`

All endpoints derive tenant ownership from authenticated claims, require staff
backup-read permission, return no-store responses, and return 404 for foreign
record IDs. No archive mutation endpoint is provided. Credential tables were
excluded before archiving.

## Execution and checks

`prepare_native_lisoft.py` creates the deterministic packet under ignored
`reports/migration/lisoft/`. `import-native-lisoft.mjs --rehearse` targets only
`fii_legacy_native_check_20261027`. Live `--apply` targets only `fii_billing`,
requires the verified packet and pre-import backup hashes, and runs the two
companies atomically. It aborts if the target is nonempty, the mapping changed,
licensed customer limits would be exceeded, preserved settings/accounts change,
or totals/allocations/source values fail verification. Repeating the exact packet
performs verification and does not duplicate rows. A different packet requires
an explicit follow-up migration.

The additive migration `20261027140000_legacy_import` adds the source archive and
allows missing customer phones. Deploy updated Prisma clients to all backends
before loading nullable customer contacts. No account seeding is needed.

Verification performed: source staging round-trip (6,767 rows), seven Python
migration checks, full unit/integration suites, native import rehearsal and
idempotent rerun. Exact live result and backup hashes are recorded in ignored
`backups/lisoft-import-20261027/` and `reports/migration/lisoft/`.

## Completed live result (2026-10-27)

| Native data | FIRST IDEA | SKY NETWORK |
|---|---:|---:|
| Customers | 60 | 52 |
| Suppliers | 15 | 0 |
| Products | 69 | 42 |
| Invoices, including native cancelled history | 850 | 588 |
| Payments/receipts | 793 | 551 |
| Purchase invoices | 55 | 0 |
| Supplier payments | 36 | 0 |
| Held financial documents | 55 | 38 |
| Immutable source rows | 4,015 | 2,752 |

FIRST IDEA history covers FY 2020-21 through 2026-27; SKY covers FY 2024-25
through 2026-27. Held counts include 49 FII sales invoices and six purchase
documents, and 38 SKY sales invoices. These encompass the 57 balance differences
plus TDS/write-off, incomplete credit-note and repeated-reference exceptions.
Every selected source record remains in its tenant archive. Browser checks
confirmed the review list, immutable original details and FY 2020-21 invoices.
Live checks also confirmed counts, tenant boundaries and a historical invoice
PDF for a customer without a phone. The generated final report is
`reports/migration/lisoft/import-completion.html`.
