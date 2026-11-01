import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import type {Server} from "node:http";
import {prisma} from "@fii/database";
import {decryptSecret} from "@fii/common";
vi.mock("@fii/auth",()=>({
 authenticate:(req:any,res:any,next:any)=>{if(!req.headers["x-test-tenant"])return res.sendStatus(401);req.auth={tenantId:req.headers["x-test-tenant"],sub:"whatsapp-settings-test"};next();},
 authorize:(permission:string)=>(req:any,res:any,next:any)=>{if(!(req.headers["x-test-permissions"]||"").split(",").includes(permission))return res.sendStatus(403);next();}
}));
const suite=process.env.RUN_INTEGRATION_TESTS==="true"?describe:describe.skip;
suite("WhatsApp tenant settings and retry controls",()=>{
 const tenant=`wa-settings-${Date.now()}`,other=tenant+"-other";let server:Server,base:string;
 const headers={"Content-Type":"application/json","x-test-tenant":tenant,"x-test-permissions":"settings:read,settings:update"};
 beforeAll(async()=>{await prisma.tenant.createMany({data:[{id:tenant,name:"WA settings",subdomain:tenant},{id:other,name:"Other WA",subdomain:other}]});await prisma.user.create({data:{id:"whatsapp-settings-test",tenantId:tenant,name:"Tester",email:"wa-settings@example.test",passwordHash:"not-a-login"}});const {app}=await import("../src/index.js");server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as any).port}/api/v1`;});
 afterAll(async()=>{await prisma.setting.deleteMany({where:{tenantId:{in:[tenant,other]}}});await prisma.auditLog.deleteMany({where:{tenantId:tenant}});await prisma.notificationLog.deleteMany({where:{tenantId:tenant}});await prisma.user.deleteMany({where:{tenantId:tenant}});await prisma.tenant.deleteMany({where:{id:{in:[tenant,other]}}});await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.$disconnect();});
 const save=(body:unknown,h=headers)=>fetch(base+"/settings/group/WHATSAPP",{method:"PUT",headers:h,body:JSON.stringify(body)});
 it("requires auth and update permission",async()=>{expect((await save({},{} as any)).status).toBe(401);expect((await save({}, {...headers,"x-test-permissions":"settings:read"})).status).toBe(403);});
 it("requires a key, encrypts it, masks it and preserves it on unrelated edits",async()=>{
 expect((await save({enabled:"true"})).status).toBe(400);
 expect((await save({enabled:"true",apiUrl:"https://custom.example.com/api/v1/send/document",apiKey:"test-settings-key",deviceId:"7"})).status).toBe(200);
 const stored=await prisma.setting.findUniqueOrThrow({where:{tenantId_group_key:{tenantId:tenant,group:"WHATSAPP",key:"apiKey"}}});expect(stored.isSecret).toBe(true);expect(stored.value).not.toBe("test-settings-key");expect(decryptSecret(stored.value)).toBe("test-settings-key");
 const view=await (await fetch(base+"/settings/group/WHATSAPP",{headers})).json();expect(view.apiUrl).toBe("https://custom.example.com");expect(view.apiKey).toBe("••••••••");expect(JSON.stringify(view)).not.toContain("test-settings-key");
 expect((await save({enabled:"false",apiKey:"",deviceId:""})).status).toBe(200);expect((await prisma.setting.findUniqueOrThrow({where:{id:stored.id}})).value).toBe(stored.value);
 expect(await (await fetch(base+"/settings/group/WHATSAPP",{headers:{...headers,"x-test-tenant":other}})).json()).toEqual({});
 expect((await save({enabled:"true",apiKey:""})).status).toBe(200);
 expect((await save({deviceId:"-1"})).status).toBe(400);expect((await save({provider:"UNTRUSTED"})).status).toBe(400);
 });
 it("requires explicit provider-history acknowledgement before resubmitting a failed WhatsApp PDF",async()=>{
 const row=await prisma.notificationLog.create({data:{tenantId:tenant,channel:"WHATSAPP",to:"+919876543210",status:"FAILED",requiresReview:true,providerMessageId:"42",attempts:1}});
 const url=base+`/notification-logs/${row.id}/retry`;
 expect((await fetch(url,{method:"POST",headers,body:"{}"})).status).toBe(400);
 expect((await fetch(url,{method:"POST",headers:{...headers,"x-test-tenant":other},body:JSON.stringify({confirmProviderChecked:true})})).status).toBe(400);
 expect((await fetch(url,{method:"POST",headers,body:JSON.stringify({confirmProviderChecked:true})})).status).toBe(200);
 expect(await prisma.notificationLog.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({status:"QUEUED",requiresReview:false,providerMessageId:null});
 });
});
