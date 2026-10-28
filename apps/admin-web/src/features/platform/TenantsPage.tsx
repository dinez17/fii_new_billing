import { formatDate } from "../../lib/date";
import { DateInput } from "../../components/DateInput";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListPager } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { TenantAdmins } from "./TenantAdmins";

interface TenantRow { id: string; name: string; legalName?: string | null; email?: string | null; phone?: string | null; subdomain: string; isActive: boolean; planCode: string; licenseStatus: string; trialEndsAt?: string; licenseEndsAt?: string; maxUsers: number; maxCustomers: number; _count: { users: number; customers: number } }
const EMPTY = { name: "", subdomain: "", adminName: "", adminEmail: "", adminPassword: "", trialDays: 30, maxUsers: 10, maxCustomers: 1000 };

export function TenantsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [details, setDetails] = useState({ name: "", subdomain: "", legalName: "", email: "", phone: "" });
  const [editError, setEditError] = useState("");
  const [notice, setNotice] = useState("");
  const [adminTenant, setAdminTenant] = useState<TenantRow | null>(null);
  const [licenseTenant, setLicenseTenant] = useState<TenantRow | null>(null);
  const [licenseForm, setLicenseForm] = useState({ planCode: "", status: "ACTIVE", endsAt: "", maxUsers: 10, maxCustomers: 1000 });
  const [licenseError, setLicenseError] = useState("");
  const saveLicense = useMutation({
    mutationFn: async () => (await api.post(`/platform/tenants/${licenseTenant!.id}/license`, { ...licenseForm, endsAt: licenseForm.endsAt || undefined })).data as { licenseKey: string },
    onSuccess: (data) => { setLicenseKey(data.licenseKey); setLicenseTenant(null); void qc.invalidateQueries({ queryKey: ["platform-tenants"] }); },
    onError: (e) => setLicenseError(errMessage(e)),
  });
  const saveDetails = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Select a tenant to edit");
      return api.put(`/platform/tenants/${editing.id}`, {
        name: details.name.trim(), subdomain: details.subdomain.trim().toLowerCase(), legalName: details.legalName.trim(),
        email: details.email.trim() || undefined, phone: details.phone.trim(),
      });
    },
    onSuccess: () => { setEditing(null); setEditError(""); setNotice("Tenant details updated successfully."); void qc.invalidateQueries({ queryKey: ["platform-tenants"] }); },
    onError: (e) => setEditError(errMessage(e)),
  });
  function editTenant(t: TenantRow) {
    setEditing(t); setEditError(""); setNotice("");
    setDetails({ name: t.name, subdomain: t.subdomain, legalName: t.legalName ?? "", email: t.email ?? "", phone: t.phone ?? "" });
  }
  const tenants = useQuery({ queryKey: ["platform-tenants", search, page, pageSize], queryFn: async () => (await api.get("/platform/tenants", { params: { search: search || undefined, page, limit: pageSize } })).data as { items: TenantRow[]; total: number; limit: number } });
  const create = useMutation({ mutationFn: async () => api.post("/platform/tenants", form), onSuccess: () => { setCreating(false); setForm(EMPTY); setError(""); qc.invalidateQueries({ queryKey: ["platform-tenants"] }); }, onError: (e) => setError(errMessage(e)) });

  function changeLicense(t: TenantRow) {
    setLicenseTenant(t); setLicenseError("");
    setLicenseForm({ planCode: t.planCode, status: t.licenseStatus, endsAt: t.licenseEndsAt?.slice(0, 10) ?? "", maxUsers: t.maxUsers, maxCustomers: t.maxCustomers });
  }
  async function suspend(t: TenantRow) {
    const reason = prompt(`Suspend ${t.name}? Enter reason:`); if (!reason) return;
    try { await api.post(`/platform/tenants/${t.id}/suspend`, { reason }); qc.invalidateQueries({ queryKey: ["platform-tenants"] }); }
    catch (e) { alert(errMessage(e)); }
  }

  return <>
    <h2 className="page-title">Tenant management</h2>
    {notice && <div className="success-banner" role="status">{notice}</div>}
    {tenants.isError && <div className="error" role="alert">{errMessage(tenants.error)}</div>}
    <div className="toolbar"><RowsPerPage value={pageSize} onChange={setPageSize} /><input placeholder="Search tenant…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /><div className="spacer" /><button className="primary" onClick={() => setCreating(true)}>+ New tenant</button></div>
    {licenseKey && <div className="success-banner">New license key (shown once): <code>{licenseKey}</code> <button onClick={() => void navigator.clipboard.writeText(licenseKey)}>Copy</button></div>}
    <table><thead><tr><th>Tenant</th><th>Plan</th><th>License</th><th>Usage</th><th>Limits</th><th /></tr></thead><tbody>
      {tenants.data?.items.map((t) => <tr key={t.id}><td><strong>{t.name}</strong><div><code>{t.subdomain}</code></div><div>{t.email}</div><div>{t.phone}</div></td><td>{t.planCode}</td><td><span className={`badge ${t.isActive ? "ok" : "warn"}`}>{t.licenseStatus}</span><div>{t.licenseEndsAt ? `until ${formatDate(t.licenseEndsAt)}` : ""}</div></td><td>{t._count.users} users · {t._count.customers} customers</td><td>{t.maxUsers} users · {t.maxCustomers} customers</td><td><IconButton className="small" onClick={() => editTenant(t)} icon="edit" label="Edit details">Edit details</IconButton> <IconButton className="small" onClick={() => setAdminTenant(t)} icon="more" label="Admin users">Admin users</IconButton> <IconButton className="small" onClick={() => void changeLicense(t)} icon="more" label="License">License</IconButton> {t.isActive && <IconButton className="small" onClick={() => void suspend(t)} icon="more" label="Suspend">Suspend</IconButton>}</td></tr>)}
    </tbody></table>
    {tenants.data && <ListPager page={page} limit={tenants.data.limit} total={tenants.data.total} onChange={setPage} />}
    {adminTenant && <TenantAdmins key={adminTenant.id} tenant={adminTenant} onClose={() => setAdminTenant(null)} />}
    {licenseTenant && <div className="modal-overlay"><form className="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="tenant-license-title" onSubmit={(e) => { e.preventDefault(); saveLicense.mutate(); }}>
      <h3 id="tenant-license-title">License — {licenseTenant.name}</h3>
      <label htmlFor="license-plan">Plan code</label><input id="license-plan" required value={licenseForm.planCode} onChange={(e) => setLicenseForm({ ...licenseForm, planCode: e.target.value })} />
      <label htmlFor="license-status">Status</label><select id="license-status" value={licenseForm.status} onChange={(e) => setLicenseForm({ ...licenseForm, status: e.target.value })}>{["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"].map((s) => <option key={s}>{s}</option>)}</select>
      <label htmlFor="license-end-date">License end date (optional)</label><DateInput id="license-end-date" aria-label="License end date" value={licenseForm.endsAt} onChange={(e) => setLicenseForm({ ...licenseForm, endsAt: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><label htmlFor="license-users">Maximum users</label><input id="license-users" type="number" min={1} required value={licenseForm.maxUsers} onChange={(e) => setLicenseForm({ ...licenseForm, maxUsers: Number(e.target.value) })} /></div><div><label htmlFor="license-customers">Maximum customers</label><input id="license-customers" type="number" min={1} required value={licenseForm.maxCustomers} onChange={(e) => setLicenseForm({ ...licenseForm, maxCustomers: Number(e.target.value) })} /></div></div>
      {licenseError && <div className="error" role="alert">{licenseError}</div>}
      <div className="actions"><button type="button" disabled={saveLicense.isPending} onClick={() => setLicenseTenant(null)}>Cancel</button><button type="submit" className="primary" disabled={saveLicense.isPending}>{saveLicense.isPending ? "Saving…" : "Save license"}</button></div>
    </form></div>}
    {editing && <div className="modal-overlay"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-tenant-title" onSubmit={(e) => { e.preventDefault(); saveDetails.mutate(); }}>
      <h3 id="edit-tenant-title">Edit tenant details</h3>
      <p>Tenant: <code>{editing.subdomain}</code></p>
      <label htmlFor="tenant-subdomain">Subdomain</label><input id="tenant-subdomain" required minLength={2} maxLength={63} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" title="Use lowercase letters, numbers and internal hyphens; 2–63 characters" value={details.subdomain} onChange={(e) => setDetails({ ...details, subdomain: e.target.value.toLowerCase() })} />
      <label htmlFor="tenant-name">Company name</label><input id="tenant-name" required minLength={2} maxLength={120} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
      <label htmlFor="tenant-legal-name">Legal name</label><input id="tenant-legal-name" value={details.legalName} onChange={(e) => setDetails({ ...details, legalName: e.target.value })} />
      <label htmlFor="tenant-email">Contact email</label><input id="tenant-email" type="email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
      <label htmlFor="tenant-phone">Contact phone</label><input id="tenant-phone" type="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
      <p>Contact details do not change the tenant administrator’s login email.</p>
      {editError && <div className="error" role="alert">{editError}</div>}
      <div className="actions"><button type="button" disabled={saveDetails.isPending} onClick={() => setEditing(null)}>Cancel</button><button className="primary" type="submit" disabled={saveDetails.isPending || details.name.trim().length < 2}>{saveDetails.isPending ? "Saving…" : "Save changes"}</button></div>
    </form></div>}
    {creating && <div className="modal-overlay" onClick={() => setCreating(false)}><div className="modal" onClick={(e) => e.stopPropagation()}><h3>Create tenant</h3>
      <label>Company name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label>Subdomain</label><input value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
      <label>Tenant admin name</label><input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
      <label>Tenant admin email</label><input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
      <label>Initial password</label><input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><div><label>Trial days</label><input type="number" value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) })} /></div><div><label>Max users</label><input type="number" value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: Number(e.target.value) })} /></div><div><label>Max customers</label><input type="number" value={form.maxCustomers} onChange={(e) => setForm({ ...form, maxCustomers: Number(e.target.value) })} /></div></div>
      {error && <div className="error">{error}</div>}<div className="actions"><button onClick={() => setCreating(false)}>Cancel</button><button className="primary" disabled={create.isPending || !form.name || !form.subdomain || !form.adminEmail || form.adminPassword.length < 12} onClick={() => create.mutate()}>Create tenant</button></div>
    </div></div>}
  </>;
}
