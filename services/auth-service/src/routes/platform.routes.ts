import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "@fii/auth";
import { h, parse } from "../http.js";
import * as platform from "../services/platform.service.js";

export const platformRouter = Router();
platformRouter.use(authenticate);
const adminFields = { name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes") };
platformRouter.get("/:id/admins", authorize("platform:read"), h(async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await platform.listTenantAdmins(req.params.id)); }));
platformRouter.post("/:id/admins", authorize("platform:update"), h(async (req, res) => res.status(201).json(await platform.createTenantAdmin(req.auth!.sub, req.params.id, parse(z.object(adminFields), req.body)))));
platformRouter.put("/:id/admins/:userId", authorize("platform:update"), h(async (req, res) => res.json(await platform.updateTenantAdmin(req.auth!.sub, req.params.id, req.params.userId, parse(z.object({ name: adminFields.name, email: adminFields.email }), req.body)))));
platformRouter.post("/:id/admins/:userId/reset-password", authorize("platform:update"), h(async (req, res) => { await platform.updateTenantAdmin(req.auth!.sub, req.params.id, req.params.userId, parse(z.object({ password: adminFields.password }), req.body)); res.json({ ok: true }); }));

const paging = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().optional(), status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"]).optional() });
const createBody = z.object({ name: z.string().min(2).max(120), subdomain: z.string().min(2).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/), adminName: z.string().min(2), adminEmail: z.string().email(), adminPassword: z.string().min(12).max(72), trialDays: z.coerce.number().int().min(0).max(365).default(30), maxUsers: z.coerce.number().int().min(1).max(10000).default(10), maxCustomers: z.coerce.number().int().min(1).max(10_000_000).default(1000) });
const licenseBody = z.object({ planCode: z.string().min(2).max(40), status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"]), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), maxUsers: z.coerce.number().int().min(1), maxCustomers: z.coerce.number().int().min(1), notes: z.string().max(500).optional() });

platformRouter.get("/", authorize("platform:read"), h(async (req, res) => res.json(await platform.listTenants(parse(paging, req.query)))));
platformRouter.get("/:id", authorize("platform:read"), h(async (req, res) => res.json(await platform.getTenant(req.params.id))));
platformRouter.post("/", authorize("platform:create"), h(async (req, res) => res.status(201).json(await platform.createTenant(req.auth!.sub, parse(createBody, req.body)))));
platformRouter.put("/:id", authorize("platform:update"), h(async (req, res) => res.json(await platform.updateTenant(req.params.id, parse(z.object({ name: z.string().min(2).optional(), subdomain: z.string().trim().toLowerCase().min(2).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use letters, numbers and internal hyphens only").refine((value) => value !== "platform", "The platform subdomain is reserved").optional(), legalName: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional() }), req.body)))));
platformRouter.post("/:id/license", authorize("platform:update"), h(async (req, res) => res.json(await platform.updateLicense(req.auth!.sub, req.params.id, parse(licenseBody, req.body)))));
platformRouter.post("/:id/suspend", authorize("platform:update"), h(async (req, res) => { await platform.suspendTenant(req.auth!.sub, req.params.id, parse(z.object({ reason: z.string().min(3).max(500) }), req.body).reason); res.json({ ok: true }); }));
