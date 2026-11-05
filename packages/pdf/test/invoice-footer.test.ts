import {expect,it,vi} from "vitest";
import PDFDocument from "pdfkit";
import type {Tenant} from "@fii/database";
import type {InvoiceWithRelations} from "../src/invoice.js";
import {renderCommercialInvoice} from "../src/invoice-layout.js";
const tenant={name:"Test Company",stateCode:"33",addressLine1:"Company Street",city:"Chennai",pincode:"600001",bankName:"Test Bank",bankAccountNo:"123456",bankIfsc:"TEST0000001"} as Tenant;
for(const chargeGst of [true,false])for(const template of ["COMMERCIAL","TALLY","CLASSIC","MODERN","MINIMAL","COMPACT","TELECOM_STATEMENT","SERVICE_TAX","IT_SERVICES"]){
 it(`${template} ${chargeGst?"GST":"without GST"} includes the requested bottom notice`,async()=>{
 const invoice={invoiceNumber:"TEST/26-27/1",poNumber:"PO-1",invoiceType:"MANUAL",invoiceDate:new Date("2026-11-05"),dueDate:new Date("2026-11-15"),chargeGst,isInterState:false,status:"UNPAID",subTotal:100,discountTotal:0,taxableValue:100,cgst:chargeGst?9:0,sgst:chargeGst?9:0,igst:0,roundOff:0,grandTotal:chargeGst?118:100,amountPaid:0,creditedAmount:0,customer:{name:"Buyer",billingAddress:"Buyer Street",city:"Chennai",stateCode:"33"},items:[{description:"Service",hsnSac:"998316",quantity:1,unitPrice:100,discount:0,gstRate:chargeGst?18:0,taxableValue:100,cgst:chargeGst?9:0,sgst:chargeGst?9:0,igst:0,lineTotal:chargeGst?118:100}]} as unknown as InvoiceWithRelations;
 const doc=new PDFDocument({size:"A4",margin:0});doc.resume();const spy=vi.spyOn(doc,"text");
 try{renderCommercialInvoice(doc,invoice,tenant,"33-Tamil Nadu",template);if(!chargeGst){expect(spy.mock.calls.map(c=>String(c[0])).join("\n")).not.toMatch(/without gst/i);expect(spy.mock.calls.some(c=>/^invoice$/i.test(String(c[0])))).toBe(true);}const calls=spy.mock.calls.filter(c=>c[0]==="This is a Computer Generated Invoice no Signature Required");expect(calls.length).toBeGreaterThan(0);for(const call of calls)expect(Number(call[2])).toBeGreaterThanOrEqual(807);doc.end();}finally{spy.mockRestore();}
 });
}
