import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Modal, Select, StatusBadge, Td, Textarea, Th } from "@/components/ui";
import { SortTh, TablePager, TableSearch, useClientTable } from "@/components/data-table";

function apiErr(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

type Row = Record<string, unknown> & { _id: string };

function Actions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

export function PaymentMethodsPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { name: string; code: string; type?: string; active?: boolean; system?: boolean }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ name: "", code: "", type: "other", active: true });
  const save = useMutation({
    mutationFn: async () =>
      editor.id ? api.patch(`/settings/payment-methods/${editor.id}`, form) : api.post("/settings/payment-methods", form),
    onSuccess: () => {
      toast.success(editor.id ? "Payment method updated" : "Payment method created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save payment method"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/payment-methods/${id}`),
    onSuccess: () => {
      toast.success("Payment method deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete payment method"))
  });
  const table = useClientTable(rows, (r) => `${r.name} ${r.code} ${r.type ?? ""}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="Payment methods"
        hint="Used on POS, orders, collections and expenses. System methods can be renamed but not deleted."
        onNew={() => {
          setForm({ name: "", code: "", type: "other", active: true });
          setEditor({ open: true });
        }}
        newLabel="New method"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Name
            </SortTh>
            <Th>Code</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td>{row.name}</Td>
              <Td mono>{row.code}</Td>
              <Td className="capitalize">{row.type || "other"}</Td>
              <Td>
                <StatusBadge status={row.active === false ? "inactive" : "active"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({ name: row.name, code: row.code, type: row.type || "other", active: row.active !== false });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit payment method" : "New payment method"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            {!editor.id && (
              <Field label="Code" hint="Leave blank to generate from the name.">
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
            )}
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {["cash", "upi", "bank", "card", "cheque", "credit", "other"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
          <SaveBar pending={save.isPending} disabled={form.name.trim().length < 2} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

export function PrintersPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { name: string; type?: string; paperSize?: string; connectionType?: string; isDefault?: boolean; active?: boolean; header?: string; footer?: string }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ name: "", type: "a4", paperSize: "A4", connectionType: "browser", isDefault: false, active: true, header: "", footer: "" });
  const save = useMutation({
    mutationFn: async () => (editor.id ? api.patch(`/settings/printers/${editor.id}`, form) : api.post("/settings/printers", form)),
    onSuccess: () => {
      toast.success(editor.id ? "Printer updated" : "Printer created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save printer"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/printers/${id}`),
    onSuccess: () => {
      toast.success("Printer deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete printer"))
  });
  const table = useClientTable(rows, (r) => `${r.name} ${r.type ?? ""} ${r.paperSize ?? ""}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="Printers"
        hint="Browser print is the fallback. USB thermal printers need a local print bridge."
        onNew={() => {
          setForm({ name: "", type: "a4", paperSize: "A4", connectionType: "browser", isDefault: false, active: true, header: "", footer: "" });
          setEditor({ open: true });
        }}
        newLabel="New printer"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Name
            </SortTh>
            <Th>Type</Th>
            <Th>Paper</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td>
                {row.name}
                {row.isDefault ? <span className="ml-2 text-[11px] text-muted">Default</span> : null}
              </Td>
              <Td>{row.type}</Td>
              <Td>{row.paperSize}</Td>
              <Td>
                <StatusBadge status={row.active === false ? "inactive" : "active"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({
                      name: row.name,
                      type: row.type || "a4",
                      paperSize: row.paperSize || "A4",
                      connectionType: row.connectionType || "browser",
                      isDefault: Boolean(row.isDefault),
                      active: row.active !== false,
                      header: row.header ?? "",
                      footer: row.footer ?? ""
                    });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit printer" : "New printer"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {["a4", "a5", "thermal", "label", "barcode", "network", "pdf", "browser"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paper">
              <Input value={form.paperSize} onChange={(e) => setForm({ ...form, paperSize: e.target.value })} />
            </Field>
            <Field label="Connection">
              <Select value={form.connectionType} onChange={(e) => setForm({ ...form, connectionType: e.target.value })}>
                {["browser", "usb", "network", "pdf"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Header">
              <Input value={form.header} onChange={(e) => setForm({ ...form, header: e.target.value })} />
            </Field>
            <Field label="Footer">
              <Input value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Default printer
          </label>
          <SaveBar pending={save.isPending} disabled={form.name.trim().length < 2} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

export function BranchesPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { name: string; code: string; phone?: string; email?: string; isDefault?: boolean; active?: boolean }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ name: "", code: "", phone: "", email: "", isDefault: false, active: true });
  const save = useMutation({
    mutationFn: async () => (editor.id ? api.patch(`/settings/branches/${editor.id}`, form) : api.post("/settings/branches", form)),
    onSuccess: () => {
      toast.success(editor.id ? "Branch updated" : "Branch created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save branch"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/branches/${id}`),
    onSuccess: () => {
      toast.success("Branch deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete branch"))
  });
  const table = useClientTable(rows, (r) => `${r.name} ${r.code} ${r.phone ?? ""} ${r.email ?? ""}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="Branches"
        hint="Staff and stock are scoped to a branch. Keep at least one active branch."
        onNew={() => {
          setForm({ name: "", code: "", phone: "", email: "", isDefault: false, active: true });
          setEditor({ open: true });
        }}
        newLabel="New branch"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <Th>Code</Th>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Name
            </SortTh>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td mono>{row.code}</Td>
              <Td>
                {row.name}
                {row.isDefault ? <span className="ml-2 text-[11px] text-muted">Default</span> : null}
              </Td>
              <Td>
                <StatusBadge status={row.active === false ? "inactive" : "active"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({
                      name: row.name,
                      code: row.code,
                      phone: row.phone ?? "",
                      email: row.email ?? "",
                      isDefault: Boolean(row.isDefault),
                      active: row.active !== false
                    });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit branch" : "New branch"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Code">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Default branch
          </label>
          <SaveBar pending={save.isPending} disabled={form.name.trim().length < 2 || form.code.trim().length < 2} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

export function StatusesPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { name: string; code: string; color?: string; sortOrder?: number; requiresReason?: boolean; terminal?: boolean; allowedTransitions?: string[]; active?: boolean }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ name: "", code: "", color: "#64748B", sortOrder: "200", requiresReason: false, terminal: false, allowedTransitions: "", active: true });
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        code: form.code || undefined,
        color: form.color,
        sortOrder: Number(form.sortOrder || 200),
        requiresReason: form.requiresReason,
        terminal: form.terminal,
        allowedTransitions: form.allowedTransitions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        active: form.active
      };
      return editor.id ? api.patch(`/settings/statuses/${editor.id}`, payload) : api.post("/settings/statuses", payload);
    },
    onSuccess: () => {
      toast.success(editor.id ? "Status updated" : "Status created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save status"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/statuses/${id}`),
    onSuccess: () => {
      toast.success("Status deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete status"))
  });
  const table = useClientTable(rows, (r) => `${r.name} ${r.code}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="Order statuses"
        hint="Controls the floor pipeline. Allowed transitions are comma-separated status codes."
        onNew={() => {
          setForm({ name: "", code: "", color: "#64748B", sortOrder: "200", requiresReason: false, terminal: false, allowedTransitions: "", active: true });
          setEditor({ open: true });
        }}
        newLabel="New status"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Name
            </SortTh>
            <Th>Code</Th>
            <Th>Order</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td>{row.name}</Td>
              <Td mono>{row.code}</Td>
              <Td>{row.sortOrder ?? 0}</Td>
              <Td>
                <StatusBadge status={row.active === false ? "inactive" : "active"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({
                      name: row.name,
                      code: row.code,
                      color: row.color || "#64748B",
                      sortOrder: String(row.sortOrder ?? 0),
                      requiresReason: Boolean(row.requiresReason),
                      terminal: Boolean(row.terminal),
                      allowedTransitions: (row.allowedTransitions ?? []).join(", "),
                      active: row.active !== false
                    });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit status" : "New status"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Code" hint={editor.id ? "Code cannot change after create." : "Leave blank to generate."}>
              <Input value={form.code} disabled={Boolean(editor.id)} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label="Colour">
              <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </Field>
            <Field label="Sort order">
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
            </Field>
            <Field label="Allowed transitions" hint="Comma-separated codes, e.g. in_production, cancelled">
              <Input value={form.allowedTransitions} onChange={(e) => setForm({ ...form, allowedTransitions: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 grid gap-2 text-[13px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.requiresReason} onChange={(e) => setForm({ ...form, requiresReason: e.target.checked })} />
              Reason required
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.terminal} onChange={(e) => setForm({ ...form, terminal: e.target.checked })} />
              Terminal status
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
          <SaveBar pending={save.isPending} disabled={form.name.trim().length < 2} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

export function CouponsPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { code: string; type: string; value: number; minOrder?: number; active?: boolean; expiresAt?: string }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ code: "", type: "percent", value: "10", minOrder: "0", expiresAt: "", active: true });
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code,
        type: form.type,
        value: Number(form.value),
        minOrder: Number(form.minOrder || 0),
        expiresAt: form.expiresAt || undefined,
        active: form.active
      };
      return editor.id ? api.patch(`/settings/coupons/${editor.id}`, payload) : api.post("/settings/coupons", payload);
    },
    onSuccess: () => {
      toast.success(editor.id ? "Coupon updated" : "Coupon created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save coupon"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/coupons/${id}`),
    onSuccess: () => {
      toast.success("Coupon deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete coupon"))
  });
  const table = useClientTable(rows, (r) => `${r.code} ${r.type}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="Coupons"
        hint="POS and quotations validate codes on the server."
        onNew={() => {
          setForm({ code: "", type: "percent", value: "10", minOrder: "0", expiresAt: "", active: true });
          setEditor({ open: true });
        }}
        newLabel="New coupon"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Value</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td mono>{row.code}</Td>
              <Td>
                {row.type === "percent" ? `${row.value}%` : row.value} {row.minOrder ? `· min ${row.minOrder}` : ""}
              </Td>
              <Td>
                <StatusBadge status={row.active === false ? "inactive" : "active"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({
                      code: row.code,
                      type: row.type,
                      value: String(row.value),
                      minOrder: String(row.minOrder ?? 0),
                      expiresAt: row.expiresAt ? String(row.expiresAt).slice(0, 10) : "",
                      active: row.active !== false
                    });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.code}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit coupon" : "New coupon"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="percent">Percent</option>
                <option value="fixed">Fixed amount</option>
              </Select>
            </Field>
            <Field label="Value">
              <Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </Field>
            <Field label="Minimum order">
              <Input type="number" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} />
            </Field>
            <Field label="Expires">
              <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <SaveBar pending={save.isPending} disabled={form.code.trim().length < 2} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

export function TaxRatesPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { name: string; rate: number; hsn?: string; active?: boolean }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ name: "", rate: "18", hsn: "", active: true });
  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, rate: Number(form.rate), hsn: form.hsn || undefined, active: form.active };
      return editor.id ? api.patch(`/settings/tax-rates/${editor.id}`, payload) : api.post("/settings/tax-rates", payload);
    },
    onSuccess: () => {
      toast.success(editor.id ? "Tax rate updated" : "Tax rate created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save tax rate"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/tax-rates/${id}`),
    onSuccess: () => {
      toast.success("Tax rate deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete tax rate"))
  });
  const table = useClientTable(rows, (r) => `${r.name} ${r.hsn ?? ""} ${r.rate}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="GST rates"
        hint="Masters for catalog items and billing. Default organisation rate is set under Numbering."
        onNew={() => {
          setForm({ name: "", rate: "18", hsn: "", active: true });
          setEditor({ open: true });
        }}
        newLabel="New rate"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Name
            </SortTh>
            <Th>Rate</Th>
            <Th>HSN / SAC</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td>{row.name}</Td>
              <Td>{row.rate}%</Td>
              <Td>{row.hsn || "—"}</Td>
              <Td>
                <StatusBadge status={row.active === false ? "inactive" : "active"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({ name: row.name, rate: String(row.rate), hsn: row.hsn ?? "", active: row.active !== false });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit tax rate" : "New tax rate"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Rate %">
              <Input type="number" min={0} max={100} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </Field>
            <Field label="HSN / SAC">
              <Input value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
          <SaveBar pending={save.isPending} disabled={form.name.trim().length < 2} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

export function TemplatesPanel({
  rows,
  onChanged
}: {
  rows: Array<Row & { name: string; event: string; channel: string; enabled?: boolean; body?: string }>;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [form, setForm] = useState({ name: "", event: "order_created", channel: "whatsapp", body: "", enabled: true });
  const save = useMutation({
    mutationFn: async () => (editor.id ? api.patch(`/notifications/templates/${editor.id}`, form) : api.post("/notifications/templates", form)),
    onSuccess: () => {
      toast.success(editor.id ? "Template updated" : "Template created");
      setEditor({ open: false });
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save template"))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/notifications/templates/${id}`),
    onSuccess: () => {
      toast.success("Template deleted");
      onChanged();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not delete template"))
  });
  const table = useClientTable(rows, (r) => `${String(r.event ?? "")} ${String(r.channel ?? "")} ${String(r.body ?? "")}`);

  return (
    <Card className="overflow-hidden">
      <Header
        title="WhatsApp templates"
        hint="Used for manual share only. Variables such as {{customer_name}} and {{order_number}} are filled when staff share."
        onNew={() => {
          setForm({ name: "", event: "order_created", channel: "whatsapp", body: "", enabled: true });
          setEditor({ open: true });
        }}
        newLabel="New template"
        search={table.search}
        onSearch={table.setSearch}
      />
      <table className="app-table w-full">
        <thead>
          <tr>
            <Th>Template</Th>
            <Th>Event</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id}>
              <Td>{row.name}</Td>
              <Td>{row.event.replaceAll("_", " ")}</Td>
              <Td>
                <StatusBadge status={row.enabled ? "active" : "off"} />
              </Td>
              <Td>
                <Actions
                  onEdit={() => {
                    setForm({
                      name: row.name,
                      event: row.event,
                      channel: row.channel,
                      body: row.body ?? "",
                      enabled: row.enabled !== false
                    });
                    setEditor({ open: true, id: row._id });
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row._id);
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} />
      {editor.open && (
        <Modal title={editor.id ? "Edit template" : "New template"} onClose={() => setEditor({ open: false })}>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Event">
              <Select value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>
                {["customer_created", "quotation_sent", "order_created", "order_status", "order_cancelled", "design_uploaded", "payment_received", "order_delivered"].map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Body">
              <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Enabled
            </label>
          </div>
          <SaveBar pending={save.isPending} disabled={form.name.trim().length < 2 || form.body.trim().length < 3} onCancel={() => setEditor({ open: false })} onSave={() => save.mutate()} />
        </Modal>
      )}
    </Card>
  );
}

function Header({
  title,
  hint,
  onNew,
  newLabel,
  search,
  onSearch
}: {
  title: string;
  hint: string;
  onNew: () => void;
  newLabel: string;
  search?: string;
  onSearch?: (value: string) => void;
}) {
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{title}</h3>
          <p className="mt-0.5 text-[12px] text-muted">{hint}</p>
        </div>
        <Button size="sm" onClick={onNew}>
          {newLabel}
        </Button>
      </div>
      {onSearch ? (
        <div className="mt-3">
          <TableSearch value={search ?? ""} onChange={onSearch} placeholder={`Search ${title.toLowerCase()}`} />
        </div>
      ) : null}
    </div>
  );
}

function SaveBar({ pending, disabled, onCancel, onSave }: { pending: boolean; disabled: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button disabled={pending || disabled} onClick={onSave}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
