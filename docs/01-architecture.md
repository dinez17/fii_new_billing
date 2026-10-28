# FII Billing — System Architecture

Multi-tenant SaaS ERP + Billing + CRM + Helpdesk + Accounting for Indian subscriber-based SMBs.

## 1. High-Level Architecture

```
                        ┌─────────────────────────────┐
                        │   React SPA (Admin/Staff)    │
                        │   React SPA (Customer Portal)│
                        └──────────────┬───────────────┘
                                       │ HTTPS
                        ┌──────────────▼───────────────┐
                        │        API GATEWAY            │
                        │  (routing, JWT verify, rate   │
                        │   limit, tenant resolution)   │
                        └──────┬───────────────────────┘
        ┌──────────┬───────────┼───────────┬─────────────┬──────────┐
        ▼          ▼           ▼           ▼             ▼          ▼
   auth-svc    crm-svc    billing-svc  payment-svc  purchase-svc  inventory-svc
        ▼          ▼           ▼           ▼             ▼          ▼
   expense-svc accounting-svc hr-svc  helpdesk-svc  settings-svc
        │          │           │           │             │
        └──────────┴─────┬─────┴───────────┴─────────────┘
                         ▼
              ┌────────────────────┐          ┌─────────────────────┐
              │   PostgreSQL 16    │          │    Kafka (KRaft)     │
              │ (schema-per-service│◄────────►│  events + workers    │
              │  single cluster)   │          └──────────┬──────────┘
              └────────────────────┘                     ▼
                                            ┌─────────────────────────┐
                                            │ WORKERS (Kafka consumers)│
                                            │ billing-worker           │
                                            │ notification-worker      │
                                            │ report-worker            │
                                            │ ledger-worker            │
                                            │ scheduler (cron producer)│
                                            └─────────────────────────┘
              Redis (cache, rate-limit, idempotency keys, refresh-token denylist)
              S3-compatible storage (MinIO) — PDFs, receipts, attachments
```

## 2. Service Catalog

| Service | Port | Owns (domain) |
|---|---|---|
| api-gateway | 8080 | Routing, JWT verification, rate limiting, tenant header injection |
| auth-service | 8081 | Tenants, users, roles, permissions, sessions, audit logs |
| crm-service | 8082 | Customers, subscribers, plans, plan mapping |
| billing-service | 8083 | Invoices, credit/debit notes, billing periods, number series |
| payment-service | 8084 | Payments, Razorpay/Cashfree orders, webhooks, receipts |
| purchase-service | 8085 | Suppliers, POs, GRN, purchase invoices, returns, supplier payments |
| inventory-service | 8086 | Products, stock movements, adjustments, low-stock alerts |
| expense-service | 8087 | Expense categories, vendors, expenses |
| accounting-service | 8088 | Ledger, day book, financial years, GST reports, P&L, statements |
| hr-service | 8089 | Employees, departments, attendance, leave, payroll |
| helpdesk-service | 8090 | Complaints, tasks, SLA, status history |
| settings-service | 8091 | Company profile, gateway/SMTP/SMS/WhatsApp configs (encrypted), templates |
| billing-worker | — | Consumes `billing.generate`, mass-generates invoices |
| notification-worker | — | Consumes `notification.send` + domain events → email/SMS/WhatsApp |
| report-worker | — | Async heavy PDF/Excel generation → S3 → signed URL |
| ledger-worker | — | Consumes financial events → posts ledger + day book entries |
| scheduler-service | — | Cron: 1st-of-month prepaid, month-end postpaid, due reminders, FY jobs |

**Pragmatic microservices decisions (important):**
- **One PostgreSQL cluster, one logical DB, single shared Prisma schema** published as an internal package (`packages/database`). Each service writes only to its own tables (enforced by convention/code review), but reads may join. This avoids distributed-transaction pain while keeping services independently deployable. True DB-per-service can come later.
- **Sync inter-service calls are avoided.** Services communicate via Kafka events. The rare sync need (e.g., gateway → auth for token introspection) uses JWT verification locally with a shared public key (RS256) — no network hop.
- **Saga pattern via Kafka** for multi-service flows (payment success → invoice update → receipt → ledger → notification).

## 3. Multi-Tenancy

- Model: **shared database, shared schema, `tenantId` column on every tenant-owned table**.
- Tenant resolution: subdomain (`acme.fiibilling.in`) or `X-Tenant-Id` claim inside JWT. Gateway validates and forwards `tenantId`; services NEVER trust a client-supplied tenant id — only the JWT claim.
- Enforcement: a Prisma **client extension** injects `where: { tenantId }` on every query and `data: { tenantId }` on every create. Optionally enable Postgres **Row-Level Security** with `SET app.tenant_id` per request as defense-in-depth.
- Per-tenant: number series, FY, GST settings, gateway credentials, templates, branding.
- Plans/limits per tenant (subscription tiers of the SaaS itself) live in `Tenant` + `TenantSubscription`.

## 4. Authentication & RBAC

- **JWT (RS256)**: access token 15 min; refresh token 7–30 days, rotated on every use, stored hashed in DB, revocable (denylist in Redis).
- Token claims: `sub`, `tenantId`, `userType` (ADMIN_STAFF | CUSTOMER), `roleIds`, `permVersion`.
- **RBAC**: Role → Permission (module + action, e.g. `invoice:create`). Permissions cached in Redis keyed by `tenantId:roleId:permVersion`; bumping `permVersion` invalidates instantly.
- Middleware chain: `authenticate → resolveTenant → authorize(permission) → ownDataGuard` (customers can only access rows where `customerId = jwt.customerId`).
- Frontend: permission list returned at login → sidebar + route guards derive from it.
- Audit log: login/logout, failed logins, and every mutating action on financial entities (who, what, before/after JSON, IP, tenant).

## 5. Security Summary

- bcrypt (cost 12) for passwords; separate credential tables for staff vs customers.
- Webhook signature verification (Razorpay `X-Razorpay-Signature` HMAC-SHA256, Cashfree signature) + idempotency key per webhook event id.
- Secrets at rest: AES-256-GCM envelope encryption for gateway keys/SMTP passwords (per-tenant data key wrapped by master key from env/KMS).
- Helmet, CORS allowlist, rate limiting (Redis sliding window), input validation with Zod on every endpoint, Prisma (no raw SQL without parameterization).
- All money stored as `Decimal(14,2)`; GST rates as `Decimal(5,2)`. Never floats.

## 6. Kafka Topic List

All events carry envelope: `{ eventId (uuid), tenantId, occurredAt, actorUserId, version, payload }`. Partition key = `tenantId` (ordering per tenant). Consumer groups per worker. Dead-letter topic per consumer: `<topic>.dlq`.

| Topic | Producer | Consumers |
|---|---|---|
| billing.generate | scheduler-service | billing-worker |
| invoice.created | billing-svc/worker | notification-worker, ledger-worker |
| invoice.paid | payment-svc | billing-svc, ledger-worker, notification-worker |
| payment.initiated | payment-svc | audit |
| payment.success | payment-svc (webhook) | billing-svc, ledger-worker, notification-worker |
| payment.failed | payment-svc | notification-worker |
| receipt.generated | payment-svc | notification-worker |
| complaint.created | helpdesk-svc | notification-worker |
| complaint.assigned | helpdesk-svc | notification-worker |
| task.created | helpdesk-svc | notification-worker |
| task.completed | helpdesk-svc | notification-worker |
| purchase.invoice.created | purchase-svc | inventory-svc (stock in), ledger-worker |
| supplier.payment.paid | purchase-svc | ledger-worker |
| expense.created | expense-svc | ledger-worker |
| payroll.generated | hr-svc | notification-worker |
| salary.paid | hr-svc | ledger-worker (auto expense + day book) |
| stock.updated | inventory-svc | notification-worker (low-stock alert) |
| notification.send | any service | notification-worker |
| gst.report.generated | report-worker | notification-worker |
| report.requested | any service | report-worker |

**Reliability:** transactional outbox pattern — events written to `OutboxEvent` table in the same DB transaction as the business change; a relay polls/publishes to Kafka. Consumers are idempotent (processed `eventId` table).

## 7. Worker Service Design

### billing-worker
1. Scheduler publishes `billing.generate` per tenant per cycle (`{ cycleType: PREPAID, period: 2026-07 }`).
2. Worker pages through active subscribers of that cycle type.
3. For each: check `BillingRun` + unique constraint `(tenantId, subscriberId, periodStart)` on invoice → **duplicate prevention at DB level**.
4. Creates invoice in a transaction (invoice + items + GST + number from series + outbox `invoice.created`).
5. Failures go to `billing.generate.dlq` with per-subscriber error rows in `BillingRunItem` for retry UI.

### notification-worker
Consumes domain events + `notification.send`; loads tenant channel config (decrypt), renders template (Handlebars variables), sends via SMTP/SMS/WhatsApp provider, records `NotificationLog` with status + retries (exponential backoff, max 5).

### report-worker
Consumes `report.requested` (`{ reportType, filters, format }`), streams data, renders PDF (Puppeteer/pdfkit) or Excel (exceljs), uploads to S3, updates `ReportJob` row → frontend polls / gets signed download URL.

### ledger-worker
Single writer for `LedgerEntry` + `DayBookEntry`. Consumes all financial events; guarantees the accounting books are consistent and append-only (corrections via reversal entries, never delete).

### scheduler-service
node-cron (single replica or Redis lock for leader election):
- `0 1 1 * *` — prepaid billing per tenant
- `0 23 L * *` (computed last day) — postpaid billing
- `0 9 * * *` — due-date reminders (T-3, T-0, T+3)
- `0 2 * * *` — SLA breach check, low-stock scan
