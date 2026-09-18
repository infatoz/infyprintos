export const CUSTOMER_SOURCES = [
  "Walk-in",
  "Phone enquiry",
  "WhatsApp",
  "Website",
  "Google",
  "Instagram",
  "Facebook",
  "Referral",
  "Sales visit",
  "Exhibition",
  "Repeat customer",
  "Other"
] as const;

export const COUNTRIES = [
  "India",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Oman",
  "Kuwait",
  "Bahrain",
  "Nepal",
  "Bangladesh",
  "Sri Lanka",
  "Bhutan",
  "Maldives",
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Thailand",
  "United Kingdom",
  "United States",
  "Canada",
  "Australia",
  "New Zealand",
  "Germany",
  "France",
  "Italy",
  "Netherlands",
  "Ireland",
  "South Africa",
  "Kenya",
  "Nigeria",
  "China",
  "Japan",
  "South Korea",
  "Hong Kong",
  "Other"
] as const;

export function isIndia(country?: string | null) {
  const value = String(country ?? "India").trim().toLowerCase();
  return !value || value === "india" || value === "in" || value === "ind" || value === "bharat";
}

export type PincodeLookup = {
  pincode: string;
  city: string;
  state: string;
  country: string;
  district?: string;
  offices?: string[];
};

export function parsePostalLookup(payload: unknown, pin: string): PincodeLookup | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const body = row as { Status?: string; PostOffice?: Array<Record<string, unknown>> };
  if (body.Status !== "Success" || !Array.isArray(body.PostOffice) || !body.PostOffice.length) return null;
  const office = body.PostOffice[0] ?? {};
  const city = String(office.District || office.Block || office.Region || office.Name || "").trim();
  const state = String(office.State || "").trim();
  if (!city && !state) return null;
  return {
    pincode: pin,
    city,
    state,
    country: String(office.Country || "India").trim() || "India",
    district: String(office.District || "").trim() || undefined,
    offices: body.PostOffice.map((o) => String(o.Name ?? "")).filter(Boolean)
  };
}

export async function lookupIndianPincode(pin: string, fetcher: typeof fetch = fetch): Promise<PincodeLookup | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const res = await fetcher(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    return parsePostalLookup(await res.json(), pin);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
