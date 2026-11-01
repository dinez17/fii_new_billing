/** Calendar dates are stored as ISO dates; display independently of browser locale. */
export function formatDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "—";
}

/** Previous calendar month, clamped to its last day, in the tenant's Indian timezone. */
export function subscriptionStartDefault(now = new Date()): string {
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 const value=(name:string)=>Number(parts.find(p=>p.type===name)!.value);
 const year=value("year"),month=value("month")-1,day=value("day");
 const last=new Date(Date.UTC(year,month,0));
 return new Date(Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),Math.min(day,last.getUTCDate()))).toISOString().slice(0,10);
}
