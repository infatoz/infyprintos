import mongoose from "mongoose";
import { z } from "zod";
import { ApiError } from "../../common/errors";
import { isIndia } from "../../common/geo";
import { escapeRegex } from "../../common/pagination";
import { Customer, CustomerAddress } from "../../models/Customer";

export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PINCODE_FORMAT = /^[1-9][0-9]{5}$/;

export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh"
};

export const TAX_REGISTRATIONS = ["unregistered", "registered", "composition", "sez", "overseas"] as const;
export const LIFECYCLE_STATUSES = ["prospect", "active", "inactive", "blocked"] as const;
export const ADDRESS_TYPES = ["registered", "billing", "shipping", "other"] as const;
export const ACTIVITY_TYPES = ["note", "call", "visit", "email", "whatsapp", "task", "status_change", "credit", "merge", "kyc", "assignment", "system"] as const;

export const BUSINESS_CATEGORIES = [
  "Printing & packaging",
  "Advertising agency",
  "Corporate office",
  "Retail",
  "Education",
  "Hospitality",
  "Healthcare",
  "Real estate",
  "Manufacturing",
  "E-commerce",
  "Events & exhibitions",
  "Government",
  "NGO / Trust",
  "Individual / Professional",
  "Other"
] as const;

export const BUSINESS_SIZES = ["Proprietor", "Micro", "Small", "Medium", "Large", "Enterprise"] as const;

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

export function normalizeEmail(value?: string | null) {
  const email = String(value ?? "").trim().toLowerCase();
  return email || undefined;
}

export function normalizeGstin(value?: string | null) {
  const gstin = String(value ?? "").replace(/\s/g, "").toUpperCase();
  return gstin || undefined;
}

export function normalizePan(value?: string | null) {
  const pan = String(value ?? "").replace(/\s/g, "").toUpperCase();
  return pan || undefined;
}

export function normalizePincode(value?: string | null) {
  const pin = String(value ?? "").replace(/\D/g, "");
  return pin || undefined;
}

/** GSTN MOD-36 checksum. Dummy/test GSTINs may fail; callers should not reject on checksum alone. */
export function gstinChecksumChar(gstin: string) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = chars.indexOf(gstin[i] ?? "");
    if (codePoint < 0) return null;
    let product = factor * codePoint;
    factor = factor === 1 ? 2 : 1;
    product = Math.floor(product / chars.length) + (product % chars.length);
    sum += product;
  }
  const check = (chars.length - (sum % chars.length)) % chars.length;
  return chars[check] ?? null;
}

export function gstinChecksumValid(gstin: string) {
  if (!GSTIN_FORMAT.test(gstin)) return false;
  return gstinChecksumChar(gstin) === gstin[14];
}

export function parseGstin(gstin: string) {
  const normalized = normalizeGstin(gstin) ?? "";
  const stateCode = normalized.slice(0, 2);
  return {
    gstin: normalized,
    stateCode,
    stateName: GST_STATES[stateCode],
    pan: normalized.slice(2, 12),
    entityCode: normalized[12],
    checksumValid: gstinChecksumValid(normalized)
  };
}

export function assertValidPincode(value?: string | null) {
  const pin = normalizePincode(value);
  if (!pin) return undefined;
  if (!PINCODE_FORMAT.test(pin)) throw ApiError.unprocessable("Pincode must be a 6-digit Indian PIN code");
  return pin;
}

export function assertTaxIdentity(opts: {
  gstin?: string | null;
  pan?: string | null;
  taxRegistration?: string | null;
}) {
  const gstin = normalizeGstin(opts.gstin);
  const pan = normalizePan(opts.pan);
  let taxRegistration = opts.taxRegistration || (gstin ? "registered" : "unregistered");

  if (gstin) {
    if (!GSTIN_FORMAT.test(gstin)) throw ApiError.unprocessable("GSTIN must be a 15-character GST identification number");
    const parsed = parseGstin(gstin);
    if (!parsed.stateName) throw ApiError.unprocessable("GSTIN state code is not a valid Indian GST state");
    if (taxRegistration === "unregistered") taxRegistration = "registered";
    if (pan && pan !== parsed.pan) throw ApiError.unprocessable("PAN must match the PAN embedded in GSTIN");
    return {
      gstin,
      pan: pan || parsed.pan,
      taxRegistration,
      gstStateCode: parsed.stateCode,
      gstState: parsed.stateName,
      gstinChecksumValid: parsed.checksumValid
    };
  }

  if (pan && !PAN_FORMAT.test(pan)) throw ApiError.unprocessable("PAN must be a 10-character permanent account number");
  return {
    gstin: undefined as string | undefined,
    pan,
    taxRegistration,
    gstStateCode: undefined as string | undefined,
    gstState: undefined as string | undefined,
    gstinChecksumValid: undefined as boolean | undefined
  };
}

export const addressFields = z.object({
  label: z.string().optional(),
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  country: z.string().optional(),
  gstin: z.string().optional()
});

export const customerPayloadSchema = z.object({
  name: z.string().min(2),
  phone: z.string().refine(isIndianMobile, "Phone must be a 10-digit mobile number"),
  whatsapp: z
    .string()
    .optional()
    .refine((value) => !value || isIndianMobile(value), "WhatsApp must be a 10-digit mobile number"),
  email: z.string().email().optional().or(z.literal("")),
  alternatePhone: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  assignedTo: z.string().optional().or(z.literal("")),
  tierId: z.string().optional().or(z.literal("")),
  creditTermId: z.string().optional().or(z.literal("")),
  creditLimit: z.coerce.number().min(0).optional(),
  creditReason: z.string().optional(),
  taxRegistration: z.enum(TAX_REGISTRATIONS).optional(),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
  whatsappOptIn: z.boolean().optional(),
  sameAddress: z.boolean().optional(),
  billingPreferences: z.string().optional(),
  business: z
    .object({
      name: z.string().optional(),
      category: z.string().optional(),
      size: z.string().optional(),
      gstin: z.string().optional(),
      pan: z.string().optional()
    })
    .optional(),
  address: addressFields.optional(),
  addresses: z
    .object({
      registered: addressFields.optional(),
      billing: addressFields.optional(),
      shipping: addressFields.optional()
    })
    .optional()
});

export const customerPatchSchema = customerPayloadSchema.partial().extend({
  name: z.string().min(2).optional(),
  phone: z.string().refine(isIndianMobile, "Phone must be a 10-digit mobile number").optional()
});

export const contactPayloadSchema = z.object({
  name: z.string().min(2),
  title: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  whatsapp: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional()
});

export const activityPayloadSchema = z.object({
  type: z.enum(["note", "call", "visit", "email", "whatsapp", "task"]),
  body: z.string().min(1),
  meta: z.record(z.unknown()).optional()
});

export type CustomerPayload = z.infer<typeof customerPayloadSchema>;
export type CustomerPatch = z.infer<typeof customerPatchSchema>;
export type ContactPayload = z.infer<typeof contactPayloadSchema>;
export type ActivityPayload = z.infer<typeof activityPayloadSchema>;

export function assertObjectId(id: string, message = "Not found") {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(message);
}

export function routeId(value: string | string[] | undefined, message = "Not found") {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw ApiError.notFound(message);
  assertObjectId(id, message);
  return id;
}

export function toCustomerFields(body: CustomerPayload) {
  const email = normalizeEmail(body.email);
  const identity = assertTaxIdentity({
    gstin: body.business?.gstin,
    pan: body.business?.pan,
    taxRegistration: body.taxRegistration
  });
  const assignedTo = body.assignedTo === "" ? null : body.assignedTo || undefined;
  return {
    name: body.name?.trim(),
    phone: body.phone?.trim(),
    phoneDigits: body.phone ? digits(body.phone) : undefined,
    whatsapp: body.whatsapp?.trim() || body.phone?.trim(),
    email,
    alternatePhone: body.alternatePhone?.trim() || undefined,
    type: body.type || "individual",
    tags: body.tags,
    source: body.source,
    notes: body.notes,
    assignedTo,
    tierId: body.tierId || undefined,
    creditTermId: body.creditTermId || undefined,
    creditLimit: body.creditLimit,
    taxRegistration: identity.taxRegistration,
    gstState: identity.gstState,
    gstStateCode: identity.gstStateCode,
    lifecycleStatus: body.lifecycleStatus,
    whatsappOptIn: body.whatsappOptIn,
    sameAddress: body.sameAddress ?? true,
    billingPreferences: body.billingPreferences,
    business: body.business
      ? {
          ...body.business,
          gstin: identity.gstin,
          pan: identity.pan,
          gstinChecksumValid: identity.gstinChecksumValid
        }
      : identity.gstin || identity.pan
        ? {
            gstin: identity.gstin,
            pan: identity.pan,
            gstinChecksumValid: identity.gstinChecksumValid
          }
        : undefined
  };
}

export async function findDuplicateCustomers(opts: {
  organizationId: string;
  phone?: string;
  email?: string;
  gstin?: string;
  excludeId?: string;
}) {
  const clauses: Record<string, unknown>[] = [];
  const phoneDigits = digits(opts.phone);
  if (phoneDigits.length === 10) {
    clauses.push({ phoneDigits }, { phone: opts.phone });
  }
  const email = normalizeEmail(opts.email);
  if (email) clauses.push({ email });
  const gstin = normalizeGstin(opts.gstin);
  if (gstin) clauses.push({ "business.gstin": new RegExp(`^${escapeRegex(gstin)}$`, "i") });
  if (!clauses.length) return [];

  const filter: Record<string, unknown> = {
    organizationId: opts.organizationId,
    deletedAt: null,
    $or: clauses
  };
  if (opts.excludeId) filter._id = { $ne: opts.excludeId };
  return Customer.find(filter).select("name code phone email business.gstin lifecycleStatus").limit(8);
}

export async function assertNoDuplicate(opts: {
  organizationId: string;
  phone?: string;
  email?: string;
  gstin?: string;
  excludeId?: string;
}) {
  const matches = await findDuplicateCustomers(opts);
  if (!matches.length) return;
  const first = matches[0];
  throw ApiError.conflict(`A customer already exists (${first.code} · ${first.name})`);
}

function hasAddress(value?: z.infer<typeof addressFields>) {
  if (!value) return false;
  return Boolean(value.line1 || value.city || value.state || value.pincode || value.line2);
}

export async function ensureSingleDefaultAddress(
  organizationId: string,
  customerId: string,
  type: string,
  addressId: string
) {
  await CustomerAddress.updateMany(
    { organizationId, customerId, type, _id: { $ne: addressId }, deletedAt: null, isDefault: true },
    { isDefault: false }
  );
}

export async function persistAddresses(
  organizationId: string,
  customerId: string,
  body: Pick<CustomerPayload, "address" | "addresses" | "sameAddress">,
  replace = false
) {
  const sameAddress = body.sameAddress ?? true;
  const registered = body.addresses?.registered;
  const billing = body.addresses?.billing ?? body.address ?? registered;
  const shipping = sameAddress ? billing : body.addresses?.shipping ?? billing;

  if (replace) {
    await CustomerAddress.updateMany({ customerId, organizationId, deletedAt: null }, { deletedAt: new Date() });
  }

  const writes: Array<{ type: "registered" | "billing" | "shipping"; data?: z.infer<typeof addressFields> }> = [
    { type: "registered", data: registered ?? billing },
    { type: "billing", data: billing },
    { type: "shipping", data: shipping }
  ];

  const created = [];
  const seen = new Set<string>();
  for (const row of writes) {
    if (!hasAddress(row.data) || seen.has(row.type)) continue;
    if (row.data?.pincode && isIndia(row.data.country)) assertValidPincode(row.data.pincode);
    seen.add(row.type);
    const address = await CustomerAddress.create({
      organizationId,
      customerId,
      ...row.data,
      country: row.data?.country?.trim() || "India",
      pincode: row.data?.pincode ? (isIndia(row.data.country) ? normalizePincode(row.data.pincode) : row.data.pincode.trim()) : row.data?.pincode,
      type: row.type,
      label: row.data?.label || row.type,
      isDefault: true
    });
    await ensureSingleDefaultAddress(organizationId, customerId, row.type, String(address._id));
    created.push(address);
  }
  return created;
}
