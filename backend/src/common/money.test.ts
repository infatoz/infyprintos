import { describe, expect, it } from "vitest";
import { amountInIndianWords, computeOrderTotals, lineNet, roundMoney } from "../common/money";

describe("roundMoney", () => {
  it("rounds half to nearest paise", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(1.234)).toBe(1.23);
  });
});

describe("lineNet", () => {
  it("applies percent discount then exclusive GST", () => {
    const line = lineNet({ quantity: 2, unitPrice: 100, discountType: "percent", discountValue: 10, taxRate: 18, taxInclusive: false });
    expect(line.gross).toBe(200);
    expect(line.discount).toBe(20);
    expect(line.afterDiscount).toBe(180);
    expect(line.taxable).toBe(180);
    expect(line.tax).toBe(32.4);
    expect(line.payable).toBe(212.4);
  });

  it("extracts tax from inclusive prices", () => {
    const line = lineNet({ quantity: 1, unitPrice: 118, taxRate: 18, taxInclusive: true });
    expect(line.taxable).toBe(100);
    expect(line.tax).toBe(18);
  });

  it("never discounts below zero", () => {
    const line = lineNet({ quantity: 1, unitPrice: 50, discountType: "fixed", discountValue: 80 });
    expect(line.discount).toBe(50);
    expect(line.afterDiscount).toBe(0);
  });
});

describe("computeOrderTotals", () => {
  it("includes exclusive GST in the grand total", () => {
    const totals = computeOrderTotals({
      lines: [lineNet({ quantity: 1, unitPrice: 1000, taxRate: 18, taxInclusive: false })]
    });
    expect(totals.taxTotal).toBe(180);
    expect(totals.grandTotal).toBe(1180);
  });

  it("splits intra-state GST and keeps charges outside item discount", () => {
    const lines = [
      lineNet({ quantity: 1, unitPrice: 1000, taxRate: 18, taxInclusive: false }),
      lineNet({ quantity: 1, unitPrice: 500, discountType: "percent", discountValue: 10, taxRate: 18, taxInclusive: false })
    ];
    const totals = computeOrderTotals({
      lines,
      orderDiscountType: "fixed",
      orderDiscountValue: 100,
      additionalCharges: 50,
      deliveryCharges: 40,
      roundOff: -0.3
    });
    expect(totals.subtotal).toBe(1500);
    expect(totals.itemDiscountTotal).toBe(50);
    expect(totals.orderDiscount).toBe(100);
    expect(totals.additionalCharges).toBe(50);
    expect(totals.deliveryCharges).toBe(40);
    expect(roundMoney(totals.cgst + totals.sgst)).toBe(totals.taxTotal);
    expect(Math.abs(totals.cgst - totals.sgst)).toBeLessThanOrEqual(0.01);
    expect(totals.igst).toBe(0);
    expect(totals.taxTotal).toBeGreaterThan(0);
    expect(totals.grandTotal).toBeGreaterThan(totals.subtotal - totals.itemDiscountTotal - totals.orderDiscount);
  });

  it("uses IGST for interstate invoices", () => {
    const totals = computeOrderTotals({
      lines: [lineNet({ quantity: 1, unitPrice: 118, taxRate: 18, taxInclusive: true })],
      interstate: true
    });
    expect(totals.igst).toBe(18);
    expect(totals.cgst).toBe(0);
    expect(totals.sgst).toBe(0);
  });

  it("auto-rounds grand total to the nearest rupee", () => {
    const totals = computeOrderTotals({
      lines: [lineNet({ quantity: 1, unitPrice: 10, taxRate: 18, taxInclusive: false })],
      autoRound: true
    });
    expect(totals.grandTotal).toBe(12);
    expect(totals.roundOff).toBe(0.2);
  });
});

describe("amountInIndianWords", () => {
  it("formats rupees and paise with crore/lakh grouping", () => {
    expect(amountInIndianWords(0)).toBe("Zero Rupees Only");
    expect(amountInIndianWords(1)).toBe("Rupees One Only");
    expect(amountInIndianWords(354)).toBe("Rupees Three Hundred Fifty Four Only");
    expect(amountInIndianWords(123456.78)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six And Seventy Eight Paise Only"
    );
    expect(amountInIndianWords(10_000_000)).toBe("Rupees One Crore Only");
  });
});
