# Consistent financial transaction filters

Payments, purchase invoices, purchase orders, purchase returns, expenses and
credit/debit notes now use the same active-FY and date-range controls as invoices.
From defaults to the selected year's start and To defaults to today's India
date. Selecting All FY clears From; dates remain editable. Changes reset page 1
and all filter values participate in query keys. Initial list requests wait for
the year defaults when the user has financial-year read access.

Validated optional `fyCode`, `from`, `to` parameters use each record's own year
and business date: paymentDate, invoiceDate, orderDate, returnDate, expenseDate,
or noteDate. Date-only To values include the entire day. Existing API callers
that omit these filters keep their unfiltered behavior. Tenant scope remains.

Status choices are appropriate to each module. Purchase invoices default to
OUTSTANDING (UNPAID/PARTIAL), payments and notes offer all statuses, orders
offer their workflow states, and expenses default to RECORDED with ALL and
CANCELLED choices. Returns have no status field. Master pages are not date-bound.

Invoice Billed/Collected and payment Collected summaries were removed from
their filter bars. API aggregate fields remain available. Filter bars wrap
instead of requiring horizontal scrolling. Editable payment allocation invoice
lookups remain independent of the page's period filters.
