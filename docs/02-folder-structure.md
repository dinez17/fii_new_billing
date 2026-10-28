# Folder Structure (pnpm monorepo)

```
fii-billing/
├── docker-compose.yml              # postgres, kafka, redis, minio, all services
├── docker-compose.dev.yml
├── pnpm-workspace.yaml
├── turbo.json                      # (optional) build orchestration
├── .env.example
│
├── packages/                       # shared internal packages
│   ├── database/                   # SINGLE source of truth for DB
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts             # roles, permissions, default templates
│   │   └── src/
│   │       ├── client.ts           # PrismaClient + tenant extension
│   │       └── tenant-extension.ts # auto-inject tenantId
│   ├── kafka/                      # KafkaJS wrapper
│   │   └── src/{producer,consumer,outbox-relay,topics.ts,envelope.ts}
│   ├── auth/                       # JWT verify, RBAC middleware (shared)
│   │   └── src/{jwt.ts,authenticate.ts,authorize.ts,own-data-guard.ts}
│   ├── common/                     # errors, logger(pino), zod helpers, money utils,
│   │   └── src/                    # gst-calculator.ts, number-series.ts, crypto.ts (AES-GCM)
│   └── contracts/                  # zod schemas + TS types shared FE/BE (DTOs, event payloads)
│
├── services/                       # each: same internal layout
│   ├── api-gateway/
│   │   └── src/{index.ts,routes.ts,proxy.ts,rate-limit.ts,tenant-resolver.ts}
│   ├── auth-service/
│   │   └── src/
│   │       ├── index.ts            # express bootstrap
│   │       ├── routes/             # *.routes.ts
│   │       ├── controllers/        # thin: validate → call service → respond
│   │       ├── services/           # business logic
│   │       ├── validators/         # zod schemas
│   │       └── events/             # kafka publishers/consumers for this svc
│   ├── crm-service/
│   ├── billing-service/
│   ├── payment-service/
│   ├── purchase-service/
│   ├── inventory-service/
│   ├── expense-service/
│   ├── accounting-service/
│   ├── hr-service/
│   ├── helpdesk-service/
│   └── settings-service/
│
├── workers/
│   ├── billing-worker/src/
│   ├── notification-worker/src/{channels/{email,sms,whatsapp}.ts,template.ts}
│   ├── report-worker/src/{renderers/{pdf,excel}.ts,reports/*.ts}
│   ├── ledger-worker/src/
│   └── scheduler/src/jobs/*.ts
│
├── apps/
│   ├── admin-web/                  # React (staff/admin)
│   │   └── src/
│   │       ├── app/                # router, providers, permission guard
│   │       ├── components/         # ui/, layout/ (sidebar builds from permissions)
│   │       ├── features/           # one folder per module
│   │       │   ├── auth/ customers/ subscribers/ plans/ invoices/
│   │       │   ├── credit-notes/ payments/ suppliers/ purchases/
│   │       │   ├── inventory/ expenses/ gst/ reports/ day-book/
│   │       │   ├── financial-year/ employees/ attendance/ payroll/
│   │       │   ├── complaints/ tasks/ settings/ dashboard/
│   │       │   └── (each: api.ts, hooks.ts, components/, pages/)
│   │       ├── lib/                # axios instance (token refresh interceptor), utils
│   │       └── stores/             # auth store (zustand)
│   └── customer-portal/            # React (customer login)
│       └── src/features/{auth,invoices,payments,receipts,complaints,profile}/
│
└── infra/
    ├── nginx/                      # TLS termination, subdomain → gateway
    └── k8s/                        # optional, later
```

**Rules**
- Services never import from each other — only from `packages/*`.
- All DTO/event types live in `packages/contracts`; frontend imports the same types.
- Controllers contain no business logic; services contain no `req/res`.
- Every service has `Dockerfile` (multi-stage, node:20-alpine) and `healthz` endpoint.
