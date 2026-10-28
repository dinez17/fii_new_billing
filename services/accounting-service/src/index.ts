import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { AppError, createLogger, httpMetrics, mountOps } from "@fii/common";
import { prisma } from "@fii/database";
import { startOutboxRelay } from "@fii/kafka";
import { dayBookRouter, ledgerRouter } from "./daybook.js";
import { reportsRouter } from "./reports.js";
import { gstRouter } from "./gst.js";
import { gstr1FilesRouter } from "./gstr1-files.js";
import { exportsRouter } from "./exports.js";

const log = createLogger("accounting-service");

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("accounting-service"));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "accounting-service" }));
mountOps(app, {
  name: "accounting-service",
  checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }],
});

app.use("/api/v1/day-book", dayBookRouter);
app.use("/api/v1/ledger", ledgerRouter);
app.use("/api/v1/gst", gstr1FilesRouter);
app.use("/api/v1/gst", gstRouter);
// reports + async export live under the same /reports prefix
app.use("/api/v1/reports", exportsRouter);
app.use("/api/v1/reports", reportsRouter);

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  log.error({ err: String(err), path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: String(err).slice(0, 200) } });
});

const stopRelay = startOutboxRelay();
process.on("SIGINT", () => { stopRelay(); process.exit(0); });

const port = Number(process.env.ACCOUNTING_SERVICE_PORT ?? 8092);
app.listen(port, () => log.info({ port }, "accounting-service listening"));
