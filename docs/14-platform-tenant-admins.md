# Platform tenant administrator accounts

At the superadmin console (localhost:8002), open Tenant management → Admin users
for a tenant. Create an admin with name, login email and a confirmed password.
The login username is an email address. Edit username changes the login email
and display name; the tenant company/contact email remains separate. Password
reset accepts a confirmed new password (12–72 characters, at most 72 UTF-8 bytes).
Existing passwords are never displayed or recoverable. MFA remains enabled.

New tenant creation still provisions its initial administrator. Additional admin
accounts count toward the tenant's licensed user limit. Duplicate emails within
the tenant are rejected. Suspended tenant/license states are not changed by
creating or editing an administrator. Inactive accounts remain inactive after
reset; lockout state is cleared for locked accounts.

All endpoints require authenticated platform permissions:

- `GET /api/v1/platform/tenants/:id/admins`: `platform:read`; safe admin metadata.
- `POST /api/v1/platform/tenants/:id/admins`: `platform:update`;
  `{name,email,password}`; creates a STAFF user with the global ADMIN role, 201.
- `PUT /api/v1/platform/tenants/:id/admins/:userId`: `platform:update`;
  `{name,email}`; edits the administrator, 200.
- `POST /api/v1/platform/tenants/:id/admins/:userId/reset-password`:
  `platform:update`; `{password}`; returns `{ok:true}`, 200.

Only administrators belonging to the selected tenant can be changed. Platform
accounts and SUPER_ADMIN roles are excluded. Passwords use bcrypt and never
appear in replies or audit payloads. Username changes/password resets revoke
refresh sessions and outstanding recovery tokens. Existing access tokens remain
valid until their usual short expiry. Audit events identify actor, tenant and
target user. No schema migration or account seed is required.
