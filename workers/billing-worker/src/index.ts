/**
 * billing-worker — consumes billing.generate and mass-generates
 * subscription invoices (see generate.ts for idempotency guarantees).
 * The outbox relay must run somewhere to publish the invoice.created
 * events this worker writes — billing-service and payment-service both run it.
 */
import { createLogger, startOpsServer } from "@fii/common";
import { TOPICS, runConsumer, type EventEnvelope } from "@fii/kafka";
import { processRun } from "./generate.js";

const log = createLogger("billing-worker");

interface BillingGenerate {
  taxMode?: "ALL" | "GST" | "WITHOUT_GST";
  cycleType: "PREPAID" | "POSTPAID";
  periodStart: string;
  periodEnd: string;
}

async function main() {
  const stop = await runConsumer({
    groupId: "billing-worker",
    topics: [TOPICS.BILLING_GENERATE],
    handler: async (_topic, event: EventEnvelope) => {
      const p = event.payload as BillingGenerate;
      await processRun({
        tenantId: event.tenantId,
        cycleType: p.cycleType,
        taxMode: p.taxMode,
        periodStart: new Date(p.periodStart),
        periodEnd: new Date(p.periodEnd),
      });
    },
  });
  const stopOps = startOpsServer({ name: "billing-worker", port: Number(process.env.BILLING_WORKER_OPS_PORT ?? 9101) });
  log.info("billing-worker consuming");
  process.on("SIGINT", async () => { stopOps(); await stop(); process.exit(0); });
}

main().catch((err) => { log.error({ err: String(err) }, "fatal"); process.exit(1); });
