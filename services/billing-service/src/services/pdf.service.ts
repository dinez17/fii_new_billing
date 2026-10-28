// PDF rendering lives in @fii/pdf (shared with payment-service and
// notification-worker so emails can attach the same documents).
export { streamInvoicePdf, buildInvoicePdfBuffer } from "@fii/pdf";
