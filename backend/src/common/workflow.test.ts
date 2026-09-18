import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { assertStatusChange, canTransition, shouldLockOrder } from "./workflow";

describe("canTransition", () => {
  it("allows owner any move", () => {
    expect(canTransition(["ready_to_print"], "cancelled", true)).toBe(true);
  });

  it("blocks disallowed staff moves", () => {
    expect(canTransition(["in_production"], "cancelled", false)).toBe(false);
  });

  it("allows any move when the matrix is empty", () => {
    expect(canTransition([], "delivered", false)).toBe(true);
  });
});

describe("assertStatusChange", () => {
  it("blocks ready_to_print without approved artwork", () => {
    expect(() =>
      assertStatusChange({
        isOwner: false,
        fromStatus: "awaiting_design_approval",
        toStatus: "ready_to_print",
        designBlocked: true
      })
    ).toThrow(ApiError);
  });

  it("requires a reason when configured", () => {
    expect(() =>
      assertStatusChange({
        isOwner: false,
        fromStatus: "in_production",
        toStatus: "delayed",
        requiresReason: true,
        reason: " "
      })
    ).toThrow(ApiError);
  });

  it("locks delivered and completed orders from ordinary staff", () => {
    expect(() =>
      assertStatusChange({
        locked: true,
        isOwner: false,
        fromStatus: "delivered",
        toStatus: "in_production"
      })
    ).toThrow(ApiError);
  });

  it("lets the owner override a locked order", () => {
    expect(() =>
      assertStatusChange({
        locked: true,
        isOwner: true,
        fromStatus: "delivered",
        toStatus: "in_production"
      })
    ).not.toThrow();
  });
});

describe("shouldLockOrder", () => {
  it("locks delivered and completed", () => {
    expect(shouldLockOrder("delivered")).toBe(true);
    expect(shouldLockOrder("in_production")).toBe(false);
  });
});
