import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const unitSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  allowDecimal: { type: Boolean, default: true },
  active: { type: Boolean, default: true }
});
tenantPlugin(unitSchema);
unitSchema.index({ organizationId: 1, code: 1 }, { unique: true });

const inventoryTypeSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  description: String,
  defaultUnit: { type: String, default: "pcs" },
  sortOrder: { type: Number, default: 0 },
  system: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
});
tenantPlugin(inventoryTypeSchema);
inventoryTypeSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const inventoryCategorySchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  type: { type: String, required: true, index: true },
  description: String,
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
});
tenantPlugin(inventoryCategorySchema);
inventoryCategorySchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const supplierSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  contactName: String,
  phone: String,
  phoneDigits: { type: String, index: true },
  email: String,
  gstin: String,
  paymentTerms: String,
  leadTimeDays: { type: Number, default: 0 },
  address: String,
  city: String,
  state: String,
  pincode: String,
  notes: String,
  active: { type: Boolean, default: true }
});
tenantPlugin(supplierSchema);
supplierSchema.index({ organizationId: 1, name: 1 });
supplierSchema.index({ organizationId: 1, code: 1 }, { unique: true, sparse: true });

const inventoryItemSchema = new Schema({
  sku: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, default: "raw_material", index: true },
  category: String,
  categoryId: { type: Schema.Types.ObjectId, ref: "InventoryCategory", index: true },
  unit: { type: String, default: "pcs" },
  stockQty: { type: Number, default: 0 },
  reservedQty: { type: Number, default: 0 },
  reorderLevel: { type: Number, default: 0 },
  maxStock: Number,
  costPerUnit: { type: Number, default: 0 },
  averageCost: { type: Number, default: 0 },
  supplier: String,
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  batch: String,
  expiryDate: Date,
  warehouse: { type: String, default: "Main" },
  bin: String,
  catalogItemId: { type: Schema.Types.ObjectId, ref: "Item" },
  lastMovementAt: Date,
  active: { type: Boolean, default: true }
});
tenantPlugin(inventoryItemSchema);
inventoryItemSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
inventoryItemSchema.virtual("availableQty").get(function () {
  return (this.stockQty || 0) - (this.reservedQty || 0);
});

export const LEDGER_TYPES = [
  "opening",
  "purchase",
  "inward",
  "outward",
  "production_consumption",
  "adjustment",
  "transfer",
  "wastage",
  "return",
  "damaged",
  "reconciliation",
  "reservation",
  "release"
] as const;

const txnSchema = new Schema({
  inventoryItemId: { type: Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
  type: { type: String, enum: LEDGER_TYPES, required: true },
  quantity: { type: Number, required: true },
  unitCost: Number,
  previousBalance: Number,
  newBalance: Number,
  previousReserved: Number,
  newReserved: Number,
  referenceType: String,
  referenceId: Schema.Types.ObjectId,
  reason: String,
  warehouse: String,
  toInventoryItemId: { type: Schema.Types.ObjectId, ref: "InventoryItem" },
  idempotencyKey: String,
  userId: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(txnSchema);
txnSchema.index({ organizationId: 1, createdAt: -1 });
txnSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
txnSchema.index(
  { organizationId: 1, type: 1, inventoryItemId: 1, referenceType: 1, referenceId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      type: { $in: ["production_consumption", "reservation"] },
      referenceId: { $type: "objectId" }
    }
  }
);

const bomSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  variantId: { type: Schema.Types.ObjectId, ref: "ItemVariant" },
  wastePercent: { type: Number, default: 0 },
  materials: [
    {
      inventoryItemId: { type: Schema.Types.ObjectId, ref: "InventoryItem", required: true },
      quantityPerUnit: { type: Number, required: true },
      unit: String,
      formula: String
    }
  ],
  active: { type: Boolean, default: true }
});
tenantPlugin(bomSchema);
bomSchema.index({ organizationId: 1, itemId: 1, variantId: 1 });

const reservationSchema = new Schema({
  inventoryItemId: { type: Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  orderItemId: Schema.Types.ObjectId,
  quantity: { type: Number, required: true },
  remaining: { type: Number, required: true },
  status: { type: String, enum: ["reserved", "released", "consumed"], default: "reserved", index: true },
  idempotencyKey: String
});
tenantPlugin(reservationSchema);
reservationSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export const Unit = mongoose.model("Unit", unitSchema) as mongoose.Model<any>;
export const InventoryType = mongoose.model("InventoryType", inventoryTypeSchema) as mongoose.Model<any>;
export const InventoryCategory = mongoose.model("InventoryCategory", inventoryCategorySchema) as mongoose.Model<any>;
export const Supplier = mongoose.model("Supplier", supplierSchema) as mongoose.Model<any>;
export const InventoryItem = mongoose.model("InventoryItem", inventoryItemSchema) as mongoose.Model<any>;
export const InventoryTransaction = mongoose.model("InventoryTransaction", txnSchema) as mongoose.Model<any>;
export const BillOfMaterials = mongoose.model("BillOfMaterials", bomSchema) as mongoose.Model<any>;
export const StockReservation = mongoose.model("StockReservation", reservationSchema) as mongoose.Model<any>;
