import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@fii/database";
import { signAccessToken } from "@fii/auth";
import { AppError } from "@fii/common";
import { legacyImportsRouter } from "../src/legacy-imports.js";
const d = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
d("legacy archive API tenant boundaries", () => {
  let server: Server, base = "", token = "", foreign = "", recordId = "";
  const tenantIds: string[] = [];
  beforeAll(async () => {
    vi.stubEnv("JWT_PRIVATE_KEY_PATH", "keys/jwt-private.pem"); vi.stubEnv("JWT_PUBLIC_KEY_PATH", "keys/jwt-public.pem");
    const stamp = Date.now();
    for (const suffix of ["a", "b"]) tenantIds.push((await prisma.tenant.create({ data: { name: "Legacy API Test", subdomain: `legacy-api-${stamp}-${suffix}` } })).id);
    const role = await prisma.role.findFirstOrThrow({ where: { code: "ADMIN", tenantId: null } });
    const claims = (tenantId: string) => ({ sub: "archive-test", tenantId, userType: "STAFF" as const, roleIds: [role.id], permVersion: 1 });
    token = signAccessToken(claims(tenantIds[0])); foreign = signAccessToken(claims(tenantIds[1]));
    recordId = `legacy-api-record-${stamp}`;
    await prisma.legacyRecord.create({ data: { id: recordId, tenantId: tenantIds[0], sourceHash: "test", sourceTable: "user_bills", sourceId: "123", status: "REVIEW", reason: "Receipt mismatch", data: { billno: "TEST-123", billtotamt: "100.00" } } });
    const app = express(); app.use("/legacy", legacyImportsRouter);
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(err instanceof AppError ? err.statusCode : 500).json({ error: "Request rejected" }); });
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); if (!address || typeof address === "string") throw Error("No test listener"); base = `http://127.0.0.1:${address.port}/legacy`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.legacyRecord.deleteMany({ where: { tenantId: { in: tenantIds } } }); await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); await prisma.$disconnect(); vi.unstubAllEnvs();
  });
  it("provides own summary/list/detail without caching and never leaks another tenant", async () => {
    const own = await fetch(`${base}/records?status=REVIEW`, { headers: { authorization: `Bearer ${token}` } });
    expect(own.status).toBe(200); expect(own.headers.get("cache-control")).toBe("no-store"); expect((await own.json()).total).toBe(1);
    const other = await fetch(`${base}/records`, { headers: { authorization: `Bearer ${foreign}` } }); expect((await other.json()).total).toBe(0);
    expect((await fetch(`${base}/records/${recordId}`, { headers: { authorization: `Bearer ${foreign}` } })).status).toBe(404);
    expect((await fetch(`${base}/records/${recordId}`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });
  it("requires authentication/backup permission and rejects invalid filters", async () => {
    expect((await fetch(`${base}/summary`)).status).toBe(401);
    const noPerm = signAccessToken({ sub: "denied", tenantId: tenantIds[0], userType: "STAFF", roleIds: [], permVersion: 1 });
    expect((await fetch(`${base}/records`, { headers: { authorization: `Bearer ${noPerm}` } })).status).toBe(403);
    expect((await fetch(`${base}/records?page=-1`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(400);
  });
});
