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
const permissions = ["report:read","settings:read","settings:update","financial_year:read","financial_year:update","day_book:create","day_book:update","billing_run:read","billing_run:create","payment:read","payment:update","payment:create","receipt:read","invoice:read","invoice:create","invoice:update","customer:read","subscriber:read","subscriber:update","backup:read","backup:update"];
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
    let reverseBody, journalBody, conversionBody, statementBody;
    await context.route("**/api/**",async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1","");
      let data = { items:[], total:0, limit:20 };
      if(path === "/sales-documents") data={items:[{id:"quote",kind:"QUOTATION",documentNumber:"Q-001",documentDate:"2026-10-31",validUntil:"2026-11-15",grandTotal:"118",status:"OPEN",chargeGst:true,version:7,customer:{name:"Sample Customer"}}],total:1};
      if(path === "/sales-documents/quote/convert"){conversionBody=request.postDataJSON();data={id:"converted",kind:"PROFORMA",number:"PF-001"};}
      if(path === "/sales-documents/converted")data={id:"converted",kind:"PROFORMA",documentNumber:"PF-001",documentDate:"2026-10-31",validUntil:"2026-11-15",grandTotal:"100",status:"OPEN",chargeGst:false,version:1,customerId:"customer",customer:{name:"Sample Customer"},items:[]};
      if (path === "/auth/me") data = {user,permissions};
      if (path === "/settings/branding") data = {name:"Test Company",logoUrl:null};
      if (path === "/financial-years") data = years;
      if (path === "/billing-runs/preview") data = { items:[{ subscriberId:"sub",code:"SUB-001",customer:"Sample Customer",chargeGst:true,periodStart:"2027-01-01",periodEnd:"2027-03-31",amount:"354.00",eligible:true,reason:"Ready to invoice" }],total:1,page:1,limit:20 };
      if(path === "/subscribers")data={items:[{id:"subscriber",code:"SUB-001",subscriberType:"PREPAID",chargeGst:true,billingCycleMonths:1,status:"ACTIVE",activationDate:"2026-10-01",customer:{id:"customer",name:"Sample Customer",phone:"9000000000"},plans:[]}],total:1};
      if(path === "/subscribers/subscriber/schedules")data=[];
      if (path === "/payments") data = {items:[{id:"payment",amount:"90",tdsAmount:"10",mode:"CASH",paymentDate:"2026-10-31",status:"SUCCESS",customer:{name:"Sample Customer"},receipt:{id:"receipt",receiptNumber:"R-001"},allocations:[]}],total:1,limit:20};
      if (path === "/payments/payment/reverse") { reverseBody = request.postDataJSON(); data = {reversed:true}; }
      if (path === "/financial-controls/accounts") data = accountRows;
      if (path === "/financial-controls/journals" && request.method() === "POST") { journalBody = request.postDataJSON(); data = {id:"journal"}; }
      if (path === "/financial-controls/trial-balance") data = {items:accountRows.map(a => ({...a,opening:"0",debit:"100",credit:"100",closing:"0"})),difference:"0.00",scope:"Explicit journals only"};
      if (path === "/financial-controls/bank-statements") data = {items:[{id:"statement",statementDate:"2026-10-31",reference:"BANK-001",narration:"Verified receipt",debit:"0",credit:"100",journalLineId:null}],total:1};
      if(path === "/financial-controls/bank-statements" && request.method()==="POST"){statementBody=request.postDataJSON();data={imported:1,duplicates:0};}
      if (path.endsWith("/candidates")) data = [{id:"line",journal:{entryDate:"2026-10-31",narration:"Verified customer receipt"}}];
      await route.fulfill({json:data});
    });
    const page = await context.newPage();
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
    await page.getByRole("button",{name:"Manage subscriber / PO number",exact:true}).click();
    assert.equal(await page.getByRole("button",{name:"Schedule change",exact:true}).count(),0);
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await page.getByRole("button",{name:"Service changes",exact:true}).click();
    const serviceDialog=page.getByRole("dialog",{name:"Service changes — SUB-001",exact:true});
    await serviceDialog.waitFor();
    assert(await serviceDialog.getByRole("button",{name:"Schedule change",exact:true}).isDisabled());
    assert.equal(await serviceDialog.getByLabel("Edit subscriber type",{exact:true}).count(),0);
    await serviceDialog.getByRole("button",{name:"Close",exact:true}).click();checks++;
    await page.goto(`${base}/payments`);
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
