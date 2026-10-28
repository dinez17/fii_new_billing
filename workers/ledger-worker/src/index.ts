/**
 * ledger-worker — the SINGLE writer of LedgerEntry.
 *
 * Consumes financial events and posts party-ledger rows:
 *   invoice.created  → DEBIT  customer (they owe more)
 *   payment.success  → CREDIT customer (they paid)
 *   note.created     → credit note: CREDIT · debit note: DEBIT
 *
 * Also posts cash-basis day-book rows for events that move money but have no
 * party ledger:
 *   salary.paid      → CASH_OUT · source PAYROLL
 *
 * Idempotent: runConsumer skips events already in ProcessedEvent, and
 * fromBeginning=true lets a fresh worker backfill events still in Kafka.
 */
import { Prisma, prisma, postRecordedExpenseDayBook } from "@fii/database";
import { createLogger, startOpsServer } from "@fii/common";
import { TOPICS, runConsumer, type EventEnvelope } from "@fii/kafka";
import { postInvoiceEdit, type InvoiceEdit } from "./invoice-edit.js";

const log = createLogger("ledger-worker");

type PayMode = Prisma.DayBookEntryCreateInput["mode"];
interface InvoiceCreated { invoiceId: string; invoiceNumber: string; customerId: string; grandTotal: string; dueDate: string }
interface PaymentSuccess { paymentId: string; customerId: string; amount: string; mode: PayMode; receiptNumber: string; paymentDate: string }
interface NoteCreated { kind: "credit" | "debit"; noteId: string; noteNumber: string; customerId: string; invoiceNumber: string; total: string; noteDate: string }
interface SalaryPaid { payslipId: string; employeeName: string; amount: string; mode: PayMode; month: string }
interface ExpenseCreated { expenseId: string; category: string; total: string; mode: PayMode; expenseDate: string }
interface SupplierPaymentPaid { supplierPaymentId: string; voucherNumber: string; supplierId: string; amount: string; mode?: PayMode; paymentDate: string }

async function fyCodeFor(tenantId: string, date: Date): Promise<string> {
  const fy = await prisma.financialYear.findFirst({
    where: { tenantId, startDate: { lte: date }, endDate: { gte: date } },
  });
  return fy?.code ?? "UNKNOWN";
}

/** Cash-basis day-book row for a money movement (call once per event). */
async function writeDayBook(
  tenantId: string,
  at: Date,
  type: "CASH_IN" | "CASH_OUT",
  source: Prisma.DayBookEntryCreateInput["source"],
  amount: string,
  mode: PayMode,
  refType: string,
  refId: string,
  narration: string,
  actorUserId: string | null,
): Promise<void> {
  await prisma.dayBookEntry.create({
    data: {
      tenantId,
      fyCode: await fyCodeFor(tenantId, at),
      entryDate: at,
      type,
      source,
      mode: mode ?? undefined,
      amount: new Prisma.Decimal(amount),
      refType,
      refId,
      narration,
      createdById: actorUserId ?? undefined,
    },
  });
}

async function handle(topic: string, event: EventEnvelope): Promise<void> {
  const { tenantId } = event;

  switch (topic) {
    case TOPICS.INVOICE_UPDATED: {
      await postInvoiceEdit(event as EventEnvelope<InvoiceEdit>);
      break;
    }
    case TOPICS.INVOICE_CREATED: {
      const p = event.payload as InvoiceCreated;
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "CUSTOMER",
          partyId: p.customerId,
          fyCode: await fyCodeFor(tenantId, new Date(event.occurredAt)),
          entryDate: new Date(event.occurredAt),
          entryType: "INVOICE",
          refType: "INVOICE",
          refId: p.invoiceId,
          refNumber: p.invoiceNumber,
          debit: new Prisma.Decimal(p.grandTotal),
          narration: `Invoice ${p.invoiceNumber}`,
        },
      });
      break;
    }
    case TOPICS.INVOICE_CANCELLED: {
      const p = event.payload as InvoiceCreated & { reason?: string };
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "CUSTOMER",
          partyId: p.customerId,
          fyCode: await fyCodeFor(tenantId, new Date(event.occurredAt)),
          entryDate: new Date(event.occurredAt),
          entryType: "ADJUSTMENT",
          refType: "INVOICE",
          refId: p.invoiceId,
          refNumber: p.invoiceNumber,
          credit: new Prisma.Decimal(p.grandTotal),
          narration: `Invoice ${p.invoiceNumber} cancelled — reversal`,
        },
      });
      break;
    }
    case TOPICS.PAYMENT_SUCCESS: {
      const p = event.payload as PaymentSuccess;
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "CUSTOMER",
          partyId: p.customerId,
          fyCode: await fyCodeFor(tenantId, new Date(p.paymentDate)),
          // occurredAt (not the midnight business date) so same-day entries
          // sort in true chronological order in the ledger
          entryDate: new Date(event.occurredAt),
          entryType: "PAYMENT",
          refType: "PAYMENT",
          refId: p.paymentId,
          refNumber: p.receiptNumber,
          credit: new Prisma.Decimal(p.amount),
          narration: `Payment received — receipt ${p.receiptNumber}`,
        },
      });
      await writeDayBook(tenantId, new Date(event.occurredAt), "CASH_IN", "INVOICE_PAYMENT",
        p.amount, p.mode, "PAYMENT", p.paymentId, `Receipt ${p.receiptNumber}`, event.actorUserId);
      break;
    }
    case TOPICS.EXPENSE_CREATED: {
      // No party ledger for expenses — cash outflow only.
      const p = event.payload as ExpenseCreated;
      await prisma.$transaction((tx) => postRecordedExpenseDayBook(tx, tenantId, p.expenseId), { timeout: 30000 });
      break;
    }
    case TOPICS.NOTE_CREATED: {
      const p = event.payload as NoteCreated;
      const isCredit = p.kind === "credit";
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "CUSTOMER",
          partyId: p.customerId,
          fyCode: await fyCodeFor(tenantId, new Date(p.noteDate)),
          entryDate: new Date(p.noteDate),
          entryType: isCredit ? "CREDIT_NOTE" : "DEBIT_NOTE",
          refType: isCredit ? "CREDIT_NOTE" : "DEBIT_NOTE",
          refId: p.noteId,
          refNumber: p.noteNumber,
          ...(isCredit
            ? { credit: new Prisma.Decimal(p.total) }
            : { debit: new Prisma.Decimal(p.total) }),
          narration: `${isCredit ? "Credit" : "Debit"} note ${p.noteNumber} against ${p.invoiceNumber}`,
        },
      });
      break;
    }
    case TOPICS.NOTE_CANCELLED: {
      // reversal of the note's ledger effect (credit note cancelled → customer owes again)
      const p = event.payload as { kind: string; noteId: string; noteNumber: string; customerId: string; total: number; noteDate: string };
      const isCredit = p.kind === "credit";
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "CUSTOMER",
          partyId: p.customerId,
          fyCode: await fyCodeFor(tenantId, new Date(event.occurredAt)),
          entryDate: new Date(event.occurredAt),
          entryType: "ADJUSTMENT",
          refType: isCredit ? "CREDIT_NOTE_CANCEL" : "DEBIT_NOTE_CANCEL",
          refId: p.noteId,
          refNumber: p.noteNumber,
          ...(isCredit
            ? { debit: new Prisma.Decimal(p.total) }
            : { credit: new Prisma.Decimal(p.total) }),
          narration: `${isCredit ? "Credit" : "Debit"} note ${p.noteNumber} cancelled — reversal`,
        },
      });
      break;
    }
    case TOPICS.PURCHASE_INVOICE_CREATED: {
      // supplier ledger: CREDIT = we owe the supplier more
      const p = event.payload as { purchaseInvoiceId: string; ourNumber: string; supplierId: string; grandTotal: string; invoiceDate: string };
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "SUPPLIER",
          partyId: p.supplierId,
          fyCode: await fyCodeFor(tenantId, new Date(p.invoiceDate)),
          entryDate: new Date(event.occurredAt),
          entryType: "PURCHASE_INVOICE",
          refType: "PURCHASE_INVOICE",
          refId: p.purchaseInvoiceId,
          refNumber: p.ourNumber,
          credit: new Prisma.Decimal(p.grandTotal),
          narration: `Purchase invoice ${p.ourNumber}`,
        },
      });
      break;
    }
    case TOPICS.SUPPLIER_PAYMENT_PAID: {
      const p = event.payload as SupplierPaymentPaid;
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "SUPPLIER",
          partyId: p.supplierId,
          fyCode: await fyCodeFor(tenantId, new Date(p.paymentDate)),
          entryDate: new Date(event.occurredAt),
          entryType: "SUPPLIER_PAYMENT",
          refType: "SUPPLIER_PAYMENT",
          refId: p.supplierPaymentId,
          refNumber: p.voucherNumber,
          debit: new Prisma.Decimal(p.amount),
          narration: `Payment to supplier — voucher ${p.voucherNumber}`,
        },
      });
      await writeDayBook(tenantId, new Date(event.occurredAt), "CASH_OUT", "SUPPLIER_PAYMENT",
        p.amount, p.mode ?? null, "SUPPLIER_PAYMENT", p.supplierPaymentId, `Voucher ${p.voucherNumber}`, event.actorUserId);
      break;
    }
    case TOPICS.PURCHASE_RETURN_CREATED: {
      const p = event.payload as { purchaseReturnId: string; returnNumber: string; supplierId: string; total: string; returnDate: string; againstInvoice: string };
      await prisma.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "SUPPLIER",
          partyId: p.supplierId,
          fyCode: await fyCodeFor(tenantId, new Date(p.returnDate)),
          entryDate: new Date(event.occurredAt),
          entryType: "PURCHASE_RETURN",
          refType: "PURCHASE_RETURN",
          refId: p.purchaseReturnId,
          refNumber: p.returnNumber,
          debit: new Prisma.Decimal(p.total),
          narration: `Purchase return ${p.returnNumber} against ${p.againstInvoice}`,
        },
      });
      break;
    }
    case TOPICS.SALARY_PAID: {
      // No party ledger for employees — pure cash outflow → day book only.
      const p = event.payload as SalaryPaid;
      await writeDayBook(tenantId, new Date(event.occurredAt), "CASH_OUT", "PAYROLL",
        p.amount, p.mode, "PAYSLIP", p.payslipId, `Salary — ${p.employeeName} (${p.month})`, event.actorUserId);
      break;
    }
    default:
      log.warn({ topic }, "unhandled topic");
  }
}

async function main() {
  const stop = await runConsumer({
    groupId: "ledger-worker",
    topics: [
      TOPICS.INVOICE_CREATED, TOPICS.INVOICE_UPDATED, TOPICS.INVOICE_CANCELLED, TOPICS.PAYMENT_SUCCESS, TOPICS.NOTE_CREATED, TOPICS.NOTE_CANCELLED,
      TOPICS.PURCHASE_INVOICE_CREATED, TOPICS.SUPPLIER_PAYMENT_PAID, TOPICS.PURCHASE_RETURN_CREATED,
      TOPICS.SALARY_PAID, TOPICS.EXPENSE_CREATED,
    ],
    fromBeginning: true,
    handler: handle,
  });
  const stopOps = startOpsServer({ name: "ledger-worker", port: Number(process.env.LEDGER_WORKER_OPS_PORT ?? 9102) });
  log.info("ledger-worker consuming");
  process.on("SIGINT", async () => { stopOps(); await stop(); process.exit(0); });
}

main().catch((err) => { log.error({ err: String(err) }, "fatal"); process.exit(1); });
