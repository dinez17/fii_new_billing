import { Kafka } from "kafkajs";
import { prisma } from "@fii/database";
import { createLogger } from "@fii/common";
import { createKafka } from "./producer.js";
import { dlqOf } from "./topics.js";
import type { EventEnvelope } from "./envelope.js";

export interface ConsumerOptions {
  groupId: string;
  topics: string[];
  /** Handler runs at-least-once; idempotency is handled here via ProcessedEvent. */
  handler: (topic: string, event: EventEnvelope) => Promise<void>;
  kafka?: Kafka;
  /** Read topic from the beginning on first start (safe: ProcessedEvent dedupes). */
  fromBeginning?: boolean;
}

/**
 * Idempotent consumer:
 * 1. Parse envelope; skip if (groupId, eventId) already in ProcessedEvent.
 * 2. Run handler.
 * 3. Record ProcessedEvent.
 * On handler failure after 3 attempts → publish to <topic>.dlq and continue.
 */
export async function runConsumer(opts: ConsumerOptions): Promise<() => Promise<void>> {
  const log = createLogger(`consumer:${opts.groupId}`);
  const kafka = opts.kafka ?? createKafka(opts.groupId);
  const consumer = kafka.consumer({ groupId: opts.groupId });
  const dlqProducer = kafka.producer();

  // ensure topics exist before subscribing (a missing topic can crash the
  // consumer group with UNKNOWN_TOPIC_OR_PARTITION)
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: opts.topics.map((topic) => ({ topic, numPartitions: 1 })),
      waitForLeaders: true,
    });
  } catch (err) {
    log.warn({ err: String(err) }, "topic ensure failed (may already exist)");
  } finally {
    await admin.disconnect().catch(() => undefined);
  }

  await Promise.all([consumer.connect(), dlqProducer.connect()]);
  for (const t of opts.topics) await consumer.subscribe({ topic: t, fromBeginning: opts.fromBeginning ?? false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const raw = message.value?.toString();
      if (!raw) return;

      let event: EventEnvelope;
      try {
        event = JSON.parse(raw);
      } catch {
        log.error({ topic }, "unparseable message → dlq");
        await dlqProducer.send({ topic: dlqOf(topic), messages: [{ value: raw }] });
        return;
      }

      const done = await prisma.processedEvent.findUnique({
        where: { consumerGroup_eventId: { consumerGroup: opts.groupId, eventId: event.eventId } },
      });
      if (done) return;

      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await opts.handler(topic, event);
          await prisma.processedEvent.create({
            data: { consumerGroup: opts.groupId, eventId: event.eventId },
          });
          return;
        } catch (err) {
          lastErr = err;
          log.warn({ topic, eventId: event.eventId, attempt, err: String(err) }, "handler failed");
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }

      log.error({ topic, eventId: event.eventId }, "exhausted retries → dlq");
      await dlqProducer.send({
        topic: dlqOf(topic),
        messages: [{ key: event.tenantId, value: JSON.stringify({ event, error: String(lastErr) }) }],
      });
    },
  });

  return async () => {
    await consumer.disconnect();
    await dlqProducer.disconnect();
  };
}
