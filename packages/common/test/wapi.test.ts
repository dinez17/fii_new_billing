import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {createServer, type Server} from "node:http";
import {normalizeWapiUrl,wapiClient,WapiError,whatsappSettingsSchema} from "../src/wapi.js";
let server:Server,base:string;const calls:any[]=[];
beforeAll(async()=>{
 server=createServer((req,res)=>{let raw="";req.on("data",c=>raw+=c);req.on("end",()=>{
 const key=req.headers.authorization;calls.push({key,path:req.url,body:raw?JSON.parse(raw):null});
 const send=(value:unknown)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify(value));};
 if(key==="Bearer timeout")return setTimeout(()=>send({}),100);
 if(key==="Bearer error"){res.statusCode=500;return send({secret:"must not appear"});}
 if(req.url==="/api/v1/account")return send({success:true,isActive:true,credits:50});
 if(req.url==="/api/v1/devices")return send({success:true,devices:[{id:7,name:"Main",isReady:true,status:"connected"}]});
 if(key==="Bearer queued"&&!req.url?.includes("/messages/"))return send({success:true,messageId:42,status:"queued",sent:0,failed:0});
 if(key==="Bearer failed")return send({success:true,messageId:43,status:"failed",sent:0,failed:1});
 if(key==="Bearer unknown")return send({success:true});
 send({success:true,messageId:42,status:"completed",sent:1,failed:0});
 });});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
const input={to:"+919876543210",pdf:Buffer.from("%PDF-1.7 test document"),fileName:"Invoice.pdf",caption:"Invoice"};
describe("WAPI HTTP contract and uncertain submission safety",()=>{
 it("sends private PDF bytes, a single selected recipient and the tenant key/device",async()=>{
  expect(await wapiClient({apiKey:"one",deviceId:7},base).sendDocument(input)).toMatchObject({status:"SENT",messageId:"42"});
  const call=calls.at(-1);expect(call.key).toBe("Bearer one");expect(call.body).toEqual({documentBase64:input.pdf.toString("base64"),fileName:"Invoice.pdf",caption:"Invoice",recipients:[input.to],deviceId:7});expect(call.body.documentUrl).toBeUndefined();
  await wapiClient({apiKey:"two"},base).sendDocument(input);expect(calls.at(-1).key).toBe("Bearer two");expect(calls.at(-1).body.deviceId).toBeUndefined();
 });
 it("distinguishes accepted queues from sent messages, then polls the known ID",async()=>{
  const client=wapiClient({apiKey:"queued"},base);expect(await client.sendDocument(input)).toMatchObject({status:"PENDING",messageId:"42"});expect(await client.messageStatus("42")).toMatchObject({status:"SENT"});expect(calls.at(-1).path).toBe("/api/v1/messages/42");
 });
 it("checks account and devices without sending",async()=>{const before=calls.length;expect(await wapiClient({apiKey:"one"},base).connection()).toMatchObject({connected:true,credits:50,devices:[{id:7,isReady:true}]});expect(calls.slice(before).map(c=>c.path)).toEqual(["/api/v1/account","/api/v1/devices"]);});
 it("never reports failed or ambiguous responses as sent",async()=>{
  expect(await wapiClient({apiKey:"failed"},base).sendDocument(input)).toMatchObject({status:"FAILED"});
  await expect(wapiClient({apiKey:"unknown"},base).sendDocument(input)).rejects.toMatchObject({uncertain:true});
  await expect(wapiClient({apiKey:"error"},base).sendDocument(input)).rejects.toMatchObject({uncertain:true,message:expect.not.stringContaining("must not appear")});
  const before=calls.length;await expect(wapiClient({apiKey:"timeout"},base,20).sendDocument(input)).rejects.toMatchObject({uncertain:true});expect(calls.length-before).toBe(1);
 });
 it("rejects invalid PDF/phone/key before making an HTTP request",async()=>{
  const before=calls.length;await expect(wapiClient({apiKey:"one"},base).sendDocument({...input,pdf:Buffer.from("not PDF")})).rejects.toBeInstanceOf(WapiError);await expect(wapiClient({apiKey:"one"},base).sendDocument({...input,to:"https://bad"})).rejects.toBeInstanceOf(WapiError);expect(()=>wapiClient({apiKey:"bad\nkey"},base)).toThrow();expect(calls.length).toBe(before);expect(()=>whatsappSettingsSchema.parse({deviceId:"-1"})).toThrow();
 });
});


it("normalizes saved API URLs and rejects insecure or credential-bearing URLs",()=>{
 expect(normalizeWapiUrl("https://wapi.fiitech.in/api/v1/send/document")).toBe("https://wapi.fiitech.in");
 expect(whatsappSettingsSchema.parse({apiUrl:"https://another.example.com/"}).apiUrl).toBe("https://another.example.com");
 for(const apiUrl of ["http://wapi.fiitech.in","https://user:password@example.com","https://127.0.0.1","https://localhost","https://example.com/?key=secret"])expect(()=>whatsappSettingsSchema.parse({apiUrl})).toThrow();
});

it("uses the tenant API URL for requests and blocks redirects",async()=>{
 const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({success:true,messageId:5,status:"completed",sent:1,failed:0}),{status:200}));
 try{await wapiClient({apiKey:"test-custom-key",apiUrl:"https://custom.example.com/api/v1",deviceId:9}).sendDocument(input);expect(fetchMock.mock.calls[0]?.[0]).toBe("https://custom.example.com/api/v1/send/document");expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");}finally{fetchMock.mockRestore();}
});
