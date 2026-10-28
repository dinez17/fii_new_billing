/* eslint-disable no-console */
/**
 * Bulk-seed subscribers for load testing the billing worker.
 *
 *   COUNT=10000 TENANT_ID=<uuid> pnpm loadtest:seed
 *
 * Creates COUNT customers, each with one ACTIVE monthly subscriber mapped to an
 * active plan. IDs are generated client-side so we can wire the relations in a
 * few createMany batches instead of round-tripping per row. Re-runnable: pass
 * START to offset the numbering and avoid phone/code collisions.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@fii/database";

const COUNT = Number(process.env.COUNT ?? 10_000);
const START = Number(process.env.START ?? 0);
const CHUNK = 1_000;

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function main() {
  const tenant = process.env.TENANT_ID
    ? await prisma.tenant.findUnique({ where: { id: process.env.TENANT_ID } })
    : await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) throw new Error("No tenant found — set TENANT_ID or seed the demo tenant first");

  let plan = await prisma.plan.findFirst({ where: { tenantId: tenant.id, isActive: true } });
  if (!plan) {
    plan = await prisma.plan.create({
      data: { tenantId: tenant.id, name: "Load Test 100Mbps", code: "LT-100", price: 500, gstRate: 18, hsnSac: "998422", billingCycleMonths: 1 },
    });
  }

  console.log(`Seeding ${COUNT} subscribers for tenant ${tenant.name} on plan ${plan.code}…`);
  const now = new Date();

  const customers: { id: string; tenantId: string; code: string; name: string; phone: string }[] = [];
  const subscribers: { id: string; tenantId: string; customerId: string; code: string; billingCycleMonths: number; status: "ACTIVE"; activationDate: Date }[] = [];
  const maps: { id: string; tenantId: string; subscriberId: string; planId: string; startDate: Date }[] = [];

  for (let i = START; i < START + COUNT; i++) {
    const cid = randomUUID();
    const sid = randomUUID();
    const seq = String(i).padStart(7, "0");
    customers.push({ id: cid, tenantId: tenant.id, code: `LTC-${seq}`, name: `Load Sub ${seq}`, phone: `9${String(100000000 + i).slice(-9)}` });
    subscribers.push({ id: sid, tenantId: tenant.id, customerId: cid, code: `LTS-${seq}`, billingCycleMonths: 1, status: "ACTIVE", activationDate: now });
    maps.push({ id: randomUUID(), tenantId: tenant.id, subscriberId: sid, planId: plan.id, startDate: now });
  }

  const t0 = Date.now();
  for (const c of chunk(customers, CHUNK)) await prisma.customer.createMany({ data: c, skipDuplicates: true });
  for (const s of chunk(subscribers, CHUNK)) await prisma.subscriber.createMany({ data: s, skipDuplicates: true });
  for (const m of chunk(maps, CHUNK)) await prisma.subscriberPlan.createMany({ data: m, skipDuplicates: true });

  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Total active subscribers now: ${await prisma.subscriber.count({ where: { tenantId: tenant.id, status: "ACTIVE" } })}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
