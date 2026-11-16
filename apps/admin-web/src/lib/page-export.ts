type ExportTable = { name: string; headers: string[]; rows: string[][] };
type PageReport = { title: string; tenant?: string; filters: string[]; tables: ExportTable[] };

export function readPageFilters(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    ".toolbar select, .toolbar input[type='date'], .toolbar input[placeholder^='Search'], .toolbar input[aria-label='Report year']",
  )).filter((field) => field.getClientRects().length && !field.closest(".modal, form") && field.getAttribute("aria-label") !== "Rows per page")
    .flatMap((field) => {
      const label = field.getAttribute("aria-label") || field.title || field.getAttribute("placeholder");
      const value = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent?.trim() : field.value;
      return label && value ? [`${label}: ${value}`] : [];
    });
}

const excluded = "button, input, select, textarea, svg, [hidden], [aria-hidden='true'], [data-no-export]";
const cleanText = (element: Element) => {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(excluded).forEach((child) => child.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
};

export function readPageTables(root: HTMLElement): ExportTable[] {
  const tables: ExportTable[] = [];
  const metrics = Array.from(root.querySelectorAll("[data-export-metric]"))
    .filter((metric) => metric.getClientRects().length)
    .map((metric) => [metric.getAttribute("data-export-metric") ?? "", cleanText(metric)]);
  if (metrics.length) tables.push({ name: "Summary", headers: ["Metric", "Value"], rows: metrics });
  let name = "";
  for (const element of root.querySelectorAll<HTMLElement>("h3, h4, table")) {
    if (!element.getClientRects().length || element.closest("[role='dialog'], .modal, [data-no-export], form")) continue;
    if (!(element instanceof HTMLTableElement)) {
      name = cleanText(element);
      continue;
    }
    const headerRow = element.tHead?.rows[element.tHead.rows.length - 1];
    if (!headerRow) continue;
    const headers = Array.from(headerRow.cells, cleanText);
    const columns = headers.flatMap((header, index) => header ? [index] : []);
    if (!columns.length) continue;
    const rows = Array.from(element.tBodies).flatMap((body) => Array.from(body.rows))
      .filter((row) => row.getClientRects().length || row.classList.contains("list-page-hidden"))
      .filter((row) => Array.from(row.cells).reduce((total, cell) => total + cell.colSpan, 0) === headers.length &&
        !(row.cells.length === 1 && row.cells[0].colSpan > 1))
      .map((row) => {
        const cells = Array.from(row.cells).flatMap((cell) => [cleanText(cell), ...Array<string>(cell.colSpan - 1).fill("")]);
        return columns.map((index) => cells[index] ?? "");
      })
      .filter((row) => row.some(Boolean));
    if (rows.length) tables.push({ name: element.getAttribute("aria-label") || name || `Table ${tables.length + 1}`, headers: columns.map((index) => headers[index]), rows });
    name = "";
  }
  return tables;
}

export async function downloadTableWorkbook(report: PageReport) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  report.tables.forEach((table, index) => {
    const name = table.name.replace(/[\\/*?:[\]]/g, " ").replace(/^'+|'+$/g, "").trim();
    const sheet = workbook.addWorksheet(`${index + 1} ${name}`.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }] });
    sheet.addRow([report.title, report.tenant ?? ""]);
    sheet.addRow([report.filters.join(" | ")]);
    sheet.addRow([table.name]);
    sheet.addRow(table.headers).font = { bold: true };
    for (const row of table.rows) {
      const added = sheet.addRow(row.map((text) => /^-?₹[\d,]+(?:\.\d+)?$/.test(text) ? Number(text.replace(/[₹,]/g, "")) : text));
      added.eachCell((cell, column) => {
        if (typeof cell.value === "number" && row[column - 1].includes("₹")) cell.numFmt = '"₹"#,##0.00';
      });
    }
    sheet.columns.forEach((column, index) => {
      column.width = Math.min(55, Math.max(12, table.headers[index]?.length ?? 0, ...table.rows.map((row) => row[index]?.length ?? 0)) + 2);
      column.alignment = { wrapText: true, vertical: "top" };
    });
  });
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.title.replace(/[^\p{L}\p{N}-]+/gu, "-")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function printTablePdf(report: PageReport) {
  const frame = document.createElement("iframe");
  frame.title = "PDF export";
  frame.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(frame);
  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    throw new Error("Could not open the PDF print preview.");
  }
  const doc = printWindow.document;
  doc.title = report.title;
  const style = doc.createElement("style");
  style.textContent = "@page { size: A4 landscape; margin: 12mm } body { font: 11px Arial,sans-serif; color:#142033 } table { border-collapse:collapse; width:100%; table-layout:fixed } th,td { border:1px solid #b8c2d0; text-align:left; padding:5px; overflow-wrap:anywhere } tr { break-inside:avoid } h2 { break-after:avoid }";
  doc.head.append(style);
  const heading = doc.createElement("h1");
  heading.textContent = report.title;
  doc.body.append(heading);
  if (report.tenant) doc.body.append(report.tenant);
  if (report.filters.length) {
    const filters = doc.createElement("p");
    filters.textContent = report.filters.join(" · ");
    doc.body.append(filters);
  }
  for (const table of report.tables) {
    const title = doc.createElement("h2");
    title.textContent = table.name;
    const element = doc.createElement("table");
    const header = element.createTHead().insertRow();
    for (const label of table.headers) {
      const cell = doc.createElement("th");
      cell.textContent = label;
      header.append(cell);
    }
    const body = element.createTBody();
    for (const row of table.rows) {
      const target = body.insertRow();
      for (const value of row) target.insertCell().textContent = value;
    }
    doc.body.append(title, element);
  }
  printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
  printWindow.focus();
  try { printWindow.print(); } catch (error) { frame.remove(); throw error; }
}
