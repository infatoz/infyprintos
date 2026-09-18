import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  FilterBar,
  Input,
  Kpi,
  KpiRow,
  Modal,
  PageHeader,
  SearchableSelect,
  StatusBadge,
  Tabs,
  Td,
  Textarea,
  Th
} from "@/components/ui";
import { SortTh, TablePager, useServerTable } from "@/components/data-table";
import { fmtDate, inr } from "@/lib/cn";
import { can } from "@/lib/access";
import { useAuth } from "@/stores/auth";

type InvItem = {
  _id: string;
  name: string;
  sku: string;
  type: string;
  category?: string;
  categoryId?: { _id?: string; name?: string; slug?: string } | string;
  unit: string;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  reorderLevel: number;
  maxStock?: number;
  costPerUnit: number;
  valuation: number;
  warehouse?: string;
  bin?: string;
  supplierId?: { _id?: string; name?: string } | string;
  active?: boolean;
};

type TypeRow = { _id: string; name: string; slug: string; description?: string; defaultUnit?: string; system?: boolean; active?: boolean };
type CatRow = { _id: string; name: string; slug: string; type: string; description?: string; active?: boolean };
type SupplierRow = {
  _id: string;
  name: string;
  code?: string;
  phone?: string;
  gstin?: string;
  contactName?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  city?: string;
  email?: string;
  address?: string;
  active?: boolean;
};
type UnitRow = { _id?: string; code: string; name: string };
type UsageRow = {
  inventoryItemId: string;
  name?: string;
  sku?: string;
  unit?: string;
  quantity: number;
  cost: number;
  consumption: number;
  wastage: number;
  damaged: number;
};

const TABS = ["stock", "move", "ledger", "waste", "usage", "types", "categories", "suppliers", "units"] as const;
const MOVE_TYPES = [
  { value: "purchase", label: "Purchase" },
  { value: "inward", label: "Inward / GRN" },
  { value: "outward", label: "Issue / consumption" },
  { value: "wastage", label: "Wastage" },
  { value: "damaged", label: "Damaged" },
  { value: "return", label: "Return to stock" },
  { value: "adjustment", label: "Adjustment" },
  { value: "transfer", label: "Transfer" },
  { value: "reconciliation", label: "Stock count" },
  { value: "opening", label: "Opening" }
];

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

function tabLabel(id: string) {
  const labels: Record<string, string> = {
    stock: "Stock",
    move: "Movements",
    ledger: "Ledger",
    waste: "Waste",
    usage: "Usage",
    types: "Types",
    categories: "Categories",
    suppliers: "Suppliers",
    units: "Units"
  };
  return labels[id] ?? id;
}

export function InventoryPage() {
  const user = useAuth((s) => s.user);
  const canAdjust = can(user, "inventory.adjust");
  const canWrite = canAdjust || can(user, "inventory.purchase");
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("stock");
  const stockTable = useServerTable({ limit: 20, sort: "name" });
  const [type, setType] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [selected, setSelected] = useState("");
  const [itemModal, setItemModal] = useState<{ open: boolean; id?: string }>({ open: false });
  const [typeModal, setTypeModal] = useState<{ open: boolean; id?: string }>({ open: false });
  const [catModal, setCatModal] = useState<{ open: boolean; id?: string }>({ open: false });
  const [supModal, setSupModal] = useState<{ open: boolean; id?: string }>({ open: false });
  const [usagePeriod, setUsagePeriod] = useState("weekly");

  const items = useQuery({
    queryKey: ["inv", stockTable.params, type, categoryId, supplierId, lowStock],
    queryFn: async () =>
      (
        await api.get("/inventory/items", {
          params: {
            ...stockTable.params,
            type: type || undefined,
            categoryId: categoryId || undefined,
            supplierId: supplierId || undefined,
            lowStock: lowStock || undefined
          }
        })
      ).data as { data: InvItem[]; meta?: { page: number; pages: number; total: number } }
  });
  const analytics = useQuery({ queryKey: ["inv-a"], queryFn: async () => (await api.get("/inventory/analytics")).data.data });
  const alerts = useQuery({ queryKey: ["inv-alerts"], queryFn: async () => (await api.get("/inventory/alerts")).data.data });
  const units = useQuery({ queryKey: ["inv-units"], queryFn: async () => (await api.get("/inventory/units")).data.data as UnitRow[] });
  const types = useQuery({ queryKey: ["inv-types"], queryFn: async () => (await api.get("/inventory/types")).data.data as TypeRow[] });
  const categories = useQuery({ queryKey: ["inv-cats"], queryFn: async () => (await api.get("/inventory/categories")).data.data as CatRow[] });
  const suppliers = useQuery({ queryKey: ["inv-sup"], queryFn: async () => (await api.get("/inventory/suppliers")).data.data as SupplierRow[] });
  const usage = useQuery({
    queryKey: ["inv-usage", usagePeriod],
    enabled: tab === "usage",
    queryFn: async () => (await api.get("/inventory/usage", { params: { period: usagePeriod } })).data.data
  });
  const ledger = useQuery({
    queryKey: ["inv-led", selected],
    enabled: Boolean(selected),
    queryFn: async () => (await api.get(`/inventory/ledger/${selected}`, { params: { limit: 50 } })).data.data
  });
  const wasteRows = useQuery({
    queryKey: ["inv-waste"],
    enabled: tab === "waste",
    queryFn: async () => (await api.get("/inventory/transactions", { params: { type: "wastage", limit: 50 } })).data.data
  });
  const damagedRows = useQuery({
    queryKey: ["inv-damaged"],
    enabled: tab === "waste",
    queryFn: async () => (await api.get("/inventory/transactions", { params: { type: "damaged", limit: 50 } })).data.data
  });

  const [move, setMove] = useState({
    inventoryItemId: "",
    type: "inward",
    quantity: 0,
    unitCost: 0,
    reason: "",
    toInventoryItemId: "",
    targetQty: 0
  });
  const [waste, setWaste] = useState({ inventoryItemId: "", quantity: 0, reason: "", kind: "wastage" as "wastage" | "damaged" });
  const [issue, setIssue] = useState({ inventoryItemId: "", quantity: 0, reason: "" });
  const [unitForm, setUnitForm] = useState({ code: "", name: "", allowDecimal: true });

  function refreshStock() {
    qc.invalidateQueries({ queryKey: ["inv"] });
    qc.invalidateQueries({ queryKey: ["inv-a"] });
    qc.invalidateQueries({ queryKey: ["inv-alerts"] });
    qc.invalidateQueries({ queryKey: ["inv-led"] });
    qc.invalidateQueries({ queryKey: ["inv-usage"] });
    qc.invalidateQueries({ queryKey: ["inv-waste"] });
    qc.invalidateQueries({ queryKey: ["inv-damaged"] });
  }

  const postMove = useMutation({
    mutationFn: async () =>
      api.post(
        "/inventory/move",
        {
          ...move,
          quantity: Number(move.quantity),
          unitCost: move.unitCost || undefined,
          toInventoryItemId: move.toInventoryItemId || undefined,
          targetQty: move.type === "reconciliation" ? Number(move.targetQty) : undefined
        },
        { headers: { "Idempotency-Key": crypto.randomUUID?.() ?? String(Date.now()) } }
      ),
    onSuccess: () => {
      toast.success("Ledger updated");
      refreshStock();
    },
    onError: (e) => toast.error(errMsg(e, "Failed"))
  });
  const postWaste = useMutation({
    mutationFn: async () =>
      api.post("/inventory/waste", waste, { headers: { "Idempotency-Key": crypto.randomUUID?.() ?? String(Date.now()) } }),
    onSuccess: () => {
      toast.success("Waste posted");
      setWaste({ ...waste, quantity: 0, reason: "" });
      refreshStock();
    },
    onError: (e) => toast.error(errMsg(e, "Could not post waste"))
  });
  const postIssue = useMutation({
    mutationFn: async () =>
      api.post("/inventory/consumption", issue, { headers: { "Idempotency-Key": crypto.randomUUID?.() ?? String(Date.now()) } }),
    onSuccess: () => {
      toast.success("Consumption posted");
      setIssue({ ...issue, quantity: 0, reason: "" });
      refreshStock();
    },
    onError: (e) => toast.error(errMsg(e, "Could not post consumption"))
  });
  const addUnit = useMutation({
    mutationFn: async () => api.post("/inventory/units", { ...unitForm, code: unitForm.code.toUpperCase() }),
    onSuccess: () => {
      toast.success("Unit added");
      setUnitForm({ code: "", name: "", allowDecimal: true });
      qc.invalidateQueries({ queryKey: ["inv-units"] });
    },
    onError: (e) => toast.error(errMsg(e, "Could not add unit"))
  });

  const typeLabel = useMemo(() => Object.fromEntries((types.data ?? []).map((t) => [t.slug, t.name])), [types.data]);
  const itemOptions = useMemo(
    () => (items.data?.data ?? []).map((i) => ({ value: i._id, label: i.name, hint: `${i.sku} · ${i.availableQty} ${i.unit}` })),
    [items.data]
  );
  const selectedItem = (items.data?.data ?? []).find((i) => i._id === selected);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock, purchases, waste and consumption for print media. Sales catalog stays separate; production still issues reserved material from this ledger."
      />
      <KpiRow className="lg:grid-cols-4 xl:grid-cols-6">
        <Kpi label="SKUs" value={analytics.data?.skuCount ?? 0} />
        <Kpi label="Valuation" value={inr(analytics.data?.valuation)} />
        <button type="button" className="text-left hover:bg-paper/80" onClick={() => { setLowStock(true); setTab("stock"); }}>
          <Kpi label="Low stock" value={analytics.data?.lowStock ?? 0} tone={analytics.data?.lowStock ? "warn" : "default"} />
        </button>
        <Kpi label="Reserved" value={analytics.data?.reserved ?? 0} />
        <Kpi label="Weekly issue" value={analytics.data?.weeklyConsumption ?? 0} />
        <Kpi label="Weekly waste" value={analytics.data?.weeklyWaste ?? 0} tone={analytics.data?.weeklyWaste ? "warn" : "default"} />
      </KpiRow>
      {(alerts.data?.lowStock ?? []).length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          Reorder: {(alerts.data.lowStock as InvItem[]).map((i) => `${i.name} (${i.stockQty} ${i.unit})`).join(" · ")}
        </Card>
      )}
      <Tabs tabs={TABS.map((t) => ({ id: t, label: tabLabel(t) }))} value={tab} onChange={(id) => setTab(id as (typeof TABS)[number])} />

      {tab === "stock" && (
        <>
          <FilterBar className="xl:grid-cols-6">
            <Input placeholder="Search name or SKU" value={stockTable.search} onChange={(e) => stockTable.setSearch(e.target.value)} />
            <SearchableSelect
              value={type}
              onChange={(v) => {
                setType(v);
                setCategoryId("");
              }}
              emptyLabel="All types"
              options={(types.data ?? []).map((t) => ({ value: t.slug, label: t.name }))}
            />
            <SearchableSelect
              value={categoryId}
              onChange={setCategoryId}
              emptyLabel="All categories"
              options={(categories.data ?? [])
                .filter((c) => !type || c.type === type)
                .map((c) => ({ value: c._id, label: c.name, hint: typeLabel[c.type] }))}
            />
            <SearchableSelect
              value={supplierId}
              onChange={setSupplierId}
              emptyLabel="All suppliers"
              options={(suppliers.data ?? []).map((s) => ({ value: s._id, label: s.name }))}
            />
            <label className="flex h-9 items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
              Below reorder
            </label>
            {canAdjust && (
              <Button onClick={() => setItemModal({ open: true })}>New SKU</Button>
            )}
          </FilterBar>
          <Card className="overflow-hidden">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" serverSort={stockTable.sort} onSort={stockTable.toggleSort}>
                    Item
                  </SortTh>
                  <Th>Type</Th>
                  <Th>On hand</Th>
                  <Th>Reserved</Th>
                  <SortTh id="availableQty" serverSort={stockTable.sort} onSort={stockTable.toggleSort}>
                    Available
                  </SortTh>
                  <Th>Value</Th>
                </tr>
              </thead>
              <tbody>
                {(items.data?.data ?? []).map((i) => (
                  <tr
                    key={i._id}
                    className="cursor-pointer hover:bg-paper/80"
                    onClick={() => {
                      setSelected(i._id);
                      setTab("ledger");
                    }}
                  >
                    <Td>
                      <div className="font-medium">{i.name}</div>
                      <div className="font-mono text-[12px] text-muted">
                        {i.sku}
                        {typeof i.categoryId === "object" && i.categoryId?.name ? ` · ${i.categoryId.name}` : i.category ? ` · ${i.category}` : ""}
                      </div>
                    </Td>
                    <Td>{typeLabel[i.type] ?? i.type.replaceAll("_", " ")}</Td>
                    <Td mono>
                      {i.stockQty} {i.unit}
                    </Td>
                    <Td mono>{i.reservedQty}</Td>
                    <Td mono>{i.availableQty}</Td>
                    <Td mono>{inr(i.valuation)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.data?.data?.length && <Empty title="No inventory SKUs" hint="Create media, ink, plates or packaging here. This is not the sales catalog." />}
            <TablePager
              page={items.data?.meta?.page ?? 1}
              pages={items.data?.meta?.pages ?? 1}
              total={items.data?.meta?.total ?? 0}
              onPage={stockTable.setPage}
              pageSize={stockTable.limit}
              onPageSize={stockTable.setLimit}
              noun="SKUs"
            />
          </Card>
        </>
      )}

      {tab === "move" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="text-[15px] font-semibold">Stock movement</h3>
            <p className="mt-1 text-[13px] text-muted">Every change writes an immutable ledger row. Transfers post two rows.</p>
            <div className="mt-3 space-y-3">
              <Field label="Item" required>
                <SearchableSelect value={move.inventoryItemId} onChange={(v) => setMove({ ...move, inventoryItemId: v })} options={itemOptions} placeholder="Select SKU" />
              </Field>
              <Field label="Movement">
                <SearchableSelect value={move.type} onChange={(v) => setMove({ ...move, type: v })} options={MOVE_TYPES} />
              </Field>
              {move.type === "transfer" && (
                <Field label="Destination SKU" required>
                  <SearchableSelect
                    value={move.toInventoryItemId}
                    onChange={(v) => setMove({ ...move, toInventoryItemId: v })}
                    options={itemOptions.filter((o) => o.value !== move.inventoryItemId)}
                  />
                </Field>
              )}
              {move.type === "reconciliation" ? (
                <Field label="Counted quantity">
                  <Input type="number" value={move.targetQty} onChange={(e) => setMove({ ...move, targetQty: Number(e.target.value) })} />
                </Field>
              ) : (
                <Field label="Quantity">
                  <Input type="number" value={move.quantity} onChange={(e) => setMove({ ...move, quantity: Number(e.target.value) })} />
                </Field>
              )}
              <Field label="Unit cost">
                <Input type="number" value={move.unitCost || ""} onChange={(e) => setMove({ ...move, unitCost: Number(e.target.value) })} />
              </Field>
              <Field label="Reason" hint={["wastage", "damaged", "outward"].includes(move.type) ? "Required for issues and waste" : undefined}>
                <Input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
              </Field>
              <Button className="w-full" disabled={!canWrite || !move.inventoryItemId} onClick={() => postMove.mutate()}>
                Post to ledger
              </Button>
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="text-[15px] font-semibold">Shop issue</h3>
            <p className="mt-1 text-[13px] text-muted">Manual consumption outside a production job (samples, R&D, house jobs).</p>
            <div className="mt-3 space-y-3">
              <Field label="Item" required>
                <SearchableSelect value={issue.inventoryItemId} onChange={(v) => setIssue({ ...issue, inventoryItemId: v })} options={itemOptions} />
              </Field>
              <Field label="Quantity" required>
                <Input type="number" value={issue.quantity} onChange={(e) => setIssue({ ...issue, quantity: Number(e.target.value) })} />
              </Field>
              <Field label="Reason" required>
                <Input value={issue.reason} onChange={(e) => setIssue({ ...issue, reason: e.target.value })} />
              </Field>
              <Button className="w-full" disabled={!canWrite || issue.reason.length < 3} onClick={() => postIssue.mutate()}>
                Issue stock
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "ledger" && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-[220px] flex-1">
              <SearchableSelect value={selected} onChange={setSelected} options={itemOptions} placeholder="Select SKU" />
            </div>
            {selectedItem && canAdjust && (
              <Button variant="secondary" onClick={() => setItemModal({ open: true, id: selectedItem._id })}>
                Edit SKU
              </Button>
            )}
          </div>
          {selectedItem && (
            <div className="grid gap-2 border-t border-line px-4 py-3 text-[13px] text-muted sm:grid-cols-4">
              <div>
                On hand <span className="font-mono text-ink">{selectedItem.stockQty}</span>
              </div>
              <div>
                Reserved <span className="font-mono text-ink">{selectedItem.reservedQty}</span>
              </div>
              <div>
                Available <span className="font-mono text-ink">{selectedItem.availableQty}</span>
              </div>
              <div>
                Value <span className="font-mono text-ink">{inr(selectedItem.valuation)}</span>
              </div>
            </div>
          )}
          <table className="app-table w-full">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Qty</Th>
                <Th>Cost</Th>
                <Th>Balance</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {(ledger.data ?? []).map((row: { _id: string; createdAt: string; type: string; quantity: number; unitCost?: number; newBalance?: number; reason?: string }) => (
                <tr key={row._id}>
                  <Td>{fmtDate(row.createdAt)}</Td>
                  <Td>
                    <StatusBadge status={row.type} />
                  </Td>
                  <Td mono>{row.quantity}</Td>
                  <Td mono>{inr(row.unitCost)}</Td>
                  <Td mono>{row.newBalance}</Td>
                  <Td className="text-muted">{row.reason || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!selected && <Empty title="Select a SKU to view its ledger" />}
        </Card>
      )}

      {tab === "waste" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>SKU</Th>
                  <Th>Kind</Th>
                  <Th>Qty</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {[...(wasteRows.data ?? []), ...(damagedRows.data ?? [])]
                  .sort((a: { createdAt: string }, b: { createdAt: string }) => +new Date(b.createdAt) - +new Date(a.createdAt))
                  .map(
                    (row: {
                      _id: string;
                      createdAt: string;
                      type: string;
                      quantity: number;
                      reason?: string;
                      inventoryItemId?: { name?: string; sku?: string; unit?: string };
                    }) => (
                      <tr key={row._id}>
                        <Td>{fmtDate(row.createdAt)}</Td>
                        <Td>
                          {row.inventoryItemId?.name}
                          <div className="font-mono text-[12px] text-muted">{row.inventoryItemId?.sku}</div>
                        </Td>
                        <Td>
                          <StatusBadge status={row.type} />
                        </Td>
                        <Td mono>
                          {Math.abs(row.quantity)} {row.inventoryItemId?.unit}
                        </Td>
                        <Td className="text-muted">{row.reason || "—"}</Td>
                      </tr>
                    )
                  )}
              </tbody>
            </table>
            {!wasteRows.data?.length && !damagedRows.data?.length && <Empty title="No waste posted" hint="Record spoilage, trim and damaged media with a reason." />}
          </Card>
          {canAdjust && (
            <Card className="p-5">
              <h3 className="text-[15px] font-semibold">Record waste</h3>
              <div className="mt-3 space-y-3">
                <Field label="Item" required>
                  <SearchableSelect value={waste.inventoryItemId} onChange={(v) => setWaste({ ...waste, inventoryItemId: v })} options={itemOptions} />
                </Field>
                <Field label="Kind">
                  <SearchableSelect
                    value={waste.kind}
                    onChange={(v) => setWaste({ ...waste, kind: v as "wastage" | "damaged" })}
                    options={[
                      { value: "wastage", label: "Process waste / trim" },
                      { value: "damaged", label: "Damaged / rejected" }
                    ]}
                  />
                </Field>
                <Field label="Quantity" required>
                  <Input type="number" value={waste.quantity} onChange={(e) => setWaste({ ...waste, quantity: Number(e.target.value) })} />
                </Field>
                <Field label="Reason" required hint="Why the stock left the roll or sheet">
                  <Textarea rows={3} value={waste.reason} onChange={(e) => setWaste({ ...waste, reason: e.target.value })} />
                </Field>
                <Button className="w-full" disabled={waste.reason.length < 3} onClick={() => postWaste.mutate()}>
                  Post waste
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "usage" && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 p-3">
            <div>
              <h3 className="text-[15px] font-semibold">Consumption vs waste</h3>
              <p className="text-[13px] text-muted">Production issues, manual issues, wastage and damage.</p>
            </div>
            <div className="w-40">
              <SearchableSelect
                value={usagePeriod}
                onChange={setUsagePeriod}
                options={[
                  { value: "daily", label: "Last day" },
                  { value: "weekly", label: "Last 7 days" },
                  { value: "monthly", label: "Last 30 days" }
                ]}
              />
            </div>
          </div>
          <div className="grid gap-2 border-t border-line px-4 py-3 text-[13px] sm:grid-cols-4">
            <div>
              Issued <span className="font-mono">{usage.data?.totals?.consumption ?? 0}</span>
            </div>
            <div>
              Waste <span className="font-mono">{usage.data?.totals?.wastage ?? 0}</span>
            </div>
            <div>
              Damaged <span className="font-mono">{usage.data?.totals?.damaged ?? 0}</span>
            </div>
            <div>
              Cost <span className="font-mono">{inr(usage.data?.totals?.cost)}</span>
            </div>
          </div>
          <table className="app-table w-full">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Issued</Th>
                <Th>Waste</Th>
                <Th>Damaged</Th>
                <Th>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {(usage.data?.rows ?? []).map((r: UsageRow) => (
                <tr key={r.inventoryItemId}>
                  <Td>
                    {r.name} <span className="font-mono text-[12px] text-muted">{r.sku}</span>
                  </Td>
                  <Td mono>
                    {r.consumption} {r.unit}
                  </Td>
                  <Td mono>{r.wastage}</Td>
                  <Td mono>{r.damaged}</Td>
                  <Td mono>{inr(r.cost)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!usage.data?.rows?.length && <Empty title="No consumption in this period" />}
        </Card>
      )}

      {tab === "types" && (
        <div className="mb-3 flex justify-end">
          {canAdjust && <Button onClick={() => setTypeModal({ open: true })}>New type</Button>}
        </div>
      )}
      {tab === "types" && (
        <Card className="overflow-hidden">
          <table className="app-table w-full">
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Default unit</Th>
                <Th>Status</Th>
                {canAdjust && <Th />}
              </tr>
            </thead>
            <tbody>
              {(types.data ?? []).map((row) => (
                <tr key={row._id} className={canAdjust ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canAdjust && setTypeModal({ open: true, id: row._id })}>
                  <Td>
                    <div className="font-medium">{row.name}</div>
                    {row.description ? <div className="text-[12px] text-muted">{row.description}</div> : null}
                    {row.system ? <Badge>System</Badge> : null}
                  </Td>
                  <Td className="uppercase">{row.defaultUnit ?? "pcs"}</Td>
                  <Td>
                    <StatusBadge status={row.active === false ? "off" : "active"} />
                  </Td>
                  {canAdjust && (
                    <Td>
                      {!row.system && (
                        <button
                          type="button"
                          className="text-[12px] font-medium text-rose-600 hover:underline"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.delete(`/inventory/types/${row._id}`);
                              toast.success("Type removed");
                              qc.invalidateQueries({ queryKey: ["inv-types"] });
                            } catch (err) {
                              toast.error(errMsg(err, "Cannot delete type"));
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "categories" && (
        <>
          <div className="mb-3 flex justify-end">
            {canAdjust && <Button onClick={() => setCatModal({ open: true })}>New category</Button>}
          </div>
          <Card className="overflow-hidden">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  {canAdjust && <Th />}
                </tr>
              </thead>
              <tbody>
                {(categories.data ?? []).map((row) => (
                  <tr key={row._id} className={canAdjust ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canAdjust && setCatModal({ open: true, id: row._id })}>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      {row.description ? <div className="text-[12px] text-muted">{row.description}</div> : null}
                    </Td>
                    <Td>{typeLabel[row.type] ?? row.type.replaceAll("_", " ")}</Td>
                    <Td>
                      <StatusBadge status={row.active === false ? "off" : "active"} />
                    </Td>
                    {canAdjust && (
                      <Td>
                        <button
                          type="button"
                          className="text-[12px] font-medium text-rose-600 hover:underline"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.delete(`/inventory/categories/${row._id}`);
                              toast.success("Category removed");
                              qc.invalidateQueries({ queryKey: ["inv-cats"] });
                            } catch (err) {
                              toast.error(errMsg(err, "Cannot delete category"));
                            }
                          }}
                        >
                          Delete
                        </button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!categories.data?.length && <Empty title="No categories" />}
          </Card>
        </>
      )}

      {tab === "suppliers" && (
        <>
          <div className="mb-3 flex justify-end">
            {canWrite && <Button onClick={() => setSupModal({ open: true })}>New supplier</Button>}
          </div>
          <Card className="overflow-hidden">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Phone</Th>
                  <Th>GSTIN</Th>
                  <Th>Terms</Th>
                </tr>
              </thead>
              <tbody>
                {(suppliers.data ?? []).map((s) => (
                  <tr key={s._id} className={canWrite ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canWrite && setSupModal({ open: true, id: s._id })}>
                    <Td>
                      <div className="font-medium">{s.name}</div>
                      <div className="font-mono text-[12px] text-muted">{s.code}</div>
                    </Td>
                    <Td>{s.phone || "—"}</Td>
                    <Td mono>{s.gstin || "—"}</Td>
                    <Td>
                      {s.paymentTerms || "—"}
                      {s.leadTimeDays ? ` · ${s.leadTimeDays}d` : ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!suppliers.data?.length && <Empty title="No suppliers" hint="Vendors for media, ink and finishing supplies." />}
          </Card>
        </>
      )}

      {tab === "units" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                </tr>
              </thead>
              <tbody>
                {(units.data ?? []).map((u) => (
                  <tr key={u.code}>
                    <Td mono>{u.code}</Td>
                    <Td>{u.name}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {canAdjust && (
            <Card className="p-5">
              <h3 className="mb-3 text-[15px] font-semibold">Add unit</h3>
              <div className="space-y-2">
                <Field label="Code" required>
                  <Input value={unitForm.code} onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="Name" required>
                  <Input value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} />
                </Field>
                <Button className="w-full" disabled={unitForm.code.length < 2 || unitForm.name.length < 2} onClick={() => addUnit.mutate()}>
                  Save unit
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {itemModal.open && (
        <ItemEditor
          id={itemModal.id}
          types={types.data ?? []}
          categories={categories.data ?? []}
          units={units.data ?? []}
          suppliers={suppliers.data ?? []}
          onClose={() => setItemModal({ open: false })}
          onSaved={() => {
            setItemModal({ open: false });
            refreshStock();
          }}
        />
      )}
      {typeModal.open && (
        <TypeEditor
          id={typeModal.id}
          types={types.data ?? []}
          units={units.data ?? []}
          onClose={() => setTypeModal({ open: false })}
          onSaved={() => {
            setTypeModal({ open: false });
            qc.invalidateQueries({ queryKey: ["inv-types"] });
          }}
        />
      )}
      {catModal.open && (
        <CategoryEditor
          id={catModal.id}
          types={types.data ?? []}
          categories={categories.data ?? []}
          onClose={() => setCatModal({ open: false })}
          onSaved={() => {
            setCatModal({ open: false });
            qc.invalidateQueries({ queryKey: ["inv-cats"] });
          }}
        />
      )}
      {supModal.open && (
        <SupplierEditor
          id={supModal.id}
          suppliers={suppliers.data ?? []}
          onClose={() => setSupModal({ open: false })}
          onSaved={() => {
            setSupModal({ open: false });
            qc.invalidateQueries({ queryKey: ["inv-sup"] });
          }}
        />
      )}
    </div>
  );
}

function ItemEditor({
  id,
  types,
  categories,
  units,
  suppliers,
  onClose,
  onSaved
}: {
  id?: string;
  types: TypeRow[];
  categories: CatRow[];
  units: UnitRow[];
  suppliers: SupplierRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = useQuery({
    queryKey: ["inv-item", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get(`/inventory/items/${id}`)).data.data.item as InvItem
  });
  const item = existing.data;
  const [form, setForm] = useState({
    name: "",
    sku: "",
    type: "raw_material",
    categoryId: "",
    unit: "sqft",
    costPerUnit: 0,
    openingQty: 0,
    reorderLevel: 0,
    maxStock: 0,
    warehouse: "Main",
    supplierId: "",
    batch: ""
  });

  useEffect(() => {
    if (!item) return;
    setForm({
      name: item.name,
      sku: item.sku,
      type: item.type,
      categoryId: typeof item.categoryId === "object" ? item.categoryId?._id ?? "" : item.categoryId ?? "",
      unit: item.unit,
      costPerUnit: item.costPerUnit,
      openingQty: 0,
      reorderLevel: item.reorderLevel ?? 0,
      maxStock: item.maxStock ?? 0,
      warehouse: item.warehouse ?? "Main",
      supplierId: typeof item.supplierId === "object" ? item.supplierId?._id ?? "" : item.supplierId ?? "",
      batch: ""
    });
  }, [item]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        costPerUnit: Number(form.costPerUnit),
        openingQty: id ? undefined : Number(form.openingQty) || undefined,
        reorderLevel: Number(form.reorderLevel),
        maxStock: Number(form.maxStock) || undefined,
        supplierId: form.supplierId || undefined,
        categoryId: form.categoryId || undefined
      };
      return id ? api.patch(`/inventory/items/${id}`, payload) : api.post("/inventory/items", payload);
    },
    onSuccess: () => {
      toast.success(id ? "SKU updated" : "SKU created");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save SKU"))
  });

  const cats = categories.filter((c) => c.type === form.type);

  return (
    <Modal title={id ? "Edit stock SKU" : "New stock SKU"} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="SKU" required>
          <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Type" required>
          <SearchableSelect
            value={form.type}
            onChange={(v) => {
              const t = types.find((x) => x.slug === v);
              setForm({ ...form, type: v, categoryId: "", unit: t?.defaultUnit?.toLowerCase() || form.unit });
            }}
            options={types.map((t) => ({ value: t.slug, label: t.name }))}
          />
        </Field>
        <Field label="Category">
          <SearchableSelect
            value={form.categoryId}
            onChange={(v) => setForm({ ...form, categoryId: v })}
            emptyLabel="None"
            options={cats.map((c) => ({ value: c._id, label: c.name }))}
          />
        </Field>
        <Field label="Unit">
          <SearchableSelect
            value={form.unit}
            onChange={(v) => setForm({ ...form, unit: v })}
            options={units.map((u) => ({ value: u.code.toLowerCase(), label: u.name, hint: u.code }))}
          />
        </Field>
        <Field label="Supplier">
          <SearchableSelect
            value={form.supplierId}
            onChange={(v) => setForm({ ...form, supplierId: v })}
            emptyLabel="None"
            options={suppliers.map((s) => ({ value: s._id, label: s.name }))}
          />
        </Field>
        <Field label="Cost / unit">
          <Input type="number" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: Number(e.target.value) })} />
        </Field>
        {!id && (
          <Field label="Opening qty">
            <Input type="number" value={form.openingQty} onChange={(e) => setForm({ ...form, openingQty: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Reorder level">
          <Input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })} />
        </Field>
        <Field label="Warehouse">
          <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!form.name || !form.sku || save.isPending} onClick={() => save.mutate()}>
          {id ? "Save" : "Create with opening"}
        </Button>
      </div>
    </Modal>
  );
}

function TypeEditor({
  id,
  types,
  units,
  onClose,
  onSaved
}: {
  id?: string;
  types: TypeRow[];
  units: UnitRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = types.find((t) => t._id === id);
  const [form, setForm] = useState({
    name: row?.name ?? "",
    description: row?.description ?? "",
    defaultUnit: row?.defaultUnit ?? "pcs"
  });
  const save = useMutation({
    mutationFn: async () => (id ? api.patch(`/inventory/types/${id}`, form) : api.post("/inventory/types", form)),
    onSuccess: () => {
      toast.success("Type saved");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save type"))
  });
  return (
    <Modal title={id ? "Edit type" : "New type"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Default unit">
          <SearchableSelect
            value={form.defaultUnit}
            onChange={(v) => setForm({ ...form, defaultUnit: v })}
            options={units.map((u) => ({ value: u.code.toLowerCase(), label: u.name }))}
          />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={form.name.length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CategoryEditor({
  id,
  types,
  categories,
  onClose,
  onSaved
}: {
  id?: string;
  types: TypeRow[];
  categories: CatRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = categories.find((c) => c._id === id);
  const [form, setForm] = useState({
    name: row?.name ?? "",
    type: row?.type ?? types[0]?.slug ?? "raw_material",
    description: row?.description ?? ""
  });
  const save = useMutation({
    mutationFn: async () => (id ? api.patch(`/inventory/categories/${id}`, form) : api.post("/inventory/categories", form)),
    onSuccess: () => {
      toast.success("Category saved");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save category"))
  });
  return (
    <Modal title={id ? "Edit category" : "New category"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Type" required>
          <SearchableSelect value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={types.map((t) => ({ value: t.slug, label: t.name }))} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={form.name.length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SupplierEditor({
  id,
  suppliers,
  onClose,
  onSaved
}: {
  id?: string;
  suppliers: SupplierRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = suppliers.find((s) => s._id === id);
  const [form, setForm] = useState({
    name: row?.name ?? "",
    phone: row?.phone ?? "",
    gstin: row?.gstin ?? "",
    contactName: row?.contactName ?? "",
    email: row?.email ?? "",
    paymentTerms: row?.paymentTerms ?? "",
    leadTimeDays: row?.leadTimeDays ?? 0,
    city: row?.city ?? "",
    address: row?.address ?? ""
  });
  const save = useMutation({
    mutationFn: async () =>
      id
        ? api.patch(`/inventory/suppliers/${id}`, { ...form, leadTimeDays: Number(form.leadTimeDays) || 0 })
        : api.post("/inventory/suppliers", { ...form, leadTimeDays: Number(form.leadTimeDays) || 0, email: form.email || undefined }),
    onSuccess: () => {
      toast.success("Supplier saved");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save supplier"))
  });
  return (
    <Modal title={id ? "Edit supplier" : "New supplier"} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Contact">
          <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </Field>
        <Field label="Phone" hint="10 digits">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
        </Field>
        <Field label="GSTIN">
          <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Payment terms">
          <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
        </Field>
        <Field label="Lead time (days)">
          <Input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: Number(e.target.value) })} />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={form.name.length < 2} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
