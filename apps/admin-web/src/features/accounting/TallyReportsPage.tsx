import { formatDate } from "../../lib/date";
import { FinancialReportPeriod, useFinancialReportPeriod } from "../../components/FinancialReportPeriod";
import { ListTable } from "../../components/ListPagination";
import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

/* ── Tally-style two-sided (Dr | Cr) statements ─────────────────────────── */

interface TallyLine { particulars: string; amount: number; bold?: boolean; indent?: boolean }
interface TallySide { lines: TallyLine[]; total: number }
interface TallySection { left: TallySide; right: TallySide }

const inr = (v: number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cellStyle = (l: TallyLine): CSSProperties => ({
  paddingLeft: l.indent ? 24 : 8,
  fontWeight: l.bold ? 600 : 400,
  color: l.indent ? "var(--muted)" : "var(--text)",
});

/** One two-sided section rendered Tally-style: Particulars|Amount ‖ Particulars|Amount. */
function TallyTable({ section, leftHead, rightHead, totalLabel = "Total" }: {
  section: TallySection; leftHead: string; rightHead: string; totalLabel?: string;
}) {
  const rows = Math.max(section.left.lines.length, section.right.lines.length);
  const border = "1px solid var(--border, #d7dce3)";
  return (
    <ListTable style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, border }}>
      <thead>
        <tr style={{ background: "#eef1f5" }}>
          <th aria-label={`${leftHead} (Dr)`} style={{ textAlign: "left", padding: 8, border }}>{leftHead}</th>
          <th style={{ textAlign: "right", padding: 8, border, width: 140 }}>Amount</th>
          <th aria-label={`${rightHead} (Cr)`} style={{ textAlign: "left", padding: 8, border, borderLeft: "2px solid #9aa4b1" }}>{rightHead}</th>
          <th style={{ textAlign: "right", padding: 8, border, width: 140 }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, i) => {
          const l = section.left.lines[i], r = section.right.lines[i];
          return (
            <tr key={i}>
              <td style={{ ...cellStyle(l ?? { particulars: "", amount: 0 }), padding: "6px 8px", borderLeft: border, borderRight: border }}>{l?.particulars ?? ""}</td>
              <td style={{ textAlign: "right", padding: "6px 8px", borderRight: border, fontWeight: l?.bold ? 600 : 400 }}>{l ? inr(l.amount) : ""}</td>
              <td style={{ ...cellStyle(r ?? { particulars: "", amount: 0 }), padding: "6px 8px", borderLeft: "2px solid #9aa4b1", borderRight: border }}>{r?.particulars ?? ""}</td>
              <td style={{ textAlign: "right", padding: "6px 8px", borderRight: border, fontWeight: r?.bold ? 600 : 400 }}>{r ? inr(r.amount) : ""}</td>
            </tr>
          );
        })}
        <tr style={{ borderTop: "2px solid #333", borderBottom: "3px double #333", fontWeight: 700, background: "#f7f9fb" }}>
          <td style={{ padding: 8, borderLeft: border }}>{totalLabel}</td>
          <td style={{ textAlign: "right", padding: 8 }}>{inr(section.left.total)}</td>
          <td style={{ padding: 8, borderLeft: "2px solid #9aa4b1" }}>{totalLabel}</td>
          <td style={{ textAlign: "right", padding: 8, borderRight: border }}>{inr(section.right.total)}</td>
        </tr>
      </tbody>
    </ListTable>
  );
}

function ExportButtons({ reportType, filters }: { reportType: string; filters: Record<string, string> }) {
  const navigate = useNavigate();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [queued, setQueued] = useState(false);
  const queueExport = useMutation({
    mutationFn: async (format: string) => { await api.post("/reports/export", { reportType, format, filters }); },
    onSuccess: () => { setQueued(true); setTimeout(() => setQueued(false), 6000); },
    onError: (err) => alert(errMessage(err)),
  });
  if (!hasPerm("report:export")) return null;
  return (
    <>
      {queued && (
        <span style={{ color: "var(--ok)", fontSize: 13 }}>
          Export queued —{" "}
          <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/exports")}>view in Exports</a>
        </span>
      )}
      <button className="small" disabled={queueExport.isPending} onClick={() => queueExport.mutate("CSV")}>Export CSV</button>
      <button className="small" disabled={queueExport.isPending} onClick={() => queueExport.mutate("PDF")}>Export PDF</button>
    </>
  );
}

/* ── Profit & Loss (Tally format) ───────────────────────────────────────── */

export function ProfitLossTallyPage() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const period = useFinancialReportPeriod(() => {});
  const { from, to } = period;

  const report = useQuery({
    queryKey: ["pnl-tally", from, to],
    queryFn: async () => (await api.get("/reports/profit-loss-tally", { params: { from, to } })).data,
    enabled: hasPerm("report:read") && period.ready,
  });
  const d = report.data;

  return (
    <>
      <h2 className="page-title">Profit &amp; Loss A/c (Tally format)</h2>
      <div className="toolbar">
        <FinancialReportPeriod period={period} allYears={false} />
        <div className="spacer" />
        <ExportButtons reportType="PROFIT_LOSS_TALLY" filters={{ from, to }} />
      </div>

      <p className="document-help">Gross profit b/f is the Trading Account profit for the selected period, not prior-year profit.</p>
      {report.isLoading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {d && (
        <>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "4px 0 14px", color: "var(--muted)" }}>
            <span><strong style={{ color: d.grossProfit >= 0 ? "var(--ok)" : "var(--danger, #c00)" }}>₹{inr(d.grossProfit)}</strong> Gross {d.grossProfit >= 0 ? "profit" : "loss"}</span>
            <span><strong style={{ color: d.netProfit >= 0 ? "var(--ok)" : "var(--danger, #c00)" }}>₹{inr(d.netProfit)}</strong> Nett {d.netProfit >= 0 ? "profit" : "loss"}</span>
          </div>
          <h3 style={{ margin: "10px 0 6px", fontSize: 14 }}>Trading Account</h3>
          <TallyTable section={d.trading} leftHead="Particulars" rightHead="Particulars" />
          <h3 style={{ margin: "10px 0 6px", fontSize: 14 }}>Income Statement</h3>
          <TallyTable section={d.income} leftHead="Particulars" rightHead="Particulars" />
        </>
      )}
    </>
  );
}

/* ── Balance Sheet ──────────────────────────────────────────────────────── */

export function BalanceSheetPage() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const period = useFinancialReportPeriod(() => {});
  const asOn = period.to;

  const report = useQuery({
    queryKey: ["balance-sheet", asOn],
    queryFn: async () => (await api.get("/reports/balance-sheet", { params: { asOn } })).data,
    enabled: hasPerm("report:read") && period.ready,
  });
  const d = report.data;

  return (
    <>
      <h2 className="page-title">Balance Sheet</h2>
      <div className="toolbar">
        <FinancialReportPeriod period={period} balanceSheet />
        <div className="spacer" />
        <ExportButtons reportType="BALANCE_SHEET" filters={{ asOn }} />
      </div>

      {report.isLoading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {d?.profitCarryForwardStart && <p className="document-help">Profit carry-forward starts from {formatDate(d.profitCarryForwardStart)}. Earlier document and party balances are retained.</p>}
      {d && (
        <TallyTable
          section={{ left: d.liabilities, right: d.assets }}
          leftHead="Liabilities"
          rightHead="Assets"
        />
      )}
    </>
  );
}
