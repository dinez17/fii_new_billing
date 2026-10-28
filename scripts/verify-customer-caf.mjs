import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { isValidGstin } from "../packages/common/dist/index.js";
const { PDFDocument } = createRequire(new URL("../packages/pdf/package.json", import.meta.url))("pdf-lib");

const base = "http://localhost:8000/api/v1";
async function request(path, token, body, method = body ? "POST" : "GET", expected = 200) {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${data.error?.message ?? "unexpected response"}`); return data;
}
assert.ok(process.env.CAF_TEST_SUPERADMIN_PASSWORD, "Set CAF_TEST_SUPERADMIN_PASSWORD");
let tenantId, keep = false;
try {
  const platform = await request("/auth/login", null, { email: "superadmin@platform.local", password: process.env.CAF_TEST_SUPERADMIN_PASSWORD });
  const subdomain = `caf-check-${Date.now()}`, email = `admin@${subdomain}.test`;
  const fixture = await request("/platform/tenants", platform.accessToken, { name: "Sample Network Services", subdomain, adminName: "CAF Tester", adminEmail: email, adminPassword: "Caf!Verify2026#A", trialDays: 1, maxUsers: 2, maxCustomers: 2 }, "POST", 201);
  tenantId = fixture.tenant.id;
  const session = await request("/auth/login", null, { email, password: "Caf!Verify2026#A" }), token = session.accessToken;
  await request("/settings/company", token, { name: "Sample Network Services", addressLine1: "10 Business Road", city: "Chennai", stateCode: "33", pincode: "600001", phone: "9000000010", email: "office@example.test" }, "PUT");
  const gstin = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => `33ABCDE1234F1Z${c}`).find((value) => isValidGstin(value, "33"));
  assert.ok(gstin);
  const customer = await request("/customers", token, { name: "Sample CAF Customer", phone: "9000000001", email: "customer@example.test", gstTreatment: "B2B", gstin, billingAddress: "25 Residential Road", serviceAddress: "25 Residential Road, First Floor", city: "Chennai", stateCode: "33", pincode: "600002" }, "POST", 201);
  await request(`/customers/${customer.id}/kyc`, token, { idProofType: "OTHER", idProofNumber: "PRIVATE-CAF-REFERENCE-5678" }, "PUT");
  const photo = readFileSync("reports/caf-test-photo.png");
  for (const kind of ["PHOTO", "ID_FRONT", "ID_BACK", "GST_CERTIFICATE"]) {
    const certificate = await PDFDocument.create();
    for (let page = 1; page <= 2; page++) certificate.addPage().drawText(`Sample GST certificate - page ${page}`, { x: 40, y: 760, size: 18 });
    const gst = kind === "GST_CERTIFICATE";
    const bytes = gst ? Buffer.from(await certificate.save()) : photo;
    await request(`/customers/${customer.id}/documents/${kind}`, token, { fileName: `${kind.toLowerCase()}.${gst ? "pdf" : "png"}`, dataUrl: `data:${gst ? "application/pdf" : "image/png"};base64,${bytes.toString("base64")}` }, "POST", 201);
  }
  const kyc = await request(`/customers/${customer.id}/kyc`, token);
  assert.equal(kyc.documents.length, 4); assert.equal(kyc.idProofNumberMasked, "****5678");
  assert.ok(!JSON.stringify(kyc).includes("contentEncrypted"));
  const headers = { authorization: `Bearer ${token}` };
  const imageResponse = await fetch(base + `/customers/${customer.id}/documents/PHOTO`, { headers });
  assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), photo);
  await request(`/customers/${customer.id}/documents/PHOTO`, token, { fileName: "bad.pdf", dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nfixture").toString("base64")}` }, "POST", 400);
  await request(`/customers/${customer.id}/kyc`, platform.accessToken, undefined, "GET", 404);
  const denied = await fetch(base + `/customers/${customer.id}/caf`); assert.equal(denied.status, 401);
  const cross = await fetch(base + `/customers/${customer.id}/caf`, { headers: { authorization: `Bearer ${platform.accessToken}` } }); assert.equal(cross.status, 404);
  const pdfResponse = await fetch(base + `/customers/${customer.id}/caf`, { headers });
  assert.equal(pdfResponse.status, 200); assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
  const pdf = Buffer.from(await pdfResponse.arrayBuffer()); assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 5, "CAF + ID front + ID back + both GST pages");
  mkdirSync("output/pdf", { recursive: true }); writeFileSync("output/pdf/customer-caf-sample.pdf", pdf);
  console.log("PASS: GST profile, four uploads, private download, masked identity, invalid-photo rejection, five-page combined CAF and tenant isolation");
  keep = process.env.CAF_TEST_KEEP_FIXTURE === "true";
  if (keep) console.log(JSON.stringify({ tenantId, customerId: customer.id, email }));
} finally {
  if (tenantId && !keep) {
    const code = `import {prisma} from '@fii/database'; const tenantId=${JSON.stringify(tenantId)};
      const t=await prisma.tenant.findUnique({where:{id:tenantId}});
      if(!t?.subdomain.startsWith('caf-check-')) throw Error('Refusing non-test cleanup');
      const users=await prisma.user.findMany({where:{tenantId},select:{id:true}});const ids=users.map(u=>u.id);
      await prisma.$transaction([
        prisma.auditLog.deleteMany({where:{tenantId}}),prisma.customer.deleteMany({where:{tenantId}}),
        prisma.refreshToken.deleteMany({where:{userId:{in:ids}}}),prisma.userRole.deleteMany({where:{userId:{in:ids}}}),prisma.user.deleteMany({where:{tenantId}}),
        prisma.numberSeries.deleteMany({where:{tenantId}}),prisma.financialYear.deleteMany({where:{tenantId}}),prisma.tenantLicenseEvent.deleteMany({where:{tenantId}}),prisma.tenant.delete({where:{id:tenantId}})
      ]);await prisma.$disconnect();console.log('Temporary CAF verification tenant and private documents removed');`;
    process.stdout.write(execFileSync("docker", ["exec", "-w", "/app/services/crm-service", "fii-billing-prod-crm-service-1", "node", "--input-type=module", "-e", code], { encoding: "utf8" }));
  }
}
