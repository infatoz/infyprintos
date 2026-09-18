import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Bell,
  Building2,
  CreditCard,
  GitBranch,
  Hash,
  Printer,
  ScrollText,
  Users
} from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Empty, Field, Input, PageHeader, Section, Select, StatusBadge, Td, Textarea, Th } from "@/components/ui";
import { SortTh, TablePager, TableSearch, useServerTable } from "@/components/data-table";
import { cn, fmtDate } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";
import { AccessPanel } from "./AccessPanel";
import { CrmSettingsPanel } from "./CrmSettingsPanel";
import { BranchesPanel, CouponsPanel, PaymentMethodsPanel, PrintersPanel, StatusesPanel, TaxRatesPanel, TemplatesPanel } from "./SettingsMasters";
import { pickWhatsapp, WhatsAppShareModal, type WhatsappShare } from "@/components/WhatsAppShare";

type TabId = "organisation" | "numbering" | "payments" | "devices" | "workflow" | "people" | "notifications" | "audit";

const NAV: Array<{ id: TabId; label: string; hint: string; icon: typeof Building2; need: "manage" | "people" | "audit" }> = [
  { id: "organisation", label: "Organisation", hint: "Legal identity", icon: Building2, need: "manage" },
  { id: "numbering", label: "Numbering", hint: "Document prefixes", icon: Hash, need: "manage" },
  { id: "payments", label: "Payments", hint: "Tender methods", icon: CreditCard, need: "manage" },
  { id: "devices", label: "Devices", hint: "Printers & branches", icon: Printer, need: "manage" },
  { id: "workflow", label: "Workflow", hint: "Statuses, tiers, terms", icon: GitBranch, need: "manage" },
  { id: "people", label: "People", hint: "Staff & roles", icon: Users, need: "people" },
  { id: "notifications", label: "Notifications", hint: "WhatsApp templates", icon: Bell, need: "manage" },
  { id: "audit", label: "Audit log", hint: "Who changed what", icon: ScrollText, need: "audit" }
];

export function SettingsPage() {
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = (params.get("tab") as TabId) || "organisation";
  const auditTable = useServerTable({ limit: 20, sort: "-createdAt" });
  const owner = can(user, "settings.owner");
  const manage = can(user, "settings.manage") || owner;
  const biz = useQuery({ queryKey: ["biz"], queryFn: async () => (await api.get("/settings/business")).data.data, enabled: manage });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users", { params: { limit: 100 } })).data.data,
    enabled: can(user, "users.view")
  });
  const templates = useQuery({ queryKey: ["tpl"], queryFn: async () => (await api.get("/notifications/templates")).data.data, enabled: manage });
  const audit = useQuery({
    queryKey: ["audit", auditTable.params],
    queryFn: async () => (await api.get("/settings/audit", { params: auditTable.params })).data as { data: Array<{ _id: string; createdAt: string; action: string; entityType?: string; actorId?: { name?: string } }>; meta?: { page: number; pages: number; total: number } },
    enabled: requested === "audit" && can(user, "audit.view")
  });

  const org = biz.data?.org ?? {};
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    phone: "",
    email: "",
    gstin: "",
    pan: "",
    whatsapp: "",
    website: "",
    logoUrl: "",
    currency: "INR",
    timezone: "Asia/Kolkata",
    financialYearStartMonth: 4,
    invoicePrefix: "",
    quotationPrefix: "",
    orderPrefix: "",
    receiptPrefix: "",
    customerPrefix: "",
    expensePrefix: "",
    jobPrefix: "",
    defaultTaxRate: 18,
    taxInclusive: false,
    defaultPaymentMethod: "cash",
    invoiceFooter: "",
    invoiceNotes: "",
    addressLine1: "",
    addressCity: "",
    addressState: "",
    addressPincode: "",
    addressCountry: "India",
    hoursStart: "09:00",
    hoursEnd: "19:00"
  });

  useEffect(() => {
    if (!biz.data?.org) return;
    const o = biz.data.org;
    setForm({
      name: o.name ?? "",
      legalName: o.legalName ?? "",
      phone: o.phone ?? "",
      email: o.email ?? "",
      gstin: o.gstin ?? "",
      pan: o.pan ?? "",
      whatsapp: o.whatsapp ?? "",
      website: o.website ?? "",
      logoUrl: o.logoUrl ?? "",
      currency: o.currency ?? "INR",
      timezone: o.timezone ?? "Asia/Kolkata",
      financialYearStartMonth: o.financialYearStartMonth ?? 4,
      invoicePrefix: o.invoicePrefix ?? "INV",
      quotationPrefix: o.quotationPrefix ?? "QT",
      orderPrefix: o.orderPrefix ?? "ORD",
      receiptPrefix: o.receiptPrefix ?? "RCT",
      customerPrefix: o.customerPrefix ?? "CUS",
      expensePrefix: o.expensePrefix ?? "EXP",
      jobPrefix: o.jobPrefix ?? "JOB",
      defaultTaxRate: o.defaultTaxRate ?? 18,
      taxInclusive: Boolean(o.taxInclusive),
      defaultPaymentMethod: o.defaultPaymentMethod ?? "cash",
      invoiceFooter: o.invoiceFooter ?? "",
      invoiceNotes: o.invoiceNotes ?? "",
      addressLine1: o.address?.line1 ?? "",
      addressCity: o.address?.city ?? "",
      addressState: o.address?.state ?? "",
      addressPincode: o.address?.pincode ?? "",
      addressCountry: o.address?.country ?? "India",
      hoursStart: o.workingHours?.start ?? "09:00",
      hoursEnd: o.workingHours?.end ?? "19:00"
    });
  }, [biz.data]);

  const payload = {
    phone: form.phone,
    email: form.email,
    whatsapp: form.whatsapp,
    website: form.website,
    logoUrl: form.logoUrl,
    currency: form.currency,
    timezone: form.timezone,
    financialYearStartMonth: form.financialYearStartMonth,
    invoicePrefix: form.invoicePrefix,
    quotationPrefix: form.quotationPrefix,
    orderPrefix: form.orderPrefix,
    receiptPrefix: form.receiptPrefix,
    customerPrefix: form.customerPrefix,
    expensePrefix: form.expensePrefix,
    jobPrefix: form.jobPrefix,
    defaultTaxRate: form.defaultTaxRate,
    taxInclusive: form.taxInclusive,
    defaultPaymentMethod: form.defaultPaymentMethod,
    invoiceFooter: form.invoiceFooter,
    invoiceNotes: form.invoiceNotes,
    address: {
      line1: form.addressLine1,
      city: form.addressCity,
      state: form.addressState,
      pincode: form.addressPincode,
      country: form.addressCountry
    },
    workingHours: { start: form.hoursStart, end: form.hoursEnd }
  };

  const save = useMutation({
    mutationFn: async () =>
      owner
        ? api.patch("/settings/business", { ...payload, name: form.name, legalName: form.legalName, gstin: form.gstin, pan: form.pan })
        : api.patch("/settings/operations", payload),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["biz"] });
      void hydrate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Save failed")
  });

  function refreshMasters() {
    qc.invalidateQueries({ queryKey: ["biz"] });
    qc.invalidateQueries({ queryKey: ["tpl"] });
    qc.invalidateQueries({ queryKey: ["tiers"] });
    qc.invalidateQueries({ queryKey: ["terms"] });
    qc.invalidateQueries({ queryKey: ["pay-methods"] });
  }

  const tabs = NAV.filter((t) => {
    if (t.need === "manage") return manage;
    if (t.need === "audit") return can(user, "audit.view");
    return can(user, ["users.view", "roles.manage"], "any") || manage;
  });
  const tab = (tabs.some((t) => t.id === requested) ? requested : tabs[0]?.id ?? "people") as TabId;
  const current = tabs.find((t) => t.id === tab);

  if (manage && biz.isLoading) {
    return (
      <div>
        <PageHeader title="Administration" subtitle="Loading organisation settings…" />
        <Card className="h-64 animate-pulse bg-paper-2" />
      </div>
    );
  }
  if (manage && biz.isError) {
    return (
      <div>
        <PageHeader title="Administration" />
        <Card className="p-6 text-[13px] text-muted">Could not load organisation settings.</Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Organisation profile, numbering, payments, devices, staff and audit — the same records the API uses on the floor."
        crumbs={[{ label: "Workspace", to: "/" }, { label: "Admin" }]}
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-56">
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setParams({ tab: item.id })}
                className={cn(
                  "flex min-w-[148px] items-center gap-2.5 rounded-lg px-3 py-2 text-left transition lg:min-w-0",
                  tab === item.id ? "bg-surface font-medium text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:bg-surface/70 hover:text-ink"
                )}
              >
                <item.icon size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block text-[13px]">{item.label}</span>
                  <span className="hidden truncate text-[11px] font-normal text-muted lg:block">{item.hint}</span>
                </span>
              </button>
            ))}
          </nav>
          {manage && (
            <Card className="mt-4 hidden p-4 lg:block">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">This organisation</p>
              <p className="mt-1.5 text-[13px] font-semibold leading-snug">{org.legalName || org.name || "—"}</p>
              <p className="mt-1 font-mono text-[12px] text-muted">{org.gstin || "GSTIN not set"}</p>
              <p className="mt-3 text-[12px] text-muted">
                {biz.data?.branches?.length ?? 0} branches · {(users.data ?? []).length} staff
              </p>
            </Card>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          {current && (
            <div className="mb-5">
              <h2 className="text-[17px] font-semibold tracking-tight">{current.label}</h2>
              <p className="mt-1 text-[13px] text-muted">{current.hint}</p>
            </div>
          )}

          {tab === "organisation" && (
            <div className="grid gap-4">
              <Card className="p-5 sm:p-6">
                <Section title="Legal identity" description="Shown on invoices, quotations and GST documents. GSTIN, PAN and legal name can only be changed by the owner.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Display name">
                      <Input value={form.name} disabled={!owner} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label="Legal name">
                      <Input value={form.legalName} disabled={!owner} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
                    </Field>
                    <Field label="GSTIN">
                      <Input value={form.gstin} disabled={!owner} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
                    </Field>
                    <Field label="PAN">
                      <Input value={form.pan} disabled={!owner} onChange={(e) => setForm({ ...form, pan: e.target.value })} />
                    </Field>
                    <Field label="Phone">
                      <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </Field>
                    <Field label="Email">
                      <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </Field>
                    <Field label="WhatsApp">
                      <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
                    </Field>
                    <Field label="Website">
                      <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                    </Field>
                    <Field label="Logo URL">
                      <Input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />
                    </Field>
                  </div>
                </Section>
              </Card>
              <Card className="p-5 sm:p-6">
                <Section title="Address & hours" description="Used on PDFs and the shop clock.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Street">
                      <Input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                    </Field>
                    <Field label="City">
                      <Input value={form.addressCity} onChange={(e) => setForm({ ...form, addressCity: e.target.value })} />
                    </Field>
                    <Field label="State">
                      <Input value={form.addressState} onChange={(e) => setForm({ ...form, addressState: e.target.value })} />
                    </Field>
                    <Field label="Pincode">
                      <Input value={form.addressPincode} onChange={(e) => setForm({ ...form, addressPincode: e.target.value })} />
                    </Field>
                    <Field label="Country">
                      <Input value={form.addressCountry} onChange={(e) => setForm({ ...form, addressCountry: e.target.value })} />
                    </Field>
                    <Field label="Opens">
                      <Input type="time" value={form.hoursStart} onChange={(e) => setForm({ ...form, hoursStart: e.target.value })} />
                    </Field>
                    <Field label="Closes">
                      <Input type="time" value={form.hoursEnd} onChange={(e) => setForm({ ...form, hoursEnd: e.target.value })} />
                    </Field>
                    <Field label="Currency">
                      <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                        {["INR", "USD", "AED", "EUR"].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Timezone">
                      <Select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                        {["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "UTC"].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Financial year start">
                      <Select value={String(form.financialYearStartMonth)} onChange={(e) => setForm({ ...form, financialYearStartMonth: Number(e.target.value) })}>
                        <option value="4">April</option>
                        <option value="1">January</option>
                      </Select>
                    </Field>
                  </div>
                </Section>
              </Card>
              <Card className="p-5 sm:p-6">
                <Section title="Invoice copy" description="Printed under totals on tax invoices and quotations.">
                  <Field label="Footer">
                    <Textarea value={form.invoiceFooter} onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })} />
                  </Field>
                  <Field label="Notes">
                    <Textarea value={form.invoiceNotes} onChange={(e) => setForm({ ...form, invoiceNotes: e.target.value })} />
                  </Field>
                </Section>
              </Card>
            </div>
          )}

          {tab === "numbering" && (
            <div className="grid gap-4">
              <Card className="p-5 sm:p-6">
                <Section title="Document prefixes" description="Applied by the server when a document is created. Changing a prefix does not rewrite history.">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      [
                        ["invoicePrefix", "Invoice"],
                        ["quotationPrefix", "Quotation"],
                        ["orderPrefix", "Order"],
                        ["receiptPrefix", "Receipt"],
                        ["customerPrefix", "Customer"],
                        ["expensePrefix", "Expense"],
                        ["jobPrefix", "Production job"],
                        ["defaultTaxRate", "Default tax %"]
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} label={label}>
                        <Input
                          type={key === "defaultTaxRate" ? "number" : "text"}
                          value={String(form[key] ?? "")}
                          onChange={(e) => setForm({ ...form, [key]: key === "defaultTaxRate" ? Number(e.target.value) : e.target.value })}
                        />
                      </Field>
                    ))}
                    <Field label="Default tender">
                      <Select value={form.defaultPaymentMethod} onChange={(e) => setForm({ ...form, defaultPaymentMethod: e.target.value })}>
                        {(biz.data?.methods ?? [{ code: "cash", name: "Cash" }]).map((m: { code: string; name: string }) => (
                          <option key={m.code} value={m.code}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
                      <input type="checkbox" checked={form.taxInclusive} onChange={(e) => setForm({ ...form, taxInclusive: e.target.checked })} />
                      Prices include tax
                    </label>
                  </div>
                </Section>
              </Card>
              <TaxRatesPanel rows={biz.data?.taxRates ?? []} onChanged={refreshMasters} />
            </div>
          )}

          {tab === "payments" && <PaymentMethodsPanel rows={biz.data?.methods ?? []} onChanged={refreshMasters} />}

          {tab === "devices" && (
            <div className="grid gap-4">
              <PrintersPanel rows={biz.data?.printers ?? []} onChanged={refreshMasters} />
              <BranchesPanel rows={biz.data?.branches ?? []} onChanged={refreshMasters} />
            </div>
          )}

          {tab === "workflow" && (
            <div className="grid gap-4">
              <StatusesPanel rows={biz.data?.statuses ?? []} onChanged={refreshMasters} />
              <CrmSettingsPanel
                tiers={biz.data?.tiers ?? []}
                terms={biz.data?.terms ?? []}
                onChanged={refreshMasters}
              />
              <CouponsPanel rows={biz.data?.coupons ?? []} onChanged={refreshMasters} />
            </div>
          )}

          {tab === "people" && <AccessPanel />}

          {tab === "notifications" && (
            <NotificationsPanel templates={templates.data ?? []} onTemplatesChanged={refreshMasters} />
          )}

          {tab === "audit" && (
            <Card className="overflow-hidden">
              <div className="border-b border-line p-3">
                <TableSearch value={auditTable.search} onChange={auditTable.setSearch} placeholder="Search action or entity" />
              </div>
              <table className="app-table w-full">
                <thead>
                  <tr>
                    <SortTh id="createdAt" serverSort={auditTable.sort} onSort={auditTable.toggleSort}>
                      When
                    </SortTh>
                    <Th>Actor</Th>
                    <SortTh id="action" serverSort={auditTable.sort} onSort={auditTable.toggleSort}>
                      Action
                    </SortTh>
                    <Th>Entity</Th>
                  </tr>
                </thead>
                <tbody>
                  {(audit.data?.data ?? []).map((row) => (
                    <tr key={row._id}>
                      <Td>{fmtDate(row.createdAt)}</Td>
                      <Td>{row.actorId?.name ?? "—"}</Td>
                      <Td>{row.action}</Td>
                      <Td>{row.entityType ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!(audit.data?.data ?? []).length && <Empty title="No audit rows yet" />}
              <TablePager
                page={audit.data?.meta?.page ?? 1}
                pages={audit.data?.meta?.pages ?? 1}
                total={audit.data?.meta?.total ?? 0}
                onPage={auditTable.setPage}
                pageSize={auditTable.limit}
                onPageSize={auditTable.setLimit}
                noun="events"
              />
            </Card>
          )}

          {manage && (tab === "organisation" || tab === "numbering") && (
            <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mt-5 flex flex-col items-stretch gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
              <p className="text-[12px] text-muted">
                {owner ? "Saves legal identity and operational settings." : "Saves operational settings. GSTIN, PAN and legal name stay owner-only."} Prefix changes apply to new documents only.
              </p>
              <Button className="w-full sm:w-auto" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NotificationsPanel({
  templates,
  onTemplatesChanged
}: {
  templates: Array<{ _id: string; name: string; event: string; channel: string; enabled: boolean; body?: string }>;
  onTemplatesChanged: () => void;
}) {
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);
  const logs = useQuery({
    queryKey: ["notify-logs"],
    queryFn: async () => (await api.get("/notifications/logs")).data.data as Array<{
      _id: string;
      event: string;
      to: string;
      body: string;
      status: string;
      createdAt: string;
      whatsapp?: WhatsappShare;
    }>
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-[13px] text-ink-2">
          Templates are used for <span className="font-medium">manual WhatsApp share</span> only. The ERP never sends WhatsApp automatically. After an order, payment, design or quotation update, staff open the prepared message in WhatsApp and send it themselves.
        </p>
      </Card>
      <TemplatesPanel rows={templates} onChanged={onTemplatesChanged} />
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[14px] font-semibold">Recent shares</h3>
        </div>
        <table className="app-table w-full">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Event</Th>
              <Th>To</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(logs.data ?? []).map((row) => (
              <tr key={row._id}>
                <Td>{fmtDate(row.createdAt)}</Td>
                <Td className="capitalize">{row.event.replaceAll("_", " ")}</Td>
                <Td mono>{row.to || "—"}</Td>
                <Td>
                  <StatusBadge status={row.status} />
                </Td>
                <Td>
                  {row.whatsapp?.waMe ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setWaShare(pickWhatsapp(row) ?? row.whatsapp ?? null)}
                    >
                      WhatsApp
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!(logs.data ?? []).length && <Empty title="No shares yet" hint="Create an order or send a quotation, then share from the prompt." />}
      </Card>
      {waShare && <WhatsAppShareModal share={waShare} title="Share on WhatsApp" onClose={() => setWaShare(null)} />}
    </div>
  );
}
