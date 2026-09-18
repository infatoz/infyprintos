import mongoose, { Schema } from "mongoose";

const orgSchema = new Schema(
  {
    name: { type: String, required: true },
    legalName: String,
    logoUrl: String,
    gstin: String,
    pan: String,
    email: String,
    phone: String,
    whatsapp: String,
    website: String,
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: "India" }
    },
    currency: { type: String, default: "INR" },
    timezone: { type: String, default: "Asia/Kolkata" },
    financialYearStartMonth: { type: Number, default: 4 },
    invoicePrefix: { type: String, default: "INV" },
    quotationPrefix: { type: String, default: "QT" },
    orderPrefix: { type: String, default: "ORD" },
    receiptPrefix: { type: String, default: "RCT" },
    expensePrefix: { type: String, default: "EXP" },
    jobPrefix: { type: String, default: "JOB" },
    customerPrefix: { type: String, default: "CUS" },
    defaultTaxRate: { type: Number, default: 18 },
    taxInclusive: { type: Boolean, default: false },
    workingHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "19:00" }
    },
    holidays: [String],
    defaultPaymentMethod: { type: String, default: "cash" },
    defaultWorkflow: { type: String, default: "print_shop" },
    invoiceFooter: String,
    invoiceNotes: String,
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const branchSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    phone: String,
    email: String,
    address: {
      line1: String,
      city: String,
      state: String,
      pincode: String
    },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

branchSchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const Organization = mongoose.model("Organization", orgSchema);
export const Branch = mongoose.model("Branch", branchSchema);
