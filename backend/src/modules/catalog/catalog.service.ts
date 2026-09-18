import { ApiError } from "../../common/errors";
import { resolveUnitPrice } from "../../common/pricing";
import { CatalogType, Category, Item, ItemVariant, PriceList } from "../../models/Catalog";
import type { AuthUser } from "../../middleware/auth";
import { CATALOG_UNITS, DEFAULT_ITEM_TYPES, HSN_PATTERN, SAC_PATTERN } from "./catalog.constants";

export type VariantInput = {
  _id?: string;
  name: string;
  sku?: string;
  salesPrice?: number;
  cost?: number;
  barcode?: string;
  active?: boolean;
  options?: Record<string, unknown>;
};

export type PriceInput = {
  variantId?: string;
  variantIndex?: number;
  tierId?: string;
  minQty?: number;
  maxQty?: number;
  price: number;
};

export type ItemInput = {
  name: string;
  sku?: string;
  itemType?: string;
  categoryId?: string;
  salesPrice: number;
  originalPrice?: number;
  baseCost?: number;
  taxRate?: number;
  taxInclusive?: boolean;
  unit?: string;
  barcode?: string;
  requiresDesign?: boolean;
  trackInventory?: boolean;
  description?: string;
  hsn?: string;
  sac?: string;
  minQty?: number;
  maxQty?: number;
  allowDecimalQty?: boolean;
  brand?: string;
  active?: boolean;
  variantOptions?: Array<{ name: string; values: string[] }>;
  variants?: VariantInput[];
  prices?: PriceInput[];
};

export type CategoryInput = {
  name: string;
  slug?: string;
  parentId?: string;
  type?: string;
  description?: string;
  sortOrder?: number;
  active?: boolean;
};

export type TypeInput = {
  name: string;
  slug?: string;
  description?: string;
  defaultUnit?: string;
  requiresDesign?: boolean;
  trackInventory?: boolean;
  sortOrder?: number;
  active?: boolean;
};

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

export function makeSku(name: string) {
  const base = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "ITEM";
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

async function assertUniqueSku(organizationId: string, sku: string, excludeId?: string) {
  const existing = await Item.findOne({
    organizationId,
    sku,
    deletedAt: null,
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  }).select("_id");
  if (existing) throw ApiError.conflict(`SKU ${sku} already exists`);
}

function assertTaxCodes(input: { hsn?: string; sac?: string }) {
  const hsn = input.hsn?.trim();
  const sac = input.sac?.trim();
  if (hsn && !HSN_PATTERN.test(hsn)) throw ApiError.unprocessable("HSN must be 4–8 digits");
  if (sac && !SAC_PATTERN.test(sac)) throw ApiError.unprocessable("SAC must be 4–6 digits");
}

async function assertCategory(organizationId: string, categoryId?: string) {
  if (!categoryId) return;
  const cat = await Category.findOne({ _id: categoryId, organizationId, deletedAt: null }).select("_id");
  if (!cat) throw ApiError.unprocessable("Category was not found");
}

function catalogImageUrl(filename: string) {
  return `/uploads/catalog/${filename}`;
}

function itemFields(input: ItemInput, sku: string) {
  return {
    name: input.name.trim(),
    sku,
    itemType: (input.itemType || "custom_print").trim(),
    categoryId: input.categoryId || undefined,
    brand: input.brand?.trim() || undefined,
    salesPrice: Number(input.salesPrice),
    originalPrice: input.originalPrice,
    baseCost: input.baseCost ?? 0,
    taxRate: input.taxRate ?? 18,
    taxInclusive: Boolean(input.taxInclusive),
    unit: input.unit || "pcs",
    barcode: input.barcode?.trim() || undefined,
    requiresDesign: input.requiresDesign ?? true,
    trackInventory: Boolean(input.trackInventory),
    description: input.description?.trim() || undefined,
    hsn: input.hsn?.trim() || undefined,
    sac: input.sac?.trim() || undefined,
    minQty: input.minQty,
    maxQty: input.maxQty,
    allowDecimalQty: Boolean(input.allowDecimalQty),
    variantOptions: input.variantOptions,
    active: input.active !== false
  };
}

export async function saveCatalogItem(user: AuthUser, input: ItemInput, itemId?: string) {
  if (!input.name?.trim() || input.name.trim().length < 2) throw ApiError.unprocessable("Item name is required");
  if (input.salesPrice == null || Number.isNaN(Number(input.salesPrice)) || Number(input.salesPrice) < 0) {
    throw ApiError.unprocessable("List price is required");
  }
  assertTaxCodes(input);
  await assertCategory(user.organizationId, input.categoryId);
  const sku = (input.sku || "").trim().toUpperCase() || makeSku(input.name);
  await assertUniqueSku(user.organizationId, sku, itemId);
  const fields = itemFields(input, sku);

  const item = itemId
    ? await Item.findOneAndUpdate({ _id: itemId, organizationId: user.organizationId, deletedAt: null }, fields, { new: true })
    : await Item.create({ ...fields, organizationId: user.organizationId, branchId: user.branchId });
  if (!item) throw ApiError.notFound("Item not found");

  const indexToId: string[] = [];
  if (input.variants) {
    const incomingIds = input.variants.map((v) => v._id).filter(Boolean) as string[];
    if (itemId) {
      await ItemVariant.updateMany(
        {
          itemId: item._id,
          organizationId: user.organizationId,
          deletedAt: null,
          ...(incomingIds.length ? { _id: { $nin: incomingIds } } : {})
        },
        { deletedAt: new Date(), active: false }
      );
    }
    for (const v of input.variants) {
      if (!v.name?.trim()) continue;
      const vSku = (v.sku || "").trim().toUpperCase() || `${sku}-V${indexToId.length + 1}`;
      if (v._id) {
        const updated = await ItemVariant.findOneAndUpdate(
          { _id: v._id, itemId: item._id, organizationId: user.organizationId, deletedAt: null },
          {
            name: v.name.trim(),
            sku: vSku,
            salesPrice: v.salesPrice,
            cost: v.cost,
            barcode: v.barcode,
            active: v.active !== false,
            options: v.options
          },
          { new: true }
        );
        if (updated) indexToId.push(String(updated._id));
      } else {
        const created = await ItemVariant.create({
          itemId: item._id,
          organizationId: user.organizationId,
          branchId: user.branchId,
          name: v.name.trim(),
          sku: vSku,
          salesPrice: v.salesPrice,
          cost: v.cost,
          barcode: v.barcode,
          active: v.active !== false,
          options: v.options
        });
        indexToId.push(String(created._id));
      }
    }
  }

  if (input.prices) {
    await PriceList.updateMany({ itemId: item._id, organizationId: user.organizationId, deletedAt: null }, { deletedAt: new Date(), active: false });
    for (const p of input.prices) {
      if (p.price == null || Number.isNaN(Number(p.price))) continue;
      const variantId =
        p.variantId || (typeof p.variantIndex === "number" ? indexToId[p.variantIndex] : undefined) || undefined;
      await PriceList.create({
        organizationId: user.organizationId,
        itemId: item._id,
        variantId,
        tierId: p.tierId || undefined,
        minQty: p.minQty ?? 1,
        maxQty: p.maxQty,
        price: Number(p.price),
        active: true
      });
    }
  }

  const [variants, prices] = await Promise.all([
    ItemVariant.find({ itemId: item._id, deletedAt: null }).sort("name"),
    PriceList.find({ itemId: item._id, deletedAt: null })
  ]);
  return { item, variants, prices };
}

export async function createCategory(user: AuthUser, body: CategoryInput) {
  const name = body.name?.trim();
  if (!name || name.length < 2) throw ApiError.unprocessable("Category name is required");
  const slug = (body.slug || slugify(name)).trim();
  const exists = await Category.findOne({ organizationId: user.organizationId, slug, deletedAt: null });
  if (exists) throw ApiError.conflict("A category with this slug already exists");
  if (body.parentId) {
    const parent = await Category.findOne({ _id: body.parentId, organizationId: user.organizationId, deletedAt: null }).select("_id");
    if (!parent) throw ApiError.unprocessable("Parent category was not found");
  }
  return Category.create({
    name,
    slug,
    parentId: body.parentId || undefined,
    type: body.type?.trim() || "product",
    description: body.description?.trim() || undefined,
    sortOrder: body.sortOrder ?? 0,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updateCategory(user: AuthUser, id: string, body: CategoryInput) {
  const cat = await Category.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!cat) throw ApiError.notFound("Category not found");
  const name = body.name?.trim();
  if (!name || name.length < 2) throw ApiError.unprocessable("Category name is required");
  if (body.parentId) {
    if (String(body.parentId) === String(cat._id)) throw ApiError.unprocessable("A category cannot be its own parent");
    const parent = await Category.findOne({ _id: body.parentId, organizationId: user.organizationId, deletedAt: null }).select("_id");
    if (!parent) throw ApiError.unprocessable("Parent category was not found");
  }
  cat.name = name;
  cat.parentId = body.parentId || undefined;
  cat.type = body.type?.trim() || cat.type || "product";
  cat.description = body.description?.trim() || undefined;
  if (body.sortOrder != null) cat.sortOrder = body.sortOrder;
  if (body.active != null) cat.active = body.active;
  await cat.save();
  return cat;
}

export async function deleteCategory(user: AuthUser, id: string) {
  const cat = await Category.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!cat) throw ApiError.notFound("Category not found");
  const inUse = await Item.countDocuments({ organizationId: user.organizationId, categoryId: cat._id, deletedAt: null });
  if (inUse) throw ApiError.conflict("Move or delete items in this category first");
  const children = await Category.countDocuments({ organizationId: user.organizationId, parentId: cat._id, deletedAt: null });
  if (children) throw ApiError.conflict("Move or delete child categories first");
  cat.deletedAt = new Date();
  cat.active = false;
  await cat.save();
  return { id: String(cat._id) };
}

export async function ensureDefaultTypes(user: AuthUser) {
  for (const t of DEFAULT_ITEM_TYPES) {
    const exists = await CatalogType.findOne({ organizationId: user.organizationId, slug: t.slug, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await CatalogType.create({
        ...t,
        organizationId: user.organizationId,
        branchId: user.branchId,
        active: true
      });
    } catch {
      /* concurrent seed */
    }
  }
}

export async function listCatalogTypes(user: AuthUser) {
  await ensureDefaultTypes(user);
  return CatalogType.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder name");
}

export function listCatalogUnits() {
  return CATALOG_UNITS.map((code) => ({ code, name: code }));
}

export async function createCatalogType(user: AuthUser, body: TypeInput) {
  const name = body.name?.trim();
  if (!name || name.length < 2) throw ApiError.unprocessable("Type name is required");
  const slug = (body.slug || slugify(name)).trim();
  const exists = await CatalogType.findOne({ organizationId: user.organizationId, slug, deletedAt: null });
  if (exists) throw ApiError.conflict("A type with this name already exists");
  return CatalogType.create({
    name,
    slug,
    description: body.description?.trim() || undefined,
    defaultUnit: body.defaultUnit || "pcs",
    requiresDesign: Boolean(body.requiresDesign),
    trackInventory: Boolean(body.trackInventory),
    sortOrder: body.sortOrder ?? 100,
    system: false,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updateCatalogType(user: AuthUser, id: string, body: TypeInput) {
  const row = await CatalogType.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Type not found");
  const name = body.name?.trim();
  if (!name || name.length < 2) throw ApiError.unprocessable("Type name is required");
  row.name = name;
  row.description = body.description?.trim() || undefined;
  if (body.defaultUnit) row.defaultUnit = body.defaultUnit;
  if (body.requiresDesign != null) row.requiresDesign = body.requiresDesign;
  if (body.trackInventory != null) row.trackInventory = body.trackInventory;
  if (body.sortOrder != null) row.sortOrder = body.sortOrder;
  if (body.active != null) row.active = body.active;
  await row.save();
  return row;
}

export async function deleteCatalogType(user: AuthUser, id: string) {
  const row = await CatalogType.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Type not found");
  if (row.system) throw ApiError.conflict("System types cannot be deleted");
  const inUse = await Item.countDocuments({ organizationId: user.organizationId, itemType: row.slug, deletedAt: null });
  if (inUse) throw ApiError.conflict("Reassign items of this type first");
  row.deletedAt = new Date();
  row.active = false;
  await row.save();
  return { id: String(row._id) };
}

export async function deleteCatalogItem(user: AuthUser, id: string) {
  const item = await Item.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!item) throw ApiError.notFound("Item not found");
  const now = new Date();
  item.deletedAt = now;
  item.active = false;
  await item.save();
  await ItemVariant.updateMany({ itemId: item._id, organizationId: user.organizationId, deletedAt: null }, { deletedAt: now, active: false });
  await PriceList.updateMany({ itemId: item._id, organizationId: user.organizationId, deletedAt: null }, { deletedAt: now, active: false });
  return { id: String(item._id) };
}

async function loadItem(user: AuthUser, id: string) {
  const item = await Item.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!item) throw ApiError.notFound("Item not found");
  return item;
}

async function loadCategory(user: AuthUser, id: string) {
  const cat = await Category.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!cat) throw ApiError.notFound("Category not found");
  return cat;
}

export async function setItemCover(user: AuthUser, id: string, file: { filename: string }) {
  const item = await loadItem(user, id);
  item.imageUrl = catalogImageUrl(file.filename);
  await item.save();
  return item;
}

export async function clearItemCover(user: AuthUser, id: string) {
  const item = await loadItem(user, id);
  item.imageUrl = undefined;
  await item.save();
  return item;
}

export async function addItemGallery(user: AuthUser, id: string, files: Array<{ filename: string }>) {
  if (!files.length) throw ApiError.unprocessable("Choose at least one image");
  const urls = files.map((f) => catalogImageUrl(f.filename));
  const item = await loadItem(user, id);
  item.gallery = [...(item.gallery ?? []), ...urls];
  await item.save();
  return item;
}

export async function removeItemGalleryUrl(user: AuthUser, id: string, url: string) {
  if (!url?.startsWith("/uploads/catalog/")) throw ApiError.unprocessable("Invalid gallery image");
  const item = await loadItem(user, id);
  item.gallery = (item.gallery ?? []).filter((u: string) => u !== url);
  await item.save();
  return item;
}

export async function setCategoryImage(user: AuthUser, id: string, file: { filename: string }) {
  const cat = await loadCategory(user, id);
  cat.imageUrl = catalogImageUrl(file.filename);
  await cat.save();
  return cat;
}

export async function clearCategoryImage(user: AuthUser, id: string) {
  const cat = await loadCategory(user, id);
  cat.imageUrl = undefined;
  await cat.save();
  return cat;
}

export async function attachResolvedPrices<T extends { _id: unknown; salesPrice: number; variants?: Array<{ _id: unknown; salesPrice?: number }> }>(
  organizationId: string,
  rows: T[],
  tierId?: string,
  quantity = 1
) {
  if (!tierId) {
    return rows.map((row) => ({
      ...row,
      resolvedPrice: row.salesPrice,
      variants: (row.variants ?? []).map((v) => ({ ...v, resolvedPrice: v.salesPrice ?? row.salesPrice }))
    }));
  }
  return Promise.all(
    rows.map(async (row) => {
      const base = await resolveUnitPrice({ organizationId, item: row, variant: null, tierId, quantity });
      const variants = await Promise.all(
        (row.variants ?? []).map(async (v) => {
          const priced = await resolveUnitPrice({ organizationId, item: row, variant: v, tierId, quantity });
          return { ...v, resolvedPrice: priced.price };
        })
      );
      return { ...row, resolvedPrice: base.price, variants };
    })
  );
}
