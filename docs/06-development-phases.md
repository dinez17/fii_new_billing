# Development Order — Phase by Phase

Each phase is shippable and tested before the next. Estimated for a 2–4 dev team.

## Phase 0 — Foundation (Week 1–2)
Monorepo + pnpm workspaces; docker-compose (Postgres, Kafka KRaft, Redis, MinIO); `packages/database` with full Prisma schema + migration + seed (permissions, system roles, default templates); `packages/common` (logger, errors, zod, money/GST utils, AES crypto); `packages/kafka` (producer/consumer wrapper, outbox relay); CI (lint, typecheck, test); api-gateway skeleton.
**Exit:** `docker compose up` boots everything; healthchecks green.

## Phase 1 — Auth, RBAC, Tenancy (Week 3–4)
auth-service: login/refresh/logout, bcrypt, RS256 JWT, role/permission CRUD, audit logs; tenant provisioning (create tenant + admin); Prisma tenant extension; admin-web shell: login, layout, permission-driven sidebar, protected routes, users & roles screens.
**Exit:** multi-tenant login works; permissions gate both API and UI.

## Phase 2 — CRM + Settings core (Week 5–6)
Customers, plans, subscribers, plan mapping; settings-service (company profile, number series, FY CRUD + activate/lock); customer portal user provisioning.
**Exit:** master data complete; number series + active FY functional.

## Phase 3 — Manual Invoicing + GST engine (Week 7–9)
Invoice CRUD with line items, GST calculator (CGST/SGST vs IGST, rounding), PDF generation (template with logo/signature/terms), invoice numbering, cancel flow; credit/debit notes; outbox + `invoice.created`.
**Exit:** GST-correct PDF invoices; numbers sequential per FY.

## Phase 4 — Payments + Ledger + Customer Portal (Week 10–12)
payment-service: manual payments, allocation, receipts; Razorpay + Cashfree order + webhook (signature verify, idempotent); ledger-worker (customer ledger, outstanding); customer-portal app end-to-end (view invoices, Pay Now, receipts).
**Exit:** full pay cycle: invoice → pay online → webhook → PAID → receipt → ledger.

## Phase 5 — Automated Subscription Billing (Week 13–14)
scheduler-service cron; billing-worker (prepaid 1st, postpaid month-end, duplicate prevention, BillingRun tracking, retry UI); due-date reminder job.
**Exit:** month roll generates all invoices exactly once; failures visible & retryable.

## Phase 6 — Notifications (Week 15)
notification-worker: SMTP/SMS/WhatsApp channels, templates, retries, logs; wire all events (invoice generated, payment received, due reminder, complaint assigned/resolved, low stock).
**Exit:** every domain event sends configured notifications; logs visible.

## Phase 7 — Purchase + Inventory + Expenses (Week 16–18)
Suppliers, PO → GRN → purchase invoice → supplier payment → returns; stock movements (purchase in, adjustment, low-stock alerts); expense module with receipt upload; supplier ledger via ledger-worker.
**Exit:** purchase cycle updates stock and supplier outstanding correctly.

## Phase 8 — Helpdesk (Week 19–20)
Complaints (portal + staff), assignment, status history, attachments, SLA; tasks + comments; complaint reports.
**Exit:** portal complaint → assign → resolve flow with notifications.

## Phase 9 — HR: Attendance + Payroll (Week 21–23)
Employees, departments, salary structure; attendance + leave with approvals; payroll generation (attendance-linked LOP, OT), mark-paid → auto expense + day book entry; payslip PDF.
**Exit:** monthly payroll ties into accounting automatically.

## Phase 10 — Accounting Reports + GST Reports + Day Book (Week 24–26)
Day book + daily closing; all reports (sales, purchase, collection, outstanding, statements, P&L, dashboard); GSTR-1/GSTR-3B/HSN/doc summary; report-worker (PDF/Excel/JSON export, async jobs).
**Exit:** GSTR-1 export matches invoice register; P&L reconciles.

## Phase 11 — Hardening & Launch (Week 27–28)
Load test billing worker (10k subscribers); security audit (OWASP, webhook replay, tenant-isolation tests); backup/restore drills; monitoring (pino → Loki, metrics, DLQ alerts); FY-lock enforcement tests; UAT.

**Dependency rule:** never start a phase whose events feed a worker that doesn't exist — stubs consume and log until built.
