import {createRequire} from "node:module";
import type {Server} from "node:http";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {prisma,queueInvoiceWhatsapp} from "@fii/database";
import {encryptSecret,wapiClient} from "@fii/common";
import {deliverWhatsappNotification} from "../../../workers/notification-worker/src/whatsapp.js";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("WhatsApp persistent delivery against local Postman simulation",()=>{
 let tenantId="",otherId="",customerId="";let base=process.env.WAPI_SIMULATION_URL!;let mock:Server|undefined;const run=Date.now();let n=0;
 const client=(cfg:{apiKey:string;deviceId?:number})=>wapiClient(cfg,base,cfg.apiKey.includes("-timeout-")?30:5000);
 beforeAll(async()=>{
 if(!base){mock=createRequire(import.meta.url)("../../../postman/mocks/wapi/default.js") as Server;await new Promise<void>(resolve=>mock!.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(mock.address() as any).port}`;}
 tenantId=(await prisma.tenant.create({data:{name:"WhatsApp simulation",subdomain:`wa-${run}`,stateCode:"33"}})).id;
 otherId=(await prisma.tenant.create({data:{name:"Other WhatsApp tenant",subdomain:`wa-other-${run}`}})).id;
 customerId=(await prisma.customer.create({data:{tenantId,name:"Selected customer",code:"W1",phone:"9876543210",whatsappInvoiceEnabled:true}})).id;
 await prisma.setting.createMany({data:[{tenantId,group:"WHATSAPP",key:"enabled",value:"true"},{tenantId,group:"WHATSAPP",key:"provider",value:"FII_WAPI"},{tenantId,group:"WHATSAPP",key:"apiKey",value:encryptSecret(`test-default-${run}`),isSecret:true}]});
 });
 afterAll(async()=>{if(mock){mock.closeAllConnections();await new Promise<void>(resolve=>mock!.close(()=>resolve()));}await prisma.notificationLog.deleteMany({where:{tenantId}});await prisma.auditLog.deleteMany({where:{tenantId}});await prisma.setting.deleteMany({where:{tenantId}});await prisma.invoice.deleteMany({where:{tenantId}});await prisma.customer.deleteMany({where:{tenantId}});await prisma.tenant.deleteMany({where:{id:{in:[tenantId,otherId]}}});await prisma.$disconnect();});
 async function job(mode:string){
 await prisma.setting.update({where:{tenantId_group_key:{tenantId,group:"WHATSAPP",key:"apiKey"}},data:{value:encryptSecret(`test-${mode}-${run}-${++n}`)}});
 const invoice=await prisma.invoice.create({data:{tenantId,customerId,invoiceNumber:`WA/${n}`,fyCode:"2026-27",invoiceDate:new Date("2026-11-01"),dueDate:new Date("2026-11-10"),placeOfSupply:"33",subTotal:100,taxableValue:100,grandTotal:100,items:{create:{description:"Test service",unitPrice:100,taxableValue:100,gstRate:0,lineTotal:100}}}});
 const row=await queueInvoiceWhatsapp(tenantId,invoice.id,{to:"+919876543210"});return {invoice,row};
 }
 it("deduplicates automatic requests, leases once and sends the rendered PDF",async()=>{
 const {invoice,row}=await job("success");expect((await queueInvoiceWhatsapp(tenantId,invoice.id,{to:"+919876543210"})).id).toBe(row.id);
 await Promise.all([deliverWhatsappNotification(row.id,client),deliverWhatsappNotification(row.id,client)]);
 expect(await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({status:"SENT",attempts:1,requiresReview:false,providerMessageId:"42"});
 await deliverWhatsappNotification(row.id,client);expect((await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).attempts).toBe(1);
 });
 it("polls a queued message instead of submitting it again",async()=>{
 const {row}=await job("queued");await deliverWhatsappNotification(row.id,client);expect(await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({status:"QUEUED",providerMessageId:"42",attempts:1});
 await prisma.notificationLog.update({where:{id:row.id},data:{nextAttemptAt:new Date(0)}});await deliverWhatsappNotification(row.id,client);
 expect(await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({status:"SENT",attempts:1,providerPolls:1});
 });
 it("holds uncertain submissions and confirmed failures for review without resubmitting",async()=>{
 for(const mode of ["timeout","server-error","invalid-json","failed"]){const {row}=await job(mode);await deliverWhatsappNotification(row.id,client);const failed=await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}});expect(failed).toMatchObject({status:"FAILED",requiresReview:true,attempts:1,nextAttemptAt:null});if(mode==="failed")expect(failed.providerMessageId).toBe("42");await deliverWhatsappNotification(row.id,client);expect((await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).attempts).toBe(1);}
 });
 it("prevents cross-tenant queueing and rechecks opt-out/cancellation before delivery",async()=>{
 const {invoice,row}=await job("suppressed");await expect(queueInvoiceWhatsapp(otherId,invoice.id,{to:"+919876543210"})).rejects.toThrow("not found");
 await prisma.customer.update({where:{id:customerId},data:{whatsappInvoiceEnabled:false}});await deliverWhatsappNotification(row.id,client);expect((await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).attempts).toBe(0);
 await expect(queueInvoiceWhatsapp(tenantId,invoice.id,{to:"+919876543210"})).rejects.toThrow("Enable WhatsApp");await prisma.customer.update({where:{id:customerId},data:{whatsappInvoiceEnabled:true}});
 const cancelled=await job("cancelled");await prisma.invoice.update({where:{id:cancelled.invoice.id},data:{status:"CANCELLED"}});await deliverWhatsappNotification(cancelled.row.id,client);expect((await prisma.notificationLog.findUniqueOrThrow({where:{id:cancelled.row.id}})).attempts).toBe(0);
 });
});
