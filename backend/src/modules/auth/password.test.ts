import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

describe("password hashing", () => {
  it("stores a bcrypt hash rather than plaintext", async () => {
    const password = "Owner@12345";
    const hash = await bcrypt.hash(password, 10);
    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare("wrong-password", hash)).toBe(false);
  });
});
