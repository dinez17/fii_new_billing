# React Apps — Pages & Modules

Stack: React 18 + Vite + TypeScript, React Router, TanStack Query (server state), Zustand (auth), React Hook Form + Zod, Tailwind + shadcn/ui, Recharts.

## Route/permission guard
- `<ProtectedRoute permission="invoice:read">` wraps each route; permissions come from `/auth/me`, cached in auth store.
- Sidebar config: array of `{label, icon, path, permission, children}` — rendered only if permission present. Same source drives route registration.
- Axios interceptor: on 401 → call `/auth/refresh` once → retry; on refresh failure → logout.

## admin-web pages

| Module | Pages |
|---|---|
| Auth | Login, Forgot/Change Password |
| Dashboard | KPI cards (today's collection, MTD sales, outstanding, open complaints, low stock), collection trend chart, recent invoices/payments |
| Customers | List, Create/Edit, Detail (tabs: profile, subscribers, invoices, payments, ledger, complaints), Portal access toggle |
| Plans | List, Create/Edit |
| Subscribers | List (filter: type/status/plan), Create/Edit, Plan change dialog, Suspend/Activate |
| Invoices | List (status/date/customer filters), Create/Edit (line items, GST auto-calc, discount), Detail + PDF preview, Cancel |
| Billing Runs | List, Detail (progress, failed items, retry), Manual trigger |
| Credit/Debit Notes | List, Create-against-invoice, Detail |
| Payments | List, Record payment (allocate to invoices), Receipt PDF |
| Suppliers | List, Create/Edit, Detail (ledger, outstanding, invoices) |
| Purchases | PO List/Create, GRN Create, Purchase Invoice List/Create, Purchase Return, Supplier Payment |
| Inventory | Product List/Create/Edit, Stock Adjustment, Movements log, Low-stock view, Item-wise report |
| Expenses | Category/Vendor masters, Expense List/Create (receipt upload), Monthly report |
| GST | GSTR-1 view (section tabs: B2B/B2C/CDNR/HSN/Docs), GSTR-3B summary, Export buttons |
| Reports | Sales, Purchase, Collection, Outstanding, Customer/Supplier statement, P&L, Day/Month-wise — all with date/FY/party filters + PDF/Excel export |
| Day Book | Daily view (opening/in/out/closing), Manual entry, Close-day action |
| Financial Year | List, Create, Activate, Lock |
| Employees | List, Create/Edit (salary structure builder), Detail |
| Attendance | Daily marking grid, Check-in/out, Monthly report, Leave requests + approval |
| Payroll | Generate (month picker), Run detail (payslip table), Payslip detail + mark-paid + PDF |
| Complaints | List (status/priority/assignee filters), Create, Detail (timeline, attachments, assign, status change), Daily/SLA/pending reports |
| Tasks | Board/List, Create, Detail (comments), My tasks (technician view) |
| Settings | Company profile, Invoice settings (logo/signature/terms/series), GST, SMTP/SMS/WhatsApp, Payment gateways, Notification templates, Users & Roles, Audit log viewer |

## customer-portal pages
Login → Dashboard (outstanding card, Pay Now) → My Invoices (list + PDF) → Pay (gateway checkout, success/failure pages) → Payment History + Receipts → My Complaints (raise, track timeline) → Profile.
