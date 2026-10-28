import { Prisma, allocateNumber, applyStock, prisma } from "@fii/database";
import { badRequest, computeGst, notFound } from "@fii/common";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import type { z } from "zod";
import type { noteCreateBody, noteListQuery } from "../validators.js";
import { assertActiveFy } from "./fy.js";

type NoteInput = z.infer<typeof noteCreateBody>;
type ListQuery = z.infer<typeof noteListQuery>;
export type NoteKind = "credit" | "debit";

/**
 * Credit note reduces what the customer owes against an invoice;
 * debit note increases it. Credit notes cannot exceed the invoice value
 * minus previously issued credit notes.
 */
export async function createNote(tenantId: string, actorId: string, kind: NoteKind, input: NoteInput) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, tenantId },
    include: { creditNotes: { where: { status: { not: "CANCELLED" } } } },
  });
  if (!invoice) throw notFound("Invoice");
  if (invoice.status === "CANCELLED") throw badRequest("Cannot issue a note against a cancelled invoice");

  const fy = await assertActiveFy(tenantId, input.noteDate);
  if (input.noteDate < invoice.invoiceDate) throw badRequest("Note date cannot precede the invoice date");

  const totals = computeGst(input.items, invoice.isInterState);

  if (kind === "credit") {
    const prior = invoice.creditNotes.reduce((s, n) => s + Number(n.total), 0);
    const remaining = Number(invoice.grandTotal) - prior;
    if (Number(totals.grandTotal) > remaining + 0.001) {
      throw badRequest(`Credit note exceeds remaining invoice value (₹${remaining.toFixed(2)} left of ₹${Number(invoice.grandTotal).toFixed(2)})`);
    }
  }

  const itemsSnapshot = input.items.map((it, i) => ({
    ...it,
    taxableValue: totals.lines[i].taxableValue,
    cgst: totals.lines[i].cgst,
    sgst: totals.lines[i].sgst,
    igst: totals.lines[i].igst,
    lineTotal: totals.lines[i].lineTotal,
  }));

  const data = {
    tenantId,
    fyCode: fy.code,
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    noteDate: input.noteDate,
    reason: input.reason,
    taxableValue: new Prisma.Decimal(totals.taxableValue),
    cgst: new Prisma.Decimal(totals.cgst),
    sgst: new Prisma.Decimal(totals.sgst),
    igst: new Prisma.Decimal(totals.igst),
    total: new Prisma.Decimal(totals.grandTotal),
    items: itemsSnapshot as unknown as Prisma.InputJsonValue,
    createdById: actorId,
  };

  return prisma.$transaction(async (tx) => {
    const noteNumber = await allocateNumber(tx, tenantId, kind === "credit" ? "CREDIT_NOTE" : "DEBIT_NOTE", fy.code);
    const note = kind === "credit"
      ? await tx.creditNote.create({ data: { ...data, noteNumber } })
      : await tx.debitNote.create({ data: { ...data, noteNumber } });

    // A credit note settles part (or all) of the invoice balance:
    // outstanding = grandTotal − amountPaid − creditedAmount.
    if (kind === "credit") {
      const prior = invoice.creditNotes.reduce((s, cn) => s + Number(cn.total), 0);
      const newCredited = Math.round((prior + Number(totals.grandTotal)) * 100) / 100;
      const settled = Number(invoice.amountPaid) + newCredited;
      const newStatus = settled >= Number(invoice.grandTotal) - 0.001 ? "PAID" : settled > 0.001 ? "PARTIAL" : "UNPAID";
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          creditedAmount: new Prisma.Decimal(newCredited),
          ...(invoice.status !== "DRAFT" ? { status: newStatus } : {}),
        },
      });
    }

    // A credit note is a sales return: put the returned goods back into stock.
    if (kind === "credit") {
      for (const it of input.items) {
        if (!it.productId) continue;
        const product = await tx.product.findFirst({ where: { id: it.productId, tenantId } });
        if (!product || product.isService) continue;
        await applyStock(tx, {
          tenantId, productId: it.productId, type: "ADJUST_IN", quantity: it.quantity,
          refType: "CREDIT_NOTE", refId: note.id, reason: `Sales return ${noteNumber}`, actorId,
        });
      }
    }

    await writeOutbox(tx, tenantId, TOPICS.NOTE_CREATED, makeEnvelope(tenantId, {
      kind,
      noteId: note.id,
      noteNumber,
      customerId: invoice.customerId,
      invoiceNumber: invoice.invoiceNumber,
      total: totals.grandTotal,
      noteDate: input.noteDate.toISOString(),
    }, { actorUserId: actorId }));

    return note;
  });
}

export async function getNote(tenantId: string, kind: NoteKind, id: string) {
  const delegate = kind === "credit" ? prisma.creditNote : prisma.debitNote;
  const note = await (delegate as typeof prisma.creditNote).findFirst({
    where: { id, tenantId },
    include: {
      invoice: {
        select: {
          invoiceNumber: true, invoiceDate: true, placeOfSupply: true, grandTotal: true,
          customer: { select: { id: true, name: true, phone: true, email: true, gstin: true } },
        },
      },
    },
  });
  if (!note) throw notFound("Note");
  return note;
}

export async function listNotes(tenantId: string, kind: NoteKind, q: ListQuery) {
  const where = {
    tenantId,
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.from || q.to ? { noteDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { noteNumber: { contains: q.search, mode: "insensitive" as const } } : {}),
  };
  const delegate = kind === "credit" ? prisma.creditNote : prisma.debitNote;
  const [items, total] = await Promise.all([
    (delegate as typeof prisma.creditNote).findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { noteDate: "desc" },
      include: { invoice: { select: { invoiceNumber: true, customer: { select: { name: true } } } } },
    }),
    (delegate as typeof prisma.creditNote).count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

export async function cancelNote(tenantId: string, kind: NoteKind, id: string, actorId?: string) {
  const delegate = kind === "credit" ? prisma.creditNote : prisma.debitNote;
  const note = await (delegate as typeof prisma.creditNote).findFirst({ where: { id, tenantId } });
  if (!note) throw notFound("Note");
  if (note.status === "CANCELLED") throw badRequest("Already cancelled");
  await assertActiveFy(tenantId, note.noteDate);

  return prisma.$transaction(async (tx) => {
    const txDelegate = kind === "credit" ? tx.creditNote : tx.debitNote;
    const updated = await (txDelegate as typeof tx.creditNote).update({ where: { id }, data: { status: "CANCELLED" } });

    // Reinstate the invoice balance the note had settled
    if (kind === "credit") {
      const invoice = await tx.invoice.findFirst({ where: { id: note.invoiceId, tenantId } });
      if (invoice) {
        const newCredited = Math.max(0, Math.round((Number(invoice.creditedAmount) - Number(note.total)) * 100) / 100);
        const settled = Number(invoice.amountPaid) + newCredited;
        const newStatus = settled >= Number(invoice.grandTotal) - 0.001 ? "PAID" : settled > 0.001 ? "PARTIAL" : "UNPAID";
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            creditedAmount: new Prisma.Decimal(newCredited),
            ...(invoice.status !== "DRAFT" && invoice.status !== "CANCELLED" ? { status: newStatus } : {}),
          },
        });
      }
    }

    // A cancelled sales return means the goods are back with the customer —
    // reverse the ADJUST_IN we made when the note was created.
    if (kind === "credit") {
      const items = (note.items ?? []) as Array<{ productId?: string | null; quantity?: number }>;
      for (const it of items) {
        if (!it.productId || !it.quantity) continue;
        const product = await tx.product.findFirst({ where: { id: it.productId, tenantId } });
        if (!product || product.isService) continue;
        await applyStock(tx, {
          tenantId, productId: it.productId, type: "ADJUST_OUT", quantity: it.quantity,
          refType: "CREDIT_NOTE_CANCEL", refId: note.id, reason: `Sales return ${note.noteNumber} cancelled`, actorId,
        });
      }
    }

    // ledger-worker reverses the customer ledger entry off this event
    await writeOutbox(tx, tenantId, TOPICS.NOTE_CANCELLED, makeEnvelope(tenantId, {
      kind,
      noteId: note.id,
      noteNumber: note.noteNumber,
      customerId: note.customerId,
      total: Number(note.total),
      noteDate: note.noteDate.toISOString(),
    }, { actorUserId: actorId }));

    return updated;
  });
}
