import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const templateSchema = new Schema({
  name: { type: String, required: true },
  event: { type: String, required: true },
  channel: { type: String, enum: ["whatsapp", "sms", "email", "in_app"], required: true },
  body: { type: String, required: true },
  language: { type: String, default: "en" },
  enabled: { type: Boolean, default: true }
});
tenantPlugin(templateSchema);

const logSchema = new Schema({
  event: String,
  channel: String,
  to: String,
  body: String,
  status: { type: String, enum: ["queued", "sent", "failed"], default: "queued" },
  error: String,
  referenceType: String,
  referenceId: Schema.Types.ObjectId,
  payload: Schema.Types.Mixed
});
tenantPlugin(logSchema);

const printerSchema = new Schema({
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ["a4", "a5", "thermal", "label", "barcode", "network", "pdf", "browser"],
    default: "a4"
  },
  connectionType: { type: String, default: "browser" },
  ip: String,
  port: Number,
  paperSize: { type: String, default: "A4" },
  margins: String,
  copies: { type: Number, default: 1 },
  isDefault: { type: Boolean, default: false },
  header: String,
  footer: String,
  autoCut: Boolean,
  cashDrawer: Boolean,
  active: { type: Boolean, default: true }
});
tenantPlugin(printerSchema);

const auditSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true },
  entityType: String,
  entityId: String,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ip: String,
  userAgent: String
});
tenantPlugin(auditSchema);
auditSchema.index({ organizationId: 1, createdAt: -1 });

const fileSchema = new Schema({
  originalName: String,
  mimeType: String,
  size: Number,
  path: String,
  url: String,
  hash: String,
  visibility: { type: String, enum: ["private", "internal", "public"], default: "internal" },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(fileSchema);

const paymentMethodSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, lowercase: true, trim: true },
  type: { type: String, default: "other" },
  system: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 100 },
  active: { type: Boolean, default: true }
});
tenantPlugin(paymentMethodSchema);
paymentMethodSchema.index({ organizationId: 1, code: 1 }, { unique: true });

const couponSchema = new Schema({
  code: { type: String, required: true, uppercase: true },
  type: { type: String, enum: ["fixed", "percent"], required: true },
  value: { type: Number, required: true },
  minOrder: { type: Number, default: 0 },
  maxDiscount: Number,
  expiresAt: Date,
  active: { type: Boolean, default: true }
});
tenantPlugin(couponSchema);
couponSchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const NotificationTemplate = mongoose.model("NotificationTemplate", templateSchema) as mongoose.Model<any>;
export const NotificationLog = mongoose.model("NotificationLog", logSchema) as mongoose.Model<any>;
export const Printer = mongoose.model("Printer", printerSchema) as mongoose.Model<any>;
export const AuditLog = mongoose.model("AuditLog", auditSchema) as mongoose.Model<any>;
export const FileAsset = mongoose.model("FileAsset", fileSchema) as mongoose.Model<any>;
const taxRateSchema = new Schema({
  name: { type: String, required: true },
  rate: { type: Number, required: true, min: 0, max: 100 },
  hsn: String,
  description: String,
  sortOrder: { type: Number, default: 100 },
  active: { type: Boolean, default: true }
});
tenantPlugin(taxRateSchema);
taxRateSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const PaymentMethod = mongoose.model("PaymentMethod", paymentMethodSchema) as mongoose.Model<any>;
export const Coupon = mongoose.model("Coupon", couponSchema) as mongoose.Model<any>;
export const TaxRate = mongoose.model("TaxRate", taxRateSchema) as mongoose.Model<any>;
