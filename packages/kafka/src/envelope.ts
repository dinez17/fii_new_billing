import { v4 as uuid } from "uuid";

export interface EventEnvelope<T = unknown> {
  eventId: string;
  tenantId: string;
  occurredAt: string; // ISO
  actorUserId: string | null;
  version: number;
  payload: T;
}

export function makeEnvelope<T>(
  tenantId: string,
  payload: T,
  opts?: { actorUserId?: string; version?: number },
): EventEnvelope<T> {
  return {
    eventId: uuid(),
    tenantId,
    occurredAt: new Date().toISOString(),
    actorUserId: opts?.actorUserId ?? null,
    version: opts?.version ?? 1,
    payload,
  };
}
