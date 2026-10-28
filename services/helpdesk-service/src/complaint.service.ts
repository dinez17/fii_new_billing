import { Prisma, allocateNumber, prisma } from "@fii/database";
import { badRequest, notFound } from "@fii/common";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import { z } from "zod";

export const complaintCreateBody = z.object({
  customerId: z.string().uuid(),
  subscriberId: z.string().uuid().optional(),
  type: z.string().min(2).max(50), // NO_SIGNAL, SLOW_SPEED, BILLING_ISSUE, RELOCATION, OTHER
  subject: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  slaHours: z.coerce.number().int().min(1).max(720).default(24),
});

export const portalComplaintBody = complaintCreateBody.omit({ customerId: true, priority: true, slaHours: true });

export const assignBody = z.object({ employeeId: z.string().uuid() });

export const statusBody = z.object({
  status: z.enum(["IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"]),
  notes: z.string().max(1000).optional(),
});

export const attachmentBody = z.object({
  fileName: z.string().min(1).max(150),
  dataUrl: z.string().regex(/^data:(image\/(png|jpeg)|application\/pdf);base64,/).max(700_000),
});

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedToId: z.string().uuid().optional(),
});

// legal transitions (assignment moves OPEN→ASSIGNED separately)
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD", "RESOLVED"],
  IN_PROGRESS: ["ON_HOLD", "RESOLVED"],
  ON_HOLD: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // reopen allowed
  CLOSED: [],
};

export async function createComplaint(
  tenantId: string,
  actorId: string | null,
  source: "STAFF" | "PORTAL",
  input: z.infer<typeof complaintCreateBody>,
) {
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId } });
  if (!customer) throw notFound("Customer");

  return prisma.$transaction(async (tx) => {
    const complaintNumber = await allocateNumber(tx, tenantId, "COMPLAINT", "PERM");
    const dueAt = new Date(Date.now() + input.slaHours * 3_600_000);
    const complaint = await tx.complaint.create({
      data: {
        tenantId,
        complaintNumber,
        customerId: customer.id,
        subscriberId: input.subscriberId,
        type: input.type,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        status: "OPEN",
        slaHours: input.slaHours,
        dueAt,
        source,
        createdById: actorId,
        history: { create: { toStatus: "OPEN", changedById: actorId, notes: `created via ${source.toLowerCase()}` } },
      },
    });
    await writeOutbox(tx, tenantId, TOPICS.COMPLAINT_CREATED, makeEnvelope(tenantId, {
      complaintId: complaint.id,
      complaintNumber,
      customerId: customer.id,
      subject: input.subject,
      priority: input.priority,
    }, { actorUserId: actorId ?? undefined }));
    return complaint;
  });
}

export async function listComplaints(tenantId: string, q: z.infer<typeof listQuery>) {
  const where: Prisma.ComplaintWhereInput = {
    tenantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
    ...(q.search
      ? {
          OR: [
            { complaintNumber: { contains: q.search, mode: "insensitive" } },
            { subject: { contains: q.search, mode: "insensitive" } },
            { customer: { name: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.complaint.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        assignedTo: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.complaint.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

export async function getComplaint(tenantId: string, id: string, customerId?: string) {
  const complaint = await prisma.complaint.findFirst({
    where: { id, tenantId, ...(customerId ? { customerId } : {}) },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      assignedTo: { select: { id: true, name: true, code: true, phone: true } },
      history: { orderBy: { createdAt: "asc" } },
      attachments: { select: { id: true, fileName: true, createdAt: true } },
      tasks: { include: { assignedTo: { select: { name: true } } } },
    },
  });
  if (!complaint) throw notFound("Complaint");
  return complaint;
}

export async function assignComplaint(tenantId: string, actorId: string, id: string, employeeId: string) {
  const [complaint, employee] = await Promise.all([
    prisma.complaint.findFirst({ where: { id, tenantId } }),
    prisma.employee.findFirst({ where: { id: employeeId, tenantId, status: "ACTIVE" } }),
  ]);
  if (!complaint) throw notFound("Complaint");
  if (!employee) throw notFound("Active employee");
  if (["RESOLVED", "CLOSED"].includes(complaint.status)) throw badRequest(`Complaint is ${complaint.status}`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id },
      data: {
        assignedToId: employeeId,
        assignedAt: new Date(),
        status: complaint.status === "OPEN" ? "ASSIGNED" : complaint.status,
        history: {
          create: {
            fromStatus: complaint.status,
            toStatus: complaint.status === "OPEN" ? "ASSIGNED" : complaint.status,
            changedById: actorId,
            notes: `assigned to ${employee.name}`,
          },
        },
      },
    });
    await writeOutbox(tx, tenantId, TOPICS.COMPLAINT_ASSIGNED, makeEnvelope(tenantId, {
      complaintId: id,
      complaintNumber: complaint.complaintNumber,
      customerId: complaint.customerId,
      employeeId,
      employeeName: employee.name,
      employeeEmail: employee.email,
      subject: complaint.subject,
    }, { actorUserId: actorId }));
    return updated;
  });
}

export async function changeStatus(
  tenantId: string,
  actorId: string,
  id: string,
  status: "IN_PROGRESS" | "ON_HOLD" | "RESOLVED" | "CLOSED",
  notes?: string,
) {
  const complaint = await prisma.complaint.findFirst({ where: { id, tenantId } });
  if (!complaint) throw notFound("Complaint");
  if (!TRANSITIONS[complaint.status].includes(status)) {
    throw badRequest(`Cannot move from ${complaint.status.replace(/_/g, " ")} to ${status.replace(/_/g, " ")}`);
  }
  if (status === "RESOLVED" && !notes) throw badRequest("Resolution notes are required to resolve");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id },
      data: {
        status,
        ...(status === "RESOLVED" ? { resolvedAt: new Date(), resolutionNotes: notes } : {}),
        ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
        history: { create: { fromStatus: complaint.status, toStatus: status, changedById: actorId, notes } },
      },
    });
    if (status === "RESOLVED") {
      await writeOutbox(tx, tenantId, TOPICS.COMPLAINT_RESOLVED, makeEnvelope(tenantId, {
        complaintId: id,
        complaintNumber: complaint.complaintNumber,
        customerId: complaint.customerId,
        subject: complaint.subject,
        resolutionNotes: notes ?? "",
      }, { actorUserId: actorId }));
    }
    return updated;
  });
}

export async function addAttachment(tenantId: string, actorId: string | null, id: string, fileName: string, dataUrl: string, customerId?: string) {
  const complaint = await prisma.complaint.findFirst({
    where: { id, tenantId, ...(customerId ? { customerId } : {}) },
  });
  if (!complaint) throw notFound("Complaint");
  return prisma.complaintAttachment.create({
    data: { complaintId: id, fileName, fileUrl: dataUrl, uploadedById: actorId },
    select: { id: true, fileName: true, createdAt: true },
  });
}

export async function getAttachment(tenantId: string, complaintId: string, attachmentId: string) {
  const att = await prisma.complaintAttachment.findFirst({
    where: { id: attachmentId, complaint: { id: complaintId, tenantId } },
  });
  if (!att) throw notFound("Attachment");
  return att;
}

// ── Reports
export async function dailyReport(tenantId: string, days = 30) {
  const from = new Date(Date.now() - days * 86_400_000);
  const complaints = await prisma.complaint.findMany({
    where: { tenantId, createdAt: { gte: from } },
    select: { createdAt: true, status: true, resolvedAt: true },
  });
  const byDay = new Map<string, { created: number; resolved: number }>();
  for (const c of complaints) {
    const day = c.createdAt.toISOString().slice(0, 10);
    const row = byDay.get(day) ?? { created: 0, resolved: 0 };
    row.created++;
    byDay.set(day, row);
    if (c.resolvedAt) {
      const rd = c.resolvedAt.toISOString().slice(0, 10);
      const rrow = byDay.get(rd) ?? { created: 0, resolved: 0 };
      rrow.resolved++;
      byDay.set(rd, rrow);
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
}

export async function employeePendingReport(tenantId: string) {
  const rows = await prisma.complaint.groupBy({
    by: ["assignedToId"],
    where: { tenantId, status: { in: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } },
    _count: true,
  });
  const ids = rows.map((r) => r.assignedToId).filter((x): x is string => !!x);
  const employees = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } });
  const byId = new Map(employees.map((e) => [e.id, e]));
  return rows.map((r) => ({
    employee: r.assignedToId ? byId.get(r.assignedToId) ?? null : null,
    pending: r._count,
  })).sort((a, b) => b.pending - a.pending);
}

export async function slaReport(tenantId: string, days = 30) {
  const from = new Date(Date.now() - days * 86_400_000);
  const resolved = await prisma.complaint.findMany({
    where: { tenantId, resolvedAt: { not: null, gte: from } },
    select: { complaintNumber: true, subject: true, slaHours: true, createdAt: true, resolvedAt: true },
    orderBy: { resolvedAt: "desc" },
    take: 200,
  });
  const rows = resolved.map((c) => {
    const hours = (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 3_600_000;
    return {
      complaintNumber: c.complaintNumber,
      subject: c.subject,
      slaHours: c.slaHours,
      resolutionHours: Number(hours.toFixed(1)),
      withinSla: hours <= c.slaHours,
    };
  });
  const openOverdue = await prisma.complaint.count({
    where: { tenantId, status: { notIn: ["RESOLVED", "CLOSED"] }, dueAt: { lt: new Date() } },
  });
  const within = rows.filter((r) => r.withinSla).length;
  return {
    summary: {
      resolvedCount: rows.length,
      withinSla: within,
      slaPercent: rows.length ? Number(((within / rows.length) * 100).toFixed(1)) : 100,
      avgResolutionHours: rows.length ? Number((rows.reduce((s, r) => s + r.resolutionHours, 0) / rows.length).toFixed(1)) : 0,
      openOverdue,
    },
    rows,
  };
}
