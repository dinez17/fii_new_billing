import { Router } from "express";
import { authenticate, authorize } from "@fii/auth";
import * as roles from "../services/role.service.js";
import { h, parse } from "../http.js";
import { createRoleBody, rolePermissionsBody } from "../validators.js";

export const rolesRouter = Router();
rolesRouter.use(authenticate);

rolesRouter.get("/", authorize("role:read"), h(async (req, res) => {
  res.json(await roles.listRoles(req.auth!.tenantId));
}));

rolesRouter.get("/permissions", authorize("role:read"), h(async (_req, res) => {
  res.json(await roles.listPermissions());
}));

rolesRouter.get("/:id", authorize("role:read"), h(async (req, res) => {
  res.json(await roles.getRole(req.auth!.tenantId, req.params.id));
}));

rolesRouter.post("/", authorize("role:create"), h(async (req, res) => {
  const b = parse(createRoleBody, req.body);
  res.status(201).json(await roles.createRole(req.auth!.tenantId, req.auth!.sub, b));
}));

rolesRouter.put("/:id/permissions", authorize("role:update"), h(async (req, res) => {
  const b = parse(rolePermissionsBody, req.body);
  await roles.updateRolePermissions(req.auth!.tenantId, req.auth!.sub, req.params.id, b.permissionIds);
  res.json({ ok: true });
}));

rolesRouter.delete("/:id", authorize("role:delete"), h(async (req, res) => {
  await roles.deleteRole(req.auth!.tenantId, req.auth!.sub, req.params.id);
  res.json({ ok: true });
}));
