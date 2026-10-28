import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";

interface Admin { id: string; name: string; email: string; status: string }
export function TenantAdmins({ tenant, onClose }: { tenant: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"create" | "edit" | "reset" | null>(null);
  const [selected, setSelected] = useState<Admin | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const key = ["platform-admins", tenant.id];
  const admins = useQuery({ queryKey: key, queryFn: async () => (await api.get(`/platform/tenants/${tenant.id}/admins`)).data as Admin[] });
  function open(next: "create" | "edit" | "reset", admin?: Admin) {
    setSelected(admin ?? null); setMode(next); setError(""); setNotice("");
    setForm({ name: admin?.name ?? "", email: admin?.email ?? "", password: "", confirm: "" });
  }
  const save = useMutation({ mutationFn: async () => {
    const base = `/platform/tenants/${tenant.id}/admins`;
    if (mode !== "edit" && form.password !== form.confirm) throw new Error("Passwords do not match");
    if (mode === "create") return api.post(base, { name: form.name.trim(), email: form.email.trim(), password: form.password });
    if (!selected) throw new Error("Select an administrator");
    if (mode === "reset") return api.post(`${base}/${selected.id}/reset-password`, { password: form.password });
    return api.put(`${base}/${selected.id}`, { name: form.name.trim(), email: form.email.trim() });
  }, onSuccess: () => {
    setNotice(mode === "reset" ? "Password reset. Use the new password at the tenant login. MFA remains enabled if configured." : mode === "create" ? "Tenant administrator created." : "Administrator login details updated.");
    setMode(null); setSelected(null); setForm({ name: "", email: "", password: "", confirm: "" });
    void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["platform-tenants"] });
  }, onError: (e) => setError(errMessage(e)) });
  return <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="tenant-admins-title" style={{ maxWidth: 780, width: "95%" }}>
    <h3 id="tenant-admins-title">Admin users - {tenant.name}</h3>
    <p>The login username is the administrator’s email address. Contact email in tenant details is separate.</p>
    {notice && <div className="success-banner" role="status">{notice}</div>}
    {admins.isLoading && <p>Loading administrators…</p>}
    {admins.isError && <div className="error" role="alert">{errMessage(admins.error)}</div>}
    <ListTable><thead><tr><th>Name</th><th>Login email / username</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {admins.data?.map((admin) => <tr key={admin.id}><td>{admin.name}</td><td>{admin.email}</td><td>{admin.status}</td><td><IconButton disabled={save.isPending} onClick={() => open("edit", admin)} icon="edit" label="Edit username">Edit username</IconButton> <IconButton disabled={save.isPending} onClick={() => open("reset", admin)} icon="key" label="Reset password">Reset password</IconButton></td></tr>)}
    </tbody></ListTable>
    {admins.data?.length === 0 && <p>No tenant administrators found.</p>}
    {!mode && <div className="actions"><button onClick={onClose}>Close</button><button className="primary" onClick={() => open("create")}>+ Create admin user</button></div>}
    {mode && <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h4>{mode === "create" ? "Create admin user" : mode === "edit" ? "Edit administrator" : `Reset password for ${selected?.email}`}</h4>
      {mode !== "reset" && <><label htmlFor="admin-account-name">Administrator name</label><input id="admin-account-name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label htmlFor="admin-account-email">Login email / username</label><input id="admin-account-email" required type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></>}
      {mode !== "edit" && <><label htmlFor="admin-account-password">{mode === "reset" ? "New password" : "Initial password"} (12–72 characters)</label><input id="admin-account-password" required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <label htmlFor="admin-account-confirm">Confirm password</label><input id="admin-account-confirm" required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></>}
      {mode !== "create" && <p>Changing the login email or password invalidates refresh sessions. Existing access tokens expire normally.</p>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="actions"><button type="button" disabled={save.isPending} onClick={() => { setMode(null); setForm({ name: "", email: "", password: "", confirm: "" }); }}>Cancel</button><button className="primary" disabled={save.isPending} type="submit">{save.isPending ? "Saving…" : mode === "reset" ? "Reset password" : mode === "create" ? "Create admin" : "Save login details"}</button></div>
    </form>}
  </div></div>;
}
