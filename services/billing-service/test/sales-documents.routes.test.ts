import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(async (_tenantId: string, _query: unknown) => ({ items: [], total: 0 })), convert: vi.fn(async (_tenantId: string, _actorId: string, _id: string, _input: unknown) => ({ id: "target", kind: "INVOICE" })) }));
vi.mock("@fii/auth", () => ({
  authenticate: (req: { headers: Record<string, string>; auth?: object }, res: { sendStatus: (code: number) => void }, next: () => void) => { if (!req.headers["x-tenant"]) { res.sendStatus(401); return; } req.auth = { tenantId: req.headers["x-tenant"], sub: "staff" }; next(); },
  authorize: (permission: string) => (req: { headers: Record<string, string> }, res: { sendStatus: (code: number) => void }, next: () => void) => { if (!(req.headers["x-permissions"] || "").split(",").includes(permission)) { res.sendStatus(403); return; } next(); },
}));
vi.mock("../src/services/sales-document.service.js", async original => ({ ...await original<object>(), listSalesDocuments: mocks.list, convertSalesDocument: mocks.convert }));
describe("quotation route permissions", () => {
  let server: Server, base: string;
  beforeAll(async () => { const { salesDocumentsRouter } = await import("../src/routes/sales-documents.routes.js"); const app = express(); app.use(express.json()); app.use("/documents", salesDocumentsRouter); server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address(); base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/documents`; });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  it("requires authentication and invoice read permission", async () => { expect((await fetch(base)).status).toBe(401); expect((await fetch(base, { headers: { "x-tenant": "alpha" } })).status).toBe(403); });
  it("scopes list queries to the signed-in tenant", async () => { expect((await fetch(base + "?tenantId=beta", { headers: { "x-tenant": "alpha", "x-permissions": "invoice:read" } })).status).toBe(200); expect(mocks.list.mock.calls[0]?.[0]).toBe("alpha"); });
  it("requires both create and update permission for conversion", async () => {
    const body = JSON.stringify({ target: "INVOICE", chargeGst: false, documentDate: "2026-10-30", dueDate: "2026-11-15", version: 1, tenantId: "beta" });
    const send = (permissions: string) => fetch(base + "/document/convert", { method: "POST", headers: { "content-type": "application/json", "x-tenant": "alpha", "x-permissions": permissions }, body });
    expect((await send("invoice:create")).status).toBe(403); expect((await send("invoice:update")).status).toBe(403); expect(mocks.convert).not.toHaveBeenCalled();
    expect((await send("invoice:create,invoice:update")).status).toBe(200); expect(mocks.convert.mock.calls[0]?.[0]).toBe("alpha");
  });
});
