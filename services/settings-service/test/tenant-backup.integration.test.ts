import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signAccessToken } from "@fii/auth";
import { AppError } from "@fii/common";
import { prisma, createTenantBackup, restoreTenantBackup, type TenantBackup } from "@fii/database";
import { tenantBackupRouter, encodeBackup, decodeBackup } from "../src/tenant-backup.routes.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("tenant backup HTTP authorization and encryption", () => {
  let server: Server, base = "", dir = "", a = "", b = "", actor = "", other = "", tokenA = "", tokenB = "", roleA = "", roleB = "";
  let emptyA: TenantBackup, emptyB: TenantBackup;
  const oldEnv = { key: process.env.MASTER_ENCRYPTION_KEY, private: process.env.JWT_PRIVATE_KEY_PATH, public: process.env.JWT_PUBLIC_KEY_PATH };
  const claims = (tenantId: string, sub: string, roleIds: string[], userType: "STAFF" | "CUSTOMER" = "STAFF") => ({ tenantId, sub, roleIds, userType, permVersion: 1 });
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "fii-backup-test-"));
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    writeFileSync(join(dir, "private.pem"), keys.privateKey); writeFileSync(join(dir, "public.pem"), keys.publicKey);
    process.env.JWT_PRIVATE_KEY_PATH = join(dir, "private.pem"); process.env.JWT_PUBLIC_KEY_PATH = join(dir, "public.pem"); process.env.MASTER_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const stamp = Date.now();
    a = (await prisma.tenant.create({ data: { name: "HTTP tenant A", subdomain: `http-bak-a-${stamp}` } })).id;
    b = (await prisma.tenant.create({ data: { name: "HTTP tenant B", subdomain: `http-bak-b-${stamp}` } })).id;
    actor = (await prisma.user.create({ data: { tenantId: a, name: "A", email: "a@example.test", passwordHash: "test" } })).id;
    other = (await prisma.user.create({ data: { tenantId: b, name: "B", email: "b@example.test", passwordHash: "test" } })).id;
    const permissions = await Promise.all(["read", "export", "update"].map((action) => prisma.permission.upsert({ where: { module_action: { module: "backup", action } }, update: {}, create: { module: "backup", action } })));
    for (const tenantId of [a, b]) {
      const role = await prisma.role.create({ data: { tenantId, code: "BACKUP_TEST", name: "Backup test", permissions: { create: permissions.map((p) => ({ permissionId: p.id })) } } });
      if (tenantId === a) roleA = role.id; else roleB = role.id;
    }
    emptyA = await createTenantBackup(a); emptyB = await createTenantBackup(b);
    await prisma.customer.create({ data: { tenantId: a, code: "A", name: "Private customer A" } });
    await prisma.customer.create({ data: { tenantId: b, code: "B", name: "Private customer B" } });
    tokenA = signAccessToken(claims(a, actor, [roleA])); tokenB = signAccessToken(claims(b, other, [roleB]));
    const app = express(); app.use("/backup", tenantBackupRouter);
    const errors: ErrorRequestHandler = (err, _req, res, _next) => { res.status(err instanceof AppError ? err.statusCode : 500).json({ error: { message: err.message } }); }; app.use(errors);
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("listen"); base = `http://127.0.0.1:${address.port}/backup`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (emptyA) await restoreTenantBackup(a, actor, emptyA, encodeBackup); if (emptyB) await restoreTenantBackup(b, other, emptyB, encodeBackup);
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [a, b] } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [roleA, roleB] } } }); await prisma.role.deleteMany({ where: { id: { in: [roleA, roleB] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [a, b] } } }); await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect(); if (dir) rmSync(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries({ MASTER_ENCRYPTION_KEY: oldEnv.key, JWT_PRIVATE_KEY_PATH: oldEnv.private, JWT_PUBLIC_KEY_PATH: oldEnv.public })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
  it("denies unauthenticated, unauthorized and customer-portal requests", async () => {
    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(base, { headers: { Authorization: `Bearer ${signAccessToken(claims(a, actor, []))}` } })).status).toBe(403);
    expect((await fetch(base, { headers: { Authorization: `Bearer ${signAccessToken(claims(a, actor, [roleA], "CUSTOMER"))}` } })).status).toBe(403);
  });
  it("authenticates encrypted files, blocks cross-tenant restore and scopes recovery downloads", async () => {
    const headers = { Authorization: `Bearer ${tokenA}` };
    const downloaded = await fetch(`${base}/download`, { headers }); expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toContain(".fiibak"); expect(downloaded.headers.get("cache-control")).toBe("no-store");
    const bytes = Buffer.from(await downloaded.arrayBuffer()); expect(bytes.toString()).not.toContain("Private customer A");
    expect(decodeBackup(bytes, a).tables.Customer).toHaveLength(1);
    const changed = Buffer.from(bytes); changed[changed.length - 4] ^= 1;
    expect(() => decodeBackup(changed, a)).toThrow("Invalid or damaged");
    const upload = { ...headers, "Content-Type": "application/octet-stream" };
    const preview = await fetch(`${base}/inspect`, { method: "POST", headers: upload, body: bytes }); expect(preview.status).toBe(200);
    const info = await preview.json() as { sha256: string };
    expect((await fetch(`${base}/inspect`, { method: "POST", headers: { ...upload, Authorization: `Bearer ${tokenB}` }, body: bytes })).status).toBe(400);
    expect((await fetch(`${base}/restore`, { method: "POST", headers: upload, body: bytes })).status).toBe(400);
    expect((await fetch(`${base}/restore`, { method: "POST", headers: { ...upload, Authorization: `Bearer ${tokenB}`, "X-Backup-Confirmation": info.sha256, "X-Restore-Confirm": "RESTORE" }, body: bytes })).status).toBe(400);
    const result = await fetch(`${base}/restore`, { method: "POST", headers: { ...upload, "X-Backup-Confirmation": info.sha256, "X-Restore-Confirm": "RESTORE" }, body: bytes }); expect(result.status).toBe(200);
    const restored = await result.json() as { recoveryId: string };
    expect((await fetch(`${base}/recovery/${restored.recoveryId}`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/recovery/${restored.recoveryId}`, { headers: { Authorization: `Bearer ${tokenB}` } })).status).toBe(404);
    expect((await prisma.customer.findFirstOrThrow({ where: { tenantId: b } })).name).toBe("Private customer B");
    expect((await fetch(`${base}/restore`, { method: "POST", headers: upload, body: "PGDMP-old-whole-database-backup" })).status).toBe(400);
  });
});
