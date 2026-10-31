# Legacy review approval

Settings → Legacy import supports review approval for held parent sales invoices (`user_bills`) and purchase invoices (`user_purchase_bills`). Select the source table and use the check icon. Review original source data first and enter a reconciliation note documenting verified totals, receipts, remaining balance and the treatment of discrepancies. Approval can be withdrawn with a reason.

Reading requires `backup:read`; approving or withdrawing also requires `backup:update`. Decisions are tenant-scoped, stored in the LEGACY_REVIEW_APPROVAL setting group and audited with the reviewer and timestamp. The parent archive row is locked while saving the decision. Child lines and receipts cannot be approved independently.

Approval is a review decision only. It does not mark the archive IMPORTED, release a financial hold, create invoices or receipts, post ledger/day-book entries, send mail, or change balances. An approved badge explicitly says “pending import”. A reconciled import must separately validate and post the complete document and its settlements atomically. The corrected-sales posting step is now available separately through Reconcile and post for approved held sales invoices; purchase holds and unsupported settlements remain held.

The toolbar check icon opens Approve all held invoices. This covers both parent invoice tables across all pages and filters for the current tenant. The confirmation requires a shared review note. Previously approved rows retain their original reviewer and note; each new approval is audited. The batch is atomic and does not import financial data.

## Corrected sales posting

Use Reconcile and post after approval. Verify the source customer mapping, invoice
items/taxes/total, every linked receipt, actual cash versus confirmed TDS, and the
expected balance. Preview is read-only. Posting requires the preview token, a
recent backup reference and explicit confirmation, and performs all invoice,
receipt, allocation, ledger/daybook and archive-status writes atomically. No email
or stock movements are emitted. Invoice/receipt duplicates, stale previews,
incomplete receipt sets, cancelled source invoices and locked historical years
are rejected. The backup reference is recorded evidence supplied by the operator,
not proof that this API has verified a physical backup file. Existing source rows
are retained; corrected totals and the reviewer note are audited.
