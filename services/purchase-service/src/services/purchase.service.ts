import {sourceDocumentBody,decodePurchaseDocument} from "./purchase-document.js";
import { numberedDocumentIds, inDocumentOrder, Prisma, moneyAccount, allocateNumber, applyStock, prisma, rankParties, type PartyListQuery } from "@fii/database";
import { badRequest, encryptSecret, computePurchaseGst, isValidGstin, notFound, partyListFilters, transactionPeriodFilters } from "@fii/common";
import { TOPICS, makeEnvelope, writeOutbox } from "@fii/kafka";
import { z } from "zod";

// ── validators
export const supplierBody = z.object({
  name: z.string().min(2).max(150),
  gstin: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: z.string().max(15).optional(),
  address: z.string().max(500).optional(),
  stateCode: z.string().regex(/^[0-9]{2}$/).optional(),
  openingBalance: z.coerce.number().default(0), // +ve = we owe supplier
  isActive: z.boolean().optional(),
});

export const purchaseItem = z.object({
  hsnSac: z.string().regex(/^\d{4,8}$/).optional(),
  productId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  gstRate: z.coerce.number().min(0).max(28),
});

const purchaseDraftItem=purchaseItem.extend({
 productId:z.string().uuid().optional(),
 newProduct:z.object({name:z.string().trim().min(2).max(150),unit:z.string().trim().min(1).max(10).default("NOS"),isService:z.boolean().default(false)}).optional(),
}).refine(i=>!!i.productId!==!!i.newProduct,{message:"Choose an existing product or create a new one"});

export const purchaseInvoiceBody = z.object({
  pricesIncludeGst:z.boolean().default(false),
  taxRounding: z.enum(["PAISE","WHOLE_RUPEE"]).optional(),
  sourceDocument: sourceDocumentBody.extend({reviewed:z.literal(true)}).optional(),
  supplierId: z.string().uuid(),
  billNumber: z.string().min(1).max(50),
  roundOff: z.coerce.number().finite().min(-1).max(1).multipleOf(0.01).optional(),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  items: z.array(purchaseDraftItem).min(1).max(100),
  /** when billing a PO whose goods arrived via GRN, stock is NOT added again */
  purchaseOrderId: z.string().uuid().optional(),
});

export const supplierPaymentBody = z.object({
  supplierId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  financialAccountId: z.string().uuid().nullable().optional(),
  mode: z.enum(["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "CARD"]),
  paymentDate: z.coerce.date(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  allocations: z.array(z.object({
    purchaseInvoiceId: z.string().uuid(),
    amount: z.coerce.number().positive(),
  })).max(50).default([]),
}).superRefine((b, ctx) => {
  const sum = b.allocations.reduce((s, a) => s + a.amount, 0);
  if (sum > b.amount + 0.001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Allocations exceed payment amount" });
  }
  if ((b.mode === "CHEQUE" || b.mode === "BANK_TRANSFER") && !b.reference) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${b.mode} needs a reference` });
  }
});

export const purchaseReturnBody = z.object({
  purchaseInvoiceId: z.string().uuid(),
  returnDate: z.coerce.date(),
  reason: z.string().max(300).optional(),
  items: z.array(purchaseItem).min(1).max(100),
});

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  status: z.enum(["OUTSTANDING", "UNPAID", "PARTIAL", "PAID", "CANCELLED"]).optional(),
  ...transactionPeriodFilters,
});
export const supplierListQuery = pagination.extend(partyListFilters);

async function activeFy(tenantId: string, date: Date) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year");
  if (fy.isLocked) throw badRequest(`FY ${fy.code} is locked`);
  if (date < fy.startDate || date > fy.endDate) throw badRequest(`Date must fall inside FY ${fy.code}`);
  return fy;
}

// ── Suppliers
export async function listSuppliers(tenantId: string, q: PartyListQuery) {
  const ranked = await rankParties(tenantId, "SUPPLIER", q);
  const items = await prisma.supplier.findMany({
      where: { tenantId, id: { in: ranked.items.map((item) => item.id) } },
      include: { _count: { select: { purchaseInvoices: true } } },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const held = await prisma.legacyRecord.findMany({ where: { tenantId, status: "REVIEW", sourceTable: "user_purchase_bills" }, select: { data: true } });
  const heldByCode = new Map<string, number>();
  for (const row of held) {
    const source = row.data as Record<string, unknown> | null;
    if (source && typeof source.billto === "string") {
      const code = `LISOFT-S-${source.billto}`;
      heldByCode.set(code, (heldByCode.get(code) ?? 0) + 1);
    }
  }
  return { items: ranked.items.flatMap((rank) => {
    const item = byId.get(rank.id);
    return item ? [{ ...item, invoiceCount: rank.invoiceCount, currentOutstanding: rank.outstanding.toFixed(2), heldInvoiceCount: heldByCode.get(item.code) ?? 0 }] : [];
  }), total: ranked.total, page: q.page, limit: q.limit };
}

export async function createSupplier(tenantId: string, input: z.infer<typeof supplierBody>) {
  if (input.gstin && !isValidGstin(input.gstin, input.stateCode)) throw badRequest("Invalid GSTIN (or state mismatch)");
  return prisma.$transaction(async (tx) => {
    // supplier codes ride the permanent series
    const code = `SUP-${(await tx.supplier.count({ where: { tenantId } }) + 1).toString().padStart(5, "0")}`;
    return tx.supplier.create({
      data: { ...input, openingBalance: new Prisma.Decimal(input.openingBalance), tenantId, code },
    });
  });
}

export async function updateSupplier(tenantId: string, id: string, input: Partial<z.infer<typeof supplierBody>>) {
  const existing = await prisma.supplier.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("Supplier");
  if (input.gstin && !isValidGstin(input.gstin, input.stateCode ?? existing.stateCode ?? undefined)) {
    throw badRequest("Invalid GSTIN");
  }
  return prisma.supplier.update({
    where: { id },
    data: { ...input, openingBalance: input.openingBalance !== undefined ? new Prisma.Decimal(input.openingBalance) : undefined },
  });
}

export async function supplierLedger(tenantId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id, tenantId } });
  if (!supplier) throw notFound("Supplier");
  const entries = await prisma.ledgerEntry.findMany({
    where: { tenantId, partyType: "SUPPLIER", partyId: id },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  // supplier ledger: credit = we owe more, debit = we paid/returned
  let balance = Number(supplier.openingBalance);
  const rows = entries.map((e) => {
    balance += Number(e.credit) - Number(e.debit);
    return { ...e, balance: balance.toFixed(2) };
  });
  return {
    supplier: { id: supplier.id, name: supplier.name, code: supplier.code },
    openingBalance: Number(supplier.openingBalance).toFixed(2),
    entries: rows,
    outstanding: balance.toFixed(2), // +ve = payable to supplier
  };
}

// ── Purchase invoices
export async function createPurchaseInvoice(tenantId: string, actorId: string, input: z.infer<typeof purchaseInvoiceBody>) {
  const sourceDocument = input.sourceDocument ? decodePurchaseDocument(input.sourceDocument) : null;
  const fy = await activeFy(tenantId, input.invoiceDate);
  const [tenant, supplier] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId, isActive: true } }),
  ]);
  if (!supplier) throw notFound("Supplier");
  if (!tenant.stateCode) throw badRequest("Set company state code in Settings first");

  let po = null;
  if (input.purchaseOrderId) {
    po = await prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, tenantId, supplierId: supplier.id },
    });
    if (!po) throw notFound("Purchase order (for this supplier)");
    if (!["RECEIVED", "PARTIAL_RECEIVED"].includes(po.status)) {
      throw badRequest(`PO is ${po.status} — receive goods (GRN) before billing it`);
    }
  }

  const isInterState = (supplier.stateCode ?? tenant.stateCode) !== tenant.stateCode;
  const totals = computePurchaseGst(input.items, isInterState, input.taxRounding, input.pricesIncludeGst);
  const roundOff = new Prisma.Decimal(input.roundOff ?? totals.roundOff);
  const exact = new Prisma.Decimal(totals.taxableValue).add(totals.cgst).add(totals.sgst).add(totals.igst);
  totals.roundOff = roundOff.toFixed(2);
  totals.grandTotal = exact.add(roundOff).toFixed(2);
  if (new Prisma.Decimal(totals.grandTotal).isNegative()) throw badRequest("Round-off cannot make the bill total negative");

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize automatic product codes and name reuse within this tenant.
      if(input.items.some(i=>i.newProduct))await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId} FOR UPDATE`;
      if(po && input.items.some(i=>i.newProduct))throw badRequest("A received purchase order must use its existing products");
      const existing=await tx.product.findMany({where:{tenantId}});
      const normalized=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
      let nextSku=Math.max(1,...existing.filter(p=>/^PRD-\d+$/.test(p.sku)).map(p=>Number(p.sku.slice(4))+1));
      const resolvedItems=[];
      for(const item of input.items){
        let product=item.productId?existing.find(p=>p.id===item.productId):undefined;
        if(item.newProduct){
          if(!normalized(item.newProduct.name))throw badRequest("New product name needs letters or numbers");
          product=existing.find(p=>normalized(p.name)===normalized(item.newProduct!.name));
          if(product&&!product.isActive)throw badRequest(`Product "${product.name}" is inactive. Activate or select another product.`);
          if(!product){
            product=await tx.product.create({data:{tenantId,sku:`PRD-${String(nextSku++).padStart(5,"0")}`,name:item.newProduct.name,unit:item.newProduct.unit,isService:item.newProduct.isService,purchasePrice:input.pricesIncludeGst?new Prisma.Decimal(item.unitPrice).div(new Prisma.Decimal(1).add(new Prisma.Decimal(item.gstRate).div(100))).toDecimalPlaces(2):item.unitPrice,gstRate:item.gstRate,hsnSac:item.hsnSac}});
            existing.push(product);
            await tx.auditLog.create({data:{tenantId,userId:actorId,action:"PRODUCT_CREATED_FROM_PURCHASE",entity:"Product",entityId:product.id,after:{name:product.name,sku:product.sku,supplierBill:input.billNumber}}});
          }
        }
        if(!product||!product.isActive)throw notFound("Active product in this tenant");
        resolvedItems.push({...item,productId:product.id});
      }
      const productById=new Map(existing.map(p=>[p.id,p]));
      const ourNumber = await allocateNumber(tx, tenantId, "PURCHASE_INVOICE", fy.code);
      const pi = await tx.purchaseInvoice.create({
        data: {
          tenantId,
          sourceDocumentEncrypted: sourceDocument ? encryptSecret(JSON.stringify({fileName:sourceDocument.fileName,mimeType:sourceDocument.mimeType,base64:sourceDocument.base64})) : undefined,
          sourceDocumentHash: sourceDocument?.hash,
          billNumber: input.billNumber,
          ourNumber,
          fyCode: fy.code,
          supplierId: supplier.id,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          isInterState,
          subTotal: totals.subTotal,
          discountTotal: totals.discountTotal,
          taxableValue: totals.taxableValue,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          pricesIncludeGst:input.pricesIncludeGst,
          taxRounding:input.taxRounding??"PAISE",
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          status: "UNPAID",
          createdById: actorId,
          items: {
            create: resolvedItems.map((it, i) => ({
              productId: it.productId,
              hsnSac: it.hsnSac ?? productById.get(it.productId)!.hsnSac,
              quantity: new Prisma.Decimal(it.quantity),
              unitPrice: new Prisma.Decimal(it.unitPrice),
              discount: new Prisma.Decimal(it.discount),
              taxableValue: totals.lines[i].taxableValue,
              gstRate: new Prisma.Decimal(it.gstRate),
              cgst: totals.lines[i].cgst,
              sgst: totals.lines[i].sgst,
              igst: totals.lines[i].igst,
              lineTotal: totals.lines[i].lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      if (po) {
        // goods already stocked via GRN — just close the PO
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CLOSED" } });
      } else {
        // direct bill: stock IN per non-service item in the same tx
        for (const it of resolvedItems) {
          const product = productById.get(it.productId)!;
          if (product.isService) continue;
          await applyStock(tx, {
            tenantId, productId: it.productId, type: "PURCHASE_IN", quantity: it.quantity,
            refType: "PURCHASE_INVOICE", refId: pi.id, actorId,
          });
        }
      }

      await writeOutbox(tx, tenantId, TOPICS.PURCHASE_INVOICE_CREATED, makeEnvelope(tenantId, {
        purchaseInvoiceId: pi.id,
        ourNumber,
        billNumber: input.billNumber,
        supplierId: supplier.id,
        grandTotal: totals.grandTotal,
        invoiceDate: input.invoiceDate.toISOString(),
      }, { actorUserId: actorId }));

      if(sourceDocument)await tx.auditLog.create({data:{tenantId,userId:actorId,action:"PURCHASE_SOURCE_ATTACHED",entity:"PurchaseInvoice",entityId:pi.id,after:{fileName:sourceDocument.fileName,sizeBytes:sourceDocument.bytes.length,sha256:sourceDocument.hash,reviewed:true}}});
      const {sourceDocumentEncrypted,...result}=pi;
      return {...result,hasSourceDocument:!!sourceDocumentEncrypted};
    },{timeout:30_000});
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw badRequest(`Bill number "${input.billNumber}" or the uploaded file already exists for this supplier/tenant`);
    }
    throw err;
  }
}

export async function listPurchaseInvoices(tenantId: string, q: z.infer<typeof pagination>) {
  const where: Prisma.PurchaseInvoiceWhereInput = {
    tenantId,
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.from || q.to ? { invoiceDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.supplierId ? { supplierId: q.supplierId } : {}),
    ...(q.status ? { status: q.status === "OUTSTANDING" ? { in: ["UNPAID", "PARTIAL"] } : q.status } : {}),
    ...(q.search
      ? { OR: [{ ourNumber: { contains: q.search, mode: "insensitive" } }, { billNumber: { contains: q.search, mode: "insensitive" } }, { supplier: { name: { contains: q.search, mode: "insensitive" } } }] }
      : {}),
  };
  const ids=await numberedDocumentIds("PURCHASE",{...q,tenantId,statuses:q.status?(q.status=="OUTSTANDING"?["UNPAID","PARTIAL"]:[q.status]):undefined});
  const [items, total] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where:{AND:[where,{id:{in:ids}}]},
      select: {id:true,ourNumber:true,billNumber:true,invoiceDate:true,dueDate:true,fyCode:true,supplierId:true,taxableValue:true,cgst:true,sgst:true,igst:true,roundOff:true,grandTotal:true,amountPaid:true,status:true,sourceDocumentHash:true,supplier:{select:{id:true,name:true}}},
    }),
    prisma.purchaseInvoice.count({ where }),
  ]);
  return { items:inDocumentOrder(items,ids).map(item=>({...item,hasSourceDocument:!!item.sourceDocumentHash})), total, page: q.page, limit: q.limit };
}

export async function getPurchaseInvoice(tenantId: string, id: string) {
  const pi = await prisma.purchaseInvoice.findFirst({
    where: { id, tenantId },
    include: {
      supplier: true,
      items: { include: { product: { select: { name: true, sku: true, unit: true } } } },
      payments: { include: { supplierPayment: true } },
      returns: true,
    },
  });
  if (!pi) throw notFound("Purchase invoice");
  const {sourceDocumentEncrypted,...result}=pi;
  return {...result,hasSourceDocument:!!sourceDocumentEncrypted};
}

// ── Supplier payments
export async function createSupplierPayment(tenantId: string, actorId: string, input: z.infer<typeof supplierPaymentBody>) {
  const fy = await activeFy(tenantId, input.paymentDate);
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId } });
  if (!supplier) throw notFound("Supplier");

  return prisma.$transaction(async (tx) => {
    const voucherNumber = await allocateNumber(tx, tenantId, "PAYMENT_VOUCHER", fy.code);
    const payment = await tx.supplierPayment.create({
      data: {
        tenantId, voucherNumber, fyCode: fy.code, supplierId: supplier.id,
        financialAccountId: await moneyAccount(tx,tenantId,input.financialAccountId,input.mode),
        amount: new Prisma.Decimal(input.amount), mode: input.mode,
        paymentDate: input.paymentDate, reference: input.reference, notes: input.notes,
        createdById: actorId,
      },
    });

    for (const alloc of input.allocations) {
      const pi = await tx.purchaseInvoice.findFirst({
        where: { id: alloc.purchaseInvoiceId, tenantId, supplierId: supplier.id },
      });
      if (!pi) throw notFound(`Purchase invoice ${alloc.purchaseInvoiceId}`);
      if (pi.status === "CANCELLED") throw badRequest(`${pi.ourNumber} is cancelled`);
      const balance = Number(pi.grandTotal) - Number(pi.amountPaid);
      if (alloc.amount > balance + 0.001) {
        throw badRequest(`₹${alloc.amount} exceeds balance ₹${balance.toFixed(2)} on ${pi.ourNumber}`);
      }
      await tx.supplierPaymentAllocation.create({
        data: { supplierPaymentId: payment.id, purchaseInvoiceId: pi.id, amount: new Prisma.Decimal(alloc.amount) },
      });
      const newPaid = Number(pi.amountPaid) + alloc.amount;
      await tx.purchaseInvoice.update({
        where: { id: pi.id },
        data: {
          amountPaid: new Prisma.Decimal(newPaid),
          status: newPaid >= Number(pi.grandTotal) - 0.001 ? "PAID" : "PARTIAL",
        },
      });
    }

    await writeOutbox(tx, tenantId, TOPICS.SUPPLIER_PAYMENT_PAID, makeEnvelope(tenantId, {
      supplierPaymentId: payment.id, voucherNumber, supplierId: supplier.id,
      amount: input.amount.toFixed(2), mode: input.mode, paymentDate: input.paymentDate.toISOString(),
    }, { actorUserId: actorId }));

    return payment;
  });
}

export async function listSupplierPayments(tenantId: string, q: z.infer<typeof pagination>) {
  const where: Prisma.SupplierPaymentWhereInput = {
    tenantId,
    ...(q.supplierId ? { supplierId: q.supplierId } : {}),
    ...(q.search ? { OR: [{ voucherNumber: { contains: q.search, mode: "insensitive" } }, { supplier: { name: { contains: q.search, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.supplierPayment.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { paymentDate: "desc" },
      include: {
        supplier: { select: { name: true } },
        allocations: { include: { purchaseInvoice: { select: { ourNumber: true } } } },
      },
    }),
    prisma.supplierPayment.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

// ── Purchase returns
export async function createPurchaseReturn(tenantId: string, actorId: string, input: z.infer<typeof purchaseReturnBody>) {
  const fy = await activeFy(tenantId, input.returnDate);
  const pi = await prisma.purchaseInvoice.findFirst({
    where: { id: input.purchaseInvoiceId, tenantId },
    include: { items: true },
  });
  if (!pi) throw notFound("Purchase invoice");
  if (pi.status === "CANCELLED") throw badRequest("Invoice is cancelled");

  // returned qty per product must not exceed purchased qty
  for (const it of input.items) {
    const bought = pi.items.filter((x) => x.productId === it.productId)
      .reduce((s, x) => s + Number(x.quantity), 0);
    if (it.quantity > bought) throw badRequest(`Returning more than purchased for a product (${it.quantity} > ${bought})`);
  }

  const totals = computePurchaseGst(input.items, pi.isInterState, pi.taxRounding==="WHOLE_RUPEE"?"WHOLE_RUPEE":"PAISE",pi.pricesIncludeGst);

  return prisma.$transaction(async (tx) => {
    const returnNumber = await allocateNumber(tx, tenantId, "PURCHASE_INVOICE", `${fy.code}-RET`);
    const ret = await tx.purchaseReturn.create({
      data: {
        tenantId, returnNumber, fyCode: fy.code,
        purchaseInvoiceId: pi.id, supplierId: pi.supplierId,
        returnDate: input.returnDate, reason: input.reason,
        items: input.items as unknown as Prisma.InputJsonValue,
        taxableValue: totals.taxableValue,
        totalGst: (Number(totals.cgst) + Number(totals.sgst) + Number(totals.igst)).toFixed(2),
        total: totals.grandTotal,
      },
    });

    for (const it of input.items) {
      await applyStock(tx, {
        tenantId, productId: it.productId, type: "PURCHASE_RETURN_OUT", quantity: it.quantity,
        refType: "PURCHASE_RETURN", refId: ret.id, reason: input.reason, actorId,
      });
    }

    await writeOutbox(tx, tenantId, TOPICS.PURCHASE_RETURN_CREATED, makeEnvelope(tenantId, {
      purchaseReturnId: ret.id, returnNumber, supplierId: pi.supplierId,
      total: totals.grandTotal, returnDate: input.returnDate.toISOString(),
      againstInvoice: pi.ourNumber,
    }, { actorUserId: actorId }));

    return ret;
  });
}

export async function listPurchaseReturns(tenantId: string, q: z.infer<typeof pagination>) {
  const where: Prisma.PurchaseReturnWhereInput = {
    tenantId,
    ...(q.fyCode ? { fyCode: q.fyCode } : {}),
    ...(q.from || q.to ? { returnDate: { gte: q.from, lte: q.to } } : {}),
    ...(q.supplierId ? { supplierId: q.supplierId } : {}),
    ...(q.search ? { OR: [{ returnNumber: { contains: q.search, mode: "insensitive" } }, { supplier: { name: { contains: q.search, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.purchaseReturn.findMany({
      where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { returnDate: "desc" },
      include: {
        supplier: { select: { name: true } },
        purchaseInvoice: { select: { ourNumber: true, billNumber: true } },
      },
    }),
    prisma.purchaseReturn.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}
