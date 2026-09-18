import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const lineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item" },
    variantId: { type: Schema.Types.ObjectId, ref: "ItemVariant" },
    name: String,
    sku: String,
    variantName: String,
    description: String,
    unit: String,
    quantity: Number,
    unitPrice: Number,
    cost: Number,
    discountType: { type: String, enum: ["fixed", "percent", "none"], default: "none" },
    discountValue: { type: Number, default: 0 },
    taxRate: Number,
    taxInclusive: Boolean,
    requiresDesign: Boolean,
    designStatus: {
      type: String,
      enum: ["not_required", "pending", "uploaded", "awaiting_approval", "approved", "rejected"],
      default: "not_required"
    },
    approvedDesignId: { type: Schema.Types.ObjectId, ref: "DesignFile" },
    pricingRule: Schema.Types.Mixed,
    snapshot: Schema.Types.Mixed,
    lineTotal: Number
  },
  { _id: true }
);

const totalsSchema = new Schema(
  {
    subtotal: { type: Number, default: 0 },
    itemDiscountTotal: { type: Number, default: 0 },
    orderDiscount: { type: Number, default: 0 },
    taxableValue: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    additionalCharges: { type: Number, default: 0 },
    deliveryCharges: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 }
  },
  { _id: false }
);

const orderSchema = new Schema({
  number: { type: String, required: true },
  idempotencyKey: { type: String, index: true },
  quotationId: { type: Schema.Types.ObjectId, ref: "Quotation" },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  customerSnapshot: Schema.Types.Mixed,
  status: { type: String, default: "draft", index: true },
  source: { type: String, enum: ["pos", "quotation", "portal", "manual"], default: "pos" },
  items: [lineSchema],
  charges: [{ name: String, amount: Number }],
  discountType: { type: String, enum: ["fixed", "percent", "none"], default: "none" },
  discountValue: { type: Number, default: 0 },
  couponCode: String,
  deliveryCharges: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  taxInclusive: { type: Boolean, default: false },
  interstate: { type: Boolean, default: false },
  totals: totalsSchema,
  paymentMethod: String,
  creditTerm: String,
  dueDate: Date,
  notes: String,
  internalNotes: String,
  expectedDate: Date,
  delayReason: String,
  cancelReason: String,
  locked: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  assignedDesigner: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(orderSchema);
orderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
orderSchema.index({ organizationId: 1, createdAt: -1 });
orderSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const statusSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  color: String,
  sortOrder: { type: Number, default: 0 },
  customerLabel: String,
  requiresReason: { type: Boolean, default: false },
  requiresPermission: String,
  terminal: { type: Boolean, default: false },
  slaHours: Number,
  allowedTransitions: [String],
  notificationEvent: String,
  active: { type: Boolean, default: true }
});
tenantPlugin(statusSchema);
statusSchema.index({ organizationId: 1, code: 1 }, { unique: true });

const historySchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  fromStatus: String,
  toStatus: { type: String, required: true },
  reason: String,
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  meta: Schema.Types.Mixed
});
tenantPlugin(historySchema);

export const Order = mongoose.model("Order", orderSchema) as mongoose.Model<any>;
export const OrderStatus = mongoose.model("OrderStatus", statusSchema) as mongoose.Model<any>;
export const OrderStatusHistory = mongoose.model("OrderStatusHistory", historySchema) as mongoose.Model<any>;
