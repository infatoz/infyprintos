import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Button, Card, Empty, ErrorState, FilterBar, Input, Kpi, KpiRow, Modal, PageHeader, SearchableSelect, Skeleton, StatusBadge, Td, Th, Avatar } from "@/components/ui";
import { SortTh, TablePager } from "@/components/data-table";
import { inr } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";
import { CustomerForm, emptyCustomerForm, type CustomerFormExtras } from "./CustomerForm";
import { pickWhatsapp, WhatsAppShareModal, type WhatsappShare } from "@/components/WhatsAppShare";

type CustomerRow = {
  _id: string;
  name: string;
  code: string;
  phone: string;
  email?: string;
  photoUrl?: string;
  outstanding?: number;
  overdue?: number;
  creditHold?: boolean;
  lifecycleStatus?: string;
  taxRegistration?: string;
  gstState?: string;
  business?: { gstin?: string };
  assignedTo?: { name?: string };
  tierId?: { name?: string };
};

export function CustomersPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("-createdAt");
  const [tierId, setTierId] = useState("");
  const [creditFilter, setCreditFilter] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [type, setType] = useState("");
  const [tax, setTax] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [open, setOpen] = useState(false);
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);

  const list = useQuery({
    queryKey: ["customers", search, page, sort, tierId, creditFilter, lifecycle, type, tax, assignedTo],
    queryFn: async () =>
      (
        await api.get("/customers", {
          params: {
            search: search || undefined,
            page,
            limit: 20,
            sort,
            tierId: tierId || undefined,
            creditHold: creditFilter === "true" || creditFilter === "false" ? creditFilter : undefined,
            lifecycleStatus: lifecycle || undefined,
            type: type || undefined,
            taxRegistration: tax || undefined,
            assignedTo: assignedTo || undefined,
            overdue: creditFilter === "overdue" ? "true" : undefined
          }
        })
      ).data
  });
  const metrics = useQuery({ queryKey: ["customer-metrics"], queryFn: async () => (await api.get("/customers/metrics")).data.data });
  const tiers = useQuery({ queryKey: ["tiers"], queryFn: async () => (await api.get("/customers/tiers")).data.data });
  const terms = useQuery({ queryKey: ["terms"], queryFn: async () => (await api.get("/customers/credit-terms")).data.data });
  const assignees = useQuery({ queryKey: ["customer-assignees"], queryFn: async () => (await api.get("/customers/assignees")).data.data });
  const states = useQuery({ queryKey: ["gst-states"], queryFn: async () => (await api.get("/customers/gst-states")).data.data });
  const sources = useQuery({ queryKey: ["customer-sources"], queryFn: async () => (await api.get("/customers/sources")).data.data as string[] });
  const countries = useQuery({ queryKey: ["countries"], queryFn: async () => (await api.get("/customers/countries")).data.data as string[] });
  const categories = useQuery({ queryKey: ["customer-categories"], queryFn: async () => (await api.get("/customers/categories")).data.data as string[] });
  const sizes = useQuery({ queryKey: ["customer-sizes"], queryFn: async () => (await api.get("/customers/sizes")).data.data as string[] });

  const create = useMutation({
    mutationFn: async ({ payload, extras }: { payload: Record<string, unknown>; extras?: CustomerFormExtras }) => {
      const created = await api.post("/customers", payload);
      const id = created.data.data.customer._id as string;
      if (extras?.photo) {
        const fd = new FormData();
        fd.append("file", extras.photo);
        await api.post(`/customers/${id}/photo`, fd);
      }
      return created.data;
    },
    onSuccess: (data) => {
      toast.success("Customer and membership card created");
      setOpen(false);
      const share = pickWhatsapp(data.data);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer-metrics"] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Failed")
  });

  const rows: CustomerRow[] = list.data?.data ?? [];
  const meta = list.data?.meta ?? { page: 1, pages: 1, total: 0 };
  const m = metrics.data ?? { total: 0, onHold: 0, overdue: 0, prospects: 0, blocked: 0, ar: { outstanding: 0, overdue: 0 } };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="CRM, GST, credit control, KYC and lifetime membership cards."
        actions={
          can(user, "customers.create") ? <Button onClick={() => setOpen(true)}>New customer</Button> : undefined
        }
      />

      <KpiRow className="xl:grid-cols-5">
        <Kpi label="Customers" value={m.total} />
        <Kpi label="AR outstanding" value={inr(m.ar?.outstanding ?? 0)} />
        <Kpi label="Overdue" value={inr(m.ar?.overdue ?? 0)} tone={Number(m.ar?.overdue) > 0 ? "danger" : "default"} />
        <Kpi label="Credit hold" value={m.onHold} />
        <Kpi label="Prospects / blocked" value={`${m.prospects} / ${m.blocked}`} />
      </KpiRow>

      <FilterBar className="xl:grid-cols-8">
        <Input
          className="md:col-span-2 lg:col-span-2"
          placeholder="Search name, phone, GST, PAN, code"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <SearchableSelect
          value={tierId}
          emptyLabel="All tiers"
          onChange={(v) => {
            setTierId(v);
            setPage(1);
          }}
          options={(tiers.data ?? []).map((t: { _id: string; name: string }) => ({ value: t._id, label: t.name }))}
        />
        <SearchableSelect
          value={lifecycle}
          emptyLabel="All lifecycles"
          onChange={(v) => {
            setLifecycle(v);
            setPage(1);
          }}
          options={[
            { value: "prospect", label: "Prospect" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "blocked", label: "Blocked" }
          ]}
        />
        <SearchableSelect
          value={type}
          emptyLabel="All types"
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          options={[
            { value: "individual", label: "Individual" },
            { value: "business", label: "Business" },
            { value: "wholesale", label: "Wholesale" }
          ]}
        />
        <SearchableSelect
          value={tax}
          emptyLabel="All GST types"
          onChange={(v) => {
            setTax(v);
            setPage(1);
          }}
          options={[
            { value: "unregistered", label: "Unregistered" },
            { value: "registered", label: "Registered" },
            { value: "composition", label: "Composition" },
            { value: "sez", label: "SEZ" },
            { value: "overseas", label: "Overseas" }
          ]}
        />
        <SearchableSelect
          value={assignedTo}
          emptyLabel="All owners"
          onChange={(v) => {
            setAssignedTo(v);
            setPage(1);
          }}
          options={(assignees.data ?? []).map((a: { _id: string; name: string }) => ({ value: a._id, label: a.name }))}
        />
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <SearchableSelect
            value={creditFilter}
            emptyLabel="All credit"
            onChange={(v) => {
              setCreditFilter(v);
              setPage(1);
            }}
            options={[
              { value: "false", label: "Active credit" },
              { value: "true", label: "On hold" },
              { value: "overdue", label: "Overdue AR" }
            ]}
          />
          <SearchableSelect
            value={sort}
            onChange={setSort}
            options={[
              { value: "-createdAt", label: "Newest" },
              { value: "name", label: "Name" },
              { value: "-outstanding", label: "Outstanding" },
              { value: "-overdue", label: "Overdue" },
              { value: "code", label: "Code" }
            ]}
          />
        </div>
      </FilterBar>

      {list.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {list.isError && <ErrorState title="Could not load customers" onRetry={() => void list.refetch()} />}

      {!list.isLoading && !list.isError && (
        <>
          <div className="grid gap-3 md:hidden">
            {rows.map((c) => (
              <Link key={c._id} to={`/customers/${c._id}`}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <Avatar name={c.name} src={c.photoUrl} size={36} />
                    <div>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-ink/45">
                        {c.code} · {c.phone}
                      </div>
                    </div>
                  </div>
                    {c.creditHold ? <StatusBadge status="hold" /> : <StatusBadge status={c.lifecycleStatus ?? "active"} />}
                  </div>
                  <div className="mt-3 flex justify-between text-sm">
                    <span>{c.tierId?.name ?? "—"}</span>
                    <span className="font-mono">{inr(c.outstanding ?? 0)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" serverSort={sort} onSort={(id) => { setSort(sort === id ? `-${id}` : id); setPage(1); }}>
                    Customer
                  </SortTh>
                  <Th>Phone</Th>
                  <Th>GST / state</Th>
                  <Th>Owner</Th>
                  <SortTh id="outstanding" serverSort={sort} onSort={(id) => { setSort(sort === id ? `-${id}` : id); setPage(1); }} className="text-right">
                    Outstanding
                  </SortTh>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c._id} className="hover:bg-paper/80">
                    <Td>
                      <Link to={`/customers/${c._id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                        <Avatar name={c.name} src={c.photoUrl} size={28} />
                        <span>
                          {c.name}
                          <span className="block text-[12px] font-normal text-ink/40">
                            {c.code} · {c.tierId?.name ?? "Basic"}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td>{c.phone}</Td>
                    <Td>
                      <div className="font-mono text-[12px]">{c.business?.gstin || "—"}</div>
                      <div className="text-[12px] text-ink/40">{c.gstState || c.taxRegistration || ""}</div>
                    </Td>
                    <Td>{c.assignedTo?.name ?? "—"}</Td>
                    <Td mono className="text-right">
                      {inr(Number(c.outstanding ?? 0))}
                      {Number(c.overdue ?? 0) > 0 && <div className="text-[12px] text-rose-700">{inr(c.overdue ?? 0)} overdue</div>}
                    </Td>
                    <Td>
                      {c.creditHold ? <StatusBadge status="hold" /> : <StatusBadge status={c.lifecycleStatus ?? "active"} />}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty title="No customers yet" hint="Create a customer to generate a membership card." />}
          </Card>
          {!rows.length && (
            <div className="md:hidden">
              <Empty title="No customers yet" hint="Create a customer to generate a membership card." />
            </div>
          )}

          {meta.pages >= 1 && (
            <TablePager page={meta.page} pages={meta.pages} total={meta.total} onPage={setPage} noun="customers" />
          )}
        </>
      )}

      {open && (
        <Modal title="New customer" onClose={() => setOpen(false)} wide>
          <CustomerForm
            initial={emptyCustomerForm()}
            mode="create"
            canEditCredit
            tiers={tiers.data ?? []}
            terms={terms.data ?? []}
            assignees={assignees.data ?? []}
            states={states.data ?? []}
            sources={sources.data ?? []}
            countries={countries.data ?? ["India"]}
            categories={categories.data ?? []}
            sizes={sizes.data ?? []}
            submitting={create.isPending}
            submitLabel="Save & issue card"
            onCancel={() => setOpen(false)}
            onSubmit={(payload, extras) => create.mutate({ payload, extras })}
          />
        </Modal>
      )}
      {waShare && <WhatsAppShareModal share={waShare} title="Share welcome on WhatsApp" onClose={() => setWaShare(null)} />}
    </div>
  );
}
