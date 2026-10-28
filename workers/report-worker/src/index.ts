/**
 * report-worker — turns queued ReportJob rows into downloadable files.
 *
 *   report.requested → generate(reportType, filters) → render(format) → data URL
 *
 * Idempotent: a job already DONE/FAILED is skipped; runConsumer also de-dups by
 * ProcessedEvent, so a redelivery never regenerates a finished report.
 */
import { prisma } from "@fii/database";
import { createLogger, startOpsServer } from "@fii/common";
import { TOPICS, runConsumer, type EventEnvelope } from "@fii/kafka";
import { generate } from "./generators.js";
import { render } from "./render.js";

const log = createLogger("report-worker");

async function handle(topic: string, event: EventEnvelope): Promise<void> {
  if (topic !== TOPICS.REPORT_REQUESTED) return;
  const { tenantId } = event;
  const p = event.payload as { jobId: string; reportType: string; format: string };

  const job = await prisma.reportJob.findFirst({ where: { id: p.jobId, tenantId } });
  if (!job) { log.warn({ jobId: p.jobId }, "job not found"); return; }
  if (job.status === "DONE" || job.status === "FAILED") return; // already handled

  await prisma.reportJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });
  try {
    const filters = (job.filters ?? {}) as unknown as Record<string, unknown>;
    const table = await generate(job.reportType, tenantId, filters);
    const fileUrl = await render(job.format, table);
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: "DONE", fileUrl, finishedAt: new Date(), error: null },
    });
    log.info({ jobId: job.id, reportType: job.reportType, format: job.format }, "report ready");
  } catch (err) {
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: String(err).slice(0, 300), finishedAt: new Date() },
    });
    log.error({ jobId: job.id, err: String(err) }, "report failed");
  }
}

async function main() {
  const stop = await runConsumer({
    groupId: "report-worker",
    topics: [TOPICS.REPORT_REQUESTED],
    handler: handle,
  });
  const stopOps = startOpsServer({ name: "report-worker", port: Number(process.env.REPORT_WORKER_OPS_PORT ?? 9105) });
  log.info("report-worker consuming");
  process.on("SIGINT", async () => { stopOps(); await stop(); process.exit(0); });
}

main().catch((err) => { log.error({ err: String(err) }, "fatal"); process.exit(1); });
