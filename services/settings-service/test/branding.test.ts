import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
const { findTenant } = vi.hoisted(() => ({ findTenant: vi.fn(async ({ where }: { where: { id: string } }) => ({ name: where.id === "alpha" ? "Alpha Company" : "Beta Company", logoUrl: where.id === "alpha" ? "data:image/png;base64,alpha" : null })) }));
vi.mock("@fii/database", () => ({ prisma: { tenant: { findUniqueOrThrow: findTenant } } }));
vi.mock("@fii/auth", () => ({
  authenticate: (req: { headers: Record<string, string>; auth?: object }, res: { sendStatus: (status: number) => void }, next: () => void) => { if (!req.headers["x-test-tenant"]) { res.sendStatus(401); return; } req.auth = { tenantId: req.headers["x-test-tenant"], sub: "staff" }; next(); },
  authorize: () => (_req: unknown, res: { sendStatus: (status: number) => void }) => res.sendStatus(403),
}));
describe("sidebar tenant branding contract", () => {
  let server: Server, base: string;
  beforeAll(async () => { const { app } = await import("../src/index.js"); server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address(); base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/v1/settings`; });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  it("requires authentication", async () => { expect((await fetch(`${base}/branding`)).status).toBe(401); });
  it("returns only the authenticated tenant's branding without settings permission", async () => {
    const response = await fetch(`${base}/branding?tenantId=beta`, { headers: { "x-test-tenant": "alpha" } });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ name: "Alpha Company", logoUrl: "data:image/png;base64,alpha" });
    expect(findTenant).toHaveBeenLastCalledWith({ where: { id: "alpha" }, select: { name: true, logoUrl: true } });
    expect((await fetch(`${base}/company`, { headers: { "x-test-tenant": "alpha" } })).status).toBe(403);
  });
  it("keeps a second tenant's missing logo separate", async () => { expect(await (await fetch(`${base}/branding`, { headers: { "x-test-tenant": "beta" } })).json()).toEqual({ name: "Beta Company", logoUrl: null }); });
});
