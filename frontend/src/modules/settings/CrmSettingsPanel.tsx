import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Modal, SearchableSelect, StatusBadge, Td, Th } from "@/components/ui";
import { SortTh, TablePager, TableSearch, useClientTable } from "@/components/data-table";

type Tier = { _id: string; name: string; slug?: string; discountPercent?: number; active?: boolean; sortOrder?: number };
type Term = { _id: string; name: string; slug?: string; type: string; netDays?: number; description?: string; active?: boolean };

function apiErr(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

const TERM_TYPES = [
  { value: "prepaid", label: "Prepaid" },
  { value: "due_on_billing", label: "Due on billing" },
  { value: "net_days", label: "Net days" },
  { value: "custom", label: "Custom" }
];

export function CrmSettingsPanel({
  tiers,
  terms,
  onChanged
}: {
  tiers: Tier[];
  terms: Term[];
  onChanged: () => void;
}) {
  const [tierEditor, setTierEditor] = useState<Partial<Tier> & { open: boolean; isNew?: boolean }>({ open: false });
  const [termEditor, setTermEditor] = useState<Partial<Term> & { open: boolean; isNew?: boolean }>({ open: false });
  const [tierForm, setTierForm] = useState({ name: "", discountPercent: "0", active: true });
  const [termForm, setTermForm] = useState({ name: "", type: "net_days", netDays: "15", description: "", active: true });
  const tierTable = useClientTable(tiers, (r) => `${r.name} ${r.slug ?? ""}`);
  const termTable = useClientTable(terms, (r) => `${r.name} ${r.type} ${r.description ?? ""}`);

  const saveTier = useMutation({
    mutationFn: async () => {
      const payload = { name: tierForm.name, discountPercent: Number(tierForm.discountPercent || 0), active: tierForm.active };
      if (tierEditor.isNew) return api.post("/settings/tiers", payload);
      return api.patch(`/settings/tiers/${tierEditor._id}`, payload);
    },
    onSuccess: () => {
      toast.success(tierEditor.isNew ? "Tier created" : "Tier updated");
      setTierEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save tier"))
  });

  const saveTerm = useMutation({
    mutationFn: async () => {
      const payload = {
        name: termForm.name,
        type: termForm.type,
        netDays: Number(termForm.netDays || 0),
        description: termForm.description || undefined,
        active: termForm.active
      };
      if (termEditor.isNew) return api.post("/settings/credit-terms", payload);
      return api.patch(`/settings/credit-terms/${termEditor._id}`, payload);
    },
    onSuccess: () => {
      toast.success(termEditor.isNew ? "Credit term created" : "Credit term updated");
      setTermEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save credit term"))
  });

  const removeTier = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/tiers/${id}`),
    onSuccess: () => {
      toast.success("Tier deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete tier"))
  });

  const removeTerm = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/credit-terms/${id}`),
    onSuccess: () => {
      toast.success("Credit term deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete credit term"))
  });

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold">Customer tiers</h3>
            <p className="mt-0.5 text-[12px] text-muted">Used on customer records, POS pricing and membership cards.</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setTierForm({ name: "", discountPercent: "0", active: true });
              setTierEditor({ open: true, isNew: true });
            }}
          >
            New tier
          </Button>
        </div>
        <div className="border-b border-line px-4 py-2">
          <TableSearch value={tierTable.search} onChange={tierTable.setSearch} placeholder="Search tiers" />
        </div>
        <table className="app-table w-full">
          <thead>
            <tr>
              <SortTh id="name" sortKey={tierTable.sortKey} sortDir={tierTable.sortDir} onSort={tierTable.toggleSort}>
                Name
              </SortTh>
              <Th>Discount hint</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tierTable.rows.map((t) => (
              <tr key={t._id}>
                <Td>{t.name}</Td>
                <Td>{t.discountPercent ?? 0}%</Td>
                <Td>
                  <StatusBadge status={t.active === false ? "inactive" : "active"} />
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTierForm({ name: t.name, discountPercent: String(t.discountPercent ?? 0), active: t.active !== false });
                        setTierEditor({ ...t, open: true, isNew: false });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`Delete ${t.name}?`)) removeTier.mutate(t._id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePager page={tierTable.page} pages={tierTable.pages} total={tierTable.total} onPage={tierTable.setPage} noun="tiers" />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold">Credit terms</h3>
            <p className="mt-0.5 text-[12px] text-muted">Payment terms assigned when creating or editing a customer.</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setTermForm({ name: "", type: "net_days", netDays: "15", description: "", active: true });
              setTermEditor({ open: true, isNew: true });
            }}
          >
            New term
          </Button>
        </div>
        <div className="border-b border-line px-4 py-2">
          <TableSearch value={termTable.search} onChange={termTable.setSearch} placeholder="Search credit terms" />
        </div>
        <table className="app-table w-full">
          <thead>
            <tr>
              <SortTh id="name" sortKey={termTable.sortKey} sortDir={termTable.sortDir} onSort={termTable.toggleSort}>
                Name
              </SortTh>
              <Th>Type</Th>
              <Th>Days</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {termTable.rows.map((t) => (
              <tr key={t._id}>
                <Td>{t.name}</Td>
                <Td className="capitalize">{t.type.replaceAll("_", " ")}</Td>
                <Td>{t.netDays ?? 0}</Td>
                <Td>
                  <StatusBadge status={t.active === false ? "inactive" : "active"} />
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTermForm({
                          name: t.name,
                          type: t.type,
                          netDays: String(t.netDays ?? 0),
                          description: t.description ?? "",
                          active: t.active !== false
                        });
                        setTermEditor({ ...t, open: true, isNew: false });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`Delete ${t.name}?`)) removeTerm.mutate(t._id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePager page={termTable.page} pages={termTable.pages} total={termTable.total} onPage={termTable.setPage} noun="terms" />
      </Card>

      {tierEditor.open && (
        <Modal title={tierEditor.isNew ? "New customer tier" : "Edit tier"} onClose={() => setTierEditor({ open: false })}>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={tierForm.name} onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })} />
            </Field>
            <Field label="Discount hint %">
              <Input type="number" min={0} max={100} value={tierForm.discountPercent} onChange={(e) => setTierForm({ ...tierForm, discountPercent: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={tierForm.active} onChange={(e) => setTierForm({ ...tierForm, active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTierEditor({ open: false })}>
              Cancel
            </Button>
            <Button disabled={saveTier.isPending || tierForm.name.trim().length < 2} onClick={() => saveTier.mutate()}>
              {saveTier.isPending ? "Saving…" : "Save tier"}
            </Button>
          </div>
        </Modal>
      )}

      {termEditor.open && (
        <Modal title={termEditor.isNew ? "New credit term" : "Edit credit term"} onClose={() => setTermEditor({ open: false })}>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={termForm.name} onChange={(e) => setTermForm({ ...termForm, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <SearchableSelect value={termForm.type} onChange={(type) => setTermForm({ ...termForm, type })} options={TERM_TYPES} />
            </Field>
            <Field label="Net days">
              <Input type="number" min={0} value={termForm.netDays} onChange={(e) => setTermForm({ ...termForm, netDays: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input value={termForm.description} onChange={(e) => setTermForm({ ...termForm, description: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={termForm.active} onChange={(e) => setTermForm({ ...termForm, active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTermEditor({ open: false })}>
              Cancel
            </Button>
            <Button disabled={saveTerm.isPending || termForm.name.trim().length < 2} onClick={() => saveTerm.mutate()}>
              {saveTerm.isPending ? "Saving…" : "Save term"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
