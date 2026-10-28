import express from "express";
import helmet from "helmet";
import { httpMetrics, mountOps } from "@fii/common";
import { prisma } from "@fii/database";
import { errorHandler, log } from "./http.js";
import { customersRouter, plansRouter, portalMeRouter, subscribersRouter } from "./routes.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("crm-service"));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "crm-service" }));
mountOps(app, { name: "crm-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

app.use("/api/v1/customers", customersRouter);
app.use("/api/v1/plans", plansRouter);
app.use("/api/v1/subscribers", subscribersRouter);
app.use("/api/v1/portal/me", portalMeRouter);

app.use(errorHandler);

const port = Number(process.env.CRM_SERVICE_PORT ?? 8082);
app.listen(port, () => log.info({ port }, "crm-service listening"));
