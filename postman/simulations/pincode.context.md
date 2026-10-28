# PIN lookup verification

The provider did not appear in Orbit's targeted results. The OpenAPI example is based on the actual public provider response to `600001`, verified on 2026-10-27. No owning workspace connection is configured; the mock is local and not published.

Run `postman simulation run postman/simulations/pincode.sim.yaml --port 14990 --output ndjson`, then `pnpm exec tsx scripts/verify-pincode-simulation.ts`. The verification script reroutes the provider hostname to the simulation without fabricating responses; production lookup code retains its real HTTP request, timeout, parser and failure handling. It checks a successful sample and a 503 failure. Inspect simulation request events for both requests, then stop the simulation.
