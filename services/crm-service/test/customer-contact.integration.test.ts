import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { createCustomer, updateCustomer } from "../src/services/customer.service.js";
import { customerBody } from "../src/validators.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("customer contacts and separate installation address", () => {
  let tenantId = "", customerId = "", userId = "";
  beforeAll(async () => { tenantId = (await prisma.tenant.create({ data: { name: "Contacts test", subdomain: `contacts-${Date.now()}` } })).id; });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.numberSeries.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });
  it("persists independent addresses and keeps portal identity tied to primary email", async () => {
    const input = customerBody.parse({ name: "Customer", email: "primary@example.test", additionalEmails: ["accounts@example.test"], billingAddress: "Billing street", city: "Chennai", stateName: "Tamil Nadu", stateCode: "33", pincode: "600001", serviceAddress: "Install street", installationCity: "Bengaluru", installationState: "Karnataka", installationStateCode: "29", installationPincode: "560001" });
    const customer = await createCustomer(tenantId, input); customerId = customer.id;
    expect(customer).toMatchObject({ city: "Chennai", installationCity: "Bengaluru", installationStateCode: "29", additionalEmails: ["accounts@example.test"] });
    userId = (await prisma.user.create({ data: { tenantId, customerId, userType: "CUSTOMER", email: input.email!, name: "Customer", passwordHash: "not-a-login" } })).id;
    await updateCustomer(tenantId, customerId, { email: "new-primary@example.test", additionalEmails: ["receipts@example.test"] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe("new-primary@example.test");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).installationPincode).toBe("560001");
    await expect(updateCustomer(tenantId, customerId, { email: null })).rejects.toThrow("Primary email is required");
    await expect(updateCustomer("different-tenant", customerId, { name: "Wrong" })).rejects.toThrow("Customer not found");
    await updateCustomer(tenantId, customerId, { additionalEmails: [] });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).additionalEmails).toEqual([]);
  });
});
