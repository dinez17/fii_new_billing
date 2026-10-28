import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type { TableData } from "./generators.js";

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(data: TableData): Buffer {
  const lines = [data.title, "", data.columns.map(csvCell).join(",")];
  for (const row of data.rows) lines.push(row.map(csvCell).join(","));
  if (data.summary?.length) {
    lines.push("");
    for (const [k, v] of data.summary) lines.push(`${csvCell(k)},${csvCell(v)}`);
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

function toJson(data: TableData): Buffer {
  const objects = data.rows.map((r) => Object.fromEntries(data.columns.map((c, i) => [c, r[i]])));
  return Buffer.from(JSON.stringify({ title: data.title, rows: objects, summary: Object.fromEntries(data.summary ?? []) }, null, 2), "utf8");
}

async function toXlsx(data: TableData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.getCell(1, 1).value = data.title;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  const headerRow = ws.getRow(3);
  data.columns.forEach((c, i) => { headerRow.getCell(i + 1).value = c; });
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F5" } }; });
  data.rows.forEach((row, ri) => {
    row.forEach((cell, ci) => { ws.getCell(4 + ri, ci + 1).value = cell === "" ? null : cell; });
  });
  if (data.summary?.length) {
    let r = 5 + data.rows.length;
    for (const [k, v] of data.summary) {
      ws.getCell(r, 1).value = k;
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = v;
      r++;
    }
  }
  data.columns.forEach((c, i) => {
    let w = String(c).length;
    for (const row of data.rows.slice(0, 200)) w = Math.max(w, String(row[i] ?? "").length);
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 10), 50);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const fmtCell = (v: string | number): string =>
  typeof v === "number"
    ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : String(v);

// "1,234.56", "-42", "98.5%", "Rs. 100" → treated as numeric for alignment
const looksNumeric = (v: string | number): boolean =>
  typeof v === "number" || /^\s*(Rs\.?\s*)?-?[\d,]+(\.\d+)?\s*%?\s*$/.test(String(v));

function toPdf(data: TableData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 24;
  const FONT = 8, HEADER_FONT = 8, PAD = 4;

  // ── column alignment: right-align a column when most of its values are numeric
  const numericCol = data.columns.map((_, ci) => {
    const values = data.rows.map((r) => r[ci]).filter((v) => String(v).trim() !== "");
    if (values.length === 0) return false;
    return values.filter(looksNumeric).length / values.length >= 0.6;
  });

  // ── column widths: proportional to content (header + sample rows), clamped
  doc.font("Helvetica").fontSize(FONT);
  const sample = data.rows.slice(0, 60);
  const contentW = data.columns.map((c, ci) => {
    let w = doc.font("Helvetica-Bold").widthOfString(String(c));
    doc.font("Helvetica");
    for (const row of sample) w = Math.max(w, doc.widthOfString(fmtCell(row[ci] ?? "")));
    return Math.min(Math.max(w + PAD * 2, 42), 220);
  });
  const scale = width / contentW.reduce((a, b) => a + b, 0);
  const colW = contentW.map((w) => w * scale);
  const colX = colW.reduce<number[]>((xs, w, i) => [...xs, (xs[i] ?? left) + w], [left]);

  // ── title
  doc.fontSize(14).font("Helvetica-Bold").fillColor("#000").text(data.title, left, doc.y);
  doc.fontSize(8).font("Helvetica").fillColor("#666")
    .text(`Generated ${new Date().toLocaleString("en-IN")}`, left, doc.y + 2);
  doc.moveDown(0.8);

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.5).strokeColor("#c8ced8").stroke();

  const rowHeight = (cells: (string | number)[], font: string, size: number): number => {
    doc.font(font).fontSize(size);
    let h = 0;
    cells.forEach((c, i) => {
      h = Math.max(h, doc.heightOfString(fmtCell(c ?? ""), { width: colW[i] - PAD * 2 }));
    });
    return h + PAD * 2;
  };

  const drawHeader = (): void => {
    const h = rowHeight(data.columns, "Helvetica-Bold", HEADER_FONT);
    const y = doc.y;
    doc.rect(left, y, width, h).fillColor("#eef1f5").fill();
    doc.fillColor("#111");
    data.columns.forEach((c, i) => {
      doc.font("Helvetica-Bold").fontSize(HEADER_FONT)
        .text(String(c), colX[i] + PAD, y + PAD, { width: colW[i] - PAD * 2, align: numericCol[i] ? "right" : "left" });
    });
    // header borders
    line(left, y, left + width, y);
    line(left, y + h, left + width, y + h);
    for (const x of colX) line(x, y, x, y + h);
    line(left + width, y, left + width, y + h);
    doc.y = y + h;
  };

  const drawRow = (cells: (string | number)[], zebra: boolean): void => {
    const h = rowHeight(cells, "Helvetica", FONT);
    if (doc.y + h > bottomLimit()) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
      drawHeader();
    }
    const y = doc.y;
    if (zebra) { doc.rect(left, y, width, h).fillColor("#f7f9fb").fill(); }
    doc.fillColor("#111");
    cells.forEach((c, i) => {
      doc.font("Helvetica").fontSize(FONT)
        .text(fmtCell(c ?? ""), colX[i] + PAD, y + PAD, { width: colW[i] - PAD * 2, align: numericCol[i] ? "right" : "left" });
    });
    line(left, y + h, left + width, y + h);
    for (const x of colX) line(x, y, x, y + h);
    line(left + width, y, left + width, y + h);
    doc.y = y + h;
  };

  drawHeader();
  data.rows.forEach((row, i) => drawRow(row, i % 2 === 1));
  if (data.rows.length === 0) {
    doc.font("Helvetica").fontSize(9).fillColor("#666").text("No data for this range.", left + PAD, doc.y + PAD);
    doc.y += 20;
  }

  // ── summary box (right-aligned label/value pairs)
  if (data.summary?.length) {
    if (doc.y + data.summary.length * 16 + 20 > bottomLimit()) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
    }
    doc.y += 10;
    const boxW = 260;
    const boxX = left + width - boxW;
    for (const [k, v] of data.summary) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor("#444")
        .text(k, boxX, y, { width: boxW - 110, align: "left" });
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
        .text(fmtCell(v), boxX + boxW - 110, y, { width: 110, align: "right" });
      doc.y = y + 15;
    }
    line(boxX, doc.y, boxX + boxW, doc.y);
  }

  // ── page numbers (zero the bottom margin while stamping — otherwise
  // pdfkit auto-adds blank pages when writing inside the margin area)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor("#888").text(
      `Page ${i - range.start + 1} of ${range.count}`,
      left, doc.page.height - 20,
      { width, align: "right", lineBreak: false },
    );
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return done;
}

/** Render a table to the requested format and return a data: URL. */
export async function render(format: string, data: TableData): Promise<string> {
  if (format === "JSON") return `data:application/json;base64,${toJson(data).toString("base64")}`;
  if (format === "PDF") return `data:application/pdf;base64,${(await toPdf(data)).toString("base64")}`;
  if (format === "XLSX") return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${(await toXlsx(data)).toString("base64")}`;
  return `data:text/csv;base64,${toCsv(data).toString("base64")}`; // CSV default (opens in Excel)
}
