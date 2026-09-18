import { z } from "zod";
import { ApiError } from "../../common/errors";
import { nextNumber } from "../../common/numbering";
import { Expense, ExpenseCategory, ExpenseType, Payment } from "../../models/Finance";
import { Organization } from "../../models/Organization";
import { PaymentMethod } from "../../models/Settings";
import type { AuthUser } from "../../middleware/auth";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_EXPENSE_TYPES,
  DEFAULT_PAYMENT_METHODS,
  slugifyFinance
} from "./finance.constants";

export const expenseInputSchema = z.object({
  category: z.string().optional(),
  categoryId: z.string().optional(),
  type: z.string().optional(),
  amount: z.number().positive(),
  tax: z.number().min(0).optional(),
  method: z.string().optional(),
  vendor: z.string().optional(),
  date: z.string().optional(),
  notes: z.string().optional()
});

export const typeInputSchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional()
});

export const categoryInputSchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
  type: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional()
});

export const paymentMethodInputSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  type: z.string().optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional()
});

export async function ensureExpenseTaxonomy(organizationId: string, branchId?: string) {
  for (const t of DEFAULT_EXPENSE_TYPES) {
    const exists = await ExpenseType.findOne({ organizationId, slug: t.slug, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await ExpenseType.create({ ...t, organizationId, branchId, active: true });
    } catch {
      /* concurrent seed */
    }
  }
  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    const exists = await ExpenseCategory.findOne({ organizationId, slug: c.slug, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await ExpenseCategory.create({ ...c, organizationId, branchId, active: true });
    } catch {
      /* concurrent seed */
    }
  }
}

export async function ensurePaymentMethods(organizationId: string, branchId?: string) {
  for (const m of DEFAULT_PAYMENT_METHODS) {
    const exists = await PaymentMethod.findOne({ organizationId, code: m.code, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await PaymentMethod.create({ ...m, organizationId, branchId, active: true });
    } catch {
      /* concurrent seed */
    }
  }
}

async function assertExpenseType(organizationId: string, slug: string) {
  const type = await ExpenseType.findOne({ organizationId, slug, deletedAt: null, active: true });
  if (!type) throw ApiError.unprocessable("Unknown expense type");
  return type;
}

async function resolveCategory(organizationId: string, body: { category?: string; categoryId?: string; type?: string }) {
  let cat = body.categoryId
    ? await ExpenseCategory.findOne({ _id: body.categoryId, organizationId, deletedAt: null })
    : body.category
      ? await ExpenseCategory.findOne({ organizationId, slug: slugifyFinance(body.category), deletedAt: null })
      : null;
  if (!cat && body.category) {
    cat = await ExpenseCategory.findOne({ organizationId, slug: body.category, deletedAt: null });
  }
  if (!cat) throw ApiError.unprocessable("Expense category is required");
  if (cat.active === false) throw ApiError.unprocessable("Expense category is inactive");
  const typeSlug = body.type || cat.type;
  const type = await assertExpenseType(organizationId, typeSlug);
  if (body.type && cat.type !== type.slug) throw ApiError.unprocessable("Category does not belong to this type");
  return { cat, type };
}

export async function assertActivePaymentMethod(organizationId: string, code?: string) {
  if (!code) return;
  await ensurePaymentMethods(organizationId);
  const method = await PaymentMethod.findOne({ organizationId, code, active: true, deletedAt: null });
  if (!method) throw ApiError.unprocessable("Invalid payment method");
  return method;
}

export async function listExpenseTypes(user: AuthUser) {
  await ensureExpenseTaxonomy(user.organizationId, user.branchId);
  return ExpenseType.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder name");
}

export async function createExpenseType(user: AuthUser, body: z.infer<typeof typeInputSchema>) {
  const name = body.name.trim();
  const slug = slugifyFinance(body.slug || name);
  const exists = await ExpenseType.findOne({ organizationId: user.organizationId, slug, deletedAt: null });
  if (exists) throw ApiError.conflict("A type with this name already exists");
  return ExpenseType.create({
    name,
    slug,
    description: body.description?.trim() || undefined,
    sortOrder: body.sortOrder ?? 200,
    system: false,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updateExpenseType(user: AuthUser, id: string, body: Partial<z.infer<typeof typeInputSchema>>) {
  const row = await ExpenseType.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Type not found");
  if (body.name) {
    const name = body.name.trim();
    if (name.length < 2) throw ApiError.unprocessable("Type name is required");
    row.name = name;
  }
  if (body.description !== undefined) row.description = body.description.trim() || undefined;
  if (body.sortOrder != null) row.sortOrder = body.sortOrder;
  if (body.active != null) row.active = body.active;
  await row.save();
  return row;
}

export async function deleteExpenseType(user: AuthUser, id: string) {
  const row = await ExpenseType.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Type not found");
  if (row.system) throw ApiError.conflict("System types cannot be deleted");
  const inUse = await Expense.countDocuments({ organizationId: user.organizationId, type: row.slug, deletedAt: null });
  if (inUse) throw ApiError.conflict("Reassign expenses of this type first");
  const cats = await ExpenseCategory.countDocuments({ organizationId: user.organizationId, type: row.slug, deletedAt: null });
  if (cats) throw ApiError.conflict("Move or delete categories of this type first");
  row.deletedAt = new Date();
  row.active = false;
  await row.save();
  return { id: String(row._id) };
}

export async function listExpenseCategories(user: AuthUser, type?: string) {
  await ensureExpenseTaxonomy(user.organizationId, user.branchId);
  const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
  if (type) filter.type = type;
  return ExpenseCategory.find(filter).sort("sortOrder name");
}

export async function createExpenseCategory(user: AuthUser, body: z.infer<typeof categoryInputSchema>) {
  await ensureExpenseTaxonomy(user.organizationId, user.branchId);
  const type = await assertExpenseType(user.organizationId, body.type);
  const name = body.name.trim();
  const slug = slugifyFinance(body.slug || name);
  const exists = await ExpenseCategory.findOne({ organizationId: user.organizationId, slug, deletedAt: null });
  if (exists) throw ApiError.conflict("A category with this name already exists");
  return ExpenseCategory.create({
    name,
    slug,
    type: type.slug,
    description: body.description?.trim() || undefined,
    sortOrder: body.sortOrder ?? 200,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updateExpenseCategory(user: AuthUser, id: string, body: Partial<z.infer<typeof categoryInputSchema>>) {
  const row = await ExpenseCategory.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Category not found");
  if (body.name) row.name = body.name.trim();
  if (body.type) {
    const type = await assertExpenseType(user.organizationId, body.type);
    row.type = type.slug;
  }
  if (body.description !== undefined) row.description = body.description.trim() || undefined;
  if (body.sortOrder != null) row.sortOrder = body.sortOrder;
  if (body.active != null) row.active = body.active;
  await row.save();
  return row;
}

export async function deleteExpenseCategory(user: AuthUser, id: string) {
  const row = await ExpenseCategory.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Category not found");
  const inUse = await Expense.countDocuments({
    organizationId: user.organizationId,
    deletedAt: null,
    $or: [{ categoryId: row._id }, { category: row.slug }]
  });
  if (inUse) throw ApiError.conflict("Move or delete expenses in this category first");
  row.deletedAt = new Date();
  row.active = false;
  await row.save();
  return { id: String(row._id) };
}

export async function listPaymentMethods(user: AuthUser, opts?: { activeOnly?: boolean }) {
  await ensurePaymentMethods(user.organizationId, user.branchId);
  const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
  if (opts?.activeOnly !== false) filter.active = true;
  return PaymentMethod.find(filter).sort("sortOrder name");
}

export async function createPaymentMethod(user: AuthUser, body: z.infer<typeof paymentMethodInputSchema>) {
  const name = body.name.trim();
  const code = slugifyFinance(body.code || name);
  const exists = await PaymentMethod.findOne({ organizationId: user.organizationId, code, deletedAt: null });
  if (exists) throw ApiError.conflict("A payment method with this code already exists");
  return PaymentMethod.create({
    name,
    code,
    type: body.type || "other",
    sortOrder: body.sortOrder ?? 200,
    system: false,
    organizationId: user.organizationId,
    branchId: user.branchId,
    active: body.active !== false
  });
}

export async function updatePaymentMethod(user: AuthUser, id: string, body: Partial<z.infer<typeof paymentMethodInputSchema>>) {
  const row = await PaymentMethod.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Payment method not found");
  if (body.name) row.name = body.name.trim();
  if (body.type) row.type = body.type;
  if (body.sortOrder != null) row.sortOrder = body.sortOrder;
  if (body.active != null) row.active = body.active;
  await row.save();
  return row;
}

export async function deletePaymentMethod(user: AuthUser, id: string) {
  const row = await PaymentMethod.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!row) throw ApiError.notFound("Payment method not found");
  if (row.system) throw ApiError.conflict("System payment methods cannot be deleted");
  const [exp, pay] = await Promise.all([
    Expense.countDocuments({ organizationId: user.organizationId, method: row.code, deletedAt: null }),
    Payment.countDocuments({ organizationId: user.organizationId, method: row.code, deletedAt: null })
  ]);
  if (exp || pay) throw ApiError.conflict("This method is used on payments or expenses");
  row.deletedAt = new Date();
  row.active = false;
  row.code = `${row.code}__del_${String(row._id).slice(-6)}`;
  await row.save();
  return { id: String(row._id) };
}

export async function createExpense(user: AuthUser, body: z.infer<typeof expenseInputSchema>) {
  await ensureExpenseTaxonomy(user.organizationId, user.branchId);
  const { cat, type } = await resolveCategory(user.organizationId, body);
  if (body.method) await assertActivePaymentMethod(user.organizationId, body.method);
  const org = await Organization.findById(user.organizationId);
  const number = await nextNumber(org!._id, "expense", org?.expensePrefix ?? "EXP");
  const canApprove = user.permissions.includes("finance.approve_expense") || user.roleSlug === "owner";
  return Expense.create({
    number,
    type: type.slug,
    category: cat.slug,
    categoryId: cat._id,
    amount: body.amount,
    tax: body.tax ?? 0,
    method: body.method,
    vendor: body.vendor?.trim() || undefined,
    date: body.date ? new Date(body.date) : new Date(),
    notes: body.notes?.trim() || undefined,
    organizationId: user.organizationId,
    branchId: user.branchId,
    createdBy: user.id,
    approvalStatus: canApprove ? "approved" : "pending",
    approvedBy: canApprove ? user.id : undefined
  });
}

export async function decideExpense(user: AuthUser, id: string, status: "approved" | "rejected", notes?: string) {
  const expense = await Expense.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!expense) throw ApiError.notFound("Expense not found");
  if (!["pending", "draft"].includes(expense.approvalStatus) && expense.approvalStatus === status) return expense;
  if (status === "rejected" && String(notes ?? "").trim().length < 3) {
    throw ApiError.unprocessable("A reason is required to reject an expense");
  }
  expense.approvalStatus = status;
  expense.approvedBy = user.id;
  if (notes) expense.notes = [expense.notes, notes].filter(Boolean).join(" · ");
  await expense.save();
  return expense;
}
