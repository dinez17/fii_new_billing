import { useEffect, useState, type RefObject } from "react";
import { downloadTableWorkbook, printTablePdf, readPageFilters, readPageTables } from "../lib/page-export";

export function PageExport({ content, title, tenant }: {
  content: RefObject<HTMLDivElement>;
  title: string;
  tenant?: string;
}) {
  const [available, setAvailable] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const check = () => setAvailable(Array.from(root.querySelectorAll("table tbody tr, [data-export-metric]")).some((row) => !row.closest(".modal, [role=dialog], form, [data-no-export]")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [content]);

  async function exportPage(format: "excel" | "pdf") {
    const root = content.current;
    if (!root) return;
    setError("");
    setExporting(true);
    try {
      const tables = readPageTables(root);
      if (!tables.length) throw new Error("There are no report rows to export on this page.");
      const heading = root.querySelector("h1, h2")?.textContent?.trim() || title;
      const report = { title: heading, tenant, filters: readPageFilters(root), tables };
      if (format === "excel") await downloadTableWorkbook(report);
      else printTablePdf(report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  return available && (
    <div className="page-export">
      <button type="button" className="small" disabled={exporting} onClick={() => void exportPage("excel")}>Export Excel</button>
      <button type="button" className="small" disabled={exporting} onClick={() => void exportPage("pdf")}>Save as PDF</button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
