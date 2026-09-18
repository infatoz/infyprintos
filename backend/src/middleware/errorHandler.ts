import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../common/errors";
import { env } from "../config/env";
import { logger } from "../config/logger";

function errorsFrom(details: unknown): unknown[] {
  if (Array.isArray(details)) return details;
  if (details == null) return [];
  return [details];
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
      errors: errorsFrom(err.details),
      details: err.details
    });
  }
  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return res.status(422).json({
      success: false,
      code: "UNPROCESSABLE",
      message: "Validation failed",
      errors,
      details: err.flatten()
    });
  }
  const anyErr = err as { status?: number; message?: string; name?: string; code?: number };
  if (anyErr?.code === 11000) {
    return res.status(409).json({ success: false, code: "CONFLICT", message: "Duplicate record", errors: [] });
  }
  logger.error({ err, path: req.path }, "unhandled_error");
  return res.status(anyErr.status ?? 500).json({
    success: false,
    code: "INTERNAL",
    message: env.isProd ? "Internal server error" : anyErr.message ?? "Internal server error",
    errors: []
  });
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ success: false, code: "NOT_FOUND", message: "Route not found", errors: [] });
}
