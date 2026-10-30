# Business overview and Studio design

The dashboard now presents billing/collection highlights, a six-month comparison, active-FY totals, invoice ageing, customer balances to follow up, recent successful receipts, customer/subscriber counts, open quotations/proformas, recorded expenses, purchase bills and operational alerts. Data refreshes every minute and can be refreshed manually. Empty, loading, error and missing-FY states are explicit; refresh failures retain the last result and its timestamp.

`GET /api/v1/reports/dashboard` retains authentication and `report:read`. Responses use `Cache-Control: no-store`. All queries are tenant-scoped and run in one repeatable-read transaction. The response adds detailed metrics while retaining the original five KPI fields for compatibility.

Billing totals include GST and without-GST issued invoices, excluding DRAFT and CANCELLED records. Active-FY figures respect the active FY code and date range. Invoice/expense/purchase dates retain their calendar-date semantics. Payment timestamps use Asia/Kolkata day/month boundaries. The six-month chart is a gross billing/cash-collection comparison, not profit. Expenses include RECORDED entries only; purchase totals exclude cancelled bills.

Customer outstanding follows customer-master balance semantics: opening balance + positive invoice balances (after payments and credits) − unapplied successful payments, computed per customer before summing positive balances. Customer credits are shown separately so one customer's credit does not conceal another customer's debt. Inactive customers' debt remains included. Outstanding spans all financial years; invoice ageing excludes opening balances and unapplied receipts. Held legacy invoices are excluded and flagged. Quotations and proformas are shown as proposed values and never included in billing or receivables.

Studio is a new neutral light design. It uses the self-hosted Inter variable font, obtained from the official Inter project with its SIL Open Font License in each frontend's `public/fonts/Inter-LICENSE.txt`. No font service is contacted by users' browsers. A one-time appearance-version update selects Studio/Inter; users can subsequently choose any theme or font in Appearance.

Integration tests cover Indian midnight, active financial years, GST/without-GST totals, opening amounts, unapplied receipts, credits, draft/cancelled records, tenant isolation, expenses, subscriptions, stock alerts and empty states. Browser checks cover 360px, 390px, 768px and desktop layouts with the actual bundled font.

## Portal activation password

Enabling portal access now opens a dialog showing the primary login email, password, confirmation and optional password visibility. Every enablement, including re-enablement, requires a chosen password. Disabling does not require one. Missing primary email or inactive customers block enablement. New customers start with portal access disabled, and a stored flag without an active customer login is displayed as off.

The existing `POST /customers/:id/portal-access` contract now requires `password` when `enable` is true. Passwords require at least eight characters and at most 72 UTF-8 bytes for bcrypt. The account, password hash and customer flag change atomically, and refresh sessions are revoked. Previously issued access tokens remain subject to their normal short expiry and active-user checks. Passwords are never returned or logged; audit records contain only enabled/password-changed flags. Staff permissions, tenant isolation, duplicate-email protection and existing MFA configuration remain intact.
