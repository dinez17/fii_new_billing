# Negative stock setting

Open Settings → Inventory → **Allow negative stock** and save the selection.
The setting belongs to the signed-in tenant and defaults to disabled.

- Enabled: sales, outward adjustments and purchase returns may take stock below zero.
- Disabled: outward stock movements that exceed available stock are rejected.
- Inward stock movements can replenish an existing negative balance in either mode.
- Turning the option off does not alter existing stock balances.

Validation occurs inside the same transaction as the document and stock
movement. Insufficient stock returns HTTP 409 with code `INSUFFICIENT_STOCK`
and a message naming the item, available quantity and requested quantity.
The rejected invoice, its number allocation and stock movements roll back.
Product rows are locked before reading and updating stock, so concurrent sales
cannot overwrite balances or bypass the disabled policy.

`PUT /api/v1/settings/group/INVENTORY` requires `settings:update` and accepts
`{"allowNegativeStock":"true"}` or `{"allowNegativeStock":"false"}`. Other
values return HTTP 400. The saved value is read for each relevant stock reduction.

Database verification: build `@fii/database`, enable `RUN_INTEGRATION_TESTS`,
and run `packages/database/test/stock-policy.integration.test.ts` against the
validation database. Seven cases cover policy transitions, tenant isolation,
concurrent sales, replenishment and full invoice rollback/posting.

Live API verification: `scripts/verify-stock-policy.mjs` uses an isolated
`stock-check-*` tenant and removes its records afterward. Set
`STOCK_TEST_SUPERADMIN_PASSWORD` before running it against the local Docker stack.
