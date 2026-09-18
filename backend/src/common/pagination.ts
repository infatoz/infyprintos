import type { Request } from "express";

export function parsePagination(req: Request) {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
  const skip = (page - 1) * limit;
  const search = String(req.query.search ?? "").trim();
  const sort = String(req.query.sort ?? "-createdAt");
  return { page, limit, skip, search, sort };
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function safeSort(sort: string, allowed: string[], fallback = "-createdAt") {
  const key = sort.replace(/^-/, "");
  if (!allowed.includes(key)) return fallback;
  return sort.startsWith("-") ? `-${key}` : key;
}
