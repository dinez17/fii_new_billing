# Customer TDS deductions

Record Payments → Record payment with actual money received, TDS deducted and optional TDS section/reference. Allocate cash and TDS separately to the customer's invoices. Every rupee of TDS must be allocated; cash may remain on account. Auto-allocation applies available cash first, then TDS to invoice balances, oldest first; adjust the allocation to match the customer's advice. The combined settlement cannot exceed an invoice balance. Zero cash with positive allocated TDS supports a separately confirmed deduction against a remaining balance. Existing payments are not edited or inferred as TDS.

Example: an invoice balance of 11,800 is settled by 11,600 money received and 200 TDS. Payment.amount and allocation.amount remain actual cash; Payment.tdsAmount and allocation.tdsAmount are non-cash deductions. Invoice.amountPaid is the combined settlement. Customer outstanding therefore decreases by 11,800 while collections and daybook increase by 11,600. The ledger worker atomically posts the combined customer credit and only the cash daybook movement. TDS-only entries produce no daybook cash movement. Invoice locking prevents concurrent over-settlement. Existing gateway payments default to zero TDS.

Payments → TDS report defaults to the active financial year and shows the full selected financial year, customer code/name/GSTIN/contact details, entry count, customer TDS totals and grand total. It is independent of the payment-list from/to dates. Only successful payments for the authenticated tenant and selected FY are included. The fiscal year is assigned from the validated payment date at creation. Existing and held legacy deductions are not inferred. Endpoint: GET /api/v1/payments/tds-report?fyCode=2026-27 (payment:read); optional customerId filter. Report responses are no-store.

Receipt PDFs show cash and TDS separately and the combined settlement. Sales collection totals exclude TDS. Balance sheet includes recorded successful deductions as TDS receivable; this feature does not reconcile tax-credit statements, record refunds or clear TDS against income-tax liabilities. Recorded deductions are not proof of tax deposit/credit. No rate is assumed or calculated automatically.

Migration 20261031000100_customer_tds adds default-zero TDS fields and an optional reference. It does not change historic balances, receipts or imported review holds. Tenant backups include the new fields under the existing schema-version checks; backups from a different schema require the corresponding software version to restore.


TDS report → Review credits lists the individual successful deductions. Record
verified credit, a certificate/statement reference, confirmed date and review note;
optionally attach a PDF up to 500 KB. Evidence is encrypted in the tenant's
TDS_RECONCILIATION settings and read only through payment-authorized endpoints.
Verified credit cannot exceed the deduction. This review does not change cash,
customer outstanding or TDS receivable, and does not implement tax clearing.

Successful manual receipts can be reversed with payment:update and a required
reason, in their active unlocked financial year. The original receipt/allocations
remain for audit, invoice settlements are reduced by cash plus TDS, and opposite
ledger/daybook entries correct the original date. The stored REFUNDED status is
labelled Reversed / refunded; receipt PDFs are marked invalid. Gateway refunds
must be confirmed separately and are not performed by this correction endpoint.
