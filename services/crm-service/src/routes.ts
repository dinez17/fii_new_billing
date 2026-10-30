import { Router } from "express";
import { authenticate, authorize, requireCustomer } from "@fii/auth";
import * as customers from "./services/customer.service.js";
import * as plans from "./services/plan.service.js";
import * as subscribers from "./services/subscriber.service.js";
import { h, parse } from "./http.js";
import {
  addPlanBody, customerBody, customerListQuery, endPlanBody, planBody, portalAccessBody,
  subscriberCreateBody, subscriberListQuery, subscriberUpdateBody, updateSubscriberPlanBody,
} from "./validators.js";
import { z } from "zod";
import { prisma } from "@fii/database";
import { notFound, conflict, badRequest, bulkImportBody, importRows } from "@fii/common";
import * as kyc from "./services/customer-kyc.service.js";
import { lookupPincode } from "./services/pincode.service.js";
import { buildCustomerCafPdfBuffer } from "@fii/pdf";

// ── Customers
export const customersRouter = Router();
customersRouter.use(authenticate);
customersRouter.get("/pincode/:pincode", authorize("customer:read"), h(async (req, res) => {
  res.json(await lookupPincode(req.params.pincode));
}));

// KYC and CAF require update permission, rather than exposing identity files
// through the ordinary customer list/read endpoint.
customersRouter.get("/:id/kyc", authorize("customer:update"), h(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await kyc.getKyc(req.auth!.tenantId, req.params.id));
}));
customersRouter.put("/:id/kyc", authorize("customer:update"), h(async (req, res) => {
  res.json(await kyc.saveKyc(req.auth!.tenantId, req.params.id, req.auth!.sub, parse(kyc.kycBody, req.body)));
}));
customersRouter.post("/:id/documents/:kind", authorize("customer:update"), h(async (req, res) => {
  res.status(201).json(await kyc.uploadDocument(req.auth!.tenantId, req.params.id, req.auth!.sub, parse(kyc.documentKind, req.params.kind), parse(kyc.documentBody, req.body)));
}));
customersRouter.get("/:id/documents/:kind", authorize("customer:update"), h(async (req, res) => {
  const file = await kyc.readDocument(req.auth!.tenantId, req.params.id, parse(kyc.documentKind, req.params.kind));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.send(file.bytes);
}));
customersRouter.get("/:id/caf", authorize("customer:update"), h(async (req, res) => {
  const { buffer, customerCode } = await buildCustomerCafPdfBuffer(req.auth!.tenantId, req.params.id);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`CAF-${customerCode}.pdf`)}`);
  res.send(buffer);
}));

customersRouter.post("/import", authorize("customer:create"), h(async (req, res) => {
  const input = parse(bulkImportBody, req.body);
  const tenantId = req.auth!.tenantId;
  res.json(await importRows({ ...input, schema: customerBody,
    validate: async (row) => {
      customers.validateGst(row);
      if (row.phone && await prisma.customer.findFirst({ where: { tenantId, phone: row.phone } })) throw conflict("Customer phone already exists");
    },
    create: (row) => customers.createCustomer(tenantId, row),
  }));
}));

customersRouter.get("/", authorize("customer:read"), h(async (req, res) => {
  res.json(await customers.listCustomers(req.auth!.tenantId, parse(customerListQuery, req.query)));
}));
customersRouter.get("/:id", authorize("customer:read"), h(async (req, res) => {
  res.json(await customers.getCustomer(req.auth!.tenantId, req.params.id));
}));
customersRouter.post("/", authorize("customer:create"), h(async (req, res) => {
  res.status(201).json(await customers.createCustomer(req.auth!.tenantId, parse(customerBody, req.body)));
}));
customersRouter.put("/:id", authorize("customer:update"), h(async (req, res) => {
  res.json(await customers.updateCustomer(req.auth!.tenantId, req.params.id, parse(customerBody.partial(), req.body)));
}));
customersRouter.post("/:id/portal-access", authorize("customer:update"), h(async (req, res) => {
  const b = parse(portalAccessBody, req.body);
  res.json(await customers.setPortalAccess(req.auth!.tenantId, req.params.id, b.enable, b.password, req.auth!.sub));
}));
customersRouter.get("/:id/ledger", authorize("ledger:read"), h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId } });
  if (!customer) throw notFound("Customer");
  const entries = await prisma.ledgerEntry.findMany({
    where: { tenantId, partyType: "CUSTOMER", partyId: customer.id },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  let balance = Number(customer.openingBalance);
  const rows = entries.map((e) => {
    balance += Number(e.debit) - Number(e.credit);
    return { ...e, balance: balance.toFixed(2) };
  });
  res.json({
    customer: { id: customer.id, name: customer.name, code: customer.code },
    openingBalance: Number(customer.openingBalance).toFixed(2),
    entries: rows,
    outstanding: balance.toFixed(2),
  });
}));
customersRouter.get("/:id/outstanding", authorize("customer:read"), h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId } });
  if (!customer) throw notFound("Customer");
  const sums = await prisma.ledgerEntry.aggregate({
    where: { tenantId, partyType: "CUSTOMER", partyId: customer.id },
    _sum: { debit: true, credit: true },
  });
  const outstanding = Number(customer.openingBalance) + Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
  res.json({ outstanding: outstanding.toFixed(2) });
}));

// ── Customer portal: own profile + outstanding
export const portalMeRouter = Router();
portalMeRouter.use(authenticate, requireCustomer);

portalMeRouter.get("/", h(async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const customerId = req.auth!.customerId!;
  const [customer, sums, tenant] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: { subscribers: { include: { plans: { where: { endDate: null }, include: { plan: true } } } } },
    }),
    prisma.ledgerEntry.aggregate({
      where: { tenantId, partyType: "CUSTOMER", partyId: customerId },
      _sum: { debit: true, credit: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, phone: true, email: true } }),
  ]);
  if (!customer) throw notFound("Customer");
  const outstanding =
    Number(customer.openingBalance) + Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
  res.json({
    customer: {
      id: customer.id, code: customer.code, name: customer.name,
      email: customer.email, phone: customer.phone,
    },
    subscribers: customer.subscribers.map((s) => ({
      code: s.code, status: s.status, type: s.subscriberType,
      plan: s.plans.map((m) => m.plan.name).join(" + ") || null,
    })),
    outstanding: outstanding.toFixed(2),
    company: tenant,
  });
}));

// ── Plans
export const plansRouter = Router();
plansRouter.use(authenticate);

plansRouter.post("/import", authorize("plan:create"), h(async (req, res) => {
  const input = parse(bulkImportBody, req.body);
  const tenantId = req.auth!.tenantId;
  res.json(await importRows({ ...input, schema: planBody,
    validate: async (row) => {
      if (await prisma.plan.findFirst({ where: { tenantId, code: row.code.toUpperCase() } })) throw conflict("Plan code already exists");
    },
    create: (row) => plans.createPlan(tenantId, row),
  }));
}));

plansRouter.get("/", authorize("plan:read"), h(async (req, res) => {
  const q = parse(z.object({ all: z.coerce.boolean().default(false) }), req.query);
  res.json(await plans.listPlans(req.auth!.tenantId, q.all));
}));
plansRouter.post("/", authorize("plan:create"), h(async (req, res) => {
  res.status(201).json(await plans.createPlan(req.auth!.tenantId, parse(planBody, req.body)));
}));
plansRouter.put("/:id", authorize("plan:update"), h(async (req, res) => {
  res.json(await plans.updatePlan(req.auth!.tenantId, req.params.id, parse(planBody.partial(), req.body)));
}));
plansRouter.delete("/:id", authorize("plan:delete"), h(async (req, res) => {
  await plans.deletePlan(req.auth!.tenantId, req.params.id);
  res.json({ ok: true });
}));

// ── Subscribers
export const subscribersRouter = Router();
subscribersRouter.use(authenticate);

subscribersRouter.get("/", authorize("subscriber:read"), h(async (req, res) => {
  res.json(await subscribers.listSubscribers(req.auth!.tenantId, parse(subscriberListQuery, req.query)));
}));
subscribersRouter.get("/:id", authorize("subscriber:read"), h(async (req, res) => {
  res.json(await subscribers.getSubscriber(req.auth!.tenantId, req.params.id));
}));
subscribersRouter.post("/", authorize("subscriber:create"), h(async (req, res) => {
  res.status(201).json(await subscribers.createSubscriber(req.auth!.tenantId, parse(subscriberCreateBody, req.body)));
}));
subscribersRouter.put("/:id", authorize("subscriber:update"), h(async (req, res) => {
  const b = parse(subscriberUpdateBody, req.body);
  const sub = await prisma.subscriber.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!sub) throw notFound("Subscriber");
  if (sub.status === "TERMINATED") throw badRequest("Subscriber is terminated");
  res.json(await prisma.subscriber.update({ where: { id: sub.id }, data: b }));
}));
subscribersRouter.post("/:id/plans", authorize("subscriber:update"), h(async (req, res) => {
  res.json(await subscribers.addPlan(req.auth!.tenantId, req.params.id, parse(addPlanBody, req.body)));
}));
subscribersRouter.post("/:id/plans/:mappingId/end", authorize("subscriber:update"), h(async (req, res) => {
  const b = parse(endPlanBody, req.body);
  res.json(await subscribers.endPlan(req.auth!.tenantId, req.params.id, req.params.mappingId, b.endDate));
}));
subscribersRouter.put("/:id/plans/:mappingId", authorize("subscriber:update"), h(async (req, res) => {
  const b = parse(updateSubscriberPlanBody, req.body);
  res.json(await subscribers.updateSubscriberPlan(req.auth!.tenantId, req.params.id, req.params.mappingId, b));
}));
for (const [path, status] of [["suspend", "SUSPENDED"], ["activate", "ACTIVE"], ["terminate", "TERMINATED"]] as const) {
  subscribersRouter.post(`/:id/${path}`, authorize("subscriber:update"), h(async (req, res) => {
    res.json(await subscribers.setStatus(req.auth!.tenantId, req.params.id, status));
  }));
}
