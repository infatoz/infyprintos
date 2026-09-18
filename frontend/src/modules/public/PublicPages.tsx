import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { publicApi } from "@/lib/api";
import { Button, Card, Textarea } from "@/components/ui";
import { DocumentSheet } from "@/components/DocumentSheet";
import { useState } from "react";

export function PublicQuotationPage() {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["pq", token],
    queryFn: async () => (await publicApi.get(`/public/quotations/${token}`)).data.data
  });
  const [reason, setReason] = useState("");
  const approve = useMutation({
    mutationFn: async () => publicApi.post(`/public/quotations/${token}/approve`, {}),
    onSuccess: () => {
      toast.success("Approved. The press has been notified.");
      void q.refetch();
    }
  });
  const reject = useMutation({
    mutationFn: async () => publicApi.post(`/public/quotations/${token}/reject`, { reason }),
    onSuccess: () => {
      toast.success("Rejection sent");
      void q.refetch();
    }
  });
  if (q.isError) return <PublicShell title="Link expired" body="This quotation link is invalid or has expired." />;
  if (!q.data) return <PublicShell title="Loading…" />;
  const closed = ["approved", "rejected", "converted"].includes(q.data.status);
  return (
    <div className="min-h-dvh bg-paper px-3 py-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <DocumentSheet
          kind="quotation"
          number={q.data.number}
          business={q.data.business}
          customer={q.data.customer}
          items={q.data.items}
          totals={q.data.totals}
          notes={q.data.notes}
          terms={q.data.terms}
          date={q.data.createdAt}
          validUntil={q.data.validUntil}
          status={q.data.status}
          footer={q.data.business?.invoiceFooter || q.data.business?.invoiceNotes}
          actions={
            closed ? undefined : (
              <>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                  Approve quotation
                </Button>
                <Button variant="secondary" onClick={() => window.print()}>
                  Print
                </Button>
              </>
            )
          }
        />
        {closed ? (
          <p className="mt-4 text-center text-[13px] capitalize text-muted">This quotation is {q.data.status.replaceAll("_", " ")}.</p>
        ) : (
          <Card className="mt-4 p-4 print:hidden">
            <p className="text-[13px] text-muted">Need changes? Tell the press what to revise.</p>
            <Textarea className="mt-2" placeholder="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button className="mt-3 w-full" variant="danger" onClick={() => reject.mutate()} disabled={reason.length < 3 || reject.isPending}>
              Request changes
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

export function PublicDesignPage() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["pd", token], queryFn: async () => (await publicApi.get(`/public/designs/${token}`)).data.data });
  const [reason, setReason] = useState("");
  const approve = useMutation({
    mutationFn: async () => publicApi.post(`/public/designs/${token}/approve`, {}),
    onSuccess: () => {
      toast.success("Artwork approved");
      void q.refetch();
    }
  });
  const reject = useMutation({
    mutationFn: async () => publicApi.post(`/public/designs/${token}/reject`, { reason }),
    onSuccess: () => {
      toast.success("Revision requested");
      void q.refetch();
    }
  });
  if (!q.data) return <PublicShell title="Loading artwork…" />;
  return (
    <PublicShell title="Artwork approval" body={`${q.data.business?.name} · ${q.data.orderNumber}`}>
      <Card className="overflow-hidden">
        {q.data.mimeType?.includes("image") ? (
          <img src={q.data.url} alt="Artwork preview" className="max-h-[480px] w-full object-contain bg-paper-2" />
        ) : (
          <a className="block p-6 underline" href={q.data.url} target="_blank" rel="noreferrer">
            Open {q.data.fileName}
          </a>
        )}
        <div className="p-6">
          <p className="text-sm text-ink/60">Version {q.data.version}. Approved files are locked and cannot be changed from this link.</p>
          {q.data.status === "locked" ? (
            <p className="mt-3 font-semibold">Already approved.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <Button className="w-full" onClick={() => approve.mutate()}>
                Approve this version
              </Button>
              <Textarea placeholder="What should we change?" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="secondary" className="w-full" onClick={() => reject.mutate()} disabled={reason.length < 3}>
                Reject & request revision
              </Button>
            </div>
          )}
        </div>
      </Card>
    </PublicShell>
  );
}

export function PublicMembershipPage() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["pm", token], queryFn: async () => (await publicApi.get(`/public/membership/${token}`)).data.data });
  if (q.isError) return <PublicShell title="Card not found" />;
  if (!q.data) return <PublicShell title="Checking card…" />;
  return (
    <PublicShell title={q.data.business?.name} body="Membership verification">
      <Card className="bg-ink p-8 text-white">
        <div className="text-xs uppercase tracking-[0.25em] text-gold">Verified member</div>
        <div className="mt-4 text-3xl font-extrabold">{q.data.customer?.name}</div>
        <div className="mt-2 font-mono text-white/70">{q.data.membershipId}</div>
        <div className="mt-8 flex justify-between text-sm">
          <span>{q.data.tierName}</span>
          <span className="capitalize">{q.data.status}</span>
        </div>
      </Card>
    </PublicShell>
  );
}

function PublicShell({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-gold-2">Infy PrintOS</div>
          <h1 className="mt-2 text-2xl font-extrabold">{title}</h1>
          {body && <p className="mt-1 text-sm text-ink/50">{body}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
