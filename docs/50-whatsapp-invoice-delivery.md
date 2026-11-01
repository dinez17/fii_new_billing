# WhatsApp invoice PDFs — FII WAPI

Provider contract: https://wapi.fiitech.in/api-docs (reviewed 2026-11-01).
The versioned integration subset is `postman/contracts/wapi.openapi.json`.

## Tenant setup

1. Open Settings → WhatsApp. Enter the tenant's WhatsApp API base URL (default https://wapi.fiitech.in), then save its WAPI API key in the password field. It is encrypted at rest and masked when read. Leave it blank to retain a saved key.
2. Optionally enter a connected device ID. Leave blank for the provider's automatic device selection. Use Check connection to inspect account credits and ready devices without sending a message.
3. Enable WhatsApp and save. Edit selected customers, check Send invoice and receipt PDFs on WhatsApp, and enter a separate WhatsApp number if their saved phone is unsuitable. Plain ten-digit numbers use India country code 91.
4. New issued invoices, including bill-run invoices, and successful payment receipts queue one automatic PDF message for selected customers. Existing invoices are not backfilled. The invoice register's WhatsApp icon queues an explicit send of an existing issued invoice. Payment rows provide Email receipt and WhatsApp receipt actions for successful payments. Receipt email is queued to primary/additional customer addresses with tenant-company CC and uses the existing SMTP worker. Email delivery is independent and unchanged.
5. Review Notifications → Send log. Queued is not sent. SENT means WAPI reports sent, not delivered/read by the recipient.

The notification worker must run. Tenant credentials and destinations are checked again immediately before sending. Draft/cancelled invoices, reversed/unsuccessful payments, opted-out customers and changed destinations are blocked. The integration sends the generated invoice PDF as `documentBase64`, never as a public PDF URL, to one selected customer destination. Requests use the saved public HTTPS API URL with Bearer authentication; URL credentials, query strings and non-HTTPS URLs are rejected. The API key remains encrypted separately.

## Failure handling

The provider documents no idempotency key. Automatic invoice queueing has a tenant-scoped unique key; manual requests supply a UUID and are idempotent for that request. Workers lease jobs to avoid concurrent sends. A known queued provider message is polled by message ID without resubmitting the PDF.

Uncertain submissions (timeout, HTTP failure, invalid response, interrupted worker) are held for manual review. The worker never blindly repeats the POST. Check WAPI message history before selecting Retry in the send log and confirming that resending will not duplicate a message. Confirmed failures also require this acknowledgement. Previous provider IDs are preserved in the retry audit. Status polling is bounded. Credentials/raw provider response bodies are not logged.

## Validation and rollout

Migrations 26 and 27 add customer opt-in (default false), optional phone and notification tracking. They do not change financial documents, counters, amounts or customer balances. No tenant is enabled automatically.

The local Postman simulation and real HTTP adapter tests cover PDF payloads, individual recipients, account/device checks, tenant credentials, queued status polling, failed/ambiguous responses and timeouts. Database integration tests cover queue deduplication, leases, cancellation/opt-out, tenant isolation, encrypted/masked settings and acknowledged retries. Existing SMTP retry/CC tests remain in place.

Run the optional Postman simulation:

```powershell
postman simulation run postman/simulations/wapi.sim.yaml --port 4501 --no-history --output ndjson
$env:WAPI_SIMULATION_URL='http://127.0.0.1:4501/wapi'
# Use only the disposable test database, with RUN_INTEGRATION_TESTS=true.
pnpm exec vitest run services/settings-service/test/whatsapp.integration.test.ts
```

Without WAPI_SIMULATION_URL the same integration suite starts its local provider fixture for CI. No provider credentials or real WhatsApp messages are used in automated tests. Actual provider acceptance of base64 PDF encoding and live delivery require a configured tenant and an intentional real send; these are not established by mocked tests.

## Local queue-only operation

`NOTIFICATION_QUEUE_ONLY=true` starts the delivery scan and readiness endpoint without consuming Kafka domain events. This is used locally to deliver explicitly queued invoice/receipt actions without replaying historical event notifications. Production defaults to full event consumption. The notification worker must stay running for queued requests to leave the queue.
