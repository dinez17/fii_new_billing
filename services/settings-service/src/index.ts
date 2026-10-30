import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { AppError, NON_GST_COMPANY_FIELDS, nonGstCompanySchema, badRequest, createLogger, encryptSecret, isValidGstin, notFound, httpMetrics, mountOps } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { prisma } from "@fii/database";
import { getTenantLicense } from "./license.service.js";
import { legacyImportsRouter } from "./legacy-imports.js";
import { tenantBackupRouter } from "./tenant-backup.routes.js";

const log = createLogger("settings-service");

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

// ── validators
const companyBody = z.object({
  name: z.string().min(2).max(120),
  legalName: z.string().max(200).optional(),
  gstin: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  pan: z.string().max(10).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  stateCode: z.string().regex(/^[0-9]{2}$/).optional(),
  pincode: z.string().regex(/^[0-9]{6}$/).optional().or(z.literal("")).transform((v) => v || undefined),
  phone: z.string().max(15).optional(),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  invoiceTerms: z.string().max(2000).optional(),
  bankPayableAt: z.string().max(120).optional(),
  bankName: z.string().max(120).optional(),
  bankBranch: z.string().max(120).optional(),
  bankAccountNo: z.string().max(30).optional(),
  bankIfsc: z.string().max(15).optional(),
});

const fyBody = z.object({
  code: z.string().regex(/^\d{4}-\d{2}$/, "format: 2026-27"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

const seriesBody = z.object({
  prefix: z.string().min(1).max(30),
  nextNumber: z.coerce.number().int().min(1),
  padding: z.coerce.number().int().min(3).max(10),
});

export const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(httpMetrics("settings-service"));
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "settings-service" }));
mountOps(app, { name: "settings-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Company profile
app.use("/api/v1/settings/legacy-imports", legacyImportsRouter);
app.get("/api/v1/settings/license", authenticate, authorize("settings:read"), h(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getTenantLicense(req.auth!.tenantId));
}));

app.get("/api/v1/settings/company", authenticate, authorize("settings:read"), h(async (req, res) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.auth!.tenantId } });
  res.json(tenant);
}));

app.put("/api/v1/settings/company", authenticate, authorize("settings:update"), h(async (req, res) => {
  const b = parse(companyBody, req.body);
  if (b.gstin && !isValidGstin(b.gstin, b.stateCode)) throw badRequest("Invalid GSTIN");
  res.json(await prisma.tenant.update({ where: { id: req.auth!.tenantId }, data: b }));
}));

// ── Company logo (stored as a data URL — small images only)
const logoBody = z.object({
  dataUrl: z.string()
    .regex(/^data:image\/(png|jpeg);base64,/, "must be a PNG or JPEG data URL")
    .max(400_000, "logo must be under ~300KB"),
});

app.post("/api/v1/settings/company/logo", authenticate, authorize("settings:update"), h(async (req, res) => {
  const b = parse(logoBody, req.body);
  await prisma.tenant.update({ where: { id: req.auth!.tenantId }, data: { logoUrl: b.dataUrl } });
  res.json({ ok: true });
}));

app.delete("/api/v1/settings/company/logo", authenticate, authorize("settings:update"), h(async (req, res) => {
  await prisma.tenant.update({ where: { id: req.auth!.tenantId }, data: { logoUrl: null } });
  res.json({ ok: true });
}));

// ── Financial years
app.get("/api/v1/financial-years", authenticate, authorize("financial_year:read"), h(async (req, res) => {
  res.json(await prisma.financialYear.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { startDate: "desc" },
  }));
}));

app.post("/api/v1/financial-years", authenticate, authorize("financial_year:create"), h(async (req, res) => {
  const b = parse(fyBody, req.body);
  if (b.endDate <= b.startDate) throw badRequest("endDate must be after startDate");
  const overlap = await prisma.financialYear.findFirst({
    where: {
      tenantId: req.auth!.tenantId,
      startDate: { lte: b.endDate },
      endDate: { gte: b.startDate },
    },
  });
  if (overlap) throw badRequest(`Overlaps existing FY ${overlap.code}`);
  res.status(201).json(await prisma.financialYear.create({ data: { ...b, tenantId: req.auth!.tenantId } }));
}));

app.post("/api/v1/financial-years/:id/activate", authenticate, authorize("financial_year:update"), h(async (req, res) => {
  const fy = await prisma.financialYear.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!fy) throw notFound("Financial year");
  if (fy.isLocked) throw badRequest("Cannot activate a locked FY");
  await prisma.$transaction([
    prisma.financialYear.updateMany({ where: { tenantId: req.auth!.tenantId }, data: { isActive: false } }),
    prisma.financialYear.update({ where: { id: fy.id }, data: { isActive: true } }),
  ]);
  res.json({ ok: true });
}));

app.post("/api/v1/financial-years/:id/lock", authenticate, authorize("financial_year:update"), h(async (req, res) => {
  const fy = await prisma.financialYear.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!fy) throw notFound("Financial year");
  if (fy.isActive) throw badRequest("Cannot lock the active FY — activate another first");
  await prisma.financialYear.update({ where: { id: fy.id }, data: { isLocked: true, lockedAt: new Date() } });
  res.json({ ok: true });
}));

// ── Generic setting groups (gateway / SMTP / SMS / WhatsApp) — secrets encrypted
const SETTING_GROUPS: Record<string, { keys: string[]; secrets: string[] }> = {
  TERMS: {
    keys: ["INVOICE", "PROFORMA_INVOICE", "QUOTATION", "PURCHASE_ORDER", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE"],
    secrets: [],
  },
  NON_GST_COMPANY: { keys: ["enabled", ...NON_GST_COMPANY_FIELDS], secrets: [] },
  INVOICE: { keys: ["template"], secrets: [] },
  INVENTORY: { keys: ["allowNegativeStock"], secrets: [] },
  GATEWAY_RAZORPAY: { keys: ["keyId", "keySecret", "webhookSecret", "enabled"], secrets: ["keySecret", "webhookSecret"] },
  GATEWAY_CASHFREE: { keys: ["appId", "secretKey", "webhookSecret", "enabled"], secrets: ["secretKey", "webhookSecret"] },
  SMTP: { keys: ["host", "port", "user", "password", "fromEmail", "fromName", "enabled"], secrets: ["password"] },
  SMS: { keys: ["provider", "apiKey", "senderId", "enabled"], secrets: ["apiKey"] },
  WHATSAPP: { keys: ["provider", "apiKey", "phoneNumberId", "enabled"], secrets: ["apiKey"] },
};

const groupBody = z.record(z.string(), z.string());

app.get("/api/v1/settings/group/:group", authenticate, authorize("settings:read"), h(async (req, res) => {
  const def = SETTING_GROUPS[req.params.group];
  if (!def) throw notFound("Setting group");
  const rows = await prisma.setting.findMany({ where: { tenantId: req.auth!.tenantId, group: req.params.group } });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.isSecret ? (r.value ? "••••••••" : "") : r.value;
  res.json(out);
}));

app.put("/api/v1/settings/group/:group", authenticate, authorize("settings:update"), h(async (req, res) => {
  const def = SETTING_GROUPS[req.params.group];
  if (!def) throw notFound("Setting group");
  let body = parse(groupBody, req.body);
  if (req.params.group === "NON_GST_COMPANY") {
    const previous = await prisma.setting.findMany({ where: { tenantId: req.auth!.tenantId, group: "NON_GST_COMPANY" } });
    body = parse(nonGstCompanySchema, { ...Object.fromEntries(previous.map(row => [row.key, row.value])), ...body });
  }
  const writes = [];
  for (const [key, value] of Object.entries(body)) {
    if (!def.keys.includes(key)) throw badRequest(`Unknown key "${key}" for group ${req.params.group}`);
    if (req.params.group === "INVENTORY" && key === "allowNegativeStock" && value !== "true" && value !== "false") {
      throw badRequest("Allow negative stock must be true or false");
    }
    if (req.params.group === "INVOICE" && key === "template" && !["COMMERCIAL", "TALLY", "CLASSIC", "MODERN", "MINIMAL", "COMPACT", "TELECOM_STATEMENT", "SERVICE_TAX", "IT_SERVICES"].includes(value)) {
      throw badRequest("Choose a valid invoice template");
    }
    const isSecret = def.secrets.includes(key);
    if (value === "••••••••" || (value === "" && isSecret)) continue; // masked/blank secret → keep existing

    writes.push(prisma.setting.upsert({
      where: { tenantId_group_key: { tenantId: req.auth!.tenantId, group: req.params.group, key } },
      create: {
        tenantId: req.auth!.tenantId,
        group: req.params.group,
        key,
        value: isSecret ? encryptSecret(value) : value,
        isSecret,
        updatedById: req.auth!.sub,
      },
      update: { value: isSecret ? encryptSecret(value) : value, updatedById: req.auth!.sub },
    }));
  }
  await prisma.$transaction(writes);
  res.json({ ok: true });
}));

// ── Number series
app.get("/api/v1/number-series", authenticate, authorize("settings:read"), h(async (req, res) => {
  res.json(await prisma.numberSeries.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ fyCode: "desc" }, { docType: "asc" }],
  }));
}));

app.put("/api/v1/number-series/:id", authenticate, authorize("settings:update"), h(async (req, res) => {
  const b = parse(seriesBody, req.body);
  const series = await prisma.numberSeries.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!series) throw notFound("Number series");
  if (b.nextNumber < series.nextNumber) {
    throw badRequest(`nextNumber cannot go backwards (currently ${series.nextNumber}) — risk of duplicate document numbers`);
  }
  res.json(await prisma.numberSeries.update({ where: { id: series.id }, data: b }));
}));

// ── Notification templates + logs
const templateBody = z.object({
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
  isActive: z.boolean().optional(),
});

app.get("/api/v1/notification-templates", authenticate, authorize("notification_template:read"), h(async (req, res) => {
  res.json(await prisma.notificationTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ code: "asc" }, { channel: "asc" }],
  }));
}));

app.put("/api/v1/notification-templates/:id", authenticate, authorize("notification_template:update"), h(async (req, res) => {
  const b = parse(templateBody, req.body);
  const tpl = await prisma.notificationTemplate.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!tpl) throw notFound("Template");
  res.json(await prisma.notificationTemplate.update({ where: { id: tpl.id }, data: b }));
}));

const logsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["QUEUED", "SENT", "FAILED"]).optional(),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]).optional(),
});

app.get("/api/v1/notification-logs", authenticate, authorize("settings:read"), h(async (req, res) => {
  const q = parse(logsQuery, req.query);
  const where = {
    tenantId: req.auth!.tenantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.channel ? { channel: q.channel } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: "desc" },
    }),
    prisma.notificationLog.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
}));

// Tenant-scoped backups; whole-database restore is operator-only (scripts/restore.sh).
app.use("/api/v1/backup", tenantBackupRouter);

// ── error handler
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  log.error({ err: String(err), path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
});

const port = Number(process.env.SETTINGS_SERVICE_PORT ?? 8091);
if (process.env.NODE_ENV !== "test") app.listen(port, () => log.info({ port }, "settings-service listening"));
