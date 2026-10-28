import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../lib/api";
import { downloadCsv, parseCsv } from "../lib/csv";

const configs = {
  products: { key: "sku", required: ["sku", "name"], columns: ["sku", "name", "unit", "purchasePrice", "salePrice", "gstRate", "hsnSac", "openingStock", "reorderLevel", "isService"], example: ["ROUTER-01", "WiFi Router", "NOS", "1000", "1500", "18", "851762", "10", "2", "false"] },
  customers: { key: "phone", required: ["name", "phone"], columns: ["name", "phone", "email", "gstTreatment", "gstin", "billingAddress", "serviceAddress", "city", "stateCode", "pincode", "openingBalance", "notes"], example: ["Sample Customer", "9000000001", "customer@example.com", "B2C", "", "10 Main Road", "", "Chennai", "33", "600001", "0", ""] },
  plans: { key: "code", required: ["code", "name", "price"], columns: ["code", "name", "price", "gstRate", "hsnSac", "billingCycleMonths", "planType", "description"], example: ["FIB100", "Fiber 100 Mbps", "599", "18", "998422", "1", "PREPAID", "Monthly subscription"] },
} as const;
type Kind = keyof typeof configs;
type Row = { values: Record<string, unknown>; status: "pending" | "ready" | "created" | "error" | "unknown"; message?: string };
type ImportResult = { row: number; status: "ready" | "created" | "error"; message?: string };

export function BulkImport({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const config = configs[kind];
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const stop = useRef(false);

  async function load(file?: File) {
    setRows([]); setError(""); setProgress("");
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose a CSV file smaller than 2 MB.");
      const parsed = parseCsv(await file.text());
      const columns: readonly string[] = config.columns;
      for (const column of Object.keys(parsed[0])) if (!columns.includes(column)) throw new Error(`Unknown column '${column}'. Download the template for supported columns.`);
      for (const required of config.required) if (!(required in parsed[0])) throw new Error(`Missing required column '${required}'.`);
      const seen = new Set<string>();
      setRows(parsed.map((row) => {
        const key = row[config.key]?.toUpperCase();
        const duplicate = !!key && seen.has(key); if (key) seen.add(key);
        const values = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== "").map(([key, value]) => [key, key === "isService" && /^(true|false)$/i.test(value) ? value.toLowerCase() === "true" : value]));
        return { values, status: duplicate ? "error" : "pending", message: duplicate ? `Duplicate ${config.key} in this file` : undefined };
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function run(dryRun: boolean) {
    setBusy(true); setError(""); stop.current = false;
    const next = rows.map((row) => ({ ...row }));
    const indexes = next.map((_, i) => i).filter((i) => dryRun ? next[i].status === "pending" : next[i].status === "ready");
    try {
      for (let offset = 0; offset < indexes.length && !stop.current; offset += 50) {
        const batch = indexes.slice(offset, offset + 50);
        setProgress(`${dryRun ? "Validating" : "Importing"} ${offset + 1}–${offset + batch.length} of ${indexes.length}`);
        try {
          const { data } = await api.post<{ results: ImportResult[] }>(`/${kind}/import`, { rows: batch.map((i) => next[i].values), dryRun });
          for (const result of data.results) {
            const index = batch[result.row - 1];
            if (index !== undefined) next[index] = { ...next[index], status: result.status, message: result.message };
          }
        } catch (e) {
          if (!dryRun) for (const index of batch) next[index] = { ...next[index], status: "unknown", message: "Request interrupted. Some rows may have saved. Preview the file again to check existing records before retrying." };
          throw e;
        } finally { setRows([...next]); }
      }
      setProgress(stop.current ? "Stopped after the current batch." : dryRun ? "Preview complete. Review the results, then import the ready rows." : "Import complete. Review the row results below.");
    } catch (e) { setError(errMessage(e)); }
    finally {
      setBusy(false);
      if (!dryRun) { void qc.invalidateQueries({ queryKey: [kind] }); void qc.invalidateQueries({ queryKey: ["entity-search"] }); }
    }
  }
  const ready = rows.filter((row) => row.status === "ready").length;
  return <>
    <button type="button" onClick={() => setOpen(true)}>Import CSV</button>
    {open && <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-label={`Import ${kind}`} style={{ width: 850, maxWidth: "95vw" }}>
      <h3>Bulk import {kind}</h3>
      <p>Download the template, fill it in, and save as CSV. Up to 1,000 rows / 2 MB. Keep phone numbers, state codes and pincodes as text in your spreadsheet.</p>
      <p>Required: {config.required.join(", ")}. Existing {config.key} values are reported as duplicates. Import creates new records only.</p>
      <button type="button" disabled={busy} onClick={() => downloadCsv(`${kind}-template.csv`, [[...config.columns], [...config.example]])}>Download template</button>
      <label>Choose CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void load(e.target.files?.[0])} /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <p role="status">{progress}</p>
      {!!rows.length && <><p>{rows.length} rows · {ready} ready · {rows.filter((r) => r.status === "created").length} imported · {rows.filter((r) => r.status === "error" || r.status === "unknown").length} errors</p>
        <div style={{ maxHeight: 300, overflow: "auto" }}><table><thead><tr><th>Data row</th><th>Name</th><th>{config.key}</th><th>Status / details</th></tr></thead><tbody>{rows.map((row, i) => <tr key={i}><td>{i + 1}</td><td>{String(row.values.name ?? "")}</td><td>{String(row.values[config.key] ?? "")}</td><td>{row.status}{row.message && ` — ${row.message}`}</td></tr>)}</tbody></table></div>
        <button type="button" onClick={() => downloadCsv(`${kind}-import-results.csv`, [["dataRow", "name", config.key, "status", "message"], ...rows.map((row, i) => [String(i + 1), String(row.values.name ?? ""), String(row.values[config.key] ?? ""), row.status, row.message ?? ""])])}>Download results</button>
      </>}
      <div className="actions">
        {busy ? <button type="button" onClick={() => { stop.current = true; }}>Stop after current batch</button> : <button type="button" onClick={() => setOpen(false)}>Close</button>}
        <button type="button" disabled={busy || !rows.some((row) => row.status === "pending")} onClick={() => void run(true)}>Validate & preview</button>
        <button type="button" className="primary" disabled={busy || !ready || rows.some((row) => row.status === "pending")} onClick={() => void run(false)}>Import {ready} ready rows</button>
      </div>
    </div></div>}
  </>;
}
