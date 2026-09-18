export function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  if (n <= 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${belowThousand(rest)}` : ""}`;
}

/** Indian numbering for statutory documents (crore / lakh). */
export function amountInIndianWords(value: number): string {
  const abs = roundMoney(Math.abs(Number(value) || 0));
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const hundred = rupees % 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (hundred) parts.push(belowThousand(hundred));
  let out = rupees ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  if (paise) out += ` And ${belowThousand(paise)} Paise`;
  return `${out} Only`;
}

export function pct(amount: number, percent: number) {
  return roundMoney((amount * percent) / 100);
}

export type LineInput = {
  quantity: number;
  unitPrice: number;
  discountType?: "fixed" | "percent";
  discountValue?: number;
  taxRate?: number;
  taxInclusive?: boolean;
};

export type OrderTotals = {
  subtotal: number;
  itemDiscountTotal: number;
  orderDiscount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  additionalCharges: number;
  deliveryCharges: number;
  roundOff: number;
  grandTotal: number;
};

export function lineNet(input: LineInput) {
  const qty = Number(input.quantity || 0);
  const unit = Number(input.unitPrice || 0);
  const gross = roundMoney(qty * unit);
  let discount = 0;
  if (input.discountType === "percent") discount = pct(gross, input.discountValue ?? 0);
  if (input.discountType === "fixed") discount = roundMoney(input.discountValue ?? 0);
  discount = Math.min(discount, gross);
  const afterDiscount = roundMoney(gross - discount);
  const taxRate = Number(input.taxRate ?? 0);
  const inclusive = Boolean(input.taxInclusive);
  const taxable = inclusive ? roundMoney(afterDiscount / (1 + taxRate / 100)) : afterDiscount;
  const tax = inclusive ? roundMoney(afterDiscount - taxable) : pct(taxable, taxRate);
  const payable = inclusive ? afterDiscount : roundMoney(afterDiscount + tax);
  return { gross, discount, afterDiscount, taxable, tax, taxRate, payable };
}

export function computeOrderTotals(params: {
  lines: Array<ReturnType<typeof lineNet> & { taxRate?: number }>;
  orderDiscountType?: "fixed" | "percent";
  orderDiscountValue?: number;
  additionalCharges?: number;
  deliveryCharges?: number;
  roundOff?: number;
  interstate?: boolean;
  autoRound?: boolean;
}): OrderTotals {
  const subtotal = roundMoney(params.lines.reduce((s, l) => s + l.gross, 0));
  const itemDiscountTotal = roundMoney(params.lines.reduce((s, l) => s + l.discount, 0));
  const afterItems = roundMoney(params.lines.reduce((s, l) => s + (l.payable ?? l.afterDiscount), 0));
  let orderDiscount = 0;
  if (params.orderDiscountType === "percent") orderDiscount = pct(afterItems, params.orderDiscountValue ?? 0);
  if (params.orderDiscountType === "fixed") orderDiscount = roundMoney(params.orderDiscountValue ?? 0);
  orderDiscount = Math.min(orderDiscount, afterItems);
  const ratio = afterItems === 0 ? 0 : (afterItems - orderDiscount) / afterItems;
  const taxableValue = roundMoney(params.lines.reduce((s, l) => s + l.taxable * ratio, 0));
  const taxTotal = roundMoney(params.lines.reduce((s, l) => s + l.tax * ratio, 0));
  const interstate = Boolean(params.interstate);
  const cgst = interstate ? 0 : roundMoney(taxTotal / 2);
  const sgst = interstate ? 0 : roundMoney(taxTotal - cgst);
  const igst = interstate ? taxTotal : 0;
  const additionalCharges = roundMoney(params.additionalCharges ?? 0);
  const deliveryCharges = roundMoney(params.deliveryCharges ?? 0);
  const beforeRound = roundMoney(afterItems - orderDiscount + additionalCharges + deliveryCharges);
  const roundOff = params.autoRound ? roundMoney(Math.round(beforeRound) - beforeRound) : roundMoney(params.roundOff ?? 0);
  const grandTotal = roundMoney(beforeRound + roundOff);
  return {
    subtotal,
    itemDiscountTotal,
    orderDiscount,
    taxableValue,
    cgst,
    sgst,
    igst,
    taxTotal,
    additionalCharges,
    deliveryCharges,
    roundOff,
    grandTotal
  };
}
