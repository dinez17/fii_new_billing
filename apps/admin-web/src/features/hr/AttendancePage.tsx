import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface EmployeeLite { id: string; code: string; name: string; department?: { name: string } | null }
interface DayRow {
  employee: EmployeeLite;
  attendance: { status: string; checkIn?: string; checkOut?: string; overtimeHours: string } | null;
}
interface LeaveRow {
  id: string; leaveType: string; fromDate: string; toDate: string; days: string;
  reason?: string; status: string;
  employee: { id: string; code: string; name: string };
}
interface Entry { status: string; checkIn: string; checkOut: string; overtimeHours: string }

const STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"];
const hm = (iso?: string) => (iso ? new Date(iso).toISOString().slice(11, 16) : "");

export function AttendancePage() {
  const [tab, setTab] = useState<"daily" | "monthly" | "leaves">("daily");
  return (
    <>
      <h2 className="page-title">Attendance & Leave</h2>
      <div className="toolbar">
        <button className={tab === "daily" ? "primary" : ""} onClick={() => setTab("daily")}>Daily marking</button>
        <button className={tab === "monthly" ? "primary" : ""} onClick={() => setTab("monthly")}>Monthly report</button>
        <button className={tab === "leaves" ? "primary" : ""} onClick={() => setTab("leaves")}>Leave requests</button>
      </div>
      {tab === "daily" && <DailyTab />}
      {tab === "monthly" && <MonthlyTab />}
      {tab === "leaves" && <LeavesTab />}
    </>
  );
}

function DailyTab() {
  const qc = useQueryClient();
  const canMark = useAuth((s) => s.hasPerm("attendance:create"));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState("");

  const sheet = useQuery({
    queryKey: ["attendance", date],
    queryFn: async () => (await api.get("/attendance", { params: { date } })).data as DayRow[],
  });

  useEffect(() => {
    if (!sheet.data) return;
    const next: Record<string, Entry> = {};
    for (const row of sheet.data) {
      next[row.employee.id] = row.attendance
        ? {
            status: row.attendance.status,
            checkIn: hm(row.attendance.checkIn),
            checkOut: hm(row.attendance.checkOut),
            overtimeHours: String(Number(row.attendance.overtimeHours ?? 0)),
          }
        : { status: "PRESENT", checkIn: "", checkOut: "", overtimeHours: "0" };
    }
    setEntries(next);
  }, [sheet.data]);

  const save = useMutation({
    mutationFn: async () => {
      await api.post("/attendance/bulk", {
        date,
        entries: Object.entries(entries).map(([employeeId, e]) => ({
          employeeId,
          status: e.status,
          checkIn: e.checkIn || undefined,
          checkOut: e.checkOut || undefined,
          overtimeHours: Number(e.overtimeHours || 0),
        })),
      });
    },
    onSuccess: () => { setError(""); qc.invalidateQueries({ queryKey: ["attendance", date] }); },
    onError: (err) => setError(errMessage(err)),
  });

  const set = (id: string, patch: Partial<Entry>) =>
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  return (
    <>
      <div className="toolbar">
        <input type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="small" onClick={() => {
          setEntries(Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { ...e, status: "PRESENT" }])));
        }}>All present</button>
        <div className="spacer" />
        {canMark && (
          <button className="primary" disabled={save.isPending || !sheet.data?.length} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save day"}
          </button>
        )}
      </div>
      {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
      <table>
        <thead><tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th><th>OT hrs</th></tr></thead>
        <tbody>
          {sheet.data?.map((row) => {
            const e = entries[row.employee.id];
            if (!e) return null;
            return (
              <tr key={row.employee.id}>
                <td>{row.employee.name} <code style={{ fontSize: 11 }}>{row.employee.code}</code>
                  {row.employee.department && <span style={{ color: "var(--muted)", fontSize: 12 }}> · {row.employee.department.name}</span>}
                </td>
                <td>
                  <select style={{ width: 130 }} value={e.status} disabled={!canMark}
                    onChange={(ev) => set(row.employee.id, { status: ev.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </td>
                <td><input type="time" style={{ width: 110 }} value={e.checkIn} disabled={!canMark}
                  onChange={(ev) => set(row.employee.id, { checkIn: ev.target.value })} /></td>
                <td><input type="time" style={{ width: 110 }} value={e.checkOut} disabled={!canMark}
                  onChange={(ev) => set(row.employee.id, { checkOut: ev.target.value })} /></td>
                <td><input type="number" style={{ width: 70 }} value={e.overtimeHours} disabled={!canMark}
                  onChange={(ev) => set(row.employee.id, { overtimeHours: ev.target.value })} /></td>
              </tr>
            );
          })}
          {sheet.data?.length === 0 && (
            <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No active employees — add them under Employees.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function MonthlyTab() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const report = useQuery({
    queryKey: ["attendance-monthly", year, month],
    queryFn: async () => (await api.get("/attendance/monthly", { params: { year, month } })).data as
      ({ employee: { code: string; name: string } } & Record<string, number>)[],
  });

  return (
    <>
      <div className="toolbar">
        <select style={{ width: 140 }} value={month} onChange={(e) => setMonth(e.target.value)}>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("en", { month: "long" })}</option>
          ))}
        </select>
        <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      <ListTable>
        <thead>
          <tr><th>Employee</th><th>Present</th><th>Absent</th><th>Half day</th><th>Leave</th><th>Holiday</th><th>Week off</th><th>OT hrs</th></tr>
        </thead>
        <tbody>
          {report.data?.map((r, i) => (
            <tr key={i}>
              <td>{r.employee.name} <code style={{ fontSize: 11 }}>{r.employee.code}</code></td>
              <td>{r.PRESENT ?? 0}</td>
              <td style={{ color: (r.ABSENT ?? 0) > 0 ? "var(--danger)" : undefined }}>{r.ABSENT ?? 0}</td>
              <td>{r.HALF_DAY ?? 0}</td>
              <td>{r.LEAVE ?? 0}</td>
              <td>{r.HOLIDAY ?? 0}</td>
              <td>{r.WEEK_OFF ?? 0}</td>
              <td>{r.overtimeHours ?? 0}</td>
            </tr>
          ))}
          {report.data?.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No attendance marked this month.</td></tr>
          )}
        </tbody>
      </ListTable>
    </>
  );
}

function LeavesTab() {
  const qc = useQueryClient();
  const canApprove = useAuth((s) => s.hasPerm("leave:approve"));
  const canCreate = useAuth((s) => s.hasPerm("leave:create"));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    employeeId: "", leaveType: "CASUAL",
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  const employees = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => (await api.get("/employees", { params: { active: true, limit: 200 } })).data.items as EmployeeLite[],
  });
  const leaves = useQuery({
    queryKey: ["leaves"],
    queryFn: async () => (await api.get("/leaves")).data as LeaveRow[],
  });

  const create = useMutation({
    mutationFn: async () => { await api.post("/leaves", form); },
    onSuccess: () => { setCreating(false); setError(""); qc.invalidateQueries({ queryKey: ["leaves"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  async function act(id: string, action: "approve" | "reject") {
    try {
      await api.post(`/leaves/${id}/${action}`);
      qc.invalidateQueries({ queryKey: ["leaves"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (err) { alert(errMessage(err)); }
  }

  return (
    <>
      <div className="toolbar">
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Approving a leave marks those days automatically (LOP type marks ABSENT — unpaid).
        </span>
        <div className="spacer" />
        {canCreate && <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ Leave request</button>}
      </div>
      <ListTable>
        <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>
          {leaves.data?.map((l) => (
            <tr key={l.id}>
              <td>{l.employee.name}</td>
              <td><span className="badge">{l.leaveType}</span></td>
              <td>{formatDate(l.fromDate)}</td>
              <td>{formatDate(l.toDate)}</td>
              <td>{Number(l.days)}</td>
              <td>{l.reason ?? "—"}</td>
              <td><span className={`badge ${l.status === "APPROVED" ? "ok" : l.status === "REJECTED" ? "warn" : ""}`}>{l.status}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {canApprove && l.status === "PENDING" && (
                  <>
                    <IconButton className="small primary" onClick={() => void act(l.id, "approve")} icon="check" label="Approve">Approve</IconButton>{" "}
                    <IconButton className="small danger" onClick={() => void act(l.id, "reject")} icon="close" label="Reject">Reject</IconButton>
                  </>
                )}
              </td>
            </tr>
          ))}
          {leaves.data?.length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No leave requests.</td></tr>}
        </tbody>
      </ListTable>

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Leave request</h3>
            <label>Employee *</label>
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">— select —</option>
              {employees.data?.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
            <label>Type</label>
            <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
              <option value="CASUAL">CASUAL (paid)</option>
              <option value="SICK">SICK (paid)</option>
              <option value="EARNED">EARNED (paid)</option>
              <option value="LOP">LOP (unpaid)</option>
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>From</label>
                <input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></div>
              <div><label>To</label>
                <input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></div>
            </div>
            <label>Reason</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary" disabled={create.isPending || !form.employeeId} onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
