import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { AppError, badRequest, conflict, createLogger, notFound, httpMetrics, mountOps, bulkImportBody, importRows } from "@fii/common";
import { authenticate, authorize } from "@fii/auth";
import { Prisma, applyStock, prisma, StockError } from "@fii/database";
import { TOPICS, makeEnvelope, startOutboxRelay } from "@fii/kafka";

const log = createLogger("inventory-service");

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten().fieldErrors);
  return r.data;
}

const productBody = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional(),
  hsnSac: z.string().max(10).optional(),
  unit: z.string().max(10).default("NOS"),
  purchasePrice: z.coerce.number().min(0).default(0),
  salePrice: z.coerce.number().min(0).default(0),
  gstRate: z.coerce.number().min(0).max(28).default(18),
  reorderLevel: z.coerce.number().min(0).default(0),
  isService: z.boolean().default(false),
  openingStock: z.coerce.number().min(0).optional(), // create only
  isActive: z.boolean().optional(),
});

const adjustBody = z.object({
  productId: z.string().uuid(),
  direction: z.enum(["IN", "OUT"]),
  quantity: z.coerce.number().positive(),
  reason: z.string().min(3).max(300),
});

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  lowStock: z.coerce.boolean().default(false),
});

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("inventory-service"));
app.get("/healthz", (_req, res) => res.json({ ok: true, service: "inventory-service" }));
mountOps(app, { name: "inventory-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

// ── Products
app.get("/api/v1/products", authenticate, authorize("product:read"), h(async (req, res) => {
  const q = parse(pagination, req.query);
  const where: Prisma.ProductWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(q.search
      ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { sku: { contains: q.search, mode: "insensitive" } }] }
      : {}),
  };
  const [all, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: "asc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.product.count({ where }),
  ]);
  const items = q.lowStock
    ? all.filter((p) => !p.isService && Number(p.reorderLevel) > 0 && Number(p.stockQty) <= Number(p.reorderLevel))
    : all;
  res.json({ items, total, page: q.page, limit: q.limit });
}));

async function createProduct(tenantId: string, actorId: string, b: z.infer<typeof productBody>) {
  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          tenantId,
          sku: b.sku.toUpperCase(),
          name: b.name,
          description: b.description,
          hsnSac: b.hsnSac,
          unit: b.unit,
          purchasePrice: new Prisma.Decimal(b.purchasePrice),
          salePrice: new Prisma.Decimal(b.salePrice),
          gstRate: new Prisma.Decimal(b.gstRate),
          reorderLevel: new Prisma.Decimal(b.reorderLevel),
          isService: b.isService,
        },
      });
      if (b.openingStock && !b.isService) {
        await applyStock(tx, {
          tenantId,
          productId: created.id,
          type: "OPENING",
          quantity: b.openingStock,
          refType: "OPENING",
          reason: "opening stock",
          actorId,
        });
      }
      return tx.product.findUniqueOrThrow({ where: { id: created.id } });
    });
    return product;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw badRequest("SKU already exists");
    }
    throw err;
  }
}

app.post("/api/v1/products/import", authenticate, authorize("product:create"), h(async (req, res) => {
  const input = parse(bulkImportBody, req.body);
  const tenantId = req.auth!.tenantId;
  res.json(await importRows({ ...input, schema: productBody,
    validate: async (row) => {
      if (await prisma.product.findFirst({ where: { tenantId, sku: row.sku.toUpperCase() } })) throw conflict("Product SKU already exists");
    },
    create: (row) => createProduct(tenantId, req.auth!.sub, row),
  }));
}));

app.get("/api/v1/products/:id", authenticate, authorize("product:read"), h(async (req, res) => {
  const product = await prisma.product.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!product) throw notFound("Product");
  res.json(product);
}));

app.post("/api/v1/products", authenticate, authorize("product:create"), h(async (req, res) => {
  res.status(201).json(await createProduct(req.auth!.tenantId, req.auth!.sub, parse(productBody, req.body)));
}));

app.put("/api/v1/products/:id", authenticate, authorize("product:update"), h(async (req, res) => {
  const b = parse(productBody.partial(), req.body);
  const product = await prisma.product.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!product) throw notFound("Product");
  res.json(await prisma.product.update({
    where: { id: product.id },
    data: {
      ...b,
      sku: b.sku?.toUpperCase(),
      openingStock: undefined,
      purchasePrice: b.purchasePrice !== undefined ? new Prisma.Decimal(b.purchasePrice) : undefined,
      salePrice: b.salePrice !== undefined ? new Prisma.Decimal(b.salePrice) : undefined,
      gstRate: b.gstRate !== undefined ? new Prisma.Decimal(b.gstRate) : undefined,
      reorderLevel: b.reorderLevel !== undefined ? new Prisma.Decimal(b.reorderLevel) : undefined,
    } as Prisma.ProductUpdateInput,
  }));
}));

// ── Stock adjustments + movements
app.post("/api/v1/stock-adjustments", authenticate, authorize("stock:update"), h(async (req, res) => {
  const b = parse(adjustBody, req.body);
  const result = await prisma.$transaction(async (tx) => {
    const r = await applyStock(tx, {
      tenantId: req.auth!.tenantId,
      productId: b.productId,
      type: b.direction === "IN" ? "ADJUST_IN" : "ADJUST_OUT",
      quantity: b.quantity,
      refType: "ADJUSTMENT",
      reason: b.reason,
      actorId: req.auth!.sub,
    });
    if (r.crossedReorder) {
      await tx.outboxEvent.create({
        data: {
          tenantId: req.auth!.tenantId,
          topic: TOPICS.STOCK_UPDATED,
          eventKey: req.auth!.tenantId,
          payload: makeEnvelope(req.auth!.tenantId, {
            productId: b.productId, balance: r.balanceAfter, reorderLevel: r.reorderLevel, lowStock: true,
          }) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return r;
  });
  res.json({ ok: true, balanceAfter: result.balanceAfter });
}));

app.get("/api/v1/stock-movements", authenticate, authorize("stock:read"), h(async (req, res) => {
  const q = parse(z.object({
    productId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }), req.query);
  res.json(await prisma.stockMovement.findMany({
    where: { tenantId: req.auth!.tenantId, productId: q.productId },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  }));
}));

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: { code: "CONFLICT", message: "Product SKU already exists" } }); return;
  }
  if (err instanceof AppError || err instanceof StockError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  log.error({ err: String(err), path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: String(err).slice(0, 200) } });
});

const stopRelay = startOutboxRelay();
process.on("SIGINT", () => { stopRelay(); process.exit(0); });

const port = Number(process.env.INVENTORY_SERVICE_PORT ?? 8086);
app.listen(port, () => log.info({ port }, "inventory-service listening"));
