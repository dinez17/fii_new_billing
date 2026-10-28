import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";
import { createProxyMiddleware } from "http-proxy-middleware";
import { randomUUID } from "node:crypto";
import { createLogger, httpMetrics, mountOps } from "@fii/common";
import { loginRateLimit } from "./login-rate-limit.js";

const log = createLogger("api-gateway");
const app = express();
// The published gateway port is loopback-only; nginx is its immediate proxy.
// Trust one hop so the rightmost forwarded address identifies the client.
app.set("trust proxy", 1);
const redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
redis.on("error", (err) => log.error({ err: String(err) }, "rate-limit Redis error"));
void redis.connect();

const distributedStore = (prefix: string) => new RedisStore({
  prefix: `fii:rate:${prefix}:`,
  sendCommand: (...args: string[]) => redis.sendCommand(args as [string, ...string[]]),
});

app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",") }));
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, store: distributedStore("global") }));
app.use("/api/v1/auth/login", loginRateLimit(distributedStore("staff-login-v2")));
app.use("/api/v1/auth/portal/login", loginRateLimit(distributedStore("portal-login-v2")));
app.use("/api/v1/auth/refresh", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, store: distributedStore("refresh") }));

app.use((req, _res, next) => {
  const requestId = String(req.headers["x-request-id"] ?? randomUUID());
  req.headers["x-request-id"] = requestId;
  _res.setHeader("x-request-id", requestId);
  log.info({ requestId, method: req.method, path: req.url }, "gw request");
  next();
});
app.use(httpMetrics("api-gateway"));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "api-gateway" }));
mountOps(app, { name: "api-gateway", checks: [{ name: "redis", check: async () => { await redis.ping(); } }] });

/**
 * Route table: prefix → downstream service. Proxies are mounted at the app
 * root with a pathFilter so the FULL original path reaches the service
 * (app.use(prefix, proxy) would strip the prefix — hpm v3 behaviour).
 */
const ROUTES: Record<string, string> = {
  "/api/v1/auth": process.env.AUTH_SERVICE_URL ?? "http://localhost:8081",
  "/api/v1/users": process.env.AUTH_SERVICE_URL ?? "http://localhost:8081",
  "/api/v1/roles": process.env.AUTH_SERVICE_URL ?? "http://localhost:8081",
  "/api/v1/audit-logs": process.env.AUTH_SERVICE_URL ?? "http://localhost:8081",
  "/api/v1/platform/tenants": process.env.AUTH_SERVICE_URL ?? "http://localhost:8081",
  "/api/v1/customers": process.env.CRM_SERVICE_URL ?? "http://localhost:8082",
  "/api/v1/plans": process.env.CRM_SERVICE_URL ?? "http://localhost:8082",
  "/api/v1/subscribers": process.env.CRM_SERVICE_URL ?? "http://localhost:8082",
  "/api/v1/settings": process.env.SETTINGS_SERVICE_URL ?? "http://localhost:8091",
  "/api/v1/financial-years": process.env.SETTINGS_SERVICE_URL ?? "http://localhost:8091",
  "/api/v1/number-series": process.env.SETTINGS_SERVICE_URL ?? "http://localhost:8091",
  "/api/v1/notification-templates": process.env.SETTINGS_SERVICE_URL ?? "http://localhost:8091",
  "/api/v1/notification-logs": process.env.SETTINGS_SERVICE_URL ?? "http://localhost:8091",
  "/api/v1/backup": process.env.SETTINGS_SERVICE_URL ?? "http://localhost:8091",
  "/api/v1/invoices": process.env.BILLING_SERVICE_URL ?? "http://localhost:8083",
  "/api/v1/credit-notes": process.env.BILLING_SERVICE_URL ?? "http://localhost:8083",
  "/api/v1/billing-runs": process.env.BILLING_SERVICE_URL ?? "http://localhost:8083",
  "/api/v1/suppliers": process.env.PURCHASE_SERVICE_URL ?? "http://localhost:8085",
  "/api/v1/purchase-invoices": process.env.PURCHASE_SERVICE_URL ?? "http://localhost:8085",
  "/api/v1/supplier-payments": process.env.PURCHASE_SERVICE_URL ?? "http://localhost:8085",
  "/api/v1/purchase-returns": process.env.PURCHASE_SERVICE_URL ?? "http://localhost:8085",
  "/api/v1/purchase-orders": process.env.PURCHASE_SERVICE_URL ?? "http://localhost:8085",
  "/api/v1/grns": process.env.PURCHASE_SERVICE_URL ?? "http://localhost:8085",
  "/api/v1/expenses": process.env.EXPENSE_SERVICE_URL ?? "http://localhost:8087",
  "/api/v1/expense-categories": process.env.EXPENSE_SERVICE_URL ?? "http://localhost:8087",
  "/api/v1/expense-vendors": process.env.EXPENSE_SERVICE_URL ?? "http://localhost:8087",
  "/api/v1/products": process.env.INVENTORY_SERVICE_URL ?? "http://localhost:8086",
  "/api/v1/stock-adjustments": process.env.INVENTORY_SERVICE_URL ?? "http://localhost:8086",
  "/api/v1/stock-movements": process.env.INVENTORY_SERVICE_URL ?? "http://localhost:8086",
  "/api/v1/debit-notes": process.env.BILLING_SERVICE_URL ?? "http://localhost:8083",
  "/api/v1/payments": process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8084",
  "/api/v1/receipts": process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8084",
  "/api/v1/webhooks": process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8084",
  "/api/v1/complaints": process.env.HELPDESK_SERVICE_URL ?? "http://localhost:8090",
  "/api/v1/tasks": process.env.HELPDESK_SERVICE_URL ?? "http://localhost:8090",
  "/api/v1/employees": process.env.HR_SERVICE_URL ?? "http://localhost:8089",
  "/api/v1/departments": process.env.HR_SERVICE_URL ?? "http://localhost:8089",
  "/api/v1/attendance": process.env.HR_SERVICE_URL ?? "http://localhost:8089",
  "/api/v1/leaves": process.env.HR_SERVICE_URL ?? "http://localhost:8089",
  "/api/v1/payroll": process.env.HR_SERVICE_URL ?? "http://localhost:8089",
  "/api/v1/day-book": process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:8092",
  "/api/v1/ledger": process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:8092",
  "/api/v1/reports": process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:8092",
  "/api/v1/gst": process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:8092",
  // customer portal — split across owning services
  "/api/v1/portal/complaints": process.env.HELPDESK_SERVICE_URL ?? "http://localhost:8090",
  "/api/v1/portal/me": process.env.CRM_SERVICE_URL ?? "http://localhost:8082",
  "/api/v1/portal/invoices": process.env.BILLING_SERVICE_URL ?? "http://localhost:8083",
  "/api/v1/portal/pay": process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8084",
  "/api/v1/portal/payments": process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8084",
  "/api/v1/portal/receipts": process.env.PAYMENT_SERVICE_URL ?? "http://localhost:8084",
};

for (const [prefix, target] of Object.entries(ROUTES)) {
  app.use(
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      pathFilter: (path) => path === prefix || path.startsWith(`${prefix}/`),
    }),
  );
}

// If no proxy matched, say so explicitly (distinguishes gateway 404 from a
// downstream service 404).
app.use((req, res) => {
  res.status(404).json({ error: { code: "GW_NO_ROUTE", message: `No gateway route for ${req.originalUrl}` } });
});

// 8080 is commonly taken by XAMPP/Apache on Windows dev machines
const port = Number(process.env.PORT ?? 18080);
const server = app.listen(port, () => log.info({ port, routes: Object.keys(ROUTES).length }, "api-gateway v2 listening"));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => void redis.quit().finally(() => process.exit(0))));
}
