# Legacy review approval

Settings → Legacy import supports review approval for held parent sales invoices (`user_bills`) and purchase invoices (`user_purchase_bills`). Select the source table and use the check icon. Review original source data first and enter a reconciliation note documenting verified totals, receipts, remaining balance and the treatment of discrepancies. Approval can be withdrawn with a reason.

Reading requires `backup:read`; approving or withdrawing also requires `backup:update`. Decisions are tenant-scoped, stored in the LEGACY_REVIEW_APPROVAL setting group and audited with the reviewer and timestamp. The parent archive row is locked while saving the decision. Child lines and receipts cannot be approved independently.

Approval is a review decision only. It does not mark the archive IMPORTED, release a financial hold, create invoices or receipts, post ledger/day-book entries, send mail, or change balances. An approved badge explicitly says “pending import”. A reconciled import must separately validate and post the complete document and its settlements atomically. This release does not implement that financial posting step.

The toolbar check icon opens Approve all held invoices. This covers both parent invoice tables across all pages and filters for the current tenant. The confirmation requires a shared review note. Previously approved rows retain their original reviewer and note; each new approval is audited. The batch is atomic and does not import financial data.
