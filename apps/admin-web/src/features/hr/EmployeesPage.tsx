import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable, ListPager } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface Department { id: string; name: string; _count: { employees: number } }
interface Component { name: string; amount: number }
interface EmployeeRow {
  id: string; code: string; name: string; email?: string; phone: string;
  designation?: string; joiningDate: string; basicSalary: string; status: string;
  departmentId?: string; department?: { name: string } | null;
  allowances?: Component[] | null; deductions?: Component[] | null;
}
interface FormState {
  id?: string; name: string; email: string; phone: string; departmentId: string;
  designation: string; joiningDate: string; basicSalary: string; status: string;
  allowances: Component[]; deductions: Component[];
  createLogin: boolean; roleCode: string;
}
const EMPTY: FormState = {
  name: "", email: "", phone: "", departmentId: "", designation: "",
  joiningDate: new Date().toISOString().slice(0, 10), basicSalary: "0", status: "ACTIVE",
  allowances: [], deductions: [],
  createLogin: true, roleCode: "TECHNICIAN",
};
const STAFF_ROLES = ["TECHNICIAN", "SUPPORT_STAFF", "BILLING_STAFF", "ACCOUNTANT", "MANAGER", "HR", "ADMIN"];

export function EmployeesPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");
  const [creds, setCreds] = useState<{ email: string; password: string; role: string } | null>(null);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get("/departments")).data as Department[],
  });
  const employees = useQuery({
    queryKey: ["employees", page, search, pageSize],
    queryFn: async () => (await api.get("/employees", { params: { page, limit: pageSize, search: search || undefined } })).data as
      { items: EmployeeRow[]; total: number; limit: number },
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const clean = (rows: Component[]) =>
        rows.map((r) => ({ name: r.name.trim(), amount: Number(r.amount || 0) })).filter((r) => r.name && r.amount >= 0);
      const body = {
        name: f.name, email: f.email || undefined, phone: f.phone,
        departmentId: f.departmentId || undefined, designation: f.designation || undefined,
        joiningDate: f.joiningDate, basicSalary: Number(f.basicSalary || 0), status: f.status,
        allowances: clean(f.allowances), deductions: clean(f.deductions),
      };
      if (f.id) { await api.put(`/employees/${f.id}`, body); return null; }
      const { data } = await api.post("/employees", { ...body, createLogin: f.createLogin, roleCode: f.roleCode });
      return data as { login?: { email: string; password: string; role: string } | null; loginSkipped?: string | null };
    },
    onSuccess: (data) => {
      setForm(null); setError(""); qc.invalidateQueries({ queryKey: ["employees"] });
      if (data?.login) setCreds(data.login);
      else if (data?.loginSkipped) alert(data.loginSkipped);
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function addDepartment() {
    const name = prompt("New department name:");
    if (!name) return;
    try { await api.post("/departments", { name }); qc.invalidateQueries({ queryKey: ["departments"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  return (
    <>
      <h2 className="page-title">Employees</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 240 }} placeholder="Search name / code…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <span style={{ color: "var(--muted)" }}>
          Departments: {departments.data?.map((d) => `${d.name} (${d._count.employees})`).join(" · ") || "none"}
        </span>
        <div className="spacer" />
        {hasPerm("department:create") && <button className="small" onClick={() => void addDepartment()}>+ Department</button>}
        {hasPerm("employee:create") && (
          <button className="primary" onClick={() => { setForm(EMPTY); setError(""); }}>+ New Employee</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Code</th><th>Name</th><th>Department</th><th>Designation</th><th>Phone</th><th>Joined</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {employees.data?.items.map((e) => (
            <tr key={e.id}>
              <td><code>{e.code}</code></td>
              <td>{e.name}</td>
              <td>{e.department?.name ?? "—"}</td>
              <td>{e.designation ?? "—"}</td>
              <td>{e.phone}</td>
              <td>{formatDate(e.joiningDate)}</td>
              <td><span className={`badge ${e.status === "ACTIVE" ? "ok" : "warn"}`}>{e.status.replace(/_/g, " ")}</span></td>
              <td>
                {hasPerm("employee:update") && (
                  <IconButton className="small" onClick={() => setForm({
                    id: e.id, name: e.name, email: e.email ?? "", phone: e.phone,
                    departmentId: e.departmentId ?? "", designation: e.designation ?? "",
                    joiningDate: e.joiningDate.slice(0, 10), basicSalary: String(Number(e.basicSalary)),
                    status: e.status,
                    allowances: (e.allowances ?? []).map((c) => ({ name: c.name, amount: Number(c.amount) })),
                    deductions: (e.deductions ?? []).map((c) => ({ name: c.name, amount: Number(c.amount) })),
                    createLogin: false,
                    roleCode: "TECHNICIAN",
                  })} icon="edit" label="Edit">Edit</IconButton>
                )}
              </td>
            </tr>
          ))}
          {employees.data?.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No employees yet — add technicians here so complaints can be assigned.</td></tr>
          )}
        </tbody>
      </table>
      {employees.data && <ListPager page={page} limit={employees.data.limit} total={employees.data.total} onChange={setPage} />}

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit employee" : "New employee"}</h3>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Phone *</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label>Email (for assignment notifications)</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div>
                <label>Department</label>
                <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">— none —</option>
                  {departments.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div><label>Designation</label>
                <input placeholder="Technician / Support…" value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
              <div><label>Joining date</label>
                <input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} /></div>
              <div><label>Basic salary ₹/month</label>
                <input type="number" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} /></div>
            </div>

            <ComponentEditor
              title="Allowances (added to pay)"
              rows={form.allowances}
              onChange={(allowances) => setForm({ ...form, allowances })}
            />
            <ComponentEditor
              title="Deductions (subtracted from pay)"
              rows={form.deductions}
              onChange={(deductions) => setForm({ ...form, deductions })}
            />

            {!form.id && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                  <input type="checkbox" checked={form.createLogin}
                    onChange={(e) => setForm({ ...form, createLogin: e.target.checked })} />
                  Create login (random password, needs email)
                </label>
                {form.createLogin && (
                  <select style={{ width: 170 }} value={form.roleCode}
                    onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
                    {STAFF_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                  </select>
                )}
              </div>
            )}
            {form.id && (
              <>
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option>ACTIVE</option><option>ON_NOTICE</option><option>RESIGNED</option><option>TERMINATED</option>
                </select>
              </>
            )}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !form.name || !form.phone}
                onClick={() => save.mutate(form)}>{save.isPending ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {creds && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Employee login created</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              Share these credentials now — the password is shown <strong>only once</strong>.
              If it is lost, use <em>Reset PW</em> on the Users page.
            </p>
            <ListTable style={{ fontSize: 14 }}>
              <tbody>
                <tr><td style={{ width: 110, color: "var(--muted)" }}>Email</td><td><code>{creds.email}</code></td></tr>
                <tr><td style={{ color: "var(--muted)" }}>Password</td>
                  <td><code style={{ fontSize: 16, letterSpacing: 1 }}>{creds.password}</code></td></tr>
                <tr><td style={{ color: "var(--muted)" }}>Role</td><td>{creds.role.replace(/_/g, " ")}</td></tr>
              </tbody>
            </ListTable>
            <div className="actions">
              <button className="small" onClick={() => {
                void navigator.clipboard.writeText(`Login: ${creds.email}\nPassword: ${creds.password}`);
              }}>Copy credentials</button>
              <button className="primary" onClick={() => setCreds(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ComponentEditor({
  title, rows, onChange,
}: {
  title: string; rows: Component[]; onChange: (rows: Component[]) => void;
}) {
  const update = (i: number, patch: Partial<Component>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span>
        <span style={{ color: "var(--muted)" }}>₹{total.toLocaleString("en-IN")}</span>
      </label>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 120px 32px", gap: 6, marginBottom: 4 }}>
          <input placeholder="e.g. HRA" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
          <input type="number" placeholder="0" value={r.amount} onChange={(e) => update(i, { amount: Number(e.target.value) })} />
          <button type="button" className="small" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...rows, { name: "", amount: 0 }])}>+ Add</button>
    </div>
  );
}
