import {createRequire} from "node:module";
import type {Server} from "node:http";
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {prisma,queueReceiptNotification} from "@fii/database";
import {encryptSecret,wapiClient} from "@fii/common";
import {sendReceipt} from "../src/services/receipt-delivery.js";
import {deliverNotification} from "../../../workers/notification-worker/src/send.js";
import {deliverWhatsappNotification} from "../../../workers/notification-worker/src/whatsapp.js";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("receipt email and WhatsApp delivery",()=>{
 let tenantId="",otherId="",customerId="",actorId="",base="",mock:Server,n=0;const run=Date.now();
 beforeAll(async()=>{
  mock=createRequire(import.meta.url)("../../../postman/mocks/wapi/default.js") as Server;await new Promise<void>(r=>mock.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${(mock.address() as any).port}`;
  tenantId=(await prisma.tenant.create({data:{name:"Receipt delivery",subdomain:`receipt-delivery-${run}`,email:"company@example.test"}})).id;
  otherId=(await prisma.tenant.create({data:{name:"Other receipt tenant",subdomain:`receipt-other-${run}`}})).id;
  actorId=(await prisma.user.create({data:{tenantId,name:"Tester",email:"staff@example.test",passwordHash:"not-a-login"}})).id;
  customerId=(await prisma.customer.create({data:{tenantId,name:"Receipt customer",code:"R1",email:"buyer@example.test",additionalEmails:["accounts@example.test"],phone:"9876543210",whatsappInvoiceEnabled:true}})).id;
  await prisma.setting.createMany({data:[{tenantId,group:"WHATSAPP",key:"enabled",value:"true"},{tenantId,group:"WHATSAPP",key:"provider",value:"FII_WAPI"},{tenantId,group:"WHATSAPP",key:"apiKey",value:encryptSecret(`test-receipt-${run}`),isSecret:true},{tenantId,group:"SMTP",key:"enabled",value:"true"},{tenantId,group:"SMTP",key:"host",value:"smtp.example.test"}]});
 });
 afterAll(async()=>{mock.closeAllConnections();await new Promise<void>(r=>mock.close(()=>r()));await prisma.notificationLog.deleteMany({where:{tenantId}});await prisma.auditLog.deleteMany({where:{tenantId}});await prisma.receipt.deleteMany({where:{tenantId}});await prisma.payment.deleteMany({where:{tenantId}});await prisma.setting.deleteMany({where:{tenantId}});await prisma.customer.deleteMany({where:{tenantId}});await prisma.user.deleteMany({where:{tenantId}});await prisma.tenant.deleteMany({where:{id:{in:[tenantId,otherId]}}});await prisma.$disconnect();});
 async function receipt(){const payment=await prisma.payment.create({data:{tenantId,customerId,fyCode:"2026-27",amount:100,mode:"CASH"}});return prisma.receipt.create({data:{tenantId,paymentId:payment.id,fyCode:"2026-27",receiptNumber:`REC/${++n}`}});}
 it("queues one email per request and attaches the receipt PDF with customer recipients and company CC",async()=>{
  const r=await receipt(),requestId=randomUUID();const first=await sendReceipt(tenantId,actorId,r.id,"EMAIL",requestId);expect(await sendReceipt(tenantId,actorId,r.id,"EMAIL",requestId)).toEqual(first);
  const smtp=vi.fn(async()=>({}));await deliverNotification(first.notificationId,undefined,smtp);
  expect(smtp).toHaveBeenCalledOnce();const mail=smtp.mock.calls[0]![0] as any;
  expect(mail.to).toContain("buyer@example.test");expect(mail.to).toContain("accounts@example.test");expect(mail.cc).toBe("company@example.test");expect(mail.attachments[0].filename).toBe("REC-1.pdf");expect(mail.attachments[0].content.subarray(0,5).toString()).toBe("%PDF-");
  expect((await prisma.notificationLog.findUniqueOrThrow({where:{id:first.notificationId}})).status).toBe("SENT");
 });
 it("sends a selected customer's receipt over WhatsApp and deduplicates automatic queue requests",async()=>{
  const r=await receipt();const job=await queueReceiptNotification(tenantId,r.id,{channel:"WHATSAPP",to:"+919876543210"});expect((await queueReceiptNotification(tenantId,r.id,{channel:"WHATSAPP",to:"+919876543210"})).id).toBe(job.id);
  await deliverWhatsappNotification(job.id,cfg=>wapiClient(cfg,base));expect(await prisma.notificationLog.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({status:"SENT",providerMessageId:"42",attempts:1});
 });
 it("blocks other tenants, opted-out customers and reversed receipts before sending",async()=>{
  const r=await receipt();await expect(sendReceipt(otherId,actorId,r.id,"EMAIL",randomUUID())).rejects.toThrow("Receipt not found");
  const email=await sendReceipt(tenantId,actorId,r.id,"EMAIL",randomUUID()),wa=await sendReceipt(tenantId,actorId,r.id,"WHATSAPP",randomUUID());
  await prisma.payment.update({where:{id:r.paymentId},data:{status:"REFUNDED"}});
  const smtp=vi.fn(async()=>({}));await deliverNotification(email.notificationId,undefined,smtp);expect(smtp).not.toHaveBeenCalled();await deliverWhatsappNotification(wa.notificationId,cfg=>wapiClient(cfg,base));expect(await prisma.notificationLog.findUniqueOrThrow({where:{id:wa.notificationId}})).toMatchObject({status:"FAILED",attempts:0});
  await expect(sendReceipt(tenantId,actorId,r.id,"EMAIL",randomUUID())).rejects.toThrow("Reversed");
  const active=await receipt();await prisma.customer.update({where:{id:customerId},data:{whatsappInvoiceEnabled:false}});await expect(sendReceipt(tenantId,actorId,active.id,"WHATSAPP",randomUUID())).rejects.toThrow("Enable WhatsApp");expect((await sendReceipt(tenantId,actorId,active.id,"EMAIL",randomUUID())).queued).toBe(true);
 });
});
