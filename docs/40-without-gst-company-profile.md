# Without-GST company profile

Settings > Without-GST company stores an optional separate company/business name, legal name, address, state code, pincode, phone, email, PAN, logo, signature and bank details. Enable the separate profile and save to use it on without-GST invoice PDFs in all nine formats and email PDF attachments.

The settings group NON_GST_COMPANY is tenant scoped and requires existing settings read/update permissions. Saving validates all supplied and existing values before an atomic transaction. Company name is required when enabled. GSTIN is not accepted in this profile. Disabling keeps the saved details for later re-enabling.

While enabled, blank profile fields stay blank; GST bank details and branding are never inherited. An incomplete enabled profile is rejected when generating a PDF. Missing/disabled profiles keep the original company behavior. Invoice ownership, numbering, registers, balances, customer accounts and reports remain with the tenant. Changing profile details affects subsequent PDF generation, including existing invoices.

Receipts allocated exclusively to without-GST invoices and related credit/debit note PDFs use the separate profile. Mixed-register and unallocated receipts retain the primary tenant profile. SMTP configuration and sender authentication remain configured separately.

No database migration is required; existing Setting rows are included in tenant backups. Tests cover profile validation, selection, GST isolation, blank-bank handling, all nine invoice formats, receipt and note identity, mixed receipts, atomic saving and tenant isolation. Receipt absolute-layout PDFs use zero document margins so the fixed footer remains on one page.
