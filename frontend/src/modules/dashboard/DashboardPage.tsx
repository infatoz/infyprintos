import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { Card, Empty, ErrorState, Kpi, KpiRow, PageHeader, Skeleton, StatusBadge, Td, Th } from "@/components/ui";
import { inr } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";
import { groupForRange, rangeFromPreset, type ReportPreset } from "@/lib/reports";
import { ReportRangeBar } from "@/modules/reports/ReportRange";

type MixRow = { status?: string; source?: string; method?: string; count: number; value?: number; amount?: number };
type TopCustomer = { _id: string; total: number; orders: number; customer: { name?: string; code?: string } };
type TopItem = { _id: string; sku?: string; qty: number; total: number };
type Alert = { level: string; label: string; value: number; href: string };

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const role = user?.role?.slug;
  const financial = can(user, ["reports.view", "finance.view", "orders.view_cost"], "any");
  const canReports = can(user, "reports.view");
  const initial = rangeFromPreset("30d");
  const [preset, setPreset] = useState<ReportPreset | "custom">("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [fromDay, setFromDay] = useState(initial.fromDay);
  const [toDay, setToDay] = useState(initial.toDay);
  const qs = useMemo(() => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&group=${groupForRange(from, to)}`, [from, to]);

  const dash = useQuery({
    queryKey: ["dash", from, to],
    queryFn: async () => (await api.get(`/reports/dashboard?${qs}`)).data.data
  });
  const sales = useQuery({
    queryKey: ["sales-trend", from, to],
    enabled: canReports,
    queryFn: async () => (await api.get(`/reports/sales?${qs}`)).data.data
  });

  const d = dash.data ?? {};

  function applyPreset(next: ReportPreset) {
    const r = rangeFromPreset(next);
    setPreset(next);
    setFrom(r.from);
    setTo(r.to);
    setFromDay(r.fromDay);
    setToDay(r.toDay);
  }

  if (dash.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (dash.isError) {
    return <ErrorState title="Dashboard could not load" hint="Check the API connection and try again." onRetry={() => void dash.refetch()} />;
  }

  const chart = (sales.data ?? []).map((r: { _id: string; revenue: number; collected: number; tax?: number }) => ({
    day: r._id,
    revenue: r.revenue,
    collected: r.collected,
    tax: r.tax ?? 0
  }));
  const agingChart = [
    { bucket: "0–30", amount: d.aging?.current ?? 0 },
    { bucket: "31–60", amount: d.aging?.days31_60 ?? 0 },
    { bucket: "61–90", amount: d.aging?.days61_90 ?? 0 },
    { bucket: "90+", amount: d.aging?.days90plus ?? 0 }
  ];
  const statusChart = ((d.statusMix ?? []) as MixRow[]).slice(0, 8).map((r) => ({ name: String(r.status ?? "").replaceAll("_", " "), count: r.count }));

  return (
    <div>
      <PageHeader
        title={role === "order_manager" ? "Order floor" : "Overview"}
        subtitle={
          financial
            ? "Booked sales, collections, GST and profit for the selected period. Outstanding is the live receivables balance."
            : "Operational queue for the modules assigned to your role."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canReports ? (
              <Link to="/reports" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-[13px] font-medium hover:bg-paper">
                All reports
              </Link>
            ) : null}
            {can(user, "orders.create") ? (
              <Link to="/pos" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white shadow-sm hover:brightness-110">
                New order
              </Link>
            ) : null}
          </div>
        }
      />

      {canReports ? (
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
      ) : null}

      {financial && (
        <KpiRow className="xl:grid-cols-4">
          <Kpi label="Sales booked" value={inr(d.sales)} hint="Order value" delta={d.compare?.sales} />
          <Kpi label="Collected" value={inr(d.collected)} hint={`Pending ${inr(d.pending)}`} delta={d.compare?.collected} />
          <Kpi
            label="Outstanding"
            value={inr(d.outstanding)}
            hint={`${d.outstandingCount ?? 0} open invoices`}
            tone={Number(d.outstanding) > 0 ? "warn" : "default"}
            invertDelta
          />
          <Kpi label="Est. profit" value={inr(d.estimatedProfit)} hint={`Expenses ${inr(d.expenses)}`} delta={d.compare?.estimatedProfit} />
        </KpiRow>
      )}

      {financial && (
        <KpiRow className="xl:grid-cols-4">
          <Kpi label="GST collected" value={inr(d.taxTotal)} hint={`Taxable ${inr(d.taxable)}`} delta={d.compare?.taxTotal} />
          <Kpi label="Orders" value={String(d.orders ?? 0)} hint={`${d.delivered ?? 0} delivered · ${d.cancelled ?? 0} cancelled`} delta={d.compare?.orders} />
          <Kpi label="Quote conversion" value={`${d.quotes?.conversionRate ?? 0}%`} hint={`${d.quotes?.pending ?? 0} still open`} />
          <Kpi label="Shop floor" value={String(d.productionOpen ?? 0)} hint={`${d.delayed ?? 0} delayed orders`} tone={Number(d.delayed) > 0 ? "warn" : "default"} />
        </KpiRow>
      )}

      <div className={canReports ? "grid gap-4 lg:grid-cols-3" : "grid gap-4"}>
        {canReports && (
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-[14px] font-semibold">Revenue vs collections</h3>
              <span className="text-[12px] text-muted">Navy = booked · teal = collected</span>
            </div>
            {chart.length === 0 ? (
              <Empty title="No sales in this period" hint="Confirmed orders will plot here." />
            ) : (
              <div className="h-56">
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
        )}
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold">Needs attention</h3>
          <dl className="mt-3 divide-y divide-line text-[13px]">
            {((d.alerts ?? []) as Alert[]).length === 0 &&
              [
                can(user, "quotations.view") ? { label: "Pending quotations", value: d.pendingQuotes ?? 0, href: "/quotations" } : null,
                { label: "Awaiting design approval", value: d.awaitingApproval ?? 0, href: "/orders" },
                { label: "Delayed orders", value: d.delayed ?? 0, href: "/orders" },
                can(user, "inventory.view") ? { label: "Low stock SKUs", value: d.lowStock ?? 0, href: "/inventory" } : null
              ]
                .filter((row): row is { label: string; value: number; href: string } => Boolean(row))
                .map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-2">
                    <Link to={row.href} className="hover:underline">
                      {row.label}
                    </Link>
                    <b className="tabular-nums">{String(row.value)}</b>
                  </div>
                ))}
            {((d.alerts ?? []) as Alert[]).map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2">
                <Link to={row.href} className="hover:underline">
                  {row.label}
                </Link>
                <b className="tabular-nums">{String(row.value)}</b>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {canReports && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-5">
            <h3 className="mb-3 text-[14px] font-semibold">Order pipeline</h3>
            {statusChart.length === 0 ? (
              <Empty title="No orders yet" />
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChart} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid stroke="currentColor" strokeOpacity={0.06} horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#1b365d" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          {financial && (
            <Card className="p-5">
              <h3 className="mb-3 text-[14px] font-semibold">Receivables aging</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingChart}>
                    <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Bar dataKey="amount" fill="#b45309" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {financial && (
            <Card className="p-5">
              <h3 className="mb-3 text-[14px] font-semibold">Collections by method</h3>
              {((d.methods ?? d.top?.methods ?? []) as MixRow[]).length === 0 ? (
                <Empty title="No collections in this period" />
              ) : (
                <ul className="space-y-2 text-[13px]">
                  {((d.methods ?? d.top?.methods ?? []) as MixRow[]).map((m) => (
                    <li key={String(m.method)} className="flex items-center justify-between gap-3">
                      <span className="capitalize">{String(m.method).replaceAll("_", " ")}</span>
                      <span className="font-mono tabular-nums">{inr(m.amount ?? m.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}

      {canReports && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <h3 className="px-4 pt-4 text-[14px] font-semibold">Top customers</h3>
            {(d.top?.customers ?? []).length === 0 && <Empty title="No customer sales yet" hint="Confirmed orders will appear here." />}
            {(d.top?.customers ?? []).length > 0 && (
              <table className="app-table mt-1 w-full">
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Orders</Th>
                    <Th className="text-right">Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {(d.top?.customers ?? []).map((c: TopCustomer) => (
                    <tr key={c._id}>
                      <Td>
                        <div>{c.customer?.name}</div>
                        {c.customer?.code ? <div className="text-[11px] text-muted">{c.customer.code}</div> : null}
                      </Td>
                      <Td>{c.orders}</Td>
                      <Td mono className="text-right">
                        {inr(c.total)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="overflow-hidden">
            <h3 className="px-4 pt-4 text-[14px] font-semibold">Top items</h3>
            {(d.top?.items ?? []).length === 0 && <Empty title="No item sales yet" hint="Catalog items from orders will rank here." />}
            {(d.top?.items ?? []).length > 0 && (
              <table className="app-table mt-1 w-full">
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Qty</Th>
                    <Th className="text-right">Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {(d.top?.items ?? []).map((c: TopItem) => (
                    <tr key={c._id}>
                      <Td>
                        {c._id}
                        {c.sku ? <span className="ml-2 text-[11px] text-muted">{c.sku}</span> : null}
                      </Td>
                      <Td>{c.qty}</Td>
                      <Td mono className="text-right">
                        {inr(c.total)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {canReports && ((d.sourceMix ?? []) as MixRow[]).length > 0 && (
        <p className="mt-4 text-[12px] text-muted">
          Channel mix:{" "}
          {((d.sourceMix ?? []) as MixRow[]).map((s, i) => (
            <span key={String(s.source)}>
              {i > 0 ? " · " : ""}
              <StatusBadge status={String(s.source)} /> {s.count} ({inr(s.value)})
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
