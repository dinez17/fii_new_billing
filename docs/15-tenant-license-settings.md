# Tenant license details

Tenant console → Settings → License displays the current tenant's plan,
effective and recorded status, license start, trial/license expiry, days remaining,
and current user/customer counts against licensed limits. Dates use Asia/Kolkata.
Missing expiry dates are labelled as not set. Usage includes all tenant accounts,
matching the existing license-limit checks. The panel refreshes every minute and
has a manual Refresh button. Renewal/changes remain with the software provider.

`GET /api/v1/settings/license` requires `settings:read` and staff authentication.
It derives the tenant only from the authenticated claims; no tenant ID is accepted
from the caller. Returns `name`, `subdomain`, `planCode`, `licenseStatus`, `isActive`,
`licenseStartsAt`, `licenseEndsAt`, `trialEndsAt`, `maxUsers`, `maxCustomers`,
`effectiveStatus`, `validUntil`, `daysRemaining`, and `usage:{users,customers}`.
The response uses `Cache-Control: no-store`; no license key/hash is included.
There is no tenant-facing license write endpoint. No schema migration is needed.

Expired trial/active dates display EXPIRED even if the stored status has not been
updated. Existing login/license enforcement remains in place; the page does not
grant access to suspended or expired tenants that cannot sign in.
