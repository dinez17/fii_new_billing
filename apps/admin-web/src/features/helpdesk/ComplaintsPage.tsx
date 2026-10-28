import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { EntitySelect } from "../../components/EntitySelect";

interface EmployeeLite { id: string; name: string; code: string }
interface ComplaintRow {
  id: string; complaintNumber: string; type: string; subject: string;
  priority: string; status: string; dueAt?: string; createdAt: string; source: string;
  customer: { id: string; name: string; phone: string };
  assignedTo?: { id: string; name: string } | null;
}
interface ComplaintDetail extends ComplaintRow {
  description?: string; resolutionNotes?: string; slaHours: number;
  history: { id: string; fromStatus?: string; toStatus: string; notes?: string; createdAt: string }[];
  attachments: { id: string; fileName: string }[];
  tasks: { id: string; title: string; status: string; assignedTo?: { name: string } | null }[];
}

const COMPLAINT_TYPES = ["NO_SIGNAL", "SLOW_SPEED", "BILLING_ISSUE", "RELOCATION", "EQUIPMENT", "OTHER"];
const overdue = (c: ComplaintRow) =>
  c.dueAt && !["RESOLVED", "CLOSED"].includes(c.status) && new Date(c.dueAt) < new Date();

export function ComplaintsPage() {
  const [tab, setTab] = useState<"list" | "reports">("list");
  return (
    <>
      <h2 className="page-title">Complaints</h2>
      <div className="toolbar">
        <button className={tab === "list" ? "primary" : ""} onClick={() => setTab("list")}>Complaints</button>
        <button className={tab === "reports" ? "primary" : ""} onClick={() => setTab("reports")}>Reports</button>
      </div>
      {tab === "list" ? <ListTab /> : <ReportsTab />}
    </>
  );
}

function ListTab() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    customerId: "", type: "NO_SIGNAL", subject: "", description: "", priority: "MEDIUM", slaHours: "24",
  });

  const list = useQuery({
    queryKey: ["complaints", page, status, search, pageSize],
    queryFn: async () => (await api.get("/complaints", {
      params: { page, limit: pageSize, status: status || undefined, search: search || undefined },
    })).data as { items: ComplaintRow[]; total: number; limit: number },
    refetchInterval: 15_000,
  });
  const employees = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => (await api.get("/employees", { params: { active: true, limit: 200 } })).data.items as EmployeeLite[],
  });
  const detail = useQuery({
    queryKey: ["complaint", detailId],
    queryFn: async () => (await api.get(`/complaints/${detailId}`)).data as ComplaintDetail,
    enabled: !!detailId,
  });

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/complaints", {
        customerId: form.customerId, type: form.type, subject: form.subject,
        description: form.description || undefined, priority: form.priority,
        slaHours: Number(form.slaHours),
      });
    },
    onSuccess: () => {
      setCreating(false); setError("");
      setForm({ ...form, customerId: "", subject: "", description: "" });
      qc.invalidateQueries({ queryKey: ["complaints"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function assign(id: string, employeeId: string) {
    if (!employeeId) return;
    try {
      await api.post(`/complaints/${id}/assign`, { employeeId });
      qc.invalidateQueries({ queryKey: ["complaints"] });
      qc.invalidateQueries({ queryKey: ["complaint", id] });
    } catch (err) { alert(errMessage(err)); }
  }

  async function changeStatus(id: string, newStatus: string) {
    let notes: string | undefined;
    if (newStatus === "RESOLVED") {
      notes = prompt("Resolution notes (required):") ?? undefined;
      if (!notes) return;
    }
    try {
      await api.post(`/complaints/${id}/status`, { status: newStatus, notes });
      qc.invalidateQueries({ queryKey: ["complaints"] });
      qc.invalidateQueries({ queryKey: ["complaint", id] });
    } catch (err) { alert(errMessage(err)); }
  }

  const badge = (s: string) => (
    <span className={`badge ${["RESOLVED", "CLOSED"].includes(s) ? "ok" : s === "ON_HOLD" ? "warn" : ""}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
  const prioBadge = (p: string) => (
    <span className={`badge ${p === "URGENT" || p === "HIGH" ? "warn" : ""}`}>{p}</span>
  );

  return (
    <>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 240 }} placeholder="Search number / subject / customer…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select style={{ width: 150 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All status</option>
          {["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="spacer" />
        {hasPerm("complaint:create") && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ New Complaint</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Number</th><th>Customer</th><th>Subject</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Due</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((c) => (
            <tr key={c.id}>
              <td><code>{c.complaintNumber}</code>{c.source === "PORTAL" && <span className="badge" style={{ marginLeft: 4 }}>portal</span>}</td>
              <td>{c.customer.name}</td>
              <td>{c.subject}</td>
              <td>{prioBadge(c.priority)}</td>
              <td>{badge(c.status)}</td>
              <td>
                {["RESOLVED", "CLOSED"].includes(c.status)
                  ? (c.assignedTo?.name ?? "—")
                  : hasPerm("complaint:update") ? (
                    <select style={{ width: 140 }} value={c.assignedTo?.id ?? ""}
                      onChange={(e) => void assign(c.id, e.target.value)}>
                      <option value="">— assign —</option>
                      {employees.data?.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                  ) : (c.assignedTo?.name ?? "—")}
              </td>
              <td style={{ color: overdue(c) ? "var(--danger)" : undefined }}>
                {c.dueAt ? new Date(c.dueAt).toLocaleString() : "—"}{overdue(c) && " ⚠"}
              </td>
              <td><IconButton className="small" onClick={() => setDetailId(c.id)} icon="view" label="View">View</IconButton></td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No complaints found.</td></tr>
          )}
        </tbody>
      </table>

      {list.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(list.data.total / list.data.limit))}</span>
          <button className="small" disabled={page * list.data.limit >= list.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New complaint</h3>
            <label>Customer *</label>
            <EntitySelect kind="customers" value={form.customerId} onChange={(id) => setForm({ ...form, customerId: id })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {COMPLAINT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option>
                </select>
              </div>
              <div><label>SLA hours</label>
                <input type="number" value={form.slaHours} onChange={(e) => setForm({ ...form, slaHours: e.target.value })} /></div>
            </div>
            <label>Subject *</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <label>Description</label>
            <textarea rows={3} style={{ width: "100%", font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 8 }}
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary" disabled={create.isPending || !form.customerId || form.subject.length < 3}
                onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </div>
      )}

      {detailId && detail.data && (
        <div className="modal-overlay" onClick={() => setDetailId(null)}>
          <div className="modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3>{detail.data.complaintNumber} {badge(detail.data.status)} {prioBadge(detail.data.priority)}</h3>
            <p style={{ color: "var(--muted)" }}>
              {detail.data.customer.name} · {detail.data.type.replace(/_/g, " ")} · SLA {detail.data.slaHours}h
              {detail.data.assignedTo && <> · assigned to {detail.data.assignedTo.name}</>}
            </p>
            <p><strong>{detail.data.subject}</strong></p>
            {detail.data.description && <p style={{ marginTop: 4 }}>{detail.data.description}</p>}
            {detail.data.resolutionNotes && (
              <p style={{ marginTop: 8, color: "var(--ok)" }}>Resolution: {detail.data.resolutionNotes}</p>
            )}

            <label style={{ marginTop: 12 }}>Timeline</label>
            <ListTable style={{ fontSize: 12 }}>
              <tbody>
                {detail.data.history.map((hst) => (
                  <tr key={hst.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(hst.createdAt).toLocaleString()}</td>
                    <td>{hst.fromStatus ? `${hst.fromStatus.replace(/_/g, " ")} → ` : ""}{hst.toStatus.replace(/_/g, " ")}</td>
                    <td style={{ color: "var(--muted)" }}>{hst.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </ListTable>

            {detail.data.tasks.length > 0 && (
              <>
                <label style={{ marginTop: 12 }}>Linked tasks</label>
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {detail.data.tasks.map((t) => (
                    <li key={t.id}>{t.title} — {t.status.replace(/_/g, " ")}{t.assignedTo && ` (${t.assignedTo.name})`}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="actions">
              {hasPerm("complaint:update") && !["RESOLVED", "CLOSED"].includes(detail.data.status) && (
                <>
                  <button onClick={() => void changeStatus(detail.data.id, "IN_PROGRESS")}>In progress</button>
                  <button onClick={() => void changeStatus(detail.data.id, "ON_HOLD")}>On hold</button>
                  <button className="primary" onClick={() => void changeStatus(detail.data.id, "RESOLVED")}>Resolve</button>
                </>
              )}
              {hasPerm("complaint:update") && detail.data.status === "RESOLVED" && (
                <button className="primary" onClick={() => void changeStatus(detail.data.id, "CLOSED")}>Close</button>
              )}
              <button onClick={() => setDetailId(null)}>Close window</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReportsTab() {
  const daily = useQuery({
    queryKey: ["complaints-daily"],
    queryFn: async () => (await api.get("/complaints/reports/daily")).data as { day: string; created: number; resolved: number }[],
  });
  const pending = useQuery({
    queryKey: ["complaints-pending"],
    queryFn: async () => (await api.get("/complaints/reports/employee-pending")).data as
      { employee: { name: string; code: string } | null; pending: number }[],
  });
  const sla = useQuery({
    queryKey: ["complaints-sla"],
    queryFn: async () => (await api.get("/complaints/reports/sla")).data as {
      summary: { resolvedCount: number; withinSla: number; slaPercent: number; avgResolutionHours: number; openOverdue: number };
      rows: { complaintNumber: string; subject: string; slaHours: number; resolutionHours: number; withinSla: boolean }[];
    },
  });

  return (
    <>
      {sla.data && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="lbl">SLA compliance (30d)</div><div className="val">{sla.data.summary.slaPercent}%</div></div>
          <div className="kpi"><div className="lbl">Avg resolution</div><div className="val">{sla.data.summary.avgResolutionHours}h</div></div>
          <div className="kpi"><div className="lbl">Resolved (30d)</div><div className="val">{sla.data.summary.resolvedCount}</div></div>
          <div className="kpi"><div className="lbl">Open & overdue</div><div className="val" style={{ color: sla.data.summary.openOverdue ? "var(--danger)" : undefined }}>{sla.data.summary.openOverdue}</div></div>
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>EMPLOYEE-WISE PENDING</h2>
        <ListTable style={{ fontSize: 13 }}>
          <thead><tr><th>Employee</th><th>Pending complaints</th></tr></thead>
          <tbody>
            {pending.data?.map((r, i) => (
              <tr key={i}>
                <td>{r.employee ? `${r.employee.name} (${r.employee.code})` : "Unassigned"}</td>
                <td>{r.pending}</td>
              </tr>
            ))}
            {pending.data?.length === 0 && <tr><td colSpan={2} style={{ color: "var(--muted)" }}>Nothing pending.</td></tr>}
          </tbody>
        </ListTable>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>DAILY (LAST 30 DAYS)</h2>
        <ListTable style={{ fontSize: 13 }}>
          <thead><tr><th>Date</th><th>Created</th><th>Resolved</th></tr></thead>
          <tbody>
            {daily.data?.map((d) => (
              <tr key={d.day}><td>{d.day}</td><td>{d.created}</td><td>{d.resolved}</td></tr>
            ))}
          </tbody>
        </ListTable>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>RESOLUTION TIME vs SLA</h2>
        <ListTable style={{ fontSize: 13 }}>
          <thead><tr><th>Complaint</th><th>Subject</th><th>SLA</th><th>Took</th><th>Within SLA</th></tr></thead>
          <tbody>
            {sla.data?.rows.map((r) => (
              <tr key={r.complaintNumber}>
                <td><code>{r.complaintNumber}</code></td>
                <td>{r.subject}</td>
                <td>{r.slaHours}h</td>
                <td>{r.resolutionHours}h</td>
                <td><span className={`badge ${r.withinSla ? "ok" : "warn"}`}>{r.withinSla ? "yes" : "NO"}</span></td>
              </tr>
            ))}
          </tbody>
        </ListTable>
      </div>
    </>
  );
}
