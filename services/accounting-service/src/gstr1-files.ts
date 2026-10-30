import { Router } from "express";
import { z } from "zod";
import { badRequest } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { prisma } from "@fii/database";
import ExcelJS from "exceljs";
import { h, parse, n } from "./util.js";

/**
 * GSTR-1 offline-tool exports.
 *
 * Produces the exact CSV files the GST offline tool / portal accepts
 * (b2b,sez,de.csv · b2cl.csv · b2cs.csv · cdnr.csv · cdnur.csv ·
 *  hsn(b2b).csv · hsn(b2c).csv · hsn.csv · docs.csv, plus header-only
 *  amendment files) and a filled Excel workbook matching the official
 * GSTR1_Excel_Workbook_Template (same sheet names, headers on row 4,
 * data from row 5).
 */

export const gstr1FilesRouter = Router();
gstr1FilesRouter.use(authenticate);

const r2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number) => r2(v).toFixed(2);

// ── GST state code → "NN-Name" (as the offline tool expects)
const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli & Daman & Diu", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
const pos = (code: string): string => (STATES[code] ? `${code}-${STATES[code]}` : code);

// ── unit → GST UQC
const UQC: Record<string, string> = {
  NOS: "NOS-NUMBERS", PCS: "PCS-PIECES", KGS: "KGS-KILOGRAMS", KG: "KGS-KILOGRAMS",
  MTR: "MTR-METERS", LTR: "OTH-OTHERS", BOX: "BOX-BOX", SET: "SET-SETS",
  BDL: "BDL-BUNDLES", BAG: "BAG-BAGS", CAN: "CAN-CANS", CTN: "CTN-CARTONS",
  DOZ: "DOZ-DOZENS", GMS: "GMS-GRAMMES", PAC: "PAC-PACKS", ROL: "ROL-ROLLS",
  SQF: "SQF-SQUARE FEET", SQM: "SQM-SQUARE METERS", TON: "TON-TONNES", UNT: "UNT-UNITS",
};
const uqc = (unit: string | null | undefined): string => UQC[(unit ?? "NOS").toUpperCase()] ?? "OTH-OTHERS";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;

/** B2CL threshold — inter-state B2C invoices above this go to B2CL (₹1,00,000 w.e.f. Aug 2024). */
const B2CL_LIMIT = 100000;

// snap a blended note rate to the nearest GST slab
const SLABS = [0, 0.1, 0.25, 3, 5, 12, 18, 28];
const snapRate = (taxable: number, gst: number): number => {
  if (taxable <= 0) return 0;
  const raw = (gst / taxable) * 100;
  return SLABS.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 0);
};

type Cell = string | number;
interface Section { headers: string[]; rows: Cell[][] }

interface Gstr1Data {
  b2b: Section; b2cl: Section; b2cs: Section;
  cdnr: Section; cdnur: Section;
  hsnB2b: Section; hsnB2c: Section; hsnAll: Section;
  docs: Section;
}

const HEAD = {
  b2b: ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
  b2ba: ["GSTIN/UIN of Recipient", "Receiver Name", "Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
  b2cl: ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  b2cla: ["Original Invoice Number", "Original Invoice date", "Original Place Of Supply", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  b2cs: ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  b2csa: ["Financial Year", "Original Month", "Place Of Supply", "Type", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
  cdnr: ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  cdnra: ["GSTIN/UIN of Recipient", "Receiver Name", "Original Note Number", "Original Note Date", "Revised Note Number", "Revised Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  cdnur: ["UR Type", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  cdnura: ["UR Type", "Original Note Number", "Original Note Date", "Revised Note Number", "Revised Note Date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
  exp: ["Export Type", "Invoice Number", "Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Cess Amount"],
  expa: ["Export Type", "Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Cess Amount"],
  at: ["Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Received", "Cess Amount"],
  ata: ["Financial Year", "Original Month", "Original Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Received", "Cess Amount"],
  atadj: ["Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Adjusted", "Cess Amount"],
  atadja: ["Financial Year", "Original Month", "Original Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Adjusted", "Cess Amount"],
  exemp: ["Description", "Nil Rated Supplies", "Exempted(other than nil rated/non GST supply)", "Non-GST Supplies"],
  // workbook hsn sheets carry Rate in column 6; the standalone CSVs carry Rate last
  hsnWb: ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
  hsnCsv: ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount", "Rate"],
  docs: ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
} as const;

async function collect(tenantId: string, year: number, month: number): Promise<Gstr1Data> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const dateIn = { gte: from, lte: to };

  const [invoicesAll, creditNotesAll, debitNotesAll, products] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, chargeGst: true, invoiceDate: dateIn },
      select: {
        invoiceNumber: true, invoiceDate: true, placeOfSupply: true, isInterState: true,
        gstTreatment: true, status: true, grandTotal: true,
        customer: { select: { name: true, gstin: true } },
        items: { select: { productId: true, description: true, hsnSac: true, quantity: true, gstRate: true, taxableValue: true, cgst: true, sgst: true, igst: true, lineTotal: true } },
      },
      orderBy: { invoiceNumber: "asc" },
    }),
    prisma.creditNote.findMany({
      where: { tenantId, invoice: { tenantId, chargeGst: true }, noteDate: dateIn },
      select: { noteNumber: true, noteDate: true, status: true, taxableValue: true, cgst: true, sgst: true, igst: true, total: true, invoice: { select: { invoiceNumber: true, placeOfSupply: true, isInterState: true, grandTotal: true, customer: { select: { name: true, gstin: true } } } } },
      orderBy: { noteNumber: "asc" },
    }),
    prisma.debitNote.findMany({
      where: { tenantId, invoice: { tenantId, chargeGst: true }, noteDate: dateIn },
      select: { noteNumber: true, noteDate: true, status: true, taxableValue: true, cgst: true, sgst: true, igst: true, total: true, invoice: { select: { invoiceNumber: true, placeOfSupply: true, isInterState: true, grandTotal: true, customer: { select: { name: true, gstin: true } } } } },
      orderBy: { noteNumber: "asc" },
    }),
    prisma.product.findMany({ where: { tenantId }, select: { id: true, name: true, unit: true, hsnSac: true } }),
  ]);
  type Prod = (typeof products)[number];
  const productById = new Map<string, Prod>(products.map((p: Prod) => [p.id, p]));
  const invoices = invoicesAll.filter((i) => i.status !== "CANCELLED");

  // ── B2B (registered recipients) — one row per invoice per rate
  const b2bRows: Cell[][] = [];
  const b2clRows: Cell[][] = [];
  const b2csMap = new Map<string, { pos: string; rate: number; taxable: number }>();

  for (const inv of invoices) {
    const gstin = inv.customer.gstin?.trim();
    const byRate = new Map<number, number>(); // rate → taxable
    for (const it of inv.items) byRate.set(n(it.gstRate), (byRate.get(n(it.gstRate)) ?? 0) + n(it.taxableValue));
    if (byRate.size === 0) byRate.set(0, 0);

    if (gstin) {
      const invType = inv.gstTreatment === "SEZ" ? "SEZ supplies without payment" : "Regular B2B";
      for (const [rate, taxable] of byRate) {
        b2bRows.push([gstin, inv.customer.name, inv.invoiceNumber, dmy(inv.invoiceDate), money(n(inv.grandTotal)), pos(inv.placeOfSupply), "N", "", invType, "", rate, money(taxable), ""]);
      }
    } else if (inv.isInterState && n(inv.grandTotal) > B2CL_LIMIT) {
      for (const [rate, taxable] of byRate) {
        b2clRows.push([inv.invoiceNumber, dmy(inv.invoiceDate), money(n(inv.grandTotal)), pos(inv.placeOfSupply), "", rate, money(taxable), "", ""]);
      }
    } else {
      for (const [rate, taxable] of byRate) {
        const key = `${inv.placeOfSupply}|${rate}`;
        const rec = b2csMap.get(key) ?? { pos: inv.placeOfSupply, rate, taxable: 0 };
        rec.taxable += taxable;
        b2csMap.set(key, rec);
      }
    }
  }
  const b2csRows: Cell[][] = [...b2csMap.values()]
    .sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate)
    .map((r) => ["OE", pos(r.pos), "", r.rate, money(r.taxable), "", ""]);

  // ── CDNR / CDNUR (credit + debit notes)
  const cdnrRows: Cell[][] = [];
  const cdnurRows: Cell[][] = [];
  const pushNote = (note: typeof creditNotesAll[number], type: "C" | "D") => {
    if (note.status === "CANCELLED") return;
    const gstin = note.invoice.customer.gstin?.trim();
    const rate = snapRate(n(note.taxableValue), n(note.cgst) + n(note.sgst) + n(note.igst));
    if (gstin) {
      cdnrRows.push([gstin, note.invoice.customer.name, note.noteNumber, dmy(note.noteDate), type, pos(note.invoice.placeOfSupply), "N", "Regular B2B", money(n(note.total)), "", rate, money(n(note.taxableValue)), ""]);
    } else if (note.invoice.isInterState && n(note.invoice.grandTotal) > B2CL_LIMIT) {
      cdnurRows.push(["B2CL", note.noteNumber, dmy(note.noteDate), type, pos(note.invoice.placeOfSupply), money(n(note.total)), "", rate, money(n(note.taxableValue)), ""]);
    }
    // B2CS-scale notes are not reported in CDNUR — they net off inside B2CS in the return itself
  };
  for (const cn of creditNotesAll) pushNote(cn, "C");
  for (const dn of debitNotesAll) pushNote(dn, "D");

  // ── HSN summaries (B2B vs B2C recipient split, plus combined)
  interface HsnAgg { hsn: string; desc: string; uqc: string; qty: number; value: number; taxable: number; igst: number; cgst: number; sgst: number; rate: number }
  const hsnAgg = (registered: boolean | null) => {
    const map = new Map<string, HsnAgg>();
    for (const inv of invoices) {
      const isReg = Boolean(inv.customer.gstin?.trim());
      if (registered !== null && isReg !== registered) continue;
      for (const it of inv.items) {
        const prod = it.productId ? productById.get(it.productId) : undefined;
        const hsn = (it.hsnSac ?? prod?.hsnSac ?? "").trim();
        const rate = n(it.gstRate);
        const key = `${hsn}|${rate}|${uqc(prod?.unit)}`;
        const rec = map.get(key) ?? { hsn, desc: (prod?.name ?? it.description).slice(0, 30), uqc: uqc(prod?.unit), qty: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, rate };
        rec.qty += n(it.quantity); rec.value += n(it.lineTotal); rec.taxable += n(it.taxableValue);
        rec.igst += n(it.igst); rec.cgst += n(it.cgst); rec.sgst += n(it.sgst);
        map.set(key, rec);
      }
    }
    return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
  };
  // CSV order: ..., Taxable, IGST, CGST, SGST, Cess, Rate  ·  Workbook order: ..., Rate, Taxable, IGST, CGST, SGST, Cess
  const hsnCsvRows = (aggs: HsnAgg[]): Cell[][] =>
    aggs.map((a) => [a.hsn, a.desc, a.uqc, r2(a.qty), money(a.value), money(a.taxable), money(a.igst), money(a.cgst), money(a.sgst), "0.00", a.rate]);
  const hsnB2bAgg = hsnAgg(true), hsnB2cAgg = hsnAgg(false), hsnAllAgg = hsnAgg(null);

  // ── docs — document series issued during the period
  const docRow = (nature: string, docs: { number: string; cancelled: boolean }[]): Cell[] => {
    if (docs.length === 0) return [nature, "", "", "", ""];
    const sorted = [...docs].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return [nature, sorted[0].number, sorted[sorted.length - 1].number, docs.length, docs.filter((d) => d.cancelled).length];
  };
  const docsRows: Cell[][] = [
    docRow("Invoices for outward supply", invoicesAll.map((i) => ({ number: i.invoiceNumber, cancelled: i.status === "CANCELLED" }))),
    docRow("Credit Note", creditNotesAll.map((c) => ({ number: c.noteNumber, cancelled: c.status === "CANCELLED" }))),
    docRow("Debit Note", debitNotesAll.map((d) => ({ number: d.noteNumber, cancelled: d.status === "CANCELLED" }))),
  ].filter((r) => r[1] !== "");

  return {
    b2b: { headers: [...HEAD.b2b], rows: b2bRows },
    b2cl: { headers: [...HEAD.b2cl], rows: b2clRows },
    b2cs: { headers: [...HEAD.b2cs], rows: b2csRows },
    cdnr: { headers: [...HEAD.cdnr], rows: cdnrRows },
    cdnur: { headers: [...HEAD.cdnur], rows: cdnurRows },
    hsnB2b: { headers: [...HEAD.hsnCsv], rows: hsnCsvRows(hsnB2bAgg) },
    hsnB2c: { headers: [...HEAD.hsnCsv], rows: hsnCsvRows(hsnB2cAgg) },
    hsnAll: { headers: [...HEAD.hsnCsv], rows: hsnCsvRows(hsnAllAgg) },
    docs: { headers: [...HEAD.docs], rows: docsRows },
  };
}

// ── CSV rendering ────────────────────────────────────────────────────────────
const csvCell = (v: Cell): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (s: Section): string =>
  [s.headers.map(csvCell).join(","), ...s.rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";

/** section key → { filename, data selector or header-only } */
const CSV_SECTIONS: Record<string, { file: string; pick?: (d: Gstr1Data) => Section; headers?: readonly string[] }> = {
  b2b: { file: "b2b,sez,de.csv", pick: (d) => d.b2b },
  b2ba: { file: "b2ba.csv", headers: HEAD.b2ba },
  b2cl: { file: "b2cl.csv", pick: (d) => d.b2cl },
  b2cla: { file: "b2cla.csv", headers: HEAD.b2cla },
  b2cs: { file: "b2cs.csv", pick: (d) => d.b2cs },
  cdnr: { file: "cdnr.csv", pick: (d) => d.cdnr },
  cdnur: { file: "cdnur.csv", pick: (d) => d.cdnur },
  "hsn-b2b": { file: "hsn(b2b).csv", pick: (d) => d.hsnB2b },
  "hsn-b2c": { file: "hsn(b2c).csv", pick: (d) => d.hsnB2c },
  hsn: { file: "hsn.csv", pick: (d) => d.hsnAll },
  docs: { file: "docs.csv", pick: (d) => d.docs },
};

const periodQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export async function collectSectionCounts(tenantId: string, year: number, month: number) {
  const data = await collect(tenantId, year, month);
  return Object.fromEntries(Object.entries(CSV_SECTIONS).map(([key, def]) => {
    const rows = def.pick ? def.pick(data).rows : [];
    const documentColumn = key === "b2b" || key === "cdnr" ? 2 : key === "b2cl" ? 0 : key === "cdnur" ? 1 : null;
    return [key, { rows: rows.length,
      documents: key === "docs" ? rows.reduce((sum, row) => sum + Number(row[3]), 0) : documentColumn === null ? null : new Set(rows.map((row) => row[documentColumn])).size,
    }];
  }));
}
gstr1FilesRouter.get("/gstr1-file-counts", authorize("gst_report:read"), h(async (req, res) => {
  const q = parse(periodQuery, req.query);
  res.json(await collectSectionCounts(req.auth!.tenantId, q.year, q.month));
}));

gstr1FilesRouter.get("/gstr1-files/:section", authorize("gst_report:read"), h(async (req, res) => {
  const q = parse(periodQuery, req.query);
  const def = CSV_SECTIONS[req.params.section];
  if (!def) throw badRequest(`Unknown section '${req.params.section}'. Valid: ${Object.keys(CSV_SECTIONS).join(", ")}`);
  const section: Section = def.pick
    ? def.pick(await collect(req.auth!.tenantId, q.year, q.month))
    : { headers: [...def.headers!], rows: [] };
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${def.file}"`);
  res.send(toCsv(section));
}));

// ── Excel workbook (official template layout: title r1, headers r4, data r5+) ─
const WB_SHEETS: { name: string; headers: readonly string[]; title: string; pick?: (d: Gstr1Data) => Cell[][] }[] = [
  { name: "b2b,sez,de", headers: HEAD.b2b, title: "Summary For B2B, SEZ, DE (4A, 4B, 6B, 6C)", pick: (d) => d.b2b.rows },
  { name: "b2ba", headers: HEAD.b2ba, title: "Summary For B2BA" },
  { name: "b2cl", headers: HEAD.b2cl, title: "Summary For B2CL(5)", pick: (d) => d.b2cl.rows },
  { name: "b2cla", headers: HEAD.b2cla, title: "Summary For B2CLA" },
  { name: "b2cs", headers: HEAD.b2cs, title: "Summary For B2CS(7)", pick: (d) => d.b2cs.rows },
  { name: "b2csa", headers: HEAD.b2csa, title: "Summary For B2CSA" },
  { name: "cdnr", headers: HEAD.cdnr, title: "Summary For CDNR(9B)", pick: (d) => d.cdnr.rows },
  { name: "cdnra", headers: HEAD.cdnra, title: "Summary For CDNRA" },
  { name: "cdnur", headers: HEAD.cdnur, title: "Summary For CDNUR(9B)", pick: (d) => d.cdnur.rows },
  { name: "cdnura", headers: HEAD.cdnura, title: "Summary For CDNURA" },
  { name: "exp", headers: HEAD.exp, title: "Summary For EXP(6)" },
  { name: "expa", headers: HEAD.expa, title: "Summary For EXPA" },
  { name: "at", headers: HEAD.at, title: "Summary For Advance Received (11B)" },
  { name: "ata", headers: HEAD.ata, title: "Summary For ATA" },
  { name: "atadj", headers: HEAD.atadj, title: "Summary For Advance Adjusted (11B)" },
  { name: "atadja", headers: HEAD.atadja, title: "Summary For ATADJA" },
  { name: "exemp", headers: HEAD.exemp, title: "Summary For Nil rated, exempted and non GST outward supplies (8)" },
  {
    name: "hsn(b2b)", headers: HEAD.hsnWb, title: "Summary For HSN(12)",
    pick: (d) => d.hsnB2b.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[10], r[5], r[6], r[7], r[8], r[9]]),
  },
  {
    name: "hsn(b2c)", headers: HEAD.hsnWb, title: "Summary For HSN(12)",
    pick: (d) => d.hsnB2c.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[10], r[5], r[6], r[7], r[8], r[9]]),
  },
  { name: "docs", headers: HEAD.docs, title: "Summary of documents issued during the tax period (13)", pick: (d) => d.docs.rows },
];

gstr1FilesRouter.get("/gstr1-workbook", authorize("gst_report:read"), h(async (req, res) => {
  const q = parse(periodQuery, req.query);
  const data = await collect(req.auth!.tenantId, q.year, q.month);

  const wb = new ExcelJS.Workbook();
  for (const def of WB_SHEETS) {
    const ws = wb.addWorksheet(def.name);
    ws.getCell(1, 1).value = def.title;
    ws.getCell(1, 1).font = { bold: true };
    const headerRow = ws.getRow(4);
    def.headers.forEach((hd, i) => { headerRow.getCell(i + 1).value = hd; });
    headerRow.font = { bold: true };
    const rows = def.pick ? def.pick(data) : [];
    rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        // money strings ("11800.00") → numbers so Excel treats them as amounts.
        // Only strings WITH decimals are coerced — HSN codes / invoice numbers
        // like "0611710" must stay text (leading zeros matter).
        const asNum = typeof cell === "string" && /^-?\d+\.\d+$/.test(cell) ? Number(cell) : cell;
        ws.getCell(5 + ri, ci + 1).value = asNum === "" ? null : asNum;
      });
    });
    def.headers.forEach((_, i) => { ws.getColumn(i + 1).width = 22; });
  }

  const fname = `GSTR1_${q.year}-${String(q.month).padStart(2, "0")}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  await wb.xlsx.write(res);
  res.end();
}));
