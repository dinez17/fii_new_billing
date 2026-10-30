import { IconButton } from "../../components/IconButton";
import { ListTable, RowsPerPage, usePageSize, ListPager } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface RunRow {
  taxMode: "ALL" | "GST" | "WITHOUT_GST";
  id: string; cycleType: "PREPAID" | "POSTPAID"; periodStart: string; periodEnd: string;
  status: string; totalCount: number; successCount: number; failedCount: number;
  startedAt?: string; finishedAt?: string;
}
interface RunDetail extends RunRow {
  items: {
    id: string; success: boolean; error?: string; invoiceId?: string;
    subscriber?: { code: string; customer: { name: string } } | null;
  }[];
}

const monthName = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const taxLabel = (mode: string) => mode === "GST" ? "GST only" : mode === "WITHOUT_GST" ? "Without GST only" : "GST + without GST";

export function BillingRunsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const now = new Date();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    taxMode: "ALL" as "ALL" | "GST" | "WITHOUT_GST",
    cycleType: "PREPAID" as "PREPAID" | "POSTPAID",
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
  });

  const runs = useQuery({
    queryKey: ["billing-runs", page, pageSize],
    queryFn: async () => (await api.get("/billing-runs", { params: { page, limit: pageSize } })).data as { items: RunRow[]; total: number; limit: number },
    refetchInterval: 5000, // live progress while a run executes
  });

  const detail = useQuery({
    queryKey: ["billing-run", detailId],
    queryFn: async () => (await api.get(`/billing-runs/${detailId}`)).data as RunDetail,
    enabled: !!detailId,
  });

  const trigger = useMutation({
    mutationFn: async () => {
      await api.post("/billing-runs/trigger", {
        cycleType: form.cycleType, year: Number(form.year), month: Number(form.month),
        taxMode: form.taxMode,
      });
    },
    onSuccess: () => {
      setTriggering(false); setError("");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["billing-runs"] }), 1500);
    },
    onError: (err) => setError(errMessage(err)),
  });

  const statusBadge = (s: string) => (
    <span className={`badge ${s === "COMPLETED" ? "ok" : s.includes("ERROR") || s === "FAILED" ? "warn" : ""}`}>
      {s.replace(/_/g, " ")}
    </span>
  );

  return (
    <>
      <h2 className="page-title">Billing Runs</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <span style={{ color: "var(--muted)" }}>
          Automatic: prepaid on the 1st at 01:00 · postpaid on month-end at 23:00. Re-triggering a period only creates missing invoices.
        </span>
        <div className="spacer" />
        {hasPerm("billing_run:create") && (
          <button className="primary" onClick={() => { setTriggering(true); setError(""); }}>Run billing now</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Period</th><th>Type</th><th>GST mode</th><th>Status</th><th>Subscribers</th><th>Invoiced</th><th>Failed</th><th>Finished</th><th /></tr>
        </thead>
        <tbody>
          {runs.data?.items.map((r) => (
            <tr key={r.id}>
              <td>{monthName(r.periodStart)}</td>
              <td><span className="badge">{r.cycleType}</span></td>
              <td>{taxLabel(r.taxMode)}</td>
              <td>{statusBadge(r.status)}</td>
              <td>{r.totalCount}</td>
              <td style={{ color: "var(--ok)" }}>{r.successCount}</td>
              <td style={{ color: r.failedCount ? "var(--danger)" : undefined }}>{r.failedCount}</td>
              <td>{r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—"}</td>
              <td><IconButton className="small" onClick={() => setDetailId(r.id)} icon="view" label="Details">Details</IconButton></td>
            </tr>
          ))}
          {runs.data?.items.length === 0 && (
            <tr><td colSpan={9} style={{ color: "var(--muted)" }}>No billing runs yet — trigger one to bill active subscribers.</td></tr>
          )}
        </tbody>
      </table>
      {runs.data && <ListPager page={page} limit={runs.data.limit} total={runs.data.total} onChange={setPage} />}

      {triggering && (
        <div className="modal-overlay" onClick={() => setTriggering(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Run billing</h3>
            <p style={{ color: "var(--muted)" }}>
              Generates one invoice per ACTIVE {form.cycleType.toLowerCase()} subscriber for the selected month.
              Safe to repeat — already-billed subscribers are skipped.
              {" "}Selected group: {taxLabel(form.taxMode)}.
            </p>
            <label>GST mode</label>
            <select aria-label="Billing run GST mode" value={form.taxMode} onChange={(e) => setForm({ ...form, taxMode: e.target.value as typeof form.taxMode })}>
              <option value="ALL">All subscriptions — GST + without GST</option>
              <option value="GST">GST subscriptions only</option>
              <option value="WITHOUT_GST">Without GST subscriptions only</option>
            </select>
            <label>Cycle</label>
            <select value={form.cycleType} onChange={(e) => setForm({ ...form, cycleType: e.target.value as typeof form.cycleType })}>
              <option>PREPAID</option><option>POSTPAID</option>
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Month</label>
                <select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("en", { month: "long" })}</option>)}
                </select>
              </div>
              <div><label>Year</label>
                <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setTriggering(false)}>Cancel</button>
              <button className="primary" disabled={trigger.isPending} onClick={() => trigger.mutate()}>
                {trigger.isPending ? "Queuing…" : "Run billing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailId && detail.data && (
        <div className="modal-overlay" onClick={() => setDetailId(null)}>
          <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
            <h3>{monthName(detail.data.periodStart)} · {detail.data.cycleType} {statusBadge(detail.data.status)}</h3>
            <p>{taxLabel(detail.data.taxMode)}</p>
            <p style={{ color: "var(--muted)" }}>
              {detail.data.successCount} invoiced · {detail.data.failedCount} failed of {detail.data.totalCount}
            </p>
            <ListTable style={{ fontSize: 13 }}>
              <thead><tr><th>Subscriber</th><th>Customer</th><th>Result</th></tr></thead>
              <tbody>
                {detail.data.items.map((i) => (
                  <tr key={i.id}>
                    <td><code>{i.subscriber?.code ?? i.id.slice(0, 8)}</code></td>
                    <td>{i.subscriber?.customer.name ?? "—"}</td>
                    <td>
                      {i.success
                        ? <span className="badge ok">{i.error === "already billed" ? "already billed" : "invoiced"}</span>
                        : <span className="badge warn" title={i.error}>{(i.error ?? "failed").slice(0, 80)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            {detail.data.failedCount > 0 && hasPerm("billing_run:create") && (
              <p style={{ color: "var(--muted)", marginTop: 10 }}>
                Fix the cause (e.g. map a plan), then trigger the same period again — only the failed ones will be billed.
              </p>
            )}
            <div className="actions">
              <button className="primary" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
