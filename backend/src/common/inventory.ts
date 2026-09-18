import mongoose from "mongoose";
import { InventoryItem, InventoryTransaction, LEDGER_TYPES } from "../models/Inventory";
import { ApiError } from "./errors";
import { roundMoney } from "./money";

export type LedgerType = (typeof LEDGER_TYPES)[number];

export const INBOUND_TYPES: LedgerType[] = ["opening", "purchase", "inward", "return"];
export const OUTBOUND_TYPES: LedgerType[] = ["outward", "production_consumption", "wastage", "damaged"];

export function availableQty(item: { stockQty?: number; reservedQty?: number }) {
  return Number(item.stockQty || 0) - Number(item.reservedQty || 0);
}

export function isDuplicateKey(err: unknown) {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000);
}

export type MoveStockInput = {
  organizationId: string;
  branchId?: string;
  inventoryItemId: string;
  type: string;
  quantity: number;
  unitCost?: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  userId?: string;
  warehouse?: string;
  toInventoryItemId?: string;
  idempotencyKey?: string;
  consumeReserved?: boolean;
  session?: mongoose.ClientSession;
};

export type MoveStockResult = {
  item: Record<string, unknown>;
  transaction: Record<string, unknown>;
  replayed: boolean;
};

async function replayExisting(opts: MoveStockInput): Promise<MoveStockResult | null> {
  if (opts.idempotencyKey) {
    const txn = await InventoryTransaction.findOne({
      organizationId: opts.organizationId,
      idempotencyKey: opts.idempotencyKey
    }).session(opts.session ?? null);
    if (txn) {
      const item = await InventoryItem.findById(txn.inventoryItemId).session(opts.session ?? null);
      return { item: item?.toObject?.() ?? item, transaction: txn.toObject(), replayed: true };
    }
  }
  if (opts.referenceType && opts.referenceId && ["production_consumption", "reservation"].includes(opts.type)) {
    const txn = await InventoryTransaction.findOne({
      organizationId: opts.organizationId,
      type: opts.type,
      inventoryItemId: opts.inventoryItemId,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId
    }).session(opts.session ?? null);
    if (txn) {
      const item = await InventoryItem.findById(txn.inventoryItemId).session(opts.session ?? null);
      return { item: item?.toObject?.() ?? item, transaction: txn.toObject(), replayed: true };
    }
  }
  return null;
}

export async function moveStock(opts: MoveStockInput): Promise<MoveStockResult> {
  if (!LEDGER_TYPES.includes(opts.type as LedgerType)) throw ApiError.badRequest("Invalid stock movement type");
  const qty = Number(opts.quantity);
  if (!qty || !Number.isFinite(qty)) throw ApiError.badRequest("Quantity required");

  const existing = await replayExisting(opts);
  if (existing) return existing;

  const item = await InventoryItem.findOne({
    _id: opts.inventoryItemId,
    organizationId: opts.organizationId,
    deletedAt: null
  }).session(opts.session ?? null);
  if (!item) throw ApiError.notFound("Inventory item not found");

  const type = opts.type as LedgerType;
  const inbound = INBOUND_TYPES.includes(type) || (type === "adjustment" && qty > 0) || (type === "reconciliation" && qty > 0);
  const reservation = type === "reservation";
  const release = type === "release";
  const consumeReserved = Boolean(opts.consumeReserved) || type === "production_consumption";

  let stockDelta = 0;
  let reservedDelta = 0;

  if (reservation) {
    const need = Math.abs(qty);
    if (availableQty(item) + 1e-9 < need) throw ApiError.unprocessable("Insufficient available stock to reserve");
    reservedDelta = need;
  } else if (release) {
    const need = Math.abs(qty);
    if (Number(item.reservedQty || 0) + 1e-9 < need) throw ApiError.unprocessable("Cannot release more than reserved quantity");
    reservedDelta = -need;
  } else if (type === "production_consumption" && consumeReserved) {
    const need = Math.abs(qty);
    const reserved = Number(item.reservedQty || 0);
    const fromReserved = Math.min(reserved, need);
    const fromFree = need - fromReserved;
    if (availableQty(item) + 1e-9 < fromFree) throw ApiError.unprocessable("Insufficient stock");
    if (Number(item.stockQty || 0) + 1e-9 < need) throw ApiError.unprocessable("Insufficient stock");
    stockDelta = -need;
    reservedDelta = -fromReserved;
  } else if (inbound) {
    stockDelta = Math.abs(qty);
  } else {
    const need = Math.abs(qty);
    if (availableQty(item) + 1e-9 < need) throw ApiError.unprocessable("Insufficient available stock");
    stockDelta = -need;
  }

  const previousBalance = Number(item.stockQty || 0);
  const previousReserved = Number(item.reservedQty || 0);
  const nextStock = roundMoney(previousBalance + stockDelta);
  const nextReserved = roundMoney(previousReserved + reservedDelta);
  if (nextStock < -1e-9) throw ApiError.unprocessable("Insufficient stock");
  if (nextReserved < -1e-9) throw ApiError.unprocessable("Reserved quantity cannot go negative");
  if (nextReserved - nextStock > 1e-9) throw ApiError.unprocessable("Reserved quantity cannot exceed on-hand stock");

  let averageCost = Number(item.averageCost || item.costPerUnit || 0);
  const unitCost = opts.unitCost ?? Number(item.costPerUnit || 0);
  if (stockDelta > 0 && unitCost) {
    const newQty = nextStock;
    averageCost = newQty > 0 ? roundMoney((previousBalance * averageCost + stockDelta * unitCost) / newQty) : unitCost;
  }

  item.stockQty = nextStock;
  item.reservedQty = nextReserved;
  item.averageCost = averageCost;
  if (stockDelta > 0 && unitCost) item.costPerUnit = averageCost;
  item.lastMovementAt = new Date();
  if (opts.warehouse) item.warehouse = opts.warehouse;
  await item.save({ session: opts.session });

  try {
    const [transaction] = await InventoryTransaction.create(
      [
        {
          organizationId: opts.organizationId,
          branchId: opts.branchId,
          inventoryItemId: item._id,
          type,
          quantity: stockDelta || reservedDelta,
          unitCost,
          previousBalance,
          newBalance: nextStock,
          previousReserved,
          newReserved: nextReserved,
          referenceType: opts.referenceType,
          referenceId: opts.referenceId,
          reason: opts.reason,
          warehouse: opts.warehouse ?? item.warehouse,
          toInventoryItemId: opts.toInventoryItemId,
          idempotencyKey: opts.idempotencyKey,
          userId: opts.userId
        }
      ],
      { session: opts.session }
    );
    return { item: item.toObject(), transaction: transaction.toObject(), replayed: false };
  } catch (err) {
    if (isDuplicateKey(err)) {
      const replayed = await replayExisting(opts);
      if (replayed) return replayed;
    }
    throw err;
  }
}

export async function transferStock(opts: MoveStockInput & { toInventoryItemId: string }) {
  if (!opts.toInventoryItemId) throw ApiError.badRequest("Destination item required");
  if (opts.toInventoryItemId === opts.inventoryItemId) throw ApiError.badRequest("Cannot transfer to the same SKU");
  const qty = Math.abs(Number(opts.quantity));
  const key = opts.idempotencyKey;
  const from = await moveStock({
    ...opts,
    type: "transfer",
    quantity: qty,
    idempotencyKey: key ? `${key}:from` : undefined,
    consumeReserved: false
  });
  const to = await moveStock({
    ...opts,
    inventoryItemId: opts.toInventoryItemId,
    type: "inward",
    quantity: qty,
    reason: opts.reason ?? "Transfer inward",
    referenceType: opts.referenceType ?? "InventoryItem",
    referenceId: opts.inventoryItemId,
    idempotencyKey: key ? `${key}:to` : undefined
  });
  return { from, to, replayed: from.replayed && to.replayed };
}
