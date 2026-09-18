import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../common/errors";
import { hasPermission, type Permission } from "../common/permissions";

export function requirePermission(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!hasPermission(req.user, needed, "all")) return next(ApiError.forbidden());
    next();
  };
}

export function requireAny(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!hasPermission(req.user, needed, "any")) return next(ApiError.forbidden());
    next();
  };
}
