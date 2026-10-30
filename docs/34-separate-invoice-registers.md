# GST and without-GST invoice registers

The invoice page defaults to the GST register and supports Without GST and All invoices. Status, financial-year, search and date filters apply within the selected register. Creating from a register preselects its mode. A selected subscriber supplies its GST setting; standalone manual invoices allow either mode.

GST invoices retain the existing INVOICE number series. New without-GST invoices use NON_GST_INVOICE, default prefix `NG/<financial-year>/`, with their own counter per tenant and year. Settings → Number series can edit its prefix/padding after the series is first allocated. Existing numbers are never rewritten. Zero-rated GST invoice lines remain in the GST register; register membership comes from the saved chargeGst flag, not the numeric tax total.

The invoice register cannot change on edit; cancel and create in the correct register if necessary. Invoice PDFs identify without-GST documents as INVOICE - WITHOUT GST instead of TAX INVOICE. Existing customer GST treatment is preserved.

Both registers continue to use the same invoice/payment/ledger workflows and combined customer balances and financial reports. This separation does not exclude either register from accounting. Statutory GST report classification remains governed by the existing reporting logic and is not changed by this feature.

Apply the NON_GST_INVOICE DocType enum migration before deploying the backend and billing worker. Rebuild the shared backend image, tenant web application and PDF package. No existing invoices or ledger postings are migrated or renumbered.
