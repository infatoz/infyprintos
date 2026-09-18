import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { Expense, Income, Invoice, Payment } from "../../models/Finance";
import { Organization } from "../../models/Organization";
import { Order } from "../../models/Order";
import { Customer } from "../../models/Customer";
import { writeDocumentPdf, businessFromOrg, partyFromSnapshot } from "../../common/pdf";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requireAny, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import {
  categoryInputSchema,
  createExpense,
  createExpenseCategory,
  createExpenseType,
  createPaymentMethod,
  decideExpense,
  deleteExpenseCategory,
  deleteExpenseType,
  deletePaymentMethod,
  expenseInputSchema,
  listExpenseCategories,
  listExpenseTypes,
  listPaymentMethods,
  paymentMethodInputSchema,
  typeInputSchema,
  updateExpenseCategory,
  updateExpenseType,
  updatePaymentMethod
} from "./finance.service";

const router = Router();
router.use(authenticate);

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

const masterWrite = requireAny("finance.create_expense", "finance.approve_expense", "settings.manage");

router.get(
  "/expense-types",
  requirePermission("finance.view"),
  asyncHandler(async (req, res) => ok(res, await listExpenseTypes((req as AuthedRequest).user)))
);

router.post(
  "/expense-types",
  masterWrite,
  validate(typeInputSchema),
  asyncHandler(async (req, res) => {
    const type = await createExpenseType((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "finance.type.create", "ExpenseType", String(type._id));
    return created(res, type);
  })
);

router.patch(
  "/expense-types/:id",
  masterWrite,
  validate(typeInputSchema.partial()),
  asyncHandler(async (req, res) => {
    const type = await updateExpenseType((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "finance.type.update", "ExpenseType", String(type._id));
    return ok(res, type);
  })
);

router.delete(
  "/expense-types/:id",
  masterWrite,
  asyncHandler(async (req, res) => {
    const result = await deleteExpenseType((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "finance.type.delete", "ExpenseType", result.id);
    return ok(res, result);
  })
);

router.get(
  "/expense-categories",
  requirePermission("finance.view"),
  asyncHandler(async (req, res) =>
    ok(res, await listExpenseCategories((req as AuthedRequest).user, req.query.type ? String(req.query.type) : undefined))
  )
);

router.post(
  "/expense-categories",
  masterWrite,
  validate(categoryInputSchema),
  asyncHandler(async (req, res) => {
    const category = await createExpenseCategory((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "finance.category.create", "ExpenseCategory", String(category._id));
    return created(res, category);
  })
);

router.patch(
  "/expense-categories/:id",
  masterWrite,
  validate(categoryInputSchema.partial()),
  asyncHandler(async (req, res) => {
    const category = await updateExpenseCategory((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "finance.category.update", "ExpenseCategory", String(category._id));
    return ok(res, category);
  })
);

router.delete(
  "/expense-categories/:id",
  masterWrite,
  asyncHandler(async (req, res) => {
    const result = await deleteExpenseCategory((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "finance.category.delete", "ExpenseCategory", result.id);
    return ok(res, result);
  })
);

router.get(
  "/payment-methods",
  requireAny("finance.view", "finance.payments", "orders.create", "settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const all = req.query.all === "true" && (user.permissions.includes("finance.create_expense") || user.roleSlug === "owner");
    return ok(res, await listPaymentMethods(user, { activeOnly: !all }));
  })
);

router.post(
  "/payment-methods",
  masterWrite,
  validate(paymentMethodInputSchema),
  asyncHandler(async (req, res) => {
    const method = await createPaymentMethod((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "finance.method.create", "PaymentMethod", String(method._id));
    return created(res, method);
  })
);

router.patch(
  "/payment-methods/:id",
  masterWrite,
  validate(paymentMethodInputSchema.partial()),
  asyncHandler(async (req, res) => {
    const method = await updatePaymentMethod((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "finance.method.update", "PaymentMethod", String(method._id));
    return ok(res, method);
  })
);

router.delete(
  "/payment-methods/:id",
  masterWrite,
  asyncHandler(async (req, res) => {
    const result = await deletePaymentMethod((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "finance.method.delete", "PaymentMethod", result.id);
    return ok(res, result);
  })
);

router.get(
  "/expenses",
  requirePermission("finance.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.method) filter.method = req.query.method;
    if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ number: rx }, { vendor: rx }, { notes: rx }];
    }
    const [rows, total] = await Promise.all([
      Expense.find(filter).populate("createdBy", "name").populate("categoryId", "name slug").skip(skip).limit(limit).sort(safeSort(sort, ["date", "amount", "number", "createdAt"], "-date")),
      Expense.countDocuments(filter)
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.post(
  "/expenses",
  requirePermission("finance.create_expense"),
  validate(expenseInputSchema),
  asyncHandler(async (req, res) => {
    const expense = await createExpense((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "expense.create", "Expense", String(expense._id));
    return created(res, expense);
  })
);

router.post(
  "/expenses/:id/approve",
  requirePermission("finance.approve_expense"),
  validate(z.object({ status: z.enum(["approved", "rejected"]).optional(), notes: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const expense = await decideExpense(
      (req as AuthedRequest).user,
      paramId(req.params.id),
      req.body.status ?? "approved",
      req.body.notes
    );
    await writeAudit(req as AuthedRequest, "expense.decide", "Expense", String(expense._id));
    return ok(res, expense);
  })
);

router.get(
  "/payments",
  requirePermission("finance.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
      ...(req.query.method ? { method: req.query.method } : {})
    };
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ number: rx }, { reference: rx }, { method: rx }];
    }
    const [rows, total] = await Promise.all([
      Payment.find(filter).populate("customerId", "name").skip(skip).limit(limit).sort(safeSort(sort, ["paidAt", "amount", "number", "createdAt"], "-paidAt")),
      Payment.countDocuments(filter)
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/payments/:id/receipt.pdf",
  requireAny("finance.view", "finance.payments", "orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const payment = await Payment.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!payment) throw ApiError.notFound("Receipt not found");
    const [org, order, customer] = await Promise.all([
      Organization.findById(user.organizationId),
      payment.orderId ? Order.findById(payment.orderId).select("number customerSnapshot") : null,
      payment.customerId ? Customer.findById(payment.customerId).select("name phone email code business") : null
    ]);
    const party = order?.customerSnapshot
      ? partyFromSnapshot(order.customerSnapshot)
      : partyFromSnapshot({
          name: customer?.name,
          phone: customer?.phone,
          email: customer?.email,
          code: customer?.code,
          businessName: customer?.business?.name,
          gstin: customer?.business?.gstin
        });
    const pdf = await writeDocumentPdf({
      kind: "receipt",
      number: payment.number,
      business: businessFromOrg(org),
      customer: party,
      items: [],
      totals: { subtotal: payment.amount, grandTotal: payment.amount, paidAmount: payment.amount, balanceDue: 0 },
      notes: payment.notes,
      footer: org?.invoiceFooter || org?.invoiceNotes || undefined,
      meta: {
        date: payment.paidAt || payment.createdAt,
        paidAt: payment.paidAt,
        orderNumber: order?.number,
        paymentMethod: payment.method,
        paymentReference: payment.reference,
        placeOfSupply: org?.address?.state
      },
      filename: `${payment.number}.pdf`
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${payment.number}.pdf"`);
    return res.sendFile(pdf.filePath);
  })
);

router.get(
  "/invoices",
  requirePermission("finance.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip } = parsePagination(req);
    const [rows, total] = await Promise.all([
      Invoice.find({
        organizationId: user.organizationId,
        deletedAt: null,
        ...(req.query.customerId ? { customerId: req.query.customerId } : {})
      })
        .skip(skip)
        .limit(limit)
        .sort("-createdAt"),
      Invoice.countDocuments({
        organizationId: user.organizationId,
        deletedAt: null,
        ...(req.query.customerId ? { customerId: req.query.customerId } : {})
      })
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/summary",
  requirePermission("finance.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const oid = new mongoose.Types.ObjectId(user.organizationId);
    const base = { organizationId: oid, deletedAt: null };
    const [incomeAgg, expenseAgg, typeAgg, pending] = await Promise.all([
      Income.aggregate([
        { $match: { ...base, date: { $gte: from, $lte: to } } },
        { $group: { _id: "$method", total: { $sum: "$amount" } } }
      ]),
      Expense.aggregate([
        { $match: { ...base, date: { $gte: from, $lte: to }, approvalStatus: "approved" } },
        { $group: { _id: "$category", total: { $sum: "$amount" } } }
      ]),
      Expense.aggregate([
        { $match: { ...base, date: { $gte: from, $lte: to }, approvalStatus: "approved" } },
        { $group: { _id: "$type", total: { $sum: "$amount" } } }
      ]),
      Expense.countDocuments({ ...base, approvalStatus: "pending" })
    ]);
    const collected = incomeAgg.reduce((s, i) => s + i.total, 0);
    const expenses = expenseAgg.reduce((s, i) => s + i.total, 0);
    return ok(res, {
      collected,
      expenses,
      estimatedProfit: collected - expenses,
      pendingExpenses: pending,
      byMethod: incomeAgg,
      byExpenseCategory: expenseAgg,
      byExpenseType: typeAgg
    });
  })
);

export default router;
