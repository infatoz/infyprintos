import mongoose from "mongoose";
import { z } from "zod";
import { ApiError } from "../../common/errors";
import { roundMoney } from "../../common/money";
import { withOptionalTransaction } from "../../common/transaction";
import { moveStock, transferStock, availableQty } from "../../common/inventory";
import { assertTaxIdentity } from "../customers/customer.helpers";
import {
  BillOfMaterials,
  InventoryCategory,
  InventoryItem,
  InventoryTransaction,
  InventoryType,
  StockReservation,
  Supplier,
  Unit
} from "../../models/Inventory";
import type { AuthUser } from "../../middleware/auth";
import { DEFAULT_INVENTORY_CATEGORIES, DEFAULT_INVENTORY_TYPES, slugifyInventory } from "./inventory.constants";

export const itemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1).optional(),
  category: z.string().optional(),
  categoryId: z.string().optional(),
  unit: z.string().optional(),
  reorderLevel: z.number().optional(),
  maxStock: z.number().optional(),
  costPerUnit: z.number().optional(),
  supplier: z.string().optional(),
  supplierId: z.string().optional(),
  batch: z.string().optional(),
  expiryDate: z.string().optional(),
  warehouse: z.string().optional(),
  bin: z.string().optional(),
  catalogItemId: z.string().optional(),
  openingQty: z.number().optional(),
  active: z.boolean().optional()
});

export const supplierSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  gstin: z.string().optional(),
  paymentTerms: z.string().optional(),
  leadTimeDays: z.number().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean().optional()
});

export const moveSchema = z.object({
  inventoryItemId: z.string(),
  type: z.string(),
  quantity: z.number(),
  unitCost: z.number().optional(),
  reason: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  warehouse: z.string().optional(),
  toInventoryItemId: z.string().optional(),
  targetQty: z.number().optional(),
  idempotencyKey: z.string().optional()
});

export const bomSchema = z.object({
  itemId: z.string(),
  variantId: z.string().optional(),
  wastePercent: z.number().min(0).optional(),
  materials: z
    .array(
      z.object({
        inventoryItemId: z.string(),
        quantityPerUnit: z.number().positive(),
        unit: z.string().optional(),
        formula: z.string().optional()
      })
    )
    .min(1),
  active: z.boolean().optional()
});

export function presentItem(item: { toObject?: () => Record<string, unknown>; stockQty?: number; reservedQty?: number; costPerUnit?: number; averageCost?: number }): Record<string, unknown> & {
  availableQty: number;
  valuation: number;
  stockQty: number;
  reservedQty: number;
  reorderLevel?: number;
  _id?: unknown;
} {
  const raw = (item.toObject?.() ?? item) as Record<string, unknown>;
  const stockQty = Number(raw.stockQty ?? 0);
  const reservedQty = Number(raw.reservedQty ?? 0);
  const cost = Number(raw.averageCost ?? raw.costPerUnit ?? 0);
  return {
    ...raw,
    stockQty,
    reservedQty,
    availableQty: stockQty - reservedQty,
    valuation: roundMoney(stockQty * cost)
  };
}

export async function explodeBom(opts: {
  organizationId: string;
  itemId: string;
  variantId?: string;
  quantity: number;
}) {
  const bom =
    (opts.variantId
      ? await BillOfMaterials.findOne({
          organizationId: opts.organizationId,
          itemId: opts.itemId,
          variantId: opts.variantId,
          active: true,
          deletedAt: null
        })
      : null) ||
    (await BillOfMaterials.findOne({
      organizationId: opts.organizationId,
      itemId: opts.itemId,
      $or: [{ variantId: null }, { variantId: { $exists: false } }],
      active: true,
      deletedAt: null
    }));
  if (!bom) return [];
  return bom.materials.map((mat: { inventoryItemId: unknown; quantityPerUnit: number; unit?: string }) => ({
    inventoryItemId: String(mat.inventoryItemId),
    quantity: roundMoney((mat.quantityPerUnit ?? 0) * opts.quantity * (1 + (bom.wastePercent ?? 0) / 100)),
    unit: mat.unit,
    wastePercent: bom.wastePercent ?? 0
  }));
}

export async function ensureUnits(organizationId: string) {
  const defaults = [
    { code: "PCS", name: "Pieces", allowDecimal: false },
    { code: "SQFT", name: "Square feet", allowDecimal: true },
    { code: "SHEET", name: "Sheet", allowDecimal: false },
    { code: "GRAM", name: "Gram", allowDecimal: true },
    { code: "KG", name: "Kilogram", allowDecimal: true },
    { code: "ROLL", name: "Roll", allowDecimal: true },
    { code: "MTR", name: "Metre", allowDecimal: true },
    { code: "LTR", name: "Litre", allowDecimal: true },
    { code: "ML", name: "Millilitre", allowDecimal: true },
    { code: "RIM", name: "Rim", allowDecimal: false }
  ];
  for (const unit of defaults) {
    await Unit.updateOne({ organizationId, code: unit.code }, { ...unit, organizationId }, { upsert: true });
  }
}

export async function reserveMaterials(
  user: AuthUser,
  lines: Array<{ inventoryItemId: string; quantity: number }>,
  ref: { orderId: string; orderItemId?: string },
  session?: mongoose.ClientSession
) {
  const results = [];
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const key = `reserve:${ref.orderId}:${line.inventoryItemId}`;
    const existing = await StockReservation.findOne({ organizationId: user.organizationId, idempotencyKey: key }).session(session ?? null);
    if (existing) {
      results.push({ reservation: existing, replayed: true });
      continue;
    }
    const moved = await moveStock({
      organizationId: user.organizationId,
      branchId: user.branchId,
      inventoryItemId: line.inventoryItemId,
      type: "reservation",
      quantity: line.quantity,
      referenceType: "Order",
      referenceId: ref.orderId,
      reason: `Reserve for order`,
      userId: user.id,
      idempotencyKey: key,
      session
    });
    const [reservation] = await StockReservation.create(
      [
        {
          organizationId: user.organizationId,
          branchId: user.branchId,
          inventoryItemId: line.inventoryItemId,
          orderId: ref.orderId,
          orderItemId: ref.orderItemId,
          quantity: line.quantity,
          remaining: line.quantity,
          status: "reserved",
          idempotencyKey: key
        }
      ],
      { session }
    );
    results.push({ reservation, moved, replayed: moved.replayed });
  }
  return results;
}

export async function consumeMaterials(
  user: AuthUser,
  lines: Array<{ inventoryItemId: string; quantity: number }>,
  ref: { orderId: string; orderItemId?: string; jobId?: string },
  session?: mongoose.ClientSession
) {
  const results = [];
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const key = `consume:${ref.jobId || ref.orderId}:${line.inventoryItemId}`;
    const moved = await moveStock({
      organizationId: user.organizationId,
      branchId: user.branchId,
      inventoryItemId: line.inventoryItemId,
      type: "production_consumption",
      quantity: line.quantity,
      referenceType: ref.jobId ? "ProductionJob" : "Order",
      referenceId: ref.jobId || ref.orderId,
      reason: "Production consumption",
      userId: user.id,
      idempotencyKey: key,
      consumeReserved: true,
      session
    });
    if (!moved.replayed) {
      const reservation = await StockReservation.findOne({
        organizationId: user.organizationId,
        orderId: ref.orderId,
        inventoryItemId: line.inventoryItemId,
        status: "reserved"
      }).session(session ?? null);
      if (reservation) {
        reservation.remaining = Math.max(0, Number(reservation.remaining) - line.quantity);
        if (reservation.remaining <= 0) reservation.status = "consumed";
        await reservation.save({ session });
      }
    }
    results.push(moved);
  }
  return results;
}

export async function releaseOrderReservations(user: AuthUser, orderId: string, session?: mongoose.ClientSession) {
  const rows = await StockReservation.find({
    organizationId: user.organizationId,
    orderId,
    status: "reserved",
    remaining: { $gt: 0 }
  }).session(session ?? null);
  const results = [];
  for (const row of rows) {
    const moved = await moveStock({
      organizationId: user.organizationId,
      branchId: user.branchId,
      inventoryItemId: String(row.inventoryItemId),
      type: "release",
      quantity: row.remaining,
      referenceType: "Order",
      referenceId: orderId,
      reason: "Release unused reservation",
      userId: user.id,
      idempotencyKey: `release:${orderId}:${String(row.inventoryItemId)}`,
      session
    });
    row.remaining = 0;
    row.status = "released";
    await row.save({ session });
    results.push(moved);
  }
  return results;
}

export async function postMovement(user: AuthUser, body: z.infer<typeof moveSchema>, idempotencyKey?: string) {
  const key = (idempotencyKey || body.idempotencyKey)?.trim();
  return withOptionalTransaction(async (session) => {
    if (body.type === "transfer") {
      if (!body.toInventoryItemId) throw ApiError.badRequest("Destination SKU required for transfer");
      return transferStock({
        organizationId: user.organizationId,
        branchId: user.branchId,
        inventoryItemId: body.inventoryItemId,
        toInventoryItemId: body.toInventoryItemId,
        type: "transfer",
        quantity: body.quantity,
        unitCost: body.unitCost,
        reason: body.reason,
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        userId: user.id,
        warehouse: body.warehouse,
        idempotencyKey: key,
        session
      });
    }
    let quantity = body.quantity;
    if (body.type === "reconciliation") {
      const item = await InventoryItem.findOne({
        _id: body.inventoryItemId,
        organizationId: user.organizationId,
        deletedAt: null
      }).session(session ?? null);
      if (!item) throw ApiError.notFound("Inventory item not found");
      if (body.targetQty == null) throw ApiError.badRequest("targetQty required for reconciliation");
      quantity = roundMoney(Number(body.targetQty) - Number(item.stockQty || 0));
      if (!quantity) {
        return { item: presentItem(item), replayed: true, transaction: null };
      }
    }
    const moved = await moveStock({
      organizationId: user.organizationId,
      branchId: user.branchId,
      inventoryItemId: body.inventoryItemId,
      type: body.type,
      quantity,
      unitCost: body.unitCost,
      reason: body.reason,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      userId: user.id,
      warehouse: body.warehouse,
      toInventoryItemId: body.toInventoryItemId,
      idempotencyKey: key,
      session
    });
    return { ...moved, item: presentItem(moved.item as { stockQty?: number; reservedQty?: number }) };
  });
}

export async function createInventoryItem(user: AuthUser, body: z.infer<typeof itemSchema>) {
  return withOptionalTransaction(async (session) => {
    await ensureInventoryTaxonomy(user.organizationId, user.branchId);
    const type = await assertInventoryType(user.organizationId, body.type || "raw_material");
    const category = await assertInventoryCategory(user.organizationId, body.categoryId, type.slug);
    if (body.supplierId) await assertSupplier(user.organizationId, body.supplierId);
    const [item] = await InventoryItem.create(
      [
        {
          ...body,
          type: type.slug,
          category: category?.name ?? body.category,
          categoryId: category?._id,
          expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
          organizationId: user.organizationId,
          branchId: user.branchId,
          stockQty: 0,
          reservedQty: 0,
          averageCost: body.costPerUnit ?? 0
        }
      ],
      { session }
    );
    if (body.openingQty) {
      await moveStock({
        organizationId: user.organizationId,
        branchId: user.branchId,
        inventoryItemId: String(item._id),
        type: "opening",
        quantity: body.openingQty,
        unitCost: body.costPerUnit,
        userId: user.id,
        reason: "Opening stock",
        idempotencyKey: `opening:${String(item._id)}`,
        session
      });
    }
    const fresh = await InventoryItem.findById(item._id).populate("supplierId categoryId").session(session ?? null);
    return presentItem(fresh!);
  });
}

export async function ensureInventoryTaxonomy(organizationId: string, branchId?: string) {
  for (const t of DEFAULT_INVENTORY_TYPES) {
    const exists = await InventoryType.findOne({ organizationId, slug: t.slug, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await InventoryType.create({ ...t, organizationId, branchId, active: true });
    } catch {
      /* concurrent seed */
    }
  }
  for (const c of DEFAULT_INVENTORY_CATEGORIES) {
    const exists = await InventoryCategory.findOne({ organizationId, slug: c.slug, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await InventoryCategory.create({ ...c, organizationId, branchId, active: true });
    } catch {
      /* concurrent seed */
    }
  }
}

async function assertInventoryType(organizationId: string, slug: string) {
  const type = await InventoryType.findOne({ organizationId, slug, deletedAt: null, active: true });
  if (!type) throw ApiError.unprocessable("Unknown inventory type");
  return type;
}

async function assertInventoryCategory(organizationId: string, categoryId?: string, typeSlug?: string) {
  if (!categoryId) return null;
  const cat = await InventoryCategory.findOne({ _id: categoryId, organizationId, deletedAt: null });
  if (!cat) throw ApiError.unprocessable("Category was not found");
  if (typeSlug && cat.type !== typeSlug) throw ApiError.unprocessable("Category does not belong to this type");
  return cat;
}

async function assertSupplier(organizationId: string, supplierId: string) {
  const row = await Supplier.findOne({ _id: supplierId, organizationId, deletedAt: null }).select("_id");
  if (!row) throw ApiError.unprocessable("Supplier was not found");
}

export async function listInventoryTypes(user: AuthUser) {
  await ensureInventoryTaxonomy(user.organizationId, user.branchId);
  return InventoryType.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder name");
}

export async function createInventoryType(user: AuthUser, body: { name: string; slug?: string; description?: string; defaultUnit?: string; sortOrder?: number; active?: boolean }) {
  const name = body.name.trim();
  if (name.length < 2) throw ApiError.unprocessable("Type name is required");
  const slug = slugifyInventory(body.slug || name);
  const exists = await InventoryType.findOne({ organizationId: user.organizationId, slug, deletedAt: null });
  if (exists) throw ApiError.conflict("A type with this name already exists");
  return InventoryType.create({
    name,
    slug,
    description: body.description?.trim() || undefined,
    defaultUnit: body.defaultUnit || "pcs",
    sortOrder: body.sortOrder ?? 200,
    system: false,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updateInventoryType(
  user: AuthUser,
  id: string,
  body: { name?: string; description?: string; defaultUnit?: string; sortOrder?: number; active?: boolean }
) {
  const row = await InventoryType.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Type not found");
  if (body.name) {
    const name = body.name.trim();
    if (name.length < 2) throw ApiError.unprocessable("Type name is required");
    row.name = name;
  }
  if (body.description !== undefined) row.description = body.description.trim() || undefined;
  if (body.defaultUnit) row.defaultUnit = body.defaultUnit;
  if (body.sortOrder != null) row.sortOrder = body.sortOrder;
  if (body.active != null) row.active = body.active;
  await row.save();
  return row;
}

export async function deleteInventoryType(user: AuthUser, id: string) {
  const row = await InventoryType.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Type not found");
  if (row.system) throw ApiError.conflict("System types cannot be deleted");
  const inUse = await InventoryItem.countDocuments({ organizationId: user.organizationId, type: row.slug, deletedAt: null });
  if (inUse) throw ApiError.conflict("Reassign stock items of this type first");
  const cats = await InventoryCategory.countDocuments({ organizationId: user.organizationId, type: row.slug, deletedAt: null });
  if (cats) throw ApiError.conflict("Move or delete categories of this type first");
  row.deletedAt = new Date();
  row.active = false;
  await row.save();
  return { id: String(row._id) };
}

export async function listInventoryCategories(user: AuthUser, type?: string) {
  await ensureInventoryTaxonomy(user.organizationId, user.branchId);
  const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
  if (type) filter.type = type;
  return InventoryCategory.find(filter).sort("sortOrder name");
}

export async function createInventoryCategory(
  user: AuthUser,
  body: { name: string; slug?: string; type: string; description?: string; sortOrder?: number; active?: boolean }
) {
  const name = body.name.trim();
  if (name.length < 2) throw ApiError.unprocessable("Category name is required");
  await ensureInventoryTaxonomy(user.organizationId, user.branchId);
  const type = await assertInventoryType(user.organizationId, body.type);
  const slug = slugifyInventory(body.slug || name);
  const exists = await InventoryCategory.findOne({ organizationId: user.organizationId, slug, deletedAt: null });
  if (exists) throw ApiError.conflict("A category with this name already exists");
  return InventoryCategory.create({
    name,
    slug,
    type: type.slug,
    description: body.description?.trim() || undefined,
    sortOrder: body.sortOrder ?? 200,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updateInventoryCategory(
  user: AuthUser,
  id: string,
  body: { name?: string; type?: string; description?: string; sortOrder?: number; active?: boolean }
) {
  const row = await InventoryCategory.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Category not found");
  if (body.name) {
    const name = body.name.trim();
    if (name.length < 2) throw ApiError.unprocessable("Category name is required");
    row.name = name;
  }
  if (body.type) {
    const type = await assertInventoryType(user.organizationId, body.type);
    row.type = type.slug;
  }
  if (body.description !== undefined) row.description = body.description.trim() || undefined;
  if (body.sortOrder != null) row.sortOrder = body.sortOrder;
  if (body.active != null) row.active = body.active;
  await row.save();
  return row;
}

export async function deleteInventoryCategory(user: AuthUser, id: string) {
  const row = await InventoryCategory.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Category not found");
  const inUse = await InventoryItem.countDocuments({ organizationId: user.organizationId, categoryId: row._id, deletedAt: null });
  if (inUse) throw ApiError.conflict("Move or delete stock items in this category first");
  row.deletedAt = new Date();
  row.active = false;
  await row.save();
  return { id: String(row._id) };
}

function supplierPayload(user: AuthUser, body: z.infer<typeof supplierSchema>, existing?: { code?: string }) {
  const phone = body.phone?.trim();
  const phoneDigits = phone ? phone.replace(/\D/g, "") : "";
  if (phone && phoneDigits.length !== 10) throw ApiError.unprocessable("Supplier phone must be 10 digits");
  const identity = assertTaxIdentity({ gstin: body.gstin });
  return {
    name: body.name.trim(),
    code: (body.code || existing?.code || "").trim().toUpperCase() || undefined,
    contactName: body.contactName?.trim() || undefined,
    phone: phone || undefined,
    phoneDigits: phoneDigits || undefined,
    email: body.email?.trim() || undefined,
    gstin: identity.gstin,
    paymentTerms: body.paymentTerms?.trim() || undefined,
    leadTimeDays: body.leadTimeDays ?? 0,
    address: body.address?.trim() || undefined,
    city: body.city?.trim() || undefined,
    state: body.state?.trim() || undefined,
    pincode: body.pincode?.trim() || undefined,
    notes: body.notes?.trim() || undefined,
    active: body.active !== false,
    organizationId: user.organizationId,
    branchId: user.branchId
  };
}

export async function createSupplier(user: AuthUser, body: z.infer<typeof supplierSchema>) {
  const count = await Supplier.countDocuments({ organizationId: user.organizationId });
  const payload = supplierPayload(user, body);
  if (!payload.code) payload.code = `SUP-${String(count + 1).padStart(4, "0")}`;
  return Supplier.create(payload);
}

export async function updateSupplier(user: AuthUser, id: string, body: z.infer<typeof supplierSchema>) {
  const row = await Supplier.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Supplier not found");
  const payload = supplierPayload(user, body, row);
  Object.assign(row, payload);
  await row.save();
  return row;
}

export async function patchInventoryItem(user: AuthUser, id: string, body: z.infer<typeof itemSchema>) {
  const item = await InventoryItem.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!item) throw ApiError.notFound("Inventory item not found");
  await ensureInventoryTaxonomy(user.organizationId, user.branchId);
  const nextType = body.type || item.type;
  const type = await assertInventoryType(user.organizationId, nextType);
  const category =
    body.categoryId !== undefined
      ? await assertInventoryCategory(user.organizationId, body.categoryId || undefined, type.slug)
      : item.categoryId
        ? await assertInventoryCategory(user.organizationId, String(item.categoryId), type.slug)
        : null;
  if (body.supplierId) await assertSupplier(user.organizationId, body.supplierId);
  if (body.sku) item.sku = body.sku;
  if (body.name) item.name = body.name;
  item.type = type.slug;
  if (body.categoryId !== undefined) {
    item.categoryId = category?._id;
    item.category = category?.name;
  } else if (body.category !== undefined) item.category = body.category;
  if (body.unit) item.unit = body.unit;
  if (body.reorderLevel != null) item.reorderLevel = body.reorderLevel;
  if (body.maxStock != null) item.maxStock = body.maxStock;
  if (body.costPerUnit != null) item.costPerUnit = body.costPerUnit;
  if (body.supplier !== undefined) item.supplier = body.supplier;
  if (body.supplierId !== undefined) item.supplierId = body.supplierId || undefined;
  if (body.batch !== undefined) item.batch = body.batch;
  if (body.expiryDate !== undefined) item.expiryDate = body.expiryDate ? new Date(body.expiryDate) : undefined;
  if (body.warehouse) item.warehouse = body.warehouse;
  if (body.bin !== undefined) item.bin = body.bin;
  if (body.active != null) item.active = body.active;
  await item.save();
  return presentItem(await InventoryItem.findById(item._id).populate("supplierId categoryId"));
}

export async function postWaste(
  user: AuthUser,
  body: { inventoryItemId: string; quantity: number; reason: string; kind?: "wastage" | "damaged"; idempotencyKey?: string }
) {
  const reason = body.reason.trim();
  if (reason.length < 3) throw ApiError.unprocessable("Waste reason is required");
  if (body.quantity <= 0) throw ApiError.unprocessable("Quantity must be greater than zero");
  return postMovement(
    user,
    {
      inventoryItemId: body.inventoryItemId,
      type: body.kind === "damaged" ? "damaged" : "wastage",
      quantity: body.quantity,
      reason
    },
    body.idempotencyKey
  );
}

export async function postConsumption(
  user: AuthUser,
  body: { inventoryItemId: string; quantity: number; reason: string; idempotencyKey?: string }
) {
  const reason = body.reason.trim();
  if (reason.length < 3) throw ApiError.unprocessable("Consumption reason is required");
  if (body.quantity <= 0) throw ApiError.unprocessable("Quantity must be greater than zero");
  return postMovement(
    user,
    {
      inventoryItemId: body.inventoryItemId,
      type: "outward",
      quantity: body.quantity,
      reason
    },
    body.idempotencyKey
  );
}

export async function usageReport(user: AuthUser, period: string) {
  const days = period === "monthly" ? 30 : period === "weekly" ? 7 : 1;
  const from = new Date(Date.now() - days * 86400000);
  const rows = await InventoryTransaction.aggregate([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(user.organizationId),
        createdAt: { $gte: from },
        type: { $in: ["outward", "production_consumption", "wastage", "damaged"] }
      }
    },
    {
      $group: {
        _id: { item: "$inventoryItemId", type: "$type" },
        quantity: { $sum: { $abs: "$quantity" } },
        cost: { $sum: { $multiply: [{ $abs: "$quantity" }, { $ifNull: ["$unitCost", 0] }] } }
      }
    }
  ]);
  const itemIds = [...new Set(rows.map((r) => String(r._id.item)))];
  const items = await InventoryItem.find({ _id: { $in: itemIds } }).select("name sku unit type");
  const byItem = new Map<
    string,
    {
      inventoryItemId: string;
      name?: string;
      sku?: string;
      unit?: string;
      itemType?: string;
      quantity: number;
      cost: number;
      consumption: number;
      wastage: number;
      damaged: number;
    }
  >();
  for (const r of rows) {
    const id = String(r._id.item);
    const item = items.find((i) => String(i._id) === id);
    const current = byItem.get(id) ?? {
      inventoryItemId: id,
      name: item?.name,
      sku: item?.sku,
      unit: item?.unit,
      itemType: item?.type,
      quantity: 0,
      cost: 0,
      consumption: 0,
      wastage: 0,
      damaged: 0
    };
    current.quantity += r.quantity;
    current.cost = roundMoney(current.cost + r.cost);
    if (r._id.type === "wastage") current.wastage += r.quantity;
    else if (r._id.type === "damaged") current.damaged += r.quantity;
    else current.consumption += r.quantity;
    byItem.set(id, current);
  }
  const named = [...byItem.values()].sort((a, b) => b.quantity - a.quantity);
  const totals = named.reduce(
    (s, r) => ({
      quantity: s.quantity + r.quantity,
      cost: roundMoney(s.cost + r.cost),
      consumption: s.consumption + r.consumption,
      wastage: s.wastage + r.wastage,
      damaged: s.damaged + r.damaged
    }),
    { quantity: 0, cost: 0, consumption: 0, wastage: 0, damaged: 0 }
  );
  return { period, from, rows: named, totals };
}

export { availableQty, Supplier };
