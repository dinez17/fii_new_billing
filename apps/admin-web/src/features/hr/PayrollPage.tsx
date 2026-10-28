import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface RunRow {
  id: string; year: number; month: number; fyCode: string; status: string;
  generatedAt?: string; _count: { payslips: number };
}
interface Payslip {
  id: string; status: string; paidMode?: string;
  basicSalary: string; totalAllowances: string; totalDeductions: string;
  presentDays: string; lopDays: string; leaveDeduction: string;
  overtimeHours: string; overtimePay: string; netSalary: string;
  employee: { code: string; name: string };
}
interface RunDetail extends RunRow { payslips: Payslip[] }

const MODES = ["BANK_TRANSFER", "CASH", "CHEQUE", "UPI"] as const;
const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (y: number, m: number) =>
  new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function PayrollPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const now = new Date();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ year: String(now.getFullYear()), month: String(now.getMonth() + 1), force: false });

  const runs = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: async () => (await api.get("/payroll/runs")).data as RunRow[],
  });
  const detail = useQuery({
    queryKey: ["payroll-run", detailId],
    queryFn: async () => (await api.get(`/payroll/runs/${detailId}`)).data as RunDetail,
    enabled: !!detailId,
  });

  const generate = useMutation({
    mutationFn: async () => {
      await api.post("/payroll/generate", { year: Number(form.year), month: Number(form.month), force: form.force });
    },
    onSuccess: () => { setGenerating(false); setError(""); qc.invalidateQueries({ queryKey: ["payroll-runs"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  const markPaid = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: string }) =>
      api.post(`/payroll/payslips/${id}/mark-paid`, { mode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-run", detailId] });
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (err) => alert(errMessage(err)),
  });

  async function openPdf(id: string) {
    try {
      const { data } = await api.get(`/payroll/payslips/${id}/pdf`, { responseType: "blob" });
      window.open(URL.createObjectURL(data), "_blank");
    } catch (err) { alert(errMessage(err)); }
  }

  const statusBadge = (s: string) => (
    <span className={`badge ${s === "PAID" ? "ok" : s === "GENERATED" ? "" : "warn"}`}>{s}</span>
  );

  const paidCount = detail.data?.payslips.filter((p) => p.status === "PAID").length ?? 0;
  const totalNet = detail.data?.payslips.reduce((s, p) => s + Number(p.netSalary), 0) ?? 0;

  return (
    <>
      <h2 className="page-title">Payroll</h2>
      <div className="toolbar">
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Net pay is attendance-linked: LOP days deduct per-day pay, overtime is added. Marking a payslip paid posts a Salaries expense and a day-book cash-out entry.
        </span>
        <div className="spacer" />
        {hasPerm("payroll:create") && (
          <button className="primary" onClick={() => { setGenerating(true); setError(""); }}>Generate payroll</button>
        )}
      </div>

      <ListTable>
        <thead>
          <tr><th>Period</th><th>FY</th><th>Status</th><th>Payslips</th><th>Generated</th><th /></tr>
        </thead>
        <tbody>
          {runs.data?.map((r) => (
            <tr key={r.id}>
              <td>{monthLabel(r.year, r.month)}</td>
              <td><code>{r.fyCode}</code></td>
              <td>{statusBadge(r.status)}</td>
              <td>{r._count.payslips}</td>
              <td>{r.generatedAt ? formatDate(r.generatedAt) : "—"}</td>
              <td><IconButton className="small" onClick={() => setDetailId(r.id)} icon="view" label="Details">Details</IconButton></td>
            </tr>
          ))}
          {runs.data?.length === 0 && (
            <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No payroll generated yet — generate one after marking the month's attendance.</td></tr>
          )}
        </tbody>
      </ListTable>

      {generating && (
        <div className="modal-overlay" onClick={() => setGenerating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Generate payroll</h3>
            <p style={{ color: "var(--muted)" }}>
              Creates one payslip per ACTIVE employee for the selected month using that month's attendance.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Month</label>
                <select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("en", { month: "long" })}</option>
                  ))}
                </select>
              </div>
              <div><label>Year</label>
                <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked={form.force} onChange={(e) => setForm({ ...form, force: e.target.checked })} />
              Regenerate if already generated (only if no payslip is paid yet)
            </label>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setGenerating(false)}>Cancel</button>
              <button className="primary" disabled={generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailId && detail.data && (
        <div className="modal-overlay" onClick={() => setDetailId(null)}>
          <div className="modal" style={{ width: 900 }} onClick={(e) => e.stopPropagation()}>
            <h3>{monthLabel(detail.data.year, detail.data.month)} · payroll {statusBadge(detail.data.status)}</h3>
            <p style={{ color: "var(--muted)" }}>
              {detail.data.payslips.length} payslips · {paidCount} paid · total net {inr(totalNet)}
            </p>
            <ListTable style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Employee</th><th>Basic</th><th>Allow.</th><th>Deduct.</th>
                  <th>LOP</th><th>OT pay</th><th>Net</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {detail.data.payslips.map((p) => (
                  <tr key={p.id}>
                    <td>{p.employee.name} <code style={{ fontSize: 11 }}>{p.employee.code}</code></td>
                    <td>{inr(p.basicSalary)}</td>
                    <td>{inr(p.totalAllowances)}</td>
                    <td>{inr(p.totalDeductions)}</td>
                    <td style={{ color: Number(p.lopDays) > 0 ? "var(--danger)" : undefined }}>
                      {Number(p.lopDays)}{Number(p.leaveDeduction) > 0 ? ` (${inr(p.leaveDeduction)})` : ""}
                    </td>
                    <td>{inr(p.overtimePay)}</td>
                    <td><strong>{inr(p.netSalary)}</strong></td>
                    <td>{statusBadge(p.status)}{p.paidMode ? <span style={{ color: "var(--muted)", fontSize: 11 }}> · {p.paidMode}</span> : null}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <IconButton className="small" onClick={() => void openPdf(p.id)} icon="download" label="PDF">PDF</IconButton>{" "}
                      {p.status !== "PAID" && hasPerm("payroll:update") && (
                        <MarkPaid disabled={markPaid.isPending} onPay={(mode) => markPaid.mutate({ id: p.id, mode })} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            <div className="actions">
              <button className="primary" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MarkPaid({ onPay, disabled }: { onPay: (mode: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string>(MODES[0]);
  if (!open) return <button className="small primary" onClick={() => setOpen(true)}>Mark paid</button>;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <select style={{ width: 130 }} value={mode} onChange={(e) => setMode(e.target.value)}>
        {MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
      </select>{" "}
      <button className="small primary" disabled={disabled} onClick={() => onPay(mode)}>Pay</button>{" "}
      <button className="small" onClick={() => setOpen(false)}>✕</button>
    </span>
  );
}
