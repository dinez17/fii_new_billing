import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {prisma} from "@fii/database";
import {legacyPurchaseBody,previewLegacyPurchase,postLegacyPurchase} from "../src/legacy-purchase-posting.js";
import {legacySalesBody,previewLegacySales,postLegacySales} from "../src/legacy-posting.js";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("reviewed historical purchase and write-off corrections",()=>{
 let tenantId="",otherId="",actorId="",supplierId="",productId="",customerId="",parent="",receipt="",sale="";
 beforeAll(async()=>{
  tenantId=(await prisma.tenant.create({data:{name:"Historical corrections",subdomain:"historical-"+randomUUID(),stateCode:"33"}})).id;
  otherId=(await prisma.tenant.create({data:{name:"Other",subdomain:"historical-other-"+randomUUID()}})).id;
  actorId=(await prisma.user.create({data:{tenantId,name:"Reviewer",email:"history@example.test",passwordHash:"fixture"}})).id;
  supplierId=(await prisma.supplier.create({data:{tenantId,name:"Verified vendor",code:"S1",stateCode:"33"}})).id;
  customerId=(await prisma.customer.create({data:{tenantId,name:"Verified buyer",code:"C1",stateCode:"33"}})).id;
  productId=(await prisma.product.create({data:{tenantId,name:"Product",sku:"PRD1",stockQty:17}})).id;
  await prisma.financialYear.create({data:{tenantId,code:"2025-26",startDate:new Date("2025-04-01"),endDate:new Date("2026-03-31"),isLocked:true}});
  parent=randomUUID();receipt=randomUUID();sale=randomUUID();
  await prisma.legacyRecord.createMany({data:[{id:parent,tenantId,sourceHash:"fixture",sourceTable:"user_purchase_bills",sourceId:"10",status:"REVIEW",data:{billmode:"PARTIAL"}},{id:receipt,tenantId,sourceHash:"fixture",sourceTable:"user_purchase_receipt",sourceId:"11",status:"REVIEW",data:{receipt_bill_id:"10"}},{id:sale,tenantId,sourceHash:"fixture",sourceTable:"user_bills",sourceId:"20",status:"REVIEW",data:{billto:"42",billmode:"PAID"}},{id:randomUUID(),tenantId,sourceHash:"fixture",sourceTable:"user_cust_vendor_details",sourceId:"42",status:"IMPORTED",targetModel:"customer",targetId:customerId,data:{}}]});
  await prisma.setting.createMany({data:[parent,sale].map(id=>({tenantId,group:"LEGACY_REVIEW_APPROVAL",key:id,value:JSON.stringify({approved:true,sourceHash:"fixture",note:"Confirmed source document evidence"})}))});
 });
 afterAll(async()=>{
  const where={tenantId};await prisma.receivableWriteOff.deleteMany({where});await prisma.auditLog.deleteMany({where});await prisma.setting.deleteMany({where});await prisma.legacyRecord.deleteMany({where});await prisma.ledgerEntry.deleteMany({where});await prisma.dayBookEntry.deleteMany({where});await prisma.supplierPaymentAllocation.deleteMany({where:{supplierPayment:where}});await prisma.supplierPayment.deleteMany({where});await prisma.purchaseInvoiceItem.deleteMany({where:{purchaseInvoice:where}});await prisma.purchaseInvoice.deleteMany({where});await prisma.invoiceItem.deleteMany({where:{invoice:where}});await prisma.invoice.deleteMany({where});await prisma.$transaction([prisma.journalLine.deleteMany({where}),prisma.journalEntry.deleteMany({where})]);await prisma.financialAccount.deleteMany({where});await prisma.product.deleteMany({where});await prisma.supplier.deleteMany({where});await prisma.customer.deleteMany({where});await prisma.financialYear.deleteMany({where});await prisma.user.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:[tenantId,otherId]}}});await prisma.$disconnect();
 });
 const purchase=()=>legacyPurchaseBody.parse({supplierId,confirmSupplierMapping:true,invoiceNumber:"HIST-P1",invoiceDate:"2025-05-01",dueDate:"2025-05-10",chargeGst:true,isInterState:false,expectedTotal:118,expectedBalance:68,allowLockedHistory:true,note:"Verified supplier bill and bank statement against original evidence",items:[{productId,description:"Verified product",hsnSac:"8517",quantity:1,unitPrice:100,discount:0,gstRate:18}],receipts:[{sourceRecordId:receipt,receiptNumber:"HIST-V1",paymentDate:"2025-05-05",amount:50,tdsAmount:0,mode:"BANK_TRANSFER",reference:"Actual-UTR"}]});
 it("requires explicit locked-year approval, all linked receipts and own product/supplier mappings",async()=>{
  await expect(previewLegacyPurchase(tenantId,parent,{...purchase(),allowLockedHistory:false})).rejects.toThrow(/locked/);
  await expect(previewLegacyPurchase(tenantId,parent,{...purchase(),receipts:[]})).rejects.toThrow(/receipt/i);
  const foreign=await prisma.supplier.create({data:{tenantId:otherId,name:"Foreign vendor",code:"S1",stateCode:"33"}});
  await expect(previewLegacyPurchase(tenantId,parent,{...purchase(),supplierId:foreign.id})).rejects.toThrow(/supplier/i);await prisma.supplier.delete({where:{id:foreign.id}});
  expect(await prisma.purchaseInvoice.count({where:{tenantId}})).toBe(0);
 });
 it("posts a reconciled purchase and actual supplier cash without changing historical stock",async()=>{
  const preview=await previewLegacyPurchase(tenantId,parent,purchase());expect(preview.balance).toBe("68.00");
  await expect(postLegacyPurchase(tenantId,actorId,parent,purchase(),"stale","backup-fixture-reference")).rejects.toThrow(/changed/);
  const posted=await postLegacyPurchase(tenantId,actorId,parent,purchase(),preview.token,"backup-fixture-reference");
  const row=await prisma.purchaseInvoice.findUniqueOrThrow({where:{id:posted.purchaseInvoiceId}});expect(row.amountPaid.toFixed(2)).toBe("50.00");expect(row.grandTotal.toFixed(2)).toBe("118.00");
  expect((await prisma.product.findUniqueOrThrow({where:{id:productId}})).stockQty.toFixed(3)).toBe("17.000");expect(await prisma.outboxEvent.count({where:{tenantId}})).toBe(0);
  expect(await prisma.journalEntry.count({where:{tenantId,source:{in:["AUTO_PURCHASE","AUTO_SUPPLIER_PAYMENT"]}}})).toBe(2);
  await expect(postLegacyPurchase(tenantId,actorId,parent,purchase(),preview.token,"backup-fixture-reference")).rejects.toThrow(/unposted/);
 });
 it("classifies a historical sales write-off without inventing a receipt or unlocking its year",async()=>{
  const body=legacySalesBody.parse({customerId,invoiceNumber:"HIST-S1",invoiceDate:"2025-06-01",dueDate:"2025-06-10",chargeGst:true,isInterState:false,expectedTotal:118,expectedBalance:100,allowLockedHistory:true,writeOffAmount:18,note:"Verified original sale and approved non-cash bad debt adjustment",items:[{description:"Service",hsnSac:"998422",quantity:1,unitPrice:100,discount:0,gstRate:18}],receipts:[]});
  const preview=await previewLegacySales(tenantId,sale,body);const posted=await postLegacySales(tenantId,actorId,sale,body,preview.token,"backup-fixture-reference");
  expect((await prisma.invoice.findUniqueOrThrow({where:{id:posted.invoiceId}})).creditedAmount.toFixed(2)).toBe("18.00");expect(await prisma.payment.count({where:{tenantId}})).toBe(0);expect(await prisma.receivableWriteOff.count({where:{tenantId}})).toBe(1);
  expect((await prisma.financialYear.findFirstOrThrow({where:{tenantId}})).isLocked).toBe(true);
 });
});
