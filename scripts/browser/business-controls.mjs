/* global document, innerWidth, window */
// Browser behavior with contract-shaped mocked APIs. Database correctness is tested separately.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import assert from "node:assert/strict";
const root = resolve("apps/admin-web/dist");
const server = createServer(async (req,res) => {
  try {
    let file = resolve(root, `.${new URL(req.url,"http://localhost").pathname}`);
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end(); return; }
    try { if (!(await stat(file)).isFile()) file = resolve(root,"index.html"); } catch { file = resolve(root,"index.html"); }
    res.setHeader("Content-Type", ({ ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".woff2":"font/woff2", ".png":"image/png", ".svg":"image/svg+xml" })[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(500).end(); }
});
await new Promise(r => server.listen(0,"127.0.0.1",r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const permissions = ["product:create","purchase_invoice:create","purchase_order:read","purchase_invoice:read","purchase_return:read","credit_note:read","credit_note:create","debit_note:read","report:read","settings:read","settings:update","financial_year:read","financial_year:update","day_book:create","day_book:update","billing_run:read","billing_run:create","payment:read","payment:update","payment:create","receipt:read","invoice:read","invoice:create","invoice:update","customer:read","subscriber:read","subscriber:update","subscriber:create","backup:read","backup:update"];
const user = { id: "test-user", name: "Test Admin", email: "admin@example.test", userType: "STAFF" };
const cash = "11111111-1111-4111-8111-111111111111", capital = "22222222-2222-4222-8222-222222222222";
const accountRows = [{ id: cash, code: "CASH", name: "Verified cash", type: "ASSET", isMoneyAccount: true }, { id: capital, code: "CAPITAL", name: "Capital", type: "EQUITY", isMoneyAccount: false }];
const years = [{ id:"fy", code:"2026-27", isActive:true, startDate:"2026-04-01", endDate:"2027-03-31" }];
let checks = 0;
await mkdir("output/browser-regression",{ recursive:true });
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    await context.addInitScript(({user,permissions}) => sessionStorage.setItem("fii.auth",JSON.stringify({user,permissions,accessToken:"mock-only"})),{user,permissions});
    const documentRequests=[];
    let prospectBody,purchaseCreateBody;
    let reverseBody, journalBody, conversionBody, statementBody, whatsappBody, whatsappSettingsBody, receiptEmailBody, receiptWhatsappBody, customerSort;
    await context.route("**/api/**",async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1","");
      let data = { items:[], total:0, limit:20 };
      if(path === "/settings/group/WHATSAPP") { if(request.method()==="PUT")whatsappSettingsBody=request.postDataJSON();data={apiUrl:whatsappSettingsBody?.apiUrl??"https://wapi.fiitech.in",provider:"FII_WAPI",enabled:whatsappSettingsBody?.enabled??"false",apiKey:whatsappSettingsBody?"••••••••":"",deviceId:whatsappSettingsBody?.deviceId??""}; }
      if(path === "/settings/whatsapp/test")data={connected:true,credits:100,devices:[{id:7,name:"Main",isReady:true}]};
      if(path === "/invoices")data={items:[{id:"wa-invoice",invoiceNumber:"FII/26-27/99",invoiceDate:"2026-11-01",dueDate:"2026-11-10",grandTotal:"100",amountPaid:"0",balance:"100",status:"UNPAID",chargeGst:true,customer:{id:"c",name:"WhatsApp customer",whatsappInvoiceEnabled:true}},{id:"email-only",invoiceNumber:"FII/26-27/98",invoiceDate:"2026-11-01",dueDate:"2026-11-10",grandTotal:"100",amountPaid:"0",balance:"100",status:"UNPAID",chargeGst:true,customer:{id:"c2",name:"Email customer",whatsappInvoiceEnabled:false}}],total:2};
      if(path === "/invoices/wa-invoice/whatsapp"){whatsappBody=request.postDataJSON();data={status:"QUEUED"};}
      if(path === "/purchase-orders")data={items:[{id:"po",poNumber:"PO-001",orderDate:"2026-11-01",status:"SENT",total:"118",supplier:{id:"supplier",name:"Sample supplier"}}],total:1,limit:20};
      if(path === "/purchase-invoices")data={items:[{id:"pi",ourNumber:"PI-001",billNumber:"BILL-001",invoiceDate:"2026-11-01",status:"UNPAID",grandTotal:"118",amountPaid:"0",supplier:{id:"supplier",name:"Sample supplier"}}],total:1,limit:20};
      if(path === "/purchase-returns")data={items:[{id:"pr",returnNumber:"PR-001",returnDate:"2026-11-01",taxableValue:"100",totalGst:"18",total:"118",supplier:{name:"Sample supplier"},purchaseInvoice:{ourNumber:"PI-001"}}],total:1,limit:20};
      if(path === "/credit-notes"||path === "/debit-notes")data={items:[{id:"note",noteNumber:"NOTE-001",noteDate:"2026-11-01",reason:"Adjustment",total:"118",status:"ISSUED",invoice:{invoiceNumber:"INV-001",customer:{name:"Sample customer"}}}],total:1,limit:20};
      if(request.method()==="POST"&&/\/(purchase-orders|purchase-invoices|purchase-returns|credit-notes|debit-notes|sales-documents)\/[^/]+\/(email|whatsapp)$/.test(path)){documentRequests.push({path,body:request.postDataJSON()});data={queued:true};}
      if(path === "/payments/tds-report")data={financialYear:years[0],items:[],totalTds:"0",entries:0};
      if(path === "/sales-documents") data={items:[{id:"quote",kind:"QUOTATION",documentNumber:"Q-001",customerId:"customer",documentDate:"2026-10-31",validUntil:"2026-11-15",grandTotal:"118",status:"OPEN",chargeGst:true,version:7,customer:{name:"Sample Customer"}}],total:1};
      if(path === "/sales-documents/quote/convert"){conversionBody=request.postDataJSON();data={id:"converted",kind:"PROFORMA",number:"PF-001"};}
      if(path === "/sales-documents/converted")data={id:"converted",kind:"PROFORMA",documentNumber:"PF-001",documentDate:"2026-10-31",validUntil:"2026-11-15",grandTotal:"100",status:"OPEN",chargeGst:false,version:1,customerId:"customer",customer:{name:"Sample Customer"},items:[]};
      if (path === "/auth/me") data = {user,permissions};
      if (path === "/settings/branding") data = {name:"Test Company",logoUrl:null};
      if (path === "/financial-years") data = years;
      if (path === "/billing-runs/preview") data = { items:[{ subscriberId:"sub",code:"SUB-001",customer:"Sample Customer",chargeGst:true,periodStart:"2027-01-01",periodEnd:"2027-03-31",amount:"354.00",eligible:true,reason:"Ready to invoice" }],total:1,page:1,limit:20 };
      if(path === "/customers"){customerSort=url.searchParams.get("sortBy");data={items:[{id:"subscriber-buyer",code:"C-1",name:"Subscriber customer",isActive:true,gstTreatment:"B2C",invoiceCount:1,currentOutstanding:"100",heldInvoiceCount:0,subscriptionCount:2,_count:{subscribers:2},portalEnabled:false}],total:1};}
      if(path === "/plans")data=[{id:"plan",name:"Sample plan",code:"P1",price:"100"},{id:"plan-2",name:"Second plan",code:"P2",price:"200"}];
      if(path === "/subscribers"||path === "/subscribers/subscriber")data={items:[{id:"subscriber",code:"SUB-001",subscriberType:"PREPAID",chargeGst:true,billingCycleMonths:1,status:"ACTIVE",activationDate:"2026-10-01",customer:{id:"customer",name:"Sample Customer",phone:"9000000000"},nextBilling:{invoiceDate:"2026-12-01",periodStart:"2026-12-01",periodEnd:"2026-12-31"},plans:[{id:"mapping",startDate:"2026-10-01",location:"Branch A",plan:{id:"plan",code:"P1",name:"Sample plan",price:"100"}}]}],total:1};
      if(path === "/subscribers/subscriber")data=data.items[0];
      if(path === "/subscribers/subscriber/schedules")data=[];
      if (path === "/payments") data = {items:[{id:"payment",amount:"90",tdsAmount:"10",mode:"CASH",paymentDate:"2026-10-31",status:"SUCCESS",customer:{name:"Sample Customer",whatsappInvoiceEnabled:true},receipt:{id:"receipt",receiptNumber:"R-001"},allocations:[]}],total:1,limit:20};
      if(path === "/receipts/receipt/email"){receiptEmailBody=request.postDataJSON();data={queued:true};}
      if(path === "/receipts/receipt/whatsapp"){receiptWhatsappBody=request.postDataJSON();data={queued:true};}
      if (path === "/payments/payment/reverse") { reverseBody = request.postDataJSON(); data = {reversed:true}; }
      if (path === "/financial-controls/accounts") data = accountRows;
      if(path === "/financial-controls/money-accounts")data=[{id:cash,name:"Cash",code:"SYS_CASH"},{id:"bank",name:"TMB",code:"TMB"},{id:"unassigned",name:"Bank unassigned",code:"SYS_BANK_UNASSIGNED"}];
      if (path === "/financial-controls/journals" && request.method() === "POST") { journalBody = request.postDataJSON(); data = {id:"journal"}; }
      if (path === "/financial-controls/trial-balance") data = {items:accountRows.map(a => ({...a,opening:"0",debit:"100",credit:"100",closing:"0"})),difference:"0.00",scope:"Explicit journals only"};
      if (path === "/financial-controls/bank-statements") data = {items:[{id:"statement",statementDate:"2026-10-31",reference:"BANK-001",narration:"Verified receipt",debit:"0",credit:"100",journalLineId:null}],total:1};
      if(path === "/financial-controls/bank-statements" && request.method()==="POST"){statementBody=request.postDataJSON();data={imported:1,duplicates:0};}
      if (path.endsWith("/candidates")) data = [{id:"line",journal:{entryDate:"2026-10-31",narration:"Verified customer receipt"}}];
      if(path === "/payments/tds-report")data={financialYear:years[0],items:[],totalTds:"0",entries:0};
      if(path === "/sales-documents") { if(request.method()==="POST") {prospectBody=request.postDataJSON();data={id:"prospect-quote"};} }
      if(path==="/purchase-invoices/extract")data={supplierId:"supplier",supplierName:"Sample supplier",billNumber:"UPLOAD-001",invoiceDate:"2026-11-01",dueDate:"2026-11-10",roundOff:0,expectedTotal:118,sourceText:"Supplier invoice fixture",warnings:["Review all extracted values against the original before saving."],duplicate:null,items:[{productId:"product",description:"Service",quantity:1,unitPrice:100,discount:0,gstRate:18}]};
      if(path==="/purchase-invoices/extract"&&request.postDataJSON().fileName==="goods.png")data={supplierId:"supplier",supplierName:"Sample supplier",pricesIncludeGst:true,billNumber:"PHOTO-001",invoiceDate:"2026-10-02",dueDate:"",roundOff:0,expectedTotal:75.52,requiresTotalMatch:true,sourceText:"Goods fixture",warnings:["Verify GST"],duplicate:null,items:[{productId:"",description:"Auto cable",unit:"NOS",quantity:2,unitPrice:37.76,discount:0,gstRate:-1,sourceLineTotal:75.52}]};
      if(path==="/suppliers/supplier")data={id:"supplier",name:"Sample supplier",code:"SUP1"};
      if(path==="/products/product")data={id:"product",name:"Service",sku:"S1",purchasePrice:"100",gstRate:"18",isService:true};
      if(path==="/purchase-invoices"&&request.method()==="POST"){purchaseCreateBody=request.postDataJSON();data={id:"new-purchase"};}
      await route.fulfill({json:data});
    });
    const page = await context.newPage();
    await page.goto(`${base}/quotations/new`);
    assert.equal(await page.getByLabel("Prepared for",{exact:false}).inputValue(),"PROSPECT");
    assert.equal(await page.getByLabel("Quotation pricing",{exact:false}).inputValue(),"OPTIONS");
    const quoteDate=await page.getByLabel("Document date calendar",{exact:true}).inputValue(),validDate=await page.getByLabel("Valid until calendar",{exact:true}).inputValue();
    assert.equal((Date.parse(validDate)-Date.parse(quoteDate))/86400000,15);
    assert.equal(await page.getByLabel("Subject",{exact:true}).count(),0);assert.equal(await page.getByLabel("PO reference",{exact:true}).count(),0);checks++;
    await page.getByLabel("Prospect / company name",{exact:false}).fill("Prospect Limited");
    await page.getByLabel("Quotation email",{exact:false}).fill("prospect@example.test");
    await page.getByLabel("Item 1 description",{exact:true}).fill("Connection installation");
    await page.getByLabel("Item 1 rate",{exact:true}).fill("1500");
    await page.getByRole("button",{name:"Create document"}).click();
    await page.waitForURL("**/quotations");
    assert.equal(prospectBody.prospect.name,"Prospect Limited");assert(!prospectBody.customerId);checks++;
    await page.goto(`${base}/invoices`);
    assert.equal(await page.getByRole("button",{name:"Write off",exact:true}).count(),0);
    assert.equal(await page.locator(".page-heading-actions").getByRole("button",{name:"+ New Invoice",exact:true}).count(),1);
    const searchBox=await page.getByPlaceholder("Search number / customer…").boundingBox(), statusBox=await page.getByLabel("Invoice status",{exact:true}).boundingBox();
    assert(searchBox.y>statusBox.y);checks++;
    await page.goto(`${base}/reports/tds`); await page.getByRole("heading",{name:"Customer TDS report",exact:true}).waitFor();checks++;
    await page.goto(`${base}/billing-runs`);
    await page.getByRole("button",{name:"Run billing now"}).click();
    const run = page.locator(".modal");
    assert(await run.getByRole("button",{name:"Run billing",exact:true}).isDisabled());
    await run.getByRole("button",{name:"Preview billing"}).click();
    await run.getByText("Ready to invoice",{exact:true}).waitFor();
    assert(await run.getByRole("button",{name:"Run billing",exact:true}).isEnabled());
    await run.getByLabel("Billing run GST mode").selectOption("WITHOUT_GST");
    assert(await run.getByRole("button",{name:"Run billing",exact:true}).isDisabled()); checks++;
    await page.goto(`${base}/subscribers`);
    assert.notEqual(await page.getByRole("button",{name:"Suspend",exact:true}).locator("path").getAttribute("d"),await page.getByRole("button",{name:"Terminate",exact:true}).locator("path").getAttribute("d"));
    await page.locator(".subscriber-type-line").first().waitFor();const prepaidBox=await page.locator(".subscriber-type-line").nth(0).boundingBox(),cycleBox=await page.locator(".subscriber-type-line").nth(1).boundingBox();assert(cycleBox.y>prepaidBox.y);
    await page.getByText("Bill date: 01-12-2026",{exact:true}).waitFor();await page.getByText("From: 01-12-2026",{exact:true}).waitFor();await page.getByText("To: 31-12-2026",{exact:true}).waitFor();checks++;
    await page.getByRole("button",{name:"+ New Subscriber",exact:true}).click();
    await page.getByRole("region",{name:"Create subscriber",exact:true}).waitFor();
    const newPlan=page.getByRole("combobox",{name:"Search plan name / code…",exact:true});
    await newPlan.fill("Sample");await page.getByRole("option",{name:"Sample plan · P1",exact:true}).click();
    await page.getByRole("button",{name:"Add plan",exact:true}).click();
    await newPlan.fill("Sample");await page.getByRole("option",{name:"Sample plan · P1",exact:true}).click();
    await page.getByRole("button",{name:"Add plan",exact:true}).click();
    await page.getByText("2 of 50 connections added",{exact:true}).waitFor();
    await page.getByRole("combobox",{name:"Plan for connection 1",exact:true}).fill("Second");
    await page.getByRole("option",{name:"Second plan · P2",exact:true}).click();
    assert.equal(await page.getByRole("combobox",{name:"Plan for connection 1",exact:true}).inputValue(),"Second plan · P2");checks++;

    assert.equal(await page.locator(".modal-overlay").count(),0);checks++;
    await page.getByRole("button",{name:"← Back to subscribers",exact:true}).click();
    await page.getByRole("button",{name:"Manage subscriber / PO number",exact:true}).click();
    assert.equal(await page.getByRole("button",{name:"Schedule change",exact:true}).count(),0);
    await page.getByRole("region",{name:"Edit subscriber details"}).waitFor();
    assert.equal(await page.locator(".modal-overlay").count(),0);
    await page.getByRole("button",{name:"← Back to subscribers",exact:true}).click();
    await page.getByRole("button",{name:"Service changes",exact:true}).click();
    const serviceDialog=page.getByRole("dialog",{name:"Service changes — SUB-001",exact:true});
    await serviceDialog.waitFor();
    assert(await serviceDialog.getByRole("button",{name:"Schedule change",exact:true}).isDisabled());
    assert.equal(await serviceDialog.getByLabel("Edit subscriber type",{exact:true}).count(),0);
    await serviceDialog.getByRole("button",{name:"Close",exact:true}).click();checks++;
    await page.goto(`${base}/purchases/new`);
    await page.getByLabel("Choose invoice PDF or image",{exact:true}).setInputFiles({name:"invoice.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=","base64")});
    await page.getByRole("heading",{name:"Review extracted details",exact:true}).waitFor();
    assert.equal(purchaseCreateBody,undefined);
    assert(await page.getByRole("button",{name:"Save purchase bill",exact:true}).isDisabled());
    await page.getByRole("checkbox",{name:/I checked the supplier/}).check();
    await page.getByRole("button",{name:"Save purchase bill",exact:true}).click();
    await page.waitForURL("**/purchases");
    assert.equal(purchaseCreateBody.billNumber,"UPLOAD-001");assert.equal(purchaseCreateBody.sourceDocument.reviewed,true);assert.match(purchaseCreateBody.sourceDocument.dataUrl,/^data:image\/png;base64,/);checks+=2;
    purchaseCreateBody=undefined;
    await page.goto(`${base}/purchases/new`);
    await page.getByLabel("Choose invoice PDF or image",{exact:true}).setInputFiles({name:"goods.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=","base64")});
    await page.getByLabel("New product name 1",{exact:true}).waitFor();
    assert(await page.getByRole("checkbox",{name:/Create unmatched products automatically/}).isChecked());
    assert(await page.getByRole("button",{name:"Save purchase bill",exact:true}).isDisabled());
    assert(await page.getByRole("checkbox",{name:/Rates include GST/}).isChecked());
    await page.getByLabel("Confirm GST rate for extracted items",{exact:true}).selectOption("18");
    await page.locator("table tbody tr input[type=number]").first().fill("3");
    await page.getByRole("checkbox",{name:/I checked the supplier/}).check();
    assert(await page.getByRole("button",{name:"Save purchase bill",exact:true}).isDisabled());
    await page.locator("table tbody tr input[type=number]").first().fill("2");
    await page.getByRole("checkbox",{name:/I checked the supplier/}).check();
    await page.getByRole("button",{name:"Save purchase bill",exact:true}).click();await page.waitForURL("**/purchases");
    assert.equal(purchaseCreateBody.pricesIncludeGst,true);assert.equal(purchaseCreateBody.items[0].productId,undefined);assert.deepEqual(purchaseCreateBody.items[0].newProduct,{name:"Auto cable",unit:"NOS",isService:false});checks+=2;
    await page.goto(`${base}/payments`);
    await page.getByRole("button",{name:"+ Record Payment",exact:true}).click();
    assert.equal(new URL(page.url()).pathname,"/payments/new");
    assert.equal(await page.getByRole("dialog").count(),0);
    await page.getByRole("combobox",{name:"Search customers",exact:true}).fill("Subscriber");
    await page.getByRole("option",{name:/Subscriber customer/}).click();
    await page.getByLabel("Money received ₹",{exact:false}).fill("90");
    await page.getByRole("checkbox",{name:"Settle FII/26-27/99",exact:true}).check();
    assert.equal(await page.getByLabel("TDS deducted ₹",{exact:true}).inputValue(),"10.00");
    await page.getByRole("checkbox",{name:"Settle FII/26-27/98",exact:true}).check();
    assert.equal(await page.getByLabel("TDS deducted ₹",{exact:true}).inputValue(),"110.00");
    assert(await page.getByRole("button",{name:"Auto-allocate (oldest first)",exact:true}).isEnabled());
    await page.getByRole("button",{name:"Auto-allocate (oldest first)",exact:true}).click();
    assert.equal(await page.getByRole("checkbox",{name:/Calculate TDS from selected/}).isChecked(),false);
    assert.equal(await page.getByLabel("TDS deducted ₹",{exact:true}).inputValue(),"110.00");
    assert.equal(await page.getByLabel("TDS deducted ₹",{exact:true}).isEditable(),true);checks++;
    assert.equal(await page.getByLabel("Mode",{exact:true}).inputValue(),"BANK_TRANSFER");
    await page.getByLabel("Receiving bank account",{exact:true}).getByRole("option",{name:"TMB",exact:true}).waitFor({state:"attached"});
    assert.equal(await page.getByLabel("Receiving bank account",{exact:true}).getByRole("option",{name:"Cash",exact:true}).count(),0);
    assert.equal(await page.getByLabel("Receiving bank account",{exact:true}).getByRole("option",{name:"Bank unassigned",exact:true}).count(),0);
    await page.getByLabel("Receiving bank account",{exact:true}).selectOption("bank");
    await page.getByLabel("Mode",{exact:true}).selectOption("CASH");
    assert.equal(await page.getByLabel("Cash account",{exact:true}).inputValue(),"");
    assert.equal(await page.getByLabel("Cash account",{exact:true}).getByRole("option",{name:"TMB",exact:true}).count(),0);checks++;
    await page.getByLabel("Mode",{exact:true}).selectOption("WRITE_OFF");
    await page.getByRole("heading",{name:"Select invoice to write off",exact:true}).waitFor();
    assert(await page.getByRole("button",{name:"Continue write-off",exact:true}).isDisabled());
    assert.equal(await page.getByLabel("Receiving bank account",{exact:true}).count(),0);
    await page.getByRole("button",{name:"Cancel",exact:true}).click();checks++;
    await page.getByRole("button",{name:"Email receipt",exact:true}).waitFor();
    const receiptDialog=dialog=>dialog.accept();page.on("dialog",receiptDialog);
    await page.getByRole("button",{name:"Email receipt",exact:true}).click();await page.waitForFunction(()=>true);await page.waitForTimeout(100);assert.match(receiptEmailBody.requestId,/^[0-9a-f-]{36}$/i);
    await page.getByRole("button",{name:"Send receipt on WhatsApp",exact:true}).click();await page.waitForTimeout(100);assert.match(receiptWhatsappBody.requestId,/^[0-9a-f-]{36}$/i);page.off("dialog",receiptDialog);checks+=2;
    await page.getByRole("button",{name:"Reverse",exact:true}).click();
    const reversal = page.getByRole("dialog");
    assert(await reversal.getByRole("button",{name:"Confirm reversal"}).isDisabled());
    await reversal.locator("textarea").fill("Wrong receipt entered; verified correction");
    await reversal.getByRole("button",{name:"Confirm reversal"}).click();
    await reversal.waitFor({state:"hidden"});
    assert.equal(reverseBody.reason,"Wrong receipt entered; verified correction"); checks++;
    await page.goto(`${base}/financial-controls`);
    await page.getByRole("button",{name:"Journals",exact:true}).click();
    const form = page.locator("form");
    await form.getByLabel("Narration",{exact:true}).fill("Verified opening capital and cash");
    await form.locator("tbody select").nth(0).selectOption(cash);
    await form.locator("tbody select").nth(1).selectOption(capital);
    await form.locator('tbody input[type="number"]').nth(0).fill("100");
    await form.locator('tbody input[type="number"]').nth(3).fill("100");
    await form.getByRole("button",{name:"Post journal"}).click();
    await page.getByRole("status").waitFor();
    assert.equal(journalBody.lines[0].debit,100); assert.equal(journalBody.lines[1].credit,100); checks++;
    await page.getByRole("button",{name:"Bank reconciliation",exact:true}).click();
    await page.getByLabel("Cash / bank account",{exact:true}).selectOption(cash);
    await page.getByRole("button",{name:"Find matching entry"}).click();
    await page.getByLabel("Matching journal entry").selectOption("line");
    assert(await page.getByRole("button",{name:"Confirm match"}).isEnabled()); checks++;
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    await page.getByLabel("Bank CSV file").setInputFiles({name:"bank.csv",mimeType:"text/csv",buffer:Buffer.from("Date,Reference,Narration,Withdrawal,Receipt\n31-10-2026,UTR-1,Customer collection,,100\n")});
    await page.getByRole("button",{name:"Preview CSV",exact:true}).click();
    assert(await page.getByRole("button",{name:"Import statement",exact:true}).isDisabled());
    await page.getByText("I verified the account, column mapping and statement amounts.",{exact:true}).click();
    await page.getByRole("button",{name:"Import statement",exact:true}).click();
    await page.getByText("Imported 1; duplicates skipped 0.",{exact:true}).waitFor();
    assert.equal(statementBody.rows[0].credit,100);assert.equal(statementBody.accountId,cash);checks++;
    await page.goto(`${base}/quotations`);
    await page.getByRole("button",{name:"Convert document",exact:true}).click();
    const conversion=page.getByRole("dialog",{name:"Convert document"});
    await conversion.getByLabel("Convert to").selectOption("PROFORMA");
    await conversion.getByLabel("Tax treatment").selectOption("WITHOUT_GST");
    await conversion.getByRole("button",{name:"Convert",exact:true}).click();
    await page.waitForURL("**/proformas/converted/edit");
    assert.equal(conversionBody.target,"PROFORMA");assert.equal(conversionBody.chargeGst,false);assert.equal(conversionBody.version,7);checks++;
    const acceptBusinessDialog=dialog=>dialog.accept();page.on("dialog",acceptBusinessDialog);
    for(const [path,label]of [["/purchase-orders","purchase order"],["/purchases","purchase invoice"],["/purchase-returns","purchase return"],["/notes","sales return / credit note"],["/notes?debit=true","debit note"]]){
      await page.goto(base+path);if(label==="debit note")await page.getByRole("button",{name:"Debit Notes",exact:true}).click();await page.getByRole("button",{name:`Email ${label}`,exact:true}).waitFor();
      await page.getByRole("button",{name:`Email ${label}`,exact:true}).click();await page.waitForTimeout(100);assert.match(documentRequests.at(-1).body.requestId,/^[0-9a-f-]{36}$/i);assert(documentRequests.at(-1).path.endsWith("/email"));
      await page.getByRole("button",{name:`WhatsApp ${label}`,exact:true}).click();await page.waitForTimeout(100);assert(documentRequests.at(-1).path.endsWith("/whatsapp"));checks++;
    }
    await page.goto(base+"/quotations");await page.getByRole("button",{name:"WhatsApp quotation",exact:true}).click();await page.waitForTimeout(100);assert(documentRequests.at(-1).path.includes("/sales-documents/"));checks++;
    await page.goto(base+"/proformas");await page.getByRole("button",{name:"WhatsApp proforma",exact:true}).click();await page.waitForTimeout(100);assert(documentRequests.at(-1).path.endsWith("/whatsapp"));checks++;
    page.off("dialog",acceptBusinessDialog);
    await page.goto(`${base}/customers`);
    await page.getByText("Subscriber customer",{exact:true}).waitFor();
    assert.equal(customerSort,"subscriptionCount");await page.getByRole("columnheader",{name:"Subscriptions",exact:true}).waitFor();
    assert.equal(await page.getByLabel("Sort by",{exact:true}).inputValue(),"subscriptionCount");checks++;
    await page.goto(`${base}/settings`);
    await page.getByRole("button",{name:"WhatsApp",exact:true}).click();
    await page.getByRole("checkbox",{name:"Enable WhatsApp"}).check();
    await page.getByLabel("WhatsApp API URL",{exact:true}).fill("https://wapi.fiitech.in");
    await page.locator('input[type="password"]').fill("test-browser-key");
    await page.locator('input[inputmode="numeric"]').fill("7");
    await page.getByRole("button",{name:"Save",exact:true}).click();
    await page.getByText("WhatsApp settings saved.",{exact:true}).waitFor();
    assert.equal(whatsappSettingsBody.apiUrl,"https://wapi.fiitech.in");assert.equal(whatsappSettingsBody.enabled,"true");assert.equal(whatsappSettingsBody.deviceId,"7");assert.equal(whatsappSettingsBody.apiKey,"test-browser-key");
    await page.getByRole("button",{name:"Check connection",exact:true}).click();
    await page.getByText("Connection successful.",{exact:false}).waitFor();checks++;
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.goto(`${base}/invoices`);
    await page.getByRole("button",{name:"Send invoice on WhatsApp",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Send invoice on WhatsApp",exact:true}).count(),1);
    const acceptDialog=dialog=>dialog.accept();page.on("dialog",acceptDialog);
    await page.getByRole("button",{name:"Send invoice on WhatsApp",exact:true}).click();
    await page.waitForTimeout(100);assert.match(whatsappBody.requestId,/^[0-9a-f-]{36}$/i);page.off("dialog",acceptDialog);checks++;
    await page.goto(`${base}/financial-controls`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:`output/browser-regression/financial-controls-${width}.png`,fullPage:true});
    await context.close();
  }
  const anonymous = await browser.newContext({serviceWorkers:"block"});
  const page = await anonymous.newPage(); await page.goto(`${base}/financial-controls`);
  await page.waitForURL("**/login"); checks++; await anonymous.close();
  const denied=await browser.newContext({serviceWorkers:"block"});
  await denied.addInitScript(({user,permissions})=>sessionStorage.setItem("fii.auth",JSON.stringify({user,permissions,accessToken:"mock-only"})),{user,permissions});
  await denied.route("**/api/**",async route=>{const path=new URL(route.request().url()).pathname.replace("/api/v1","");
   if(path==="/financial-controls/source-posting"){await route.fulfill({status:403,json:{error:{code:"FORBIDDEN",message:"Source records are unavailable in this tenant"}}});return;}
   const data=path==="/auth/me"?{user,permissions}:path==="/financial-years"?years:path==="/financial-controls/accounts"?accountRows:path==="/settings/branding"?{name:"Own Tenant",logoUrl:null}:{items:[],total:0};await route.fulfill({json:data});});
  const deniedPage=await denied.newPage();await deniedPage.goto(`${base}/financial-controls`);await deniedPage.getByRole("button",{name:"Source posting",exact:true}).click();await deniedPage.getByText("Source records are unavailable in this tenant",{exact:true}).waitFor();assert(await deniedPage.getByRole("button",{name:"Reconcile journals for shown documents",exact:true}).isDisabled());checks++;await denied.close();
  const portalRoot=resolve("apps/customer-portal/dist");
  const portalServer=createServer(async(req,res)=>{try{let file=resolve(portalRoot,`.${new URL(req.url,"http://localhost").pathname}`);if(!file.startsWith(portalRoot+sep)&&file!==portalRoot){res.writeHead(403).end();return;}try{if(!(await stat(file)).isFile())file=resolve(portalRoot,"index.html");}catch{file=resolve(portalRoot,"index.html");}res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2"})[extname(file)]??"application/octet-stream");res.end(await readFile(file));}catch{res.writeHead(500).end();}});
  await new Promise(r=>portalServer.listen(0,"127.0.0.1",r));
  try{for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"});let loginBody;
   await context.route("**/api/**",async route=>{const path=new URL(route.request().url()).pathname;let data={items:[]};
    if(path.endsWith("/auth/portal/login")){loginBody=route.request().postDataJSON();data={accessToken:"mock-portal-only",user:{name:"Portal Buyer"}};}
    if(path.endsWith("/portal/me"))data={customer:{id:"buyer",code:"C1",name:"Portal Buyer",phone:"9000000000"},subscribers:[],outstanding:"100",company:{name:"Own Tenant Only"}};
    await route.fulfill({json:data});});
   const page=await context.newPage();await page.goto(`http://127.0.0.1:${portalServer.address().port}`);
   await page.getByLabel("Email",{exact:true}).fill("buyer@example.test");await page.getByLabel("Password",{exact:true}).fill("MockChosenPassword123!");await page.getByRole("button",{name:"Sign in",exact:true}).click();
   await page.getByText("Own Tenant Only",{exact:true}).waitFor();assert.equal(loginBody.email,"buyer@example.test");
   assert.equal(await page.getByRole("button",{name:"Source posting",exact:true}).count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks++;
   await context.close();
  }}finally{await new Promise(r=>portalServer.close(r));}
  console.log(`Browser regression passed: ${checks} checks (mocked APIs, mobile and desktop).`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
