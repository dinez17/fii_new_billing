import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({handler:undefined as any,dispatch:vi.fn(),pdf:vi.fn(),findInvoice:vi.fn(),contact:vi.fn(),company:vi.fn(),payment:vi.fn(),receipt:vi.fn()}));
vi.mock("@fii/database",()=>({prisma:{payment:{findFirst:mocks.payment},receipt:{findFirst:mocks.receipt},invoice:{findFirst:mocks.findInvoice},customer:{findFirst:mocks.contact},tenant:{findUniqueOrThrow:mocks.company}},queueReceiptNotification:vi.fn(),queueInvoiceWhatsapp:vi.fn()}));
vi.mock("@fii/kafka",()=>({TOPICS:{INVOICE_CREATED:"invoice.created",PAYMENT_SUCCESS:"payment.success"},runConsumer:vi.fn(async input=>{mocks.handler=input.handler;return async()=>{};})}));
vi.mock("@fii/pdf",()=>({buildInvoicePdfBuffer:mocks.pdf,buildReceiptPdfBuffer:vi.fn()}));
vi.mock("../../../workers/notification-worker/src/send.js",()=>({dispatch:mocks.dispatch,retryNotifications:vi.fn()}));
vi.mock("@fii/common",async original=>({...await original<typeof import("@fii/common")>(),startOpsServer:()=>()=>{},createLogger:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn()})}));
beforeEach(()=>{vi.clearAllMocks();mocks.contact.mockResolvedValue({name:"Buyer",email:"buyer@example.test",additionalEmails:[],phone:null});mocks.company.mockResolvedValue({email:"company@example.test"});mocks.pdf.mockResolvedValue({buffer:Buffer.from("pdf")});});
async function deliver(invoiceType:string){
 delete process.env.NOTIFICATION_QUEUE_ONLY;
 if(!mocks.handler){await import("../../../workers/notification-worker/src/index.js");await vi.waitFor(()=>expect(mocks.handler).toBeTypeOf("function"));}
 mocks.findInvoice.mockResolvedValue({invoiceType,status:"UNPAID",customer:{whatsappInvoiceEnabled:false}});
 await mocks.handler("invoice.created",{tenantId:"tenant",payload:{invoiceId:"invoice",invoiceNumber:"INV/26-27/1",customerId:"buyer",grandTotal:"100",dueDate:"2026-11-15"}});
}
it("does not automatically email a manual invoice or render its email PDF",async()=>{await deliver("MANUAL");expect(mocks.dispatch).not.toHaveBeenCalled();expect(mocks.pdf).not.toHaveBeenCalled();});
it("preserves billing-run automatic invoice email with its PDF",async()=>{await deliver("SUBSCRIPTION");expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({templateCode:"INVOICE_GENERATED",to:expect.objectContaining({email:"buyer@example.test"}),attachments:expect.any(Array)}));});

it("does not supply an email recipient when a successful payment creates a receipt",async()=>{
 await deliver("MANUAL");vi.clearAllMocks();
 mocks.payment.mockResolvedValue({status:"SUCCESS"});mocks.receipt.mockResolvedValue({id:"receipt",payment:{status:"SUCCESS",customer:{whatsappInvoiceEnabled:false}}});
 await mocks.handler("payment.success",{tenantId:"tenant",payload:{paymentId:"payment",customerId:"buyer",amount:"100",receiptNumber:"RCPT-1"}});
 expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({templateCode:"PAYMENT_RECEIVED",to:{phone:null}}));
 expect(mocks.dispatch.mock.lastCall?.[0].to.email).toBeUndefined();
});
