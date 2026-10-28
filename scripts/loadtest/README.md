# Load testing

Two things are worth loading: the **API gateway** (read paths under concurrency)
and the **billing worker** (generating thousands of invoices in one monthly roll).

## 1. Seed subscribers

```bash
# 10k active monthly subscribers on the first tenant's active plan
COUNT=10000 pnpm loadtest:seed
# a specific tenant, offset to avoid re-run collisions
COUNT=10000 START=10000 TENANT_ID=<uuid> pnpm loadtest:seed
```

## 2. Load the API (k6)

Requires [k6](https://k6.io/docs/get-started/installation/). With the stack up
(`pnpm dev`) and the demo admin seeded:

```bash
pnpm loadtest              # BASE_URL defaults to http://localhost:8080
BASE_URL=https://staging.example.com EMAIL=admin@demo.local PASSWORD=... pnpm loadtest
```

Ramps 50 → 200 VUs. Thresholds fail the run if `http_req_failed > 1%` or
`p95 latency > 800ms`. Tune `options.stages` in `api.js`.

## 3. Load the billing worker

The worker consumes `billing.generate` and writes one invoice per active
subscriber, tracked in a `BillingRun`. After seeding, trigger a run for the
current month from the UI (Billing Runs → "Run billing now") or via the API:

```bash
TOKEN=<accessToken>
curl -X POST http://localhost:8080/api/v1/billing-runs/trigger \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cycleType":"PREPAID","year":2026,"month":7}'
```

Watch progress on the Billing Runs page (live-refreshing `successCount` /
`failedCount`) and the worker's metrics at `http://localhost:9101/metrics`
(`domain_events_total`, `dlq_depth`). Re-triggering the same period only bills
the subscribers that were missed — safe to repeat.

## What to watch

- `dlq_depth` — should stay 0. Anything in a DLQ means poison messages.
- `http_request_duration_seconds` p95 on the gateway `/metrics`.
- Postgres connections and CPU; the worker batches, so DB is the usual ceiling.
