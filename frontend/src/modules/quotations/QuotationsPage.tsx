import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Empty, FilterBar, Input, PageHeader, Select, StatusBadge, Td, Th } from "@/components/ui";
import { SortTh, TablePager, useServerTable } from "@/components/data-table";
import { DocumentSheet } from "@/components/DocumentSheet";
import { openPdf } from "@/lib/pdf";
import { fmtDate, inr } from "@/lib/cn";
import { pickWhatsapp, WhatsAppShareModal, type WhatsappShare } from "@/components/WhatsAppShare";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";

export function QuotationsPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canSend = can(user, "quotations.send");
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);
  const [status, setStatus] = useState("");
  const table = useServerTable({ limit: 20, sort: "-createdAt" });
  const list = useQuery({
    queryKey: ["quotations", status, table.params],
    queryFn: async () => (await api.get("/quotations", { params: { ...table.params, status: status || undefined } })).data
  });
  const send = useMutation({
    mutationFn: async (id: string) => (await api.post(`/quotations/${id}/send`)).data.data,
    onSuccess: (data) => {
      toast.success("Quotation ready to share");
      const share = pickWhatsapp(data);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["quotations"] });
    }
  });
  const meta = list.data?.meta ?? { page: 1, pages: 1, total: 0 };

  return (
    <div>
      <PageHeader title="Quotations" subtitle="Draft, share, collect customer approval, then convert to an order." />
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
          {["draft", "sent", "viewed", "awaiting_approval", "approved", "rejected", "converted"].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </FilterBar>
      <Card className="overflow-hidden">
        <table className="app-table w-full">
          <thead>
            <tr>
              <SortTh id="number" serverSort={table.sort} onSort={table.toggleSort}>
                Number
              </SortTh>
              <Th>Customer</Th>
              <Th className="text-right">Total</Th>
              <SortTh id="status" serverSort={table.sort} onSort={table.toggleSort}>
                Status
              </SortTh>
              <SortTh id="updatedAt" serverSort={table.sort} onSort={table.toggleSort}>
                Updated
              </SortTh>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data ?? []).map((q: Record<string, unknown>) => (
              <tr key={String(q._id)} className="hover:bg-paper/80">
                <Td mono>
                  <Link to={`/quotations/${q._id}`} className="hover:underline">
                    {String(q.number)}
                  </Link>
                </Td>
                <Td>{(q.customerId as { name?: string })?.name ?? (q.customerSnapshot as { name?: string })?.name}</Td>
                <Td mono className="text-right">
                  {inr(Number((q.totals as { grandTotal?: number })?.grandTotal))}
                </Td>
                <Td>
                  <StatusBadge status={String(q.status)} />
                </Td>
                <Td>{fmtDate(String(q.updatedAt))}</Td>
                <Td>
                  {canSend && ["draft", "sent", "viewed", "awaiting_approval", "revision_requested", "rejected"].includes(String(q.status)) && (
                    <Button size="sm" variant="secondary" onClick={() => send.mutate(String(q._id))}>
                      WhatsApp
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.data?.data?.length && <Empty title="No quotations" hint="Create a quotation from POS or convert an approved estimate." />}
        <TablePager
          page={meta.page}
          pages={meta.pages}
          total={meta.total}
          onPage={table.setPage}
          pageSize={table.limit}
          onPageSize={table.setLimit}
          noun="quotations"
        />
      </Card>
      {waShare && <WhatsAppShareModal share={waShare} title="Share quotation on WhatsApp" onClose={() => setWaShare(null)} />}
    </div>
  );
}

export function QuotationDetailPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const canSend = can(user, "quotations.send");
  const canConvert = can(user, "orders.create");
  const canCancel = can(user, "quotations.update");
  const canDelete = can(user, "quotations.delete");
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);
  const q = useQuery({ queryKey: ["quotation", id], queryFn: async () => (await api.get(`/quotations/${id}`)).data.data });
  const convert = useMutation({
    mutationFn: async () => (await api.post(`/orders/from-quotation/${id}`)).data.data,
    onSuccess: (order) => {
      toast.success(`Order ${order.number} created`);
      const share = pickWhatsapp(order);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["quotation", id] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Cannot convert")
  });
  const send = useMutation({
    mutationFn: async () => (await api.post(`/quotations/${id}/send`)).data.data,
    onSuccess: (data) => {
      toast.success("Approval link ready");
      const share = pickWhatsapp(data);
      if (share) setWaShare(share);
      qc.invalidateQueries({ queryKey: ["quotation", id] });
    }
  });
  const cancel = useMutation({
    mutationFn: async () => api.post(`/quotations/${id}/cancel`),
    onSuccess: () => {
      toast.success("Quotation cancelled");
      qc.invalidateQueries({ queryKey: ["quotation", id] });
    }
  });
  const remove = useMutation({
    mutationFn: async () => api.delete(`/quotations/${id}`),
    onSuccess: () => {
      toast.success("Quotation deleted");
      navigate("/quotations");
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Cannot delete")
  });
  if (!q.data) return <p>Loading…</p>;
  return (
    <div>
      <PageHeader
        title={q.data.number}
        subtitle="Server-priced quotation snapshot"
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await openPdf(`/quotations/${id}/pdf`);
                } catch {
                  toast.error("Could not open PDF");
                }
              }}
            >
              PDF
            </Button>
            {canSend && ["draft", "sent", "viewed", "awaiting_approval", "revision_requested", "rejected"].includes(q.data.status) ? (
              <Button variant="gold" onClick={() => send.mutate()} disabled={send.isPending}>
                WhatsApp approval
              </Button>
            ) : null}
            {canConvert && q.data.status === "approved" ? (
              <Button onClick={() => convert.mutate()} disabled={convert.isPending}>
                Convert to order
              </Button>
            ) : null}
            {canCancel && !["converted", "cancelled"].includes(q.data.status) ? (
              <Button variant="ghost" onClick={() => cancel.mutate()}>
                Cancel
              </Button>
            ) : null}
            {canDelete && ["draft", "cancelled", "rejected"].includes(q.data.status) ? (
              <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />
      <DocumentSheet
        kind="quotation"
        number={q.data.number}
        customer={q.data.customerSnapshot}
        items={q.data.items}
        totals={q.data.totals}
        notes={q.data.notes}
        terms={q.data.terms}
        date={q.data.createdAt}
        validUntil={q.data.validUntil}
        status={q.data.status}
      />
      {(q.data.versions ?? []).length > 1 && (
        <p className="mt-3 text-xs text-ink/50">Revision {q.data.revisionNumber} · {q.data.versions.length} saved versions</p>
      )}
      {waShare && <WhatsAppShareModal share={waShare} title="Share quotation on WhatsApp" onClose={() => setWaShare(null)} />}
    </div>
  );
}
