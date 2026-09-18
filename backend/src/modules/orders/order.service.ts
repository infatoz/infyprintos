import mongoose from "mongoose";
import { z } from "zod";
import { ApiError } from "../../common/errors";
import { nextNumber } from "../../common/numbering";
import { customerSnapshot, dueDateFromTerm, priceDocument } from "../../common/pricing";
import { wouldExceedCredit } from "../../common/credit";
import { withOptionalTransaction } from "../../common/transaction";
import { Order, OrderStatusHistory } from "../../models/Order";
import { Customer, CreditTerm } from "../../models/Customer";
import { Organization } from "../../models/Organization";
import { Invoice, Payment, Income } from "../../models/Finance";
import { PaymentMethod } from "../../models/Settings";
import type { AuthUser } from "../../middleware/auth";
import { provisionJobsForOrder } from "../production/production.service";

export const lineSchema = z.object({
  itemId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().optional(),
  discountType: z.enum(["fixed", "percent", "none"]).optional(),
  discountValue: z.number().optional(),
  description: z.string().optional()
});

export const documentSchema = z.object({
  customerId: z.string(),
  items: z.array(lineSchema).min(1),
  discountType: z.enum(["fixed", "percent", "none"]).optional(),
  discountValue: z.number().optional(),
  couponCode: z.string().optional(),
  charges: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
  deliveryCharges: z.number().optional(),
  roundOff: z.number().optional(),
  autoRound: z.boolean().optional(),
  taxInclusive: z.boolean().optional(),
  interstate: z.boolean().optional(),
  notes: z.string().optional(),
  paymentMethod: z.string().optional(),
  paymentAmount: z.number().optional(),
  paymentReference: z.string().optional(),
  source: z.enum(["pos", "quotation", "portal", "manual"]).optional(),
  submit: z.boolean().optional(),
  idempotencyKey: z.string().min(8).optional(),
  terms: z.string().optional(),
  validUntil: z.string().optional()
});

export type DocumentInput = z.infer<typeof documentSchema>;

function isDuplicateKey(err: unknown) {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000);
}

export async function assertPaymentMethod(organizationId: string, code?: string) {
  if (!code) return;
  const count = await PaymentMethod.countDocuments({ organizationId, deletedAt: null });
  if (!count) return;
  const method = await PaymentMethod.findOne({ organizationId, code, active: true, deletedAt: null });
  if (!method) throw ApiError.badRequest("Invalid payment method");
}

export async function recalcOutstanding(customerId: string, session?: mongoose.ClientSession) {
  const pipeline = Order.aggregate([
    { $match: { customerId: new mongoose.Types.ObjectId(customerId), deletedAt: null, status: { $nin: ["cancelled"] } } },
    { $group: { _id: null, outstanding: { $sum: "$totals.balanceDue" } } }
  ]);
  if (session) pipeline.session(session);
  const unpaid = await pipeline;
  await Customer.findByIdAndUpdate(customerId, { outstanding: unpaid[0]?.outstanding ?? 0 }, session ? { session } : {});
}

export async function priceForCustomer(user: AuthUser, body: DocumentInput, opts?: { lockLinePrices?: boolean }) {
  const customer = await Customer.findOne({ _id: body.customerId, organizationId: user.organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  const priced = await priceDocument({
    organizationId: user.organizationId,
    customerTierId: customer.tierId ? String(customer.tierId) : undefined,
    lines: body.items,
    discountType: body.discountType,
    discountValue: body.discountValue,
    couponCode: body.couponCode,
    charges: body.charges,
    deliveryCharges: body.deliveryCharges,
    roundOff: body.roundOff,
    autoRound: body.autoRound,
    taxInclusive: body.taxInclusive,
    interstate: body.interstate,
    allowPriceOverride:
      Boolean(opts?.lockLinePrices) || user.permissions.includes("orders.price_override") || user.roleSlug === "owner"
  });
  return { customer, priced };
}

export async function createOrderRecord(user: AuthUser, body: DocumentInput, extra?: { quotationId?: string }) {
  const key = body.idempotencyKey?.trim();
  if (key) {
    const existing = await Order.findOne({ organizationId: user.organizationId, idempotencyKey: key, deletedAt: null });
    if (existing) return { order: existing, replayed: true as const };
  }
  if (body.paymentAmount) await assertPaymentMethod(user.organizationId, body.paymentMethod);
  const { customer, priced } = await priceForCustomer(user, body, { lockLinePrices: Boolean(extra?.quotationId) });
  const term = customer.creditTermId ? await CreditTerm.findById(customer.creditTermId) : null;
  const paid = Number(body.paymentAmount ?? 0);
  if (paid > priced.totals.grandTotal + 0.009) throw ApiError.unprocessable("Payment cannot exceed the order total");
  const balanceDue = Math.max(0, priced.totals.grandTotal - paid);
  const credit = wouldExceedCredit({
    creditHold: Boolean(customer.creditHold),
    creditLimit: customer.creditLimit ?? 0,
    outstanding: customer.outstanding ?? 0,
    additionalBalance: balanceDue,
    prepaidRequiresFullPay: term?.type === "prepaid" && Boolean(body.submit),
    balanceDue,
    lifecycleStatus: customer.lifecycleStatus
  });
  if (credit.blocked) throw ApiError.unprocessable(credit.reason);

  try {
  const created = await withOptionalTransaction(async (session) => {
    const org = await Organization.findById(user.organizationId).session(session ?? null);
    const number = await nextNumber(org!._id, "order", org?.orderPrefix ?? "ORD", 5, session);
    const needsDesign = priced.items.some((i) => i.requiresDesign);
    const status = body.submit ? (needsDesign ? "design_pending" : "ready_to_print") : "draft";
    const [order] = await Order.create(
      [
        {
          organizationId: user.organizationId,
          branchId: user.branchId,
          number,
          idempotencyKey: key,
          quotationId: extra?.quotationId,
          customerId: customer._id,
          customerSnapshot: customerSnapshot(customer),
          status,
          source: body.source ?? "pos",
          items: priced.items.map((i) => ({ ...i, designStatus: i.requiresDesign ? "pending" : "not_required" })),
          charges: body.charges ?? [],
          discountType: body.discountType ?? "none",
          discountValue: body.discountValue ?? 0,
          couponCode: body.couponCode,
          deliveryCharges: body.deliveryCharges ?? 0,
          roundOff: priced.totals.roundOff,
          taxInclusive: body.taxInclusive ?? false,
          interstate: body.interstate ?? false,
          totals: { ...priced.totals, paidAmount: paid, balanceDue },
          paymentMethod: body.paymentMethod,
          creditTerm: term?.slug,
          dueDate: dueDateFromTerm(term),
          notes: body.notes,
          createdBy: user.id
        }
      ],
      { session }
    );
    await OrderStatusHistory.create(
      [{ organizationId: user.organizationId, orderId: order._id, toStatus: status, userId: user.id }],
      { session }
    );
    if (paid > 0) {
      const payNo = await nextNumber(org!._id, "receipt", org?.receiptPrefix ?? "RCT", 5, session);
      const [payment] = await Payment.create(
        [
          {
            organizationId: user.organizationId,
            branchId: user.branchId,
            number: payNo,
            orderId: order._id,
            customerId: customer._id,
            amount: paid,
            method: body.paymentMethod ?? "cash",
            reference: body.paymentReference,
            collectedBy: user.id,
            status: "completed"
          }
        ],
        { session }
      );
      await Income.create(
        [
          {
            organizationId: user.organizationId,
            category: "order_payment",
            amount: paid,
            method: body.paymentMethod ?? "cash",
            customerId: customer._id,
            orderId: order._id,
            paymentId: payment._id
          }
        ],
        { session }
      );
    }
    const invNo = await nextNumber(org!._id, "invoice", org?.invoicePrefix ?? "INV", 5, session);
    await Invoice.create(
      [
        {
          organizationId: user.organizationId,
          number: invNo,
          type: "tax_invoice",
          orderId: order._id,
          customerId: customer._id,
          snapshot: { customer: order.customerSnapshot, items: order.items, totals: order.totals },
          totals: order.totals,
          dueDate: order.dueDate,
          status: balanceDue <= 0 ? "paid" : paid > 0 ? "partial" : "issued"
        }
      ],
      { session }
    );
    await recalcOutstanding(String(customer._id), session);
    return { order, replayed: false as const };
  });
  if (!created.replayed && created.order.status === "ready_to_print") {
    await provisionJobsForOrder(user, created.order);
  }
  return created;
  } catch (err) {
    if (key && isDuplicateKey(err)) {
      const existing = await Order.findOne({ organizationId: user.organizationId, idempotencyKey: key, deletedAt: null });
      if (existing) return { order: existing, replayed: true as const };
    }
    throw err;
  }
}

export async function recordOrderPayment(
  user: AuthUser,
  orderId: string,
  body: { amount: number; method: string; reference?: string; notes?: string }
) {
  await assertPaymentMethod(user.organizationId, body.method);
  const order = await Order.findOne({ _id: orderId, organizationId: user.organizationId, deletedAt: null });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "cancelled") throw ApiError.unprocessable("Cannot collect payment on a cancelled order");
  if (body.reference) {
    const existing = await Payment.findOne({
      organizationId: user.organizationId,
      orderId: order._id,
      reference: body.reference,
      status: "completed"
    });
    if (existing) return { payment: existing, order, replayed: true as const };
  }
  const due = Number(order.totals.balanceDue ?? order.totals.grandTotal);
  if (body.amount > due + 0.009) throw ApiError.unprocessable("Payment exceeds outstanding balance");

  try {
  return await withOptionalTransaction(async (session) => {
    const org = await Organization.findById(user.organizationId).session(session ?? null);
    const payNo = await nextNumber(org!._id, "receipt", org?.receiptPrefix ?? "RCT", 5, session);
    const [payment] = await Payment.create(
      [
        {
          organizationId: user.organizationId,
          branchId: user.branchId,
          number: payNo,
          orderId: order._id,
          customerId: order.customerId,
          amount: body.amount,
          method: body.method,
          reference: body.reference,
          notes: body.notes,
          collectedBy: user.id,
          status: "completed"
        }
      ],
      { session }
    );
    const paidAmount = Number(order.totals.paidAmount ?? 0) + body.amount;
    order.totals.paidAmount = paidAmount;
    order.totals.balanceDue = Math.max(0, Number(order.totals.grandTotal) - paidAmount);
    await order.save({ session });
    await Income.create(
      [
        {
          organizationId: user.organizationId,
          category: "order_payment",
          amount: body.amount,
          method: body.method,
          customerId: order.customerId,
          orderId: order._id,
          paymentId: payment._id
        }
      ],
      { session }
    );
    await Invoice.updateOne(
      { orderId: order._id },
      { status: order.totals.balanceDue <= 0 ? "paid" : "partial", "totals.paidAmount": paidAmount, "totals.balanceDue": order.totals.balanceDue },
      { session }
    );
    await recalcOutstanding(String(order.customerId), session);
    return { payment, order, replayed: false as const };
  });
  } catch (err) {
    if (body.reference && isDuplicateKey(err)) {
      const existing = await Payment.findOne({
        organizationId: user.organizationId,
        orderId: order._id,
        reference: body.reference,
        status: "completed"
      });
      if (existing) return { payment: existing, order, replayed: true as const };
    }
    throw err;
  }
}
