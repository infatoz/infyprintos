import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { roundMoney } from "../../common/money";
import {
  BillOfMaterials,
  InventoryItem,
  InventoryTransaction,
  StockReservation,
  Supplier,
  Unit
} from "../../models/Inventory";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requireAny, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import {
  bomSchema,
  createInventoryCategory,
  createInventoryItem,
  createInventoryType,
  createSupplier,
  deleteInventoryCategory,
  deleteInventoryType,
  ensureUnits,
  explodeBom,
  itemSchema,
  listInventoryCategories,
  listInventoryTypes,
  moveSchema,
  patchInventoryItem,
  postConsumption,
  postMovement,
  postWaste,
  presentItem,
  supplierSchema,
  updateInventoryCategory,
  updateInventoryType,
  updateSupplier,
  usageReport
} from "./inventory.service";

const router = Router();
router.use(authenticate);

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.get(
  "/units",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    await ensureUnits(user.organizationId);
    return ok(res, await Unit.find({ organizationId: user.organizationId, deletedAt: null, active: true }).sort("code"));
  })
);

router.post(
  "/units",
  requirePermission("inventory.adjust"),
  validate(z.object({ code: z.string(), name: z.string(), allowDecimal: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const unit = await Unit.create({
      ...req.body,
      code: String(req.body.code).toUpperCase(),
      organizationId: user.organizationId,
      branchId: user.branchId
    });
    return created(res, unit);
  })
);

router.get(
  "/types",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await listInventoryTypes(user));
  })
);

router.post(
  "/types",
  requirePermission("inventory.adjust"),
  validate(z.object({ name: z.string().min(2), slug: z.string().optional(), description: z.string().optional(), defaultUnit: z.string().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const type = await createInventoryType(user, req.body);
    await writeAudit(req as AuthedRequest, "inventory.type.create", "InventoryType", String(type._id));
    return created(res, type);
  })
);

router.patch(
  "/types/:id",
  requirePermission("inventory.adjust"),
  validate(z.object({ name: z.string().min(2).optional(), description: z.string().optional(), defaultUnit: z.string().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const type = await updateInventoryType(user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "inventory.type.update", "InventoryType", String(type._id));
    return ok(res, type);
  })
);

router.delete(
  "/types/:id",
  requirePermission("inventory.adjust"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const result = await deleteInventoryType(user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "inventory.type.delete", "InventoryType", result.id);
    return ok(res, result);
  })
);

router.get(
  "/categories",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await listInventoryCategories(user, req.query.type ? String(req.query.type) : undefined));
  })
);

router.post(
  "/categories",
  requirePermission("inventory.adjust"),
  validate(z.object({ name: z.string().min(2), slug: z.string().optional(), type: z.string().min(1), description: z.string().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const category = await createInventoryCategory(user, req.body);
    await writeAudit(req as AuthedRequest, "inventory.category.create", "InventoryCategory", String(category._id));
    return created(res, category);
  })
);

router.patch(
  "/categories/:id",
  requirePermission("inventory.adjust"),
  validate(z.object({ name: z.string().min(2).optional(), type: z.string().optional(), description: z.string().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const category = await updateInventoryCategory(user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "inventory.category.update", "InventoryCategory", String(category._id));
    return ok(res, category);
  })
);

router.delete(
  "/categories/:id",
  requirePermission("inventory.adjust"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const result = await deleteInventoryCategory(user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "inventory.category.delete", "InventoryCategory", result.id);
    return ok(res, result);
  })
);

router.get(
  "/suppliers",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    const search = String(req.query.search ?? "").trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: rx }, { code: rx }, { phone: rx }, { gstin: rx }, { contactName: rx }];
    }
    return ok(res, await Supplier.find(filter).sort("name"));
  })
);

router.post(
  "/suppliers",
  requireAny("inventory.adjust", "inventory.purchase"),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const supplier = await createSupplier(user, req.body);
    await writeAudit(req as AuthedRequest, "supplier.create", "Supplier", String(supplier._id));
    return created(res, supplier);
  })
);

router.patch(
  "/suppliers/:id",
  requireAny("inventory.adjust", "inventory.purchase"),
  validate(supplierSchema.partial()),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const existing = await Supplier.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!existing) throw ApiError.notFound("Supplier not found");
    const supplier = await updateSupplier(user, paramId(req.params.id), {
      name: req.body.name ?? existing.name,
      code: req.body.code ?? existing.code,
      contactName: req.body.contactName ?? existing.contactName,
      phone: req.body.phone ?? existing.phone,
      email: req.body.email ?? existing.email,
      gstin: req.body.gstin ?? existing.gstin,
      paymentTerms: req.body.paymentTerms ?? existing.paymentTerms,
      leadTimeDays: req.body.leadTimeDays ?? existing.leadTimeDays,
      address: req.body.address ?? existing.address,
      city: req.body.city ?? existing.city,
      state: req.body.state ?? existing.state,
      pincode: req.body.pincode ?? existing.pincode,
      notes: req.body.notes ?? existing.notes,
      active: req.body.active ?? existing.active
    });
    return ok(res, supplier);
  })
);

router.get(
  "/items",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (search) {
      filter.$or = [{ name: new RegExp(escapeRegex(search), "i") }, { sku: new RegExp(escapeRegex(search), "i") }];
    }
    if (req.query.type) filter.type = req.query.type;
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.supplierId) filter.supplierId = req.query.supplierId;
    if (req.query.warehouse) filter.warehouse = req.query.warehouse;
    if (req.query.lowStock === "true") filter.$expr = { $lte: ["$stockQty", "$reorderLevel"] };
    const [rows, total] = await Promise.all([
      InventoryItem.find(filter).populate("supplierId", "name").populate("categoryId", "name slug type").skip(skip).limit(limit).sort(safeSort(sort, ["name", "sku", "stockQty", "availableQty", "createdAt"], "name")),
      InventoryItem.countDocuments(filter)
    ]);
    return paginated(res, rows.map(presentItem), { page, limit, total });
  })
);

router.get(
  "/items/:id",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await InventoryItem.findOne({
      _id: paramId(req.params.id),
      organizationId: user.organizationId,
      deletedAt: null
    }).populate("supplierId catalogItemId categoryId");
    if (!item) throw ApiError.notFound("Inventory item not found");
    const [ledger, reservations] = await Promise.all([
      InventoryTransaction.find({ organizationId: user.organizationId, inventoryItemId: item._id }).sort("-createdAt").limit(20).populate("userId", "name"),
      StockReservation.find({ organizationId: user.organizationId, inventoryItemId: item._id, status: "reserved" })
    ]);
    return ok(res, { item: presentItem(item), ledger, reservations });
  })
);

router.post(
  "/items",
  requirePermission("inventory.adjust"),
  validate(itemSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await createInventoryItem(user, req.body);
    await writeAudit(req as AuthedRequest, "inventory.item.create", "InventoryItem", String(item._id));
    return created(res, item);
  })
);

router.patch(
  "/items/:id",
  requirePermission("inventory.adjust"),
  validate(itemSchema.partial()),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await patchInventoryItem(user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "inventory.item.update", "InventoryItem", paramId(req.params.id));
    return ok(res, item);
  })
);

router.post(
  "/move",
  requireAny("inventory.adjust", "inventory.purchase"),
  validate(moveSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    if (req.body.type === "purchase" && !user.permissions.includes("inventory.purchase") && user.roleSlug !== "owner") {
      if (!user.permissions.includes("inventory.adjust")) throw ApiError.forbidden();
    }
    const idempotencyKey = String(req.get("Idempotency-Key") ?? req.body.idempotencyKey ?? "");
    const result = await postMovement(user, req.body, idempotencyKey || undefined);
    if (!("replayed" in result && result.replayed)) {
      await writeAudit(req as AuthedRequest, `inventory.${req.body.type}`, "InventoryItem", req.body.inventoryItemId);
    }
    return ok(res, result);
  })
);

router.post(
  "/waste",
  requirePermission("inventory.adjust"),
  validate(z.object({ inventoryItemId: z.string(), quantity: z.number(), reason: z.string().min(3), kind: z.enum(["wastage", "damaged"]).optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const idempotencyKey = String(req.get("Idempotency-Key") ?? "");
    const result = await postWaste(user, { ...req.body, idempotencyKey: idempotencyKey || undefined });
    await writeAudit(req as AuthedRequest, "inventory.waste", "InventoryItem", req.body.inventoryItemId);
    return ok(res, result);
  })
);

router.post(
  "/consumption",
  requireAny("inventory.adjust", "inventory.purchase"),
  validate(z.object({ inventoryItemId: z.string(), quantity: z.number(), reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const idempotencyKey = String(req.get("Idempotency-Key") ?? "");
    const result = await postConsumption(user, { ...req.body, idempotencyKey: idempotencyKey || undefined });
    await writeAudit(req as AuthedRequest, "inventory.consumption", "InventoryItem", req.body.inventoryItemId);
    return ok(res, result);
  })
);

router.get(
  "/transactions",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.inventoryItemId) filter.inventoryItemId = req.query.inventoryItemId;
    const search = String(req.query.search ?? "").trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ reason: rx }, { type: rx }];
    }
    const [rows, total] = await Promise.all([
      InventoryTransaction.find(filter).populate("inventoryItemId", "name sku unit").populate("userId", "name").skip(skip).limit(limit).sort(safeSort(sort, ["createdAt", "quantity", "type"], "-createdAt")),
      InventoryTransaction.countDocuments(filter)
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/ledger/:itemId",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip } = parsePagination(req);
    const item = await InventoryItem.findOne({
      _id: paramId(req.params.itemId),
      organizationId: user.organizationId,
      deletedAt: null
    });
    if (!item) throw ApiError.notFound("Inventory item not found");
    const filter = { organizationId: user.organizationId, inventoryItemId: item._id };
    const [rows, total] = await Promise.all([
      InventoryTransaction.find(filter).populate("userId", "name").skip(skip).limit(limit).sort("-createdAt"),
      InventoryTransaction.countDocuments(filter)
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/reservations",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const filter: Record<string, unknown> = { organizationId: user.organizationId };
    if (req.query.orderId) filter.orderId = req.query.orderId;
    if (req.query.status) filter.status = req.query.status;
    return ok(res, await StockReservation.find(filter).populate("inventoryItemId", "name sku unit").sort("-createdAt"));
  })
);

router.get(
  "/bom",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(
      res,
      await BillOfMaterials.find({ organizationId: user.organizationId, deletedAt: null }).populate("itemId materials.inventoryItemId")
    );
  })
);

router.post(
  "/bom",
  requirePermission("inventory.adjust"),
  validate(bomSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const bom = await BillOfMaterials.create({ ...req.body, organizationId: user.organizationId, branchId: user.branchId });
    await writeAudit(req as AuthedRequest, "bom.create", "BillOfMaterials", String(bom._id));
    return created(res, bom);
  })
);

router.patch(
  "/bom/:id",
  requirePermission("inventory.adjust"),
  validate(bomSchema.partial()),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const bom = await BillOfMaterials.findOneAndUpdate(
      { _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null },
      req.body,
      { new: true }
    );
    if (!bom) throw ApiError.notFound("BOM not found");
    await writeAudit(req as AuthedRequest, "bom.update", "BillOfMaterials", String(bom._id));
    return ok(res, bom);
  })
);

router.post(
  "/bom/explode",
  requireAny("inventory.view", "production.view", "orders.view"),
  validate(z.object({ itemId: z.string(), variantId: z.string().optional(), quantity: z.number().positive() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const lines = await explodeBom({ organizationId: user.organizationId, ...req.body });
    const withStock = await Promise.all(
      lines.map(async (line: { inventoryItemId: string; quantity: number; unit?: string; wastePercent?: number }) => {
        const item = await InventoryItem.findById(line.inventoryItemId);
        return {
          ...line,
          name: item?.name,
          sku: item?.sku,
          availableQty: item ? Number(item.stockQty) - Number(item.reservedQty) : 0,
          short: item ? Number(item.stockQty) - Number(item.reservedQty) < line.quantity : true
        };
      })
    );
    return ok(res, withStock);
  })
);

router.get(
  "/alerts",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const items = await InventoryItem.find({ organizationId: user.organizationId, deletedAt: null, active: true });
    const low = items.filter((i) => Number(i.stockQty) <= Number(i.reorderLevel || 0)).map(presentItem);
    const out = items.filter((i) => Number(i.stockQty) <= 0).map(presentItem);
    return ok(res, { lowStock: low, outOfStock: out });
  })
);

router.get(
  "/usage",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await usageReport(user, String(req.query.period ?? "daily")));
  })
);

router.get(
  "/analytics",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const items = await InventoryItem.find({ organizationId: user.organizationId, deletedAt: null });
    const presented = items.map(presentItem);
    const valuation = presented.reduce((s, i) => s + Number(i.valuation || 0), 0);
    const low = presented.filter((i) => Number(i.stockQty) <= Number(i.reorderLevel || 0));
    const out = presented.filter((i) => Number(i.stockQty) <= 0);
    const reserved = presented.reduce((s, i) => s + Number(i.reservedQty || 0), 0);
    const weekly = await usageReport(user, "weekly");
    return ok(res, {
      skuCount: items.length,
      valuation: roundMoney(valuation),
      lowStock: low.length,
      outOfStock: out.length,
      reserved,
      lowStockItems: low,
      weeklyConsumption: weekly.totals.consumption,
      weeklyWaste: weekly.totals.wastage + weekly.totals.damaged,
      weeklyUsageCost: weekly.totals.cost
    });
  })
);

export default router;
