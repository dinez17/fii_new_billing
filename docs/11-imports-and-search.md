# Imports and searchable selections

## Keyboard navigation

All three consoles support Enter to advance through visible editable fields,
and Shift+Enter to return to the previous field. Disabled, hidden and read-only
fields are skipped. Navigation stays within the current form or modal; at the
last field it focuses the primary action button without submitting the form.
Buttons keep their normal Enter action. In searchable fields, Enter first
selects an open result; press Enter again to advance. Textareas keep newline
entry, file pickers retain their native action, and task comments retain their
explicit send-on-Enter action. Modifier shortcuts and input-method composition
are preserved.

Tenant administrators can import new products, customers and plans from each
module's **Import CSV** button. The control requires that module's create
permission.

1. Download the module's template and replace its example row with your data.
2. Save as UTF-8 CSV. Preserve phone numbers, state codes, pincodes and SKUs as
   text in spreadsheet software. Files support quoted commas and multiline text.
3. Select the file (maximum 1,000 rows / 2 MB), then **Validate & preview**.
4. Review row errors and click **Import ready rows**. Invalid rows are excluded.
5. Download the results report. Fix rejected rows and import a new file.

Imports create new records; they never overwrite existing records. Duplicate
product SKUs, customer phone numbers and plan codes are rejected. Product SKUs
and plan codes are compared in uppercase. Blank optional cells use the normal
creation defaults. Set `isService` to `true` or `false` for products. Do not
include tenant IDs or internal record IDs in CSV files.

Customer limits and GST validation apply during creation. Product opening stock
creates an opening stock movement atomically with the product. Reimporting an
existing SKU does not add opening stock again.

The UI submits batches of 50 rows and shows progress. Stop takes effect after
the current batch. If a write request is interrupted, its rows are marked
unknown because some may have saved. Preview the original file again: saved
records will be reported as duplicates. No write request is automatically retried.

## Search and product creation

Customer and supplier fields search by name/code, and customer/supplier phone.
Product fields search by name/SKU. Search is debounced and runs on the server,
so records beyond the first 100 are reachable. Up to 50 matches are shown;
refine the input if there are more. The controls support arrow keys, Enter,
Escape, clearing and restoring a selected ID when editing/prefilling a document.

The fields are used in sales invoices, purchase bills, purchase orders,
payments, subscriber creation, complaints and customer/supplier ledgers.
Product selection offers **Create product** if the typed name/SKU has no exact
match and the user has `product:create`. Confirm the SKU, prices, GST, unit and
opening stock in the creation form. **Create & select** saves the product and
fills the document line with its saved prices and tax details. Cancelling keeps
the current document intact.

## API contract

`POST /api/v1/products/import`, `/api/v1/customers/import`,
`/api/v1/plans/import` require the corresponding create permission. They accept:

```json
{ "dryRun": true, "rows": [{ "sku": "ROUTER-01", "name": "Router", "salePrice": "1500" }] }
```

`dryRun` defaults to true. Each request contains 1–100 row objects using the
normal create endpoint fields. A dry run performs no writes. Replies contain
`results` with one-based `row`, `status` (`ready`, `created`, or `error`),
optional created `id`, and validation/duplicate `message`. Row errors do not
roll back previously successful rows. Unexpected server failures return a
non-success HTTP response; clients must reconcile saved rows before retrying.
The tenant always comes from the authenticated session.

`GET /api/v1/products/:id` and `GET /api/v1/suppliers/:id` hydrate selected
records and require the corresponding read permission. Cross-tenant IDs return
404. Existing list endpoint `search`, `page`, and `limit` parameters drive the
search fields.

Run parser and import validation tests with:
`pnpm exec vitest run packages/common/test/bulk-import.test.ts`.
The live verification script `scripts/verify-bulk-workflow.mjs` creates and
cleans up an isolated `bulk-check-*` tenant. It requires
`BULK_TEST_SUPERADMIN_PASSWORD` and verifies previews, imports, search past 100
records, opening stock, duplicates, quotas, identifier preservation and tenant
isolation against the local Docker deployment.
