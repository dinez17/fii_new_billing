import {z} from "zod";
export const WAPI_ORIGIN="https://wapi.fiitech.in";
export function normalizeWapiUrl(value:string):string {
 const url=new URL(value.trim());
 if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || !url.hostname.includes(".") || url.hostname.endsWith(".local") || url.hostname.endsWith(".localhost") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) throw new Error("Use a public HTTPS WhatsApp API URL without credentials");
 if(!["/","/api-docs","/api/v1","/api/v1/","/api/v1/send/document"].includes(url.pathname)) throw new Error("Use the WhatsApp API base URL, for example https://wapi.fiitech.in");
 return url.origin;
}
const wapiUrlSchema=z.string().trim().max(500).default(WAPI_ORIGIN).transform((value,ctx)=>{try{return normalizeWapiUrl(value);}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:"Enter a public HTTPS API base URL, for example https://wapi.fiitech.in"});return z.NEVER;}});
export const whatsappSettingsSchema=z.object({apiUrl:wapiUrlSchema,provider:z.literal("FII_WAPI").default("FII_WAPI"),enabled:z.enum(["true","false"]).default("false"),apiKey:z.string().trim().max(500).optional(),deviceId:z.string().regex(/^$|^[1-9]\d{0,9}$/,"Device ID must be a positive integer").default("")});
export interface WapiConfig {apiKey:string;deviceId?:number;apiUrl?:string}
export class WapiError extends Error {constructor(message:string,readonly uncertain=false){super(message);}}
export interface WapiStatus {messageId:string|null;status:"SENT"|"PENDING"|"FAILED";providerStatus:string}
function statusOf(data:any):WapiStatus {
 const id=(typeof data?.messageId==="number"||typeof data?.messageId==="string")?String(data.messageId):null;
 if(data?.success===true&&data.status==="completed"&&data.sent===1&&data.failed===0)return {messageId:id,status:"SENT",providerStatus:"completed"};
 if(data?.success===true&&id&&["queued","pending","processing","sending"].includes(data.status))return {messageId:id,status:"PENDING",providerStatus:data.status};
 if(id&&["failed","completed"].includes(data?.status)&&data?.sent===0&&data?.failed===1)return {messageId:id,status:"FAILED",providerStatus:"failed"};
 throw new WapiError("WAPI returned an unconfirmed result; review provider message history before sending again",true);
}
/** Explicit base override is reserved for local contract simulations. */
export function wapiClient(config:WapiConfig,base=config.apiUrl?normalizeWapiUrl(config.apiUrl):WAPI_ORIGIN,timeoutMs=30000){
 if(!config.apiKey||/[\r\n]/.test(config.apiKey))throw new WapiError("Configure the WAPI API key in tenant Settings");
 async function request(path:string,body?:unknown){
  let response:Response;try{response=await fetch(base+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(timeoutMs)});}catch{throw new WapiError(body?"WAPI submission could not be confirmed; review provider history before retrying":"WAPI status service is unavailable",!!body);}
  if(!response.ok)throw new WapiError("WAPI request failed (HTTP "+response.status+")"+(body?"; check provider history before retrying":""),!!body);
  try{return await response.json();}catch{throw new WapiError("WAPI returned an invalid response"+(body?"; check provider history before retrying":""),!!body);}
 }
 return {
  async sendDocument(input:{to:string;pdf:Buffer;fileName:string;caption:string}){
   if(!/^\+[1-9]\d{7,14}$/.test(input.to))throw new WapiError("Invalid WhatsApp destination");
   if(input.pdf.subarray(0,5).toString()!=="%PDF-"||input.pdf.length>15*1024*1024)throw new WapiError("Invoice PDF is invalid or exceeds 15 MB");
   return statusOf(await request("/api/v1/send/document",{documentBase64:input.pdf.toString("base64"),fileName:input.fileName.replace(/[\\/\r\n]/g,"-"),caption:input.caption.slice(0,1024),recipients:[input.to],...(config.deviceId?{deviceId:config.deviceId}:{})}));
  },
  async messageStatus(id:string){const data=await request("/api/v1/messages/"+encodeURIComponent(id));return statusOf({...data,messageId:data?.messageId??id});},
  async connection(){const account=await request("/api/v1/account"),devices=await request("/api/v1/devices");if(account?.success!==true||account.isActive!==true||devices?.success!==true||!Array.isArray(devices.devices))throw new WapiError("WAPI account or device response is invalid");return {connected:true,credits:Number(account.credits??0),devices:devices.devices.map((d:any)=>({id:d.id,name:String(d.name??""),status:String(d.status??""),isReady:d.isReady===true}))};}
 };
}
