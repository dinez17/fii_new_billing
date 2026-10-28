# FII Billing — Multi-Tenant ERP/Billing/CRM/Helpdesk/Accounting SaaS

Design blueprint for Indian subscriber-based SMBs. React + Node/Express + PostgreSQL + Prisma + Kafka (KafkaJS) + Docker.

## Deliverables map

| # | Item | File |
|---|---|---|
| 1 | Architecture (multi-tenant microservices) | `docs/01-architecture.md` |
| 2 | Folder structure (pnpm monorepo) | `docs/02-folder-structure.md` |
| 3 | Database schema design decisions | `docs/03-database-design.md` |
| 4 | Prisma schema (complete, ~55 models) | `packages/database/prisma/schema.prisma` |
| 5 | API endpoint list (per service) | `docs/04-api-endpoints.md` |
| 6 | Kafka topic list | `docs/01-architecture.md` §6 |
| 7 | Worker service design | `docs/01-architecture.md` §7 |
| 8 | React page/module list | `docs/05-react-modules.md` |
| 9 | Development order phase-by-phase | `docs/06-development-phases.md` |
| 10 | Best practices & validations | `docs/07-best-practices.md` |
| 11 | Production deployment (Docker Compose) | `docs/08-deployment.md` |
| 12 | Platform tenancy and licensing | `docs/10-platform-tenancy.md` |

## Quickstart (Phase 0)

```bash
# 1. Prereqs: Node 20+, pnpm 9 (corepack enable), Docker Desktop
cp .env.example .env          # then set encryption, JWT, and seed secrets

# 2. Install workspace deps
pnpm install

# 3. Start infrastructure (Postgres, Kafka, Redis, MinIO, Kafka-UI @ :8888)
pnpm dev:infra

# 4. First migration + generated client + seed
pnpm db:generate
pnpm db:migrate               # creates migration "init" from the 58-model schema
pnpm db:seed                  # permissions, system roles, demo tenant, admin, FY, number series

# 5. Gateway skeleton
pnpm gateway:dev              # http://localhost:8080/healthz
```

The seed creates a demo tenant admin and a separate platform superadmin. Set
`SEED_PLATFORM_ADMIN_PASSWORD` (minimum 16 characters) before seeding; see
`docs/10-platform-tenancy.md`. Change all bootstrap passwords immediately.

## Scaffolded so far (Phase 0)
`packages/database` (Prisma client + tenant-scoping extension + seed), `packages/common` (logger, errors, GST calculator, AES-256-GCM secrets), `packages/kafka` (idempotent producer, retrying/idempotent consumer with DLQ, transactional outbox relay), `packages/contracts` (shared zod DTOs), `services/api-gateway` (reverse proxy skeleton + Dockerfile), `docker-compose.yml` (infra; app services behind `--profile app`).
