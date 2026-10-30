import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "@fii/auth";
import { buildSalesDocumentPdfBuffer } from "@fii/pdf";
import { h, parse } from "../http.js";
import * as documents from "../services/sales-document.service.js";
import { emailSalesDocument } from "../services/mail.service.js";

export const salesDocumentsRouter = Router();
salesDocumentsRouter.use(authenticate);
salesDocumentsRouter.get("/", authorize("invoice:read"), h(async (req, res) => { res.json(await documents.listSalesDocuments(req.auth!.tenantId, parse(documents.documentQuery, req.query))); }));
salesDocumentsRouter.get("/:id", authorize("invoice:read"), h(async (req, res) => { res.json(await documents.getSalesDocument(req.auth!.tenantId, req.params.id)); }));
salesDocumentsRouter.post("/", authorize("invoice:create"), h(async (req, res) => { res.status(201).json(await documents.createSalesDocument(req.auth!.tenantId, req.auth!.sub, parse(documents.documentBody, req.body))); }));
salesDocumentsRouter.put("/:id", authorize("invoice:update"), h(async (req, res) => { res.json(await documents.updateSalesDocument(req.auth!.tenantId, req.auth!.sub, req.params.id, parse(documents.documentBody, req.body))); }));
salesDocumentsRouter.post("/:id/cancel", authorize("invoice:update"), h(async (req, res) => {
  const body = parse(z.object({ version: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }), req.body);
  res.json(await documents.cancelSalesDocument(req.auth!.tenantId, req.auth!.sub, req.params.id, body.version, body.reason));
}));
salesDocumentsRouter.post("/:id/convert", authorize("invoice:create"), authorize("invoice:update"), h(async (req, res) => { res.json(await documents.convertSalesDocument(req.auth!.tenantId, req.auth!.sub, req.params.id, parse(documents.conversionBody, req.body))); }));
salesDocumentsRouter.get("/:id/pdf", authorize("invoice:read"), h(async (req, res) => {
  const { buffer, document } = await buildSalesDocumentPdfBuffer(req.auth!.tenantId, req.params.id);
  res.setHeader("Content-Type", "application/pdf"); res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `inline; filename="${document.documentNumber.replace(/[^a-zA-Z0-9._-]/g, "-")}.pdf"`); res.send(buffer);
}));
salesDocumentsRouter.post("/:id/email", authorize("invoice:read"), h(async (req, res) => { res.json(await emailSalesDocument(req.auth!.tenantId, req.params.id)); }));
