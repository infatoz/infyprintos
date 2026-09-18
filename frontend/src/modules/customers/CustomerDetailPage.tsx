import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, Input, PageHeader, SearchableSelect, Skeleton, Tabs, Td, Textarea } from "@/components/ui";
import { fmtDate, inr } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";
import { SortTh, TablePager, TableSearch, useClientTable } from "@/components/data-table";
import { CustomerForm, customerToForm, type CustomerFormExtras } from "./CustomerForm";
import { pickWhatsapp, WhatsAppShareModal, type WhatsappShare } from "@/components/WhatsAppShare";

const KYC_TYPES = ["gstin", "pan", "aadhaar", "trade_license", "visiting_card", "other"];
type Tab = "profile" | "contacts" | "activity" | "kyc" | "orders" | "quotes" | "finance" | "statement" | "card";

export function CustomerDetailPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>("profile");
  const [editing, setEditing] = useState(false);
  const [kycType, setKycType] = useState("gstin");
  const [kycNumber, setKycNumber] = useState("");
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [holdOpen, setHoldOpen] = useState(false);
  const [mergeId, setMergeId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [activityType, setActivityType] = useState("note");
  const [activityBody, setActivityBody] = useState("");
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);

  const detail = useQuery({ queryKey: ["customer", id], queryFn: async () => (await api.get(`/customers/${id}`)).data.data });
  const history = useQuery({
    queryKey: ["customer-history", id],
    queryFn: async () => (await api.get(`/customers/${id}/history`)).data.data,
    enabled: tab === "orders" || tab === "quotes" || tab === "finance" || tab === "profile"
  });
  const statement = useQuery({
    queryKey: ["customer-statement", id],
    queryFn: async () => (await api.get(`/customers/${id}/statement`)).data.data,
    enabled: tab === "statement" || tab === "profile"
  });
  const tiers = useQuery({ queryKey: ["tiers"], queryFn: async () => (await api.get("/customers/tiers")).data.data });
  const terms = useQuery({ queryKey: ["terms"], queryFn: async () => (await api.get("/customers/credit-terms")).data.data });
  const assignees = useQuery({ queryKey: ["customer-assignees"], queryFn: async () => (await api.get("/customers/assignees")).data.data });
  const states = useQuery({ queryKey: ["gst-states"], queryFn: async () => (await api.get("/customers/gst-states")).data.data });
  const sources = useQuery({ queryKey: ["customer-sources"], queryFn: async () => (await api.get("/customers/sources")).data.data as string[] });
  const countries = useQuery({ queryKey: ["countries"], queryFn: async () => (await api.get("/customers/countries")).data.data as string[] });
  const categories = useQuery({ queryKey: ["customer-categories"], queryFn: async () => (await api.get("/customers/categories")).data.data as string[] });
  const sizes = useQuery({ queryKey: ["customer-sizes"], queryFn: async () => (await api.get("/customers/sizes")).data.data as string[] });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["customer", id] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["customer-metrics"] });
    qc.invalidateQueries({ queryKey: ["customer-statement", id] });
    qc.invalidateQueries({ queryKey: ["customer-history", id] });
  };

  const hold = useMutation({
    mutationFn: async (on: boolean) => api.post(`/customers/${id}/credit-hold`, { hold: on, reason: holdReason.trim() }),
    onSuccess: () => {
      toast.success("Credit hold updated");
      setHoldOpen(false);
      setHoldReason("");
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Hold failed")
  });
  const save = useMutation({
    mutationFn: async ({ payload, extras }: { payload: Record<string, unknown>; extras?: CustomerFormExtras }) => {
      await api.patch(`/customers/${id}`, payload);
      if (extras?.removePhoto) await api.delete(`/customers/${id}/photo`);
      if (extras?.photo) {
        const fd = new FormData();
        fd.append("file", extras.photo);
        await api.post(`/customers/${id}/photo`, fd);
      }
    },
    onSuccess: () => {
      toast.success("Customer updated");
      setEditing(false);
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Update failed")
  });
  const remove = useMutation({
    mutationFn: async () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      toast.success("Customer archived");
      navigate("/customers");
    }
  });
  const uploadKyc = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("type", kycType);
      if (kycNumber) fd.append("number", kycNumber);
      if (kycFile) fd.append("file", kycFile);
      return api.post(`/customers/${id}/documents`, fd);
    },
    onSuccess: () => {
      toast.success("KYC document saved");
      setKycNumber("");
      setKycFile(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Upload failed")
  });
  const verify = useMutation({
    mutationFn: async ({ docId, status }: { docId: string; status: "verified" | "rejected" }) =>
      api.post(`/customers/${id}/documents/${docId}/verify`, { status }),
    onSuccess: () => invalidate()
  });
  const reissue = useMutation({
    mutationFn: async () => api.post(`/customers/${id}/membership/reissue`),
    onSuccess: () => {
      toast.success("Membership QR reissued. Old public links no longer work.");
      invalidate();
    }
  });
  const recalc = useMutation({
    mutationFn: async () => api.post(`/customers/${id}/recalc-balances`),
    onSuccess: () => {
      toast.success("Balances recalculated from orders and invoices");
      invalidate();
    }
  });
  const merge = useMutation({
    mutationFn: async () => api.post(`/customers/${id}/merge`, { sourceId: mergeId.trim(), reason: mergeReason.trim() }),
    onSuccess: () => {
      toast.success("Customers merged");
      setMergeId("");
      setMergeReason("");
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Merge failed")
  });
  const addContact = useMutation({
    mutationFn: async () =>
      api.post(`/customers/${id}/contacts`, {
        name: contactName,
        phone: contactPhone || undefined,
        email: contactEmail || undefined,
        title: contactTitle || undefined,
        isPrimary: !(detail.data?.contacts ?? []).length
      }),
    onSuccess: () => {
      toast.success("Contact saved");
      setContactName("");
      setContactPhone("");
      setContactEmail("");
      setContactTitle("");
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Contact failed")
  });
  const dropContact = useMutation({
    mutationFn: async (contactId: string) => api.delete(`/customers/${id}/contacts/${contactId}`),
    onSuccess: () => invalidate()
  });
  const addActivity = useMutation({
    mutationFn: async () => api.post(`/customers/${id}/activities`, { type: activityType, body: activityBody }),
    onSuccess: () => {
      toast.success("Activity logged");
      setActivityBody("");
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not log activity")
  });

  if (detail.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (detail.isError) {
    return <ErrorState title="Customer could not be loaded" onRetry={() => void detail.refetch()} />;
  }

  const { customer, card, addresses = [], documents = [], contacts = [], activities = [], kycExpired } = detail.data;
  const aging = statement.data?.aging ?? { current: 0, days31_60: 0, days61_90: 0, days90plus: 0 };
  const tabs: Array<{ id: Tab; label: string; hint?: string }> = [
    { id: "profile", label: "Profile" },
    { id: "contacts", label: "Contacts" },
    { id: "activity", label: "Activity" },
    { id: "kyc", label: "KYC", hint: kycExpired ? "expired" : undefined },
    { id: "orders", label: "Orders" },
    { id: "quotes", label: "Quotations" },
    { id: "finance", label: "Invoices" },
    { id: "statement", label: "Statement" },
    { id: "card", label: "Card" }
  ];

  return (
    <div>
      <div className="mb-2 flex items-start gap-4">
        <Avatar name={customer.name} src={customer.photoUrl} size={56} />
        <div className="min-w-0 flex-1">
      <PageHeader
        title={customer.name}
        subtitle={`${customer.code} · ${customer.phone}${customer.gstState ? ` · ${customer.gstState}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const { data } = await api.post(`/customers/${id}/whatsapp`);
                  const share = pickWhatsapp(data.data);
                  if (share) setWaShare(share);
                  else toast.error("No WhatsApp number on this customer");
                } catch (e: unknown) {
                  toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not prepare WhatsApp");
                }
              }}
            >
              WhatsApp
            </Button>
            {can(user, "customers.update") && (
              <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
                {editing ? "Close editor" : "Edit"}
              </Button>
            )}
            {can(user, "customers.credit") && (
              <Button
                variant={customer.creditHold ? "secondary" : "danger"}
                onClick={() => {
                  setHoldReason(customer.creditHold ? "Release credit hold" : "");
                  setHoldOpen(true);
                }}
              >
                {customer.creditHold ? "Release hold" : "Credit hold"}
              </Button>
            )}
            {can(user, "customers.delete") && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm("Archive this customer?")) remove.mutate();
                }}
              >
                Archive
              </Button>
            )}
          </div>
        }
      />
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as Tab)} />

      {tab === "profile" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            {editing ? (
              <CustomerForm
                initial={customerToForm(customer, addresses)}
                mode="edit"
                canEditCredit={can(user, "customers.credit")}
                tiers={tiers.data ?? []}
                terms={terms.data ?? []}
                assignees={assignees.data ?? []}
                states={states.data ?? []}
                sources={sources.data ?? []}
                countries={countries.data ?? ["India"]}
                categories={categories.data ?? []}
                sizes={sizes.data ?? []}
                submitting={save.isPending}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={(payload, extras) => save.mutate({ payload, extras })}
              />
            ) : (
              <>
                <h3 className="font-bold">Profile</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-ink/45">WhatsApp</dt>
                    <dd>{customer.whatsapp || customer.phone}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Email</dt>
                    <dd>{customer.email || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Lifecycle</dt>
                    <dd className="capitalize">{customer.lifecycleStatus || "active"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Owner</dt>
                    <dd>{customer.assignedTo?.name || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Business</dt>
                    <dd>{customer.business?.name || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">GST registration</dt>
                    <dd className="capitalize">{customer.taxRegistration || "unregistered"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">GSTIN</dt>
                    <dd>
                      {customer.business?.gstin || "—"}
                      {customer.business?.gstin && customer.business?.gstinChecksumValid === false && (
                        <span className="ml-2 text-xs text-amber-700">checksum warning</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Place of supply</dt>
                    <dd>{customer.gstState || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">PAN</dt>
                    <dd>{customer.business?.pan || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Tier</dt>
                    <dd>{customer.tierId?.name || "Basic"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Credit terms</dt>
                    <dd>{customer.creditTermId?.name || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Credit limit</dt>
                    <dd className="font-mono">{inr(customer.creditLimit)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Outstanding</dt>
                    <dd className="font-mono">{inr(statement.data?.outstanding ?? customer.outstanding)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink/45">Overdue</dt>
                    <dd className="font-mono">{inr(history.data?.overdue ?? customer.overdue ?? 0)}</dd>
                  </div>
                </dl>
                {customer.notes && <p className="mt-4 text-sm text-ink/70">{customer.notes}</p>}
                <h4 className="mt-6 font-bold">Addresses</h4>
                {(addresses as Array<{ _id: string; type?: string; line1?: string; city?: string; state?: string; pincode?: string }>).length === 0 && (
                  <Empty title="No addresses" hint="Edit the profile to add registered, billing and shipping addresses." />
                )}
                <ul className="mt-2 space-y-2 text-sm">
                  {(addresses as Array<{ _id: string; type?: string; isDefault?: boolean; line1?: string; city?: string; state?: string; pincode?: string }>).map((a) => (
                    <li key={a._id} className="rounded-xl bg-paper px-3 py-2">
                      <span className="text-xs font-semibold uppercase text-ink/45">
                        {a.type}
                        {a.isDefault ? " · default" : ""}
                      </span>
                      <div>{[a.line1, a.city, a.state, a.pincode].filter(Boolean).join(", ") || "—"}</div>
                    </li>
                  ))}
                </ul>
                {can(user, "customers.delete") && (
                  <div className="mt-8 border-t border-ink/10 pt-4">
                    <h4 className="font-bold">Merge duplicate</h4>
                    <p className="mt-1 text-xs text-ink/50">Move the source customer's orders, invoices and contacts into this record, then archive the source.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Source customer ID">
                        <Input value={mergeId} onChange={(e) => setMergeId(e.target.value)} placeholder="Mongo id of duplicate" />
                      </Field>
                      <Field label="Reason">
                        <Input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} />
                      </Field>
                    </div>
                    <Button className="mt-3" variant="danger" disabled={merge.isPending || !mergeId || mergeReason.trim().length < 3} onClick={() => merge.mutate()}>
                      Merge into this customer
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="font-bold">Membership</h3>
            {card ? (
              <div className="mt-4 rounded-md bg-ink p-4 text-paper">
                <div className="text-[11px] text-paper/55">Membership</div>
                <div className="mt-2 text-base font-semibold">{customer.name}</div>
                <div className="mt-1 font-mono text-[12px] text-paper/70">{card.membershipId}</div>
                <div className="mt-5 flex items-end justify-between text-[12px]">
                  <span>{card.tierName}</span>
                  <span className="capitalize">{card.status}</span>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink/50">No card</p>
            )}
            {customer.creditHold && (
              <p className="mt-3 text-sm font-semibold text-rose-600">Credit hold is active{customer.creditHoldReason ? `: ${customer.creditHoldReason}` : ""}. New credit orders are blocked.</p>
            )}
            {kycExpired && <p className="mt-3 text-sm font-semibold text-amber-700">One or more KYC documents have expired.</p>}
            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-xl bg-paper p-2">
                <div className="text-ink/45">0–30</div>
                <div className="font-mono font-semibold">{inr(aging.current)}</div>
              </div>
              <div className="rounded-xl bg-paper p-2">
                <div className="text-ink/45">31–60</div>
                <div className="font-mono font-semibold">{inr(aging.days31_60)}</div>
              </div>
              <div className="rounded-xl bg-paper p-2">
                <div className="text-ink/45">61–90</div>
                <div className="font-mono font-semibold">{inr(aging.days61_90)}</div>
              </div>
              <div className="rounded-xl bg-paper p-2">
                <div className="text-ink/45">90+</div>
                <div className="font-mono font-semibold">{inr(aging.days90plus)}</div>
              </div>
            </div>
            {can(user, "customers.update") && (
              <Button className="mt-4 w-full" variant="secondary" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
                Recalculate balances
              </Button>
            )}
          </Card>
        </div>
      )}

      {tab === "contacts" && (
        <Card className="p-5">
          <h3 className="font-bold">Contacts</h3>
          {can(user, "customers.update") && (
            <div className="mt-4 grid gap-3 sm:grid-cols-5">
              <Field label="Name">
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </Field>
              <Field label="Title">
                <Input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button className="w-full" disabled={addContact.isPending || contactName.trim().length < 2} onClick={() => addContact.mutate()}>
                  Add
                </Button>
              </div>
            </div>
          )}
          <ul className="mt-4 space-y-2">
            {(contacts as Array<{ _id: string; name: string; title?: string; phone?: string; email?: string; isPrimary?: boolean }>).map((c) => (
              <li key={c._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold">
                    {c.name}
                    {c.isPrimary ? <span className="ml-2 text-xs uppercase text-ink/40">Primary</span> : null}
                  </div>
                  <div className="text-xs text-ink/45">{[c.title, c.phone, c.email].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                {can(user, "customers.update") && (
                  <Button size="sm" variant="ghost" onClick={() => dropContact.mutate(c._id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!contacts.length && <Empty title="No contacts" hint="Add a buying contact, accounts person or site supervisor." />}
        </Card>
      )}

      {tab === "activity" && (
        <Card className="p-5">
          <h3 className="font-bold">Activity</h3>
          {can(user, "customers.update") && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr_auto]">
              <SearchableSelect
                value={activityType}
                onChange={setActivityType}
                options={[
                  { value: "note", label: "Note" },
                  { value: "call", label: "Call" },
                  { value: "visit", label: "Visit" },
                  { value: "email", label: "Email" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "task", label: "Task" }
                ]}
              />
              <Textarea rows={2} value={activityBody} onChange={(e) => setActivityBody(e.target.value)} placeholder="What happened?" />
              <Button disabled={addActivity.isPending || !activityBody.trim()} onClick={() => addActivity.mutate()}>
                Log
              </Button>
            </div>
          )}
          <ul className="mt-4 space-y-2">
            {(activities as Array<{ _id: string; type: string; body?: string; createdAt: string; createdBy?: { name?: string } }>).map((a) => (
              <li key={a._id} className="rounded-xl bg-paper px-3 py-2 text-sm">
                <div className="flex justify-between gap-2 text-xs uppercase text-ink/45">
                  <span>{a.type.replace("_", " ")}</span>
                  <span>
                    {a.createdBy?.name || "System"} · {fmtDate(a.createdAt)}
                  </span>
                </div>
                <p className="mt-1">{a.body}</p>
              </li>
            ))}
          </ul>
          {!activities.length && <Empty title="No activity yet" />}
        </Card>
      )}

      {tab === "kyc" && (
        <Card className="p-5">
          <h3 className="font-bold">KYC documents</h3>
          {can(user, "customers.kyc") && (
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Field label="Type">
                <SearchableSelect
                  value={kycType}
                  onChange={setKycType}
                  options={KYC_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))}
                />
              </Field>
              <Field label="Document no.">
                <Input value={kycNumber} onChange={(e) => setKycNumber(e.target.value)} />
              </Field>
              <Field label="File">
                <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setKycFile(e.target.files?.[0] ?? null)} />
              </Field>
              <div className="flex items-end">
                <Button className="w-full" onClick={() => uploadKyc.mutate()} disabled={uploadKyc.isPending}>
                  Upload
                </Button>
              </div>
            </div>
          )}
          <ul className="mt-4 space-y-2">
            {(documents as Array<{ _id: string; type: string; number?: string; status: string; expiresAt?: string; fileId?: { originalName?: string } }>).map((doc) => (
              <li key={doc._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold capitalize">{doc.type.replace("_", " ")}</div>
                  <div className="text-xs text-ink/45">
                    {doc.number || "No number"} · {doc.fileId?.originalName || "Metadata only"}
                    {doc.expiresAt ? ` · exp ${fmtDate(doc.expiresAt)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={doc.status === "verified" ? "#15803D" : doc.status === "rejected" || doc.status === "expired" ? "#E11D48" : "#A16207"}>{doc.status}</Badge>
                  {doc.fileId && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const res = await api.get(`/customers/${id}/documents/${doc._id}/file`, { responseType: "blob" });
                        const url = URL.createObjectURL(res.data);
                        window.open(url, "_blank");
                      }}
                    >
                      View
                    </Button>
                  )}
                  {can(user, "customers.kyc") && doc.status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => verify.mutate({ docId: doc._id, status: "verified" })}>
                        Verify
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => verify.mutate({ docId: doc._id, status: "rejected" })}>
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!documents.length && <Empty title="No KYC files" hint="Upload GST, PAN or trade documents for verification." />}
        </Card>
      )}

      {tab === "orders" && (
        <HistoryTable
          empty="No orders yet"
          rows={(history.data?.orders ?? []).map((o: { _id: string; number: string; status: string; totals?: { grandTotal?: number }; createdAt: string }) => ({
            id: o._id,
            href: `/orders/${o._id}`,
            title: o.number,
            meta: o.status,
            value: inr(o.totals?.grandTotal),
            when: fmtDate(o.createdAt)
          }))}
        />
      )}
      {tab === "quotes" && (
        <HistoryTable
          empty="No quotations yet"
          rows={(history.data?.quotations ?? []).map((o: { _id: string; number: string; status: string; totals?: { grandTotal?: number }; createdAt: string }) => ({
            id: o._id,
            href: `/quotations/${o._id}`,
            title: o.number,
            meta: o.status,
            value: inr(o.totals?.grandTotal),
            when: fmtDate(o.createdAt)
          }))}
        />
      )}
      {tab === "finance" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <HistoryTable
            empty="No invoices"
            title="Invoices"
            rows={(history.data?.invoices ?? []).map((o: { _id: string; number: string; status: string; totals?: { grandTotal?: number; balanceDue?: number }; createdAt: string }) => ({
              id: o._id,
              title: o.number,
              meta: `${o.status} · due ${inr(o.totals?.balanceDue)}`,
              value: inr(o.totals?.grandTotal),
              when: fmtDate(o.createdAt)
            }))}
          />
          <HistoryTable
            empty="No payments"
            title="Payments"
            rows={(history.data?.payments ?? []).map((o: { _id: string; number: string; method: string; amount: number; paidAt: string }) => ({
              id: o._id,
              title: o.number,
              meta: o.method,
              value: inr(o.amount),
              when: fmtDate(o.paidAt)
            }))}
          />
        </div>
      )}

      {tab === "statement" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5">
            <h3 className="font-bold">Receivables</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Outstanding</dt>
                <dd className="font-mono">{inr(statement.data?.outstanding ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Overdue</dt>
                <dd className="font-mono">{inr(statement.data?.overdue ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Available credit</dt>
                <dd className="font-mono">{inr(statement.data?.availableCredit ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Lifetime collected</dt>
                <dd className="font-mono">{inr(statement.data?.lifetimeCollected ?? 0)}</dd>
              </div>
            </dl>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="font-bold">Aging</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["0–30 days", aging.current],
                ["31–60", aging.days31_60],
                ["61–90", aging.days61_90],
                ["90+", aging.days90plus]
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-paper p-3">
                  <div className="text-xs text-ink/45">{label}</div>
                  <div className="mt-1 font-mono font-semibold">{inr(Number(value))}</div>
                </div>
              ))}
            </div>
            <HistoryTable
              title="Open invoices"
              empty="No open invoices"
              rows={(statement.data?.openInvoices ?? []).map((inv: { id: string; number: string; status: string; balanceDue: number; bucket: string }) => ({
                id: inv.id,
                title: inv.number,
                meta: `${inv.status} · ${inv.bucket.replace("_", " ")}`,
                value: inr(inv.balanceDue),
                when: inv.bucket.replace("_", " ")
              }))}
            />
          </Card>
        </div>
      )}

      {tab === "card" && (
        <Card className="p-5">
          <h3 className="font-bold">QR verification</h3>
          {card?.qrDataUrl ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
              <img src={card.qrDataUrl} alt="Membership QR" className="h-40 w-40 rounded-2xl bg-white p-2" />
              <div className="text-sm">
                <p className="font-mono">{card.membershipId}</p>
                <p className="mt-2 break-all text-ink/55">{card.verifyUrl}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(card.verifyUrl);
                      toast.success("Verification link copied");
                    }}
                  >
                    Copy link
                  </Button>
                  <a href={card.verifyUrl} target="_blank" rel="noreferrer">
                    <Button variant="ghost">Open public card</Button>
                  </a>
                  {can(user, "customers.update") && (
                    <Button
                      variant="danger"
                      disabled={reissue.isPending}
                      onClick={() => {
                        if (window.confirm("Reissue the QR? The current public link will stop working.")) reissue.mutate();
                      }}
                    >
                      Reissue QR
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Empty title="No membership QR" />
          )}
        </Card>
      )}

      {holdOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" onClick={() => setHoldOpen(false)}>
          <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">{customer.creditHold ? "Release credit hold" : "Place credit hold"}</h3>
            <Field label="Reason" hint="Stored on the credit event log">
              <Textarea rows={3} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setHoldOpen(false)}>
                Cancel
              </Button>
              <Button disabled={holdReason.trim().length < 3 || hold.isPending} onClick={() => hold.mutate(!customer.creditHold)}>
                Confirm
              </Button>
            </div>
          </Card>
        </div>
      )}
      {waShare && <WhatsAppShareModal share={waShare} title="Share with customer on WhatsApp" onClose={() => setWaShare(null)} />}
    </div>
  );
}

function HistoryTable({
  rows,
  empty,
  title
}: {
  title?: string;
  empty: string;
  rows: Array<{ id: string; href?: string; title: string; meta: string; value: string; when: string }>;
}) {
  const table = useClientTable(rows, (r) => `${r.title} ${r.meta} ${r.value} ${r.when}`);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        {title ? <h3 className="font-bold">{title}</h3> : <span />}
        <TableSearch value={table.search} onChange={table.setSearch} placeholder="Search" className="max-w-xs" />
      </div>
      {table.empty && <Empty title={empty} />}
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="title" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Number
            </SortTh>
            <SortTh id="meta" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Status
            </SortTh>
            <SortTh id="when" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              When
            </SortTh>
            <SortTh id="value" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort} className="text-right">
              Amount
            </SortTh>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id} className="hover:bg-paper/80">
              <Td>
                {row.href ? (
                  <Link to={row.href} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                ) : (
                  <span className="font-medium">{row.title}</span>
                )}
              </Td>
              <Td className="capitalize">{row.meta}</Td>
              <Td>{row.when}</Td>
              <Td mono className="text-right">
                {row.value}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
    </Card>
  );
}
