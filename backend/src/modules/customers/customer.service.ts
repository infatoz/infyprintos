import QRCode from "qrcode";
import { ApiError } from "../../common/errors";
import { nextNumber } from "../../common/numbering";
import { randomToken } from "../../common/crypto";
import { publicUrl, queueNotification, shareFromLog } from "../../common/notify";
import { parsePagination, escapeRegex } from "../../common/pagination";
import { hasPermission } from "../../common/permissions";
import { roundMoney } from "../../common/money";
import { recalcOutstanding } from "../orders/order.service";
import type { AuthUser } from "../../middleware/auth";
import type { AuthedRequest } from "../../middleware/auth";
import { writeAudit } from "../../middleware/audit";
import { Organization } from "../../models/Organization";
import { User } from "../../models/User";
import { Order } from "../../models/Order";
import { Quotation } from "../../models/Quotation";
import { Invoice, Payment, Income } from "../../models/Finance";
import {
  Customer,
  CustomerAddress,
  CustomerDocument,
  CustomerTier,
  MembershipCard,
  CustomerContact,
  CustomerActivity,
  CustomerCreditEvent
} from "../../models/Customer";
import {
  GST_STATES,
  assertNoDuplicate,
  assertTaxIdentity,
  persistAddresses,
  toCustomerFields,
  type ActivityPayload,
  type ContactPayload,
  type CustomerPatch,
  type CustomerPayload
} from "./customer.helpers";

const SORTS = new Set(["createdAt", "-createdAt", "name", "-name", "outstanding", "-outstanding", "code", "-code", "phone", "-phone", "overdue", "-overdue"]);
const GSTIN_REQUIRED = new Set(["registered", "composition", "sez"]);

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function idsEqual(a: unknown, b: unknown) {
  return String(a ?? "") === String(b ?? "");
}

export async function loadCardPayload(card: { toObject?: () => Record<string, unknown>; qrToken: string; status?: string } | null) {
  if (!card) return null;
  const verifyUrl = publicUrl(`/card/${card.qrToken}`);
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 });
  const base = typeof card.toObject === "function" ? card.toObject() : card;
  return { ...base, verifyUrl, qrDataUrl };
}

export async function logActivity(opts: {
  organizationId: string;
  branchId?: string;
  customerId: string;
  type: string;
  body?: string;
  meta?: unknown;
  createdBy?: string;
}) {
  await CustomerActivity.create({
    organizationId: opts.organizationId,
    branchId: opts.branchId,
    customerId: opts.customerId,
    type: opts.type,
    body: opts.body,
    meta: opts.meta,
    createdBy: opts.createdBy
  });
  await Customer.findByIdAndUpdate(opts.customerId, { lastActivityAt: new Date() });
}

export async function logCreditEvent(opts: {
  organizationId: string;
  branchId?: string;
  customerId: string;
  type: "limit_change" | "term_change" | "hold" | "release" | "recalc" | "merge";
  previous?: unknown;
  next?: unknown;
  reason: string;
  createdBy: string;
}) {
  await CustomerCreditEvent.create({
    organizationId: opts.organizationId,
    branchId: opts.branchId,
    customerId: opts.customerId,
    type: opts.type,
    previous: opts.previous,
    next: opts.next,
    reason: opts.reason,
    createdBy: opts.createdBy
  });
  await logActivity({
    organizationId: opts.organizationId,
    branchId: opts.branchId,
    customerId: opts.customerId,
    type: "credit",
    body: opts.reason,
    meta: { event: opts.type, previous: opts.previous, next: opts.next },
    createdBy: opts.createdBy
  });
}

export async function expireOverdueKyc(customerId: string) {
  const now = new Date();
  await CustomerDocument.updateMany(
    {
      customerId,
      deletedAt: null,
      expiresAt: { $lte: now },
      status: { $nin: ["expired", "rejected"] }
    },
    { status: "expired" }
  );
}

export async function recalcCustomerBalances(customerId: string) {
  await recalcOutstanding(customerId);
  const invoices = await Invoice.find({
    customerId,
    deletedAt: null,
    status: { $nin: ["paid", "void"] }
  }).select("status dueDate totals");
  const now = new Date();
  const overdue = invoices.reduce((sum: number, inv: { status?: string; dueDate?: Date; totals?: { balanceDue?: number } }) => {
    const due = Number(inv.totals?.balanceDue ?? 0);
    const late =
      inv.status === "overdue" || (inv.dueDate && inv.dueDate < now && due > 0 && inv.status !== "paid" && inv.status !== "void");
    return late ? sum + due : sum;
  }, 0);
  const customer = await Customer.findByIdAndUpdate(customerId, { overdue: roundMoney(overdue) }, { new: true });
  return { outstanding: customer?.outstanding ?? 0, overdue: roundMoney(overdue) };
}

function agingBucket(dueDate: Date | undefined, now: Date) {
  const start = dueDate ? new Date(dueDate) : now;
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  if (days <= 30) return "current" as const;
  if (days <= 60) return "days31_60" as const;
  if (days <= 90) return "days61_90" as const;
  return "days90plus" as const;
}

export async function customerStatement(organizationId: string, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  const balances = await recalcCustomerBalances(customerId);
  const now = new Date();
  const invoices = await Invoice.find({
    organizationId,
    customerId,
    deletedAt: null,
    status: { $nin: ["void"] }
  })
    .select("number type status totals dueDate createdAt orderId")
    .sort("-createdAt")
    .limit(200);
  const aging = { current: 0, days31_60: 0, days61_90: 0, days90plus: 0 };
  const open = invoices
    .filter((inv: { status?: string; totals?: { balanceDue?: number } }) => {
      const due = Number(inv.totals?.balanceDue ?? 0);
      return due > 0 && inv.status !== "paid" && inv.status !== "void";
    })
    .map((inv: { number: string; status?: string; totals?: { grandTotal?: number; balanceDue?: number }; dueDate?: Date; createdAt?: Date; _id: unknown }) => {
      const balanceDue = roundMoney(Number(inv.totals?.balanceDue ?? 0));
      const bucket = agingBucket(inv.dueDate ?? inv.createdAt, now);
      aging[bucket] += balanceDue;
      return {
        id: String(inv._id),
        number: inv.number,
        status: inv.status,
        grandTotal: Number(inv.totals?.grandTotal ?? 0),
        balanceDue,
        dueDate: inv.dueDate,
        bucket
      };
    });
  const paid = await Payment.aggregate([
    { $match: { organizationId: customer.organizationId, customerId: customer._id, deletedAt: null, status: "completed" } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);
  return {
    customer: {
      _id: customer._id,
      code: customer.code,
      name: customer.name,
      creditLimit: customer.creditLimit ?? 0,
      creditHold: customer.creditHold,
      taxRegistration: customer.taxRegistration,
      gstState: customer.gstState
    },
    outstanding: balances.outstanding,
    overdue: balances.overdue,
    availableCredit: Math.max(0, Number(customer.creditLimit ?? 0) - Number(balances.outstanding)),
    aging: {
      current: roundMoney(aging.current),
      days31_60: roundMoney(aging.days31_60),
      days61_90: roundMoney(aging.days61_90),
      days90plus: roundMoney(aging.days90plus)
    },
    openInvoices: open,
    lifetimeCollected: roundMoney(paid[0]?.total ?? 0)
  };
}

export async function listAssignees(organizationId: string) {
  return User.find({ organizationId, deletedAt: null, active: true }).select("name email department").sort("name");
}

export async function listCustomers(req: { query: Record<string, unknown>; user: AuthUser }) {
  const { user } = req;
  const { page, limit, skip, search, sort } = parsePagination(req as never);
  const archived = String(req.query.archived ?? "") === "true";
  if (archived && !hasPermission(user, "customers.delete")) throw ApiError.forbidden();
  const filter: Record<string, unknown> = {
    organizationId: user.organizationId,
    deletedAt: archived ? { $ne: null } : null
  };
  if (search) {
    filter.$or = [
      { name: new RegExp(escapeRegex(search), "i") },
      { phone: new RegExp(escapeRegex(search), "i") },
      { email: new RegExp(escapeRegex(search), "i") },
      { code: new RegExp(escapeRegex(search), "i") },
      { "business.name": new RegExp(escapeRegex(search), "i") },
      { "business.gstin": new RegExp(escapeRegex(search), "i") },
      { "business.pan": new RegExp(escapeRegex(search), "i") }
    ];
  }
  if (req.query.tierId) filter.tierId = req.query.tierId;
  if (req.query.creditHold === "true") filter.creditHold = true;
  if (req.query.creditHold === "false") filter.creditHold = false;
  if (req.query.active === "true") filter.active = true;
  if (req.query.active === "false") filter.active = false;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.source) filter.source = new RegExp(escapeRegex(String(req.query.source)), "i");
  if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
  if (req.query.taxRegistration) filter.taxRegistration = req.query.taxRegistration;
  if (req.query.lifecycleStatus) filter.lifecycleStatus = req.query.lifecycleStatus;
  if (req.query.overdue === "true") filter.overdue = { $gt: 0 };
  if (req.query.kycExpired === "true") {
    const ids = await CustomerDocument.find({
      organizationId: user.organizationId,
      deletedAt: null,
      $or: [{ status: "expired" }, { expiresAt: { $lte: new Date() } }]
    }).distinct("customerId");
    filter._id = { $in: ids };
  }
  const sortBy = SORTS.has(sort) ? sort : "-createdAt";
  const [rows, total] = await Promise.all([
    Customer.find(filter).populate("tierId creditTermId assignedTo", "name email slug discountPercent color type netDays").skip(skip).limit(limit).sort(sortBy),
    Customer.countDocuments(filter)
  ]);
  return { rows, page, limit, total };
}

export async function customerMetrics(organizationId: string) {
  const base = { organizationId, deletedAt: null };
  const [total, onHold, overdue, prospects, blocked, outstanding] = await Promise.all([
    Customer.countDocuments(base),
    Customer.countDocuments({ ...base, creditHold: true }),
    Customer.countDocuments({ ...base, overdue: { $gt: 0 } }),
    Customer.countDocuments({ ...base, lifecycleStatus: "prospect" }),
    Customer.countDocuments({ ...base, lifecycleStatus: "blocked" }),
    Customer.aggregate([{ $match: base }, { $group: { _id: null, outstanding: { $sum: "$outstanding" }, overdue: { $sum: "$overdue" } } }])
  ]);
  return {
    total,
    onHold,
    overdue,
    prospects,
    blocked,
    ar: {
      outstanding: roundMoney(outstanding[0]?.outstanding ?? 0),
      overdue: roundMoney(outstanding[0]?.overdue ?? 0)
    }
  };
}

export async function getCustomerDetail(organizationId: string, id: string, includeDeleted = false) {
  const filter: Record<string, unknown> = { _id: id, organizationId };
  if (!includeDeleted) filter.deletedAt = null;
  const customer = await Customer.findOne(filter).populate("tierId creditTermId assignedTo", "name email slug discountPercent color type netDays");
  if (!customer) throw ApiError.notFound("Customer not found");
  await expireOverdueKyc(String(customer._id));
  const [addresses, documents, card, contacts, activities, creditEvents] = await Promise.all([
    CustomerAddress.find({ customerId: customer._id, deletedAt: null }).sort("-isDefault type"),
    CustomerDocument.find({ customerId: customer._id, deletedAt: null }).populate("fileId verifiedBy", "originalName mimeType name email"),
    MembershipCard.findOne({ customerId: customer._id }),
    CustomerContact.find({ customerId: customer._id, deletedAt: null }).sort("-isPrimary name"),
    CustomerActivity.find({ customerId: customer._id, deletedAt: null }).populate("createdBy", "name email").sort("-createdAt").limit(40),
    CustomerCreditEvent.find({ customerId: customer._id, deletedAt: null }).populate("createdBy", "name email").sort("-createdAt").limit(20)
  ]);
  const now = new Date();
  const kycExpired = documents.some(
    (doc: { status?: string; expiresAt?: Date }) => doc.status === "expired" || (doc.expiresAt && doc.expiresAt <= now)
  );
  return {
    customer,
    addresses,
    documents,
    contacts,
    activities,
    creditEvents,
    kycExpired,
    card: await loadCardPayload(card)
  };
}

export async function issueMembership(opts: {
  organizationId: string;
  branchId?: string;
  customerId: string;
  tierName?: string;
}) {
  const card = await MembershipCard.create({
    organizationId: opts.organizationId,
    branchId: opts.branchId,
    customerId: opts.customerId,
    membershipId: `INF-${randomToken(4).slice(0, 8).toUpperCase()}`,
    qrToken: randomToken(16),
    tierName: opts.tierName ?? "Basic",
    status: "active"
  });
  return card;
}

export async function createCustomer(req: AuthedRequest, body: CustomerPayload) {
  const { user } = req;
  if (body.lifecycleStatus === "blocked" && !hasPermission(user, "customers.credit")) {
    throw ApiError.forbidden("Blocking a customer requires customers.credit permission");
  }
  assertTaxIdentity({ gstin: body.business?.gstin, pan: body.business?.pan, taxRegistration: body.taxRegistration });
  await assertNoDuplicate({
    organizationId: user.organizationId,
    phone: body.phone,
    email: body.email,
    gstin: body.business?.gstin
  });
  const org = await Organization.findById(user.organizationId);
  const code = await nextNumber(org!._id, "customer", org?.customerPrefix ?? "CUS");
  const customer = await Customer.create({
    ...compact(toCustomerFields(body)),
    organizationId: user.organizationId,
    branchId: user.branchId,
    code,
    lastActivityAt: new Date()
  });
  await persistAddresses(user.organizationId, String(customer._id), body);
  const tier = body.tierId ? await CustomerTier.findById(body.tierId) : null;
  const card = await issueMembership({
    organizationId: user.organizationId,
    branchId: user.branchId,
    customerId: String(customer._id),
    tierName: tier?.name ?? "Basic"
  });
  await logActivity({
    organizationId: user.organizationId,
    branchId: user.branchId,
    customerId: String(customer._id),
    type: "system",
    body: "Customer created",
    createdBy: user.id
  });
  if (Number(body.creditLimit ?? 0) > 0) {
    await logCreditEvent({
      organizationId: user.organizationId,
      branchId: user.branchId,
      customerId: String(customer._id),
      type: "limit_change",
      previous: 0,
      next: body.creditLimit,
      reason: body.creditReason?.trim() || "Initial credit limit on create",
      createdBy: user.id
    });
  }
  const log = await queueNotification({
    organizationId: user.organizationId,
    event: "customer_created",
    to: customer.whatsapp || customer.phone,
    vars: { customer_name: customer.name, membership_id: card.membershipId, business_name: org?.name },
    referenceType: "Customer",
    referenceId: String(customer._id)
  });
  await writeAudit(req, "customer.create", "Customer", String(customer._id), null, { code, name: customer.name });
  return { customer, card: await loadCardPayload(card), whatsapp: shareFromLog(log) };
}

function creditFieldsChanged(existing: { creditLimit?: number; creditTermId?: unknown; creditHold?: boolean; lifecycleStatus?: string }, next: { creditLimit?: number; creditTermId?: unknown; lifecycleStatus?: string }) {
  const limitChanged = next.creditLimit != null && Number(next.creditLimit) !== Number(existing.creditLimit ?? 0);
  const termChanged = next.creditTermId !== undefined && !idsEqual(next.creditTermId, existing.creditTermId);
  const blockedChanged = next.lifecycleStatus === "blocked" && existing.lifecycleStatus !== "blocked";
  return { limitChanged, termChanged, blockedChanged, any: limitChanged || termChanged || blockedChanged };
}

export async function updateCustomer(req: AuthedRequest, id: string, body: CustomerPatch) {
  const { user } = req;
  const existing = await Customer.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Customer not found");
  const tax = assertTaxIdentity({
    gstin: body.business?.gstin ?? existing.business?.gstin,
    pan: body.business?.pan ?? existing.business?.pan,
    taxRegistration: body.taxRegistration ?? existing.taxRegistration
  });
  if (GSTIN_REQUIRED.has(tax.taxRegistration) && !tax.gstin) {
    throw ApiError.unprocessable("GSTIN is required for this tax registration type");
  }
  await assertNoDuplicate({
    organizationId: user.organizationId,
    phone: body.phone ?? existing.phone,
    email: body.email ?? existing.email,
    gstin: body.business?.gstin ?? existing.business?.gstin,
    excludeId: String(existing._id)
  });

  const nextLimit = body.creditLimit ?? existing.creditLimit;
  const nextTerm = body.creditTermId !== undefined ? body.creditTermId || null : existing.creditTermId;
  const changes = creditFieldsChanged(existing, {
    creditLimit: body.creditLimit,
    creditTermId: body.creditTermId !== undefined ? body.creditTermId || "" : undefined,
    lifecycleStatus: body.lifecycleStatus
  });
  if (changes.any && !hasPermission(user, "customers.credit")) {
    throw ApiError.forbidden("Credit limit, terms and blocked status require customers.credit permission");
  }
  if (changes.any && !body.creditReason?.trim()) {
    throw ApiError.unprocessable("A reason is required for credit or blocked-status changes");
  }

  const merged: CustomerPayload = {
    name: body.name ?? existing.name,
    phone: body.phone ?? existing.phone,
    whatsapp: body.whatsapp ?? existing.whatsapp,
    email: body.email ?? existing.email,
    alternatePhone: body.alternatePhone ?? existing.alternatePhone,
    type: body.type ?? existing.type,
    tags: body.tags ?? existing.tags,
    source: body.source ?? existing.source,
    notes: body.notes ?? existing.notes,
    assignedTo: body.assignedTo !== undefined ? body.assignedTo : String(existing.assignedTo ?? ""),
    tierId: body.tierId ?? String(existing.tierId ?? ""),
    creditTermId: nextTerm ? String(nextTerm) : "",
    creditLimit: nextLimit,
    taxRegistration: body.taxRegistration ?? existing.taxRegistration,
    lifecycleStatus: body.lifecycleStatus ?? existing.lifecycleStatus,
    whatsappOptIn: body.whatsappOptIn ?? existing.whatsappOptIn,
    sameAddress: body.sameAddress ?? existing.sameAddress,
    billingPreferences: body.billingPreferences ?? existing.billingPreferences,
    business: body.business ?? existing.business,
    address: body.address,
    addresses: body.addresses
  };
  const customer = await Customer.findOneAndUpdate(
    { _id: existing._id, organizationId: user.organizationId, deletedAt: null },
    compact(toCustomerFields(merged)),
    { new: true }
  );
  if (body.address || body.addresses || typeof body.sameAddress === "boolean") {
    await persistAddresses(user.organizationId, String(existing._id), { ...body, sameAddress: body.sameAddress ?? existing.sameAddress }, true);
  }
  if (body.tierId) {
    const tier = await CustomerTier.findById(body.tierId);
    if (tier) await MembershipCard.updateOne({ customerId: existing._id }, { tierName: tier.name });
  }
  if (changes.limitChanged) {
    await logCreditEvent({
      organizationId: user.organizationId,
      branchId: user.branchId,
      customerId: String(existing._id),
      type: "limit_change",
      previous: existing.creditLimit,
      next: nextLimit,
      reason: body.creditReason!.trim(),
      createdBy: user.id
    });
  }
  if (changes.termChanged) {
    await logCreditEvent({
      organizationId: user.organizationId,
      branchId: user.branchId,
      customerId: String(existing._id),
      type: "term_change",
      previous: existing.creditTermId,
      next: nextTerm,
      reason: body.creditReason!.trim(),
      createdBy: user.id
    });
  }
  if (body.lifecycleStatus && body.lifecycleStatus !== existing.lifecycleStatus) {
    await logActivity({
      organizationId: user.organizationId,
      branchId: user.branchId,
      customerId: String(existing._id),
      type: "status_change",
      body: `Status ${existing.lifecycleStatus ?? "active"} → ${body.lifecycleStatus}`,
      createdBy: user.id
    });
    if (body.lifecycleStatus === "blocked") {
      await Customer.findByIdAndUpdate(existing._id, { creditHold: true, creditHoldReason: body.creditReason?.trim() || "Blocked" });
    }
  }
  if (body.assignedTo !== undefined && !idsEqual(body.assignedTo, existing.assignedTo)) {
    await logActivity({
      organizationId: user.organizationId,
      branchId: user.branchId,
      customerId: String(existing._id),
      type: "assignment",
      body: body.assignedTo ? "Account owner updated" : "Account owner cleared",
      createdBy: user.id
    });
  }
  await writeAudit(req, "customer.update", "Customer", String(existing._id), existing.toObject(), customer);
  return customer;
}

export async function archiveCustomer(req: AuthedRequest, id: string) {
  const customer = await Customer.findOneAndUpdate(
    { _id: id, organizationId: req.user.organizationId, deletedAt: null },
    { deletedAt: new Date(), active: false },
    { new: true }
  );
  if (!customer) throw ApiError.notFound("Customer not found");
  await logActivity({
    organizationId: req.user.organizationId,
    branchId: req.user.branchId,
    customerId: id,
    type: "system",
    body: "Customer archived",
    createdBy: req.user.id
  });
  await writeAudit(req, "customer.delete", "Customer", String(customer._id), { name: customer.name, code: customer.code });
  return { archived: true };
}

export async function restoreCustomer(req: AuthedRequest, id: string) {
  const customer = await Customer.findOne({ _id: id, organizationId: req.user.organizationId, deletedAt: { $ne: null } });
  if (!customer) throw ApiError.notFound("Archived customer not found");
  customer.deletedAt = null;
  customer.active = true;
  await customer.save();
  await logActivity({
    organizationId: req.user.organizationId,
    branchId: req.user.branchId,
    customerId: id,
    type: "system",
    body: "Customer restored",
    createdBy: req.user.id
  });
  await writeAudit(req, "customer.restore", "Customer", id, null, { code: customer.code });
  return customer;
}

export async function setCreditHold(req: AuthedRequest, id: string, hold: boolean, reason: string) {
  const { user } = req;
  const existing = await Customer.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Customer not found");
  const customer = await Customer.findOneAndUpdate(
    { _id: id, organizationId: user.organizationId, deletedAt: null },
    { creditHold: hold, creditHoldReason: hold ? reason : undefined, lifecycleStatus: hold ? existing.lifecycleStatus : existing.lifecycleStatus },
    { new: true }
  );
  await logCreditEvent({
    organizationId: user.organizationId,
    branchId: user.branchId,
    customerId: id,
    type: hold ? "hold" : "release",
    previous: { creditHold: existing.creditHold },
    next: { creditHold: hold },
    reason,
    createdBy: user.id
  });
  await writeAudit(req, "customer.credit_hold", "Customer", id, null, { hold, reason });
  return customer;
}

export async function reissueMembership(req: AuthedRequest, id: string) {
  const { user } = req;
  const customer = await Customer.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  let card = await MembershipCard.findOne({ customerId: customer._id });
  if (!card) {
    const tier = customer.tierId ? await CustomerTier.findById(customer.tierId) : null;
    card = await issueMembership({
      organizationId: user.organizationId,
      branchId: user.branchId,
      customerId: id,
      tierName: tier?.name ?? "Basic"
    });
  } else {
    const previous = card.previousQrTokens ?? [];
    previous.push({ token: card.qrToken, replacedAt: new Date(), replacedBy: user.id });
    card.previousQrTokens = previous;
    card.qrToken = randomToken(16);
    card.reissuedAt = new Date();
    card.reissuedBy = user.id;
    card.status = "active";
    await card.save();
  }
  await logActivity({
    organizationId: user.organizationId,
    branchId: user.branchId,
    customerId: id,
    type: "system",
    body: "Membership QR reissued",
    createdBy: user.id
  });
  await writeAudit(req, "customer.membership.reissue", "MembershipCard", String(card._id));
  return loadCardPayload(card);
}

export async function mergeCustomers(req: AuthedRequest, targetId: string, sourceId: string, reason: string) {
  const { user } = req;
  if (targetId === sourceId) throw ApiError.badRequest("Cannot merge a customer into itself");
  const [target, source] = await Promise.all([
    Customer.findOne({ _id: targetId, organizationId: user.organizationId, deletedAt: null }),
    Customer.findOne({ _id: sourceId, organizationId: user.organizationId, deletedAt: null })
  ]);
  if (!target || !source) throw ApiError.notFound("Customer not found");

  const fill: Record<string, unknown> = {};
  if (!target.email && source.email) fill.email = source.email;
  if (!target.business?.gstin && source.business?.gstin) {
    fill.business = {
      ...(target.business?.toObject?.() ?? target.business ?? {}),
      ...(source.business?.toObject?.() ?? source.business ?? {})
    };
    fill.taxRegistration = target.taxRegistration === "unregistered" ? source.taxRegistration : target.taxRegistration;
    fill.gstState = target.gstState || source.gstState;
    fill.gstStateCode = target.gstStateCode || source.gstStateCode;
  }
  if (!target.assignedTo && source.assignedTo) fill.assignedTo = source.assignedTo;
  if (Object.keys(fill).length) await Customer.findByIdAndUpdate(target._id, fill);

  const from = source._id;
  const to = target._id;
  await Promise.all([
    Order.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to }),
    Quotation.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to }),
    Invoice.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to }),
    Payment.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to }),
    Income.updateMany({ customerId: from }, { customerId: to }),
    CustomerAddress.updateMany({ customerId: from, organizationId: user.organizationId, deletedAt: null }, { customerId: to, isDefault: false }),
    CustomerDocument.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to }),
    CustomerContact.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to, isPrimary: false }),
    CustomerActivity.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to }),
    CustomerCreditEvent.updateMany({ customerId: from, organizationId: user.organizationId }, { customerId: to })
  ]);
  await MembershipCard.updateOne({ customerId: from }, { status: "revoked" });
  source.deletedAt = new Date();
  source.active = false;
  source.mergedInto = target._id;
  await source.save();
  await logCreditEvent({
    organizationId: user.organizationId,
    branchId: user.branchId,
    customerId: targetId,
    type: "merge",
    previous: { sourceId, sourceCode: source.code },
    next: { targetId, targetCode: target.code },
    reason,
    createdBy: user.id
  });
  await recalcCustomerBalances(targetId);
  await Customer.findByIdAndUpdate(sourceId, { outstanding: 0, overdue: 0 });
  await writeAudit(req, "customer.merge", "Customer", targetId, { sourceId, sourceCode: source.code }, { targetCode: target.code });
  return getCustomerDetail(user.organizationId, targetId);
}

export async function getHistory(organizationId: string, id: string) {
  const customer = await Customer.findOne({ _id: id, organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  const cid = customer._id;
  const [orders, quotations, invoices, payments] = await Promise.all([
    Order.find({ organizationId, customerId: cid, deletedAt: null })
      .select("number status totals createdAt expectedDate")
      .sort("-createdAt")
      .limit(50),
    Quotation.find({ organizationId, customerId: cid, deletedAt: null })
      .select("number status totals createdAt validUntil")
      .sort("-createdAt")
      .limit(50),
    Invoice.find({ organizationId, customerId: cid, deletedAt: null })
      .select("number type status totals dueDate createdAt orderId")
      .sort("-createdAt")
      .limit(50),
    Payment.find({ organizationId, customerId: cid, deletedAt: null })
      .select("number amount method reference paidAt status orderId")
      .sort("-paidAt")
      .limit(50)
  ]);
  const balances = await recalcCustomerBalances(String(cid));
  return { orders, quotations, invoices, payments, outstanding: balances.outstanding, overdue: balances.overdue };
}

export async function upsertContact(req: AuthedRequest, customerId: string, body: Partial<ContactPayload>, contactId?: string) {
  const owner = await Customer.findOne({ _id: customerId, organizationId: req.user.organizationId, deletedAt: null });
  if (!owner) throw ApiError.notFound("Customer not found");
  const payload = {
    ...body,
    email: body.email || undefined,
    organizationId: req.user.organizationId,
    customerId
  };
  let contact;
  if (contactId) {
    contact = await CustomerContact.findOneAndUpdate(
      { _id: contactId, customerId, organizationId: req.user.organizationId, deletedAt: null },
      payload,
      { new: true }
    );
    if (!contact) throw ApiError.notFound("Contact not found");
  } else {
    if (!body.name || body.name.trim().length < 2) throw ApiError.unprocessable("Contact name is required");
    contact = await CustomerContact.create({ ...payload, name: body.name.trim() });
  }
  if (contact.isPrimary) {
    await CustomerContact.updateMany(
      { customerId, organizationId: req.user.organizationId, _id: { $ne: contact._id }, deletedAt: null },
      { isPrimary: false }
    );
  }
  await writeAudit(req, contactId ? "customer.contact.update" : "customer.contact.create", "CustomerContact", String(contact._id));
  return contact;
}

export async function addActivity(req: AuthedRequest, customerId: string, body: ActivityPayload) {
  const owner = await Customer.findOne({ _id: customerId, organizationId: req.user.organizationId, deletedAt: null });
  if (!owner) throw ApiError.notFound("Customer not found");
  const activity = await CustomerActivity.create({
    organizationId: req.user.organizationId,
    branchId: req.user.branchId,
    customerId,
    type: body.type,
    body: body.body,
    meta: body.meta,
    createdBy: req.user.id
  });
  await Customer.findByIdAndUpdate(customerId, { lastActivityAt: new Date() });
  return activity;
}

export { GST_STATES };

export async function setCustomerPhoto(req: AuthedRequest, customerId: string, file: { filename: string }) {
  const customer = await Customer.findOne({ _id: customerId, organizationId: req.user.organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  customer.photoUrl = `/uploads/customers/${file.filename}`;
  await customer.save();
  await logActivity({
    organizationId: req.user.organizationId,
    branchId: req.user.branchId,
    customerId,
    type: "system",
    body: "Profile photo updated",
    createdBy: req.user.id
  });
  return customer;
}

export async function clearCustomerPhoto(req: AuthedRequest, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, organizationId: req.user.organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  await Customer.updateOne({ _id: customer._id }, { $unset: { photoUrl: 1 } });
  return { ...customer.toObject(), photoUrl: undefined };
}

export async function composeCustomerWhatsapp(req: AuthedRequest, customerId: string, event = "customer_created") {
  const customer = await Customer.findOne({ _id: customerId, organizationId: req.user.organizationId, deletedAt: null });
  if (!customer) throw ApiError.notFound("Customer not found");
  const [org, card] = await Promise.all([
    Organization.findById(req.user.organizationId),
    MembershipCard.findOne({ customerId: customer._id })
  ]);
  const log = await queueNotification({
    organizationId: req.user.organizationId,
    event,
    to: customer.whatsapp || customer.phone,
    vars: {
      customer_name: customer.name,
      membership_id: card?.membershipId,
      business_name: org?.name
    },
    referenceType: "Customer",
    referenceId: String(customer._id)
  });
  return { customer, whatsapp: shareFromLog(log) };
}
