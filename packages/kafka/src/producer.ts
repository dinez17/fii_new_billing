import { Kafka, Producer, logLevel } from "kafkajs";

export function createKafka(clientId?: string): Kafka {
  return new Kafka({
    clientId: clientId ?? process.env.KAFKA_CLIENT_ID ?? "fii-billing",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8 },
  });
}

let producer: Producer | null = null;

/** Shared idempotent producer. Prefer the outbox relay for domain events. */
export async function getProducer(kafka?: Kafka): Promise<Producer> {
  if (producer) return producer;
  producer = (kafka ?? createKafka()).producer({ idempotent: true });
  await producer.connect();
  return producer;
}

export async function publish(
  topic: string,
  key: string,
  value: unknown,
): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic,
    messages: [{ key, value: JSON.stringify(value) }],
  });
}

export async function disconnectProducer(): Promise<void> {
  if (producer) { await producer.disconnect(); producer = null; }
}
