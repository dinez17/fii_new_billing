import {useState} from "react";
import {IconButton} from "./IconButton";
import {api,errMessage} from "../lib/api";
import {downloadPdf} from "../lib/pdf-download";
export function DocumentDeliveryActions({base,id,label,number,status,email=true,pdf=true,whatsapp=true}:{base:string;id:string;label:string;number:string;status?:string;email?:boolean;pdf?:boolean;whatsapp?:boolean}){
 const [busy,setBusy]=useState(false);
 if(status==="CANCELLED")return null;
 async function send(channel:"email"|"whatsapp"){
  if(!confirm(`Send ${label} ${number} PDF to its saved contact by ${channel==="email"?"email":"WhatsApp"}?`))return;
  setBusy(true);try{await api.post(`${base}/${id}/${channel}`,{requestId:crypto.randomUUID()});alert("Document queued. Check Notifications → Send log for the result.");}catch(e){alert(errMessage(e));}finally{setBusy(false);}
 }
 async function download(){setBusy(true);try{const {data}=await api.get(`${base}/${id}/pdf`,{responseType:"blob"});await downloadPdf(data,number);}catch(e){alert(errMessage(e));}finally{setBusy(false);}}
 return <span className="document-delivery-actions">{pdf&&<IconButton icon="download" label={`Download ${label} PDF`} disabled={busy} onClick={()=>void download()}/>} {email&&<IconButton icon="mail" label={`Email ${label}`} disabled={busy} onClick={()=>void send("email")}/>} {whatsapp&&<IconButton icon="whatsapp" label={`WhatsApp ${label}`} disabled={busy} onClick={()=>void send("whatsapp")}/>}</span>;
}
