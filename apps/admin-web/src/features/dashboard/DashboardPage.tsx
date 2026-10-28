import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface Dash {
  todayCollection: number; mtdSales: number; outstanding: number;
  openComplaints: number; lowStock: number;
}
const inr = (v: number) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const canRead = useAuth((s) => s.hasPerm("report:read"));

  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/reports/dashboard")).data as Dash,
    enabled: canRead,
    refetchInterval: 60_000,
  });

  const d = dash.data;
  const show = (v: number | undefined, fmt: (n: number) => string) =>
    !canRead ? "—" : d ? fmt(v ?? 0) : "…";

  return (
    <>
      <h2 className="page-title">Dashboard</h2>
      <div className="kpis">
        <div className="kpi"><div className="lbl">Today's Collection</div><div className="val">{show(d?.todayCollection, inr)}</div></div>
        <div className="kpi"><div className="lbl">MTD Sales</div><div className="val">{show(d?.mtdSales, inr)}</div></div>
        <div className="kpi"><div className="lbl">Outstanding</div><div className="val">{show(d?.outstanding, inr)}</div></div>
        <div className="kpi"><div className="lbl">Open Complaints</div><div className="val">{show(d?.openComplaints, String)}</div></div>
        <div className="kpi"><div className="lbl">Low Stock Items</div><div className="val">{show(d?.lowStock, String)}</div></div>
      </div>
      {!canRead && (
        <div className="card" style={{ marginTop: 16 }}>
          Welcome, <strong>{user?.name}</strong>. You don't have the <code>report:read</code> permission,
          so live KPIs are hidden.
        </div>
      )}
    </>
  );
}
