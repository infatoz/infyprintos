import mongoose from "mongoose";
import { PriceList } from "../models/Catalog";
import { Item, ItemVariant } from "../models/Catalog";
import { Coupon } from "../models/Settings";
import { CustomerTier } from "../models/Customer";
import { computeOrderTotals, lineNet, pct, roundMoney } from "../common/money";
import { ApiError } from "../common/errors";

export type IncomingLine = {
  itemId: string;
  variantId?: string;
  quantity: number;
  unitPrice?: number;
  discountType?: "fixed" | "percent" | "none";
  discountValue?: number;
  description?: string;
};

export async function resolveUnitPrice(opts: {
  organizationId: string;
  item: { _id: unknown; salesPrice: number };
    variant?: { salesPrice?: number | null } | null;
  tierId?: string;
  quantity: number;
}) {
  const now = new Date();
  const candidates = await PriceList.find({
    organizationId: opts.organizationId,
    itemId: opts.item._id,
    active: true,
    deletedAt: null,
    $or: [{ variantId: opts.variant ? (opts.variant as { _id: unknown })._id : null }, { variantId: { $exists: false } }, { variantId: null }],
    $and: [
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: { $lte: now } }] },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: now } }] }
    ]
  }).lean();

  const matching = candidates
    .filter((p) => opts.quantity >= (p.minQty ?? 1) && (!p.maxQty || opts.quantity <= p.maxQty))
    .filter((p) => !p.tierId || String(p.tierId) === String(opts.tierId ?? ""))
    .sort((a, b) => {
      const aTier = a.tierId ? 1 : 0;
      const bTier = b.tierId ? 1 : 0;
      if (aTier !== bTier) return bTier - aTier;
      return (b.minQty ?? 1) - (a.minQty ?? 1);
    });

  if (matching[0]) return { price: matching[0].price, rule: matching[0] };
  let price = opts.variant?.salesPrice || opts.item.salesPrice;
  let rule: Record<string, unknown> = { source: opts.variant?.salesPrice ? "variant" : "base" };
  if (opts.tierId) {
    const tier = await CustomerTier.findById(opts.tierId).select("discountPercent name");
    if (tier?.discountPercent) {
      price = roundMoney(Number(price) * (1 - Number(tier.discountPercent) / 100));
      rule = { source: "tier_discount", discountPercent: tier.discountPercent, name: tier.name };
    }
  }
  return { price, rule };
}

export async function priceDocument(opts: {
  organizationId: string;
  customerTierId?: string;
  lines: IncomingLine[];
  discountType?: "fixed" | "percent" | "none";
  discountValue?: number;
  couponCode?: string;
  charges?: { name: string; amount: number }[];
  deliveryCharges?: number;
  roundOff?: number;
  autoRound?: boolean;
  taxInclusive?: boolean;
  interstate?: boolean;
  allowPriceOverride?: boolean;
}) {
  const pricedLines = [];
  for (const line of opts.lines) {
    const item = await Item.findOne({ _id: line.itemId, organizationId: opts.organizationId, deletedAt: null, active: true });
    if (!item) throw ApiError.badRequest(`Item not found: ${line.itemId}`);
    const variant = line.variantId
      ? await ItemVariant.findOne({ _id: line.variantId, itemId: item._id, deletedAt: null })
      : null;
    const resolved = await resolveUnitPrice({
      organizationId: opts.organizationId,
      item,
      variant,
      tierId: opts.customerTierId,
      quantity: line.quantity
    });
    let unitPrice = resolved.price;
    if (typeof line.unitPrice === "number" && opts.allowPriceOverride) unitPrice = line.unitPrice;
    const taxInclusive = opts.taxInclusive ?? item.taxInclusive;
    const net = lineNet({
      quantity: line.quantity,
      unitPrice,
      discountType: line.discountType === "none" ? undefined : line.discountType,
      discountValue: line.discountValue,
      taxRate: item.taxRate,
      taxInclusive
    });
    pricedLines.push({
      itemId: item._id,
      variantId: variant?._id,
      name: item.name,
      sku: item.sku,
      variantName: variant?.name,
      description: line.description ?? item.description,
      unit: item.unit,
      quantity: line.quantity,
      unitPrice,
      cost: variant?.cost ?? item.baseCost,
      discountType: line.discountType ?? "none",
      discountValue: line.discountValue ?? 0,
      taxRate: item.taxRate,
      taxInclusive,
      requiresDesign: item.requiresDesign,
      pricingRule: resolved.rule,
      snapshot: {
        name: item.name,
        sku: item.sku,
        hsn: item.hsn,
        sac: item.sac,
        taxRate: item.taxRate,
        unit: item.unit,
        variant: variant?.options
      },
      lineTotal: net.afterDiscount,
      net
    });
  }

  let couponDiscount = 0;
  if (opts.couponCode) {
    const coupon = await Coupon.findOne({
      organizationId: opts.organizationId,
      code: opts.couponCode.toUpperCase(),
      active: true,
      deletedAt: null
    });
    if (!coupon) throw ApiError.badRequest("Invalid coupon");
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw ApiError.badRequest("Coupon expired");
    const afterItems = pricedLines.reduce((s, l) => s + l.net.afterDiscount, 0);
    if (afterItems < (coupon.minOrder ?? 0)) throw ApiError.badRequest("Coupon minimum order not met");
    couponDiscount = coupon.type === "percent" ? pct(afterItems, coupon.value) : roundMoney(coupon.value);
    if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
  }

  const payable = pricedLines.reduce((s, l) => s + l.net.payable, 0);
  let manualDiscount = 0;
  if (opts.discountType === "percent") manualDiscount = pct(payable, opts.discountValue ?? 0);
  if (opts.discountType === "fixed") manualDiscount = roundMoney(opts.discountValue ?? 0);
  const combinedDiscount = roundMoney(manualDiscount + couponDiscount);

  const additionalCharges = roundMoney((opts.charges ?? []).reduce((s, c) => s + Number(c.amount || 0), 0));
  const totals = computeOrderTotals({
    lines: pricedLines.map((l) => l.net),
    orderDiscountType: combinedDiscount ? "fixed" : undefined,
    orderDiscountValue: combinedDiscount,
    additionalCharges,
    deliveryCharges: opts.deliveryCharges,
    roundOff: opts.roundOff,
    autoRound: opts.autoRound,
    interstate: opts.interstate
  });

  return { items: pricedLines.map(({ net, ...rest }) => rest), totals };
}

export function customerSnapshot(customer: {
  name: string;
  phone: string;
  email?: string | null;
  code: string;
  business?: { name?: string; gstin?: string } | null;
}) {
  return {
    name: customer.name,
    phone: customer.phone,
    email: customer.email ?? undefined,
    code: customer.code,
    businessName: customer.business?.name,
    gstin: customer.business?.gstin
  };
}

export function dueDateFromTerm(term?: { type?: string; netDays?: number } | null) {
  const now = new Date();
  if (!term || term.type === "prepaid" || term.type === "due_on_billing") return now;
  const days = term.netDays ?? 0;
  return new Date(now.getTime() + days * 86400000);
}

export function oid(id: string | mongoose.Types.ObjectId) {
  return new mongoose.Types.ObjectId(id);
}
