import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { NonGstCompanyTab } from "./NonGstCompanyTab";
import { InvoiceTemplatesTab } from "./InvoiceTemplatesTab";
import { LicenseTab } from "./LicenseTab";
import { LegacyImportTab } from "./LegacyImportTab";
import { FinancialControlsPage } from "../accounting/FinancialControlsPage";
import { isPlatformConsole } from "../../lib/console";

type Tab = "accounts" | "nonGst" | "invoice" | "company" | "fy" | "series" | "terms" | "inventory" | "gateway" | "smtp" | "security" | "license" | "legacy";

const TAB_LABELS: Record<Tab, string> = {
  nonGst: "Without-GST company", invoice: "Invoice format", company: "Company profile", fy: "Financial years", series: "Number series",
  accounts: "Cash / bank accounts", license: "License",
  legacy: "Legacy import",
  terms: "Terms & Conditions", inventory: "Inventory", gateway: "Payment gateway", smtp: "Email (SMTP)", security: "My security",
};

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("company");
  const canReadAccounts = useAuth((state) => state.hasPerm("report:read"));
  const canReadLegacy = useAuth((state) => state.hasPerm("backup:read"));
  return (
    <>
      <h2 className="page-title">Settings</h2>
      <div className="toolbar">
        {(Object.keys(TAB_LABELS) as Tab[]).filter((t) => (t !== "accounts" || (!isPlatformConsole && canReadAccounts)) && (t !== "nonGst" || !isPlatformConsole) && (t !== "license" || !isPlatformConsole) && (t !== "legacy" || (!isPlatformConsole && canReadLegacy))).map((t) => (
          <button key={t} className={tab === t ? "primary" : ""} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "accounts" && canReadAccounts && !isPlatformConsole && <FinancialControlsPage />}
      {tab === "company" && <CompanyTab />}
      {tab === "invoice" && <InvoiceTemplatesTab />}
      {tab === "nonGst" && !isPlatformConsole && <NonGstCompanyTab />}
      {tab === "license" && !isPlatformConsole && <LicenseTab />}
      {tab === "legacy" && !isPlatformConsole && canReadLegacy && <LegacyImportTab />}
      {tab === "fy" && <FyTab />}
      {tab === "series" && <SeriesTab />}
      {tab === "terms" && <TermsTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "gateway" && <GatewayTab />}
      {tab === "smtp" && <SmtpTab />}
      {tab === "security" && <SecurityTab />}
    </>
  );
}

function SecurityTab() {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function begin() { try { setSetup((await api.post("/auth/mfa/setup", {})).data); setError(""); } catch (e) { setError(errMessage(e)); } }
  async function confirm() { try { await api.post("/auth/mfa/confirm", { code }); setMessage("MFA enabled."); setSetup(null); } catch (e) { setError(errMessage(e)); } }
  async function disable() { try { await api.post("/auth/mfa/disable", { password, code }); useAuth.getState().logout(); window.location.href = "/login"; } catch (e) { setError(errMessage(e)); } }
  async function verifyEmail() { try { await api.post("/auth/email/send-verification", {}); setMessage("Verification email sent."); } catch (e) { setError(errMessage(e)); } }
  return <div className="card" style={{ maxWidth: 620 }}>
    <h3>Multi-factor authentication</h3>
    <button onClick={() => void begin()}>Set up authenticator</button>
    {setup && <div style={{ marginTop: 12 }}>
      <p>Add this secret to your authenticator: <code>{setup.secret}</code></p>
      <p style={{ overflowWrap: "anywhere", fontSize: 12 }}>{setup.otpauthUrl}</p>
      <input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      <button className="primary" disabled={code.length !== 6} onClick={() => void confirm()}>Confirm MFA</button>
    </div>}
    <h3 style={{ marginTop: 24 }}>Disable MFA</h3>
    <input type="password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
    <button onClick={() => void disable()}>Disable and sign out</button>
    <h3 style={{ marginTop: 24 }}>Email verification</h3>
    <button onClick={() => void verifyEmail()}>Send verification email</button>
    {message && <div className="success-banner">{message}</div>}{error && <div className="error">{error}</div>}
  </div>;
}

// ── Inventory options ────────────────────────────────────────────
function InventoryTab() {
  const qc = useQueryClient();
  const canEdit = useAuth((s) => s.hasPerm("settings:update"));
  const [form, setForm] = useState<Record<string, string>>({ allowNegativeStock: "false" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ["inventory-settings"],
    queryFn: async () => (await api.get("/settings/group/INVENTORY")).data as Record<string, string>,
  });
  useEffect(() => {
    if (settings.data) setForm((f) => ({ ...f, ...settings.data }));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => { await api.put("/settings/group/INVENTORY", form); },
    onSuccess: () => { setError(""); setSaved(true); void qc.invalidateQueries({ queryKey: ["inventory-settings"] }); setTimeout(() => setSaved(false), 2500); },
    onError: (err) => setError(errMessage(err)),
  });

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <label style={{ marginTop: 0 }} htmlFor="allow-negative-stock">Allow negative stock</label>
      <select id="allow-negative-stock" value={form.allowNegativeStock ?? "false"} disabled={!canEdit || settings.isPending || settings.isError || save.isPending}
        onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.value })}>
        <option value="false">Disabled — block stock reductions below zero</option>
        <option value="true">Enabled — allow stock below zero</option>
      </select>
      <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13 }}>
        When enabled, invoices, outward adjustments and purchase returns may reduce stock below zero.
        When disabled, insufficient stock is rejected. Incoming stock can always replenish an existing negative balance.
      </p>
      {error && <div className="error">{error}</div>}
      {settings.isError && <div className="error">{errMessage(settings.error)}</div>}
      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button className="primary" disabled={save.isPending || settings.isPending || settings.isError} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Terms & Conditions per document ──────────────────────────────
const TERMS_DOCS: Array<[string, string]> = [
  ["INVOICE", "Tax Invoice"],
  ["PROFORMA_INVOICE", "Proforma Invoice"],
  ["QUOTATION", "Quotation"],
  ["PURCHASE_ORDER", "Purchase Order"],
  ["RECEIPT", "Payment Receipt"],
  ["CREDIT_NOTE", "Credit Note"],
  ["DEBIT_NOTE", "Debit Note"],
];

function TermsTab() {
  const canEdit = useAuth((s) => s.hasPerm("settings:update"));
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState("INVOICE");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ["terms-settings"],
    queryFn: async () => (await api.get("/settings/group/TERMS")).data as Record<string, string>,
  });
  useEffect(() => {
    if (settings.data) setForm((f) => ({ ...f, ...settings.data }));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => { await api.put("/settings/group/TERMS", form); },
    onSuccess: () => { setError(""); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (err) => setError(errMessage(err)),
  });

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Printed on the corresponding document PDF. Invoice terms apply to both manual and
        auto-generated subscription invoices (existing invoices keep the terms they were created with).
      </p>
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        {TERMS_DOCS.map(([code, label]) => (
          <button key={code} className={`small ${selected === code ? "primary" : ""}`} onClick={() => setSelected(code)}>
            {label}
          </button>
        ))}
      </div>
      <label>{TERMS_DOCS.find(([c]) => c === selected)?.[1]} — terms & conditions</label>
      <textarea rows={8} style={{ width: "100%", font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 8 }}
        value={form[selected] ?? ""} disabled={!canEdit}
        placeholder={"1. Payment is required within the stipulated due date from the issuance of the invoice.\n2. A fine will be applicable for payments made after the due date."}
        onChange={(e) => setForm({ ...form, [selected]: e.target.value })} />
      {error && <div className="error">{error}</div>}
      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save all"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── SMTP ─────────────────────────────────────────────────────────
function SmtpTab() {
  const canEdit = useAuth((s) => s.hasPerm("settings:update"));
  const [form, setForm] = useState<Record<string, string>>({
    host: "", port: "587", user: "", password: "", fromEmail: "", fromName: "", enabled: "true",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ["smtp"],
    queryFn: async () => (await api.get("/settings/group/SMTP")).data as Record<string, string>,
  });
  useEffect(() => {
    if (settings.data) setForm((f) => ({ ...f, ...settings.data }));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => { await api.put("/settings/group/SMTP", form); },
    onSuccess: () => { setError(""); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (err) => setError(errMessage(err)),
  });

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Used for invoice/payment/reminder emails. For Gmail use smtp.gmail.com, port 587, and an App Password.
        Set enabled=true to activate sending.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <div><label>Host</label><input value={form.host ?? ""} disabled={!canEdit} placeholder="smtp.gmail.com"
          onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
        <div><label>Port</label><input value={form.port ?? ""} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, port: e.target.value })} /></div>
      </div>
      <label>Username</label>
      <input value={form.user ?? ""} disabled={!canEdit} onChange={(e) => setForm({ ...form, user: e.target.value })} />
      <label>Password (app password)</label>
      <input value={form.password ?? ""} disabled={!canEdit} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label>From email</label><input value={form.fromEmail ?? ""} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, fromEmail: e.target.value })} /></div>
        <div><label>From name</label><input value={form.fromName ?? ""} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, fromName: e.target.value })} /></div>
      </div>
      <label>Enabled</label>
      <select value={form.enabled ?? "true"} disabled={!canEdit} onChange={(e) => setForm({ ...form, enabled: e.target.value })}>
        <option value="true">true</option><option value="false">false</option>
      </select>
      {error && <div className="error">{error}</div>}
      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Payment gateway (Razorpay) ───────────────────────────────────
function GatewayTab() {
  const canEdit = useAuth((s) => s.hasPerm("settings:update"));
  const [form, setForm] = useState<Record<string, string>>({ keyId: "", keySecret: "", webhookSecret: "", enabled: "true" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ["gw-razorpay"],
    queryFn: async () => (await api.get("/settings/group/GATEWAY_RAZORPAY")).data as Record<string, string>,
  });

  useEffect(() => {
    if (settings.data) setForm((f) => ({ ...f, ...settings.data }));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => { await api.put("/settings/group/GATEWAY_RAZORPAY", form); },
    onSuccess: () => { setError(""); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (err) => setError(errMessage(err)),
  });

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Razorpay test/live keys from dashboard.razorpay.com → Account &amp; Settings → API Keys.
        Secrets are encrypted at rest; saved values show as ••••••••, leave them unchanged to keep.
      </p>
      <label>Key ID</label>
      <input value={form.keyId ?? ""} disabled={!canEdit} placeholder="rzp_test_..."
        onChange={(e) => setForm({ ...form, keyId: e.target.value })} />
      <label>Key Secret</label>
      <input value={form.keySecret ?? ""} disabled={!canEdit} placeholder="secret"
        onChange={(e) => setForm({ ...form, keySecret: e.target.value })} />
      <label>Webhook Secret (from Razorpay webhook settings; needed for webhooks only)</label>
      <input value={form.webhookSecret ?? ""} disabled={!canEdit}
        onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} />
      {error && <div className="error">{error}</div>}
      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Company profile ──────────────────────────────────────────────
function CompanyTab() {
  const qc = useQueryClient();
  const canEdit = useAuth((s) => s.hasPerm("settings:update"));
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const company = useQuery({
    queryKey: ["company"],
    queryFn: async () => (await api.get("/settings/company")).data as Record<string, string | null>,
  });

  async function uploadLogo(file: File) {
    if (!/image\/(png|jpeg)/.test(file.type)) { alert("PNG or JPEG only"); return; }
    if (file.size > 300_000) { alert("Logo must be under 300KB — resize it first"); return; }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api.post("/settings/company/logo", { dataUrl });
      qc.invalidateQueries({ queryKey: ["company"] });
    } catch (err) { alert(errMessage(err)); }
    finally { setLogoBusy(false); }
  }

  async function removeLogo() {
    if (!confirm("Remove the company logo?")) return;
    try { await api.delete("/settings/company/logo"); qc.invalidateQueries({ queryKey: ["company"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  useEffect(() => {
    if (company.data) {
      const f: Record<string, string> = {};
      for (const k of ["name", "legalName", "gstin", "pan", "addressLine1", "addressLine2", "city", "stateCode", "pincode", "phone", "email",
        "bankPayableAt", "bankName", "bankBranch", "bankAccountNo", "bankIfsc"]) {
        f[k] = (company.data[k] as string) ?? "";
      }
      setForm(f);
    }
  }, [company.data]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(form)) body[k] = v || undefined;
      await api.put("/settings/company", body);
    },
    onSuccess: () => { setError(""); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (err) => setError(errMessage(err)),
  });

  const field = (k: string, label: string, props: object = {}) => (
    <div>
      <label>{label}</label>
      <input value={form[k] ?? ""} disabled={!canEdit} {...props}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
        <div style={{
          width: 110, height: 65, border: "1px dashed var(--border)", borderRadius: 8,
          display: "grid", placeItems: "center", overflow: "hidden", background: "#fff",
        }}>
          {company.data?.logoUrl
            ? <img src={company.data.logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
            : <span style={{ color: "var(--muted)", fontSize: 11 }}>No logo</span>}
        </div>
        {canEdit && (
          <div>
            <label style={{ margin: 0 }}>Company logo (sidebar and invoices · PNG/JPEG, max 300KB)</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input type="file" accept="image/png,image/jpeg" disabled={logoBusy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
              {company.data?.logoUrl && <button className="small danger" onClick={() => void removeLogo()}>Remove</button>}
            </div>
            {logoBusy && <span style={{ color: "var(--muted)", fontSize: 12 }}>Uploading…</span>}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {field("name", "Company name *")}
        {field("legalName", "Legal name")}
        {field("gstin", "GSTIN")}
        {field("pan", "PAN")}
        {field("addressLine1", "Address line 1")}
        {field("addressLine2", "Address line 2")}
        {field("city", "City")}
        {field("stateCode", "GST state code (e.g. 33)")}
        {field("pincode", "Pincode")}
        {field("phone", "Phone")}
        {field("email", "Email")}
        {field("bankPayableAt", "Bank: payable at")}
        {field("bankName", "Bank name")}
        {field("bankBranch", "Bank branch")}
        {field("bankAccountNo", "Bank account no")}
        {field("bankIfsc", "Bank IFSC")}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
        Terms &amp; conditions for invoices and other documents are managed under
        Settings → Terms &amp; Conditions.
      </p>
      {error && <div className="error">{error}</div>}
      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Financial years ──────────────────────────────────────────────
interface Fy { id: string; code: string; startDate: string; endDate: string; isActive: boolean; isLocked: boolean }

function FyTab() {
  const qc = useQueryClient();
  const canEdit = useAuth((s) => s.hasPerm("financial_year:update"));
  const canCreate = useAuth((s) => s.hasPerm("financial_year:create"));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const now = new Date();
  const nextStart = now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear();
  const [form, setForm] = useState({
    code: `${nextStart}-${String(nextStart + 1).slice(2)}`,
    startDate: `${nextStart}-04-01`,
    endDate: `${nextStart + 1}-03-31`,
  });

  const fys = useQuery({
    queryKey: ["fys"],
    queryFn: async () => (await api.get("/financial-years")).data as Fy[],
  });

  const create = useMutation({
    mutationFn: async () => { await api.post("/financial-years", form); },
    onSuccess: () => { setCreating(false); setError(""); qc.invalidateQueries({ queryKey: ["fys"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  async function act(fy: Fy, action: "activate" | "lock") {
    if (action === "lock" && !confirm(`Lock FY ${fy.code}? No documents dated inside it can be changed after locking.`)) return;
    try { await api.post(`/financial-years/${fy.id}/${action}`); qc.invalidateQueries({ queryKey: ["fys"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  return (
    <>
      <div className="toolbar">
        <div className="spacer" />
        {canCreate && <button className="primary" onClick={() => setCreating(true)}>+ New FY</button>}
      </div>
      <ListTable>
        <thead><tr><th>Code</th><th>Start</th><th>End</th><th>Status</th><th /></tr></thead>
        <tbody>
          {fys.data?.map((fy) => (
            <tr key={fy.id}>
              <td><code>{fy.code}</code></td>
              <td>{formatDate(fy.startDate)}</td>
              <td>{formatDate(fy.endDate)}</td>
              <td>
                {fy.isActive && <span className="badge ok">active</span>}{" "}
                {fy.isLocked && <span className="badge warn">locked</span>}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {canEdit && !fy.isActive && !fy.isLocked && (
                  <>
                    <IconButton className="small" onClick={() => void act(fy, "activate")} icon="check" label="Activate">Activate</IconButton>{" "}
                    <IconButton className="small danger" onClick={() => void act(fy, "lock")} icon="lock" label="Lock">Lock</IconButton>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </ListTable>

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New financial year</h3>
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <label>Start date</label>
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            <label>End date</label>
            <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary" disabled={create.isPending} onClick={() => create.mutate()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Number series ────────────────────────────────────────────────
interface Series { id: string; docType: string; fyCode: string; prefix: string; nextNumber: number; padding: number }

function SeriesTab() {
  const qc = useQueryClient();
  const canEdit = useAuth((s) => s.hasPerm("settings:update"));
  const [edit, setEdit] = useState<Series | null>(null);
  const [error, setError] = useState("");

  const series = useQuery({
    queryKey: ["series"],
    queryFn: async () => (await api.get("/number-series")).data as Series[],
  });

  const save = useMutation({
    mutationFn: async () => {
      await api.put(`/number-series/${edit!.id}`, {
        prefix: edit!.prefix, nextNumber: edit!.nextNumber, padding: edit!.padding,
      });
    },
    onSuccess: () => { setEdit(null); setError(""); qc.invalidateQueries({ queryKey: ["series"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  const preview = (s: Series) => `${s.prefix}${String(s.nextNumber).padStart(s.padding, "0")}`;

  return (
    <>
      <ListTable>
        <thead><tr><th>Document</th><th>FY</th><th>Prefix</th><th>Next number</th><th>Preview</th><th /></tr></thead>
        <tbody>
          {series.data?.map((s) => (
            <tr key={s.id}>
              <td>{s.docType === "NON_GST_INVOICE" ? "Invoice — Without GST" : s.docType.replace(/_/g, " ")}</td>
              <td><code>{s.fyCode}</code></td>
              <td><code>{s.prefix}</code></td>
              <td>{s.nextNumber}</td>
              <td><code>{preview(s)}</code></td>
              <td>{canEdit && <IconButton className="small" onClick={() => { setEdit({ ...s }); setError(""); }} icon="edit" label="Edit">Edit</IconButton>}</td>
            </tr>
          ))}
        </tbody>
      </ListTable>

      {edit && (
        <div className="modal-overlay" onClick={() => setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit series — {edit.docType} ({edit.fyCode})</h3>
            <label>Prefix</label>
            <input value={edit.prefix} onChange={(e) => setEdit({ ...edit, prefix: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Next number</label><input type="number" value={edit.nextNumber}
                onChange={(e) => setEdit({ ...edit, nextNumber: Number(e.target.value) })} /></div>
              <div><label>Padding</label><input type="number" value={edit.padding}
                onChange={(e) => setEdit({ ...edit, padding: Number(e.target.value) })} /></div>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 8 }}>Preview: <code>{preview(edit)}</code></p>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
