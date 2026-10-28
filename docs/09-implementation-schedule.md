# Production-readiness implementation schedule

Work is ordered by dependency and risk. A phase closes only after its exit gate
passes. Calendar dates depend on staffing and the target production platform.

| Order | Phase | Deliverables | Exit gate | Status |
|---:|---|---|---|---|
| 1 | Build baseline | Compile fix, deterministic tests and CI | `pnpm check` passes | Complete |
| 2 | Secrets and sessions | Required secrets, HTTP-only refresh cookie, MFA, recovery, verification and throttling | Build and security tests pass | Complete |
| 3 | Runtime images | Frozen installs, non-root runtime and compiled service entrypoints | Image builds and starts as non-root | Complete |
| 4 | Tenant/auth assurance | Automatic isolation matrix, consistent permissions and account/session controls | Isolation tests pass | Complete |
| 5 | Financial tests | Payment allocation/settlement, webhook and FY scenarios | Disposable PostgreSQL suite passes | Complete |
| 6 | Operations | Readiness, Prometheus/Loki/Grafana alerts and encrypted off-host backups | Compose renders; operator drills remain environment-specific | Implemented |
| 7 | Documentation/release | Environment reference, TLS/HA runbooks, Git and release checks | Local and CI release gates defined | Complete |

## Production release gate

- Frozen install, schema validation, typecheck, unit tests and builds pass.
- Disposable-database integration tests pass.
- Production Compose renders using explicit secrets and becomes healthy.
- Database and object-storage restore drills succeed.
- No high or critical production dependency/image vulnerabilities remain.
- Tenant, authentication, billing, payment and ledger test matrices pass.
