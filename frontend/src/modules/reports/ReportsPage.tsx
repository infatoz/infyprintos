import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { Button, Card, Empty, ErrorState, Kpi, KpiRow, PageHeader, Skeleton, StatusBadge, Tabs, Td, Th } from "@/components/ui";
import { SortTh, TablePager, TableSearch, useClientTable } from "@/components/data-table";
import { fmtDay, inr } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";
import { groupForRange, rangeFromPreset, type ReportPreset } from "@/lib/reports";
import { ReportRangeBar } from "./ReportRange";

const TABS = [
  { id: "overview", label: "P&L" },
  { id: "sales", label: "Sales" },
  { id: "gst", label: "GST" },
  { id: "receivables", label: "Receivables" },
  { id: "quotations", label: "Quotations" },
  { id: "production", label: "Production" },
  { id: "inventory", label: "Inventory" },
  { id: "expenses", label: "Expenses" },
  { id: "customers", label: "Customers" }
] as const;

const EXPORT_FOR: Record<string, string> = {
  overview: "sales",
  sales: "sales",
  gst: "gst",
  receivables: "aging",
  production: "production",
  inventory: "inventory",
  expenses: "expenses",
  customers: "customers"
};

const DETAIL_FOR: Record<string, string> = {
  gst: "gst",
  receivables: "aging",
  quotations: "pipeline",
  production: "production",
  inventory: "inventory",
  expenses: "expenses",
  customers: "customers",
  overview: "pnl"
};

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

export function ReportsPage() {
  const user = useAuth((s) => s.user);
  const canExport = can(user, "reports.export");
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? String(params.get("tab")) : "overview";
  const initial = rangeFromPreset("30d");
  const [preset, setPreset] = useState<ReportPreset | "custom">("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [fromDay, setFromDay] = useState(initial.fromDay);
  const [toDay, setToDay] = useState(initial.toDay);
  const qs = useMemo(() => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&group=${groupForRange(from, to)}`, [from, to]);

  const dash = useQuery({
    queryKey: ["reports-dash", from, to],
    queryFn: async () => (await api.get(`/reports/dashboard?${qs}`)).data.data
  });
  const sales = useQuery({
    queryKey: ["reports-sales", from, to],
    queryFn: async () => (await api.get(`/reports/sales?${qs}`)).data.data
  });
  const top = useQuery({
    queryKey: ["reports-top", from, to],
    enabled: tab === "sales" || tab === "overview",
    queryFn: async () => (await api.get(`/reports/top?${qs}`)).data.data
  });
  const detailKind = DETAIL_FOR[tab];
  const detail = useQuery({
    queryKey: ["reports-detail", detailKind, from, to],
    enabled: Boolean(detailKind),
    queryFn: async () => (await api.get(`/reports/detail?kind=${detailKind}&${qs}`)).data.data
  });

  function applyPreset(next: ReportPreset) {
    const r = rangeFromPreset(next);
    setPreset(next);
    setFrom(r.from);
    setTo(r.to);
    setFromDay(r.fromDay);
    setToDay(r.toDay);
  }

  async function exportCsv() {
    const type = EXPORT_FOR[tab] ?? "sales";
    try {
      const res = await api.get(`/reports/export?type=${type}&${qs}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-report-${fromDay}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Export is not available for this role"));
    }
  }

  const d = dash.data ?? {};
  const chart: Array<{ day: string; revenue: number; collected: number; tax: number; orders: number }> = (sales.data ?? []).map(
    (r: { _id: string; revenue: number; collected: number; tax?: number; orders?: number }) => ({
      day: r._id,
      revenue: r.revenue,
      collected: r.collected,
      tax: r.tax ?? 0,
      orders: r.orders ?? 0
    })
  );
  const chartTable = useClientTable(chart, (r) => `${r.day} ${r.orders} ${r.revenue} ${r.collected}`);

  return (
    <div>
      <PageHeader
        title="Reports & analytics"
        subtitle="Period P&L, GST, receivables aging, production and inventory — all from live orders, invoices and stock."
        actions={
          canExport && EXPORT_FOR[tab] ? (
            <Button variant="secondary" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          ) : undefined
        }
      />
      <ReportRangeBar
        preset={preset}
        fromDay={fromDay}
        toDay={toDay}
        onPreset={applyPreset}
        onFromDay={(value) => {
          setFromDay(value);
          setPreset("custom");
          setFrom(new Date(`${value}T00:00:00`).toISOString());
        }}
        onToDay={(value) => {
          setToDay(value);
          setPreset("custom");
          setTo(new Date(`${value}T23:59:59`).toISOString());
        }}
      />
      <Tabs tabs={[...TABS]} value={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} />

      {dash.isError ? <ErrorState title="Reports could not load" onRetry={() => void dash.refetch()} /> : null}

      {tab === "overview" && (
        <>
          <KpiRow className="xl:grid-cols-4">
            <Kpi label="Sales booked" value={inr(d.sales)} delta={d.compare?.sales} />
            <Kpi label="Collected" value={inr(d.collected)} delta={d.compare?.collected} />
            <Kpi label="GST" value={inr(d.taxTotal)} hint={`CGST ${inr(d.cgst)} · SGST ${inr(d.sgst)} · IGST ${inr(d.igst)}`} />
            <Kpi label="Est. profit" value={inr(d.estimatedProfit)} hint={`Expenses ${inr(d.expenses)}`} delta={d.compare?.estimatedProfit} />
          </KpiRow>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h3 className="mb-3 text-[14px] font-semibold">Booked vs collected</h3>
              {chart.length === 0 ? (
                <Empty title="No movement in this period" />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart}>
                      <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Area type="monotone" dataKey="revenue" stroke="#1b365d" fill="#1b365d" fillOpacity={0.12} />
                      <Area type="monotone" dataKey="collected" stroke="#0f5f59" fill="#0f5f59" fillOpacity={0.1} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card className="overflow-hidden p-5">
              <h3 className="text-[14px] font-semibold">P&L snapshot</h3>
              <dl className="mt-3 space-y-2 text-[13px]">
                <Row label="Taxable value" value={inr(detail.data?.current?.taxable ?? d.taxable)} />
                <Row label="GST on sales" value={inr(detail.data?.current?.taxTotal ?? d.taxTotal)} />
                <Row label="Collections" value={inr(d.collected)} />
                <Row label="Approved expenses" value={inr(d.expenses)} />
                <Row label="Live receivables" value={inr(d.outstanding)} />
                <Row label="Profit (collections − expenses)" value={inr(d.estimatedProfit)} strong />
              </dl>
              <p className="mt-4 text-[12px] text-muted">Profit uses cash collected minus approved expenses. Booked sales stay separate.</p>
            </Card>
          </div>
        </>
      )}

      {tab === "sales" && (
        <>
          <KpiRow>
            <Kpi label="Revenue" value={inr(d.sales)} delta={d.compare?.sales} />
            <Kpi label="Orders" value={String(d.orders ?? 0)} delta={d.compare?.orders} />
            <Kpi label="Collected" value={inr(d.collected)} />
            <Kpi label="Avg ticket" value={inr(d.orders ? d.sales / d.orders : 0)} />
          </KpiRow>
          <Card className="mb-4 overflow-hidden">
            <h3 className="px-4 pt-4 text-[14px] font-semibold">Trend</h3>
            {chart.length === 0 ? (
              <Empty title="No sales rows" />
            ) : (
              <div className="overflow-x-auto">
                <div className="px-4 py-2">
                  <TableSearch value={chartTable.search} onChange={chartTable.setSearch} placeholder="Search period" />
                </div>
                <table className="app-table w-full">
                  <thead>
                    <tr>
                      <SortTh id="day" sortKey={chartTable.sortKey} sortDir={chartTable.sortDir} onSort={chartTable.toggleSort}>
                        Period
                      </SortTh>
                      <SortTh id="orders" sortKey={chartTable.sortKey} sortDir={chartTable.sortDir} onSort={chartTable.toggleSort} className="text-right">
                        Orders
                      </SortTh>
                      <SortTh id="revenue" sortKey={chartTable.sortKey} sortDir={chartTable.sortDir} onSort={chartTable.toggleSort} className="text-right">
                        Revenue
                      </SortTh>
                      <Th className="text-right">Collected</Th>
                      <Th className="text-right">GST</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartTable.rows.map((r) => (
                      <tr key={r.day}>
                        <Td mono>{r.day}</Td>
                        <Td className="text-right">{r.orders}</Td>
                        <Td mono className="text-right">
                          {inr(r.revenue)}
                        </Td>
                        <Td mono className="text-right">
                          {inr(r.collected)}
                        </Td>
                        <Td mono className="text-right">
                          {inr(r.tax)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePager page={chartTable.page} pages={chartTable.pages} total={chartTable.total} onPage={chartTable.setPage} noun="periods" />
              </div>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <RankTable title="Customers" rows={(top.data?.customers ?? []).map((c: { _id: string; orders: number; total: number; customer?: { name?: string } }) => ({ id: c._id, name: c.customer?.name, meta: `${c.orders} orders`, value: c.total }))} />
            <RankTable title="Items" rows={(top.data?.items ?? []).map((c: { _id: string; qty: number; total: number; sku?: string }) => ({ id: c._id, name: c._id, meta: `${c.qty} qty${c.sku ? ` · ${c.sku}` : ""}`, value: c.total }))} />
          </div>
        </>
      )}

      {tab === "gst" && <GstPanel data={detail.data} loading={detail.isLoading} />}
      {tab === "receivables" && <AgingPanel data={detail.data} loading={detail.isLoading} live={d.outstanding} count={d.outstandingCount} />}
      {tab === "quotations" && <QuotesPanel data={detail.data} loading={detail.isLoading} />}
      {tab === "production" && <ProductionPanel data={detail.data} loading={detail.isLoading} />}
      {tab === "inventory" && <InventoryPanel data={detail.data} loading={detail.isLoading} />}
      {tab === "expenses" && <ExpensesPanel data={detail.data} loading={detail.isLoading} />}
      {tab === "customers" && <CustomersPanel data={detail.data} loading={detail.isLoading} />}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold" : "font-mono text-[12px] tabular-nums"}>{value}</dd>
    </div>
  );
}

function RankTable({ title, rows }: { title: string; rows: Array<{ id: string; name?: string; meta?: string; value: number }> }) {
  const table = useClientTable(rows, (r) => `${r.name ?? ""} ${r.meta ?? ""} ${r.value}`);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h3 className="text-[14px] font-semibold">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <Empty title={`No ${title.toLowerCase()} yet`} />
      ) : (
        <>
          <div className="px-4 py-2">
            <TableSearch value={table.search} onChange={table.setSearch} placeholder={`Search ${title.toLowerCase()}`} />
          </div>
          <table className="app-table mt-1 w-full">
            <thead>
              <tr>
                <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
                  {title.slice(0, -1)}
                </SortTh>
                <SortTh id="value" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort} className="text-right">
                  Value
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <div>{r.name}</div>
                    {r.meta ? <div className="text-[11px] text-muted">{r.meta}</div> : null}
                  </Td>
                  <Td mono className="text-right">
                    {inr(r.value)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} noun={title.toLowerCase()} />
        </>
      )}
    </Card>
  );
}

function GstPanel({ data, loading }: { data: Record<string, unknown> | undefined; loading: boolean }) {
  const gst = data ?? {};
  const rates = (gst.rates as Array<{ taxRate: number; lines: number; qty: number; taxable: number; tax: number; lineTotal: number }>) ?? [];
  const place = (gst.place as Array<{ place: string; taxable: number; tax: number; orders: number }>) ?? [];
  const rateTable = useClientTable(rates, (r) => `${r.taxRate} ${r.taxable} ${r.tax}`);
  if (loading) return <Skeleton className="h-40" />;
  return (
    <>
      <KpiRow>
        <Kpi label="Taxable" value={inr(gst.taxable as number)} />
        <Kpi label="CGST" value={inr(gst.cgst as number)} />
        <Kpi label="SGST" value={inr(gst.sgst as number)} />
        <Kpi label="IGST" value={inr(gst.igst as number)} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <h3 className="px-4 pt-4 text-[14px] font-semibold">By tax rate</h3>
          {rates.length === 0 ? (
            <Empty title="No taxable lines" />
          ) : (
            <>
              <div className="px-4 py-2">
                <TableSearch value={rateTable.search} onChange={rateTable.setSearch} placeholder="Search rates" />
              </div>
              <table className="app-table mt-1 w-full">
                <thead>
                  <tr>
                    <SortTh id="taxRate" sortKey={rateTable.sortKey} sortDir={rateTable.sortDir} onSort={rateTable.toggleSort}>
                      Rate
                    </SortTh>
                    <Th className="text-right">Lines</Th>
                    <Th className="text-right">Taxable</Th>
                    <Th className="text-right">Tax</Th>
                    <Th className="text-right">Line total</Th>
                  </tr>
                </thead>
                <tbody>
                  {rateTable.rows.map((r) => (
                    <tr key={r.taxRate}>
                      <Td>{r.taxRate}%</Td>
                      <Td className="text-right">{r.lines}</Td>
                      <Td mono className="text-right">
                        {inr(r.taxable)}
                      </Td>
                      <Td mono className="text-right">
                        {inr(r.tax)}
                      </Td>
                      <Td mono className="text-right">
                        {inr(r.lineTotal)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePager page={rateTable.page} pages={rateTable.pages} total={rateTable.total} onPage={rateTable.setPage} noun="rates" />
            </>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold">Place of supply</h3>
          <ul className="mt-3 space-y-2 text-[13px]">
            {place.map((p) => (
              <li key={p.place} className="flex justify-between gap-2">
                <span className="capitalize">{p.place}</span>
                <span className="font-mono">{inr(p.tax)}</span>
              </li>
            ))}
            {place.length === 0 ? <li className="text-muted">No GST split yet.</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}

function AgingPanel({
  data,
  loading,
  live,
  count
}: {
  data: Record<string, unknown> | undefined;
  loading: boolean;
  live?: number;
  count?: number;
}) {
  const aging = data ?? {};
  const buckets = (aging.buckets as { current: number; days31_60: number; days61_90: number; days90plus: number }) ?? {
    current: 0,
    days31_60: 0,
    days61_90: 0,
    days90plus: 0
  };
  const rows =
    (aging.rows as Array<{ id: string; number: string; customer?: string; bucket: string; days: number; balanceDue: number; dueDate?: string; status?: string }>) ?? [];
  const invoiceTable = useClientTable(rows, (r) => `${r.number} ${r.customer ?? ""} ${r.bucket}`);
  if (loading) return <Skeleton className="h-40" />;
  const chart = [
    { bucket: "0–30", amount: buckets.current },
    { bucket: "31–60", amount: buckets.days31_60 },
    { bucket: "61–90", amount: buckets.days61_90 },
    { bucket: "90+", amount: buckets.days90plus }
  ];
  return (
    <>
      <KpiRow>
        <Kpi label="Open receivables" value={inr((aging.total as number) ?? live)} hint={`${aging.count ?? count ?? 0} invoices`} />
        <Kpi label="0–30 days" value={inr(buckets.current)} />
        <Kpi label="31–90 days" value={inr(buckets.days31_60 + buckets.days61_90)} tone="warn" />
        <Kpi label="90+ days" value={inr(buckets.days90plus)} tone="danger" />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Aging buckets</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Bar dataKey="amount" fill="#b45309" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="overflow-hidden lg:col-span-2">
          <h3 className="px-4 pt-4 text-[14px] font-semibold">Open invoices</h3>
          {rows.length === 0 ? (
            <Empty title="No open invoices" hint="Unpaid tax invoices appear here." />
          ) : (
            <>
              <div className="px-4 py-2">
                <TableSearch value={invoiceTable.search} onChange={invoiceTable.setSearch} placeholder="Search invoices" />
              </div>
              <table className="app-table mt-1 w-full">
                <thead>
                  <tr>
                    <SortTh id="number" sortKey={invoiceTable.sortKey} sortDir={invoiceTable.sortDir} onSort={invoiceTable.toggleSort}>
                      Invoice
                    </SortTh>
                    <Th>Customer</Th>
                    <Th>Due</Th>
                    <Th>Age</Th>
                    <SortTh id="balanceDue" sortKey={invoiceTable.sortKey} sortDir={invoiceTable.sortDir} onSort={invoiceTable.toggleSort} className="text-right">
                      Balance
                    </SortTh>
                  </tr>
                </thead>
                <tbody>
                  {invoiceTable.rows.map((r) => (
                  <tr key={r.id}>
                    <Td mono>{r.number}</Td>
                    <Td>{r.customer ?? "—"}</Td>
                    <Td>{fmtDay(r.dueDate)}</Td>
                    <Td>
                      <StatusBadge status={r.bucket} /> {r.days}d
                    </Td>
                    <Td mono className="text-right">
                      {inr(r.balanceDue)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
              <TablePager page={invoiceTable.page} pages={invoiceTable.pages} total={invoiceTable.total} onPage={invoiceTable.setPage} noun="invoices" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function QuotesPanel({ data, loading }: { data: Record<string, unknown> | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="h-40" />;
  const quotes = (data?.quotes ?? {}) as { period?: Array<{ status: string; count: number; value: number }>; conversionRate?: number; pending?: number };
  const orders = (data?.orders as Array<{ status: string; count: number; value: number }>) ?? [];
  const sources = (data?.sources as Array<{ source: string; count: number; value: number }>) ?? [];
  return (
    <>
      <KpiRow>
        <Kpi label="Conversion" value={`${quotes.conversionRate ?? 0}%`} hint="Won vs decided quotes in period" />
        <Kpi label="Open quotes" value={String(quotes.pending ?? 0)} />
        <Kpi label="Order statuses" value={String(orders.reduce((s, r) => s + r.count, 0))} />
        <Kpi label="Channels" value={String(sources.length)} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusTable title="Quotations this period" rows={quotes.period ?? []} />
        <StatusTable title="Live order pipeline" rows={orders} nameKey="status" />
      </div>
    </>
  );
}

function StatusTable({
  title,
  rows,
  nameKey = "status"
}: {
  title: string;
  rows: Array<{ status?: string; source?: string; count: number; value?: number }>;
  nameKey?: "status" | "source";
}) {
  const table = useClientTable(rows, (r) => `${r.status ?? ""} ${r.source ?? ""} ${r.count}`);
  return (
    <Card className="overflow-hidden">
      <h3 className="px-4 pt-4 text-[14px] font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <Empty title="Nothing to show" />
      ) : (
        <>
          <div className="px-4 py-2">
            <TableSearch value={table.search} onChange={table.setSearch} placeholder="Search" />
          </div>
          <table className="app-table mt-1 w-full">
            <thead>
              <tr>
                <Th>Status</Th>
                <SortTh id="count" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort} className="text-right">
                  Count
                </SortTh>
                <SortTh id="value" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort} className="text-right">
                  Value
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={String(r[nameKey] ?? r.status)}>
                  <Td>
                    <StatusBadge status={String(r[nameKey] ?? r.status ?? "")} />
                  </Td>
                  <Td className="text-right">{r.count}</Td>
                  <Td mono className="text-right">
                    {inr(r.value)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
        </>
      )}
    </Card>
  );
}

function ProductionPanel({ data, loading }: { data: Record<string, unknown> | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="h-40" />;
  const p = data ?? {};
  const byStatus = (p.byStatus as Array<{ status: string; count: number }>) ?? [];
  return (
    <>
      <KpiRow>
        <Kpi label="Open jobs" value={String(p.open ?? 0)} />
        <Kpi label="Delayed" value={String(p.delayed ?? 0)} tone={Number(p.delayed) > 0 ? "warn" : "default"} />
        <Kpi label="Past schedule" value={String(p.overdue ?? 0)} tone={Number(p.overdue) > 0 ? "danger" : "default"} />
        <Kpi label="Completed qty" value={String(p.completed ?? 0)} hint={`Planned ${p.planned ?? 0} · waste ${p.wastage ?? 0}`} />
      </KpiRow>
      <StatusTable title="Jobs by status" rows={byStatus.map((r) => ({ status: r.status, count: r.count }))} />
    </>
  );
}

function InventoryPanel({ data, loading }: { data: Record<string, unknown> | undefined; loading: boolean }) {
  const inv = data ?? {};
  const low = (inv.lowStock as Array<{ id: string; sku: string; name: string; stockQty: number; reorderLevel: number; unit?: string; warehouse?: string }>) ?? [];
  const moves = (inv.movements as Array<{ type: string; qty: number; count: number }>) ?? [];
  const lowTable = useClientTable(low, (r) => `${r.sku} ${r.name}`);
  if (loading) return <Skeleton className="h-40" />;
  return (
    <>
      <KpiRow>
        <Kpi label="Stock value" value={inr(inv.value as number)} hint={`${inv.skus ?? 0} SKUs`} />
        <Kpi label="On hand" value={String(inv.stockQty ?? 0)} />
        <Kpi label="Reserved" value={String(inv.reservedQty ?? 0)} />
        <Kpi label="Below reorder" value={String(low.length)} tone={low.length ? "warn" : "default"} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <h3 className="px-4 pt-4 text-[14px] font-semibold">Low / at reorder</h3>
          {low.length === 0 ? (
            <Empty title="No SKUs at reorder" />
          ) : (
            <>
              <div className="px-4 py-2">
                <TableSearch value={lowTable.search} onChange={lowTable.setSearch} placeholder="Search SKUs" />
              </div>
              <table className="app-table mt-1 w-full">
                <thead>
                  <tr>
                    <SortTh id="sku" sortKey={lowTable.sortKey} sortDir={lowTable.sortDir} onSort={lowTable.toggleSort}>
                      SKU
                    </SortTh>
                    <SortTh id="name" sortKey={lowTable.sortKey} sortDir={lowTable.sortDir} onSort={lowTable.toggleSort}>
                      Name
                    </SortTh>
                    <SortTh id="stockQty" sortKey={lowTable.sortKey} sortDir={lowTable.sortDir} onSort={lowTable.toggleSort} className="text-right">
                      Stock
                    </SortTh>
                    <Th className="text-right">Reorder</Th>
                  </tr>
                </thead>
                <tbody>
                  {lowTable.rows.map((r) => (
                  <tr key={r.id}>
                    <Td mono>{r.sku}</Td>
                    <Td>{r.name}</Td>
                    <Td className="text-right">
                      {r.stockQty} {r.unit ?? ""}
                    </Td>
                    <Td className="text-right">{r.reorderLevel}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
              <TablePager page={lowTable.page} pages={lowTable.pages} total={lowTable.total} onPage={lowTable.setPage} noun="SKUs" />
            </>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold">Movements this period</h3>
          <ul className="mt-3 space-y-2 text-[13px]">
            {moves.map((m) => (
              <li key={m.type} className="flex justify-between gap-2">
                <span className="capitalize">{m.type.replaceAll("_", " ")}</span>
                <span className="font-mono">
                  {m.count} · qty {m.qty}
                </span>
              </li>
            ))}
            {moves.length === 0 ? <li className="text-muted">No ledger posts in range.</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}

function ExpensesPanel({ data, loading }: { data: Record<string, unknown> | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="h-40" />;
  const exp = data ?? {};
  const cats = (exp.categories as Array<{ category: string; amount: number; count: number }>) ?? [];
  const types = (exp.types as Array<{ type: string; amount: number; count: number }>) ?? [];
  const pending = (exp.pending as { amount?: number; count?: number }) ?? {};
  return (
    <>
      <KpiRow>
        <Kpi label="Approved spend" value={inr(cats.reduce((s, r) => s + r.amount, 0))} />
        <Kpi label="Categories" value={String(cats.length)} />
        <Kpi label="Awaiting approval" value={inr(pending.amount)} hint={`${pending.count ?? 0} drafts`} tone={Number(pending.count) > 0 ? "warn" : "default"} />
        <Kpi label="Types" value={String(types.length)} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <RankTable title="Categories" rows={cats.map((c) => ({ id: c.category, name: c.category, meta: `${c.count} entries`, value: c.amount }))} />
        <RankTable title="Types" rows={types.map((c) => ({ id: c.type, name: c.type.replaceAll("_", " "), meta: `${c.count} entries`, value: c.amount }))} />
      </div>
    </>
  );
}

function CustomersPanel({ data, loading }: { data: Record<string, unknown> | undefined; loading: boolean }) {
  const c = data ?? {};
  const top = (c.topOutstanding as Array<{ id: string; name: string; code?: string; outstanding: number; overdue: number; creditHold?: boolean }>) ?? [];
  const topTable = useClientTable(top, (r) => `${r.name} ${r.code ?? ""}`);
  if (loading) return <Skeleton className="h-40" />;
  return (
    <>
      <KpiRow className="xl:grid-cols-4">
        <Kpi label="New this period" value={String(c.newCustomers ?? 0)} />
        <Kpi label="Buyers" value={String(c.buyers ?? 0)} hint={`${c.repeatBuyers ?? 0} repeat`} />
        <Kpi label="Outstanding" value={inr(c.outstanding as number)} hint={`${c.overdueAccounts ?? 0} overdue accounts`} />
        <Kpi label="Credit hold" value={String(c.onHold ?? 0)} tone={Number(c.onHold) > 0 ? "danger" : "default"} />
      </KpiRow>
      <Card className="overflow-hidden">
        <h3 className="px-4 pt-4 text-[14px] font-semibold">Highest outstanding</h3>
        {top.length === 0 ? (
          <Empty title="No receivables on customers" />
        ) : (
          <>
            <div className="px-4 py-2">
              <TableSearch value={topTable.search} onChange={topTable.setSearch} placeholder="Search customers" />
            </div>
            <table className="app-table mt-1 w-full">
              <thead>
                <tr>
                  <SortTh id="name" sortKey={topTable.sortKey} sortDir={topTable.sortDir} onSort={topTable.toggleSort}>
                    Customer
                  </SortTh>
                  <SortTh id="outstanding" sortKey={topTable.sortKey} sortDir={topTable.sortDir} onSort={topTable.toggleSort} className="text-right">
                    Outstanding
                  </SortTh>
                  <Th className="text-right">Overdue</Th>
                  <Th>Hold</Th>
                </tr>
              </thead>
              <tbody>
                {topTable.rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <div>{r.name}</div>
                    <div className="text-[11px] text-muted">{r.code}</div>
                  </Td>
                  <Td mono className="text-right">
                    {inr(r.outstanding)}
                  </Td>
                  <Td mono className="text-right">
                    {inr(r.overdue)}
                  </Td>
                  <Td>{r.creditHold ? <StatusBadge status="hold" /> : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
            <TablePager page={topTable.page} pages={topTable.pages} total={topTable.total} onPage={topTable.setPage} noun="customers" />
          </>
        )}
      </Card>
    </>
  );
}
