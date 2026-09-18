import { describe, expect, it } from "vitest";
import {
  digits,
  gstinChecksumValid,
  normalizeEmail,
  normalizeGstin,
  parseGstin,
  assertTaxIdentity,
  isIndianMobile,
  GSTIN_FORMAT,
  PAN_FORMAT
} from "./customer.helpers";
import { ApiError } from "../../common/errors";

describe("customer identity helpers", () => {
  it("extracts phone digits", () => {
    expect(digits("+91 90000 00001")).toBe("9000000001");
    expect(digits("")).toBe("");
  });

  it("requires a 10-digit Indian mobile number", () => {
    expect(isIndianMobile("9876543210")).toBe(true);
    expect(isIndianMobile("+91 98765 43210")).toBe(true);
    expect(isIndianMobile("123")).toBe(false);
    expect(isIndianMobile("987654321")).toBe(false);
    expect(isIndianMobile("0876543210")).toBe(false);
  });

  it("normalizes email and GSTIN", () => {
    expect(normalizeEmail("  Owner@Press.COM ")).toBe("owner@press.com");
    expect(normalizeEmail("")).toBeUndefined();
    expect(normalizeGstin(" 29abcde1234f1z5 ")).toBe("29ABCDE1234F1Z5");
  });

  it("accepts the production test GSTIN format and Karnataka state", () => {
    const gstin = "29AABCU9603R1ZX";
    expect(GSTIN_FORMAT.test(gstin)).toBe(true);
    const parsed = parseGstin(gstin);
    expect(parsed.stateName).toBe("Karnataka");
    expect(parsed.pan).toBe("AABCU9603R");
    expect(PAN_FORMAT.test(parsed.pan)).toBe(true);
    expect(gstinChecksumValid(gstin)).toBe(false);
  });

  it("derives tax registration from GSTIN and rejects invalid numbers", () => {
    const ok = assertTaxIdentity({ gstin: "29AABCU9603R1ZX", pan: "AABCU9603R" });
    expect(ok.taxRegistration).toBe("registered");
    expect(ok.gstStateCode).toBe("29");
    expect(() => assertTaxIdentity({ gstin: "NOT-A-GSTIN" })).toThrow(ApiError);
    expect(() => assertTaxIdentity({ pan: "BADPAN" })).toThrow(ApiError);
    expect(assertTaxIdentity({ taxRegistration: "registered" }).taxRegistration).toBe("registered");
    expect(assertTaxIdentity({ taxRegistration: "registered" }).gstin).toBeUndefined();
  });
});
