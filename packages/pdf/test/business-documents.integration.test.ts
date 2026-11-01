import {afterAll,beforeAll,describe,it,expect,vi} from "vitest";
import {createRequire} from "node:module";
import type {Server} from "node:http";
import {randomUUID} from "node:crypto";
import {writeFile,mkdir} from "node:fs/promises";
import {prisma,loadBusinessDocument,type BusinessDocumentKind} from "@fii/database";
import {encryptSecret,computeGst,wapiClient} from "@fii/common";
import {buildBusinessDocumentPdfBuffer,queueBusinessDocument} from "../src/business-document.js";
import {deliverNotification} from "../../../workers/notification-worker/src/send.js";
import {deliverWhatsappNotification} from "../../../workers/notification-worker/src/whatsapp.js";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("sales and purchase document delivery",()=>{
 let tenantId="",otherId="",actorId="",customerId="",supplierId="",productId="",base="",mock:Server;const documents:{kind:BusinessDocumentKind;id:string}[]=[];const run=Date.now();
 beforeAll(async()=>{
  mock=createRequire(import.meta.url)("../../../postman/mocks/wapi/default.js") as Server;await new Promise<void>(r=>mock.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${(mock.address() as any).port}`;
  tenantId=(await prisma.tenant.create({data:{name:"FIRST IDEA - TEST COMPANY",subdomain:`doc-test-${run}`,email:"company@example.test",addressLine1:"10 Business Street",city:"Chennai",pincode:"600001",stateCode:"33"}})).id;
  otherId=(await prisma.tenant.create({data:{name:"Other document tenant",subdomain:`doc-other-${run}`}})).id;
  actorId=(await prisma.user.create({data:{tenantId,name:"Tester",email:"tester@example.test",passwordHash:"not-a-login"}})).id;
  customerId=(await prisma.customer.create({data:{tenantId,code:"C1",name:"Customer",email:"buyer@example.test",phone:"9876543210",whatsappInvoiceEnabled:true}})).id;
  supplierId=(await prisma.supplier.create({data:{tenantId,code:"S1",name:"TEST NETWORK SUPPLIER",email:"supplier@example.test",phone:"9876543210",address:"25 Supplier Avenue, Chennai 600001"}})).id;
  productId=(await prisma.product.create({data:{tenantId,sku:"P1",name:"Managed network equipment and installation service",salePrice:100,hsnSac:"8517"}})).id;
  await prisma.setting.createMany({data:[{tenantId,group:"SMTP",key:"enabled",value:"true"},{tenantId,group:"SMTP",key:"host",value:"smtp.example.test"},{tenantId,group:"WHATSAPP",key:"enabled",value:"true"},{tenantId,group:"WHATSAPP",key:"provider",value:"FII_WAPI"},{tenantId,group:"WHATSAPP",key:"apiKey",value:encryptSecret(`test-doc-${run}`),isSecret:true}]});
  const po=await prisma.purchaseOrder.create({data:{tenantId,supplierId,poNumber:"PO/26-27/001",fyCode:"2026-27",orderDate:new Date("2026-11-01"),status:"SENT",total:118,notes:"Please deliver with the original invoice and warranty information.",items:{create:{productId,quantity:2,unitPrice:50,gstRate:18,lineTotal:118}}}});documents.push({kind:"PURCHASE_ORDER",id:po.id});
  const pi=await prisma.purchaseInvoice.create({data:{tenantId,supplierId,billNumber:"SUP-001",ourNumber:"PI/26-27/001",fyCode:"2026-27",invoiceDate:new Date("2026-11-01"),subTotal:100,taxableValue:100,cgst:9,sgst:9,grandTotal:118,items:{create:{productId,quantity:2,unitPrice:50,gstRate:18,taxableValue:100,cgst:9,sgst:9,lineTotal:118}}}});documents.push({kind:"PURCHASE_INVOICE",id:pi.id});
  const pr=await prisma.purchaseReturn.create({data:{tenantId,supplierId,purchaseInvoiceId:pi.id,returnNumber:"PR/26-27/001",fyCode:"2026-27",returnDate:new Date("2026-11-01"),reason:"One unit returned for replacement",taxableValue:50,totalGst:9,total:59,items:[{productId,quantity:1,unitPrice:50,gstRate:18}]}});documents.push({kind:"PURCHASE_RETURN",id:pr.id});
  const invoice=await prisma.invoice.create({data:{tenantId,customerId,invoiceNumber:"TEST-INV-1",fyCode:"2026-27",invoiceDate:new Date("2026-11-01"),dueDate:new Date("2026-11-10"),placeOfSupply:"33",subTotal:100,taxableValue:100,grandTotal:118}});
  const note={tenantId,customerId,invoiceId:invoice.id,fyCode:"2026-27",noteDate:new Date("2026-11-01"),reason:"Service adjustment",taxableValue:100,cgst:9,sgst:9,total:118,items:[{description:"Service",quantity:1,unitPrice:100,gstRate:18,taxableValue:100,cgst:9,sgst:9,igst:0,lineTotal:118}]};
  documents.push({kind:"CREDIT_NOTE",id:(await prisma.creditNote.create({data:{...note,noteNumber:"CN-1"}})).id},{kind:"DEBIT_NOTE",id:(await prisma.debitNote.create({data:{...note,noteNumber:"DN-1"}})).id});
  const items=[{description:"Service",quantity:1,unitPrice:100,discount:0,gstRate:18}];const totals=computeGst(items,false);
  documents.push({kind:"SALES_DOCUMENT",id:(await prisma.salesDocument.create({data:{tenantId,customerId,documentNumber:"Q-001",kind:"QUOTATION",fyCode:"2026-27",createdById:actorId,documentDate:new Date("2026-11-01"),validUntil:new Date("2026-11-15"),placeOfSupply:"33",isInterState:false,chargeGst:true,items,totals:JSON.parse(JSON.stringify(totals)),grandTotal:118}})).id});
 });
 afterAll(async()=>{mock.closeAllConnections();await new Promise<void>(r=>mock.close(()=>r()));const where={tenantId};await prisma.notificationLog.deleteMany({where});await prisma.auditLog.deleteMany({where});await prisma.setting.deleteMany({where});await prisma.salesDocument.deleteMany({where});await prisma.creditNote.deleteMany({where});await prisma.debitNote.deleteMany({where});await prisma.invoice.deleteMany({where});await prisma.purchaseReturn.deleteMany({where});await prisma.purchaseInvoiceItem.deleteMany({where:{purchaseInvoice:where}});await prisma.purchaseInvoice.deleteMany({where});await prisma.purchaseOrderItem.deleteMany({where:{purchaseOrder:where}});await prisma.purchaseOrder.deleteMany({where});await prisma.product.deleteMany({where});await prisma.customer.deleteMany({where});await prisma.supplier.deleteMany({where});await prisma.user.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:[tenantId,otherId]}}});await prisma.$disconnect();});
 it("renders each document PDF and emails the correct customer/supplier with company CC",async()=>{
  for(const document of documents){const pdf=await buildBusinessDocumentPdfBuffer(tenantId,document.kind,document.id);expect(pdf.buffer.subarray(0,5).toString()).toBe("%PDF-");if(document.kind==="PURCHASE_ORDER"&&process.env.EXPORT_DOCUMENT_PDF==="true"){await mkdir("output/pdf",{recursive:true});await writeFile("output/pdf/business-purchase-order.pdf",pdf.buffer);}
   const requestId=randomUUID(),job=await queueBusinessDocument(tenantId,actorId,document.kind,document.id,"EMAIL",requestId);expect((await queueBusinessDocument(tenantId,actorId,document.kind,document.id,"EMAIL",requestId)).notificationId).toBe(job.notificationId);
   const smtp=vi.fn(async(_mail:any)=>({}));await deliverNotification(job.notificationId,undefined,smtp);expect(smtp).toHaveBeenCalledOnce();expect(smtp.mock.calls[0]![0].to).toBe(document.kind.startsWith("PURCHASE")?"supplier@example.test":"buyer@example.test");expect(smtp.mock.calls[0]![0].cc).toBe("company@example.test");expect(smtp.mock.calls[0]![0].attachments[0].content.subarray(0,5).toString()).toBe("%PDF-");
  }
 });
 it("sends each document over the mocked WhatsApp contract without public links",async()=>{
  for(const document of documents){await prisma.setting.update({where:{tenantId_group_key:{tenantId,group:"WHATSAPP",key:"apiKey"}},data:{value:encryptSecret(`test-doc-${run}-${document.kind}`)}});const job=await queueBusinessDocument(tenantId,actorId,document.kind,document.id,"WHATSAPP",randomUUID());await deliverWhatsappNotification(job.notificationId,cfg=>wapiClient(cfg,base));expect((await prisma.notificationLog.findUniqueOrThrow({where:{id:job.notificationId}})).status).toBe("SENT");}
 });
 it("blocks foreign tenants, cancelled documents, opt-outs and changed contacts",async()=>{
  for(const d of documents)await expect(loadBusinessDocument(otherId,d.kind,d.id)).rejects.toThrow("outside this tenant");
  const po=documents[0],job=await queueBusinessDocument(tenantId,actorId,po.kind,po.id,"EMAIL",randomUUID());await prisma.purchaseOrder.update({where:{id:po.id},data:{status:"CANCELLED"}});await expect(queueBusinessDocument(tenantId,actorId,po.kind,po.id,"EMAIL",randomUUID())).rejects.toThrow("cancelled");const smtp=vi.fn(async()=>({}));await deliverNotification(job.notificationId,undefined,smtp);expect(smtp).not.toHaveBeenCalled();
  const sales=documents.find(d=>d.kind==="SALES_DOCUMENT")!;await prisma.customer.update({where:{id:customerId},data:{whatsappInvoiceEnabled:false}});await expect(queueBusinessDocument(tenantId,actorId,sales.kind,sales.id,"WHATSAPP",randomUUID())).rejects.toThrow("Enable WhatsApp");
  const pi=documents.find(d=>d.kind==="PURCHASE_INVOICE")!,pending=await queueBusinessDocument(tenantId,actorId,pi.kind,pi.id,"EMAIL",randomUUID());await prisma.supplier.update({where:{id:supplierId},data:{email:"changed@example.test"}});await deliverNotification(pending.notificationId,undefined,smtp);expect(smtp).not.toHaveBeenCalled();
 });
});
