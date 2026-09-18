import { ApiError } from "../../common/errors";
import { Customer, CustomerTier, CreditTerm } from "../../models/Customer";
import { Organization, Branch } from "../../models/Organization";
import { Coupon, Printer, TaxRate } from "../../models/Settings";
import { Order, OrderStatus } from "../../models/Order";
import { User } from "../../models/User";
import type { AuthUser } from "../../middleware/auth";

const TERM_TYPES = ["prepaid", "due_on_billing", "net_days", "custom"] as const;

export type TierInput = {
  name: string;
  slug?: string;
  discountPercent?: number;
  color?: string;
  active?: boolean;
  sortOrder?: number;
};

export type TermInput = {
  name: string;
  slug?: string;
  type: (typeof TERM_TYPES)[number];
  netDays?: number;
  description?: string;
  active?: boolean;
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "item";
}

async function uniqueSlug(model: typeof CustomerTier | typeof CreditTerm, organizationId: string, base: string, excludeId?: string) {
  let slug = base;
  let n = 2;
  for (;;) {
    const clash = await model.findOne({
      organizationId,
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    }).select("_id");
    if (!clash) return slug;
    slug = `${base}_${n++}`;
  }
}

export async function createTier(actor: AuthUser, input: TierInput) {
  const name = input.name.trim();
  if (name.length < 2) throw ApiError.badRequest("Tier name is required");
  const slug = await uniqueSlug(CustomerTier, actor.organizationId, slugify(input.slug || name));
  return CustomerTier.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    name,
    slug,
    discountPercent: Number(input.discountPercent ?? 0),
    color: input.color?.trim() || undefined,
    active: input.active !== false,
    sortOrder: Number(input.sortOrder ?? 0)
  });
}

export async function updateTier(actor: AuthUser, id: string, input: Partial<TierInput>) {
  const existing = await CustomerTier.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Tier not found");
  const next: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw ApiError.badRequest("Tier name is required");
    next.name = name;
  }
  if (input.slug !== undefined) next.slug = await uniqueSlug(CustomerTier, actor.organizationId, slugify(input.slug), id);
  if (input.discountPercent !== undefined) next.discountPercent = Number(input.discountPercent);
  if (input.color !== undefined) next.color = input.color.trim();
  if (input.active !== undefined) next.active = input.active;
  if (input.sortOrder !== undefined) next.sortOrder = Number(input.sortOrder);
  const updated = await CustomerTier.findOneAndUpdate(
    { _id: id, organizationId: actor.organizationId, deletedAt: null },
    next,
    { new: true }
  );
  if (!updated) throw ApiError.notFound("Tier not found");
  return updated;
}

export async function deleteTier(actor: AuthUser, id: string) {
  const existing = await CustomerTier.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Tier not found");
  const used = await Customer.countDocuments({ organizationId: actor.organizationId, tierId: existing._id, deletedAt: null });
  if (used > 0) throw ApiError.conflict(`Reassign ${used} customer${used === 1 ? "" : "s"} before deleting this tier`);
  await CustomerTier.updateOne({ _id: existing._id }, { deletedAt: new Date(), active: false, slug: `${existing.slug}__deleted` });
  return { deleted: true, id: String(existing._id) };
}

export async function createCreditTerm(actor: AuthUser, input: TermInput) {
  const name = input.name.trim();
  if (name.length < 2) throw ApiError.badRequest("Credit term name is required");
  if (!TERM_TYPES.includes(input.type)) throw ApiError.unprocessable("Invalid credit term type");
  const slug = await uniqueSlug(CreditTerm, actor.organizationId, slugify(input.slug || name));
  return CreditTerm.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    name,
    slug,
    type: input.type,
    netDays: Number(input.netDays ?? 0),
    description: input.description?.trim() || undefined,
    active: input.active !== false
  });
}

export async function updateCreditTerm(actor: AuthUser, id: string, input: Partial<TermInput>) {
  const existing = await CreditTerm.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Credit term not found");
  const next: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw ApiError.badRequest("Credit term name is required");
    next.name = name;
  }
  if (input.slug !== undefined) next.slug = await uniqueSlug(CreditTerm, actor.organizationId, slugify(input.slug), id);
  if (input.type !== undefined) {
    if (!TERM_TYPES.includes(input.type)) throw ApiError.unprocessable("Invalid credit term type");
    next.type = input.type;
  }
  if (input.netDays !== undefined) next.netDays = Number(input.netDays);
  if (input.description !== undefined) next.description = input.description.trim();
  if (input.active !== undefined) next.active = input.active;
  const updated = await CreditTerm.findOneAndUpdate(
    { _id: id, organizationId: actor.organizationId, deletedAt: null },
    next,
    { new: true }
  );
  if (!updated) throw ApiError.notFound("Credit term not found");
  return updated;
}

export async function deleteCreditTerm(actor: AuthUser, id: string) {
  const existing = await CreditTerm.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Credit term not found");
  const used = await Customer.countDocuments({ organizationId: actor.organizationId, creditTermId: existing._id, deletedAt: null });
  if (used > 0) throw ApiError.conflict(`Reassign ${used} customer${used === 1 ? "" : "s"} before deleting this credit term`);
  await CreditTerm.updateOne({ _id: existing._id }, { deletedAt: new Date(), active: false, slug: `${existing.slug}__deleted` });
  return { deleted: true, id: String(existing._id) };
}

export const OWNER_ORG_FIELDS = ["name", "legalName", "gstin", "pan"] as const;

const DEFAULT_TAX_RATES = [
  { name: "GST 0%", rate: 0, sortOrder: 10 },
  { name: "GST 5%", rate: 5, sortOrder: 20 },
  { name: "GST 12%", rate: 12, sortOrder: 30 },
  { name: "GST 18%", rate: 18, sortOrder: 40 },
  { name: "GST 28%", rate: 28, sortOrder: 50 }
];

function pickAddress(input: Record<string, unknown> | undefined) {
  if (!input || typeof input !== "object") return undefined;
  const next: Record<string, string> = {};
  for (const key of ["line1", "line2", "city", "state", "pincode", "country"]) {
    if (typeof input[key] === "string") next[key] = (input[key] as string).trim();
  }
  return Object.keys(next).length ? next : undefined;
}

export function operationsPayload(input: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  const strings = [
    "phone",
    "email",
    "whatsapp",
    "website",
    "logoUrl",
    "currency",
    "timezone",
    "invoicePrefix",
    "quotationPrefix",
    "orderPrefix",
    "receiptPrefix",
    "customerPrefix",
    "expensePrefix",
    "jobPrefix",
    "defaultPaymentMethod",
    "defaultWorkflow",
    "invoiceFooter",
    "invoiceNotes"
  ];
  for (const key of strings) {
    if (typeof input[key] === "string") next[key] = (input[key] as string).trim();
  }
  if (input.defaultTaxRate !== undefined) next.defaultTaxRate = Number(input.defaultTaxRate);
  if (input.financialYearStartMonth !== undefined) next.financialYearStartMonth = Number(input.financialYearStartMonth);
  if (input.taxInclusive !== undefined) next.taxInclusive = Boolean(input.taxInclusive);
  if (input.address && typeof input.address === "object") {
    const address = pickAddress(input.address as Record<string, unknown>);
    if (address) next.address = address;
  }
  if (input.workingHours && typeof input.workingHours === "object") {
    const hours = input.workingHours as { start?: string; end?: string };
    next.workingHours = {
      start: typeof hours.start === "string" ? hours.start : "09:00",
      end: typeof hours.end === "string" ? hours.end : "19:00"
    };
  }
  if (Array.isArray(input.holidays)) {
    next.holidays = input.holidays.filter((d): d is string => typeof d === "string" && Boolean(d.trim()));
  }
  return next;
}

export function ownerOrgPayload(input: Record<string, unknown>) {
  const next = operationsPayload(input);
  for (const key of OWNER_ORG_FIELDS) {
    if (typeof input[key] === "string") next[key] = (input[key] as string).trim();
  }
  return next;
}

export async function updateOrganisation(actor: AuthUser, payload: Record<string, unknown>) {
  const org = await Organization.findByIdAndUpdate(actor.organizationId, payload, { new: true });
  if (!org) throw ApiError.notFound("Organisation not found");
  return org;
}

export async function ensureTaxRates(organizationId: string, branchId?: string) {
  for (const row of DEFAULT_TAX_RATES) {
    const exists = await TaxRate.findOne({ organizationId, name: row.name, deletedAt: null }).select("_id");
    if (exists) continue;
    try {
      await TaxRate.create({ ...row, organizationId, branchId, active: true });
    } catch {
      /* concurrent seed */
    }
  }
}

export async function listTaxRates(organizationId: string) {
  await ensureTaxRates(organizationId);
  return TaxRate.find({ organizationId, deletedAt: null }).sort("sortOrder name");
}

export async function createTaxRate(actor: AuthUser, input: { name: string; rate: number; hsn?: string; description?: string; sortOrder?: number; active?: boolean }) {
  const name = input.name.trim();
  if (name.length < 2) throw ApiError.badRequest("Tax rate name is required");
  const clash = await TaxRate.findOne({ organizationId: actor.organizationId, name, deletedAt: null }).select("_id");
  if (clash) throw ApiError.conflict("A tax rate with this name already exists");
  return TaxRate.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    name,
    rate: Number(input.rate),
    hsn: input.hsn?.trim() || undefined,
    description: input.description?.trim() || undefined,
    sortOrder: Number(input.sortOrder ?? 100),
    active: input.active !== false
  });
}

export async function updateTaxRate(actor: AuthUser, id: string, input: Partial<{ name: string; rate: number; hsn: string; description: string; sortOrder: number; active: boolean }>) {
  const existing = await TaxRate.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Tax rate not found");
  if (input.name !== undefined) existing.name = input.name.trim();
  if (input.rate !== undefined) existing.rate = Number(input.rate);
  if (input.hsn !== undefined) existing.hsn = input.hsn.trim();
  if (input.description !== undefined) existing.description = input.description.trim();
  if (input.sortOrder !== undefined) existing.sortOrder = Number(input.sortOrder);
  if (input.active !== undefined) existing.active = input.active;
  await existing.save();
  return existing;
}

export async function deleteTaxRate(actor: AuthUser, id: string) {
  const existing = await TaxRate.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Tax rate not found");
  existing.deletedAt = new Date();
  existing.active = false;
  existing.name = `${existing.name}__deleted_${String(existing._id).slice(-6)}`;
  await existing.save();
  return { deleted: true, id: String(existing._id) };
}

export async function createBranch(actor: AuthUser, input: { name: string; code: string; phone?: string; email?: string; isDefault?: boolean; active?: boolean; address?: Record<string, string> }) {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (name.length < 2) throw ApiError.badRequest("Branch name is required");
  if (code.length < 2) throw ApiError.badRequest("Branch code is required");
  const clash = await Branch.findOne({ organizationId: actor.organizationId, code, deletedAt: null }).select("_id");
  if (clash) throw ApiError.conflict("A branch with this code already exists");
  if (input.isDefault) {
    await Branch.updateMany({ organizationId: actor.organizationId, deletedAt: null }, { isDefault: false });
  }
  return Branch.create({
    organizationId: actor.organizationId,
    name,
    code,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    address: pickAddress(input.address),
    isDefault: Boolean(input.isDefault),
    active: input.active !== false
  });
}

export async function updateBranch(actor: AuthUser, id: string, input: Partial<{ name: string; code: string; phone: string; email: string; isDefault: boolean; active: boolean; address: Record<string, string> }>) {
  const existing = await Branch.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Branch not found");
  if (input.name !== undefined) existing.name = input.name.trim();
  if (input.code !== undefined) existing.code = input.code.trim().toUpperCase();
  if (input.phone !== undefined) existing.phone = input.phone.trim();
  if (input.email !== undefined) existing.email = input.email.trim();
  if (input.address !== undefined) existing.address = pickAddress(input.address);
  if (input.active !== undefined) existing.active = input.active;
  if (input.isDefault) {
    await Branch.updateMany({ organizationId: actor.organizationId, deletedAt: null, _id: { $ne: existing._id } }, { isDefault: false });
    existing.isDefault = true;
  } else if (input.isDefault === false) existing.isDefault = false;
  await existing.save();
  return existing;
}

export async function deleteBranch(actor: AuthUser, id: string) {
  const existing = await Branch.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Branch not found");
  const remaining = await Branch.countDocuments({ organizationId: actor.organizationId, deletedAt: null, _id: { $ne: existing._id } });
  if (remaining < 1) throw ApiError.conflict("Keep at least one branch");
  const staff = await User.countDocuments({ organizationId: actor.organizationId, branchId: existing._id, deletedAt: null });
  if (staff > 0) throw ApiError.conflict(`Reassign ${staff} staff member${staff === 1 ? "" : "s"} before deleting this branch`);
  existing.deletedAt = new Date();
  existing.active = false;
  existing.code = `${existing.code}__DEL_${String(existing._id).slice(-6)}`;
  await existing.save();
  return { deleted: true, id: String(existing._id) };
}

export async function createPrinter(actor: AuthUser, input: Record<string, unknown>) {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw ApiError.badRequest("Printer name is required");
  if (input.isDefault) {
    await Printer.updateMany({ organizationId: actor.organizationId, deletedAt: null }, { isDefault: false });
  }
  return Printer.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    name,
    type: input.type || "a4",
    connectionType: input.connectionType || "browser",
    paperSize: input.paperSize || "A4",
    ip: input.ip,
    port: input.port,
    copies: Number(input.copies ?? 1),
    isDefault: Boolean(input.isDefault),
    header: input.header,
    footer: input.footer,
    active: input.active !== false
  });
}

export async function updatePrinter(actor: AuthUser, id: string, input: Record<string, unknown>) {
  const existing = await Printer.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Printer not found");
  if (typeof input.name === "string") existing.name = input.name.trim();
  if (typeof input.type === "string") existing.type = input.type;
  if (typeof input.connectionType === "string") existing.connectionType = input.connectionType;
  if (typeof input.paperSize === "string") existing.paperSize = input.paperSize;
  if (input.ip !== undefined) existing.ip = input.ip;
  if (input.port !== undefined) existing.port = input.port;
  if (input.copies !== undefined) existing.copies = Number(input.copies);
  if (input.header !== undefined) existing.header = input.header;
  if (input.footer !== undefined) existing.footer = input.footer;
  if (input.active !== undefined) existing.active = Boolean(input.active);
  if (input.isDefault) {
    await Printer.updateMany({ organizationId: actor.organizationId, deletedAt: null, _id: { $ne: existing._id } }, { isDefault: false });
    existing.isDefault = true;
  } else if (input.isDefault === false) existing.isDefault = false;
  await existing.save();
  return existing;
}

export async function deletePrinter(actor: AuthUser, id: string) {
  const existing = await Printer.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Printer not found");
  existing.deletedAt = new Date();
  existing.active = false;
  await existing.save();
  return { deleted: true, id: String(existing._id) };
}

export async function createStatus(actor: AuthUser, input: { name: string; code?: string; color?: string; sortOrder?: number; customerLabel?: string; requiresReason?: boolean; terminal?: boolean; allowedTransitions?: string[]; active?: boolean }) {
  const name = input.name.trim();
  if (name.length < 2) throw ApiError.badRequest("Status name is required");
  const code = slugify(input.code || name);
  const clash = await OrderStatus.findOne({ organizationId: actor.organizationId, code, deletedAt: null }).select("_id");
  if (clash) throw ApiError.conflict("A status with this code already exists");
  return OrderStatus.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    name,
    code,
    color: input.color || "#64748B",
    sortOrder: Number(input.sortOrder ?? 200),
    customerLabel: input.customerLabel?.trim() || name,
    requiresReason: Boolean(input.requiresReason),
    terminal: Boolean(input.terminal),
    allowedTransitions: input.allowedTransitions ?? [],
    active: input.active !== false
  });
}

export async function updateStatus(actor: AuthUser, id: string, input: Partial<{ name: string; color: string; sortOrder: number; customerLabel: string; requiresReason: boolean; terminal: boolean; allowedTransitions: string[]; active: boolean }>) {
  const existing = await OrderStatus.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Status not found");
  if (input.name !== undefined) existing.name = input.name.trim();
  if (input.color !== undefined) existing.color = input.color;
  if (input.sortOrder !== undefined) existing.sortOrder = Number(input.sortOrder);
  if (input.customerLabel !== undefined) existing.customerLabel = input.customerLabel.trim();
  if (input.requiresReason !== undefined) existing.requiresReason = input.requiresReason;
  if (input.terminal !== undefined) existing.terminal = input.terminal;
  if (input.allowedTransitions !== undefined) existing.allowedTransitions = input.allowedTransitions;
  if (input.active !== undefined) existing.active = input.active;
  await existing.save();
  return existing;
}

export async function deleteStatus(actor: AuthUser, id: string) {
  const existing = await OrderStatus.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Status not found");
  const used = await Order.countDocuments({ organizationId: actor.organizationId, status: existing.code, deletedAt: null });
  if (used > 0) throw ApiError.conflict(`Move ${used} order${used === 1 ? "" : "s"} off this status first`);
  existing.deletedAt = new Date();
  existing.active = false;
  existing.code = `${existing.code}__deleted`;
  await existing.save();
  return { deleted: true, id: String(existing._id) };
}

export async function createCoupon(actor: AuthUser, input: { code: string; type: "fixed" | "percent"; value: number; minOrder?: number; maxDiscount?: number; expiresAt?: string; active?: boolean }) {
  const code = input.code.trim().toUpperCase();
  if (code.length < 2) throw ApiError.badRequest("Coupon code is required");
  const clash = await Coupon.findOne({ organizationId: actor.organizationId, code, deletedAt: null }).select("_id");
  if (clash) throw ApiError.conflict("A coupon with this code already exists");
  return Coupon.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    code,
    type: input.type,
    value: Number(input.value),
    minOrder: Number(input.minOrder ?? 0),
    maxDiscount: input.maxDiscount != null ? Number(input.maxDiscount) : undefined,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    active: input.active !== false
  });
}

export async function updateCoupon(actor: AuthUser, id: string, input: Partial<{ code: string; type: "fixed" | "percent"; value: number; minOrder: number; maxDiscount: number; expiresAt: string | null; active: boolean }>) {
  const existing = await Coupon.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Coupon not found");
  if (input.code !== undefined) existing.code = input.code.trim().toUpperCase();
  if (input.type !== undefined) existing.type = input.type;
  if (input.value !== undefined) existing.value = Number(input.value);
  if (input.minOrder !== undefined) existing.minOrder = Number(input.minOrder);
  if (input.maxDiscount !== undefined) existing.maxDiscount = Number(input.maxDiscount);
  if (input.expiresAt === null) existing.expiresAt = undefined;
  else if (input.expiresAt !== undefined) existing.expiresAt = new Date(input.expiresAt);
  if (input.active !== undefined) existing.active = input.active;
  await existing.save();
  return existing;
}

export async function deleteCoupon(actor: AuthUser, id: string) {
  const existing = await Coupon.findOne({ _id: id, organizationId: actor.organizationId, deletedAt: null });
  if (!existing) throw ApiError.notFound("Coupon not found");
  existing.deletedAt = new Date();
  existing.active = false;
  existing.code = `${existing.code}__DEL_${String(existing._id).slice(-6)}`;
  await existing.save();
  return { deleted: true, id: String(existing._id) };
}
