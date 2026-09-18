import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { ok } from "../../common/response";
import { ApiError } from "../../common/errors";
import { Customer } from "../../models/Customer";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requireAny, requirePermission } from "../../middleware/rbac";
import { hasPermission } from "../../common/permissions";
import {
  dashboardReport,
  detailReport,
  exportReport,
  periodSnapshot,
  resolveRange,
  salesTrend,
  topPerformers,
  type DetailKind,
  type ExportType
} from "./reports.service";

const router = Router();
router.use(authenticate);

const DETAIL_KINDS = new Set<DetailKind>(["gst", "aging", "pnl", "pipeline", "production", "inventory", "expenses", "customers"]);
const EXPORT_TYPES = new Set<ExportType>(["daily", "sales", "gst", "aging", "expenses", "production", "inventory", "customers"]);

function queryRecord(req: { query: unknown }) {
  return req.query as Record<string, unknown>;
}

router.get(
  "/dashboard",
  requireAny("reports.view", "orders.view", "finance.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const range = resolveRange(queryRecord(req), 4, "30d");
    const financial = hasPermission(user, ["reports.view", "finance.view", "orders.view_cost"], "any");
    return ok(res, await dashboardReport(user.organizationId, range, financial));
  })
);

router.get(
  "/sales",
  requirePermission("reports.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const range = resolveRange(queryRecord(req), 4, "30d");
    const rows = await salesTrend(user.organizationId, range.from, range.to, range.group);
    return ok(
      res,
      rows.map((r) => ({ _id: r.period, revenue: r.revenue, collected: r.collected, tax: r.tax, orders: r.orders }))
    );
  })
);

router.get(
  "/top",
  requirePermission("reports.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const range = resolveRange(queryRecord(req), 4, "30d");
    return ok(res, await topPerformers(user.organizationId, range.from, range.to, 10));
  })
);

router.get(
  "/daily",
  requirePermission("reports.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const range = resolveRange({ preset: "today" }, 4, "today");
    const snap = await periodSnapshot(user.organizationId, range.from, range.to);
    const newCustomers = await Customer.countDocuments({
      organizationId: user.organizationId,
      createdAt: { $gte: range.from, $lte: range.to }
    });
    return ok(res, {
      sales: snap.sales,
      collected: snap.collected,
      pending: snap.pending,
      orders: snap.orders,
      expenses: snap.expenses,
      taxTotal: snap.taxTotal,
      estimatedProfit: snap.estimatedProfit,
      newCustomers
    });
  })
);

router.get(
  "/detail",
  requirePermission("reports.view"),
  asyncHandler(async (req, res) => {
    const kind = String(req.query.kind ?? "") as DetailKind;
    if (!DETAIL_KINDS.has(kind)) throw ApiError.badRequest("Unknown report kind");
    const { user } = req as AuthedRequest;
    const range = resolveRange(queryRecord(req), 4, "30d");
    return ok(res, await detailReport(user.organizationId, kind, range));
  })
);

router.get(
  "/export",
  requirePermission("reports.export"),
  asyncHandler(async (req, res) => {
    const typeRaw = String(req.query.type ?? "daily");
    const type = (EXPORT_TYPES.has(typeRaw as ExportType) ? typeRaw : "daily") as ExportType;
    const { user } = req as AuthedRequest;
    const range = resolveRange(queryRecord(req), 4, type === "daily" ? "today" : "30d");
    const file = await exportReport(user.organizationId, type, range);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    return res.send(file.csv);
  })
);

export default router;
