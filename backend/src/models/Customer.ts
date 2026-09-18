import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const tierSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  discountPercent: { type: Number, default: 0 },
  color: String,
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
});
tenantPlugin(tierSchema);
tierSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const creditTermSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  type: { type: String, enum: ["prepaid", "due_on_billing", "net_days", "custom"], required: true },
  netDays: { type: Number, default: 0 },
  description: String,
  active: { type: Boolean, default: true }
});
tenantPlugin(creditTermSchema);
creditTermSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const addressSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  label: { type: String, default: "Primary" },
  type: { type: String, enum: ["registered", "billing", "shipping", "other"], default: "billing" },
  line1: String,
  line2: String,
  city: String,
  state: String,
  pincode: String,
  country: { type: String, default: "India" },
  gstin: String,
  isDefault: { type: Boolean, default: false }
});
tenantPlugin(addressSchema);
addressSchema.index({ organizationId: 1, customerId: 1, type: 1, deletedAt: 1 });

const documentSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  type: { type: String, required: true },
  number: String,
  fileId: { type: Schema.Types.ObjectId, ref: "FileAsset" },
  status: { type: String, enum: ["pending", "verified", "rejected", "expired"], default: "pending" },
  notes: String,
  verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
  verifiedAt: Date,
  expiresAt: Date
});
tenantPlugin(documentSchema);

const customerSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  phoneDigits: { type: String, index: true },
  whatsapp: String,
  email: String,
  alternatePhone: String,
  type: { type: String, default: "individual" },
  tags: [String],
  source: String,
  notes: String,
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  tierId: { type: Schema.Types.ObjectId, ref: "CustomerTier" },
  creditTermId: { type: Schema.Types.ObjectId, ref: "CreditTerm" },
  creditLimit: { type: Number, default: 0 },
  outstanding: { type: Number, default: 0 },
  overdue: { type: Number, default: 0 },
  creditHold: { type: Boolean, default: false },
  creditHoldReason: String,
  taxRegistration: {
    type: String,
    enum: ["unregistered", "registered", "composition", "sez", "overseas"],
    default: "unregistered"
  },
  gstState: String,
  gstStateCode: String,
  lifecycleStatus: { type: String, enum: ["prospect", "active", "inactive", "blocked"], default: "active" },
  whatsappOptIn: { type: Boolean, default: true },
  lastActivityAt: Date,
  mergedInto: { type: Schema.Types.ObjectId, ref: "Customer" },
  business: {
    name: String,
    category: String,
    size: String,
    gstin: String,
    pan: String,
    gstinChecksumValid: Boolean
  },
  photoUrl: String,
  sameAddress: { type: Boolean, default: true },
  billingPreferences: String,
  portalEnabled: { type: Boolean, default: false },
  passwordHash: String,
  active: { type: Boolean, default: true }
});
tenantPlugin(customerSchema);
customerSchema.index({ organizationId: 1, code: 1 }, { unique: true });
customerSchema.index({ organizationId: 1, phone: 1 });
customerSchema.index({ organizationId: 1, phoneDigits: 1 });
customerSchema.index({ organizationId: 1, email: 1 });
customerSchema.index({ organizationId: 1, "business.gstin": 1 });
customerSchema.index({ organizationId: 1, lifecycleStatus: 1, deletedAt: 1 });
customerSchema.index({ organizationId: 1, taxRegistration: 1, deletedAt: 1 });
customerSchema.index({ organizationId: 1, assignedTo: 1, deletedAt: 1 });
customerSchema.index({ organizationId: 1, name: "text", phone: "text", email: "text", code: "text" });

const membershipSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, unique: true },
  membershipId: { type: String, required: true, unique: true },
  qrToken: { type: String, required: true, unique: true },
  previousQrTokens: [
    {
      token: String,
      replacedAt: Date,
      replacedBy: { type: Schema.Types.ObjectId, ref: "User" }
    }
  ],
  tierName: String,
  issuedAt: { type: Date, default: Date.now },
  reissuedAt: Date,
  reissuedBy: { type: Schema.Types.ObjectId, ref: "User" },
  validUntil: Date,
  status: { type: String, enum: ["active", "suspended", "revoked"], default: "active" }
});
tenantPlugin(membershipSchema);

const contactSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  name: { type: String, required: true },
  title: String,
  department: String,
  phone: String,
  email: String,
  whatsapp: String,
  isPrimary: { type: Boolean, default: false },
  notes: String
});
tenantPlugin(contactSchema);
contactSchema.index({ organizationId: 1, customerId: 1, isPrimary: 1 });

const activitySchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  type: {
    type: String,
    enum: ["note", "call", "visit", "email", "whatsapp", "task", "status_change", "credit", "merge", "kyc", "assignment", "system"],
    required: true
  },
  body: String,
  meta: Schema.Types.Mixed,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(activitySchema);
activitySchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });

const creditEventSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  type: { type: String, enum: ["limit_change", "term_change", "hold", "release", "recalc", "merge"], required: true },
  previous: Schema.Types.Mixed,
  next: Schema.Types.Mixed,
  reason: { type: String, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(creditEventSchema);
creditEventSchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });

export const CustomerTier = mongoose.model("CustomerTier", tierSchema) as mongoose.Model<any>;
export const CreditTerm = mongoose.model("CreditTerm", creditTermSchema) as mongoose.Model<any>;
export const CustomerAddress = mongoose.model("CustomerAddress", addressSchema) as mongoose.Model<any>;
export const CustomerDocument = mongoose.model("CustomerDocument", documentSchema) as mongoose.Model<any>;
export const Customer = mongoose.model("Customer", customerSchema) as mongoose.Model<any>;
export const MembershipCard = mongoose.model("MembershipCard", membershipSchema) as mongoose.Model<any>;
export const CustomerContact = mongoose.model("CustomerContact", contactSchema) as mongoose.Model<any>;
export const CustomerActivity = mongoose.model("CustomerActivity", activitySchema) as mongoose.Model<any>;
export const CustomerCreditEvent = mongoose.model("CustomerCreditEvent", creditEventSchema) as mongoose.Model<any>;
