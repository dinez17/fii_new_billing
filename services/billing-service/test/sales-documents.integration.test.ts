import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { writeFileSync, mkdirSync } from "node:fs";
import { prisma, createTenantBackup, restoreTenantBackup, validateTenantBackup } from "@fii/database";
import { buildSalesDocumentPdfBuffer } from "@fii/pdf";
import { emailSalesDocument } from "../src/services/mail.service.js";
import { cancelSalesDocument, conversionBody, convertSalesDocument, createSalesDocument, documentBody, documentQuery, getSalesDocument, listSalesDocuments, updateSalesDocument } from "../src/services/sales-document.service.js";

const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("quotation and proforma sales workflow", () => {
  let tenantId = "", otherId = "", actorId = "", customerId = "", productId = "", mailServer: Server, smtpPort = 0;
  const messages: string[] = [];
  const date = "2026-10-30", due = "2026-11-15";
  const input = (patch: Record<string, unknown> = {}) => documentBody.parse({ kind: "QUOTATION", customerId, documentDate: date, validUntil: due, chargeGst: true, subject: "Wireless installation", poNumber: "PO-123", notes: "Installation at main office", items: [{ productId, description: "Network installation equipment", hsnSac: "8517", quantity: 1, unitPrice: 1000, discount: 0, gstRate: 18 }], ...patch });
  const conversion = (version: number, target = "INVOICE", chargeGst = true) => conversionBody.parse({ version, target, chargeGst, documentDate: date, dueDate: due });
  beforeAll(async () => {
    const suffix = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "Quotation test company", subdomain: `quotation-${suffix}`, stateCode: "33", addressLine1: "Business Street", city: "Dindigul", pincode: "624001", bankName: "Example Bank", bankAccountNo: "123456789", bankIfsc: "TEST0000001" } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Private other tenant", subdomain: `quotation-other-${suffix}` } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, name: "Quotation staff", email: "staff@example.test", passwordHash: "test-only", status: "ACTIVE" } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, code: "CUSTOMER-Q", name: "Quotation customer", email: "customer@example.test", additionalEmails: ["accounts@example.test"], phone: "9876543210", stateCode: "33", billingAddress: "Buyer billing address", serviceAddress: "Installation location", city: "Dindigul" } })).id;
    productId = (await prisma.product.create({ data: { tenantId, sku: "QUOTE-PRD", name: "Equipment", salePrice: 1000, gstRate: 18, stockQty: 50 } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isActive: true } });
    await prisma.setting.createMany({ data: [{ tenantId, group: "TERMS", key: "QUOTATION", value: "Quotation valid until the date stated. Installation subject to site readiness." }, { tenantId, group: "TERMS", key: "PROFORMA_INVOICE", value: "Advance payment requested. This is not a tax invoice." }] });
    mailServer = createServer(socket => {
      socket.setEncoding("utf8"); socket.write("220 Local test SMTP\r\n"); let buffer = "", data = false, message = "";
      socket.on("data", chunk => { buffer += chunk; let index: number;
        while ((index = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (data) { if (line === ".") { messages.push(message); message = ""; data = false; socket.write("250 Queued locally\r\n"); } else message += line + "\r\n"; }
          else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250 SIZE 10485760\r\n");
          else if (/^DATA/.test(line)) { data = true; socket.write("354 End with dot\r\n"); }
          else if (/^QUIT/.test(line)) { socket.end("221 Bye\r\n"); }
          else socket.write("250 OK\r\n");
        }
      });
    });
    await new Promise<void>(resolve => mailServer.listen(0, "127.0.0.1", resolve)); const address = mailServer.address(); smtpPort = typeof address === "object" && address ? address.port : 0;
    await prisma.setting.createMany({ data: Object.entries({ enabled: "true", host: "127.0.0.1", port: String(smtpPort), fromEmail: "billing@example.test", fromName: "Test Billing" }).map(([key, value]) => ({ tenantId, group: "SMTP", key, value })) });
  });
  afterAll(async () => {
    if (mailServer?.listening) await new Promise<void>(resolve => mailServer.close(() => resolve()));
    for (const table of ["salesDocument", "notificationLog", "auditLog", "outboxEvent", "stockMovement", "invoice", "product", "customer", "setting", "numberSeries", "financialYear", "user"] as const) await prisma[table].deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }); await prisma.$disconnect();
  });
  it("creates, edits and filters quotations without changing stock or accounting", async () => {
    const quote = await createSalesDocument(tenantId, actorId, input());
    expect(quote.kind).toBe("QUOTATION"); expect(String(quote.grandTotal)).toBe("1180"); expect(quote.terms).toContain("Quotation valid");
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(0); expect(await prisma.outboxEvent.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId } })).toBe(0); expect(await prisma.stockMovement.count({ where: { tenantId } })).toBe(0);
    const changed = await updateSalesDocument(tenantId, actorId, quote.id, input({ version: quote.version, subject: "Updated proposal" }));
    expect(changed.version).toBe(2); expect(changed.subject).toBe("Updated proposal");
    await expect(updateSalesDocument(tenantId, actorId, quote.id, input({ version: 1 }))).rejects.toThrow(/another tab/);
    expect((await listSalesDocuments(tenantId, documentQuery.parse({ search: "Updated", kind: "QUOTATION", from: date, to: date }))).items.some(row => row.id === quote.id)).toBe(true);
    await cancelSalesDocument(tenantId, actorId, quote.id, 2, "Customer postponed work");
    await expect(convertSalesDocument(tenantId, actorId, quote.id, conversion(3))).rejects.toThrow(/cancelled or converted/);
  });
  it("isolates tenants and rejects foreign/inactive customers, products and invalid inputs", async () => {
    const quote = await createSalesDocument(tenantId, actorId, input());
    await expect(getSalesDocument(otherId, quote.id)).rejects.toThrow(/not found/);
    await expect(cancelSalesDocument(otherId, actorId, quote.id, 1, "No access")).rejects.toThrow(/not found/);
    await expect(convertSalesDocument(otherId, actorId, quote.id, conversion(1))).rejects.toThrow(/not found/);
    expect((await listSalesDocuments(otherId, documentQuery.parse({}))).total).toBe(0);
    await expect(createSalesDocument(otherId, actorId, input())).rejects.toThrow();
    await prisma.customer.update({ where: { id: customerId }, data: { isActive: false } });
    await expect(createSalesDocument(tenantId, actorId, input())).rejects.toThrow(/customer/i);
    await prisma.customer.update({ where: { id: customerId }, data: { isActive: true } });
    expect(() => input({ validUntil: "2026-10-01" })).toThrow();
    expect(() => input({ items: [{ description: "Invalid", quantity: 1, unitPrice: 10, discount: 11, gstRate: 18 }] })).toThrow();
  });
  it("converts quotation → proforma → without-GST invoice, with independent numbers and one stock movement", async () => {
    const quote = await createSalesDocument(tenantId, actorId, input());
    const proforma = await convertSalesDocument(tenantId, actorId, quote.id, conversion(1, "PROFORMA"));
    const proformaRow = await getSalesDocument(tenantId, proforma.id);
    expect(proformaRow.documentNumber).toMatch(/^PI\/2026-27\//);
    expect(proformaRow.kind).toBe("PROFORMA"); expect(proformaRow.sourceDocumentId).toBe(quote.id); expect(proformaRow.terms).toContain("Advance payment");
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(0);
    const result = await convertSalesDocument(tenantId, actorId, proforma.id, conversion(1, "INVOICE", false));
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.id } });
    expect(invoice.chargeGst).toBe(false); expect(String(invoice.grandTotal)).toBe("1000"); expect(String(invoice.cgst)).toBe("0"); expect(invoice.poNumber).toBe("PO-123"); expect(invoice.invoiceNumber).toMatch(/^NG/);
    expect((await getSalesDocument(tenantId, proforma.id)).invoiceId).toBe(invoice.id);
    expect(await prisma.stockMovement.count({ where: { tenantId, refId: invoice.id, type: "SALE_OUT" } })).toBe(1);
  });
  it("creates a direct GST invoice and rejects duplicate simultaneous conversion", async () => {
    const quote = await createSalesDocument(tenantId, actorId, input({ chargeGst: false }));
    const results = await Promise.allSettled([convertSalesDocument(tenantId, actorId, quote.id, conversion(1)), convertSalesDocument(tenantId, actorId, quote.id, conversion(1))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const source = await getSalesDocument(tenantId, quote.id); const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: source.invoiceId! } });
    expect(invoice.chargeGst).toBe(true); expect(String(invoice.grandTotal)).toBe("1180"); expect(String(invoice.cgst)).toBe("90"); expect(String(invoice.sgst)).toBe("90");
    expect(await prisma.outboxEvent.count({ where: { tenantId, topic: "invoice.created" } })).toBe(2);
  });
  it("rolls back conversion on insufficient stock or a locked financial year", async () => {
    const quote = await createSalesDocument(tenantId, actorId, input({ items: [{ productId, description: "Too much stock", quantity: 5000, unitPrice: 10, gstRate: 18 }] }));
    const before = await prisma.invoice.count({ where: { tenantId } });
    await expect(convertSalesDocument(tenantId, actorId, quote.id, conversion(1))).rejects.toThrow(/stock/i);
    expect((await getSalesDocument(tenantId, quote.id)).status).toBe("OPEN"); expect(await prisma.invoice.count({ where: { tenantId } })).toBe(before);
    await prisma.financialYear.updateMany({ where: { tenantId }, data: { isLocked: true } });
    await expect(convertSalesDocument(tenantId, actorId, quote.id, conversion(1, "PROFORMA"))).rejects.toThrow(/locked/i);
    await prisma.financialYear.updateMany({ where: { tenantId }, data: { isLocked: false } });
  });
  it("renders quotation and proforma PDFs, and sends an attachment through a local SMTP stand-in only", async () => {
    const quote = await createSalesDocument(tenantId, actorId, input());
    const proforma = await createSalesDocument(tenantId, actorId, input({ kind: "PROFORMA" }));
    mkdirSync("output/pdf", { recursive: true });
    for (const [id, filename] of [[quote.id, "quotation-preview.pdf"], [proforma.id, "proforma-preview.pdf"]]) {
      const { buffer } = await buildSalesDocumentPdfBuffer(tenantId, id); expect(buffer.subarray(0, 5).toString()).toBe("%PDF-"); writeFileSync(`output/pdf/${filename}`, buffer);
    }
    const result = await emailSalesDocument(tenantId, quote.id); expect(result.to).toContain("accounts@example.test");
    expect(messages).toHaveLength(1); expect(messages[0]).toContain("application/pdf"); expect(messages[0]).toContain("customer@example.test");
    expect(await prisma.notificationLog.findFirst({ where: { tenantId, refId: quote.id, status: "SENT" } })).not.toBeNull();
    await cancelSalesDocument(tenantId, actorId, quote.id, 1, "Withdraw proposal"); await expect(emailSalesDocument(tenantId, quote.id)).rejects.toThrow(/Cancelled/); expect(messages).toHaveLength(1);
  });
  it("includes quotations, proformas and conversion links in tenant backup without other tenants", async () => {
    const backup = await createTenantBackup(tenantId);
    expect(backup.tables.SalesDocument.length).toBeGreaterThan(0);
    expect(backup.tables.SalesDocument.every(row => row.tenantId === tenantId)).toBe(true);
    expect(backup.tables.SalesDocument.some(row => row.sourceDocumentId)).toBe(true);
    expect(validateTenantBackup(backup, tenantId).tables.SalesDocument).toEqual(backup.tables.SalesDocument);
    await prisma.outboxEvent.updateMany({ where: { tenantId }, data: { publishedAt: new Date() } });
    await restoreTenantBackup(tenantId, actorId, backup, data => JSON.stringify(data));
    expect(await prisma.salesDocument.count({ where: { tenantId } })).toBe(backup.tables.SalesDocument.length);
    const converted = await prisma.salesDocument.findFirstOrThrow({ where: { tenantId, invoiceId: { not: null } }, include: { invoice: true } });
    expect(converted.invoice?.tenantId).toBe(tenantId);
  });
  it("records SMTP failure without changing the open document or creating an invoice", async () => {
    await new Promise<void>(resolve => mailServer.close(() => resolve()));
    const quote = await createSalesDocument(tenantId, actorId, input());
    const before = await prisma.invoice.count({ where: { tenantId } });
    await expect(emailSalesDocument(tenantId, quote.id)).rejects.toThrow(/Email failed/);
    expect((await getSalesDocument(tenantId, quote.id)).status).toBe("OPEN");
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(before);
    expect(await prisma.notificationLog.findFirst({ where: { tenantId, refId: quote.id, status: "FAILED" } })).not.toBeNull();
  });
});
