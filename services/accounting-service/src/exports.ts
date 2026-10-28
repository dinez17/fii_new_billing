import { Router } from "express";
import { z } from "zod";
import { badRequest, notFound } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, prisma } from "@fii/database";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import { h, parse } from "./util.js";

export const REPORT_TYPES = [
  "SALES", "PURCHASES", "COLLECTIONS", "OUTSTANDING", "DAY_BOOK",
  "PROFIT_LOSS", "GSTR1", "GSTR3B", "CUSTOMER_STATEMENT", "SUPPLIER_STATEMENT",
  "PROFIT_LOSS_TALLY", "BALANCE_SHEET",
] as const;
export const REPORT_FORMATS = ["JSON", "CSV", "PDF", "XLSX"] as const;

const exportBody = z.object({
  reportType: z.enum(REPORT_TYPES),
  format: z.enum(REPORT_FORMATS).default("CSV"),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const exportsRouter = Router();
exportsRouter.use(authenticate);

/** Queue an async export → ReportJob + report.requested event for report-worker. */
exportsRouter.post("/export", authorize("report:export"), h(async (req, res) => {
  const b = parse(exportBody, req.body);
  const tenantId = req.auth!.tenantId;
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.reportJob.create({
      data: {
        tenantId,
        reportType: b.reportType,
        format: b.format,
        filters: b.filters as unknown as Prisma.InputJsonValue,
        status: "QUEUED",
        requestedById: req.auth!.sub,
      },
    });
    await writeOutbox(tx, tenantId, TOPICS.REPORT_REQUESTED, makeEnvelope(tenantId, {
      jobId: created.id, reportType: b.reportType, format: b.format,
    }, { actorUserId: req.auth!.sub }));
    return created;
  });
  res.status(202).json(job);
}));

/** Recent export jobs for this tenant. */
exportsRouter.get("/export", authorize("report:read"), h(async (req, res) => {
  res.json(await prisma.reportJob.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  }));
}));

exportsRouter.get("/export/:jobId", authorize("report:read"), h(async (req, res) => {
  const job = await prisma.reportJob.findFirst({ where: { id: req.params.jobId, tenantId: req.auth!.tenantId } });
  if (!job) throw notFound("Report job");
  res.json(job);
}));

/** Download a finished export (fileUrl holds a data: URL written by the worker). */
exportsRouter.get("/export/:jobId/download", authorize("report:read"), h(async (req, res) => {
  const job = await prisma.reportJob.findFirst({ where: { id: req.params.jobId, tenantId: req.auth!.tenantId } });
  if (!job) throw notFound("Report job");
  if (job.status !== "DONE" || !job.fileUrl) throw badRequest(`Report is ${job.status}${job.error ? ` — ${job.error}` : ""}`);

  const m = /^data:([^;]+);base64,(.*)$/s.exec(job.fileUrl);
  if (!m) throw badRequest("Corrupt report file");
  const [, contentType, b64] = m;
  const ext = job.format.toLowerCase();
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${job.reportType.toLowerCase()}-${job.id.slice(0, 8)}.${ext}"`);
  res.end(Buffer.from(b64, "base64"));
}));
