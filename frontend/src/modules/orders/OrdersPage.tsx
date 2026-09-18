import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { DocumentSheet } from "@/components/DocumentSheet";
import { openPdf } from "@/lib/pdf";
import { Button, Card, Empty, FilterBar, Input, PageHeader, Select, StatusBadge, Td, Th } from "@/components/ui";
import { SortTh, TablePager, useServerTable } from "@/components/data-table";
import { fmtDate, inr } from "@/lib/cn";
import { useState } from "react";
import { pickWhatsapp, WhatsAppShareModal, type WhatsappShare } from "@/components/WhatsAppShare";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";

export function OrdersPage() {
  const [status, setStatus] = useState("");
  const table = useServerTable({ limit: 20, sort: "-createdAt" });
  const statuses = useQuery({ queryKey: ["ostatus"], queryFn: async () => (await api.get("/orders/statuses")).data.data });
  const list = useQuery({
    queryKey: ["orders", status, table.params],
    queryFn: async () => (await api.get("/orders", { params: { ...table.params, status: status || undefined } })).data
  });
  const meta = list.data?.meta ?? { page: 1, pages: 1, total: 0, limit: table.limit };
  return (
    <div>
      <PageHeader title="Orders" subtitle="Workflow from approval through production, dispatch and collection." />
      <FilterBar className="sm:grid-cols-2 lg:grid-cols-3">
        <Input placeholder="Search number or customer" value={table.search} onChange={(e) => table.setSearch(e.target.value)} />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            table.setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {(statuses.data ?? []).map((s: { code: string; name: string }) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </Select>
      </FilterBar>
      <Card className="overflow-hidden">
        <table className="app-table w-full">
          <thead>
            <tr>
              <SortTh id="number" serverSort={table.sort} onSort={table.toggleSort}>
                Order
              </SortTh>
              <Th>Customer</Th>
              <SortTh id="status" serverSort={table.sort} onSort={table.toggleSort}>
                Status
              </SortTh>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
              <SortTh id="createdAt" serverSort={table.sort} onSort={table.toggleSort}>
                Created
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data ?? []).map((o: Record<string, unknown>) => (
              <tr key={String(o._id)} className="hover:bg-paper/80">
                <Td mono>
                  <Link className="hover:underline" to={`/orders/${o._id}`}>
                    {String(o.number)}
                  </Link>
                </Td>
                <Td>{(o.customerId as { name?: string })?.name ?? (o.customerSnapshot as { name?: string })?.name}</Td>
                <Td>
                  <StatusBadge status={String(o.status)} />
                </Td>
                <Td mono className="text-right">
                  {inr(Number((o.totals as { grandTotal?: number })?.grandTotal))}
                </Td>
                <Td mono className="text-right">
                  {inr(Number((o.totals as { balanceDue?: number })?.balanceDue))}
                </Td>
                <Td>{fmtDate(String(o.createdAt))}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.data?.data?.length && <Empty title="No orders yet" hint="Open POS to create the first job ticket." />}
        <TablePager
          page={meta.page}
          pages={meta.pages}
          total={meta.total}
          onPage={table.setPage}
          pageSize={table.limit}
          onPageSize={table.setLimit}
          noun="orders"
        />
      </Card>
    </div>
  );
}

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const user = useAuth((s) => s.user);
  const canEdit = can(user, "orders.edit");
  const canStatus = can(user, "orders.change_status");
  const canCancel = can(user, "orders.cancel");
  const canPay = can(user, "finance.payments");
  const canDesign = can(user, "designs.manage");
  const canOfflineDesign = ["owner", "administrator", "order_manager"].includes(user?.role?.slug ?? "");
  const canSeeCost = can(user, "orders.view_cost");
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["order", id], queryFn: async () => (await api.get(`/orders/${id}`)).data.data });
  const statuses = useQuery({ queryKey: ["ostatus"], queryFn: async () => (await api.get("/orders/statuses")).data.data });
  const [next, setNext] = useState("");
  const [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [pay, setPay] = useState({ amount: 0, method: "upi", reference: "" });
  const [file, setFile] = useState<File | null>(null);
  const [itemId, setItemId] = useState("");
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);
  const methods = useQuery({
    queryKey: ["pay-methods"],
    enabled: canPay,
    queryFn: async () => (await api.get("/settings/payment-methods")).data.data as { code: string; name: string }[]
  });

  const statusMu = useMutation({
    mutationFn: async () => (await api.post(`/orders/${id}/status`, { status: next, reason, expectedDate: expectedDate || undefined })).data.data,
    onSuccess: (data) => {
      toast.success("Status updated");
      const share = pickWhatsapp(data);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["order", id] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Blocked")
  });
  const payMu = useMutation({
    mutationFn: async () => (await api.post(`/orders/${id}/payments`, pay)).data.data,
    onSuccess: (data) => {
      toast.success("Payment recorded");
      const share = pickWhatsapp(data);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["order", id] });
    }
  });
  const cancelMu = useMutation({
    mutationFn: async () => (await api.post(`/orders/${id}/cancel`, { reason: cancelReason })).data.data,
    onSuccess: (data) => {
      toast.success("Order cancelled");
      const share = pickWhatsapp(data);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["order", id] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Cannot cancel")
  });
  const saveDraft = useMutation({
    mutationFn: async () => {
      const current = detail.data?.order;
      if (!current) throw new Error("Order not loaded");
      const items = current.items.map((i: { _id: string; itemId: string; variantId?: string; quantity: number; unitPrice: number; discountType?: string; discountValue?: number }) => ({
        itemId: String(i.itemId),
        variantId: i.variantId ? String(i.variantId) : undefined,
        quantity: draftQty[i._id] ?? i.quantity,
        unitPrice: i.unitPrice,
        discountType: i.discountType,
        discountValue: i.discountValue
      }));
      return api.patch(`/orders/${id}`, { items });
    },
    onSuccess: () => {
      toast.success("Draft recalculated");
      qc.invalidateQueries({ queryKey: ["order", id] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not save")
  });
  const designMu = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("orderItemId", itemId);
      return api.post(`/orders/${id}/designs`, fd);
    },
    onSuccess: (res) => {
      toast.success("Design uploaded");
      const share = pickWhatsapp(res.data.data);
      if (share) setWaShare(share);
      else if (res.data.data.approvalLink) window.open(res.data.data.approvalLink, "_blank");
      qc.invalidateQueries({ queryKey: ["order", id] });
    }
  });
  const designStatusMu = useMutation({
    mutationFn: async ({ itemId: lineId, status }: { itemId: string; status: string }) =>
      api.patch(`/orders/${id}/items/${lineId}/design-status`, { status, note: "Recorded offline" }),
    onSuccess: () => {
      toast.success("Design status updated");
      qc.invalidateQueries({ queryKey: ["order", id] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not update design status")
  });

  if (!detail.data) return <p>Loading…</p>;
  const { order, history, designs, jobs, payments, invoices } = detail.data;
  const eBillReady = ["delivered", "completed"].includes(String(order.status));
  const designItems = (order.items ?? []).filter((i: { requiresDesign?: boolean }) => i.requiresDesign);

  return (
    <div>
      <PageHeader
        title={order.number}
        subtitle={`${order.customerSnapshot?.name} · ${order.source}`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const { data } = await api.post(`/orders/${id}/whatsapp`);
                  const share = pickWhatsapp(data.data) ?? data.data.whatsapp;
                  if (share) setWaShare(share);
                  else toast.error("No WhatsApp number on this customer");
                } catch (e: unknown) {
                  toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not prepare WhatsApp");
                }
              }}
            >
              WhatsApp
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await openPdf(`/orders/${id}/invoice.pdf`);
                } catch {
                  toast.error("Could not open invoice");
                }
              }}
            >
              Invoice PDF
            </Button>
            {eBillReady ? (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await openPdf(`/orders/${id}/ebill.pdf`);
                  } catch {
                    toast.error("Could not open e-bill");
                  }
                }}
              >
                E-bill PDF
              </Button>
            ) : null}
          </div>
        }
      />
        <div className="grid gap-4 xl:grid-cols-3">
        <div className="grid gap-4 xl:col-span-2">
        <DocumentSheet
          kind={eBillReady ? "ebill" : "invoice"}
          number={(invoices?.[0]?.number as string) || order.number}
          customer={order.customerSnapshot}
          items={order.items}
          totals={order.totals}
          notes={order.notes}
          date={invoices?.[0]?.eBillIssuedAt || order.createdAt}
          dueDate={order.dueDate}
          orderNumber={order.number}
          paymentMethod={order.paymentMethod}
          status={order.status}
        />
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status={order.status} />
            {order.status === "draft" && canEdit ? <span className="text-[12px] text-muted">Adjust quantities, then recalculate.</span> : null}
          </div>
          {order.status === "draft" && canEdit ? (
            <table className="mt-4 w-full text-sm">
              <tbody>
                {order.items.map((i: Record<string, unknown>) => (
                  <tr key={String(i._id)} className="border-t border-line">
                    <td className="py-2">
                      {String(i.name)}
                      <div className="text-[11px] text-muted">{String(i.designStatus)}</div>
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={1}
                        className="w-20"
                        value={draftQty[String(i._id)] ?? Number(i.quantity)}
                        onChange={(e) => setDraftQty({ ...draftQty, [String(i._id)]: Number(e.target.value) })}
                      />
                    </td>
                    <td className="text-right font-mono">{inr(Number(i.lineTotal))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {order.status === "draft" && canEdit && (
            <Button className="mt-2" variant="secondary" size="sm" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>
              Recalculate draft
            </Button>
          )}
          {order.cancelReason && <p className="mt-2 text-sm text-rose-600">Cancelled: {order.cancelReason}</p>}
          {order.delayReason && <p className="mt-2 text-sm text-amber-700">Delay: {order.delayReason}</p>}
          {canSeeCost && typeof order.items?.[0]?.cost === "number" && (
            <p className="mt-2 text-[12px] text-muted">
              Job cost {inr(order.items.reduce((sum: number, i: { cost?: number }) => sum + Number(i.cost ?? 0), 0))}
            </p>
          )}
          {canStatus && (
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <Select value={next} onChange={(e) => setNext(e.target.value)}>
                <option value="">Move status</option>
                {(statuses.data ?? []).map((s: { code: string; name: string }) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Input placeholder="Reason if required" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              <Button onClick={() => statusMu.mutate()} disabled={!next}>
                Update
              </Button>
            </div>
          )}
          {canCancel && order.status !== "cancelled" && (
            <div className="mt-3 flex gap-2">
              <Input placeholder="Cancellation reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              <Button variant="danger" onClick={() => cancelMu.mutate()} disabled={cancelReason.length < 3}>
                Cancel
              </Button>
            </div>
          )}
        </Card>
        </div>
        <Card className="p-5">
          <h3 className="font-bold">Collections</h3>
          <p className="mt-1 text-sm text-ink/50">Paid {inr(order.totals.paidAmount)} · Due {inr(order.totals.balanceDue)}</p>
          {canPay && (
            <div className="mt-3 space-y-2">
              <Input type="number" placeholder="Amount" value={pay.amount || ""} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} />
              <Input placeholder="UPI / ref (unique)" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                {(methods.data ?? [{ code: "cash", name: "Cash" }, { code: "upi", name: "UPI" }]).map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </Select>
              <Button className="w-full" onClick={() => payMu.mutate()}>
                Record payment
              </Button>
            </div>
          )}
          <ul className="mt-3 space-y-1 text-xs">
            {(payments ?? []).map((p: { _id: string; number: string; amount: number; method: string }) => (
              <li key={p._id} className="flex items-center justify-between gap-2">
                <span>{p.number}</span>
                <span className="flex items-center gap-2 font-mono">
                  {inr(p.amount)} {p.method}
                  <button
                    type="button"
                    className="text-[11px] font-sans font-medium text-accent hover:underline"
                    onClick={() => void openPdf(`/finance/payments/${p._id}/receipt.pdf`).catch(() => toast.error("Could not open receipt"))}
                  >
                    PDF
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-bold">Design approval</h3>
          <p className="mt-1 text-[12px] text-muted">Items that need artwork, with live status. Staff can record approval given offline.</p>
          {designItems.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No items on this order require design approval.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1.5">Item</th>
                  <th className="py-1.5">Status</th>
                  {canOfflineDesign ? <th className="py-1.5">Offline</th> : null}
                </tr>
              </thead>
              <tbody>
                {designItems.map((i: { _id: string; name: string; designStatus?: string; quantity?: number }) => (
                  <tr key={i._id} className="border-t border-line">
                    <td className="py-2">
                      {i.name}
                      <div className="text-[11px] text-muted">Qty {i.quantity ?? 1}</div>
                    </td>
                    <td className="py-2">
                      <StatusBadge status={String(i.designStatus || "pending")} />
                    </td>
                    {canOfflineDesign ? (
                      <td className="py-2">
                        <Select
                          className="h-8 min-w-[9.5rem] text-[12px]"
                          value={i.designStatus || "pending"}
                          disabled={designStatusMu.isPending}
                          onChange={(e) => designStatusMu.mutate({ itemId: i._id, status: e.target.value })}
                        >
                          {["pending", "uploaded", "awaiting_approval", "approved", "rejected"].map((s) => (
                            <option key={s} value={s}>
                              {s.replaceAll("_", " ")}
                            </option>
                          ))}
                        </Select>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canDesign && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select line</option>
                {order.items.map((i: { _id: string; name: string }) => (
                  <option key={i._id} value={i._id}>
                    {i.name}
                  </option>
                ))}
              </Select>
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button onClick={() => designMu.mutate()} disabled={!file || !itemId}>
                Upload & share
              </Button>
            </div>
          )}
          <ul className="mt-3 space-y-2 text-sm">
            {(designs ?? []).map((d: { _id: string; fileName: string; version: number; status: string; url: string }) => (
              <li key={d._id} className="flex justify-between">
                <a className="underline" href={d.url} target="_blank" rel="noreferrer">
                  v{d.version} {d.fileName}
                </a>
                <StatusBadge status={String(d.status)} />
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-bold">Timeline</h3>
          <ol className="mt-3 space-y-3">
            {(history ?? []).map((h: { _id: string; toStatus: string; createdAt: string; reason?: string }) => (
              <li key={h._id} className="border-l-2 border-gold pl-3 text-sm">
                <div className="font-semibold">{h.toStatus.replaceAll("_", " ")}</div>
                <div className="text-xs text-ink/45">
                  {fmtDate(h.createdAt)} {h.reason ? `· ${h.reason}` : ""}
                </div>
              </li>
            ))}
          </ol>
          {(jobs ?? []).length > 0 && (
            <div className="mt-4 text-sm">
              Production jobs: {jobs.map((j: { number: string }) => j.number).join(", ")}
            </div>
          )}
        </Card>
      </div>
      {waShare && <WhatsAppShareModal share={waShare} title="Share order update on WhatsApp" onClose={() => setWaShare(null)} />}
    </div>
  );
}
