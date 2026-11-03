import {originalPurchaseDocument} from "../src/services/purchase-document";
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {prisma,syncSourceJournal} from "@fii/database";
import {createPurchaseInvoice,purchaseInvoiceBody,getPurchaseInvoice,listPurchaseInvoices,pagination} from "../src/services/purchase.service";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("purchase round-off accounting",()=>{
 let tenantId="",supplierId="",productId="",actorId="";
 beforeAll(async()=>{
 vi.stubEnv("MASTER_ENCRYPTION_KEY","b".repeat(64));
 tenantId=(await prisma.tenant.create({data:{name:"Rounding fixture",subdomain:"round-"+randomUUID(),stateCode:"33"}})).id;
 actorId=(await prisma.user.create({data:{tenantId,name:"Fixture",email:"round@example.test",passwordHash:"fixture"}})).id;
 supplierId=(await prisma.supplier.create({data:{tenantId,name:"Supplier",code:"SUP1",stateCode:"33"}})).id;
 productId=(await prisma.product.create({data:{tenantId,name:"Service",sku:"S1",isService:true}})).id;
 await prisma.financialYear.create({data:{tenantId,code:"2026-27",isActive:true,startDate:new Date("2026-04-01"),endDate:new Date("2027-03-31")}});
 });
 afterAll(async()=>{
 if(!tenantId)return;const where={tenantId};
 await prisma.stockMovement.deleteMany({where});await prisma.auditLog.deleteMany({where});await prisma.outboxEvent.deleteMany({where});await prisma.$transaction([prisma.journalLine.deleteMany({where}),prisma.journalEntry.deleteMany({where})]);await prisma.setting.deleteMany({where});await prisma.financialAccount.deleteMany({where});
 await prisma.purchaseInvoiceItem.deleteMany({where:{purchaseInvoice:{tenantId}}});await prisma.purchaseInvoice.deleteMany({where});await prisma.product.deleteMany({where});await prisma.supplier.deleteMany({where});await prisma.numberSeries.deleteMany({where});await prisma.financialYear.deleteMany({where});await prisma.user.deleteMany({where});await prisma.tenant.delete({where:{id:tenantId}});await prisma.$disconnect();vi.unstubAllEnvs();
 });
 for(const [roundOff,expected] of [[0.04,"13000.00"],[0,"12999.96"],[-0.96,"12999.00"],[undefined,"13000.00"]] as const)it(`saves ${roundOff ?? "automatic"} with balanced journal`,async()=>{
 const input=purchaseInvoiceBody.parse({supplierId,billNumber:randomUUID(),invoiceDate:"2026-11-01",roundOff,items:[{productId,quantity:1,unitPrice:11016.92,gstRate:18}]});
 const bill=await createPurchaseInvoice(tenantId,actorId,input);expect(bill.grandTotal.toFixed(2)).toBe(expected);expect(bill.roundOff.toFixed(2)).toBe(roundOff===undefined?"0.04":roundOff.toFixed(2));expect(bill.cgst.toFixed(2)).toBe("991.52");
 await prisma.$transaction(tx=>syncSourceJournal(tx,tenantId,"PURCHASE",bill.id,actorId),{timeout:30000});
 const journal=await prisma.journalEntry.findFirstOrThrow({where:{tenantId,sourceId:{startsWith:bill.id+":"}},include:{lines:true}});expect(journal.lines.reduce((s,l)=>s+Number(l.debit)-Number(l.credit),0)).toBeCloseTo(0,8);
 });
 it("encrypts original files, hides ciphertext, enforces tenant ownership and detects duplicates",async()=>{
  const file={fileName:"supplier.pdf",dataUrl:"data:application/pdf;base64,"+Buffer.from("%PDF-test-fixture-original").toString("base64"),reviewed:true};
  const body={supplierId,billNumber:"SOURCE-1",invoiceDate:"2026-11-01",sourceDocument:file,items:[{productId,hsnSac:"998422",quantity:1,unitPrice:100,gstRate:18}]};
  expect(purchaseInvoiceBody.safeParse({...body,sourceDocument:{...file,reviewed:false}}).success).toBe(false);
  const bill=await createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse(body));expect(bill.items[0].hsnSac).toBe("998422");expect(bill.hasSourceDocument).toBe(true);expect(bill).not.toHaveProperty("sourceDocumentEncrypted");
  const stored=await prisma.purchaseInvoice.findUniqueOrThrow({where:{id:bill.id}});expect(stored.sourceDocumentEncrypted).not.toContain("PDF-test");
  expect((await originalPurchaseDocument(tenantId,bill.id)).bytes.toString()).toBe("%PDF-test-fixture-original");
  await expect(originalPurchaseDocument(randomUUID(),bill.id)).rejects.toThrow(/unavailable/);
  expect(await getPurchaseInvoice(tenantId,bill.id)).not.toHaveProperty("sourceDocumentEncrypted");
  expect((await listPurchaseInvoices(tenantId,pagination.parse({}))).items.every(i=>!("sourceDocumentEncrypted" in i))).toBe(true);
  await expect(createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({...body,billNumber:"SOURCE-2"}))).rejects.toThrow(/already exists/);
 });

 it("persists whole-rupee supplier GST without shifting it into invoice round-off",async()=>{
  const bill=await createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({supplierId,billNumber:"WHOLE-GST",invoiceDate:"2026-11-01",taxRounding:"WHOLE_RUPEE",items:[{productId,quantity:1,unitPrice:8898,gstRate:18}]}));
  expect(bill.taxRounding).toBe("WHOLE_RUPEE");expect(bill.cgst.toFixed(2)).toBe("801.00");expect(bill.sgst.toFixed(2)).toBe("801.00");expect(bill.roundOff.toFixed(2)).toBe("0.00");expect(bill.grandTotal.toFixed(2)).toBe("10500.00");
  expect(bill.items[0].lineTotal.toFixed(2)).toBe("10500.00");
  await prisma.$transaction(tx=>syncSourceJournal(tx,tenantId,"PURCHASE",bill.id,actorId),{timeout:30000});
 });

 it("creates missing products with PRD codes once and receives their stock atomically",async()=>{
  const base={supplierId,invoiceDate:"2026-11-01",items:[{newProduct:{name:"Auto Cable",unit:"NOS",isService:false},quantity:2,unitPrice:32,gstRate:0}]};
  const first=await createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({...base,billNumber:"AUTO-1"}));
  const product=await prisma.product.findUniqueOrThrow({where:{id:first.items[0].productId}});expect(product.sku).toMatch(/^PRD-\d{5}$/);expect(Number(product.stockQty)).toBe(2);
  const second=await createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({...base,billNumber:"AUTO-2",items:[{...base.items[0],quantity:1,newProduct:{...base.items[0].newProduct,name:"auto cable"}}]}));expect(second.items[0].productId).toBe(product.id);
  expect(Number((await prisma.product.findUniqueOrThrow({where:{id:product.id}})).stockQty)).toBe(3);
  await expect(createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({...base,billNumber:"AUTO-1",items:[{...base.items[0],newProduct:{...base.items[0].newProduct,name:"Must roll back"}}]}))).rejects.toThrow(/already exists/);
  expect(await prisma.product.count({where:{tenantId,name:"Must roll back"}})).toBe(0);
 });
 it("rolls back automatic products when another item is not in this tenant",async()=>{
  await expect(createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({supplierId,billNumber:"FOREIGN-AUTO",invoiceDate:"2026-11-01",items:[{newProduct:{name:"Rollback foreign"},quantity:1,unitPrice:10,gstRate:0},{productId:randomUUID(),quantity:1,unitPrice:10,gstRate:0}]}))).rejects.toThrow(/product/);
  expect(await prisma.product.count({where:{tenantId,name:"Rollback foreign"}})).toBe(0);
 });

 it("stores inclusive rates but creates products with exclusive purchase cost",async()=>{
  const bill=await createPurchaseInvoice(tenantId,actorId,purchaseInvoiceBody.parse({supplierId,billNumber:"INCLUSIVE-1",invoiceDate:"2026-11-01",pricesIncludeGst:true,items:[{newProduct:{name:"Inclusive cost fixture"},quantity:2,unitPrice:118,gstRate:18}]}));
  expect(bill.pricesIncludeGst).toBe(true);expect(bill.taxableValue.toFixed(2)).toBe("200.00");expect(bill.cgst.toFixed(2)).toBe("18.00");expect(bill.grandTotal.toFixed(2)).toBe("236.00");expect(bill.items[0].unitPrice.toFixed(2)).toBe("118.00");
  const p=await prisma.product.findUniqueOrThrow({where:{id:bill.items[0].productId}});expect(p.purchasePrice.toFixed(2)).toBe("100.00");expect(p.stockQty.toNumber()).toBe(2);
  await prisma.$transaction(tx=>syncSourceJournal(tx,tenantId,"PURCHASE",bill.id,actorId),{timeout:30000});
 });

});
