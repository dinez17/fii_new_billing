import { DateInput } from "../../components/DateInput";
import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstOfMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

export function GstPage() {
  const [tab, setTab] = useState<"gstr1" | "gstr3b" | "files">("gstr1");
  return (
    <>
      <h2 className="page-title">GST Reports</h2>
      <div className="toolbar">
        <button className={tab === "gstr1" ? "primary" : ""} onClick={() => setTab("gstr1")}>GSTR-1 (outward)</button>
        <button className={tab === "gstr3b" ? "primary" : ""} onClick={() => setTab("gstr3b")}>GSTR-3B (summary)</button>
        <button className={tab === "files" ? "primary" : ""} onClick={() => setTab("files")}>GSTR-1 Files (Offline Tool)</button>
      </div>
      {tab === "gstr1" ? <Gstr1 /> : tab === "gstr3b" ? <Gstr3b /> : <Gstr1Files />}
    </>
  );
}

/** Portal/offline-tool-format downloads: section CSVs + the Excel workbook. */
function Gstr1Files() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [busy, setBusy] = useState<string | null>(null);
  const counts = useQuery({ queryKey: ["gstr1-file-counts", year, month], queryFn: async () => (await api.get("/gst/gstr1-file-counts", { params: { year, month } })).data as Record<string, { rows: number; documents: number | null }> });

  const SECTIONS: { key: string; file: string; label: string; empty?: boolean }[] = [
    { key: "b2b", file: "b2b,sez,de.csv", label: "B2B, SEZ, DE" },
    { key: "b2ba", file: "b2ba.csv", label: "B2BA (amendments)", empty: true },
    { key: "b2cl", file: "b2cl.csv", label: "B2CL (large B2C)" },
    { key: "b2cla", file: "b2cla.csv", label: "B2CLA (amendments)", empty: true },
    { key: "b2cs", file: "b2cs.csv", label: "B2CS (small B2C)" },
    { key: "cdnr", file: "cdnr.csv", label: "CDNR (notes — registered)" },
    { key: "cdnur", file: "cdnur.csv", label: "CDNUR (notes — unregistered)" },
    { key: "hsn-b2b", file: "hsn(b2b).csv", label: "HSN (B2B)" },
    { key: "hsn-b2c", file: "hsn(b2c).csv", label: "HSN (B2C)" },
    { key: "hsn", file: "hsn.csv", label: "HSN (combined)" },
    { key: "docs", file: "docs.csv", label: "Documents issued" },
  ];

  async function download(url: string, filename: string, id: string) {
    setBusy(id);
    try {
      const res = await api.get(url, { params: { year, month }, responseType: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(res.data);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="toolbar">
        <select style={{ width: 140 }} value={month} onChange={(e) => setMonth(e.target.value)}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("en", { month: "long" })}</option>)}
        </select>
        <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value)} />
        <div className="spacer" />
        <button
          className="primary"
          disabled={busy !== null}
          onClick={() => download("/gst/gstr1-workbook", `GSTR1_${year}-${String(month).padStart(2, "0")}.xlsx`, "wb")}
        >
          {busy === "wb" ? "Preparing…" : "Download Excel Workbook"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", margin: "4px 0 12px" }}>
        CSV files in the GST offline-tool import format for the selected month. Amendment files
        (B2BA / B2CLA) download with headers only — fill amendments manually if needed.
      </p>
      {counts.isError && <div className="error">{errMessage(counts.error)}</div>}
      <small>Export rows include separate GST-rate rows. Documents counts distinct invoices/notes; HSN and B2CS are grouped summaries.</small>
      <ListTable>
        <thead><tr><th>Section</th><th>File</th><th>Export rows</th><th>Documents</th><th style={{ width: 130 }}></th></tr></thead>
        <tbody>
          {SECTIONS.map((s) => (
            <tr key={s.key}>
              <td>{s.label}{s.empty ? <span style={{ color: "var(--muted)" }}> — template</span> : ""}</td>
              <td><code>{s.file}</code></td>
              <td>{counts.data?.[s.key]?.rows ?? (counts.isFetching ? "…" : "—")}</td>
              <td>{counts.data?.[s.key]?.documents ?? "—"}</td>
              <td>
                <IconButton className="small" disabled={busy !== null} onClick={() => download(`/gst/gstr1-files/${s.key}`, s.file, s.key)} icon="download" label={busy === s.key ? "…" : "Download CSV"}>
                  {busy === s.key ? "…" : "Download CSV"}
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </ListTable>
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Gstr1() {
  const qc = useQueryClient();
  const canExport = useAuth((s) => s.hasPerm("report:export"));
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const q = useQuery({
    queryKey: ["gstr1", from, to],
    queryFn: async () => (await api.get("/gst/gstr1", { params: { from, to } })).data as any,
  });
  const exp = useMutation({
    mutationFn: async () => { await api.post("/reports/export", { reportType: "GSTR1", format: "CSV", filters: { from, to } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-jobs"] }); alert("Export queued — download it on the Reports page."); },
    onError: (err) => alert(errMessage(err)),
  });
  const d = q.data;
  return (
    <>
      <div className="toolbar">
        <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--muted)" }}>to</span>
        <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="spacer" />
        {canExport && <button className="small" disabled={exp.isPending} onClick={() => exp.mutate()}>Export CSV</button>}
      </div>
      {d && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, color: "var(--muted)" }}>
            <span><strong style={{ color: "var(--text)" }}>{inr(d.summary.taxableValue)}</strong> taxable</span>
            <span><strong style={{ color: "var(--text)" }}>{inr(d.summary.cgst)}</strong> CGST</span>
            <span><strong style={{ color: "var(--text)" }}>{inr(d.summary.sgst)}</strong> SGST</span>
            <span><strong style={{ color: "var(--text)" }}>{inr(d.summary.igst)}</strong> IGST</span>
          </div>

          <h3>B2B (registered)</h3>
          <ListTable>
            <thead><tr><th>GSTIN</th><th>Customer</th><th style={{ textAlign: "right" }}>Invoices</th><th style={{ textAlign: "right" }}>Taxable</th><th style={{ textAlign: "right" }}>CGST</th><th style={{ textAlign: "right" }}>SGST</th><th style={{ textAlign: "right" }}>IGST</th></tr></thead>
            <tbody>
              {d.b2b.map((r: any) => <tr key={r.gstin}><td><code>{r.gstin}</code></td><td>{r.name}</td><td style={{ textAlign: "right" }}>{r.invoices}</td><td style={{ textAlign: "right" }}>{inr(r.taxableValue)}</td><td style={{ textAlign: "right" }}>{inr(r.cgst)}</td><td style={{ textAlign: "right" }}>{inr(r.sgst)}</td><td style={{ textAlign: "right" }}>{inr(r.igst)}</td></tr>)}
              {d.b2b.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No B2B supplies.</td></tr>}
            </tbody>
          </ListTable>

          <h3 style={{ marginTop: 16 }}>B2C (by place of supply)</h3>
          <ListTable>
            <thead><tr><th>POS</th><th style={{ textAlign: "right" }}>Taxable</th><th style={{ textAlign: "right" }}>CGST</th><th style={{ textAlign: "right" }}>SGST</th><th style={{ textAlign: "right" }}>IGST</th></tr></thead>
            <tbody>
              {d.b2cs.map((r: any) => <tr key={r.placeOfSupply}><td>{r.placeOfSupply}</td><td style={{ textAlign: "right" }}>{inr(r.taxableValue)}</td><td style={{ textAlign: "right" }}>{inr(r.cgst)}</td><td style={{ textAlign: "right" }}>{inr(r.sgst)}</td><td style={{ textAlign: "right" }}>{inr(r.igst)}</td></tr>)}
              {d.b2cs.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No B2C supplies.</td></tr>}
            </tbody>
          </ListTable>

          <h3 style={{ marginTop: 16 }}>HSN / SAC summary</h3>
          <ListTable>
            <thead><tr><th>HSN/SAC</th><th style={{ textAlign: "right" }}>Rate %</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Taxable</th><th style={{ textAlign: "right" }}>CGST</th><th style={{ textAlign: "right" }}>SGST</th><th style={{ textAlign: "right" }}>IGST</th></tr></thead>
            <tbody>
              {d.hsn.map((r: any, i: number) => <tr key={i}><td>{r.hsnSac}</td><td style={{ textAlign: "right" }}>{r.gstRate}</td><td style={{ textAlign: "right" }}>{r.quantity}</td><td style={{ textAlign: "right" }}>{inr(r.taxableValue)}</td><td style={{ textAlign: "right" }}>{inr(r.cgst)}</td><td style={{ textAlign: "right" }}>{inr(r.sgst)}</td><td style={{ textAlign: "right" }}>{inr(r.igst)}</td></tr>)}
              {d.hsn.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No line items.</td></tr>}
            </tbody>
          </ListTable>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            Docs: {d.docs.invoices.count} invoices ({d.docs.invoices.from ?? "—"} → {d.docs.invoices.to ?? "—"}), {d.docs.creditNotes} credit / {d.docs.debitNotes} debit notes.
          </p>
        </>
      )}
    </>
  );
}

function Gstr3b() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const q = useQuery({
    queryKey: ["gstr3b", year, month],
    queryFn: async () => (await api.get("/gst/gstr3b", { params: { year, month } })).data as any,
  });
  const d = q.data;
  const row = (label: string, o: any) => (
    <tr><td>{label}</td><td style={{ textAlign: "right" }}>{inr(o.cgst)}</td><td style={{ textAlign: "right" }}>{inr(o.sgst)}</td><td style={{ textAlign: "right" }}>{inr(o.igst)}</td></tr>
  );
  return (
    <>
      <div className="toolbar">
        <select style={{ width: 140 }} value={month} onChange={(e) => setMonth(e.target.value)}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("en", { month: "long" })}</option>)}
        </select>
        <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      {d && (
        <ListTable>
          <thead><tr><th>Head</th><th style={{ textAlign: "right" }}>CGST</th><th style={{ textAlign: "right" }}>SGST</th><th style={{ textAlign: "right" }}>IGST</th></tr></thead>
          <tbody>
            {row("Outward tax liability", d.outward)}
            {row("Input tax credit", d.itc)}
            {row("Net payable", d.netPayable)}
            <tr><td colSpan={3}><strong>Total payable (this period)</strong></td><td style={{ textAlign: "right" }}><strong>{inr(d.totalPayable)}</strong></td></tr>
          </tbody>
        </ListTable>
      )}
    </>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
