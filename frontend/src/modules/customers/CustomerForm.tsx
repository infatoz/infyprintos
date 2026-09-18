import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Avatar, Button, Field, Input, SearchableSelect, Textarea } from "@/components/ui";
import { GSTIN_FORMAT, PAN_FORMAT, PINCODE_FORMAT, gstinChecksumValid, normalizeGstin } from "@/lib/gstin";
import { digits, isIndianMobile } from "@/lib/phone";

export type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

export type CustomerFormValue = {
  name: string;
  phone: string;
  whatsapp: string;
  whatsappSameAsPhone: boolean;
  email: string;
  alternatePhone: string;
  type: string;
  source: string;
  notes: string;
  tags: string;
  assignedTo: string;
  taxRegistration: string;
  lifecycleStatus: string;
  whatsappOptIn: boolean;
  businessName: string;
  category: string;
  size: string;
  gstin: string;
  pan: string;
  tierId: string;
  creditTermId: string;
  creditLimit: string;
  creditReason: string;
  sameAddress: boolean;
  photoUrl?: string;
  registered: AddressForm;
  billing: AddressForm;
  shipping: AddressForm;
};

const emptyAddress = (): AddressForm => ({ line1: "", line2: "", city: "", state: "", pincode: "", country: "India" });

export const emptyCustomerForm = (): CustomerFormValue => ({
  name: "",
  phone: "",
  whatsapp: "",
  whatsappSameAsPhone: true,
  email: "",
  alternatePhone: "",
  type: "individual",
  source: "",
  notes: "",
  tags: "",
  assignedTo: "",
  taxRegistration: "unregistered",
  lifecycleStatus: "active",
  whatsappOptIn: true,
  businessName: "",
  category: "",
  size: "",
  gstin: "",
  pan: "",
  tierId: "",
  creditTermId: "",
  creditLimit: "",
  creditReason: "",
  sameAddress: true,
  registered: emptyAddress(),
  billing: emptyAddress(),
  shipping: emptyAddress()
});

export function customerToForm(customer: Record<string, unknown>, addresses: Array<Record<string, unknown>> = []): CustomerFormValue {
  const pick = (type: string) => {
    const row = addresses.find((a) => a.type === type);
    return {
      line1: String(row?.line1 ?? ""),
      line2: String(row?.line2 ?? ""),
      city: String(row?.city ?? ""),
      state: String(row?.state ?? ""),
      pincode: String(row?.pincode ?? ""),
      country: String(row?.country ?? "India") || "India"
    };
  };
  const business = (customer.business as Record<string, string> | undefined) ?? {};
  const phone = String(customer.phone ?? "");
  const whatsapp = String(customer.whatsapp ?? "");
  return {
    ...emptyCustomerForm(),
    name: String(customer.name ?? ""),
    phone,
    whatsapp,
    whatsappSameAsPhone: !whatsapp || digits(whatsapp) === digits(phone),
    email: String(customer.email ?? ""),
    alternatePhone: String(customer.alternatePhone ?? ""),
    type: String(customer.type ?? "individual"),
    source: String(customer.source ?? ""),
    notes: String(customer.notes ?? ""),
    tags: Array.isArray(customer.tags) ? (customer.tags as string[]).join(", ") : "",
    assignedTo: String((customer.assignedTo as { _id?: string })?._id ?? customer.assignedTo ?? ""),
    taxRegistration: String(customer.taxRegistration ?? "unregistered"),
    lifecycleStatus: String(customer.lifecycleStatus ?? "active"),
    whatsappOptIn: customer.whatsappOptIn !== false,
    businessName: business.name ?? "",
    category: business.category ?? "",
    size: business.size ?? "",
    gstin: business.gstin ?? "",
    pan: business.pan ?? "",
    tierId: String((customer.tierId as { _id?: string })?._id ?? customer.tierId ?? ""),
    creditTermId: String((customer.creditTermId as { _id?: string })?._id ?? customer.creditTermId ?? ""),
    creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : "",
    sameAddress: customer.sameAddress !== false,
    photoUrl: String(customer.photoUrl ?? "") || undefined,
    registered: pick("registered"),
    billing: pick("billing"),
    shipping: pick("shipping")
  };
}

export function formToPayload(form: CustomerFormValue, opts?: { includeCredit?: boolean }) {
  const registered = form.registered;
  const billing = form.sameAddress ? registered : form.billing;
  const shipping = form.sameAddress ? registered : form.shipping;
  const tags = form.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const payload: Record<string, unknown> = {
    name: form.name,
    phone: form.phone,
    whatsapp: form.whatsappSameAsPhone ? form.phone : form.whatsapp,
    email: form.email,
    alternatePhone: form.alternatePhone || undefined,
    type: form.type,
    source: form.source || undefined,
    notes: form.notes || undefined,
    tags,
    assignedTo: form.assignedTo,
    taxRegistration: form.taxRegistration,
    lifecycleStatus: form.lifecycleStatus,
    whatsappOptIn: form.whatsappOptIn,
    sameAddress: form.sameAddress,
    business: {
      name: form.businessName || undefined,
      category: form.category || undefined,
      size: form.size || undefined,
      gstin: form.gstin || undefined,
      pan: form.pan || undefined
    },
    addresses: { registered, billing, shipping }
  };
  if (opts?.includeCredit !== false) {
    payload.tierId = form.tierId || undefined;
    payload.creditTermId = form.creditTermId || undefined;
    payload.creditLimit = form.creditLimit ? Number(form.creditLimit) : 0;
    if (form.creditReason.trim()) payload.creditReason = form.creditReason.trim();
  } else {
    payload.tierId = form.tierId || undefined;
  }
  return payload;
}

function AddressFields({
  value,
  onChange,
  states,
  countries
}: {
  value: AddressForm;
  onChange: (next: AddressForm) => void;
  states: Array<{ code: string; name: string }>;
  countries: string[];
}) {
  const lastPin = useRef(value.pincode.replace(/\D/g, ""));
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;
  const india = !value.country || value.country === "India";
  const pinDigits = value.pincode.replace(/\D/g, "");
  const pinOk = !value.pincode || !india || PINCODE_FORMAT.test(pinDigits);

  useEffect(() => {
    if (!india || !PINCODE_FORMAT.test(pinDigits) || pinDigits === lastPin.current) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const { data } = await api.get(`/customers/pincode/${pinDigits}`);
          const loc = data.data as { city?: string; state?: string; country?: string };
          lastPin.current = pinDigits;
          const current = valueRef.current;
          onChangeRef.current({
            ...current,
            city: loc.city || current.city,
            state: loc.state || current.state,
            country: loc.country || current.country || "India"
          });
        } catch {
          lastPin.current = pinDigits;
        }
      })();
    }, 400);
    return () => window.clearTimeout(handle);
  }, [pinDigits, india]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Country">
        <SearchableSelect
          value={value.country || "India"}
          onChange={(country) => onChange({ ...value, country })}
          options={(countries.length ? countries : ["India"]).map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="Pincode" hint={pinOk ? (india ? "City and state fill from the PIN" : undefined) : "Use a 6-digit Indian PIN code"}>
        <Input value={value.pincode} onChange={(e) => onChange({ ...value, pincode: e.target.value })} inputMode="numeric" />
      </Field>
      <Field label="City">
        <Input value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
      </Field>
      <Field label="State">
        {india && states.length ? (
          <SearchableSelect
            value={value.state}
            onChange={(state) => onChange({ ...value, state })}
            emptyLabel="Select state"
            options={states.map((s) => ({ value: s.name, label: s.name, hint: s.code }))}
          />
        ) : (
          <Input value={value.state} onChange={(e) => onChange({ ...value, state: e.target.value })} />
        )}
      </Field>
      <Field label="Line 1">
        <Input value={value.line1} onChange={(e) => onChange({ ...value, line1: e.target.value })} />
      </Field>
      <Field label="Line 2">
        <Input value={value.line2} onChange={(e) => onChange({ ...value, line2: e.target.value })} />
      </Field>
    </div>
  );
}

export type CustomerFormExtras = { photo?: File | null; removePhoto?: boolean };

export function CustomerForm({
  initial,
  tiers,
  terms,
  assignees = [],
  states = [],
  sources = [],
  countries = ["India"],
  categories = [],
  sizes = [],
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
  mode = "create",
  canEditCredit = true
}: {
  initial?: CustomerFormValue;
  tiers: Array<{ _id: string; name: string }>;
  terms: Array<{ _id: string; name: string }>;
  assignees?: Array<{ _id: string; name: string; email?: string }>;
  states?: Array<{ code: string; name: string }>;
  sources?: string[];
  countries?: string[];
  categories?: string[];
  sizes?: string[];
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>, extras?: CustomerFormExtras) => void;
  onCancel: () => void;
  mode?: "create" | "edit";
  canEditCredit?: boolean;
}) {
  const [form, setForm] = useState<CustomerFormValue>(initial ?? emptyCustomerForm());
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | undefined>(initial?.photoUrl);
  const [removePhoto, setRemovePhoto] = useState(false);
  useEffect(() => {
    if (initial) {
      setForm(initial);
      setPhotoPreview(initial.photoUrl);
      setPhoto(null);
      setRemovePhoto(false);
    }
  }, [initial]);

  const includeCredit = mode === "create" || canEditCredit;
  const gstin = normalizeGstin(form.gstin);
  const gstinFormatOk = !gstin || GSTIN_FORMAT.test(gstin);
  const checksumOk = !gstin || !gstinFormatOk || gstinChecksumValid(gstin);
  const panOk = !form.pan || PAN_FORMAT.test(form.pan.replace(/\s/g, "").toUpperCase());
  const creditChanged =
    mode === "edit" &&
    includeCredit &&
    initial &&
    (form.creditLimit !== (initial.creditLimit ?? "") || form.creditTermId !== initial.creditTermId || form.lifecycleStatus === "blocked");

  const preview = useMemo(() => formToPayload(form, { includeCredit }), [form, includeCredit]);
  const sourceOptions = useMemo(() => {
    const list = [...sources];
    if (form.source && !list.includes(form.source)) list.unshift(form.source);
    return list.map((s) => ({ value: s, label: s }));
  }, [sources, form.source]);
  const categoryOptions = useMemo(() => {
    const list = [...categories];
    if (form.category && !list.includes(form.category)) list.unshift(form.category);
    return list.map((s) => ({ value: s, label: s }));
  }, [categories, form.category]);
  const sizeOptions = useMemo(() => {
    const list = [...sizes];
    if (form.size && !list.includes(form.size)) list.unshift(form.size);
    return list.map((s) => ({ value: s, label: s }));
  }, [sizes, form.size]);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isIndianMobile(form.phone)) {
          setError("Phone must be a 10-digit mobile number");
          return;
        }
        if (!form.whatsappSameAsPhone && form.whatsapp && !isIndianMobile(form.whatsapp)) {
          setError("WhatsApp must be a 10-digit mobile number");
          return;
        }
        if (form.alternatePhone && !isIndianMobile(form.alternatePhone)) {
          setError("Alternate phone must be a 10-digit mobile number");
          return;
        }
        if (!gstinFormatOk) {
          setError("GSTIN must be a 15-character GST identification number");
          return;
        }
        if (!panOk) {
          setError("PAN must be a 10-character permanent account number");
          return;
        }
        if (creditChanged && !form.creditReason.trim()) {
          setError("Enter a reason for the credit or blocked-status change");
          return;
        }
        setError("");
        onSubmit(preview, { photo, removePhoto });
      }}
    >
      <section>
        <h4 className="mb-3 text-[12px] font-medium text-ink/50">Contact</h4>
        <div className="mb-4 flex items-center gap-4">
          <Avatar name={form.name} src={removePhoto ? undefined : photoPreview} size={64} />
          <div className="text-[13px]">
            <p className="font-medium">Profile photo</p>
            <p className="text-[12px] text-muted">Optional. Initials are used when no photo is set.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="cursor-pointer text-[12px] font-medium text-accent">
                Upload
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setPhoto(file);
                    setRemovePhoto(false);
                    setPhotoPreview(file ? URL.createObjectURL(file) : initial?.photoUrl);
                  }}
                />
              </label>
              {(photoPreview || form.photoUrl) && !removePhoto && (
                <button
                  type="button"
                  className="text-[12px] font-medium text-muted"
                  onClick={() => {
                    setPhoto(null);
                    setRemovePhoto(true);
                    setPhotoPreview(undefined);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Phone" hint={!form.phone || isIndianMobile(form.phone) ? undefined : "Enter a 10-digit mobile number"}>
            <Input
              required
              inputMode="numeric"
              value={form.phone}
              onChange={(e) =>
                setForm({
                  ...form,
                  phone: e.target.value,
                  whatsapp: form.whatsappSameAsPhone ? e.target.value : form.whatsapp
                })
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="WhatsApp">
              <Input
                inputMode="numeric"
                disabled={form.whatsappSameAsPhone}
                value={form.whatsappSameAsPhone ? form.phone : form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="10-digit WhatsApp number"
              />
            </Field>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={form.whatsappSameAsPhone}
                onChange={(e) =>
                  setForm({
                    ...form,
                    whatsappSameAsPhone: e.target.checked,
                    whatsapp: e.target.checked ? form.phone : form.whatsapp
                  })
                }
              />
              Same as phone number
            </label>
          </div>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Alternate phone">
            <Input value={form.alternatePhone} onChange={(e) => setForm({ ...form, alternatePhone: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Type">
            <SearchableSelect
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={[
                { value: "individual", label: "Individual" },
                { value: "business", label: "Business" },
                { value: "wholesale", label: "Wholesale" }
              ]}
            />
          </Field>
          <Field label="Source">
            <SearchableSelect
              value={form.source}
              onChange={(source) => setForm({ ...form, source })}
              emptyLabel="Select source"
              options={sourceOptions}
            />
          </Field>
          <Field label="Lifecycle">
            <SearchableSelect
              value={form.lifecycleStatus}
              onChange={(lifecycleStatus) => setForm({ ...form, lifecycleStatus })}
              options={[
                { value: "prospect", label: "Prospect" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "blocked", label: "Blocked", disabled: mode === "edit" && !canEditCredit }
              ]}
            />
          </Field>
          <Field label="Account owner">
            <SearchableSelect
              value={form.assignedTo}
              onChange={(assignedTo) => setForm({ ...form, assignedTo })}
              emptyLabel="Unassigned"
              options={assignees.map((a) => ({ value: a._id, label: a.name, hint: a.email }))}
            />
          </Field>
          <Field label="Tags" hint="Comma-separated">
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="VIP, agency, repeat" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={form.whatsappOptIn} onChange={(e) => setForm({ ...form, whatsappOptIn: e.target.checked })} />
            WhatsApp opt-in
          </label>
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[12px] font-medium text-ink/50">Business & tax</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name">
            <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          </Field>
          <Field label="GST registration">
            <SearchableSelect
              value={form.taxRegistration}
              onChange={(taxRegistration) => setForm({ ...form, taxRegistration })}
              options={[
                { value: "unregistered", label: "Unregistered" },
                { value: "registered", label: "Registered" },
                { value: "composition", label: "Composition" },
                { value: "sez", label: "SEZ" },
                { value: "overseas", label: "Overseas" }
              ]}
            />
          </Field>
          <Field label="Category">
            <SearchableSelect
              value={form.category}
              onChange={(category) => setForm({ ...form, category })}
              emptyLabel="Select category"
              options={categoryOptions}
            />
          </Field>
          <Field label="Size">
            <SearchableSelect
              value={form.size}
              onChange={(size) => setForm({ ...form, size })}
              emptyLabel="Select size"
              options={sizeOptions}
            />
          </Field>
          <Field
            label="GSTIN"
            hint={
              !gstin
                ? "Optional"
                : !gstinFormatOk
                ? "Must be 15 characters, e.g. 29AABCU9603R1ZX"
                : !checksumOk
                  ? "Format is valid; GSTN checksum does not match (accepted for known test GSTINs)"
                  : "Optional"
            }
          >
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="PAN" hint={!form.pan ? "Optional" : panOk ? "Optional" : "PAN format is AAAAA9999A"}>
            <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
          </Field>
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[12px] font-medium text-ink/50">Credit</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tier">
            <SearchableSelect
              value={form.tierId}
              onChange={(tierId) => setForm({ ...form, tierId })}
              emptyLabel="No tier"
              options={tiers.map((t) => ({ value: t._id, label: t.name }))}
            />
          </Field>
          <Field label="Credit terms">
            <SearchableSelect
              value={form.creditTermId}
              disabled={!includeCredit}
              onChange={(creditTermId) => setForm({ ...form, creditTermId })}
              emptyLabel="Select"
              options={terms.map((t) => ({ value: t._id, label: t.name }))}
            />
          </Field>
          <Field label="Credit limit">
            <Input
              type="number"
              min={0}
              disabled={!includeCredit}
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
          </Field>
        </div>
        {mode === "edit" && includeCredit && (
          <div className="mt-3">
            <Field label="Credit change reason" hint="Required when limit, terms or blocked status change">
              <Input value={form.creditReason} onChange={(e) => setForm({ ...form, creditReason: e.target.value })} />
            </Field>
          </div>
        )}
        {!includeCredit && <p className="mt-2 text-xs text-ink/45">Credit limit and terms can only be changed by a role with credit permission.</p>}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[12px] font-medium text-ink/50">Addresses</h4>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.sameAddress} onChange={(e) => setForm({ ...form, sameAddress: e.target.checked })} />
            Same billing & shipping address
          </label>
        </div>
        <p className="mb-2 text-xs font-semibold text-ink/45">Registered</p>
        <AddressFields
          value={form.registered}
          states={states}
          countries={countries}
          onChange={(registered) => setForm((prev) => ({ ...prev, registered }))}
        />
        {!form.sameAddress && (
          <>
            <p className="mb-2 mt-4 text-xs font-semibold text-ink/45">Billing</p>
            <AddressFields
              value={form.billing}
              states={states}
              countries={countries}
              onChange={(billing) => setForm((prev) => ({ ...prev, billing }))}
            />
            <p className="mb-2 mt-4 text-xs font-semibold text-ink/45">Shipping</p>
            <AddressFields
              value={form.shipping}
              states={states}
              countries={countries}
              onChange={(shipping) => setForm((prev) => ({ ...prev, shipping }))}
            />
          </>
        )}
      </section>

      <Field label="Notes">
        <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>

      {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
