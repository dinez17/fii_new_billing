import { ListTable } from "../../components/ListPagination";
import { useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface License {
  name: string; subdomain: string; planCode: string; licenseStatus: string; effectiveStatus: string;
  licenseStartsAt: string | null; licenseEndsAt: string | null; trialEndsAt: string | null; validUntil: string | null;
  daysRemaining: number | null; maxUsers: number; maxCustomers: number; usage: { users: number; customers: number };
}
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "Not specified";

export function LicenseTab() {
  const userId = useAuth((state) => state.user?.id);
  const license = useQuery({ queryKey: ["tenant-license", userId], queryFn: async () => (await api.get("/settings/license")).data as License, refetchOnMount: "always", refetchInterval: 60_000, enabled: !!userId });
  if (license.isPending) return <div className="card" role="status">Loading license details…</div>;
  if (license.isError) return <div className="card"><div className="error" role="alert">{errMessage(license.error)}</div><button onClick={() => void license.refetch()}>Retry</button></div>;
  const data = license.data;
  const allowed = ["ACTIVE", "TRIAL"].includes(data.effectiveStatus);
  return <div className="card" style={{ maxWidth: 820 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><h3>License details</h3><button disabled={license.isFetching} onClick={() => void license.refetch()}>{license.isFetching ? "Refreshing…" : "Refresh"}</button></div>
    <p>{data.name} · <code>{data.subdomain}</code></p>
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18, margin: "20px 0" }}>
      <div><dt>Plan</dt><dd style={{ margin: "6px 0", fontWeight: 700 }}>{data.planCode}</dd></div>
      <div><dt>Current status</dt><dd style={{ margin: "6px 0" }}><span className={`badge ${allowed ? "ok" : "warn"}`}>{data.effectiveStatus}</span>{data.effectiveStatus !== data.licenseStatus && <small> (recorded: {data.licenseStatus})</small>}</dd></div>
      <div><dt>License starts</dt><dd style={{ margin: "6px 0" }}>{date(data.licenseStartsAt)}</dd></div>
      <div><dt>{data.licenseStatus === "TRIAL" ? "Trial expires" : "License expires"}</dt><dd style={{ margin: "6px 0" }}>{data.validUntil ? date(data.validUntil) : "No expiry date set"}</dd></div>
      {data.licenseStatus !== "TRIAL" && data.trialEndsAt && <div><dt>Trial end date</dt><dd style={{ margin: "6px 0" }}>{date(data.trialEndsAt)}</dd></div>}
      {data.daysRemaining !== null && <div><dt>Time remaining</dt><dd style={{ margin: "6px 0" }}>{data.daysRemaining === 0 ? "Expired" : `${data.daysRemaining} day${data.daysRemaining === 1 ? "" : "s"}`}</dd></div>}
    </dl>
    {!allowed && <div className="error" role="status">License access is {data.effectiveStatus.toLowerCase()}. Contact your software provider for assistance.</div>}
    {allowed && data.daysRemaining !== null && data.daysRemaining <= 7 && <p role="status">Your {data.licenseStatus === "TRIAL" ? "trial" : "license"} expires soon. Contact your software provider to renew.</p>}
    <h4>Usage and licensed limits</h4>
    <ListTable><thead><tr><th>Resource</th><th>Used</th><th>Licensed limit</th><th>Remaining</th></tr></thead><tbody>
      {([ ["Users", data.usage.users, data.maxUsers], ["Customers", data.usage.customers, data.maxCustomers] ] as const).map(([label, used, limit]) => <tr key={label}><td>{label}</td><td>{used.toLocaleString("en-IN")}</td><td>{limit.toLocaleString("en-IN")}</td><td>{used > limit ? `${(used - limit).toLocaleString("en-IN")} over limit` : (limit - used).toLocaleString("en-IN")}</td></tr>)}
    </tbody></ListTable>
    <p style={{ color: "var(--muted)", marginTop: 14 }}>Dates are shown in India Standard Time. User usage includes all tenant accounts. Contact your software provider for renewal, plan changes or higher limits.</p>
  </div>;
}
