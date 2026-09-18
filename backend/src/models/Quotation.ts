import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const chargeSchema = new Schema(
  {
    name: String,
    amount: Number
  },
  { _id: false }
);

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
    pricingRule: { type: Schema.Types.Mixed },
    snapshot: { type: Schema.Types.Mixed },
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
    grandTotal: { type: Number, default: 0 }
  },
  { _id: false }
);

const quotationSchema = new Schema({
  number: { type: String, required: true },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  customerSnapshot: { type: Schema.Types.Mixed },
  status: {
    type: String,
    enum: ["draft", "sent", "viewed", "awaiting_approval", "approved", "rejected", "revision_requested", "expired", "converted", "cancelled"],
    default: "draft",
    index: true
  },
  items: [lineSchema],
  charges: [chargeSchema],
  discountType: { type: String, enum: ["fixed", "percent", "none"], default: "none" },
  discountValue: { type: Number, default: 0 },
  couponCode: String,
  deliveryCharges: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  taxInclusive: { type: Boolean, default: false },
  interstate: { type: Boolean, default: false },
  totals: totalsSchema,
  notes: String,
  terms: String,
  validUntil: Date,
  attachments: [String],
  publicToken: String,
  publicTokenExpiresAt: Date,
  sentAt: Date,
  viewedAt: Date,
  approvedAt: Date,
  rejectedAt: Date,
  approvalIp: String,
  approvalUserAgent: String,
  approvalMessage: String,
  rejectionReason: String,
  convertedOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
  revisionOf: { type: Schema.Types.ObjectId, ref: "Quotation" },
  revisionNumber: { type: Number, default: 1 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(quotationSchema);
quotationSchema.index({ organizationId: 1, number: 1 }, { unique: true });
quotationSchema.index({ publicToken: 1 }, { unique: true, sparse: true });

const quotationVersionSchema = new Schema({
  quotationId: { type: Schema.Types.ObjectId, ref: "Quotation", required: true, index: true },
  revisionNumber: Number,
  snapshot: Schema.Types.Mixed,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(quotationVersionSchema);

export const Quotation = mongoose.model("Quotation", quotationSchema) as mongoose.Model<any>;
export const QuotationVersion = mongoose.model("QuotationVersion", quotationVersionSchema) as mongoose.Model<any>;
