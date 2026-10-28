# API Endpoints

All routes behind gateway at `/api/v1/...`. Every route (except auth/webhooks) requires `Authorization: Bearer <access>` and passes RBAC `authorize("<module>:<action>")`. List endpoints support `?page&limit&sort&search` + module filters. Mutations require permission; customers hit only `/portal/*`.

## auth-service
```
POST   /auth/login                      # staff login → access + refresh
POST   /auth/portal/login               # customer login
POST   /auth/refresh                    # rotate refresh token
POST   /auth/logout                     # revoke refresh
POST   /auth/change-password
GET    /auth/me                         # profile + permissions (drives sidebar)
GET    /users  POST /users  GET/PUT/DELETE /users/:id
POST   /users/:id/reset-password
GET    /roles  POST /roles  GET/PUT/DELETE /roles/:id
GET    /permissions                     # master list
PUT    /roles/:id/permissions
GET    /audit-logs                      # filters: user, entity, date range
```

## crm-service
```
GET/POST /customers        GET/PUT/DELETE /customers/:id
GET    /customers/:id/ledger            # from accounting via shared read
GET    /customers/:id/outstanding
POST   /customers/:id/portal-access     # enable/disable, resend credentials
GET/POST /plans            GET/PUT/DELETE /plans/:id
GET/POST /subscribers      GET/PUT /subscribers/:id
POST   /subscribers/:id/plan            # map/change plan (closes old SubscriberPlan)
POST   /subscribers/:id/suspend | /activate | /terminate
```

## billing-service
```
GET/POST /invoices         GET/PUT /invoices/:id
POST   /invoices/:id/cancel
GET    /invoices/:id/pdf
GET/POST /credit-notes     GET /credit-notes/:id     POST /credit-notes/:id/cancel
GET/POST /debit-notes      GET /debit-notes/:id      POST /debit-notes/:id/cancel
GET    /billing-runs       GET /billing-runs/:id     # progress + failed items
POST   /billing-runs/trigger            # manual trigger {cycleType, period}
POST   /billing-runs/:id/retry-failed
GET/PUT /number-series
```

## payment-service
```
GET/POST /payments         GET /payments/:id         # manual payment entry (cash/cheque/UPI)
GET    /payments/:id/receipt-pdf
POST   /gateway/orders                   # create Razorpay/Cashfree order {invoiceIds|amount}
POST   /webhooks/razorpay                # PUBLIC, signature-verified
POST   /webhooks/cashfree                # PUBLIC, signature-verified
GET    /receipts           GET /receipts/:id
```

## purchase-service
```
GET/POST /suppliers        GET/PUT/DELETE /suppliers/:id
GET    /suppliers/:id/ledger  /suppliers/:id/outstanding
GET/POST /purchase-orders  GET/PUT /purchase-orders/:id   POST /purchase-orders/:id/cancel
GET/POST /grns             GET /grns/:id
GET/POST /purchase-invoices GET/PUT /purchase-invoices/:id  POST /purchase-invoices/:id/cancel
GET/POST /purchase-returns GET /purchase-returns/:id
GET/POST /supplier-payments GET /supplier-payments/:id
```

## inventory-service
```
GET/POST /products         GET/PUT/DELETE /products/:id
GET    /products/low-stock
POST   /stock-adjustments               # {productId, direction, qty, reason}
GET    /stock-movements                 # filters: product, type, date
GET    /reports/item-wise
```

## expense-service
```
GET/POST /expense-categories  PUT/DELETE /expense-categories/:id
GET/POST /expense-vendors     PUT/DELETE /expense-vendors/:id
GET/POST /expenses         GET/PUT /expenses/:id   POST /expenses/:id/cancel
POST   /expenses/:id/receipt            # multipart upload
GET    /reports/monthly
```

## accounting-service
```
GET/POST /financial-years  PUT /financial-years/:id
POST   /financial-years/:id/activate | /lock
GET    /day-book?date=                  # opening, entries, computed closing
POST   /day-book/manual-entry
POST   /day-book/close                  # writes DayBookClosing
GET    /ledger?partyType&partyId&from&to
GET    /reports/sales | /purchases | /collections | /outstanding
GET    /reports/customer-statement/:customerId
GET    /reports/supplier-statement/:supplierId
GET    /reports/profit-loss?fy|from&to
GET    /reports/dashboard               # today/MTD collections, outstanding, open complaints, low stock
GET    /gst/gstr1?from&to               # B2B, B2C, CDNR, HSN, docs sections
GET    /gst/gstr3b?month&year
POST   /reports/export                  # {reportType, filters, format} → ReportJob id
GET    /reports/export/:jobId           # status + signed download URL
```

## hr-service
```
GET/POST /departments      PUT/DELETE /departments/:id
GET/POST /employees        GET/PUT /employees/:id
POST   /attendance/check-in | /check-out
POST   /attendance/bulk                 # mark day for many employees
GET    /attendance?month&year&employeeId
GET    /attendance/report/monthly
GET/POST /leaves           PUT /leaves/:id/approve | /reject
POST   /payroll/generate                # {month, year} → creates run + payslips
GET    /payroll/runs       GET /payroll/runs/:id
POST   /payroll/payslips/:id/mark-paid  # emits salary.paid → day book + expense
GET    /payroll/payslips/:id/pdf
```

## helpdesk-service
```
GET/POST /complaints       GET/PUT /complaints/:id
POST   /complaints/:id/assign           # {employeeId} → emits complaint.assigned
POST   /complaints/:id/status           # transition + history row
POST   /complaints/:id/attachments
GET    /complaints/:id/history
GET/POST /tasks            GET/PUT /tasks/:id
POST   /tasks/:id/comments POST /tasks/:id/complete
GET    /reports/daily-complaints
GET    /reports/employee-pending
GET    /reports/sla                     # resolution time vs slaHours
```

## settings-service
```
GET    /settings/company   PUT /settings/company     # + logo/signature upload
GET/PUT /settings/:group                # INVOICE | GST | SMTP | SMS | WHATSAPP | GATEWAY_* (admin only; secrets write-only, returned masked)
POST   /settings/:group/test            # test SMTP/SMS/WhatsApp connection
GET/PUT /notification-templates
GET/PUT /number-series
```

## customer portal (gateway routes → services, ownDataGuard enforced)
```
GET    /portal/me                       # profile, subscriptions
GET    /portal/invoices    GET /portal/invoices/:id/pdf
GET    /portal/outstanding
POST   /portal/pay                      # create gateway order
GET    /portal/payments    GET /portal/receipts/:id/pdf
GET/POST /portal/complaints GET /portal/complaints/:id
```
