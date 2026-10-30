import { Router } from "express";
import { authenticate, authorize } from "@fii/auth";
import * as users from "../services/user.service.js";
import { h, parse } from "../http.js";
import { createUserBody, pagination, resetPasswordBody, updateUserBody } from "../validators.js";

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get("/", authorize("user:read"), h(async (req, res) => {
  const q = parse(pagination, req.query);
  res.json(await users.listUsers(req.auth!.tenantId, q));
}));

usersRouter.post("/", authorize("user:create"), h(async (req, res) => {
  const b = parse(createUserBody, req.body);
  res.status(201).json(await users.createUser(req.auth!.tenantId, req.auth!.sub, b));
}));

usersRouter.put("/:id", authorize("user:update"), h(async (req, res) => {
  const b = parse(updateUserBody, req.body);
  await users.updateUser(req.auth!.tenantId, req.auth!.sub, req.params.id, b);
  res.json({ ok: true });
}));

usersRouter.delete("/:id", authorize("user:delete"), h(async (req, res) => {
  await users.deleteUser(req.auth!.tenantId, req.auth!.sub, req.params.id);
  res.json({ ok: true });
}));

usersRouter.post("/:id/reset-password", authorize("user:update"), h(async (req, res) => {
  const b = parse(resetPasswordBody, req.body);
  await users.resetUserPassword(req.auth!.tenantId, req.auth!.sub, req.params.id, b.newPassword);
  res.json({ ok: true });
}));
