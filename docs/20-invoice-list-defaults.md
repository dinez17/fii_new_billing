# Invoice list defaults

The tenant invoice page defaults to `status=OUTSTANDING` (UNPAID and PARTIAL),
the active financial year, its saved start date, and today's date in India.
It waits for the financial-year list before the first request. Explicit status
filters still include PAID, CANCELLED, individual statuses and all statuses.
Changing financial year resets From to that year's start; all FY clears From.
The filters remain editable and changes reset pagination to page 1.

The API keeps its existing unfiltered default when status/FY/date parameters
are omitted, preserving other callers such as payment allocation selectors.
`GET /api/v1/invoices?status=OUTSTANDING` filters both unpaid statuses. A
date-only `to=YYYY-MM-DD` includes that complete UTC date, matching stored
invoice dates. Timestamp upper bounds retain their precise supplied time.
List totals respect the complete filter and exclude cancelled invoices.

The list's Balance column uses the API decimal-string `balance`:
`max(grandTotal - amountPaid - creditedAmount, 0)`; cancelled invoices show zero.
The Paid column is removed from the list; payment details remain available.
