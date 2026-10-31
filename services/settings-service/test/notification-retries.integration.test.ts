import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const sendMail = vi.fn();
import { prisma } from "@fii/database";
import { deliverNotification, retryNotifications } from "../../../workers/notification-worker/src/send.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("persistent notification retries", () => {
  let tenantId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Retry test", email: "company@retry.example.test", subdomain: `retry-${Date.now()}` } })).id;
    await prisma.setting.createMany({ data: Object.entries({ enabled: "true", host: "smtp.example.test", fromEmail: "sender@example.test" }).map(([key, value]) => ({ tenantId, group: "SMTP", key, value })) });
  });
  afterAll(async () => {
    await prisma.notificationLog.deleteMany({ where: { tenantId } }); await prisma.setting.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect();
  });
  it("retries the failed channel with a stable message id and increments its attempts", async () => {
    const row = await prisma.notificationLog.create({ data: { tenantId, channel: "EMAIL", to: "customer@example.test", body: "Hello <customer>", subject: "Invoice" } });
    sendMail.mockRejectedValueOnce(new Error("SMTP unavailable")).mockResolvedValue({});
    await deliverNotification(row.id, undefined, sendMail);
    const failed = await prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed.error).toContain("SMTP unavailable"); expect(failed.status).toBe("FAILED"); expect(failed.attempts).toBe(1); expect(failed.nextAttemptAt).not.toBeNull();
    await deliverNotification(row.id, undefined, sendMail); expect(sendMail).toHaveBeenCalledTimes(1);
    await prisma.notificationLog.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    await retryNotifications(sendMail);
    const sent = await prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(sent.status).toBe("SENT"); expect(sent.attempts).toBe(2);
    expect(sendMail.mock.calls[0]![0].messageId).toBe(sendMail.mock.calls[1]![0].messageId);
    expect(sendMail.mock.calls[1]![0].html).toBe("Hello &lt;customer&gt;");
    expect(sendMail.mock.calls[0]![0].cc).toBe("company@retry.example.test");
    expect(sendMail.mock.calls[1]![0].cc).toBe("company@retry.example.test");
  });
  it("avoids duplicate company copies and never uses another tenant company",async()=>{
    sendMail.mockClear();sendMail.mockResolvedValue({});
    const row=await prisma.notificationLog.create({data:{tenantId,channel:"EMAIL",to:"COMPANY@retry.example.test",body:"Direct company notification"}});
    await deliverNotification(row.id,undefined,sendMail);expect(sendMail.mock.calls[0]![0].cc).toBeUndefined();
    const other=await prisma.tenant.create({data:{name:"Other company",subdomain:`retry-other-${Date.now()}`,email:"other-company@example.test"}});
    try{const own=await prisma.notificationLog.create({data:{tenantId:other.id,channel:"EMAIL",to:"other-customer@example.test",body:"Other tenant notification"}});await deliverNotification(own.id,undefined,sendMail);expect(sendMail.mock.calls[1]![0].cc).toBe("other-company@example.test");}finally{await prisma.notificationLog.deleteMany({where:{tenantId:other.id}});await prisma.tenant.delete({where:{id:other.id}});}
  });
  it("allows one sender per lease and caps automatic attempts", async () => {
    sendMail.mockClear(); sendMail.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 30)); return {}; });
    const row = await prisma.notificationLog.create({ data: { tenantId, channel: "EMAIL", to: "customer@example.test", body: "Test" } });
    await Promise.all([deliverNotification(row.id, undefined, sendMail), deliverNotification(row.id, undefined, sendMail)]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const exhausted = await prisma.notificationLog.create({ data: { tenantId, channel: "EMAIL", to: "customer@example.test", status: "FAILED", attempts: 5, nextAttemptAt: new Date(0) } });
    await deliverNotification(exhausted.id, undefined, sendMail); expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
