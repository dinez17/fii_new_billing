# Customer numbering and subscriber purchase-order references

FII customer-code synchronization uses its saved CUSTOMER/PERM NumberSeries
prefix and padding. Already conforming codes remain; legacy codes receive
unused numbers from the saved sequence. The operation locks tenant and series,
preserves customer IDs and references, advances the series, and retains an
old/new code audit mapping. Review holds now link through archived customer IDs
instead of relying on the mutable display code. The operation is FII-only.

Customer list defaults: active, balance due > 0, outstanding descending. Reset
filters restores those defaults; supplier defaults are unchanged.

Subscriber create/update accepts optional `poNumber` (trimmed, at most 100
characters). Empty/null clears it; an omitted field on an update preserves it.
New subscribers have a PO field, and Manage subscriber allows later updates.

Billing-worker subscription invoices snapshot the subscriber PO. Manual invoices
can select a customer-owned subscriber and snapshot its PO too. Cross-customer
or cross-tenant subscriber references are rejected. Issued invoice PO snapshots
remain unchanged when the subscriber changes; retrying billing does not rewrite
existing invoices. Invoice list/detail and PDF show the saved PO; PDFs include
both the billing period and PO, with wrapped long values.
