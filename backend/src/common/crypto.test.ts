import { describe, expect, it } from "vitest";
import { randomToken, sha256 } from "./crypto";

describe("crypto helpers", () => {
  it("hashes deterministically", () => {
    expect(sha256("infatoz")).toBe(sha256("infatoz"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("issues unguessable random tokens", () => {
    expect(randomToken(16)).toHaveLength(32);
    expect(randomToken()).not.toBe(randomToken());
  });
});
