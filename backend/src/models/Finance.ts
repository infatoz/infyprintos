import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const invoiceSchema = new Schema({
  number: { type: String, required: true },
  type: {
    type: String,
    enum: ["quotation", "proforma", "tax_invoice", "receipt", "delivery_challan", "credit_note", "debit_note", "purchase"],
    default: "tax_invoice"
  },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", index: true },
  quotationId: { type: Schema.Types.ObjectId, ref: "Quotation" },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
  snapshot: Schema.Types.Mixed,
  totals: Schema.Types.Mixed,
  dueDate: Date,
  status: { type: String, enum: ["draft", "issued", "paid", "partial", "overdue", "void"], default: "issued" },
  pdfUrl: String,
  eBillIssuedAt: Date,
  eBillPdfUrl: String,
  reprintCount: { type: Number, default: 0 }
});
tenantPlugin(invoiceSchema);
invoiceSchema.index({ organizationId: 1, number: 1 }, { unique: true });

const paymentSchema = new Schema({
  number: { type: String, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", index: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
  amount: { type: Number, required: true },
  method: { type: String, required: true },
  reference: String,
  paidAt: { type: Date, default: Date.now },
  collectedBy: { type: Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["pending", "completed", "failed", "refunded", "partial_refund"], default: "completed" },
  refundOf: { type: Schema.Types.ObjectId, ref: "Payment" },
  notes: String
});
tenantPlugin(paymentSchema);
paymentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
paymentSchema.index(
  { organizationId: 1, orderId: 1, reference: 1 },
  { unique: true, sparse: true, partialFilterExpression: { reference: { $type: "string", $gt: "" }, status: "completed" } }
);

const expenseTypeSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  description: String,
  sortOrder: { type: Number, default: 0 },
  system: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
});
tenantPlugin(expenseTypeSchema);
expenseTypeSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const expenseCategorySchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  type: { type: String, required: true, index: true },
  description: String,
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
});
tenantPlugin(expenseCategorySchema);
expenseCategorySchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const expenseSchema = new Schema({
  number: { type: String, required: true },
  type: { type: String, default: "operating", index: true },
  category: { type: String, required: true, index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: "ExpenseCategory" },
  amount: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  method: String,
  vendor: String,
  date: { type: Date, default: Date.now },
  attachmentUrl: String,
  notes: String,
  approvalStatus: { type: String, enum: ["draft", "pending", "approved", "rejected"], default: "approved", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" }
});
tenantPlugin(expenseSchema);
expenseSchema.index({ organizationId: 1, number: 1 }, { unique: true });

const incomeSchema = new Schema({
  number: String,
  category: { type: String, default: "order_payment" },
  amount: { type: Number, required: true },
  method: String,
  customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
  orderId: { type: Schema.Types.ObjectId, ref: "Order" },
  paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  date: { type: Date, default: Date.now },
  notes: String
});
tenantPlugin(incomeSchema);

export const Invoice = mongoose.model("Invoice", invoiceSchema) as mongoose.Model<any>;
export const Payment = mongoose.model("Payment", paymentSchema) as mongoose.Model<any>;
export const ExpenseType = mongoose.model("ExpenseType", expenseTypeSchema) as mongoose.Model<any>;
export const ExpenseCategory = mongoose.model("ExpenseCategory", expenseCategorySchema) as mongoose.Model<any>;
export const Expense = mongoose.model("Expense", expenseSchema) as mongoose.Model<any>;
export const Income = mongoose.model("Income", incomeSchema) as mongoose.Model<any>;
