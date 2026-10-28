# Active customer picker and FY Day Book

The subscriber picker requests `activity=active` before pagination and strictly renders only records with `isActive === true`. Each returned option is explicitly labelled Active. The FII customers shown in the reported screenshot are saved as Active; the user confirmed those stored statuses should remain unchanged. Live checking found 32 active customers and no inactive records in that API result. No customer status was changed for this correction.

Day Book opens in Financial year / period mode, selecting the saved active FY from its start through today's India date. GET `/day-book` without a `date` supports `fyCode`, `from`, `to`, `page`, and `limit`; totals cover the whole filtered period while rows are paginated. Opening balance carries prior closing/entries forward. Date boundaries are inclusive and queries are tenant-scoped. CSV exports use the same FY/date bounds and include a dd-mm-yyyy date column.

Single day mode retains the existing explicit `date` API. Close day is shown only in that mode. Manual entries have an explicit entry-date control and still use the existing closed-day checks.
