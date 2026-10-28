import express from "express";
import helmet from "helmet";
import { Router } from "express";
import { authenticate, authorize } from "@fii/auth";
import { httpMetrics, mountOps, notFound } from "@fii/common";
import { prisma } from "@fii/database";
import { startOutboxRelay } from "@fii/kafka";
import { errorHandler, h, log, parse } from "./http.js";
import * as svc from "./services/purchase.service.js";
import * as po from "./services/po.service.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("purchase-service"));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "purchase-service" }));
mountOps(app, { name: "purchase-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Suppliers
const suppliers = Router();
suppliers.use(authenticate);
suppliers.get("/", authorize("supplier:read"), h(async (req, res) => {
  res.json(await svc.listSuppliers(req.auth!.tenantId, parse(svc.supplierListQuery, req.query)));
}));
suppliers.get("/:id", authorize("supplier:read"), h(async (req, res) => {
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!supplier) throw notFound("Supplier");
  res.json(supplier);
}));
suppliers.post("/", authorize("supplier:create"), h(async (req, res) => {
  res.status(201).json(await svc.createSupplier(req.auth!.tenantId, parse(svc.supplierBody, req.body)));
}));
suppliers.put("/:id", authorize("supplier:update"), h(async (req, res) => {
  res.json(await svc.updateSupplier(req.auth!.tenantId, req.params.id, parse(svc.supplierBody.partial(), req.body)));
}));
suppliers.get("/:id/ledger", authorize("ledger:read"), h(async (req, res) => {
  res.json(await svc.supplierLedger(req.auth!.tenantId, req.params.id));
}));

// ── Purchase invoices
const purchaseInvoices = Router();
purchaseInvoices.use(authenticate);
purchaseInvoices.get("/", authorize("purchase_invoice:read"), h(async (req, res) => {
  res.json(await svc.listPurchaseInvoices(req.auth!.tenantId, parse(svc.pagination, req.query)));
}));
purchaseInvoices.get("/:id", authorize("purchase_invoice:read"), h(async (req, res) => {
  res.json(await svc.getPurchaseInvoice(req.auth!.tenantId, req.params.id));
}));
purchaseInvoices.post("/", authorize("purchase_invoice:create"), h(async (req, res) => {
  res.status(201).json(await svc.createPurchaseInvoice(req.auth!.tenantId, req.auth!.sub, parse(svc.purchaseInvoiceBody, req.body)));
}));

// ── Supplier payments
const supplierPayments = Router();
supplierPayments.use(authenticate);
supplierPayments.get("/", authorize("supplier_payment:read"), h(async (req, res) => {
  res.json(await svc.listSupplierPayments(req.auth!.tenantId, parse(svc.pagination, req.query)));
}));
supplierPayments.post("/", authorize("supplier_payment:create"), h(async (req, res) => {
  res.status(201).json(await svc.createSupplierPayment(req.auth!.tenantId, req.auth!.sub, parse(svc.supplierPaymentBody, req.body)));
}));

// ── Purchase returns
const purchaseReturns = Router();
purchaseReturns.use(authenticate);
purchaseReturns.get("/", authorize("purchase_return:read"), h(async (req, res) => {
  res.json(await svc.listPurchaseReturns(req.auth!.tenantId, parse(svc.pagination, req.query)));
}));
purchaseReturns.post("/", authorize("purchase_return:create"), h(async (req, res) => {
  res.status(201).json(await svc.createPurchaseReturn(req.auth!.tenantId, req.auth!.sub, parse(svc.purchaseReturnBody, req.body)));
}));

// ── Purchase orders + GRN
const purchaseOrders = Router();
purchaseOrders.use(authenticate);
purchaseOrders.get("/", authorize("purchase_order:read"), h(async (req, res) => {
  res.json(await po.listPos(req.auth!.tenantId, parse(po.poListQuery, req.query)));
}));
purchaseOrders.get("/:id", authorize("purchase_order:read"), h(async (req, res) => {
  res.json(await po.getPo(req.auth!.tenantId, req.params.id));
}));
purchaseOrders.post("/", authorize("purchase_order:create"), h(async (req, res) => {
  res.status(201).json(await po.createPo(req.auth!.tenantId, req.auth!.sub, parse(po.poBody, req.body)));
}));
for (const [path, status] of [["send", "SENT"], ["cancel", "CANCELLED"], ["close", "CLOSED"]] as const) {
  purchaseOrders.post(`/:id/${path}`, authorize("purchase_order:update"), h(async (req, res) => {
    res.json(await po.setPoStatus(req.auth!.tenantId, req.params.id, status));
  }));
}

const grns = Router();
grns.use(authenticate);
grns.post("/", authorize("grn:create"), h(async (req, res) => {
  res.status(201).json(await po.createGrn(req.auth!.tenantId, req.auth!.sub, parse(po.grnBody, req.body)));
}));

app.use("/api/v1/purchase-orders", purchaseOrders);
app.use("/api/v1/grns", grns);
app.use("/api/v1/suppliers", suppliers);
app.use("/api/v1/purchase-invoices", purchaseInvoices);
app.use("/api/v1/supplier-payments", supplierPayments);
app.use("/api/v1/purchase-returns", purchaseReturns);

app.use(errorHandler);

const stopRelay = startOutboxRelay();
process.on("SIGINT", () => { stopRelay(); process.exit(0); });

const port = Number(process.env.PURCHASE_SERVICE_PORT ?? 8085);
app.listen(port, () => log.info({ port }, "purchase-service listening"));
