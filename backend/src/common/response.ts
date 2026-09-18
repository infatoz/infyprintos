import type { Response } from "express";

export function ok<T>(res: Response, data: T, message = "OK") {
  return res.json({ success: true, message, data });
}

export function created<T>(res: Response, data: T, message = "Created") {
  return res.status(201).json({ success: true, message, data });
}

export function paginated<T>(
  res: Response,
  data: T[],
  meta: { page: number; limit: number; total: number },
  message = "OK"
) {
  return res.json({
    success: true,
    message,
    data,
    meta: {
      ...meta,
      pages: Math.ceil(meta.total / meta.limit) || 1
    }
  });
}
