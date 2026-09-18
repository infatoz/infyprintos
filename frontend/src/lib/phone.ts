export function digits(value?: string | null) {
  let d = String(value ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function isIndianMobile(value?: string | null) {
  const d = digits(value);
  return d.length === 10 && /^[6-9]/.test(d);
}
