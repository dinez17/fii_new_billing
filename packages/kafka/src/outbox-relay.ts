import { prisma } from "@fii/database";
import { createLogger } from "@fii/common";
import { getProducer } from "./producer.js";

const log = createLogger("outbox-relay");

interface OutboxRow {
  id: string;
  tenantId: string;
  topic: string;
  eventKey: string;
  payload: unknown;
}

/**
 * Transactional outbox relay. Services write OutboxEvent rows in the SAME
 * transaction as their business change; this relay publishes them to Kafka.
 *
 * Safe to run in multiple processes: rows are claimed with
 * FOR UPDATE SKIP LOCKED, so each event is picked up by exactly one relay.
 * If publishing fails after claiming, the claim is rolled back (publishedAt
 * reset) and the event is retried on a later tick.
 */
export function startOutboxRelay(intervalMs = 500, batchSize = 100): () => void {
  let running = true;

  const tick = async () => {
    if (!running) return;
    try {
      // atomically claim a batch
      const events = await prisma.$queryRaw<OutboxRow[]>`
        UPDATE "OutboxEvent" SET "publishedAt" = now()
        WHERE id IN (
          SELECT id FROM "OutboxEvent"
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt"
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "tenantId", topic, "eventKey", payload`;

      if (events.length > 0) {
        const producer = await getProducer();
        const failed: string[] = [];
        for (const e of events) {
          try {
            await producer.send({
              topic: e.topic,
              messages: [{ key: e.eventKey, value: JSON.stringify(e.payload) }],
            });
          } catch (err) {
            failed.push(e.id);
            log.error({ err: String(err), topic: e.topic }, "publish failed — will retry");
          }
        }
        if (failed.length > 0) {
          await prisma.outboxEvent.updateMany({
            where: { id: { in: failed } },
            data: { publishedAt: null },
          });
        }
        if (events.length - failed.length > 0) {
          log.info({ count: events.length - failed.length }, "published outbox events");
        }
      }
    } catch (err) {
      log.error({ err: String(err) }, "outbox relay tick failed");
    } finally {
      if (running) setTimeout(tick, intervalMs);
    }
  };

  setTimeout(tick, intervalMs);
  return () => { running = false; };
}

/**
 * Helper for services: write an outbox event inside an existing transaction.
 *   await prisma.$transaction(async (tx) => {
 *     const invoice = await tx.invoice.create({...});
 *     await writeOutbox(tx, tenantId, TOPICS.INVOICE_CREATED, envelope);
 *   });
 */
export async function writeOutbox(
  // `create` is written as a METHOD (not an arrow property) on purpose: method
  // parameters are checked bivariantly, so a concrete Prisma delegate is
  // assignable to this minimal structural type even under strictFunctionTypes.
  tx: { outboxEvent: { create(args: { data: object }): Promise<unknown> } },
  tenantId: string,
  topic: string,
  payload: object,
): Promise<void> {
  await tx.outboxEvent.create({
    data: { tenantId, topic, eventKey: tenantId, payload },
  });
}
