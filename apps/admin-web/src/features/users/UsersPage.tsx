import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface Role { id: string; code: string; name: string }
interface UserRow {
  id: string; name: string; email: string; phone?: string;
  status: "ACTIVE" | "INACTIVE" | "LOCKED"; lastLoginAt?: string; roles: Role[];
}

interface FormState {
  id?: string; name: string; email: string; phone: string; password: string;
  roleIds: string[]; status: "ACTIVE" | "INACTIVE" | "LOCKED";
}

const EMPTY: FormState = { name: "", email: "", phone: "", password: "", roleIds: [], status: "ACTIVE" };

export function UsersPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");

  const users = useQuery({
    queryKey: ["users", page, search, pageSize],
    queryFn: async () => (await api.get("/users", { params: { page, limit: pageSize, search: search || undefined } })).data as
      { items: UserRow[]; total: number; page: number; limit: number },
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/roles")).data as (Role & { isSystem: boolean })[],
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        name: f.name, email: f.email, phone: f.phone || undefined,
        password: f.password || undefined, roleIds: f.roleIds, status: f.status,
      };
      if (f.id) await api.put(`/users/${f.id}`, body);
      else await api.post("/users", body);
    },
    onSuccess: () => { setForm(null); setError(""); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  async function resetPassword(u: UserRow) {
    const pw = prompt(`New password for ${u.email}: (min 8 chars, 1 uppercase, 1 digit)`);
    if (!pw) return;
    try {
      await api.post(`/users/${u.id}/reset-password`, { newPassword: pw });
      alert("Password reset. All their sessions were revoked.");
    } catch (err) { alert(errMessage(err)); }
  }

  return (
    <>
      <h2 className="page-title">Users</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 260 }} placeholder="Search name or email…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("user:create") && (
          <button className="primary" onClick={() => { setForm(EMPTY); setError(""); }}>+ New User</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>Last login</th><th /></tr>
        </thead>
        <tbody>
          {users.data?.items.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.roles.map((r) => <span key={r.id} className="badge" style={{ marginRight: 4 }}>{r.name}</span>)}</td>
              <td><span className={`badge ${u.status === "ACTIVE" ? "ok" : "warn"}`}>{u.status}</span></td>
              <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("user:update") && (
                  <>
                    <IconButton className="small" onClick={() => setForm({
                      id: u.id, name: u.name, email: u.email, phone: u.phone ?? "",
                      password: "", roleIds: u.roles.map((r) => r.id), status: u.status,
                    })} icon="edit" label="Edit">Edit</IconButton>{" "}
                    <IconButton className="small" onClick={() => resetPassword(u)} icon="key" label="Reset PW">Reset PW</IconButton>
                  </>
                )}
              </td>
            </tr>
          ))}
          {users.data && users.data.items.length === 0 && (
            <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No users found.</td></tr>
          )}
        </tbody>
      </table>

      {users.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(users.data.total / users.data.limit))}</span>
          <button className="small" disabled={page * users.data.limit >= users.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit user" : "New user"}</h3>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>Email</label>
            <input value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <label>{form.id ? "New password (leave blank to keep)" : "Password"}</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}>
              <option>ACTIVE</option><option>INACTIVE</option><option>LOCKED</option>
            </select>
            <label>Roles</label>
            {roles.data?.map((r) => (
              <div key={r.id}>
                <input type="checkbox" id={`role-${r.id}`} checked={form.roleIds.includes(r.id)}
                  onChange={(e) => setForm({
                    ...form,
                    roleIds: e.target.checked ? [...form.roleIds, r.id] : form.roleIds.filter((x) => x !== r.id),
                  })} />{" "}
                <label htmlFor={`role-${r.id}`} style={{ display: "inline" }}>{r.name}</label>
              </div>
            ))}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !form.name || !form.email || form.roleIds.length === 0}
                onClick={() => save.mutate(form)}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
