# Customer and supplier lists

`GET /api/v1/customers` and `GET /api/v1/suppliers` accept existing `page`,
`limit` and literal `search` (name, code, phone), plus:

| Query | Values | Default |
| --- | --- | --- |
| activity | all, active, inactive | all |
| balance | all, due, settled, credit | all |
| sortBy | outstanding, invoiceCount, name, code, status, createdAt | Existing API default: customers createdAt, suppliers name |
| order | asc, desc | Existing API default: customers desc, suppliers asc |

The two UI pages default to outstanding descending. Changing a filter or sort
resets the page to 1. Filters combine with search. Balances and invoice counts
are aggregated for the authenticated tenant before sorting and pagination;
ties use name then ID. `total` counts the filtered records.

Each item adds `invoiceCount`, decimal-string `currentOutstanding`, and
`heldInvoiceCount`. For customers, `invoiceCount` counts only non-cancelled
invoices whose `grandTotal - amountPaid - creditedAmount` is positive.
`currentOutstanding` sums those remaining amounts (floored at zero per invoice),
across all financial years. Paid and fully credited invoices do not count.
The separate `ledgerOutstanding` field preserves opening + debits − credits;
the Ledger action still displays the full ledger. Customer credit balance
filtering is omitted from the UI because invoice balances are nonnegative.
Supplier counts and opening + credits − debits payables remain unchanged.
Held legacy documents are excluded and compact warning tooltips remain visible.

All paginated list screens offer 10, 20, 25, 50 or 100 rows, store the preference
locally, include size in query keys and reset to page 1 on size changes.
Complete read-only tables use local pagination; report print views retain all
rows. Editable entry grids are not sliced. Row actions use accessible icon
buttons with tooltips. Billing runs now accept validated `page` and `limit`
and return `{ items, total, page, limit }` rather than truncating at 50 records.

Existing list authorization and tenant isolation apply. The supplier API uses
a separate list schema so purchase-invoice status queries keep their existing
UNPAID/PARTIAL/PAID/CANCELLED meaning.
