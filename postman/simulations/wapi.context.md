# WAPI invoice simulation

Stands in for https://wapi.fiitech.in; contract subset from /api-docs reviewed 2026-11-01. Local only; no cloud deployment or real sends.

Start: `postman simulation run postman/simulations/wapi.sim.yaml --port 4501 --no-history --output ndjson`.
Set WAPI_SIMULATION_URL=http://127.0.0.1:4501/wapi and run services/settings-service/test/whatsapp.integration.test.ts with the disposable database and RUN_INTEGRATION_TESTS=true. No URL override is exposed in tenant settings.

Fake Bearer keys start with test-. Each unique key permits one POST; duplicates return 409. Mode substrings queued, failed, timeout, server-error and invalid-json exercise delivery outcomes. GET message status completes queued messages. The handler validates a PDF base64 header, .pdf filename and a single international recipient. Test keys contain no real credentials. Restart the mock to clear its in-memory counters.

Verified via Postman simulation on 2026-11-01: four integration cases passed (deduplication/concurrent lease, pending polling, uncertain/failed submission holds, opt-out/cancellation/tenant isolation). Separate HTTP contract tests validate payload fields and account/device requests. CI starts this handler directly if the optional simulator URL is unset.

Mock results establish local request and recovery behavior, not live provider compatibility or recipient delivery. Live base64 acceptance remains to be checked after tenant setup.
