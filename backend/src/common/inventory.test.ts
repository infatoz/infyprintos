import { describe, expect, it } from "vitest";
import { availableQty } from "./inventory";

describe("availableQty", () => {
  it("subtracts reservations from on-hand stock", () => {
    expect(availableQty({ stockQty: 100, reservedQty: 25 })).toBe(75);
  });

  it("never treats missing reserved as stock", () => {
    expect(availableQty({ stockQty: 10 })).toBe(10);
  });
});
