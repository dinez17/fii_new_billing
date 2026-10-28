import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "@fii/auth";
import { prisma } from "@fii/database";
import { h, parse, n, dayStart, dayEnd, dateRange } from "./util.js";

export const gstRouter = Router();
gstRouter.use(authenticate);

const round = (v: number) => Math.round(v * 100) / 100;
const rangeWhere = (from: Date, to: Date) => ({ gte: dayStart(from), lte: dayEnd(to) });

/**
 * GSTR-1 — outward supplies for a period, split into the standard sections:
 * B2B (registered), B2CS (unregistered, by place-of-supply + rate), CDNR
 * (credit/debit notes to registered), HSN summary, and the docs-issued table.
 */
gstRouter.get("/gstr1", authorize("gst_report:read"), h(async (req, res) => {
  const q = parse(dateRange, req.query);
  const tenantId = req.auth!.tenantId;
  const dateIn = rangeWhere(q.from, q.to);

  const invoices = await prisma.invoice.findMany({
    where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: dateIn },
    select: {
      id: true, invoiceNumber: true, invoiceDate: true, placeOfSupply: true, gstTreatment: true,
      taxableValue: true, cgst: true, sgst: true, igst: true, grandTotal: true,
      customer: { select: { name: true, gstin: true, stateCode: true } },
    },
    orderBy: { invoiceDate: "asc" },
  });

  // B2B — grouped by customer GSTIN
  const b2bMap = new Map<string, { gstin: string; name: string; invoices: number; taxableValue: number; cgst: number; sgst: number; igst: number }>();
  // B2CS — grouped by place of supply + effective (blended) is not needed; group by POS
  const b2csMap = new Map<string, { placeOfSupply: string; taxableValue: number; cgst: number; sgst: number; igst: number }>();
  for (const inv of invoices) {
    const gstin = inv.customer.gstin?.trim();
    if (gstin) {
      const rec = b2bMap.get(gstin) ?? { gstin, name: inv.customer.name, invoices: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
      rec.invoices += 1; rec.taxableValue += n(inv.taxableValue); rec.cgst += n(inv.cgst); rec.sgst += n(inv.sgst); rec.igst += n(inv.igst);
      b2bMap.set(gstin, rec);
    } else {
      const pos = inv.placeOfSupply || "-";
      const rec = b2csMap.get(pos) ?? { placeOfSupply: pos, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
      rec.taxableValue += n(inv.taxableValue); rec.cgst += n(inv.cgst); rec.sgst += n(inv.sgst); rec.igst += n(inv.igst);
      b2csMap.set(pos, rec);
    }
  }

  // CDNR — credit & debit notes whose invoice customer is registered
  const [creditNotes, debitNotes] = await Promise.all([
    prisma.creditNote.findMany({
      where: { tenantId, status: { not: "CANCELLED" }, noteDate: dateIn, invoice: { customer: { gstin: { not: null } } } },
      select: { noteNumber: true, noteDate: true, taxableValue: true, cgst: true, sgst: true, igst: true, total: true, invoice: { select: { invoiceNumber: true, customer: { select: { gstin: true, name: true } } } } },
    }),
    prisma.debitNote.findMany({
      where: { tenantId, status: { not: "CANCELLED" }, noteDate: dateIn, invoice: { customer: { gstin: { not: null } } } },
      select: { noteNumber: true, noteDate: true, taxableValue: true, cgst: true, sgst: true, igst: true, total: true, invoice: { select: { invoiceNumber: true, customer: { select: { gstin: true, name: true } } } } },
    }),
  ]);

  // HSN summary — from invoice line items in range
  const items = await prisma.invoiceItem.findMany({
    where: { invoice: { tenantId, status: { not: "CANCELLED" }, invoiceDate: dateIn } },
    select: { hsnSac: true, quantity: true, gstRate: true, taxableValue: true, cgst: true, sgst: true, igst: true },
  });
  const hsnMap = new Map<string, { hsnSac: string; gstRate: number; quantity: number; taxableValue: number; cgst: number; sgst: number; igst: number }>();
  for (const it of items) {
    const key = `${it.hsnSac ?? "-"}|${n(it.gstRate)}`;
    const rec = hsnMap.get(key) ?? { hsnSac: it.hsnSac ?? "-", gstRate: n(it.gstRate), quantity: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
    rec.quantity += n(it.quantity); rec.taxableValue += n(it.taxableValue); rec.cgst += n(it.cgst); rec.sgst += n(it.sgst); rec.igst += n(it.igst);
    hsnMap.set(key, rec);
  }

  const roundRec = <T extends Record<string, number | string>>(r: T): T => {
    const o: Record<string, number | string> = { ...r };
    for (const k of Object.keys(o)) if (typeof o[k] === "number") o[k] = round(o[k] as number);
    return o as T;
  };

  res.json({
    range: { from: q.from, to: q.to },
    b2b: [...b2bMap.values()].map(roundRec),
    b2cs: [...b2csMap.values()].map(roundRec),
    cdnr: {
      credit: creditNotes.map((c) => ({ noteNumber: c.noteNumber, noteDate: c.noteDate, invoiceNumber: c.invoice.invoiceNumber, gstin: c.invoice.customer.gstin, name: c.invoice.customer.name, taxableValue: n(c.taxableValue), cgst: n(c.cgst), sgst: n(c.sgst), igst: n(c.igst), total: n(c.total) })),
      debit: debitNotes.map((d) => ({ noteNumber: d.noteNumber, noteDate: d.noteDate, invoiceNumber: d.invoice.invoiceNumber, gstin: d.invoice.customer.gstin, name: d.invoice.customer.name, taxableValue: n(d.taxableValue), cgst: n(d.cgst), sgst: n(d.sgst), igst: n(d.igst), total: n(d.total) })),
    },
    hsn: [...hsnMap.values()].map(roundRec).sort((a, b) => b.taxableValue - a.taxableValue),
    docs: {
      invoices: { count: invoices.length, from: invoices[0]?.invoiceNumber ?? null, to: invoices.at(-1)?.invoiceNumber ?? null },
      creditNotes: creditNotes.length,
      debitNotes: debitNotes.length,
    },
    summary: {
      taxableValue: round([...invoices].reduce((s, i) => s + n(i.taxableValue), 0)),
      cgst: round(invoices.reduce((s, i) => s + n(i.cgst), 0)),
      sgst: round(invoices.reduce((s, i) => s + n(i.sgst), 0)),
      igst: round(invoices.reduce((s, i) => s + n(i.igst), 0)),
    },
  });
}));

/**
 * GSTR-3B — monthly summary: outward tax liability (net of credit/debit notes)
 * vs input tax credit (purchase invoices + expense input GST) → net payable.
 */
gstRouter.get("/gstr3b", authorize("gst_report:read"), h(async (req, res) => {
  const q = parse(z.object({
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  }), req.query);
  const tenantId = req.auth!.tenantId;
  const from = new Date(Date.UTC(q.year, q.month - 1, 1));
  const to = new Date(Date.UTC(q.year, q.month, 0, 23, 59, 59, 999));
  const inv = { gte: from, lte: to };

  const [sales, creditNotes, debitNotes, purchases, expenseGst] = await Promise.all([
    prisma.invoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, invoiceDate: inv }, _sum: { taxableValue: true, cgst: true, sgst: true, igst: true } }),
    prisma.creditNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { taxableValue: true, cgst: true, sgst: true, igst: true } }),
    prisma.debitNote.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, noteDate: inv }, _sum: { taxableValue: true, cgst: true, sgst: true, igst: true } }),
    prisma.purchaseInvoice.aggregate({ where: { tenantId, invoiceDate: inv }, _sum: { cgst: true, sgst: true, igst: true } }),
    prisma.expense.aggregate({ where: { tenantId, status: "RECORDED", expenseDate: inv, isInterState: false }, _sum: { gstAmount: true } }),
  ]);

  const outward = {
    taxableValue: round(n(sales._sum.taxableValue) - n(creditNotes._sum.taxableValue) + n(debitNotes._sum.taxableValue)),
    cgst: round(n(sales._sum.cgst) - n(creditNotes._sum.cgst) + n(debitNotes._sum.cgst)),
    sgst: round(n(sales._sum.sgst) - n(creditNotes._sum.sgst) + n(debitNotes._sum.sgst)),
    igst: round(n(sales._sum.igst) - n(creditNotes._sum.igst) + n(debitNotes._sum.igst)),
  };
  // expense input GST is split evenly to CGST/SGST for intra-state (simplified)
  const expHalf = round(n(expenseGst._sum.gstAmount) / 2);
  const itc = {
    cgst: round(n(purchases._sum.cgst) + expHalf),
    sgst: round(n(purchases._sum.sgst) + expHalf),
    igst: round(n(purchases._sum.igst)),
  };
  const netPayable = {
    cgst: round(outward.cgst - itc.cgst),
    sgst: round(outward.sgst - itc.sgst),
    igst: round(outward.igst - itc.igst),
  };
  res.json({
    period: { year: q.year, month: q.month },
    outward,
    itc,
    netPayable,
    totalPayable: round(Math.max(0, netPayable.cgst) + Math.max(0, netPayable.sgst) + Math.max(0, netPayable.igst)),
  });
}));
