import {afterAll,beforeAll,expect,it,vi} from "vitest";
import type {Server} from "node:http";
import {validateSignatureImage} from "../src/signature-image.js";
const m=vi.hoisted(()=>({update:vi.fn(),audit:vi.fn(),find:vi.fn(async()=>({signatureUrl:null}))}));
vi.mock("@fii/database",()=>({prisma:{$transaction:async(fn:any)=>fn({tenant:{findUniqueOrThrow:m.find,update:m.update},auditLog:{create:m.audit}})}}));
vi.mock("@fii/auth",()=>({authenticate:(req:any,res:any,next:any)=>{if(!req.headers["x-tenant"])return res.sendStatus(401);req.auth={tenantId:req.headers["x-tenant"],sub:"admin"};next();},authorize:()=> (req:any,res:any,next:any)=>req.headers["x-edit"]==="yes"?next():res.sendStatus(403)}));
const image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=";
let server:Server,base:string;
beforeAll(async()=>{const {app}=await import("../src/index.js");server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));const address=server.address();base=`http://127.0.0.1:${typeof address==="object"&&address?address.port:0}/api/v1/settings/company/signature`;});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
it("accepts PNG and rejects URLs, SVG, mismatched content and excessive dimensions",()=>{
 expect(validateSignatureImage(image)).toBe(image);
 for(const value of ["https://example.test/sign.png","data:image/svg+xml;base64,AAAA",image.replace("image/png","image/jpeg"),"data:image/png;base64,"+"A".repeat(400001)])expect(()=>validateSignatureImage(value)).toThrow();
 const huge=Buffer.from(image.split(",")[1],"base64");huge.writeUInt32BE(100000,16);expect(()=>validateSignatureImage("data:image/png;base64,"+huge.toString("base64"))).toThrow();
});
it("requires login and settings update permission",async()=>{
 expect((await fetch(base,{method:"POST"})).status).toBe(401);
 expect((await fetch(base,{method:"DELETE",headers:{"x-tenant":"alpha"}})).status).toBe(403);
});
it("updates only the authenticated tenant and audits without storing image bytes in the log",async()=>{
 const response=await fetch(base+"?tenantId=beta",{method:"POST",headers:{"Content-Type":"application/json","x-tenant":"alpha","x-edit":"yes"},body:JSON.stringify({dataUrl:image})});
 expect(response.status).toBe(200);expect(m.update).toHaveBeenLastCalledWith({where:{id:"alpha"},data:{signatureUrl:image}});
 expect(m.audit.mock.lastCall?.[0].data).toMatchObject({tenantId:"alpha",userId:"admin",action:"COMPANY_SIGNATURE_UPDATED",after:{configured:true}});expect(JSON.stringify(m.audit.mock.lastCall)).not.toContain("base64");
});
it("removes the authenticated tenant signature",async()=>{
 expect((await fetch(base,{method:"DELETE",headers:{"x-tenant":"beta","x-edit":"yes"}})).status).toBe(200);
 expect(m.update).toHaveBeenLastCalledWith({where:{id:"beta"},data:{signatureUrl:null}});
});
