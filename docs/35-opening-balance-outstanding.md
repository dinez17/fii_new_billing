# Customer opening balances in the list

The customer list's balance to pay includes the saved opening balance plus remaining balances on non-cancelled invoices, less successful receipt amounts not allocated to an invoice. Allocated payments are already reflected in invoice amounts paid and are not deducted twice. Failed/refunded payments do not reduce the displayed balance.

Due-invoice counts still count only actual invoices with a positive remaining balance. An opening-only customer can therefore show a positive balance with zero due invoices. Outstanding filters and sorting use the complete calculation before pagination. Negative results remain customer credits. Supplier calculations are unchanged.

This is a shared database-package query fix; no database migration or balance rewrite is required. Rebuild the backend image and restart CRM to update the customer list.
