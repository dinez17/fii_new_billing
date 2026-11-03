/** Only explicitly selected invoices are settled. Never infer TDS from other dues. */
export function calculateTdsSettlement(invoices: {id:string; balance:number; date:string; number:string}[], received:string) {
  const cents=(n:number)=>Math.round((n+Number.EPSILON)*100);
  const cash=cents(Number(received || 0));
  const rows=[...invoices].sort((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number));
  const total=rows.reduce((sum,i)=>sum+Math.max(0,cents(i.balance)),0);
  const valid=Number.isFinite(cash)&&cash>=0&&cash<=total;
  const allocations:Record<string,string>={},tdsAllocations:Record<string,string>={};
  let left=valid?cash:0;
  if(valid)for(const row of rows){
    const balance=Math.max(0,cents(row.balance)),take=Math.min(left,balance);
    left-=take;
    if(take)allocations[row.id]=(take/100).toFixed(2);
    if(balance>take)tdsAllocations[row.id]=((balance-take)/100).toFixed(2);
  }
  return {valid,tdsAmount:valid?((total-cash)/100).toFixed(2):"0.00",allocations,tdsAllocations};
}
