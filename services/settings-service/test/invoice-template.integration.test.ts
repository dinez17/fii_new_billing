import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { prisma } from "@fii/database";

vi.mock("@fii/auth", () => ({
  authenticate: (req: { headers: Record<string, string>; auth?: object }, res: { sendStatus: (status: number) => void }, next: () => void) => {
    if (!req.headers["x-test-tenant"]) { res.sendStatus(401); return; }
    req.auth = { tenantId: req.headers["x-test-tenant"], sub: "template-test" }; next();
  },
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("tenant invoice format settings", () => {
  const tenant = `template-test-${Date.now()}`, other = `${tenant}-other`;
  let server: Server, base: string;
  beforeAll(async () => {
    const { app } = await import("../src/index.js");
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/v1/settings/group/INVOICE`;
  });
  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { tenantId: { in: [tenant, other] } } });
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it("requires authentication", async () => { expect((await fetch(base)).status).toBe(401); });
  it("saves every supported format and keeps other tenants separate", async () => {
    for (const template of ["COMMERCIAL", "TALLY", "CLASSIC", "MODERN", "MINIMAL", "COMPACT", "TELECOM_STATEMENT", "SERVICE_TAX", "IT_SERVICES"]) {
      const response = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json", "x-test-tenant": tenant }, body: JSON.stringify({ template }) });
      expect(response.status).toBe(200);
      expect(await (await fetch(base, { headers: { "x-test-tenant": tenant } })).json()).toEqual({ template });
      expect(await (await fetch(base, { headers: { "x-test-tenant": other } })).json()).toEqual({});
    }
  });
  it("rejects an unsupported format without replacing the saved choice", async () => {
    const response = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json", "x-test-tenant": tenant }, body: JSON.stringify({ template: "INVALID" }) });
    expect(response.status).toBe(400);
    expect(await (await fetch(base, { headers: { "x-test-tenant": tenant } })).json()).toEqual({ template: "IT_SERVICES" });
  });
  it("saves the without-GST profile atomically and isolates it by tenant", async () => {
    const url = base.replace(/INVOICE$/, "NON_GST_COMPANY");
    const headers = { "Content-Type": "application/json", "x-test-tenant": tenant };
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify({ enabled: "true", name: "Separate Services", bankName: "NG Bank", bankAccountNo: "001234", bankIfsc: "tmbl0000283" }) })).status).toBe(200);
    expect(await (await fetch(url, { headers })).json()).toMatchObject({ enabled: "true", name: "Separate Services", bankAccountNo: "001234", bankIfsc: "TMBL0000283" });
    expect(await (await fetch(url, { headers: { "x-test-tenant": other } })).json()).toEqual({});
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify({ name: "Wrong replacement", bankIfsc: "INVALID" }) })).status).toBe(400);
    expect(await (await fetch(url, { headers })).json()).toMatchObject({ name: "Separate Services", bankIfsc: "TMBL0000283" });
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify({ gstin: "33AAACT2664C1ZS" }) })).status).toBe(400);
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify({ enabled: "false" }) })).status).toBe(200);
    expect(await (await fetch(url, { headers })).json()).toMatchObject({ enabled: "false", name: "Separate Services" });
  });

});
