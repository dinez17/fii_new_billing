import {useEffect,useState} from "react";
import {useMutation,useQuery} from "@tanstack/react-query";
import {api,errMessage} from "../../lib/api";
import {useAuth} from "../../stores/auth";
export function WhatsAppTab(){
 const canEdit=useAuth(s=>s.hasPerm("settings:update"));
 const [form,setForm]=useState({apiUrl:"https://wapi.fiitech.in",provider:"FII_WAPI",enabled:"false",apiKey:"",deviceId:""});
 const [message,setMessage]=useState("");
 const query=useQuery({queryKey:["whatsapp-settings"],queryFn:async()=> (await api.get("/settings/group/WHATSAPP")).data as Record<string,string>});
 useEffect(()=>{if(query.data)setForm({apiUrl:query.data.apiUrl??"https://wapi.fiitech.in",provider:"FII_WAPI",enabled:query.data.enabled??"false",apiKey:"",deviceId:query.data.deviceId??""});},[query.data]);
 const save=useMutation({mutationFn:()=>api.put("/settings/group/WHATSAPP",form),onSuccess:()=>{setForm(f=>({...f,apiKey:""}));setMessage("WhatsApp settings saved.");void query.refetch();}});
 const test=useMutation({mutationFn:async()=> (await api.post("/settings/whatsapp/test")).data as {credits:number;devices:{id:number;name:string;isReady:boolean}[]},onSuccess:r=>setMessage(`Connection successful. Credits: ${r.credits}. Ready devices: ${r.devices.filter(d=>d.isReady).map(d=>`${d.name} (${d.id})`).join(", ")||"none"}.`)});
 return <section className="card" style={{maxWidth:760}}><h3>WhatsApp invoice delivery</h3>
 <p>Provider: <a href="https://wapi.fiitech.in/api-docs" target="_blank" rel="noreferrer">FII WAPI</a>. Select WhatsApp delivery on each customer. New invoices, including bill-run invoices, are queued automatically.</p>
 <label><input type="checkbox" checked={form.enabled==="true"} disabled={!canEdit} onChange={e=>setForm({...form,enabled:String(e.target.checked)})}/> Enable WhatsApp</label>
 <label htmlFor="whatsapp-api-url">WhatsApp API URL</label><input id="whatsapp-api-url" type="url" placeholder="https://wapi.fiitech.in" disabled={!canEdit} value={form.apiUrl} onChange={e=>setForm({...form,apiUrl:e.target.value})}/><small>Enter the API base URL. The document endpoint is added automatically.</small>
 <label>API key {query.data?.apiKey?"(saved; leave blank to keep)":""}</label><input type="password" autoComplete="new-password" disabled={!canEdit} value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})}/>
 <label>Device ID (optional)</label><input inputMode="numeric" disabled={!canEdit} value={form.deviceId} onChange={e=>setForm({...form,deviceId:e.target.value})}/>
 <p>Save first, then check the connection. This check sends no messages. Delivery status appears under Notifications → Send log.</p>
 {(save.isError||test.isError||query.isError)&&<div className="error">{errMessage(save.error||test.error||query.error)}</div>}
 {message&&<p role="status">{message}</p>}<div className="actions"><button disabled={!canEdit||test.isPending||save.isPending} onClick={()=>test.mutate()}>Check connection</button><button className="primary" disabled={!canEdit||save.isPending} onClick={()=>save.mutate()}>Save</button></div></section>;
}
