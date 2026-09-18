import { ApiError } from "./errors";

export function canTransition(allowed: string[] | undefined, to: string, isOwner: boolean) {
  if (isOwner) return true;
  if (!allowed?.length) return true;
  return allowed.includes(to);
}

export function assertStatusChange(input: {
  locked?: boolean;
  isOwner: boolean;
  fromStatus: string;
  toStatus: string;
  allowedTransitions?: string[];
  requiresReason?: boolean;
  reason?: string;
  designBlocked?: boolean;
}) {
  if (input.locked && !input.isOwner) {
    throw ApiError.forbidden("Order is locked");
  }
  if (!canTransition(input.allowedTransitions, input.toStatus, input.isOwner)) {
    throw ApiError.unprocessable(`Cannot move from ${input.fromStatus} to ${input.toStatus}`);
  }
  if (input.requiresReason && !String(input.reason ?? "").trim()) {
    throw ApiError.unprocessable("Reason required");
  }
  if (input.toStatus === "ready_to_print" && input.designBlocked) {
    throw ApiError.unprocessable("Design approval required before printing");
  }
}

export function isTerminalStatus(code: string) {
  return ["completed", "cancelled"].includes(code);
}

export function shouldLockOrder(code: string) {
  return ["delivered", "completed"].includes(code);
}
