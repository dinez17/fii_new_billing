import { Prisma, allocateNumber, applyStock, prisma } from "@fii/database";
import { badRequest, notFound, transactionPeriodFilters } from "@fii/common";
import { z } from "zod";

export const poBody = z.object({
  supplierId: z.string().uuid(),
  orderDate: z.coerce.date(),
  expectedDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    gstRate: z.coerce.number().min(0).max(28),
  })).min(1).max(100),
});

export const grnBody = z.object({
  purchaseOrderId: z.string().uuid(),
  receivedDate: z.coerce.date(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().positive(),
  })).min(1).max(100),
});

export const poListQuery = z.object({
  ...transactionPeriodFilters,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["DRAFT", "SENT", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]).optional(),
});

async function activeFy(tenantId: string, date: Date) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year");
  if (fy.isLocked) throw badRequest(`FY ${fy.code} is locked`);
  if (date < fy.startDate || date > fy.endDate) throw badRequest(`Date must fall inside FY ${fy.code}`);
  return fy;
}

export async function createPo(tenantId: string, actorId: string, input: z.infer<typeof poBody>) {
  const fy = await activeFy(tenantId, input.orderDate);
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId, isActive: true } });
  if (!supplier) throw notFound("Supplier");
  const products = await prisma.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, tenantId },
  });
  if (products.length !== new Set(input.items.map((i) => i.productId)).size) throw notFound("Product");

  const total = input.items.reduce((s, it) => {
    const base = it.quantity * it.unitPrice;
    return s + base + (base * it.gstRate) / 100;
  }, 0);

  return prisma.$transaction(async (tx) => {
    const poNumber = await allocateNumber(tx, tenantId, "PURCHASE_ORDER", fy.code);
    return tx.purchaseOrder.create({
      data: {
        tenantId,
        poNumber,
        fyCode: fy.code,
        supplierId: supplier.id,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate,
        status: "DRAFT",
        total: new Prisma.Decimal(total.toFixed(2)),
        notes: input.notes,
        createdById: actorId,
        items: {
          create: input.items.map((it) => ({
            productId: it.productId,
            quantity: new Prisma.Decimal(it.quantity),
            unitPrice: new Prisma.Decimal(it.unitPrice),
            gstRate: new Prisma.Decimal(it.gstRate),
            lineTotal: new Prisma.Decimal((it.quantity * it.unitPrice * (1 + it.gstRate / 100)).toFixed(2)),
          })),
        },
      },
      include: { items: true },
    });
  });
}

export async function listPos(tenantId: string, q: z.infer<typeof poListQuery>) {
  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId,
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.from || q.to ? { orderDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? { OR: [{ poNumber: { contains: q.search, mode: "insensitive" } }, { supplier: { name: { contains: q.search, mode: "insensitive" } } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { orderDate: "desc" },
      include: { supplier: { select: { id: true, name: true } } },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

export async function getPo(tenantId: string, id: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId },
    include: {
      supplier: true,
      items: { include: { product: { select: { name: true, sku: true, unit: true } } } },
      grns: { orderBy: { receivedDate: "desc" } },
    },
  });
  if (!po) throw notFound("Purchase order");
  return po;
}

export async function setPoStatus(tenantId: string, id: string, status: "SENT" | "CANCELLED" | "CLOSED") {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, tenantId } });
  if (!po) throw notFound("Purchase order");
  const allowed: Record<string, string[]> = {
    SENT: ["DRAFT"],
    CANCELLED: ["DRAFT", "SENT"],
    CLOSED: ["RECEIVED", "PARTIAL_RECEIVED"],
  };
  if (!allowed[status].includes(po.status)) throw badRequest(`Cannot mark ${po.status} PO as ${status}`);
  return prisma.purchaseOrder.update({ where: { id }, data: { status } });
}

/** Goods receipt: stock IN + received-qty bookkeeping + PO status roll-up. */
export async function createGrn(tenantId: string, actorId: string, input: z.infer<typeof grnBody>) {
  const fy = await activeFy(tenantId, input.receivedDate);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, tenantId },
    include: { items: true },
  });
  if (!po) throw notFound("Purchase order");
  if (!["SENT", "PARTIAL_RECEIVED"].includes(po.status)) {
    throw badRequest(`PO is ${po.status} — only SENT / PARTIAL RECEIVED orders can receive goods`);
  }

  // validate against outstanding quantities
  const itemByProduct = new Map(po.items.map((i) => [i.productId, i]));
  for (const rec of input.items) {
    const poItem = itemByProduct.get(rec.productId);
    if (!poItem) throw badRequest("Product is not on this PO");
    const outstanding = Number(poItem.quantity) - Number(poItem.receivedQty);
    if (rec.quantity > outstanding + 0.001) {
      throw badRequest(`Receiving ${rec.quantity} but only ${outstanding} outstanding for a product`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const grnNumber = await allocateNumber(tx, tenantId, "GRN", fy.code);
    const grn = await tx.grn.create({
      data: {
        tenantId,
        grnNumber,
        purchaseOrderId: po.id,
        receivedDate: input.receivedDate,
        notes: input.notes,
        items: input.items as unknown as Prisma.InputJsonValue,
        createdById: actorId,
      },
    });

    for (const rec of input.items) {
      const poItem = itemByProduct.get(rec.productId)!;
      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { receivedQty: new Prisma.Decimal(Number(poItem.receivedQty) + rec.quantity) },
      });
      await applyStock(tx, {
        tenantId, productId: rec.productId, type: "PURCHASE_IN", quantity: rec.quantity,
        refType: "GRN", refId: grn.id, actorId,
      });
    }

    // roll up PO status
    const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
    const fullyReceived = updatedItems.every((i) => Number(i.receivedQty) >= Number(i.quantity) - 0.001);
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: fullyReceived ? "RECEIVED" : "PARTIAL_RECEIVED" },
    });

    return grn;
  });
}
