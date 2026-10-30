import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, errMessage } from "../../lib/api";
import { formatDate } from "../../lib/date";
import { useAuth } from "../../stores/auth";
import { ActionIcon } from "../../components/IconButton";
import "./dashboard.css";

interface Dashboard {
  generatedAt: string; today: string; month: string; timeZone: string;
  financialYear: { code: string; isLocked: boolean } | null;
  todayCollection: number; todayReceiptCount: number; mtdSales: number; monthInvoiceCount: number; monthCollections: number;
  fiscalSales: number | null; fiscalCollections: number | null; fiscalInvoiceCount: number | null;
  outstanding: number; customerCredit: number; dueCustomers: number; customers: { active: number; inactive: number };
  overdue: { amount: number; count: number }; aging: Record<string, { amount: number; count: number }>;
  monthExpenses: number; monthExpenseCount: number; monthPurchases: number; monthPurchaseCount: number; purchaseBillsDue: number; purchaseBillsDueCount: number;
  subscribers: { active: number; suspended: number; terminated: number; gst: number; withoutGst: number };
  openComplaints: number; lowStock: number; overdueTasks: number; heldInvoices: number;
  quotations: { count: number; amount: number }; proformas: { count: number; amount: number };
  monthly: { month: string; sales: number; collected: number; gstSales: number; withoutGstSales: number }[];
  topCustomers: { id: string; name: string; code: string; amount: number; invoiceCount: number; isActive: boolean }[];
  recentPayments: { id: string; amount: number; paymentDate: string; mode: string; customer: { name: string }; receipt: { receiptNumber: string } | null }[];
  overdueInvoices: { id: string; invoiceNumber: string; dueDate: string; balance: number; chargeGst: boolean; customer: { name: string } }[];
}
const inr = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const monthName = (value: string, long = false) => new Intl.DateTimeFormat("en-IN", { month: long ? "long" : "short", ...(long ? { year: "numeric" as const } : {}), timeZone: "UTC" }).format(new Date(value + "-01T00:00:00Z"));
const buckets = [["notDue", "Not due"], ["days1to30", "1–30 days"], ["days31to60", "31–60 days"], ["days61to90", "61–90 days"], ["days90plus", "90+ days"]];

export function DashboardPage() {
  const user = useAuth(s => s.user), hasPerm = useAuth(s => s.hasPerm), navigate = useNavigate();
  const canRead = hasPerm("report:read");
  const dash = useQuery({ queryKey: ["dashboard", user?.id], queryFn: async () => (await api.get<Dashboard>("/reports/dashboard")).data, enabled: canRead, refetchInterval: 60_000 });
  const d = dash.data;
  const open = (path: string, permission: string) => hasPerm(permission) ? () => navigate(path) : undefined;
  if (!canRead) return <><h2 className="page-title">Dashboard</h2><div className="card">Welcome, <strong>{user?.name}</strong>. Your account does not have access to business reports.</div></>;
  if (!d) return <><h2 className="page-title">Business overview</h2>{dash.isError ? <div className="error" role="alert">{errMessage(dash.error)} <button onClick={() => void dash.refetch()}>Retry</button></div> : <div className="dashboard-loading" role="status">Loading your business overview…</div>}</>;
  const chartMax = Math.max(1, ...d.monthly.flatMap(row => [row.sales, row.collected]));
  const ageTotal = Object.values(d.aging).reduce((sum, row) => sum + row.amount, 0);
  const cards = [
    { label: "Billed this month", value: d.mtdSales, detail: `${d.monthInvoiceCount} invoices · GST + without GST`, icon: "ledger" as const, tone: "blue" },
    { label: "Collected this month", value: d.monthCollections, detail: monthName(d.month, true), icon: "pay" as const, tone: "green" },
    { label: "Customer outstanding", value: d.outstanding, detail: `${d.dueCustomers} customers with a balance`, icon: "warning" as const, tone: "amber" },
    { label: "Collected today", value: d.todayCollection, detail: `${d.todayReceiptCount} successful payments · ${formatDate(d.today)}`, icon: "check" as const, tone: "violet" },
  ];
  return <div className="business-dashboard">
    <header className="dashboard-heading"><div><div className="dashboard-eyebrow">DASHBOARD / OVERVIEW</div><h2>Business overview</h2><p>{formatDate(d.today)} <span>·</span> {d.financialYear ? `FY ${d.financialYear.code}${d.financialYear.isLocked ? " · Locked" : ""}` : "No active financial year"}</p></div><div className="dashboard-heading-actions"><span className="dashboard-sync">Updated {new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(d.generatedAt))} IST</span><button className="small" disabled={dash.isFetching} onClick={() => void dash.refetch()}>{dash.isFetching ? "Refreshing…" : "Refresh"}</button></div></header>
    {!d.financialYear && <div className="dashboard-notice">Set an active financial year in Settings to see financial-year totals.</div>}
    {dash.isError && <div className="error" role="alert">Unable to refresh. The figures below were last updated at the time shown above. {errMessage(dash.error)}</div>}
    {d.heldInvoices > 0 && <div className="dashboard-notice">{d.heldInvoices} legacy invoices are held for review and excluded from these balances. {hasPerm("settings:read") && <button className="small" onClick={() => navigate("/settings")}>Review in Settings</button>}</div>}
    <section className="dashboard-metrics" aria-label="Billing and collection highlights">{cards.map(card => <article key={card.label} className={`dashboard-metric ${card.tone}`}><div className="metric-top"><span>{card.label}</span><span className="metric-icon"><ActionIcon name={card.icon} /></span></div><strong>{inr(card.value)}</strong><p>{card.detail}</p></article>)}</section>
    <div className="dashboard-main-grid">
      <section className="dashboard-panel"><div className="panel-heading"><div><h3>Billing & collections</h3><p>Last 6 months {d.financialYear ? `· FY ${d.financialYear.code}` : ""}</p></div><div className="chart-legend"><span><i /> Billed</span><span><i /> Collected</span></div></div>
        <figure className="dashboard-chart" aria-label="Monthly billed sales and collected payments"><div className="chart-scale">{inr(chartMax === 1 && d.monthly.every(row => !row.sales && !row.collected) ? 0 : chartMax)}</div><div className="chart-months">{d.monthly.map(row => <div className="chart-month" key={row.month}><div className="chart-bar-area" aria-label={`${monthName(row.month, true)}: billed ${inr(row.sales)}, collected ${inr(row.collected)}`}><span className="chart-bar billed" title={`Billed: ${inr(row.sales)}`} style={{ height: `${row.sales / chartMax * 100}%` }} /><span className="chart-bar collected" title={`Collected: ${inr(row.collected)}`} style={{ height: `${row.collected / chartMax * 100}%` }} /></div><strong>{monthName(row.month)}</strong><small>{new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(row.sales)} / {new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(row.collected)}</small></div>)}</div><figcaption>Billed includes GST and without-GST invoices. Collections are successful payments, not profit.</figcaption></figure>
        <div className="dashboard-fiscal"><div><span>FY billed</span><strong>{d.fiscalSales === null ? "—" : inr(d.fiscalSales)}</strong></div><div><span>FY collected</span><strong>{d.fiscalCollections === null ? "—" : inr(d.fiscalCollections)}</strong></div><div><span>FY invoices</span><strong>{d.fiscalInvoiceCount ?? "—"}</strong></div></div>
      </section>
      <section className="dashboard-panel"><div className="panel-heading"><div><h3>Invoice ageing</h3><p>{d.overdue.count} overdue invoices</p></div><span className="dashboard-pill amber">{inr(d.overdue.amount)} overdue</span></div><div className="aging-list">{buckets.map(([key, label]) => <div key={key}><div className="aging-label"><span>{label}</span><strong>{inr(d.aging[key]?.amount || 0)}</strong></div><div className={`aging-track ${key}`}><i style={{ width: `${ageTotal ? (d.aging[key]?.amount || 0) / ageTotal * 100 : 0}%` }} /></div></div>)}</div><p className="dashboard-footnote">Invoice ageing excludes opening balances and unallocated receipts. Total customer outstanding includes both.</p></section>
    </div>
    <section className="dashboard-pulse" aria-label="Business activity">
      <Pulse title="Active customers" value={String(d.customers.active)} detail={`${d.customers.inactive} inactive · ${inr(d.customerCredit)} customer credit`} onClick={open("/customers", "customer:read")} />
      <Pulse title="Active subscriptions" value={String(d.subscribers.active)} detail={`${d.subscribers.gst} GST · ${d.subscribers.withoutGst} without GST · ${d.subscribers.suspended} suspended`} onClick={open("/subscribers", "subscriber:read")} />
      <Pulse title="Open quotations" value={String(d.quotations.count)} detail={`${inr(d.quotations.amount)} proposed · Not invoiced`} onClick={open("/quotations", "invoice:read")} />
      <Pulse title="Open proformas" value={String(d.proformas.count)} detail={`${inr(d.proformas.amount)} proposed · Not invoiced`} onClick={open("/proformas", "invoice:read")} />
      <Pulse title="Expenses this month" value={inr(d.monthExpenses)} detail={`${d.monthExpenseCount} recorded expenses`} onClick={open("/expenses", "expense:read")} />
      <Pulse title="Purchases this month" value={inr(d.monthPurchases)} detail={`${d.monthPurchaseCount} bills · ${inr(d.purchaseBillsDue)} open purchase bills due`} onClick={open("/purchases", "purchase_invoice:read")} />
    </section>
    <div className="dashboard-main-grid equal">
      <section className="dashboard-panel"><div className="panel-heading"><div><h3>Customers to follow up</h3><p>Largest current balances · All financial years</p></div>{hasPerm("customer:read") && <button className="small" onClick={() => navigate("/customers")}>View customers</button>}</div><ul className="dashboard-records">{d.topCustomers.map((customer, index) => <li key={customer.id}><span className="record-avatar">{String(index + 1).padStart(2, "0")}</span><div><strong>{customer.name}</strong><span>{customer.code} · {customer.invoiceCount} due invoices{customer.isActive ? "" : " · Inactive"}</span></div><b>{inr(customer.amount)}</b></li>)}</ul>{!d.topCustomers.length && <Empty text="No customer balances to follow up." />}</section>
      <section className="dashboard-panel"><div className="panel-heading"><div><h3>Latest collections</h3><p>Successful payments across both registers</p></div>{hasPerm("payment:read") && <button className="small" onClick={() => navigate("/payments")}>View payments</button>}</div><ul className="dashboard-records">{d.recentPayments.map(payment => <li key={payment.id}><span className="record-avatar green"><ActionIcon name="pay" /></span><div><strong>{payment.customer.name}</strong><span>{formatDate(new Date(new Date(payment.paymentDate).getTime() + 330 * 60_000).toISOString().slice(0, 10))} · {payment.mode.replace(/_/g, " ")}</span></div><b>{inr(payment.amount)}</b></li>)}</ul>{!d.recentPayments.length && <Empty text="No successful payments recorded yet." />}</section>
    </div>
    <section className="dashboard-panel"><div className="panel-heading"><div><h3>Needs attention</h3><p>Open work across your business</p></div></div><div className="dashboard-attention"><Pulse title="Open support tickets" value={String(d.openComplaints)} detail="Unresolved customer complaints" onClick={open("/complaints", "complaint:read")} /><Pulse title="Low-stock products" value={String(d.lowStock)} detail="Active goods at or below reorder level" onClick={open("/products", "product:read")} /><Pulse title="Overdue tasks" value={String(d.overdueTasks)} detail="Pending work past its due date" onClick={open("/tasks", "task:read")} /></div>
      {!!d.overdueInvoices.length && <div className="dashboard-overdue"><h4>Oldest overdue invoices</h4>{d.overdueInvoices.map(invoice => <div key={invoice.id}><span><strong>{invoice.invoiceNumber}</strong><small>{invoice.customer.name} · Due {formatDate(invoice.dueDate)} · {invoice.chargeGst ? "GST" : "Without GST"}</small></span><b>{inr(invoice.balance)}</b></div>)}</div>}
    </section>
    <footer className="dashboard-footer"><span>Balances include opening amounts and unallocated payments. Held imports and non-accounting documents are excluded.</span><div>{hasPerm("invoice:create") && <button className="primary" onClick={() => navigate("/invoices/new")}>+ New invoice</button>}{hasPerm("invoice:create") && <button onClick={() => navigate("/quotations/new")}>New quotation</button>}</div></footer>
  </div>;
}
function Pulse({ title, value, detail, onClick }: { title: string; value: string; detail: string; onClick?: () => void }) {
  const content = <><span>{title}</span><strong>{value}</strong><small>{detail}</small></>;
  return onClick ? <button className="dashboard-pulse-item" onClick={onClick}>{content}</button> : <article className="dashboard-pulse-item">{content}</article>;
}
function Empty({ text }: { text: string }) { return <p className="dashboard-empty">{text}</p>; }
