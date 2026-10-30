import express from "express";
import helmet from "helmet";
import { Router } from "express";
import { authenticate, authorize, requireCustomer } from "@fii/auth";
import { prisma } from "@fii/database";
import { unauthorized, httpMetrics, mountOps } from "@fii/common";
import { startOutboxRelay } from "@fii/kafka";
import { errorHandler, h, log, parse } from "./http.js";
import * as invoices from "./services/invoice.service.js";
import * as notes from "./services/note.service.js";
import { streamInvoicePdf } from "./services/pdf.service.js";
import { streamNotePdf } from "@fii/pdf";
import { billingRunsRouter } from "./routes/billing-runs.routes.js";
import { salesDocumentsRouter } from "./routes/sales-documents.routes.js";
import { emailInvoice } from "./services/mail.service.js";
import {
  cancelBody, invoiceCreateBody, invoiceListQuery, invoiceUpdateBody,
  noteCreateBody, noteListQuery,
} from "./validators.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("billing-service"));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "billing-service" }));
mountOps(app, { name: "billing-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Invoices
const invoicesRouter = Router();
invoicesRouter.use(authenticate);

invoicesRouter.get("/", authorize("invoice:read"), h(async (req, res) => {
  res.json(await invoices.listInvoices(req.auth!.tenantId, parse(invoiceListQuery, req.query)));
}));
invoicesRouter.get("/:id", authorize("invoice:read"), h(async (req, res) => {
  res.json(await invoices.getInvoice(req.auth!.tenantId, req.params.id));
}));
invoicesRouter.get("/:id/pdf", authorize("invoice:read"), h(async (req, res) => {
  await streamInvoicePdf(req.auth!.tenantId, req.params.id, res, (inv) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${inv.invoiceNumber.replace(/\//g, "-")}.pdf"`);
  });
}));
invoicesRouter.post("/:id/email", authorize("invoice:read"), h(async (req, res) => {
  res.json(await emailInvoice(req.auth!.tenantId, req.params.id));
}));
invoicesRouter.post("/", authorize("invoice:create"), h(async (req, res) => {
  res.status(201).json(await invoices.createInvoice(req.auth!.tenantId, req.auth!.sub, parse(invoiceCreateBody, req.body)));
}));
invoicesRouter.put("/:id", authorize("invoice:update"), h(async (req, res) => {
  res.json(await invoices.updateInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id, parse(invoiceUpdateBody, req.body)));
}));
invoicesRouter.post("/:id/cancel", authorize("invoice:update"), h(async (req, res) => {
  const b = parse(cancelBody, req.body);
  res.json(await invoices.cancelInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id, b.reason));
}));

// ── Credit / debit notes (same shape, two routers)
function noteRouter(kind: notes.NoteKind, module: string): Router {
  const r = Router();
  r.use(authenticate);
  r.get("/", authorize(`${module}:read`), h(async (req, res) => {
    res.json(await notes.listNotes(req.auth!.tenantId, kind, parse(noteListQuery, req.query)));
  }));
  r.post("/", authorize(`${module}:create`), h(async (req, res) => {
    res.status(201).json(await notes.createNote(req.auth!.tenantId, req.auth!.sub, kind, parse(noteCreateBody, req.body)));
  }));
  r.get("/:id", authorize(`${module}:read`), h(async (req, res) => {
    res.json(await notes.getNote(req.auth!.tenantId, kind, req.params.id));
  }));
  r.get("/:id/pdf", authorize(`${module}:read`), h(async (req, res) => {
    await streamNotePdf(req.auth!.tenantId, req.params.id, kind, res, (note) => {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${note.noteNumber.replace(/\//g, "-")}.pdf"`);
    });
  }));
  r.post("/:id/cancel", authorize(`${module}:update`), h(async (req, res) => {
    res.json(await notes.cancelNote(req.auth!.tenantId, kind, req.params.id, req.auth!.sub));
  }));
  return r;
}

// ── Customer portal: own invoices only
const portalInvoicesRouter = Router();
portalInvoicesRouter.use(authenticate, requireCustomer);

portalInvoicesRouter.get("/", h(async (req, res) => {
  const items = await prisma.invoice.findMany({
    where: { tenantId: req.auth!.tenantId, customerId: req.auth!.customerId!, status: { not: "DRAFT" } },
    orderBy: { invoiceDate: "desc" },
    take: 100,
    select: {
      id: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
      grandTotal: true, amountPaid: true, status: true,
    },
  });
  res.json({ items });
}));

portalInvoicesRouter.get("/:id/pdf", h(async (req, res) => {
  const own = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId, customerId: req.auth!.customerId! },
    select: { id: true },
  });
  if (!own) throw unauthorized("Not your invoice");
  await streamInvoicePdf(req.auth!.tenantId, own.id, res);
}));

app.use("/api/v1/invoices", invoicesRouter);
app.use("/api/v1/sales-documents", salesDocumentsRouter);
app.use("/api/v1/portal/invoices", portalInvoicesRouter);
app.use("/api/v1/billing-runs", billingRunsRouter);
app.use("/api/v1/credit-notes", noteRouter("credit", "credit_note"));
app.use("/api/v1/debit-notes", noteRouter("debit", "debit_note"));

app.use(errorHandler);

// Publish outbox events (invoice.created …) to Kafka.
const stopRelay = startOutboxRelay();
process.on("SIGINT", () => { stopRelay(); process.exit(0); });

const port = Number(process.env.BILLING_SERVICE_PORT ?? 8083);
app.listen(port, () => log.info({ port }, "billing-service listening"));
