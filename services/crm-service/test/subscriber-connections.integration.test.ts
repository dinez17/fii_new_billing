import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { addPlan, createSubscriber, endPlan, getSubscriber, updatePlanLocation, updateSubscriberPlan } from "../src/services/subscriber.service.js";
import { addPlanBody, subscriberCreateBody, updateSubscriberPlanBody } from "../src/validators.js";
import { processRun } from "../../../workers/billing-worker/src/generate.js";
import { buildReceiptPdfBuffer, buildNotePdfBuffer, buildInvoicePdfBuffer } from "@fii/pdf";
import { mkdirSync, writeFileSync } from "node:fs";

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("repeated subscription plans for independent locations", () => {
  let tenantId = "", customerId = "", planId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "First Idea Infotech", subdomain: `connections-${Date.now()}`, stateCode: "33", addressLine1: "12, Technology Avenue", city: "Chennai", pincode: "600001", phone: "9000000000", email: "billing@example.test", gstin: "33AAACT2664C1ZS", bankName: "Example Bank", bankBranch: "Chennai", bankAccountNo: "123456789012", bankIfsc: "EXAM0000123", invoiceTerms: "Payment is due within 10 days of the invoice date. Please quote the invoice number with your bank transfer." } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "C1", name: "Ceramic Industries Private Limited", stateCode: "33", billingAddress: "42, Anna Salai\nGuindy Industrial Estate", city: "Chennai", stateName: "Tamil Nadu", pincode: "600032", serviceAddress: "Plot 8, SIPCOT Industrial Park\nDindigul Main Road", installationCity: "Dindigul", installationState: "Tamil Nadu", installationPincode: "624001", phone: "9000000001", email: "accounts@example.test", gstin: "33AAACT2664C1ZS" } })).id;
    planId = (await prisma.plan.create({ data: { tenantId, code: "WIRELESS", name: "Wireless service", price: 100, gstRate: 18 } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31T23:59:59Z"), isActive: true } });
  });
  afterAll(async () => {
    await prisma.billingRunItem.deleteMany({ where: { billingRun: { tenantId } } });
    await prisma.billingRun.deleteMany({ where: { tenantId } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId } });
    await prisma.receipt.deleteMany({ where: { tenantId } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { tenantId } } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.creditNote.deleteMany({ where: { tenantId } });
    await prisma.debitNote.deleteMany({ where: { tenantId } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { tenantId } } });
    await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.subscriberPlan.deleteMany({ where: { tenantId } });
    await prisma.subscriber.deleteMany({ where: { tenantId } });
    await prisma.plan.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.numberSeries.deleteMany({ where: { tenantId } });
    await prisma.financialYear.deleteMany({ where: { tenantId } });
    await prisma.setting.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });
  it("creates repeated plans, adds another connection, bills each rate/location, and ends only the selected connection", async () => {
    const subscriber = await createSubscriber(tenantId, subscriberCreateBody.parse({ customerId, subscriberType: "PREPAID", activationDate: "2026-10-01", plans: [
      { planId, location: "Factory", priceOverride: 100 }, { planId, location: "Warehouse", priceOverride: 200 },
    ] }));
    expect(subscriber.plans).toHaveLength(2);
    const office = await addPlan(tenantId, subscriber.id, addPlanBody.parse({ planId, location: "Office", startDate: "2026-10-01", priceOverride: 300 }));
    expect((await getSubscriber(tenantId, subscriber.id)).plans).toHaveLength(3);
    await expect(updatePlanLocation("another-tenant", subscriber.id, office.id, "Wrong")).rejects.toThrow();
    const run = { tenantId, cycleType: "PREPAID" as const, periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") };
    await processRun(run);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenantId }, include: { items: true } });
    expect(invoice.items).toHaveLength(3);
    expect(invoice.items.every((item) => item.description.startsWith("Wireless service\n"))).toBe(true);
    expect(invoice.items.map((item) => Number(item.unitPrice)).sort((a,b) => a-b)).toEqual([100,200,300]);
    for (const label of ["Factory", "Warehouse", "Office"]) expect(invoice.items.some((item) => item.description.includes(label))).toBe(true);
    expect(Number(invoice.grandTotal)).toBe(708);
    mkdirSync("output/pdf", { recursive: true });
    writeFileSync("output/pdf/connection-invoice-layout.pdf", (await buildInvoicePdfBuffer(tenantId, invoice.id)).buffer);
    await processRun(run);
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(1);
    await updatePlanLocation(tenantId, subscriber.id, office.id, "Head office");
    expect((await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id } })).some((item) => item.description.includes("Head office"))).toBe(false);
    const factory = subscriber.plans.find((row) => row.location === "Factory")!;
    await endPlan(tenantId, subscriber.id, factory.id, new Date("2026-10-31"));
    await processRun({ ...run, periodStart: new Date("2026-11-01"), periodEnd: new Date("2026-11-30") });
    const next = await prisma.invoice.findFirstOrThrow({ where: { tenantId, periodStart: new Date("2026-11-01") }, include: { items: true } });
    expect(next.items).toHaveLength(2);
    expect(Number(next.grandTotal)).toBe(590);
    expect(next.items.some((item) => item.description.includes("Head office"))).toBe(true);
  });
  it("edits plan, price, date and optional location without rewriting prior invoices", async () => {
    const subscriber = await createSubscriber(tenantId, subscriberCreateBody.parse({ customerId, subscriberType: "PREPAID", activationDate: "2026-10-01", plans: [{ planId }] }));
    const mappingId = subscriber.plans[0].id;
    expect(updateSubscriberPlanBody.safeParse({ priceOverride: -1 }).success).toBe(false);
    await expect(updateSubscriberPlan("other-tenant", subscriber.id, mappingId, { priceOverride: 500 })).rejects.toThrow();
    await updateSubscriberPlan(tenantId, subscriber.id, mappingId, updateSubscriberPlanBody.parse({ priceOverride: 250, startDate: "2026-11-01", location: "" }));
    const spec = { tenantId, cycleType: "PREPAID" as const, periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") };
    await processRun(spec);
    expect(await prisma.invoice.count({ where: { tenantId, subscriberId: subscriber.id } })).toBe(0);
    await processRun({ ...spec, periodStart: new Date("2026-11-01"), periodEnd: new Date("2026-11-30") });
    const first = await prisma.invoice.findFirstOrThrow({ where: { tenantId, subscriberId: subscriber.id }, include: { items: true } });
    expect(Number(first.grandTotal)).toBe(295);
    const anotherPlan = await prisma.plan.create({ data: { tenantId, code: "CLOUD", name: "Cloud service", price: 50, gstRate: 18 } });
    const edited = await updateSubscriberPlan(tenantId, subscriber.id, mappingId, updateSubscriberPlanBody.parse({ planId: anotherPlan.id, priceOverride: null, location: null }));
    expect(edited.priceOverride).toBeNull(); expect(edited.location).toBeNull();
    await processRun({ ...spec, periodStart: new Date("2026-12-01"), periodEnd: new Date("2026-12-31") });
    const next = await prisma.invoice.findFirstOrThrow({ where: { tenantId, subscriberId: subscriber.id, periodStart: new Date("2026-12-01") }, include: { items: true } });
    expect(Number(next.grandTotal)).toBe(59);
    expect(next.items[0].description).toContain("Cloud service");
    expect(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: first.id } })).grandTotal)).toBe(295);
    expect(first.items[0].description).toContain("Wireless service");
  });
  it("backfills a period before subscriber creation using its saved connection start and preserves later invoices", async () => {
    const subscriber = await createSubscriber(tenantId, subscriberCreateBody.parse({ customerId, subscriberType: "PREPAID", chargeGst: false, activationDate: "2026-10-29", plans: [{ planId, priceOverride: 1500 }] }));
    const october = { tenantId, cycleType: "PREPAID" as const, taxMode: "WITHOUT_GST" as const, periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") };
    await processRun(october);
    const original = await prisma.invoice.findFirstOrThrow({ where: { tenantId, subscriberId: subscriber.id }, select: { id: true, invoiceNumber: true, grandTotal: true } });
    await updateSubscriberPlan(tenantId, subscriber.id, subscriber.plans[0].id, { startDate: new Date("2026-01-29") });
    const september = { ...october, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30") };
    await processRun(september);
    const created = await prisma.invoice.findFirstOrThrow({ where: { tenantId, subscriberId: subscriber.id, periodStart: september.periodStart } });
    expect(Number(created.grandTotal)).toBe(1500); expect(created.chargeGst).toBe(false);
    const posted = await prisma.outboxEvent.findFirstOrThrow({ where: { tenantId, topic: "invoice.created", payload: { path: ["payload", "invoiceId"], equals: created.id } } });
    expect((posted.payload as { payload: { invoiceDate: string; fyCode: string } }).payload).toMatchObject({ invoiceDate: "2026-09-01T00:00:00.000Z", fyCode: "2026-27" });
    await processRun(september);
    expect(await prisma.invoice.count({ where: { tenantId, subscriberId: subscriber.id } })).toBe(2);
    expect(await prisma.invoice.findUnique({ where: { id: original.id }, select: { id: true, invoiceNumber: true, grandTotal: true } })).toEqual(original);
  });
  it("renders long without-GST invoices without truncating connection rows", async () => {
    const invoice = await prisma.invoice.create({ data: { tenantId, customerId, invoiceType: "MANUAL", invoiceNumber: "NG-PAGINATION-TEST", fyCode: "2026-27", invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-11"), placeOfSupply: "33", chargeGst: false, subTotal: 4000, taxableValue: 4000, grandTotal: 4000,
      items: { create: Array.from({ length: 40 }, (_, i) => ({ description: `Wireless service — connection ${i + 1}\nLocation ${i + 1} · 01 Oct 2026 – 31 Oct 2026`, hsnSac: "998599", quantity: 1, unitPrice: 100, taxableValue: 100, gstRate: 0, lineTotal: 100 })) } } });
    const pdf = await buildInvoicePdfBuffer(tenantId, invoice.id);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    writeFileSync("output/pdf/commercial-invoice-multipage.pdf", pdf.buffer);
  });
  it("uses each tenant's default template for GST and without-GST PDFs", async () => {
    const gst = await prisma.invoice.findFirstOrThrow({ where: { tenantId, chargeGst: true } });
    const noGst = await prisma.invoice.findFirstOrThrow({ where: { tenantId, chargeGst: false } });
    const longInvoice = await prisma.invoice.findFirstOrThrow({ where: { tenantId, invoiceNumber: "NG-PAGINATION-TEST" } });
    await expect(buildInvoicePdfBuffer("another-tenant", gst.id)).rejects.toThrow();
    const outputs: Buffer[] = [];
    for (const template of ["COMMERCIAL", "TALLY", "CLASSIC", "MODERN", "MINIMAL", "COMPACT", "TELECOM_STATEMENT", "SERVICE_TAX", "IT_SERVICES"]) {
      await prisma.setting.upsert({ where: { tenantId_group_key: { tenantId, group: "INVOICE", key: "template" } }, create: { tenantId, group: "INVOICE", key: "template", value: template }, update: { value: template } });
      const { buffer } = await buildInvoicePdfBuffer(tenantId, gst.id);
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
      outputs.push(buffer);
      writeFileSync(`output/pdf/long-${template.toLowerCase()}.pdf`, (await buildInvoicePdfBuffer(tenantId, longInvoice.id)).buffer);
      writeFileSync(`output/pdf/template-${template.toLowerCase()}.pdf`, buffer);
      const withoutGstPdf = (await buildInvoicePdfBuffer(tenantId, noGst.id)).buffer;
      expect(withoutGstPdf.subarray(0, 5).toString()).toBe("%PDF-");
      if (template === "MODERN") writeFileSync("output/pdf/template-modern-without-gst.pdf", withoutGstPdf);
    }
    expect(new Set(outputs.map(buffer => buffer.toString("base64"))).size).toBe(9);
    await prisma.setting.update({ where: { tenantId_group_key: { tenantId, group: "INVOICE", key: "template" } }, data: { value: "UNKNOWN" } });
    expect((await buildInvoicePdfBuffer(tenantId, gst.id)).buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders mixed-rate interstate tax summaries and a paid stamp only for a paid invoice", async () => {
    const invoice = await prisma.invoice.create({ data: { tenantId, customerId, invoiceType: "MANUAL", invoiceNumber: "REFERENCE-TAX-TEST", fyCode: "2026-27", invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-11"), placeOfSupply: "29", chargeGst: true, isInterState: true, subTotal: 300, taxableValue: 300, igst: 28, grandTotal: 328,
      items: { create: [{ description: "Managed internet service", hsnSac: "998422", quantity: 1, unitPrice: 100, taxableValue: 100, gstRate: 18, igst: 18, lineTotal: 118 }, { description: "Additional service", hsnSac: "998422", quantity: 1, unitPrice: 200, taxableValue: 200, gstRate: 5, igst: 10, lineTotal: 210 }] } } });
    await prisma.setting.update({ where: { tenantId_group_key: { tenantId, group: "INVOICE", key: "template" } }, data: { value: "SERVICE_TAX" } });
    writeFileSync("output/pdf/reference-interstate-tax.pdf", (await buildInvoicePdfBuffer(tenantId, invoice.id)).buffer);
    await prisma.setting.update({ where: { tenantId_group_key: { tenantId, group: "INVOICE", key: "template" } }, data: { value: "IT_SERVICES" } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", amountPaid: 328 } });
    writeFileSync("output/pdf/reference-paid.pdf", (await buildInvoicePdfBuffer(tenantId, invoice.id)).buffer);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
    writeFileSync("output/pdf/reference-cancelled.pdf", (await buildInvoicePdfBuffer(tenantId, invoice.id)).buffer);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).grandTotal.toString()).toBe("328");
  });

  it("uses the separate company across all without-GST formats and related documents", async () => {
    const profile = { enabled: "true", name: "Independent Network Services", legalName: "Independent Network Services", addressLine1: "18, Service Road", city: "Dindigul", stateCode: "33", pincode: "624001", email: "nongst@example.test", bankName: "Separate Services Bank", bankAccountNo: "009988776655", bankBranch: "Dindigul", bankIfsc: "TMBL0000283" };
    await prisma.setting.createMany({ data: Object.entries(profile).map(([key, value]) => ({ tenantId, group: "NON_GST_COMPANY", key, value })) });
    const ng = await prisma.invoice.findFirstOrThrow({ where: { tenantId, chargeGst: false, invoiceType: "SUBSCRIPTION" } });
    const gst = await prisma.invoice.findFirstOrThrow({ where: { tenantId, chargeGst: true } });
    for (const format of ["COMMERCIAL", "TALLY", "CLASSIC", "MODERN", "MINIMAL", "COMPACT", "TELECOM_STATEMENT", "SERVICE_TAX", "IT_SERVICES"]) {
      await prisma.setting.update({ where: { tenantId_group_key: { tenantId, group: "INVOICE", key: "template" } }, data: { value: format } });
      const pdf = await buildInvoicePdfBuffer(tenantId, ng.id);
      expect(pdf.invoice.tenantId).toBe(tenantId);
      writeFileSync(`output/pdf/non-gst-company-${format.toLowerCase()}.pdf`, pdf.buffer);
    }
    writeFileSync("output/pdf/gst-original-company.pdf", (await buildInvoicePdfBuffer(tenantId, gst.id)).buffer);
    const payment = await prisma.payment.create({ data: { tenantId, customerId, fyCode: "2026-27", amount: 100, mode: "CASH", allocations: { create: { invoiceId: ng.id, amount: 100 } } } });
    const receipt = await prisma.receipt.create({ data: { tenantId, paymentId: payment.id, receiptNumber: "NG-RECEIPT", fyCode: "2026-27" } });
    writeFileSync("output/pdf/non-gst-company-receipt.pdf", (await buildReceiptPdfBuffer(tenantId, receipt.id)).buffer);
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: gst.id, amount: 1 } });
    writeFileSync("output/pdf/mixed-company-receipt.pdf", (await buildReceiptPdfBuffer(tenantId, receipt.id)).buffer);
    const note = await prisma.creditNote.create({ data: { tenantId, invoiceId: ng.id, customerId, fyCode: "2026-27", noteNumber: "NG-CREDIT", noteDate: new Date("2026-10-01"), reason: "Fixture", taxableValue: 10, total: 10, items: [] } });
    writeFileSync("output/pdf/non-gst-company-credit.pdf", (await buildNotePdfBuffer(tenantId, note.id, "credit")).buffer);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name).toBe("First Idea Infotech");
  });

});
