# Console session isolation

Tenant and platform consoles on localhost ports 8000/8002 share the same cookie
host. They now send `X-FII-Console: tenant|platform` and use separate HttpOnly
refresh cookies (`fii_refresh_tenant` and `fii_refresh_platform`). Legacy API and
customer-portal clients retain `fii_refresh`. Scoped clients never fall back to
the legacy cookie. Refresh also sends `X-FII-User` to prevent a different user's
session from replacing the account shown in the tab. Cookie security settings
and server-side permission requirements remain unchanged.

Scoped login/refresh rejects the wrong account class. Platform sessions require
the global SUPER_ADMIN role; tenant sessions require non-platform STAFF users.
On first deployment, sign out and sign back in to each console to establish the
new cookies. Existing tenant accounts do not gain platform permissions.

## Confirmed legacy migration selection

Source: `C:\Users\DINEZ17\Downloads\lisoft_billing (2).sql`.

| Old company ID | Company | Intended target subdomain |
|---|---|---|
| 1 | FIRST IDEA INFOTECH | fii (existing tenant) |
| 30 | SKY NETWORK | skynet (tenant creation pending) |

Only these two companies are selected. Before any import, resolve the target
tenant UUIDs and validate company-scoped relationships, dates and balances in a
staging database. No historical records have been imported by this session fix.
