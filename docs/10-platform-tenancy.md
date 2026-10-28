# Platform tenancy and licensing

## Account separation

- `admin@demo.local` belongs to the `demo` tenant and has the `ADMIN` role.
- The platform operator belongs to the reserved `platform` tenant and has the
  `SUPER_ADMIN` role.
- Tenant role APIs hide `SUPER_ADMIN`, reject it during user assignment, and
  reject `platform:*` permissions in tenant-defined roles.

Set these values before running `pnpm db:seed`:

```dotenv
SEED_TENANT_ADMIN_EMAIL=admin@demo.local
SEED_TENANT_ADMIN_PASSWORD=replace_with_a_temporary_tenant_password
SEED_PLATFORM_ADMIN_EMAIL=superadmin@platform.local
SEED_PLATFORM_ADMIN_PASSWORD=replace_with_at_least_16_random_characters
```

The platform password is intentionally not committed. Seeding updates the
platform superadmin password, while it preserves an existing demo admin
password. Use the in-app password change and MFA setup immediately after the
first platform login.

## Tenant lifecycle

Open `http://localhost:8002` as the platform superadmin. The dedicated console
provides tenant/license management and account security. Tenant administrators
continue to use `http://localhost:8000`; the customer portal uses port `8001`.
The superadmin console accepts accounts with `platform:read`. Both consoles use
the existing authenticated gateway; API permission checks remain authoritative.

The tenant management interface supports:

Use **Edit details** to change a tenant's company/contact details and subdomain.
Subdomains must be unique, 2–63 characters, and contain lowercase letters,
numbers, or internal hyphens. The `platform` subdomain is reserved. Renaming a
subdomain preserves the tenant ID, users, business records, and license.

1. Creating a tenant, its first tenant admin, active financial year, and all
   operational number series.
2. Starting a time-bounded trial with user and customer limits.
3. Activating or changing a plan, dates, status, and licensed limits.
4. Generating a license key. The plaintext key is returned and displayed once;
   only its SHA-256 digest is stored.
5. Suspending a tenant with a reason. Suspension disables the tenant, revokes
   active refresh tokens, and prevents new login/refresh sessions.
6. Reactivating a tenant by applying an `ACTIVE` license with valid dates.

Every creation, license update, and suspension writes an immutable
`TenantLicenseEvent` history record with the acting platform user.

## Enforcement

- Authentication rejects inactive, suspended, cancelled, and expired tenants.
- Trial access stops after `trialEndsAt`; active access stops after
  `licenseEndsAt`.
- User creation enforces `maxUsers`.
- Customer creation enforces `maxCustomers`.
- Every business model remains tenant-scoped through the Prisma tenant client.

The migration is applied with `pnpm db:deploy`. The integration suite
`services/auth-service/test/platform-tenancy.integration.test.ts` verifies
provisioning, one-time license hashing, quota enforcement, privilege isolation,
and suspension against PostgreSQL.

## Platform API

All endpoints require an access token with the shown permission:

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/platform/tenants` | `platform:read` | Search/list tenants and usage |
| `GET` | `/api/v1/platform/tenants/:id` | `platform:read` | Tenant and license history |
| `POST` | `/api/v1/platform/tenants` | `platform:create` | Provision tenant and first admin |
| `PUT` | `/api/v1/platform/tenants/:id` | `platform:update` | Update tenant profile |
| `POST` | `/api/v1/platform/tenants/:id/license` | `platform:update` | Issue/change license |
| `POST` | `/api/v1/platform/tenants/:id/suspend` | `platform:update` | Suspend and revoke sessions |

License keys are provisioning artifacts; runtime authorization is based on the
server-side tenant license state, not on a key supplied by browser clients.
