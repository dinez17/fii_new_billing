import { Prisma } from "@prisma/client";
import type { StockMoveType } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface StockMoveInput {
  tenantId: string;
  productId: string;
  type: StockMoveType;
  quantity: number; // always positive; type gives direction
  refType?: string;
  refId?: string;
  reason?: string;
  actorId?: string | null;
}

const IN_TYPES: StockMoveType[] = ["PURCHASE_IN", "ADJUST_IN", "OPENING"];

export class StockError extends Error {
  readonly statusCode = 409;
  readonly code = "INSUFFICIENT_STOCK";
  readonly details?: unknown;
  constructor(message: string) { super(message); this.name = "StockError"; }
}

/**
 * Applies a stock movement atomically INSIDE an existing transaction:
 * updates the denormalized Product.stockQty and records the StockMovement
 * audit row with balanceAfter. Outward movements honor the tenant policy.
 * Returns { balanceAfter, reorderLevel } so callers can raise low-stock events.
 */
export async function applyStock(tx: Tx, input: StockMoveInput): Promise<{ balanceAfter: number; reorderLevel: number; crossedReorder: boolean }> {
  if (input.quantity <= 0) throw new Error("stock quantity must be positive");
  const direction = IN_TYPES.includes(input.type) ? 1 : -1;
  const delta = direction * input.quantity;

  // Lock before reading so concurrent sales cannot overwrite a stock balance.
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;

  const product = await tx.product.findFirst({
    where: { id: input.productId, tenantId: input.tenantId },
  });
  if (!product) throw new Error("Product not found");
  if (product.isService) throw new Error(`"${product.name}" is a service — no stock tracking`);

  const before = Number(product.stockQty);
  const after = before + delta;
  if (direction < 0 && after < -0.0001) {
    const setting = await tx.setting.findUnique({
      where: { tenantId_group_key: { tenantId: input.tenantId, group: "INVENTORY", key: "allowNegativeStock" } },
    });
    if (setting?.value !== "true") {
      throw new StockError(`Insufficient stock for "${product.name}" — available ${before}, required ${input.quantity}. Negative stock is disabled in Settings → Inventory.`);
    }
  }

  await tx.product.update({
    where: { id: product.id },
    data: { stockQty: new Prisma.Decimal(after) },
  });
  await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      productId: product.id,
      type: input.type,
      quantity: new Prisma.Decimal(input.quantity),
      balanceAfter: new Prisma.Decimal(after),
      refType: input.refType,
      refId: input.refId,
      reason: input.reason,
      createdById: input.actorId ?? undefined,
    },
  });

  const reorderLevel = Number(product.reorderLevel);
  return {
    balanceAfter: after,
    reorderLevel,
    crossedReorder: reorderLevel > 0 && before > reorderLevel && after <= reorderLevel,
  };
}
