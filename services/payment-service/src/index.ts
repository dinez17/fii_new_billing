import express from "express";
import helmet from "helmet";
import { Router } from "express";
import { authenticate, authorize } from "@fii/auth";
import { httpMetrics, mountOps } from "@fii/common";
import { prisma } from "@fii/database";
import { startOutboxRelay } from "@fii/kafka";
import { errorHandler, h, log, parse } from "./http.js";
import * as payments from "./services/payment.service.js";
import { streamReceiptPdf } from "./services/receipt-pdf.js";
import { portalRouter, webhookRouter } from "./routes/gateway.routes.js";

const app = express();
app.use(helmet());
app.set("trust proxy", 1);
app.use(httpMetrics("payment-service"));

// webhooks need the RAW body for signature verification — mount BEFORE json parser
app.use("/api/v1/webhooks", webhookRouter);

app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "payment-service" }));
mountOps(app, { name: "payment-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.get("/", authorize("payment:read"), h(async (req, res) => {
  res.json(await payments.listPayments(req.auth!.tenantId, parse(payments.paymentListQuery, req.query)));
}));
paymentsRouter.get("/tds-report", authorize("payment:read"), h(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await payments.tdsReport(req.auth!.tenantId, parse(payments.tdsReportQuery, req.query)));
}));
paymentsRouter.get("/tds-details/:customerId", authorize("payment:read"), h(async (req,res) => {
  const q = parse(payments.tdsReportQuery, req.query);
  const fy = q.fyCode ?? (await prisma.financialYear.findFirst({ where: { tenantId: req.auth!.tenantId, isActive: true } }))?.code;
  res.setHeader("Cache-Control", "no-store");
  res.json(fy ? await payments.tdsDetails(req.auth!.tenantId, fy, req.params.customerId) : []);
}));
paymentsRouter.post("/:id/tds-review", authorize("payment:update"), h(async (req,res) => {
  res.json(await payments.saveTdsReview(req.auth!.tenantId, req.auth!.sub, req.params.id, parse(payments.tdsReviewBody, req.body)));
}));
paymentsRouter.get("/:id", authorize("payment:read"), h(async (req, res) => {
  res.json(await payments.getPayment(req.auth!.tenantId, req.params.id));
}));
paymentsRouter.post("/", authorize("payment:create"), h(async (req, res) => {
  res.status(201).json(await payments.createPayment(req.auth!.tenantId, req.auth!.sub, parse(payments.paymentCreateBody, req.body)));
}));

paymentsRouter.post("/:id/reverse", authorize("payment:update"), h(async (req, res) => {
  const body = parse(payments.reversePaymentBody, req.body);
  res.json(await payments.reversePayment(req.auth!.tenantId, req.auth!.sub, req.params.id, body.reason));
}));

const receiptsRouter = Router();
receiptsRouter.use(authenticate);
receiptsRouter.get("/:id/pdf", authorize("receipt:read"), h(async (req, res) => {
  await streamReceiptPdf(req.auth!.tenantId, req.params.id, res, (r) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${r.receiptNumber.replace(/\//g, "-")}.pdf"`);
  });
}));

app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/receipts", receiptsRouter);
app.use("/api/v1/portal", portalRouter);

app.use(errorHandler);

const stopRelay = startOutboxRelay();
process.on("SIGINT", () => { stopRelay(); process.exit(0); });

const port = Number(process.env.PAYMENT_SERVICE_PORT ?? 8084);
app.listen(port, () => log.info({ port }, "payment-service listening"));
