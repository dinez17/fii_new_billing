# Best Practices & Critical Validations

## Money & GST
- Decimal everywhere (Prisma Decimal / decimal.js in code). Never `Number` arithmetic on money.
- Round at line level (half-up, 2dp), sum lines, apply `roundOff` to nearest rupee on grand total.
- Inter/intra-state: compare seller stateCode vs placeOfSupply → IGST or CGST+SGST. Never store both.
- GSTIN regex validation + state-code prefix must match customer's stateCode. B2B treatment requires GSTIN.
- Credit note total must not exceed remaining invoice value (invoice total − prior credit notes).
- Payment allocation Σ must equal payment amount; per-invoice allocation ≤ invoice balance.

## Idempotency & duplication (the ERP killers)
- DB unique constraints are the last line of defense (see 03-database-design.md). Application checks are UX, constraints are correctness.
- Webhooks: verify signature FIRST, then upsert WebhookEvent by `(gateway, eventId)` — if exists, return 200 and stop.
- Kafka consumers: check ProcessedEvent before acting; write ProcessedEvent in the same transaction as the side effect.
- Number series: allocate with `UPDATE ... SET next_number = next_number + 1 RETURNING` inside the invoice transaction (row lock prevents gaps/dupes under concurrency).

## Financial integrity
- No hard deletes on financial documents — cancel status + reversal ledger entries.
- FY lock middleware: reject any create/update whose document date falls in a locked FY.
- Ledger has a single writer (ledger-worker). Outstanding is always derivable: opening + Σdebit − Σcredit; nightly job re-verifies denormalized values.
- Invoice status transitions only via payment allocation math: paid=0→UNPAID, 0<paid<total→PARTIAL, paid≥total→PAID.

## Security
- bcrypt cost 12; lockout after 5 failed logins (15 min).
- RS256 JWT; access 15 min; refresh rotated + hashed in DB; reuse of a rotated token revokes the whole family.
- Tenant isolation tests in CI: automated suite that logs in as tenant A and attempts every GET/PUT on tenant B's ids → must 404.
- `ownDataGuard` on all portal routes: `customerId` from JWT only, never from request body/params.
- Secrets: AES-256-GCM, master key from env/KMS, returned masked (`rzp_test_****1234`), write-only API.
- Zod validation on every body/query/param; strip unknown keys. File uploads: type + size allowlist, store outside webroot (MinIO), random names.
- Rate limits: login 5/min/IP, portal pay 10/min/user, global 100/min/user.
- Audit log every mutation on: invoices, payments, notes, settings, roles, payroll, FY.

## Kafka
- Outbox pattern for all publishes (no dual-write). Partition key = tenantId. DLQ per consumer + alert on DLQ depth.
- Consumers must be safe to replay from offset 0 (idempotency table guarantees this).
- Schema-version events (`version` field); additive-only payload changes.

## Validations quick list
- Customer: unique phone/tenant, valid email/pincode, GSTIN if B2B.
- Subscriber: one active plan at a time; billing only for ACTIVE subscribers.
- Invoice: dueDate ≥ invoiceDate; date within active FY; items ≥ 1; qty > 0; discount ≤ line amount.
- Payment: amount > 0; cheque/UTR reference required for those modes.
- Purchase invoice: unique supplier bill no per supplier; GRN qty ≤ PO ordered − received.
- Stock adjustment OUT: qty ≤ current stock; reason mandatory.
- Expense: receipt required above configurable threshold; GST amount consistent with rate.
- Attendance: check-out > check-in; no future dates; payroll only after attendance month is closed.
- Payroll: unique per month; regeneration only in DRAFT; mark-paid emits `salary.paid` exactly once.
- Complaint status: enforce legal transitions (OPEN→ASSIGNED→IN_PROGRESS→{ON_HOLD|RESOLVED}→CLOSED); resolution notes required to resolve.
- Day book close: only once per date, in date order; manual entries need narration.

## Ops
- Migrations: `prisma migrate deploy` in CD, never `db push` in prod. Backward-compatible migrations (expand → migrate → contract).
- pg_dump nightly + WAL archiving; test restores monthly.
- Structured logs (pino) with `tenantId`, `requestId`, `eventId` correlation across services and workers.
- Healthchecks + graceful shutdown (drain Kafka consumers before exit).
- Never log PII, tokens, or decrypted secrets.
