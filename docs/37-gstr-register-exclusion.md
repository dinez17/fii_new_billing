# GSTR reports use the GST invoice register

GSTR-1 and GSTR-3B outward supplies use Invoice.chargeGst=true. Without-GST invoices and notes linked to them are excluded from the summaries, HSN rows, document counts, offline CSV sections/workbook and queued GSTR report exports. The saved invoice mode is authoritative; a zero-percent line on a GST-register invoice remains reportable in this application's GST reports.

Purchase/expense input-tax calculations are unchanged. Customer balances, sales reports, ledgers, profit and loss and balance sheets retain both registers. No invoice data is deleted or rewritten. Rebuild/restart accounting-service and update the report-worker image; no migration is required. Previously generated export files are snapshots and must be regenerated to use the new filter.
