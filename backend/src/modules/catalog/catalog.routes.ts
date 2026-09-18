import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { Category, Item, ItemVariant, PriceList } from "../../models/Catalog";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import { catalogUpload } from "../../middleware/upload";
import { resolveUnitPrice } from "../../common/pricing";
import { HSN_PATTERN, SAC_PATTERN } from "./catalog.constants";
import {
  addItemGallery,
  attachResolvedPrices,
  clearCategoryImage,
  clearItemCover,
  createCatalogType,
  createCategory,
  deleteCatalogItem,
  deleteCatalogType,
  deleteCategory,
  listCatalogTypes,
  listCatalogUnits,
  removeItemGalleryUrl,
  saveCatalogItem,
  setCategoryImage,
  setItemCover,
  updateCatalogType,
  updateCategory
} from "./catalog.service";

const router = Router();
router.use(authenticate);

const optionalCode = (pattern: RegExp, message: string) =>
  z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .refine((v) => !v || pattern.test(v), message);

const variantSchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1),
  sku: z.string().optional(),
  salesPrice: z.coerce.number().optional(),
  cost: z.coerce.number().optional(),
  barcode: z.string().optional(),
  active: z.boolean().optional(),
  options: z.record(z.unknown()).optional()
});

const priceSchema = z.object({
  variantId: z.string().optional(),
  variantIndex: z.coerce.number().int().min(0).optional(),
  tierId: z.string().optional(),
  minQty: z.coerce.number().positive().optional(),
  maxQty: z.coerce.number().positive().optional(),
  price: z.coerce.number().nonnegative()
});

const itemSchema = z.object({
  name: z.string().trim().min(2, "Item name is required"),
  sku: z.string().optional(),
  itemType: z.string().optional(),
  categoryId: z.string().optional(),
  brand: z.string().optional(),
  salesPrice: z.coerce.number().nonnegative({ message: "List price is required" }),
  originalPrice: z.coerce.number().nonnegative().optional(),
  baseCost: z.coerce.number().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxInclusive: z.boolean().optional(),
  unit: z.string().optional(),
  barcode: z.string().optional(),
  requiresDesign: z.boolean().optional(),
  trackInventory: z.boolean().optional(),
  description: z.string().optional(),
  hsn: optionalCode(HSN_PATTERN, "HSN must be 4–8 digits"),
  sac: optionalCode(SAC_PATTERN, "SAC must be 4–6 digits"),
  minQty: z.coerce.number().optional(),
  maxQty: z.coerce.number().optional(),
  allowDecimalQty: z.boolean().optional(),
  active: z.boolean().optional(),
  variantOptions: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).optional(),
  variants: z.array(variantSchema).optional(),
  prices: z.array(priceSchema).optional()
});

const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required"),
  slug: z.string().optional(),
  parentId: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  sortOrder: z.coerce.number().optional(),
  active: z.boolean().optional()
});

const typeSchema = z.object({
  name: z.string().trim().min(2, "Type name is required"),
  slug: z.string().optional(),
  description: z.string().optional(),
  defaultUnit: z.string().optional(),
  requiresDesign: z.boolean().optional(),
  trackInventory: z.boolean().optional(),
  sortOrder: z.coerce.number().optional(),
  active: z.boolean().optional()
});

router.get(
  "/categories",
  requirePermission("catalog.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await Category.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder name"));
  })
);

router.post(
  "/categories",
  requirePermission("catalog.create"),
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const category = await createCategory(user, req.body);
    await writeAudit(req as AuthedRequest, "catalog.category.create", "Category", String(category._id), null, category);
    return created(res, category);
  })
);

router.patch(
  "/categories/:id",
  requirePermission("catalog.delete"),
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const category = await updateCategory(user, String(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "catalog.category.update", "Category", String(category._id));
    return ok(res, category);
  })
);

router.delete(
  "/categories/:id",
  requirePermission("catalog.delete"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const result = await deleteCategory(user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "catalog.category.delete", "Category", result.id);
    return ok(res, result);
  })
);

router.post(
  "/categories/:id/image",
  requirePermission("catalog.update"),
  catalogUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.unprocessable("Choose a category image");
    const { user } = req as AuthedRequest;
    const category = await setCategoryImage(user, String(req.params.id), req.file);
    await writeAudit(req as AuthedRequest, "catalog.category.image", "Category", String(category._id));
    return ok(res, category);
  })
);

router.delete(
  "/categories/:id/image",
  requirePermission("catalog.update"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const category = await clearCategoryImage(user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "catalog.category.image.remove", "Category", String(category._id));
    return ok(res, category);
  })
);

router.get(
  "/types",
  requirePermission("catalog.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await listCatalogTypes(user));
  })
);

router.get("/units", requirePermission("catalog.view"), asyncHandler(async (_req, res) => ok(res, listCatalogUnits())));

router.post(
  "/types",
  requirePermission("catalog.delete"),
  validate(typeSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const type = await createCatalogType(user, req.body);
    await writeAudit(req as AuthedRequest, "catalog.type.create", "CatalogType", String(type._id), null, type);
    return created(res, type);
  })
);

router.patch(
  "/types/:id",
  requirePermission("catalog.delete"),
  validate(typeSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const type = await updateCatalogType(user, String(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "catalog.type.update", "CatalogType", String(type._id));
    return ok(res, type);
  })
);

router.delete(
  "/types/:id",
  requirePermission("catalog.delete"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const result = await deleteCatalogType(user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "catalog.type.delete", "CatalogType", result.id);
    return ok(res, result);
  })
);

router.get(
  "/items",
  requirePermission("catalog.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (search) {
      const exact = search.trim();
      filter.$or = [
        { name: new RegExp(escapeRegex(search), "i") },
        { sku: new RegExp(escapeRegex(search), "i") },
        { barcode: new RegExp(escapeRegex(search), "i") },
        { sku: exact },
        { barcode: exact }
      ];
    }
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.itemType) filter.itemType = req.query.itemType;
    if (req.query.active === "true") filter.active = true;
    const [rows, total] = await Promise.all([
      Item.find(filter).populate("categoryId").skip(skip).limit(limit).sort(safeSort(sort, ["name", "sku", "salesPrice", "createdAt"], "name")),
      Item.countDocuments(filter)
    ]);
    const variants = await ItemVariant.find({ itemId: { $in: rows.map((r) => r._id) }, deletedAt: null, active: true });
    const grouped = new Map<string, typeof variants>();
    for (const v of variants) {
      const key = String(v.itemId);
      const list = grouped.get(key) ?? [];
      list.push(v);
      grouped.set(key, list);
    }
    const plain = rows.map((row) => ({
      ...row.toObject(),
      variants: (grouped.get(String(row._id)) ?? []).map((v) => v.toObject())
    }));
    const tierId = typeof req.query.tierId === "string" && req.query.tierId ? req.query.tierId : undefined;
    const qty = Number(req.query.qty ?? 1) || 1;
    const data = await attachResolvedPrices(user.organizationId, plain, tierId, qty);
    return paginated(res, data, { page, limit, total });
  })
);

router.get(
  "/items/:id",
  requirePermission("catalog.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await Item.findOne({ _id: req.params.id, organizationId: user.organizationId, deletedAt: null });
    if (!item) throw ApiError.notFound("Item not found");
    const [variants, prices] = await Promise.all([
      ItemVariant.find({ itemId: item._id, deletedAt: null }),
      PriceList.find({ itemId: item._id, deletedAt: null })
    ]);
    return ok(res, { item, variants, prices });
  })
);

router.post(
  "/items",
  requirePermission("catalog.create"),
  validate(itemSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const saved = await saveCatalogItem(user, req.body);
    await writeAudit(req as AuthedRequest, "catalog.item.create", "Item", String(saved.item._id), null, { sku: saved.item.sku });
    return created(res, saved);
  })
);

router.patch(
  "/items/:id",
  requirePermission("catalog.update"),
  validate(itemSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const saved = await saveCatalogItem(user, req.body, String(req.params.id));
    await writeAudit(req as AuthedRequest, "catalog.item.update", "Item", String(saved.item._id));
    return ok(res, saved);
  })
);

router.delete(
  "/items/:id",
  requirePermission("catalog.delete"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const result = await deleteCatalogItem(user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "catalog.item.delete", "Item", result.id);
    return ok(res, result);
  })
);

router.post(
  "/items/:id/image",
  requirePermission("catalog.update"),
  catalogUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.unprocessable("Choose a product image");
    const { user } = req as AuthedRequest;
    const item = await setItemCover(user, String(req.params.id), req.file);
    await writeAudit(req as AuthedRequest, "catalog.item.image", "Item", String(item._id));
    return ok(res, item);
  })
);

router.delete(
  "/items/:id/image",
  requirePermission("catalog.update"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await clearItemCover(user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "catalog.item.image.remove", "Item", String(item._id));
    return ok(res, item);
  })
);

router.post(
  "/items/:id/gallery",
  requirePermission("catalog.update"),
  catalogUpload.array("files", 8),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const { user } = req as AuthedRequest;
    const item = await addItemGallery(user, String(req.params.id), files);
    await writeAudit(req as AuthedRequest, "catalog.item.gallery", "Item", String(item._id));
    return ok(res, item);
  })
);

router.delete(
  "/items/:id/gallery",
  requirePermission("catalog.update"),
  validate(z.object({ url: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await removeItemGalleryUrl(user, String(req.params.id), req.body.url);
    await writeAudit(req as AuthedRequest, "catalog.item.gallery.remove", "Item", String(item._id));
    return ok(res, item);
  })
);

router.post(
  "/items/:id/variants",
  requirePermission("catalog.update"),
  validate(variantSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await Item.findOne({ _id: req.params.id, organizationId: user.organizationId, deletedAt: null });
    if (!item) throw ApiError.notFound("Item not found");
    const variant = await ItemVariant.create({
      ...req.body,
      itemId: item._id,
      organizationId: user.organizationId,
      branchId: user.branchId
    });
    return created(res, variant);
  })
);

router.post(
  "/items/:id/prices",
  requirePermission("catalog.update"),
  validate(priceSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await Item.findOne({ _id: req.params.id, organizationId: user.organizationId, deletedAt: null });
    if (!item) throw ApiError.notFound("Item not found");
    const price = await PriceList.create({
      ...req.body,
      itemId: item._id,
      organizationId: user.organizationId
    });
    return created(res, price);
  })
);

router.get(
  "/price",
  requirePermission("catalog.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const item = await Item.findById(req.query.itemId);
    if (!item || String(item.organizationId) !== user.organizationId) throw ApiError.notFound("Item not found");
    const variant = req.query.variantId ? await ItemVariant.findById(req.query.variantId) : null;
    const resolved = await resolveUnitPrice({
      organizationId: user.organizationId,
      item,
      variant,
      tierId: req.query.tierId as string | undefined,
      quantity: Number(req.query.qty ?? 1)
    });
    return ok(res, resolved);
  })
);

export default router;
