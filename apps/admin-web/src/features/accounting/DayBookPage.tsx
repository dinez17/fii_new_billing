import { DateInput } from "../../components/DateInput";
import { RowsPerPage, usePageSize, ListPager } from "../../components/ListPagination";
import { FinancialReportPeriod, useFinancialReportPeriod } from "../../components/FinancialReportPeriod";
import { formatDate } from "../../lib/date";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface Entry {
  id: string; type: "CASH_IN" | "CASH_OUT"; source: string; mode?: string;
  amount: string; narration?: string; createdAt: string; entryDate: string;
}
interface DayBook {
  date: string; opening: number; cashIn: number; cashOut: number; closing: number;
  closed: boolean; entries: Entry[];
  total?: number; limit?: number;
}
const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DayBookPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [mode, setMode] = useState("period");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useFinancialReportPeriod(() => setPage(1), "today");
  const [daySelection, setDate] = useState<string | null>(null);
  const date = daySelection ?? period.to;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ type: "CASH_IN", mode: "CASH", amount: "", narration: "" });

  const book = useQuery({
    queryKey: ["day-book", mode, date, period.fyCode, period.from, period.to, page, pageSize],
    enabled: mode === "day" || period.ready,
    refetchOnWindowFocus: "always",
    queryFn: async () => (await api.get("/day-book", { params: mode === "day" ? { date } : { ...period.params, page, limit: pageSize } })).data as DayBook,
  });

  const add = useMutation({
    mutationFn: async () => { await api.post("/day-book/manual-entry", { date, ...form, amount: Number(form.amount) }); },
    onSuccess: () => { setAdding(false); setError(""); setForm({ type: "CASH_IN", mode: "CASH", amount: "", narration: "" }); qc.invalidateQueries({ queryKey: ["day-book"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  const close = useMutation({
    mutationFn: async () => { await api.post("/day-book/close", { date }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day-book"] }),
    onError: (err) => alert(errMessage(err)),
  });

  async function exportDay() {
    try {
      await api.post("/reports/export", { reportType: "DAY_BOOK", format: "CSV", filters: mode === "day" ? { date } : period.params });
      alert("Export queued — see the Reports page to download.");
    } catch (err) { alert(errMessage(err)); }
  }

  const d = book.data;

  return (
    <>
      <h2 className="page-title">Day Book</h2>
      <div className="toolbar">
        <select aria-label="Day Book view" style={{ width: 180 }} value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }}><option value="period">Financial year / period</option><option value="day">Single day</option></select>
        {mode === "period" ? <FinancialReportPeriod period={period} allYears={false} /> : <DateInput aria-label="Day date" style={{ width: 170 }} value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />}
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        {d?.closed && <span className="badge ok">Closed</span>}
        <div className="spacer" />
        {hasPerm("report:export") && <button className="small" onClick={() => void exportDay()}>Export CSV</button>}
        {hasPerm("day_book:create") && !d?.closed && <button className="small" onClick={() => { setAdding(true); setError(""); }}>+ Manual entry</button>}
        {mode === "day" && hasPerm("day_book:update") && !d?.closed && (
          <button className="primary" disabled={close.isPending} onClick={() => close.mutate()}>Close day</button>
        )}
      </div>
      {book.isError && <div className="error">{errMessage(book.error)}</div>}

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="lbl">Opening</div><div className="val">{d ? inr(d.opening) : "…"}</div></div>
        <div className="kpi"><div className="lbl">Cash In</div><div className="val" style={{ color: "var(--ok)" }}>{d ? inr(d.cashIn) : "…"}</div></div>
        <div className="kpi"><div className="lbl">Cash Out</div><div className="val" style={{ color: "var(--danger)" }}>{d ? inr(d.cashOut) : "…"}</div></div>
        <div className="kpi"><div className="lbl">Closing</div><div className="val">{d ? inr(d.closing) : "…"}</div></div>
      </div>

      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Source</th><th>Mode</th><th>Narration</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
        <tbody>
          {(mode === "day" ? d?.entries.slice((page - 1) * pageSize, page * pageSize) : d?.entries)?.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.entryDate)}</td>
              <td>{new Date(e.createdAt).toLocaleTimeString()}</td>
              <td><span className={`badge ${e.type === "CASH_IN" ? "ok" : "warn"}`}>{e.type === "CASH_IN" ? "IN" : "OUT"}</span></td>
              <td>{e.source.replace(/_/g, " ")}</td>
              <td>{e.mode ?? "—"}</td>
              <td>{e.narration ?? "—"}</td>
              <td style={{ textAlign: "right", color: e.type === "CASH_IN" ? "var(--ok)" : "var(--danger)" }}>{inr(e.amount)}</td>
            </tr>
          ))}
          {d?.entries.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No movements in the selected period.</td></tr>}
        </tbody>
      </table>
      {d && <ListPager page={page} limit={pageSize} total={mode === "period" ? d.total ?? 0 : d.entries.length} onChange={setPage} />}

      {adding && (
        <div className="modal-overlay" onClick={() => setAdding(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Manual day-book entry — {date}</h3>
            <label>Entry date</label><DateInput aria-label="Manual entry date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="CASH_IN">Cash In</option><option value="CASH_OUT">Cash Out</option>
                </select></div>
              <div><label>Mode</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option>CASH</option><option>CHEQUE</option><option>BANK_TRANSFER</option><option>UPI</option><option>CARD</option>
                </select></div>
            </div>
            <label>Amount ₹</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <label>Narration</label>
            <input value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setAdding(false)}>Cancel</button>
              <button className="primary" disabled={add.isPending || !form.amount || !form.narration} onClick={() => add.mutate()}>
                {add.isPending ? "Saving…" : "Add entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
