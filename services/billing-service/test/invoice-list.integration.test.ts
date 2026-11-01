import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { invoiceListQuery } from "../src/validators.js";
import { listInvoices } from "../src/services/invoice.service.js";

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("invoice status, FY, inclusive date range and balances", () => {
  let tenantId = "", customerId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Invoice filters", subdomain: `invoice-filters-${Date.now()}` } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, name: "Filter customer", code: "FILTER" } })).id;
    const base = { tenantId, customerId, fyCode: "2026-27", invoiceDate: new Date("2026-10-27T18:00:00Z"), dueDate: new Date("2026-11-01"), placeOfSupply: "33", subTotal: "100", taxableValue: "100", grandTotal: "100" };
    await prisma.invoice.createMany({ data: [
      { ...base, invoiceNumber: "UNPAID", status: "UNPAID" },
      { ...base, invoiceNumber: "PARTIAL", status: "PARTIAL", amountPaid: "40", creditedAmount: "10" },
      { ...base, invoiceNumber: "PAID", status: "PAID", amountPaid: "100" },
      { ...base, invoiceNumber: "CANCELLED", status: "CANCELLED" },
      { ...base, invoiceNumber: "FUTURE", invoiceDate: new Date("2026-10-28") },
      { ...base, invoiceNumber: "OLD-FY", fyCode: "2025-26", invoiceDate: new Date("2026-03-31") },
    ] });
  });
  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });
  const query = { status: "OUTSTANDING", fyCode: "2026-27", from: "2026-04-01", to: "2026-10-27" };
  it("combines unpaid and partial status and includes the entire final day", async () => {
    const result = await listInvoices(tenantId, invoiceListQuery.parse(query));
    expect(result.total).toBe(2);
    expect(result.items.map((row) => row.status).sort()).toEqual(["PARTIAL", "UNPAID"]);
    expect(result.items.find((row) => row.status === "PARTIAL")?.balance).toBe("50.00");
    expect(result.items.find((row) => row.status === "UNPAID")?.balance).toBe("100.00");
    expect(String(result.totals.billed)).toBe("200");
    expect(String(result.totals.collected)).toBe("40");
  });
  it("uses numeric invoice ordering before pagination and keeps All statuses deterministic",async()=>{
    const base={tenantId,customerId,fyCode:"2026-27",invoiceDate:new Date("2026-11-01"),dueDate:new Date("2026-11-10"),placeOfSupply:"33",subTotal:100,taxableValue:100,grandTotal:100};
    const data=[{...base,invoiceNumber:"FII/26-27/9",status:"PAID" as const},{...base,invoiceNumber:"FII/26-27/89",status:"UNPAID" as const},{...base,invoiceNumber:"FII/26-27/98",status:"PARTIAL" as const},{...base,invoiceNumber:"FII/26-27/00099",status:"CANCELLED" as const},{...base,invoiceNumber:"FII/26-27/100",status:"UNPAID" as const},{...base,invoiceNumber:"FII/26-27/101",invoiceDate:new Date("2026-10-31"),status:"UNPAID" as const}];
    await prisma.invoice.createMany({data});
    try{
      const q=invoiceListQuery.parse({fyCode:"2026-27",from:"2026-10-31",to:"2026-11-01",limit:2});
      const first=await listInvoices(tenantId,q),second=await listInvoices(tenantId,{...q,page:2}),third=await listInvoices(tenantId,{...q,page:3});
      expect([...first.items,...second.items,...third.items].map(r=>r.invoiceNumber)).toEqual(["FII/26-27/100","FII/26-27/00099","FII/26-27/98","FII/26-27/89","FII/26-27/9","FII/26-27/101"]);
      expect((await listInvoices(tenantId,{...q,status:"OUTSTANDING",limit:10})).items.map(r=>r.invoiceNumber)).toEqual(["FII/26-27/100","FII/26-27/98","FII/26-27/89","FII/26-27/101"]);
    }finally{await prisma.invoice.deleteMany({where:{tenantId,invoiceNumber:{in:data.map(r=>r.invoiceNumber)}}});}
  });
  it("allows paid and cancelled filters without mixing their totals with other statuses", async () => {
    const paid = await listInvoices(tenantId, invoiceListQuery.parse({ ...query, status: "PAID" }));
    expect(paid.total).toBe(1);
    expect(paid.items[0].balance).toBe("0.00");
    expect(String(paid.totals.billed)).toBe("100");
    const cancelled = await listInvoices(tenantId, invoiceListQuery.parse({ ...query, status: "CANCELLED" }));
    expect(cancelled.total).toBe(1);
    expect(cancelled.items[0].balance).toBe("0.00");
    expect(String(cancelled.totals.billed)).toBe("0");
  });
});
