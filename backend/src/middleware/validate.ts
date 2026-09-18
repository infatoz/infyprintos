import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ApiError } from "../common/errors";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(ApiError.unprocessable("Validation failed", parsed.error.flatten()));
    }
    (req as Request & { validated: unknown }).validated = parsed.data;
    if (source === "body") req.body = parsed.data;
    next();
  };
}
