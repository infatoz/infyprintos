import { AuditLog } from "../models/Settings";
import type { AuthedRequest } from "./auth";

export async function writeAudit(
  req: AuthedRequest,
  action: string,
  entityType?: string,
  entityId?: string,
  before?: unknown,
  after?: unknown
) {
  await AuditLog.create({
    organizationId: req.user.organizationId,
    branchId: req.user.branchId,
    actorId: req.user.id,
    action,
    entityType,
    entityId,
    before,
    after,
    ip: req.ip,
    userAgent: req.get("user-agent")
  });
}
