import { useMemo, useState } from "react";
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
import { fmtDay, inr } from "@/lib/cn";
import { openPdf } from "@/lib/pdf";
import { can } from "@/lib/access";
import { useAuth } from "@/stores/auth";
import { SortTh, TablePager, TableSearch, useClientTable, useServerTable } from "@/components/data-table";

type ExpenseRow = {
  _id: string;
  number: string;
  type?: string;
  category: string;
  categoryId?: { name?: string };
  amount: number;
  tax?: number;
  method?: string;
  vendor?: string;
  notes?: string;
  date: string;
  approvalStatus: string;
  createdBy?: { name?: string };
};
type TypeRow = { _id: string; name: string; slug: string; description?: string; system?: boolean; active?: boolean };
type CatRow = { _id: string; name: string; slug: string; type: string; description?: string; active?: boolean };
type MethodRow = { _id: string; name: string; code: string; type?: string; system?: boolean; active?: boolean };
type PaymentRow = { _id: string; number: string; amount: number; method: string; paidAt: string; customerId?: { name?: string } };

const TABS = ["expenses", "receipts", "types", "categories", "methods"] as const;

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

function tabLabel(id: string) {
  return { expenses: "Expenses", receipts: "Receipts", types: "Types", categories: "Categories", methods: "Payment methods" }[id] ?? id;
}

export function FinancePage() {
  const user = useAuth((s) => s.user);
  const canCreate = can(user, "finance.create_expense");
  const canApprove = can(user, "finance.approve_expense");
  const canMasters = canCreate || canApprove;
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("expenses");
  const expensesTable = useServerTable({ limit: 20, sort: "-date" });
  const receiptsTable = useServerTable({ limit: 20, sort: "-paidAt" });
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [typeModal, setTypeModal] = useState<{ open: boolean; id?: string }>({ open: false });
  const [catModal, setCatModal] = useState<{ open: boolean; id?: string }>({ open: false });
  const [methodModal, setMethodModal] = useState<{ open: boolean; id?: string }>({ open: false });

  const summary = useQuery({ queryKey: ["fin-sum"], queryFn: async () => (await api.get("/finance/summary")).data.data });
  const expenses = useQuery({
    queryKey: ["exp", expensesTable.params, type, category, status],
    queryFn: async () =>
      (
        await api.get("/finance/expenses", {
          params: {
            ...expensesTable.params,
            type: type || undefined,
            category: category || undefined,
            approvalStatus: status || undefined
          }
        })
      ).data as { data: ExpenseRow[]; meta?: { page: number; pages: number; total: number } }
  });
  const payments = useQuery({
    queryKey: ["pays", receiptsTable.params],
    queryFn: async () =>
      (await api.get("/finance/payments", { params: receiptsTable.params })).data as {
        data: PaymentRow[];
        meta?: { page: number; pages: number; total: number };
      }
  });
  const types = useQuery({ queryKey: ["exp-types"], queryFn: async () => (await api.get("/finance/expense-types")).data.data as TypeRow[] });
  const categories = useQuery({
    queryKey: ["exp-cats"],
    queryFn: async () => (await api.get("/finance/expense-categories")).data.data as CatRow[]
  });
  const methods = useQuery({
    queryKey: ["pay-methods", tab],
    queryFn: async () =>
      (await api.get("/finance/payment-methods", { params: tab === "methods" ? { all: true } : undefined })).data.data as MethodRow[]
  });

  const typeLabel = useMemo(() => Object.fromEntries((types.data ?? []).map((t) => [t.slug, t.name])), [types.data]);
  const catLabel = useMemo(() => Object.fromEntries((categories.data ?? []).map((c) => [c.slug, c.name])), [categories.data]);
  const methodLabel = useMemo(() => Object.fromEntries((methods.data ?? []).map((m) => [m.code, m.name])), [methods.data]);
  const typeTable = useClientTable(types.data, (r) => `${r.name} ${r.slug} ${r.description ?? ""}`);
  const catTable = useClientTable(categories.data, (r) => `${r.name} ${r.slug} ${r.type} ${r.description ?? ""}`);
  const methodTable = useClientTable(methods.data, (r) => `${r.name} ${r.code} ${r.type ?? ""}`);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["exp"] });
    qc.invalidateQueries({ queryKey: ["fin-sum"] });
    qc.invalidateQueries({ queryKey: ["exp-types"] });
    qc.invalidateQueries({ queryKey: ["exp-cats"] });
    qc.invalidateQueries({ queryKey: ["pay-methods"] });
    qc.invalidateQueries({ queryKey: ["pays"] });
  }

  const decide = useMutation({
    mutationFn: async ({ id, status: next, notes }: { id: string; status: "approved" | "rejected"; notes?: string }) =>
      api.post(`/finance/expenses/${id}/approve`, { status: next, notes }),
    onSuccess: () => {
      toast.success("Expense updated");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Could not update expense"))
  });

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Track business spend against collected receipts. Categories, types and payment methods are maintained here and shared with POS."
        actions={
          canCreate ? (
            <Button onClick={() => setFormOpen(true)}>Record expense</Button>
          ) : undefined
        }
      />
      <KpiRow>
        <Kpi label="Collected" value={inr(summary.data?.collected)} />
        <Kpi label="Expenses" value={inr(summary.data?.expenses)} />
        <Kpi label="Estimated profit" value={inr(summary.data?.estimatedProfit)} />
        <Kpi label="Pending approval" value={summary.data?.pendingExpenses ?? 0} tone={summary.data?.pendingExpenses ? "warn" : "default"} />
      </KpiRow>
      {(summary.data?.byExpenseCategory ?? []).length > 0 && tab === "expenses" && (
        <Card className="mb-4 p-3 text-[13px] text-muted">
          By category:{" "}
          {(summary.data.byExpenseCategory as { _id: string; total: number }[])
            .map((r) => `${catLabel[r._id] ?? r._id} ${inr(r.total)}`)
            .join(" · ")}
        </Card>
      )}
      <Tabs tabs={TABS.map((t) => ({ id: t, label: tabLabel(t) }))} value={tab} onChange={(id) => setTab(id as (typeof TABS)[number])} />

      {tab === "expenses" && (
        <>
          <FilterBar className="xl:grid-cols-5">
            <Input placeholder="Search number or vendor" value={expensesTable.search} onChange={(e) => expensesTable.setSearch(e.target.value)} />
            <SearchableSelect
              value={type}
              onChange={(v) => {
                setType(v);
                setCategory("");
              }}
              emptyLabel="All types"
              options={(types.data ?? []).map((t) => ({ value: t.slug, label: t.name }))}
            />
            <SearchableSelect
              value={category}
              onChange={setCategory}
              emptyLabel="All categories"
              options={(categories.data ?? [])
                .filter((c) => !type || c.type === type)
                .map((c) => ({ value: c.slug, label: c.name }))}
            />
            <SearchableSelect
              value={status}
              onChange={setStatus}
              emptyLabel="All statuses"
              options={["pending", "approved", "rejected"].map((s) => ({ value: s, label: s }))}
            />
          </FilterBar>
          <Card className="overflow-hidden">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="number" serverSort={expensesTable.sort} onSort={expensesTable.toggleSort}>
                    Expense
                  </SortTh>
                  <Th>Type</Th>
                  <Th>Category</Th>
                  <Th>Vendor</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <SortTh id="amount" serverSort={expensesTable.sort} onSort={expensesTable.toggleSort} className="text-right">
                    Amount
                  </SortTh>
                  {canApprove && <Th />}
                </tr>
              </thead>
              <tbody>
                {(expenses.data?.data ?? []).map((e) => (
                  <tr key={e._id}>
                    <Td>
                      <div className="font-mono text-[12px] text-muted">{e.number}</div>
                      <div className="text-[12px] text-muted">{fmtDay(e.date)}</div>
                    </Td>
                    <Td>{typeLabel[e.type ?? ""] ?? (e.type ?? "—").replaceAll("_", " ")}</Td>
                    <Td>{e.categoryId?.name ?? catLabel[e.category] ?? e.category.replaceAll("_", " ")}</Td>
                    <Td>{e.vendor || "—"}</Td>
                    <Td>{methodLabel[e.method ?? ""] ?? e.method ?? "—"}</Td>
                    <Td>
                      <StatusBadge status={e.approvalStatus} />
                    </Td>
                    <Td mono className="text-right">
                      {inr(e.amount)}
                      {e.tax ? <div className="text-[11px] text-muted">tax {inr(e.tax)}</div> : null}
                    </Td>
                    {canApprove && (
                      <Td>
                        {e.approvalStatus === "pending" && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => decide.mutate({ id: e._id, status: "approved" })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: e._id, status: "rejected", notes: "Rejected from finance" })}>
                              Reject
                            </Button>
                          </div>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!expenses.data?.data?.length && <Empty title="No expenses" hint="Record rent, power, media purchases and other press costs." />}
            <TablePager
              page={expenses.data?.meta?.page ?? 1}
              pages={expenses.data?.meta?.pages ?? 1}
              total={expenses.data?.meta?.total ?? 0}
              onPage={expensesTable.setPage}
              pageSize={expensesTable.limit}
              onPageSize={expensesTable.setLimit}
              noun="expenses"
            />
          </Card>
        </>
      )}

      {tab === "receipts" && (
        <Card className="overflow-hidden">
          <div className="border-b border-line p-3">
            <TableSearch value={receiptsTable.search} onChange={receiptsTable.setSearch} placeholder="Search receipt number or method" />
          </div>
          <table className="app-table w-full">
            <thead>
              <tr>
                <SortTh id="number" serverSort={receiptsTable.sort} onSort={receiptsTable.toggleSort}>
                  Receipt
                </SortTh>
                <Th>Customer</Th>
                <Th>Method</Th>
                <SortTh id="paidAt" serverSort={receiptsTable.sort} onSort={receiptsTable.toggleSort}>
                  Date
                </SortTh>
                <SortTh id="amount" serverSort={receiptsTable.sort} onSort={receiptsTable.toggleSort} className="text-right">
                  Amount
                </SortTh>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(payments.data?.data ?? []).map((p) => (
                <tr key={p._id}>
                  <Td mono>{p.number}</Td>
                  <Td>{p.customerId?.name ?? "—"}</Td>
                  <Td>{methodLabel[p.method] ?? p.method}</Td>
                  <Td>{fmtDay(p.paidAt)}</Td>
                  <Td mono className="text-right">
                    {inr(p.amount)}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openPdf(`/finance/payments/${p._id}/receipt.pdf`).catch(() => toast.error("Could not open receipt"))}
                    >
                      PDF
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!payments.data?.data?.length && <Empty title="No receipts yet" hint="POS and order collections appear here." />}
          <TablePager
            page={payments.data?.meta?.page ?? 1}
            pages={payments.data?.meta?.pages ?? 1}
            total={payments.data?.meta?.total ?? 0}
            onPage={receiptsTable.setPage}
            pageSize={receiptsTable.limit}
            onPageSize={receiptsTable.setLimit}
            noun="receipts"
          />
        </Card>
      )}

      {tab === "types" && (
        <>
          {canMasters && (
            <div className="mb-3 flex justify-end">
              <Button onClick={() => setTypeModal({ open: true })}>New type</Button>
            </div>
          )}
          <Card className="overflow-hidden">
            <div className="border-b border-line p-3">
              <TableSearch value={typeTable.search} onChange={typeTable.setSearch} placeholder="Search types" />
            </div>
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" sortKey={typeTable.sortKey} sortDir={typeTable.sortDir} onSort={typeTable.toggleSort}>
                    Type
                  </SortTh>
                  <Th>Status</Th>
                  {canMasters && <Th />}
                </tr>
              </thead>
              <tbody>
                {typeTable.rows.map((row) => (
                  <tr key={row._id} className={canMasters ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canMasters && setTypeModal({ open: true, id: row._id })}>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      {row.description ? <div className="text-[12px] text-muted">{row.description}</div> : null}
                      {row.system ? <Badge>System</Badge> : null}
                    </Td>
                    <Td>
                      <StatusBadge status={row.active === false ? "off" : "active"} />
                    </Td>
                    {canMasters && (
                      <Td>
                        {!row.system && (
                          <button
                            type="button"
                            className="text-[12px] font-medium text-rose-600 hover:underline"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await api.delete(`/finance/expense-types/${row._id}`);
                                toast.success("Type removed");
                                refresh();
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
            <TablePager page={typeTable.page} pages={typeTable.pages} total={typeTable.total} onPage={typeTable.setPage} noun="types" />
          </Card>
        </>
      )}

      {tab === "categories" && (
        <>
          {canMasters && (
            <div className="mb-3 flex justify-end">
              <Button onClick={() => setCatModal({ open: true })}>New category</Button>
            </div>
          )}
          <Card className="overflow-hidden">
            <div className="border-b border-line p-3">
              <TableSearch value={catTable.search} onChange={catTable.setSearch} placeholder="Search categories" />
            </div>
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" sortKey={catTable.sortKey} sortDir={catTable.sortDir} onSort={catTable.toggleSort}>
                    Category
                  </SortTh>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  {canMasters && <Th />}
                </tr>
              </thead>
              <tbody>
                {catTable.rows.map((row) => (
                  <tr key={row._id} className={canMasters ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canMasters && setCatModal({ open: true, id: row._id })}>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      {row.description ? <div className="text-[12px] text-muted">{row.description}</div> : null}
                    </Td>
                    <Td>{typeLabel[row.type] ?? row.type.replaceAll("_", " ")}</Td>
                    <Td>
                      <StatusBadge status={row.active === false ? "off" : "active"} />
                    </Td>
                    {canMasters && (
                      <Td>
                        <button
                          type="button"
                          className="text-[12px] font-medium text-rose-600 hover:underline"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.delete(`/finance/expense-categories/${row._id}`);
                              toast.success("Category removed");
                              refresh();
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
            <TablePager page={catTable.page} pages={catTable.pages} total={catTable.total} onPage={catTable.setPage} noun="categories" />
          </Card>
        </>
      )}

      {tab === "methods" && (
        <>
          {canMasters && (
            <div className="mb-3 flex justify-end">
              <Button onClick={() => setMethodModal({ open: true })}>New method</Button>
            </div>
          )}
          <Card className="overflow-hidden">
            <div className="border-b border-line p-3">
              <TableSearch value={methodTable.search} onChange={methodTable.setSearch} placeholder="Search payment methods" />
            </div>
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" sortKey={methodTable.sortKey} sortDir={methodTable.sortDir} onSort={methodTable.toggleSort}>
                    Method
                  </SortTh>
                  <Th>Code</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  {canMasters && <Th />}
                </tr>
              </thead>
              <tbody>
                {methodTable.rows.map((row) => (
                  <tr key={row._id} className={canMasters ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canMasters && setMethodModal({ open: true, id: row._id })}>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      {row.system ? <Badge>System</Badge> : null}
                    </Td>
                    <Td mono>{row.code}</Td>
                    <Td className="capitalize">{row.type ?? "—"}</Td>
                    <Td>
                      <StatusBadge status={row.active === false ? "off" : "active"} />
                    </Td>
                    {canMasters && (
                      <Td>
                        {!row.system && (
                          <button
                            type="button"
                            className="text-[12px] font-medium text-rose-600 hover:underline"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await api.delete(`/finance/payment-methods/${row._id}`);
                                toast.success("Method removed");
                                refresh();
                              } catch (err) {
                                toast.error(errMsg(err, "Cannot delete method"));
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
            <p className="px-4 py-3 text-[12px] text-muted">These methods are also used at POS and on order collections.</p>
            <TablePager page={methodTable.page} pages={methodTable.pages} total={methodTable.total} onPage={methodTable.setPage} noun="methods" />
          </Card>
        </>
      )}

      {formOpen && (
        <ExpenseForm
          types={types.data ?? []}
          categories={categories.data ?? []}
          methods={(methods.data ?? []).filter((m) => m.active !== false)}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            refresh();
          }}
        />
      )}
      {typeModal.open && (
        <NameEditor
          title={typeModal.id ? "Edit type" : "New type"}
          name={types.data?.find((t) => t._id === typeModal.id)?.name ?? ""}
          description={types.data?.find((t) => t._id === typeModal.id)?.description ?? ""}
          onClose={() => setTypeModal({ open: false })}
          onSave={async (body) => {
            if (typeModal.id) await api.patch(`/finance/expense-types/${typeModal.id}`, body);
            else await api.post("/finance/expense-types", body);
            toast.success("Type saved");
            setTypeModal({ open: false });
            refresh();
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
            refresh();
          }}
        />
      )}
      {methodModal.open && (
        <MethodEditor
          id={methodModal.id}
          methods={methods.data ?? []}
          onClose={() => setMethodModal({ open: false })}
          onSaved={() => {
            setMethodModal({ open: false });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ExpenseForm({
  types,
  categories,
  methods,
  onClose,
  onSaved
}: {
  types: TypeRow[];
  categories: CatRow[];
  methods: MethodRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    type: types[0]?.slug ?? "operating",
    category: "",
    amount: 0,
    tax: 0,
    vendor: "",
    method: methods.find((m) => m.code === "cash")?.code ?? methods[0]?.code ?? "cash",
    date: new Date().toISOString().slice(0, 10),
    notes: ""
  });
  const cats = categories.filter((c) => c.type === form.type);
  const save = useMutation({
    mutationFn: async () =>
      api.post("/finance/expenses", {
        type: form.type,
        category: form.category,
        amount: Number(form.amount),
        tax: Number(form.tax) || undefined,
        vendor: form.vendor || undefined,
        method: form.method,
        date: form.date,
        notes: form.notes || undefined
      }),
    onSuccess: () => {
      toast.success("Expense recorded");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save expense"))
  });
  return (
    <Modal title="Record expense" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" required>
          <SearchableSelect
            value={form.type}
            onChange={(v) => setForm({ ...form, type: v, category: "" })}
            options={types.map((t) => ({ value: t.slug, label: t.name }))}
          />
        </Field>
        <Field label="Category" required>
          <SearchableSelect
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
            placeholder="Select category"
            options={cats.map((c) => ({ value: c.slug, label: c.name }))}
          />
        </Field>
        <Field label="Amount" required>
          <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
        </Field>
        <Field label="Tax">
          <Input type="number" value={form.tax} onChange={(e) => setForm({ ...form, tax: Number(e.target.value) })} />
        </Field>
        <Field label="Vendor">
          <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        </Field>
        <Field label="Paid by">
          <SearchableSelect
            value={form.method}
            onChange={(v) => setForm({ ...form, method: v })}
            options={methods.map((m) => ({ value: m.code, label: m.name }))}
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!form.category || !form.amount} onClick={() => save.mutate()}>
          Save expense
        </Button>
      </div>
    </Modal>
  );
}

function NameEditor({
  title,
  name,
  description,
  onClose,
  onSave
}: {
  title: string;
  name: string;
  description: string;
  onClose: () => void;
  onSave: (body: { name: string; description?: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ name, description });
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={form.name.length < 2}
            onClick={async () => {
              try {
                await onSave({ name: form.name, description: form.description || undefined });
              } catch (e) {
                toast.error(errMsg(e, "Could not save"));
              }
            }}
          >
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
    type: row?.type ?? types[0]?.slug ?? "operating",
    description: row?.description ?? ""
  });
  const save = useMutation({
    mutationFn: async () => (id ? api.patch(`/finance/expense-categories/${id}`, form) : api.post("/finance/expense-categories", form)),
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

function MethodEditor({
  id,
  methods,
  onClose,
  onSaved
}: {
  id?: string;
  methods: MethodRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = methods.find((m) => m._id === id);
  const [form, setForm] = useState({
    name: row?.name ?? "",
    code: row?.code ?? "",
    type: row?.type ?? "other",
    active: row?.active !== false
  });
  const save = useMutation({
    mutationFn: async () =>
      id ? api.patch(`/finance/payment-methods/${id}`, { name: form.name, type: form.type, active: form.active }) : api.post("/finance/payment-methods", form),
    onSuccess: () => {
      toast.success("Payment method saved");
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save method"))
  });
  return (
    <Modal title={id ? "Edit payment method" : "New payment method"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        {!id && (
          <Field label="Code" hint="Leave blank to generate from the name">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} />
          </Field>
        )}
        <Field label="Kind">
          <SearchableSelect
            value={form.type}
            onChange={(v) => setForm({ ...form, type: v })}
            options={["cash", "upi", "bank", "card", "cheque", "wallet", "credit", "other"].map((t) => ({ value: t, label: t }))}
          />
        </Field>
        {id && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active at POS and expenses
          </label>
        )}
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
