import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const categorySchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  parentId: { type: Schema.Types.ObjectId, ref: "Category" },
  type: { type: String, default: "product" },
  description: String,
  imageUrl: String,
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
});
tenantPlugin(categorySchema);
categorySchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const catalogTypeSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  description: String,
  defaultUnit: { type: String, default: "pcs" },
  requiresDesign: { type: Boolean, default: false },
  trackInventory: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
  system: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
});
tenantPlugin(catalogTypeSchema);
catalogTypeSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const variantOptionSchema = new Schema(
  {
    name: String,
    values: [String]
  },
  { _id: false }
);

const itemSchema = new Schema({
  name: { type: String, required: true },
  sku: { type: String, required: true },
  itemType: { type: String, default: "custom_print" },
  categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
  brand: String,
  imageUrl: String,
  gallery: [String],
  description: String,
  internalNotes: String,
  hsn: String,
  sac: String,
  taxRate: { type: Number, default: 18 },
  taxInclusive: { type: Boolean, default: false },
  unit: { type: String, default: "pcs" },
  minQty: { type: Number, default: 1 },
  maxQty: Number,
  allowDecimalQty: { type: Boolean, default: false },
  barcode: String,
  featured: { type: Boolean, default: false },
  tags: [String],
  attributes: { type: Schema.Types.Mixed, default: {} },
  variantOptions: [variantOptionSchema],
  requiresDesign: { type: Boolean, default: true },
  trackInventory: { type: Boolean, default: false },
  inventoryItemId: { type: Schema.Types.ObjectId, ref: "InventoryItem" },
  baseCost: { type: Number, default: 0 },
  originalPrice: { type: Number, default: 0 },
  salesPrice: { type: Number, required: true },
  active: { type: Boolean, default: true }
});
tenantPlugin(itemSchema);
itemSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
itemSchema.index({ organizationId: 1, barcode: 1 });
itemSchema.index({ name: "text", sku: "text", barcode: "text" });

const variantSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  name: { type: String, required: true },
  sku: String,
  options: { type: Schema.Types.Mixed, default: {} },
  salesPrice: Number,
  cost: Number,
  barcode: String,
  imageUrl: String,
  active: { type: Boolean, default: true }
});
tenantPlugin(variantSchema);

const priceListSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  variantId: { type: Schema.Types.ObjectId, ref: "ItemVariant" },
  tierId: { type: Schema.Types.ObjectId, ref: "CustomerTier" },
  minQty: { type: Number, default: 1 },
  maxQty: Number,
  price: { type: Number, required: true },
  branchIdOverride: { type: Schema.Types.ObjectId, ref: "Branch" },
  effectiveFrom: Date,
  effectiveTo: Date,
  active: { type: Boolean, default: true }
});
tenantPlugin(priceListSchema);

export const Category = mongoose.model("Category", categorySchema) as mongoose.Model<any>;
export const CatalogType = mongoose.model("CatalogType", catalogTypeSchema) as mongoose.Model<any>;
export const Item = mongoose.model("Item", itemSchema) as mongoose.Model<any>;
export const ItemVariant = mongoose.model("ItemVariant", variantSchema) as mongoose.Model<any>;
export const PriceList = mongoose.model("PriceList", priceListSchema) as mongoose.Model<any>;
