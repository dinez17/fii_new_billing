import { useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../lib/api";
export function MoneyAccountSelect({value,onChange}:{value:string;onChange:(id:string)=>void}) {
 const accounts=useQuery({queryKey:["money-accounts"],queryFn:async()=>(await api.get("/financial-controls/money-accounts")).data as Array<{id:string;name:string}>});
 return <label>Cash / bank account<select aria-label="Cash / bank account" value={value} onChange={e=>onChange(e.target.value)}><option value="">Cash / unassigned bank (choose when known)</option>{accounts.data?.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>{accounts.isError&&<small className="error">{errMessage(accounts.error)}</small>}</label>;
}
