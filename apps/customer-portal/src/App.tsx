import { APP_NAME, APP_LOGO, APP_TAGLINE } from "../../../packages/browser/src/brand";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage, useAuth } from "./api";

declare global {
  interface Window {
    Razorpay: new (options: object) => { open: () => void };
  }
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

interface Me {
  customer: { id: string; code: string; name: string; email?: string; phone: string };
  subscribers: { code: string; status: string; type: string; plan: string | null }[];
  outstanding: string;
  company: { name: string } | null;
}
interface Invoice { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; grandTotal: string; amountPaid: string; status: string }
interface Payment {
  id: string; amount: string; tdsAmount?: string; mode: string; paymentDate: string; status: string;
  receipt?: { id: string; receiptNumber: string } | null;
  allocations: { invoice: { invoiceNumber: string } }[];
}
interface Complaint {
  id: string; complaintNumber: string; type: string; subject: string;
  status: string; createdAt: string; resolutionNotes?: string;
}

export function App() {
  const { accessToken } = useAuth();
  return accessToken ? <Portal /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/auth/portal/login", { email, password, otp: otp || undefined });
      setSession({ accessToken: data.accessToken, customerName: data.user.name });
    } catch (err) { setError(errMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <img className="login-logo" src={APP_LOGO} alt={APP_NAME} />
        <h1>{APP_NAME}</h1>
        <p><span className="brand-tagline">{APP_TAGLINE}</span>Customer portal · View invoices and pay online</p>
        <label htmlFor="portal-email">Email</label>
        <input id="portal-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label htmlFor="portal-password">Password</label>
        <input id="portal-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label htmlFor="portal-otp">Authenticator code (if enabled)</label>
        <input id="portal-otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
        {error && <div className="error">{error}</div>}
        <button className="primary" style={{ width: "100%", marginTop: 20 }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function Portal() {
  const qc = useQueryClient();
  const { customerName, logout } = useAuth();
  const [paying, setPaying] = useState(false);
  const [banner, setBanner] = useState("");

  async function signOut() {
    try { await api.post("/auth/logout", {}); } catch { /* clear local session regardless */ }
    logout();
  }

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/portal/me")).data as Me,
  });
  const invoices = useQuery({
    queryKey: ["portal-invoices"],
    queryFn: async () => (await api.get("/portal/invoices")).data.items as Invoice[],
  });
  const payments = useQuery({
    queryKey: ["portal-payments"],
    queryFn: async () => (await api.get("/portal/payments")).data.items as Payment[],
  });
  const complaints = useQuery({
    queryKey: ["portal-complaints"],
    queryFn: async () => (await api.get("/portal/complaints")).data.items as Complaint[],
  });
  const [raising, setRaising] = useState(false);
  const [complaintForm, setComplaintForm] = useState({ type: "NO_SIGNAL", subject: "", description: "" });
  const [raiseBusy, setRaiseBusy] = useState(false);

  async function raiseComplaint() {
    setRaiseBusy(true);
    try {
      await api.post("/portal/complaints", {
        type: complaintForm.type,
        subject: complaintForm.subject,
        description: complaintForm.description || undefined,
      });
      setRaising(false);
      setComplaintForm({ type: "NO_SIGNAL", subject: "", description: "" });
      qc.invalidateQueries({ queryKey: ["portal-complaints"] });
    } catch (err) { alert(errMessage(err)); }
    finally { setRaiseBusy(false); }
  }

  const openInvoices = invoices.data?.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL") ?? [];
  const outstanding = Number(me.data?.outstanding ?? 0);

  async function payNow() {
    if (outstanding <= 0) return;
    setPaying(true); setBanner("");
    try {
      const { data: order } = await api.post("/portal/pay", { invoiceIds: openInvoices.map((i) => i.id) });
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: me.data?.company?.name ?? APP_NAME,
        description: openInvoices.length ? `Payment for ${openInvoices.length} invoice(s)` : "Account balance payment",
        prefill: { name: me.data?.customer.name, email: me.data?.customer.email, contact: me.data?.customer.phone },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const { data } = await api.post("/portal/pay/verify", resp);
            setBanner(`Payment successful — receipt ${data.receiptNumber ?? ""}`);
            qc.invalidateQueries();
          } catch (err) { alert(errMessage(err)); }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setPaying(false);
    }
  }

  async function downloadPdf(path: string) {
    try {
      const { data } = await api.get(path, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { alert(errMessage(err)); }
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>{me.data?.company?.name ?? APP_NAME}</h1>
        <div className="who">
          <span data-theme-picker />
          {customerName} <button className="small" style={{ marginLeft: 10 }} onClick={() => void signOut()}>Logout</button>
        </div>
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      <div className="card">
        <div className="outstanding">
          <div>
            <h2>Outstanding balance</h2>
            <div className="amount" style={{ color: Number(me.data?.outstanding ?? 0) > 0 ? "var(--danger)" : "var(--ok)" }}>
              {me.data ? inr(me.data.outstanding) : "—"}
            </div>
          </div>
          <button className="primary" disabled={paying || outstanding <= 0} onClick={() => void payNow()}>
            {paying ? "Opening checkout…" : outstanding > 0 ? `Pay Now ${inr(outstanding)}` : "Nothing due"}
          </button>
        </div>
        {me.data && me.data.subscribers.length > 0 && (
          <p style={{ color: "var(--muted)", marginTop: 12, fontSize: 13 }}>
            {me.data.subscribers.map((s) => `${s.code} · ${s.plan ?? "no plan"} · ${s.status}`).join("  |  ")}
          </p>
        )}
      </div>

      <div className="card">
        <h2>My invoices</h2>
        <table>
          <thead><tr><th>Number</th><th>Date</th><th>Due</th><th>Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {invoices.data?.map((inv) => (
              <tr key={inv.id}>
                <td><code>{inv.invoiceNumber}</code></td>
                <td>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                <td>{new Date(inv.dueDate).toLocaleDateString()}</td>
                <td>{inr(inv.grandTotal)}</td>
                <td><span className={`badge ${inv.status === "PAID" ? "ok" : inv.status === "CANCELLED" ? "" : "warn"}`}>{inv.status}</span></td>
                <td><button className="small" onClick={() => void downloadPdf(`/portal/invoices/${inv.id}/pdf`)}>PDF</button></td>
              </tr>
            ))}
            {invoices.data?.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>My complaints</h2>
          <button className="small primary" onClick={() => setRaising(!raising)}>
            {raising ? "Cancel" : "+ Raise complaint"}
          </button>
        </div>
        {raising && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <label>Type</label>
            <select value={complaintForm.type} onChange={(e) => setComplaintForm({ ...complaintForm, type: e.target.value })}>
              <option>NO_SIGNAL</option><option>SLOW_SPEED</option><option>BILLING_ISSUE</option>
              <option>RELOCATION</option><option>EQUIPMENT</option><option>OTHER</option>
            </select>
            <label>Subject *</label>
            <input value={complaintForm.subject} onChange={(e) => setComplaintForm({ ...complaintForm, subject: e.target.value })}
              placeholder="Internet not working since morning" />
            <label>Details</label>
            <input value={complaintForm.description} onChange={(e) => setComplaintForm({ ...complaintForm, description: e.target.value })} />
            <button className="primary" style={{ marginTop: 12 }}
              disabled={raiseBusy || complaintForm.subject.length < 3} onClick={() => void raiseComplaint()}>
              {raiseBusy ? "Submitting…" : "Submit complaint"}
            </button>
          </div>
        )}
        <table>
          <thead><tr><th>Number</th><th>Date</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody>
            {complaints.data?.map((c) => (
              <tr key={c.id}>
                <td><code>{c.complaintNumber}</code></td>
                <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                <td>
                  {c.subject}
                  {c.resolutionNotes && <div style={{ fontSize: 12, color: "var(--ok)" }}>Resolution: {c.resolutionNotes}</div>}
                </td>
                <td><span className={`badge ${["RESOLVED", "CLOSED"].includes(c.status) ? "ok" : "warn"}`}>{c.status.replace(/_/g, " ")}</span></td>
              </tr>
            ))}
            {complaints.data?.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No complaints raised.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Payment history</h2>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Against</th><th>Status</th><th /></tr></thead>
          <tbody>
            {payments.data?.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                <td>{inr(p.amount)}{Number(p.tdsAmount ?? 0) > 0 && <div className="document-help">TDS deducted: {inr(p.tdsAmount)}</div>}</td>
                <td>{p.mode}</td>
                <td style={{ fontSize: 13 }}>{p.allocations.map((a) => a.invoice.invoiceNumber).join(", ") || "—"}</td>
                <td><span className={`badge ${p.status === "SUCCESS" ? "ok" : p.status === "FAILED" ? "warn" : ""}`}>{p.status}</span></td>
                <td>{p.receipt && <button className="small" onClick={() => void downloadPdf(`/portal/receipts/${p.receipt!.id}/pdf`)}>Receipt</button>}</td>
              </tr>
            ))}
            {payments.data?.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
