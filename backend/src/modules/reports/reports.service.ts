import mongoose from "mongoose";
import { roundMoney } from "../../common/money";
import { Order } from "../../models/Order";
import { Quotation } from "../../models/Quotation";
import { Customer } from "../../models/Customer";
import { Expense, Invoice, Payment } from "../../models/Finance";
import { InventoryItem, InventoryTransaction } from "../../models/Inventory";
import { ProductionJob } from "../../models/Production";

export const REPORT_PRESETS = ["today", "7d", "30d", "month", "fy"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
export type TrendGroup = "day" | "week" | "month";
export type DetailKind = "gst" | "aging" | "pnl" | "pipeline" | "production" | "inventory" | "expenses" | "customers";
export type ExportType = "daily" | "sales" | "gst" | "aging" | "expenses" | "production" | "inventory" | "customers";

const OPEN_ORDER = { deletedAt: null, status: { $ne: "cancelled" } };
const OPEN_INVOICE = { deletedAt: null, status: { $nin: ["paid", "void"] } };

export type ReportRange = {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  preset: ReportPreset | "custom";
  group: TrendGroup;
};

function startOfDay(d: Date) {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(d: Date) {
  const next = new Date(d);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

export function deltaPct(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return roundMoney(((current - previous) / previous) * 100);
}

export function groupForSpan(from: Date, to: Date): TrendGroup {
  const days = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);
  if (days > 90) return "month";
  if (days > 21) return "week";
  return "day";
}

export function resolveRange(query: Record<string, unknown>, fyMonth = 4, defaultPreset: ReportPreset = "30d"): ReportRange {
  const presetRaw = String(query.preset ?? "");
  const preset = (REPORT_PRESETS as readonly string[]).includes(presetRaw) ? (presetRaw as ReportPreset) : defaultPreset;
  const now = new Date();
  let from = startOfDay(now);
  let to = now;

  if (query.from || query.to) {
    if (query.from) {
      const parsed = new Date(String(query.from));
      if (!Number.isNaN(parsed.getTime())) from = startOfDay(parsed);
    }
    if (query.to) {
      const parsed = new Date(String(query.to));
      if (!Number.isNaN(parsed.getTime())) to = endOfDay(parsed);
    } else {
      to = endOfDay(now);
    }
  } else if (preset === "today") {
    from = startOfDay(now);
    to = now;
  } else if (preset === "7d") {
    from = startOfDay(addDays(now, -6));
  } else if (preset === "30d") {
    from = startOfDay(addDays(now, -29));
  } else if (preset === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else if (preset === "fy") {
    const month = now.getMonth() + 1;
    const year = month >= fyMonth ? now.getFullYear() : now.getFullYear() - 1;
    from = new Date(year, fyMonth - 1, 1, 0, 0, 0, 0);
  }

  if (from > to) {
    const swap = from;
    from = startOfDay(to);
    to = endOfDay(swap);
  }

  const span = Math.max(to.getTime() - from.getTime(), 86_400_000);
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - span);
  const requestedGroup = String(query.group ?? "");
  const group: TrendGroup = requestedGroup === "day" || requestedGroup === "week" || requestedGroup === "month" ? requestedGroup : groupForSpan(from, to);
  return {
    from,
    to,
    previousFrom,
    previousTo,
    preset: query.from || query.to ? query.preset && (REPORT_PRESETS as readonly string[]).includes(presetRaw) ? (presetRaw as ReportPreset) : "custom" : preset,
    group
  };
}

function orgId(id: string) {
  return new mongoose.Types.ObjectId(id);
}

function periodMatch(organizationId: mongoose.Types.ObjectId, from: Date, to: Date) {
  return { organizationId, deletedAt: null, createdAt: { $gte: from, $lte: to } };
}

export async function periodSnapshot(organizationId: string, from: Date, to: Date) {
  const org = orgId(organizationId);
  const match = periodMatch(org, from, to);
  const [sales, cancelled, delivered, expenses] = await Promise.all([
    Order.aggregate([
      { $match: { ...match, status: { $ne: "cancelled" } } },
      {
        $group: {
          _id: null,
          sales: { $sum: "$totals.grandTotal" },
          collected: { $sum: "$totals.paidAmount" },
          pending: { $sum: "$totals.balanceDue" },
          orders: { $sum: 1 },
          taxable: { $sum: "$totals.taxableValue" },
          cgst: { $sum: "$totals.cgst" },
          sgst: { $sum: "$totals.sgst" },
          igst: { $sum: "$totals.igst" },
          taxTotal: { $sum: "$totals.taxTotal" }
        }
      }
    ]),
    Order.countDocuments({ ...match, status: "cancelled" }),
    Order.countDocuments({ ...match, status: { $in: ["delivered", "completed"] } }),
    Expense.aggregate([
      { $match: { organizationId: org, approvalStatus: "approved", date: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ])
  ]);
  const row = sales[0] ?? {};
  const expenseTotal = roundMoney(expenses[0]?.total ?? 0);
  const collected = roundMoney(row.collected ?? 0);
  return {
    sales: roundMoney(row.sales ?? 0),
    collected,
    pending: roundMoney(row.pending ?? 0),
    orders: row.orders ?? 0,
    cancelled,
    delivered,
    taxable: roundMoney(row.taxable ?? 0),
    cgst: roundMoney(row.cgst ?? 0),
    sgst: roundMoney(row.sgst ?? 0),
    igst: roundMoney(row.igst ?? 0),
    taxTotal: roundMoney(row.taxTotal ?? 0),
    expenses: expenseTotal,
    estimatedProfit: roundMoney(collected - expenseTotal)
  };
}

export function compareSnapshots(current: Awaited<ReturnType<typeof periodSnapshot>>, previous: Awaited<ReturnType<typeof periodSnapshot>>) {
  return {
    sales: deltaPct(current.sales, previous.sales),
    collected: deltaPct(current.collected, previous.collected),
    pending: deltaPct(current.pending, previous.pending),
    orders: deltaPct(current.orders, previous.orders),
    expenses: deltaPct(current.expenses, previous.expenses),
    estimatedProfit: deltaPct(current.estimatedProfit, previous.estimatedProfit),
    taxTotal: deltaPct(current.taxTotal, previous.taxTotal)
  };
}

function dateGroup(group: TrendGroup) {
  if (group === "month") return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  if (group === "week") {
    return {
      $concat: [
        { $toString: { $isoWeekYear: "$createdAt" } },
        "-W",
        { $toString: { $isoWeek: "$createdAt" } }
      ]
    };
  }
  return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
}

export async function salesTrend(organizationId: string, from: Date, to: Date, group: TrendGroup) {
  const rows = await Order.aggregate([
    { $match: { ...periodMatch(orgId(organizationId), from, to), status: { $ne: "cancelled" } } },
    {
      $group: {
        _id: dateGroup(group),
        revenue: { $sum: "$totals.grandTotal" },
        collected: { $sum: "$totals.paidAmount" },
        tax: { $sum: "$totals.taxTotal" },
        orders: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  return rows.map((r) => ({
    period: r._id,
    revenue: roundMoney(r.revenue ?? 0),
    collected: roundMoney(r.collected ?? 0),
    tax: roundMoney(r.tax ?? 0),
    orders: r.orders ?? 0
  }));
}

export async function topPerformers(organizationId: string, from: Date, to: Date, limit = 10) {
  const org = orgId(organizationId);
  const match = { ...periodMatch(org, from, to), status: { $ne: "cancelled" } };
  const [customers, items, methods] = await Promise.all([
    Order.aggregate([
      { $match: match },
      { $group: { _id: "$customerId", total: { $sum: "$totals.grandTotal" }, collected: { $sum: "$totals.paidAmount" }, orders: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: limit },
      { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "customer" } },
      { $unwind: "$customer" }
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $group: { _id: "$items.name", sku: { $first: "$items.sku" }, qty: { $sum: "$items.quantity" }, total: { $sum: "$items.lineTotal" } } },
      { $sort: { total: -1 } },
      { $limit: limit }
    ]),
    Payment.aggregate([
      { $match: { organizationId: org, deletedAt: null, status: "completed", paidAt: { $gte: from, $lte: to } } },
      { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } }
    ])
  ]);
  return {
    customers: customers.map((c) => ({
      _id: String(c._id),
      total: roundMoney(c.total ?? 0),
      collected: roundMoney(c.collected ?? 0),
      orders: c.orders ?? 0,
      customer: { name: c.customer?.name, code: c.customer?.code }
    })),
    items: items.map((i) => ({
      _id: i._id,
      sku: i.sku,
      qty: i.qty ?? 0,
      total: roundMoney(i.total ?? 0)
    })),
    methods: methods.map((m) => ({ method: m._id || "unspecified", amount: roundMoney(m.amount ?? 0), count: m.count ?? 0 }))
  };
}

export async function statusMix(organizationId: string) {
  const rows = await Order.aggregate([
    { $match: { organizationId: orgId(organizationId), deletedAt: null } },
    { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$totals.grandTotal" } } },
    { $sort: { count: -1 } }
  ]);
  return rows.map((r) => ({ status: r._id || "unknown", count: r.count ?? 0, value: roundMoney(r.value ?? 0) }));
}

export async function sourceMix(organizationId: string, from: Date, to: Date) {
  const rows = await Order.aggregate([
    { $match: { ...periodMatch(orgId(organizationId), from, to), status: { $ne: "cancelled" } } },
    { $group: { _id: "$source", count: { $sum: 1 }, value: { $sum: "$totals.grandTotal" } } },
    { $sort: { value: -1 } }
  ]);
  return rows.map((r) => ({ source: r._id || "pos", count: r.count ?? 0, value: roundMoney(r.value ?? 0) }));
}

function agingBucket(dueDate: Date | undefined, now: Date) {
  const start = dueDate ? new Date(dueDate) : now;
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  if (days <= 30) return "current" as const;
  if (days <= 60) return "days31_60" as const;
  if (days <= 90) return "days61_90" as const;
  return "days90plus" as const;
}

export async function agingReport(organizationId: string) {
  const now = new Date();
  const invoices = await Invoice.find({
    organizationId: orgId(organizationId),
    ...OPEN_INVOICE,
    "totals.balanceDue": { $gt: 0 }
  })
    .select("number status totals dueDate createdAt customerId snapshot")
    .populate("customerId", "name code")
    .sort("dueDate")
    .limit(400)
    .lean();

  const buckets = { current: 0, days31_60: 0, days61_90: 0, days90plus: 0 };
  const rows = invoices.map((inv) => {
    const rec = inv as unknown as {
      _id: unknown;
      number?: string;
      status?: string;
      totals?: { balanceDue?: number };
      dueDate?: Date;
      createdAt?: Date;
      customerId?: { name?: string; code?: string } | string;
    };
    const balanceDue = roundMoney(Number(rec.totals?.balanceDue ?? 0));
    const dueDate = rec.dueDate ?? rec.createdAt;
    const bucket = agingBucket(dueDate, now);
    buckets[bucket] += balanceDue;
    const days = Math.max(0, Math.floor((now.getTime() - new Date(dueDate ?? now).getTime()) / 86_400_000));
    const customer = rec.customerId;
    return {
      id: String(rec._id),
      number: rec.number ?? "",
      status: rec.status,
      customer: typeof customer === "object" ? customer?.name : undefined,
      code: typeof customer === "object" ? customer?.code : undefined,
      balanceDue,
      dueDate,
      days,
      bucket
    };
  });
  const total = roundMoney(buckets.current + buckets.days31_60 + buckets.days61_90 + buckets.days90plus);
  return {
    total,
    count: rows.length,
    buckets: {
      current: roundMoney(buckets.current),
      days31_60: roundMoney(buckets.days31_60),
      days61_90: roundMoney(buckets.days61_90),
      days90plus: roundMoney(buckets.days90plus)
    },
    rows: rows.sort((a, b) => b.days - a.days).slice(0, 80)
  };
}

export async function gstReport(organizationId: string, from: Date, to: Date) {
  const org = orgId(organizationId);
  const match = { ...periodMatch(org, from, to), status: { $ne: "cancelled" } };
  const [summary, byPlace, byRate] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          taxable: { $sum: "$totals.taxableValue" },
          cgst: { $sum: "$totals.cgst" },
          sgst: { $sum: "$totals.sgst" },
          igst: { $sum: "$totals.igst" },
          taxTotal: { $sum: "$totals.taxTotal" },
          sales: { $sum: "$totals.grandTotal" },
          orders: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $cond: ["$interstate", "interstate", "intrastate"] },
          taxable: { $sum: "$totals.taxableValue" },
          tax: { $sum: "$totals.taxTotal" },
          orders: { $sum: 1 }
        }
      }
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: { $ifNull: ["$items.taxRate", 0] },
          qty: { $sum: "$items.quantity" },
          taxable: { $sum: { $divide: [{ $multiply: ["$items.lineTotal", 100] }, { $add: [100, { $ifNull: ["$items.taxRate", 0] }] }] } },
          lineTotal: { $sum: "$items.lineTotal" },
          lines: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);
  const s = summary[0] ?? {};
  return {
    taxable: roundMoney(s.taxable ?? 0),
    cgst: roundMoney(s.cgst ?? 0),
    sgst: roundMoney(s.sgst ?? 0),
    igst: roundMoney(s.igst ?? 0),
    taxTotal: roundMoney(s.taxTotal ?? 0),
    sales: roundMoney(s.sales ?? 0),
    orders: s.orders ?? 0,
    place: byPlace.map((p) => ({
      place: p._id,
      taxable: roundMoney(p.taxable ?? 0),
      tax: roundMoney(p.tax ?? 0),
      orders: p.orders ?? 0
    })),
    rates: byRate.map((r) => ({
      taxRate: r._id ?? 0,
      qty: r.qty ?? 0,
      lines: r.lines ?? 0,
      lineTotal: roundMoney(r.lineTotal ?? 0),
      taxable: roundMoney(r.taxable ?? 0),
      tax: roundMoney((r.lineTotal ?? 0) - (r.taxable ?? 0))
    }))
  };
}

export async function quotationFunnel(organizationId: string, from: Date, to: Date) {
  const org = orgId(organizationId);
  const [period, open] = await Promise.all([
    Quotation.aggregate([
      { $match: periodMatch(org, from, to) },
      { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$totals.grandTotal" } } }
    ]),
    Quotation.aggregate([
      { $match: { organizationId: org, deletedAt: null } },
      { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$totals.grandTotal" } } }
    ])
  ]);
  const toMap = (rows: Array<{ _id: string; count: number; value: number }>) =>
    rows.map((r) => ({ status: r._id || "draft", count: r.count ?? 0, value: roundMoney(r.value ?? 0) }));
  const periodRows = toMap(period);
  const decided = periodRows.filter((r) => ["approved", "converted", "rejected", "expired", "cancelled"].includes(r.status));
  const won = periodRows.filter((r) => r.status === "converted" || r.status === "approved").reduce((s, r) => s + r.count, 0);
  const decidedCount = decided.reduce((s, r) => s + r.count, 0);
  return {
    period: periodRows,
    open: toMap(open),
    conversionRate: decidedCount ? roundMoney((won / decidedCount) * 100) : 0,
    pending: periodRows.filter((r) => ["draft", "sent", "viewed", "awaiting_approval", "revision_requested"].includes(r.status)).reduce((s, r) => s + r.count, 0)
  };
}

export async function productionReport(organizationId: string) {
  const org = orgId(organizationId);
  const now = new Date();
  const [byStatus, delayed, overdue, qty] = await Promise.all([
    ProductionJob.aggregate([{ $match: { organizationId: org, deletedAt: null } }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ProductionJob.countDocuments({ organizationId: org, deletedAt: null, status: "delayed" }),
    ProductionJob.countDocuments({
      organizationId: org,
      deletedAt: null,
      status: { $nin: ["completed", "rejected"] },
      scheduledEnd: { $lt: now }
    }),
    ProductionJob.aggregate([
      { $match: { organizationId: org, deletedAt: null } },
      {
        $group: {
          _id: null,
          planned: { $sum: "$qtyPlanned" },
          completed: { $sum: "$qtyCompleted" },
          rejected: { $sum: "$qtyRejected" },
          wastage: { $sum: "$wastage" },
          open: { $sum: { $cond: [{ $in: ["$status", ["pending", "ready", "in_production", "quality_check", "delayed", "on_hold"]] }, 1, 0] } }
        }
      }
    ])
  ]);
  const q = qty[0] ?? {};
  return {
    byStatus: byStatus.map((r) => ({ status: r._id || "pending", count: r.count ?? 0 })),
    delayed,
    overdue,
    planned: q.planned ?? 0,
    completed: q.completed ?? 0,
    rejected: q.rejected ?? 0,
    wastage: q.wastage ?? 0,
    open: q.open ?? 0
  };
}

export async function inventoryReport(organizationId: string, from: Date, to: Date) {
  const org = orgId(organizationId);
  const [summary, lowStock, movements] = await Promise.all([
    InventoryItem.aggregate([
      { $match: { organizationId: org, deletedAt: null } },
      {
        $group: {
          _id: null,
          skus: { $sum: 1 },
          stockQty: { $sum: "$stockQty" },
          reservedQty: { $sum: "$reservedQty" },
          value: {
            $sum: {
              $multiply: [
                "$stockQty",
                { $cond: [{ $gt: ["$averageCost", 0] }, "$averageCost", { $ifNull: ["$costPerUnit", 0] }] }
              ]
            }
          }
        }
      }
    ]),
    InventoryItem.find({
      organizationId: org,
      deletedAt: null,
      $expr: { $lte: ["$stockQty", { $ifNull: ["$reorderLevel", 0] }] }
    })
      .select("sku name stockQty reorderLevel unit warehouse")
      .sort("stockQty")
      .limit(40)
      .lean(),
    InventoryTransaction.aggregate([
      { $match: { organizationId: org, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: "$type", qty: { $sum: "$quantity" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])
  ]);
  const s = summary[0] ?? {};
  return {
    skus: s.skus ?? 0,
    stockQty: s.stockQty ?? 0,
    reservedQty: s.reservedQty ?? 0,
    value: roundMoney(s.value ?? 0),
    lowStock: lowStock.map((i) => ({
      id: String(i._id),
      sku: i.sku,
      name: i.name,
      stockQty: i.stockQty ?? 0,
      reorderLevel: i.reorderLevel ?? 0,
      unit: i.unit,
      warehouse: i.warehouse
    })),
    movements: movements.map((m) => ({ type: m._id, qty: m.qty ?? 0, count: m.count ?? 0 }))
  };
}

export async function expenseReport(organizationId: string, from: Date, to: Date) {
  const org = orgId(organizationId);
  const match = { organizationId: org, approvalStatus: "approved", date: { $gte: from, $lte: to } };
  const [byType, byCategory, pending] = await Promise.all([
    Expense.aggregate([{ $match: match }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    Expense.aggregate([{ $match: match }, { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    Expense.aggregate([
      { $match: { organizationId: org, approvalStatus: { $in: ["draft", "pending"] } } },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }
    ])
  ]);
  return {
    types: byType.map((r) => ({ type: r._id || "operating", amount: roundMoney(r.amount ?? 0), count: r.count ?? 0 })),
    categories: byCategory.map((r) => ({ category: r._id || "other", amount: roundMoney(r.amount ?? 0), count: r.count ?? 0 })),
    pending: { amount: roundMoney(pending[0]?.amount ?? 0), count: pending[0]?.count ?? 0 }
  };
}

export async function customerReport(organizationId: string, from: Date, to: Date) {
  const org = orgId(organizationId);
  const [newCustomers, health, topOutstanding, returning] = await Promise.all([
    Customer.countDocuments({ organizationId: org, deletedAt: null, createdAt: { $gte: from, $lte: to } }),
    Customer.aggregate([
      { $match: { organizationId: org, deletedAt: null } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          onHold: { $sum: { $cond: ["$creditHold", 1, 0] } },
          overdue: { $sum: { $cond: [{ $gt: ["$overdue", 0] }, 1, 0] } },
          outstanding: { $sum: "$outstanding" },
          overdueAmt: { $sum: "$overdue" }
        }
      }
    ]),
    Customer.find({ organizationId: org, deletedAt: null, outstanding: { $gt: 0 } })
      .select("name code outstanding overdue creditHold")
      .sort("-outstanding")
      .limit(15)
      .lean(),
    Order.aggregate([
      { $match: { ...periodMatch(org, from, to), status: { $ne: "cancelled" } } },
      { $group: { _id: "$customerId", orders: { $sum: 1 } } },
      { $group: { _id: null, buyers: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } } } }
    ])
  ]);
  const h = health[0] ?? {};
  const r = returning[0] ?? {};
  return {
    newCustomers,
    total: h.total ?? 0,
    onHold: h.onHold ?? 0,
    overdueAccounts: h.overdue ?? 0,
    outstanding: roundMoney(h.outstanding ?? 0),
    overdue: roundMoney(h.overdueAmt ?? 0),
    buyers: r.buyers ?? 0,
    repeatBuyers: r.repeat ?? 0,
    topOutstanding: topOutstanding.map((c) => ({
      id: String(c._id),
      name: c.name,
      code: c.code,
      outstanding: roundMoney(c.outstanding ?? 0),
      overdue: roundMoney(c.overdue ?? 0),
      creditHold: Boolean(c.creditHold)
    }))
  };
}

export async function outstandingNow(organizationId: string) {
  const [row] = await Order.aggregate([
    { $match: { organizationId: orgId(organizationId), ...OPEN_ORDER, "totals.balanceDue": { $gt: 0 } } },
    { $group: { _id: null, amount: { $sum: "$totals.balanceDue" }, count: { $sum: 1 } } }
  ]);
  return { amount: roundMoney(row?.amount ?? 0), count: row?.count ?? 0 };
}

export async function operationalCounts(organizationId: string) {
  const org = orgId(organizationId);
  const [pendingQuotes, awaitingApproval, delayed, lowStock] = await Promise.all([
    Quotation.countDocuments({ organizationId: org, status: { $in: ["draft", "sent", "viewed", "awaiting_approval"] }, deletedAt: null }),
    Order.countDocuments({ organizationId: org, status: { $in: ["awaiting_design_approval", "design_pending"] }, deletedAt: null }),
    Order.countDocuments({ organizationId: org, status: "delayed", deletedAt: null }),
    InventoryItem.countDocuments({ organizationId: org, deletedAt: null, $expr: { $lte: ["$stockQty", { $ifNull: ["$reorderLevel", 0] }] } })
  ]);
  return { pendingQuotes, awaitingApproval, delayed, lowStock };
}

export async function dashboardReport(organizationId: string, range: ReportRange, financial: boolean) {
  const [current, previous, outstanding, ops, production, aging, quotes, mix, sources, top] = await Promise.all([
    periodSnapshot(organizationId, range.from, range.to),
    periodSnapshot(organizationId, range.previousFrom, range.previousTo),
    outstandingNow(organizationId),
    operationalCounts(organizationId),
    productionReport(organizationId),
    agingReport(organizationId),
    quotationFunnel(organizationId, range.from, range.to),
    statusMix(organizationId),
    sourceMix(organizationId, range.from, range.to),
    financial ? topPerformers(organizationId, range.from, range.to, 6) : Promise.resolve({ customers: [], items: [], methods: [] })
  ]);
  const compare = compareSnapshots(current, previous);
  const alerts = [
    financial && outstanding.amount > 0 ? { level: "warn" as const, label: "Open receivables", value: outstanding.count, href: "/reports?tab=receivables" } : null,
    financial && aging.buckets.days90plus > 0
      ? { level: "danger" as const, label: "90+ day overdue", value: aging.rows.filter((r) => r.bucket === "days90plus").length, href: "/reports?tab=receivables" }
      : null,
    ops.delayed > 0 ? { level: "warn" as const, label: "Delayed orders", value: ops.delayed, href: "/orders" } : null,
    ops.awaitingApproval > 0 ? { level: "info" as const, label: "Design approvals", value: ops.awaitingApproval, href: "/orders" } : null,
    ops.pendingQuotes > 0 ? { level: "info" as const, label: "Open quotations", value: ops.pendingQuotes, href: "/quotations" } : null,
    ops.lowStock > 0 ? { level: "warn" as const, label: "Low stock SKUs", value: ops.lowStock, href: "/inventory" } : null,
    production.delayed > 0 ? { level: "warn" as const, label: "Delayed jobs", value: production.delayed, href: "/production" } : null
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    period: { from: range.from, to: range.to, preset: range.preset, group: range.group },
    previous: { from: range.previousFrom, to: range.previousTo },
    financial,
    sales: financial ? current.sales : undefined,
    collected: financial ? current.collected : undefined,
    pending: financial ? current.pending : undefined,
    outstanding: financial ? outstanding.amount : undefined,
    outstandingCount: financial ? outstanding.count : undefined,
    expenses: financial ? current.expenses : undefined,
    estimatedProfit: financial ? current.estimatedProfit : undefined,
    taxTotal: financial ? current.taxTotal : undefined,
    taxable: financial ? current.taxable : undefined,
    cgst: financial ? current.cgst : undefined,
    sgst: financial ? current.sgst : undefined,
    igst: financial ? current.igst : undefined,
    orders: current.orders,
    cancelled: current.cancelled,
    delivered: current.delivered,
    compare: financial ? compare : undefined,
    pendingQuotes: ops.pendingQuotes,
    awaitingApproval: ops.awaitingApproval,
    delayed: ops.delayed,
    lowStock: ops.lowStock,
    production: production.byStatus,
    productionOpen: production.open,
    quotes: { pending: quotes.pending, conversionRate: quotes.conversionRate },
    aging: financial ? aging.buckets : undefined,
    statusMix: mix,
    sourceMix: sources,
    methods: financial ? top.methods : undefined,
    top,
    alerts
  };
}

export async function detailReport(organizationId: string, kind: DetailKind, range: ReportRange) {
  switch (kind) {
    case "gst":
      return gstReport(organizationId, range.from, range.to);
    case "aging":
      return agingReport(organizationId);
    case "pnl": {
      const [current, previous] = await Promise.all([
        periodSnapshot(organizationId, range.from, range.to),
        periodSnapshot(organizationId, range.previousFrom, range.previousTo)
      ]);
      return { current, previous, compare: compareSnapshots(current, previous) };
    }
    case "pipeline": {
      const [orders, quotes, sources] = await Promise.all([
        statusMix(organizationId),
        quotationFunnel(organizationId, range.from, range.to),
        sourceMix(organizationId, range.from, range.to)
      ]);
      return { orders, quotes, sources };
    }
    case "production":
      return productionReport(organizationId);
    case "inventory":
      return inventoryReport(organizationId, range.from, range.to);
    case "expenses":
      return expenseReport(organizationId, range.from, range.to);
    case "customers":
      return customerReport(organizationId, range.from, range.to);
    default:
      return {};
  }
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>) {
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return `\uFEFF${lines.join("\n")}\n`;
}

export async function exportReport(organizationId: string, type: ExportType, range: ReportRange) {
  const stamp = range.from.toISOString().slice(0, 10);
  if (type === "daily" || type === "sales") {
    const rows = type === "daily" ? [await periodSnapshot(organizationId, range.from, range.to)] : await salesTrend(organizationId, range.from, range.to, range.group);
    if (type === "daily") {
      const row = rows[0] as Awaited<ReturnType<typeof periodSnapshot>>;
      return {
        filename: `daily-report-${stamp}.csv`,
        csv: toCsv(
          ["date", "sales", "collected", "pending", "orders", "expenses", "tax", "profit"],
          [[stamp, row.sales, row.collected, row.pending, row.orders, row.expenses, row.taxTotal, row.estimatedProfit]]
        )
      };
    }
    return {
      filename: `sales-report-${stamp}.csv`,
      csv: toCsv(
        ["period", "revenue", "collected", "tax", "orders"],
        (rows as Awaited<ReturnType<typeof salesTrend>>).map((r) => [r.period, r.revenue, r.collected, r.tax, r.orders])
      )
    };
  }
  if (type === "gst") {
    const gst = await gstReport(organizationId, range.from, range.to);
    return {
      filename: `gst-report-${stamp}.csv`,
      csv: toCsv(
        ["tax_rate", "lines", "qty", "taxable", "tax", "line_total"],
        gst.rates.map((r) => [r.taxRate, r.lines, r.qty, r.taxable, r.tax, r.lineTotal])
      )
    };
  }
  if (type === "aging") {
    const aging = await agingReport(organizationId);
    return {
      filename: `receivables-${stamp}.csv`,
      csv: toCsv(
        ["invoice", "customer", "bucket", "days", "balance_due", "due_date", "status"],
        aging.rows.map((r) => [r.number, r.customer, r.bucket, r.days, r.balanceDue, r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : "", r.status])
      )
    };
  }
  if (type === "expenses") {
    const exp = await expenseReport(organizationId, range.from, range.to);
    return {
      filename: `expenses-${stamp}.csv`,
      csv: toCsv(
        ["category", "amount", "count"],
        exp.categories.map((r) => [r.category, r.amount, r.count])
      )
    };
  }
  if (type === "production") {
    const prod = await productionReport(organizationId);
    return {
      filename: `production-${stamp}.csv`,
      csv: toCsv(
        ["status", "count"],
        prod.byStatus.map((r) => [r.status, r.count])
      )
    };
  }
  if (type === "inventory") {
    const inv = await inventoryReport(organizationId, range.from, range.to);
    return {
      filename: `inventory-${stamp}.csv`,
      csv: toCsv(
        ["sku", "name", "stock", "reorder", "unit", "warehouse"],
        inv.lowStock.map((r) => [r.sku, r.name, r.stockQty, r.reorderLevel, r.unit, r.warehouse])
      )
    };
  }
  const customers = await customerReport(organizationId, range.from, range.to);
  return {
    filename: `customers-${stamp}.csv`,
    csv: toCsv(
      ["code", "name", "outstanding", "overdue", "credit_hold"],
      customers.topOutstanding.map((r) => [r.code, r.name, r.outstanding, r.overdue, r.creditHold])
    )
  };
}
