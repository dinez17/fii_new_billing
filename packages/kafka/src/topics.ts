export const TOPICS = {
  BILLING_GENERATE: "billing.generate",
  INVOICE_CREATED: "invoice.created",
  INVOICE_UPDATED: "invoice.updated",
  INVOICE_PAID: "invoice.paid",
  INVOICE_CANCELLED: "invoice.cancelled",
  PAYMENT_INITIATED: "payment.initiated",
  PAYMENT_SUCCESS: "payment.success",
  PAYMENT_FAILED: "payment.failed",
  RECEIPT_GENERATED: "receipt.generated",
  NOTE_CREATED: "note.created",
  NOTE_CANCELLED: "note.cancelled",
  COMPLAINT_CREATED: "complaint.created",
  COMPLAINT_ASSIGNED: "complaint.assigned",
  COMPLAINT_RESOLVED: "complaint.resolved",
  TASK_CREATED: "task.created",
  TASK_COMPLETED: "task.completed",
  PURCHASE_INVOICE_CREATED: "purchase.invoice.created",
  PURCHASE_RETURN_CREATED: "purchase.return.created",
  SUPPLIER_PAYMENT_PAID: "supplier.payment.paid",
  EXPENSE_CREATED: "expense.created",
  PAYROLL_GENERATED: "payroll.generated",
  SALARY_PAID: "salary.paid",
  STOCK_UPDATED: "stock.updated",
  NOTIFICATION_SEND: "notification.send",
  GST_REPORT_GENERATED: "gst.report.generated",
  REPORT_REQUESTED: "report.requested",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const dlqOf = (topic: string) => `${topic}.dlq`;
