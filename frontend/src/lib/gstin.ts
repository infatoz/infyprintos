export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PINCODE_FORMAT = /^[1-9][0-9]{5}$/;

export function normalizeGstin(value?: string | null) {
  const gstin = String(value ?? "").replace(/\s/g, "").toUpperCase();
  return gstin || "";
}

export function gstinChecksumValid(gstin: string) {
  const g = normalizeGstin(gstin);
  if (!GSTIN_FORMAT.test(g)) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = chars.indexOf(g[i] ?? "");
    if (codePoint < 0) return false;
    let product = factor * codePoint;
    factor = factor === 1 ? 2 : 1;
    product = Math.floor(product / chars.length) + (product % chars.length);
    sum += product;
  }
  const check = (chars.length - (sum % chars.length)) % chars.length;
  return chars[check] === g[14];
}

export function gstinStateCode(value?: string | null) {
  const gstin = normalizeGstin(value);
  return gstin.slice(0, 2);
}
