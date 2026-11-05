import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import PDFDocument from "pdfkit";
import {prisma} from "@fii/database";
import {buildInvoicePdfBuffer} from "../src/invoice.js";
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
const templates=["COMMERCIAL","TALLY","CLASSIC","MODERN","MINIMAL","COMPACT","TELECOM_STATEMENT","SERVICE_TAX","IT_SERVICES"];
suite("PO number appears in every invoice design",()=>{
 let tenantId="",customerId="",invoiceId="";
 beforeAll(async()=>{
  tenantId=(await prisma.tenant.create({data:{name:"Template verification company",subdomain:"po-templates-"+Date.now(),stateCode:"33",addressLine1:"12 Technology Avenue",city:"Chennai",pincode:"600001",email:"company@example.test",bankName:"Example Bank",bankAccountNo:"123456789",bankIfsc:"EXAM0000001"}})).id;
  customerId=(await prisma.customer.create({data:{tenantId,name:"Template verification customer",code:"C1",billingAddress:"45 Customer Street",city:"Madurai",stateName:"Tamil Nadu",pincode:"625001",serviceAddress:"78 Installation Street",installationCity:"Dindigul",installationState:"Tamil Nadu",installationPincode:"624001"}})).id;
  invoiceId=(await prisma.invoice.create({data:{tenantId,customerId,invoiceNumber:"FII/26-27/96",poNumber:"PO-VERIFY-2026-09",fyCode:"2026-27",invoiceDate:new Date("2026-11-01"),dueDate:new Date("2026-11-11"),periodStart:new Date("2026-11-01"),periodEnd:new Date("2026-11-30"),placeOfSupply:"33",subTotal:22000,taxableValue:22000,cgst:1980,sgst:1980,grandTotal:25960,items:{create:[{description:"Wireless network services",hsnSac:"998599",quantity:1,unitPrice:22000,taxableValue:22000,gstRate:18,cgst:1980,sgst:1980,lineTotal:25960}]}}})).id;
 });
 afterAll(async()=>{await prisma.invoiceItem.deleteMany({where:{invoiceId}});await prisma.invoice.deleteMany({where:{tenantId}});await prisma.setting.deleteMany({where:{tenantId}});await prisma.customer.deleteMany({where:{tenantId}});await prisma.tenant.deleteMany({where:{id:tenantId}});await prisma.$disconnect();});
 it("renders the saved PO reference for both GST and without-GST documents",async()=>{
  for(const chargeGst of [true,false]){
   await prisma.invoice.update({where:{id:invoiceId},data:{chargeGst,cgst:chargeGst?1980:0,sgst:chargeGst?1980:0,grandTotal:chargeGst?25960:22000}});
   for(const template of templates){
    await prisma.setting.upsert({where:{tenantId_group_key:{tenantId,group:"INVOICE",key:"template"}},create:{tenantId,group:"INVOICE",key:"template",value:template},update:{value:template}});
    const spy=vi.spyOn(PDFDocument.prototype,"text");
    try{const {buffer}=await buildInvoicePdfBuffer(tenantId,invoiceId);expect(buffer.subarray(0,5).toString()).toBe("%PDF-");expect(spy.mock.calls.map(c=>String(c[0])).join("\n"),template).toContain("This is a Computer Generated Invoice no Signature Required");expect(spy.mock.calls.map(c=>String(c[0])).join("\n"),template).toContain("PO-VERIFY-2026-09");
     if(process.env.PO_TEMPLATE_QA_DIR){mkdirSync(process.env.PO_TEMPLATE_QA_DIR,{recursive:true});writeFileSync(join(process.env.PO_TEMPLATE_QA_DIR,template+(chargeGst?"-gst":"-without-gst")+".pdf"),buffer);}
    }finally{spy.mockRestore();}
   }
  }
 });
});
