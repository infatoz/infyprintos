import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { cn, fmtDate } from "@/lib/cn";
import { can } from "@/lib/access";
import { useAuth } from "@/stores/auth";
import { TablePager, useClientTable, TableSearch, SortTh, useServerTable } from "@/components/data-table";

type Material = { inventoryItemId?: string; name?: string; quantity?: number; unit?: string };
type EventRow = { at?: string; action?: string; fromStatus?: string; toStatus?: string; note?: string };
type Job = {
  _id: string;
  number: string;
  title?: string;
  status: string;
  priority: string;
  department?: string;
  notes?: string;
  qtyPlanned?: number;
  qtyCompleted?: number;
  qtyRejected?: number;
  wastage?: number;
  delayReason?: string;
  holdReason?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  materialsConsumed?: boolean;
  materials?: Material[];
  qualityNotes?: string;
  qualityCheck?: { passed?: boolean; notes?: string; checkedAt?: string };
  events?: EventRow[];
  orderId?: { number?: string; _id?: string; status?: string };
  machineId?: { name?: string; _id?: string; status?: string };
  assignedTo?: { name?: string; _id?: string };
};

type MachineRow = {
  _id: string;
  name: string;
  code: string;
  type?: string;
  department?: string;
  capacity?: string;
  costPerHour?: number;
  status: string;
  notes?: string;
};
type DeptRow = { _id: string; name: string; code: string; active?: boolean };
type StaffRow = { _id: string; name: string };

const TABS = ["floor", "machines", "departments"] as const;
const COLUMNS = [
  { id: "ready", label: "Ready", statuses: ["pending", "ready"] },
  { id: "in_production", label: "On press", statuses: ["in_production"] },
  { id: "quality_check", label: "QC", statuses: ["quality_check"] },
  { id: "delayed", label: "Delayed", statuses: ["delayed"] },
  { id: "on_hold", label: "Hold", statuses: ["on_hold"] },
  { id: "completed", label: "Done", statuses: ["completed", "rejected"] }
] as const;

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

function pct(done?: number, planned?: number) {
  if (!planned) return 0;
  return Math.min(100, Math.round(((done ?? 0) / planned) * 100));
}

function QtyBar({ done, planned }: { done?: number; planned?: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct(done, planned)}%` }} />
    </div>
  );
}

function priorityColor(p: string) {
  if (p === "urgent") return "#b91c1c";
  if (p === "high") return "#c2410c";
  if (p === "low") return "#64748b";
  return undefined;
}

export function ProductionPage() {
  const user = useAuth((s) => s.user);
  const canManage = can(user, "production.manage");
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("floor");
  const jobsTable = useServerTable({ limit: 50, sort: "-createdAt" });
  const [status, setStatus] = useState("");
  const [machineId, setMachineId] = useState("");
  const [department, setDepartment] = useState("");
  const [priority, setPriority] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assign, setAssign] = useState({ machineId: "", assignedTo: "", department: "", priority: "normal", scheduledStart: "", scheduledEnd: "", notes: "" });
  const [complete, setComplete] = useState({ qtyCompleted: 0, qtyRejected: 0, wastage: 0, qualityNotes: "" });
  const [progressQty, setProgressQty] = useState(0);
  const [holdReason, setHoldReason] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [qcPass, setQcPass] = useState(true);
  const [machineForm, setMachineForm] = useState({ name: "", code: "", type: "wide_format", department: "", capacity: "", costPerHour: 0 });
  const [deptForm, setDeptForm] = useState({ name: "", code: "" });

  const dash = useQuery({ queryKey: ["prod-dash"], queryFn: async () => (await api.get("/production/dashboard")).data.data });
  const jobs = useQuery({
    queryKey: ["jobs", jobsTable.params, status, machineId, department, priority, assignedTo],
    queryFn: async () =>
      (
        await api.get("/production/jobs", {
          params: {
            ...jobsTable.params,
            status: status || undefined,
            machineId: machineId || undefined,
            department: department || undefined,
            priority: priority || undefined,
            assignedTo: assignedTo || undefined
          }
        })
      ).data as { data: Job[]; meta?: { page: number; pages: number; total: number } }
  });
  const jobDetail = useQuery({
    queryKey: ["job", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await api.get(`/production/jobs/${selectedId}`)).data.data as Job
  });
  const machines = useQuery({ queryKey: ["machines"], queryFn: async () => (await api.get("/production/machines")).data.data as MachineRow[] });
  const departments = useQuery({ queryKey: ["depts"], queryFn: async () => (await api.get("/production/departments")).data.data as DeptRow[] });
  const staff = useQuery({ queryKey: ["prod-staff"], queryFn: async () => (await api.get("/production/staff")).data.data as StaffRow[] });
  const machineTypes = useQuery({
    queryKey: ["machine-types"],
    queryFn: async () => (await api.get("/production/machine-types")).data.data as { code: string; name: string }[]
  });

  const selected = jobDetail.data ?? jobs.data?.data?.find((j) => j._id === selectedId) ?? null;
  const counts = dash.data ?? {};
  const machineTable = useClientTable(machines.data, (m) => `${m.name} ${m.code} ${m.type ?? ""} ${m.department ?? ""}`);
  const deptTable = useClientTable(departments.data, (d) => `${d.name} ${d.code}`);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["job"] });
    qc.invalidateQueries({ queryKey: ["prod-dash"] });
    qc.invalidateQueries({ queryKey: ["machines"] });
    qc.invalidateQueries({ queryKey: ["depts"] });
  }

  function openJob(j: Job) {
    setSelectedId(j._id);
    setAssign({
      machineId: j.machineId?._id ?? "",
      assignedTo: j.assignedTo?._id ?? "",
      department: j.department ?? "",
      priority: j.priority ?? "normal",
      scheduledStart: j.scheduledStart ? j.scheduledStart.slice(0, 16) : "",
      scheduledEnd: j.scheduledEnd ? j.scheduledEnd.slice(0, 16) : "",
      notes: j.notes ?? ""
    });
    setComplete({
      qtyCompleted: j.qtyCompleted || j.qtyPlanned || 0,
      qtyRejected: j.qtyRejected ?? 0,
      wastage: j.wastage ?? 0,
      qualityNotes: j.qualityNotes ?? ""
    });
    setProgressQty(j.qtyCompleted ?? 0);
    setHoldReason("");
    setDelayReason("");
    setQcPass(true);
  }

  const patchJob = useMutation({
    mutationFn: async () =>
      api.patch(`/production/jobs/${selectedId}`, {
        machineId: assign.machineId || null,
        assignedTo: assign.assignedTo || null,
        department: assign.department || undefined,
        priority: assign.priority,
        scheduledStart: assign.scheduledStart || undefined,
        scheduledEnd: assign.scheduledEnd || undefined,
        notes: assign.notes
      }),
    onSuccess: () => {
      toast.success("Assignment saved");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Could not save assignment"))
  });
  const start = useMutation({
    mutationFn: async (id: string) => api.post(`/production/jobs/${id}/start`),
    onSuccess: () => {
      toast.success("Press started · materials issued");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Cannot start"))
  });
  const resume = useMutation({
    mutationFn: async (id: string) => api.post(`/production/jobs/${id}/resume`),
    onSuccess: () => {
      toast.success("Job resumed");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Cannot resume"))
  });
  const progress = useMutation({
    mutationFn: async () => api.post(`/production/jobs/${selectedId}/progress`, { qtyCompleted: Number(progressQty) }),
    onSuccess: () => {
      toast.success("Progress recorded");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Cannot update progress"))
  });
  const finish = useMutation({
    mutationFn: async () => api.post(`/production/jobs/${selectedId}/complete`, { ...complete, passed: complete.qtyRejected === 0 }),
    onSuccess: () => {
      toast.success("Job completed");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Cannot complete"))
  });
  const quality = useMutation({
    mutationFn: async (passed: boolean) => api.post(`/production/jobs/${selectedId}/quality`, { passed, notes: complete.qualityNotes }),
    onSuccess: (_res, passed) => {
      toast.success(passed ? "QC passed · waiting for close" : "QC failed · sent back to press");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "QC failed to save"))
  });
  const delay = useMutation({
    mutationFn: async () => api.post(`/production/jobs/${selectedId}/delay`, { reason: delayReason }),
    onSuccess: () => {
      toast.success("Job delayed");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Cannot delay"))
  });
  const hold = useMutation({
    mutationFn: async () => api.post(`/production/jobs/${selectedId}/hold`, { reason: holdReason }),
    onSuccess: () => {
      toast.success("Job on hold");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Cannot hold"))
  });
  const addMachine = useMutation({
    mutationFn: async () =>
      api.post("/production/machines", { ...machineForm, costPerHour: Number(machineForm.costPerHour) || 0 }),
    onSuccess: () => {
      toast.success("Machine added");
      setMachineForm({ name: "", code: "", type: "wide_format", department: "", capacity: "", costPerHour: 0 });
      qc.invalidateQueries({ queryKey: ["machines"] });
      qc.invalidateQueries({ queryKey: ["prod-dash"] });
    },
    onError: (e) => toast.error(errMsg(e, "Could not add machine"))
  });
  const patchMachine = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => api.patch(`/production/machines/${id}`, { status }),
    onSuccess: () => {
      toast.success("Machine updated");
      qc.invalidateQueries({ queryKey: ["machines"] });
      qc.invalidateQueries({ queryKey: ["prod-dash"] });
    },
    onError: (e) => toast.error(errMsg(e, "Could not update machine"))
  });
  const addDept = useMutation({
    mutationFn: async () => api.post("/production/departments", { ...deptForm, code: deptForm.code.toUpperCase() }),
    onSuccess: () => {
      toast.success("Department added");
      setDeptForm({ name: "", code: "" });
      qc.invalidateQueries({ queryKey: ["depts"] });
    },
    onError: (e) => toast.error(errMsg(e, "Could not add department"))
  });

  const machineOptions = useMemo(
    () =>
      (machines.data ?? []).map((m) => ({
        value: m._id,
        label: m.name,
        hint: `${m.code} · ${m.status}`,
        disabled: m.status === "offline" || m.status === "maintenance"
      })),
    [machines.data]
  );
  const deptOptions = useMemo(
    () => (departments.data ?? []).filter((d) => d.active !== false).map((d) => ({ value: d.name, label: d.name, hint: d.code })),
    [departments.data]
  );
  const staffOptions = useMemo(
    () => (staff.data ?? []).map((s) => ({ value: s._id, label: s.name })),
    [staff.data]
  );

  const st = selected?.status ?? "";
  const started = Boolean(selected?.actualStart || selected?.materialsConsumed);
  const closed = ["completed", "rejected"].includes(st);
  const canStart = canManage && ["pending", "ready"].includes(st);
  const canResume = canManage && ["delayed", "on_hold"].includes(st);
  const canHold = canManage && !closed && st !== "on_hold";
  const canDelay = canManage && !closed && st !== "delayed";
  const canQc = canManage && ["in_production", "quality_check", "delayed", "on_hold"].includes(st);
  const canComplete = canManage && started && ["in_production", "quality_check", "delayed", "on_hold"].includes(st);
  const canProgress = canManage && ["in_production", "quality_check", "delayed", "on_hold"].includes(st);

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="Reserve materials when an order is ready to print, issue stock when the press starts, then QC, rework or close the job."
      />
      <KpiRow className="lg:grid-cols-4 xl:grid-cols-8">
        {[
          { key: "ready", status: "ready", label: "Ready", tone: "default" as const },
          { key: "inProduction", status: "in_production", label: "On press", tone: "default" as const },
          { key: "qualityCheck", status: "quality_check", label: "QC", tone: "default" as const },
          { key: "delayed", status: "delayed", label: "Delayed", tone: "warn" as const },
          { key: "onHold", status: "on_hold", label: "On hold", tone: "danger" as const },
          { key: "overdue", status: "", label: "Overdue", tone: "warn" as const },
          { key: "completed", status: "completed", label: "Completed", tone: "default" as const },
          { key: "busyMachines", status: "", label: "Busy machines", tone: "default" as const }
        ].map((k) => (
          <button
            key={k.key}
            type="button"
            className={cn("text-left transition hover:bg-paper/80", status === k.status && k.status && "bg-paper")}
            onClick={() => {
              if (!k.status) return;
              setStatus((s) => (s === k.status ? "" : k.status));
              setTab("floor");
            }}
          >
            <Kpi label={k.label} value={String(counts[k.key] ?? 0)} tone={k.tone} />
          </button>
        ))}
      </KpiRow>

      {(dash.data?.delayedJobs ?? []).length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-semibold">Delayed / overdue</div>
          <ul className="mt-2 space-y-1">
            {(dash.data.delayedJobs as Job[]).map((j) => (
              <li key={j._id}>
                <button type="button" className="hover:underline" onClick={() => openJob(j)}>
                  {j.number} · {j.title} · {j.delayReason || "past scheduled end"}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs
        tabs={TABS.map((t) => ({
          id: t,
          label: t === "floor" ? "Shop floor" : t === "machines" ? "Machines" : "Departments"
        }))}
        value={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      />

      {tab === "floor" && (
        <>
          <FilterBar className="xl:grid-cols-6">
            <Input placeholder="Search job or order" value={jobsTable.search} onChange={(e) => jobsTable.setSearch(e.target.value)} />
            <SearchableSelect
              value={status}
              onChange={setStatus}
              emptyLabel="All statuses"
              options={[
                "pending",
                "ready",
                "in_production",
                "quality_check",
                "delayed",
                "on_hold",
                "completed",
                "rejected"
              ].map((s) => ({ value: s, label: s.replaceAll("_", " ") }))}
            />
            <SearchableSelect value={department} onChange={setDepartment} emptyLabel="All departments" options={deptOptions} />
            <SearchableSelect value={machineId} onChange={setMachineId} emptyLabel="All machines" options={machineOptions} />
            <SearchableSelect
              value={priority}
              onChange={setPriority}
              emptyLabel="All priorities"
              options={["low", "normal", "high", "urgent"].map((p) => ({ value: p, label: p }))}
            />
            <SearchableSelect value={assignedTo} onChange={setAssignedTo} emptyLabel="All operators" options={staffOptions} />
          </FilterBar>

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {COLUMNS.map((col) => {
              const cards = (jobs.data?.data ?? []).filter((j) => (col.statuses as readonly string[]).includes(j.status));
              return (
                <div key={col.id} className="min-w-0">
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{col.label}</h3>
                    <span className="font-mono text-[11px] text-muted">{cards.length}</span>
                  </div>
                  <div className="space-y-2">
                    {cards.map((j) => (
                      <button
                        key={j._id}
                        type="button"
                        onClick={() => openJob(j)}
                        className={cn(
                          "w-full rounded-xl border border-line bg-surface p-3 text-left shadow-[0_1px_2px_rgba(17,19,24,0.04)] transition hover:border-accent/40",
                          selectedId === j._id && "border-accent"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[12px] text-muted">{j.number}</div>
                            <div className="truncate text-[13px] font-semibold">{j.title ?? "Untitled job"}</div>
                          </div>
                          <Badge color={priorityColor(j.priority)}>{j.priority}</Badge>
                        </div>
                        <div className="mt-1 truncate text-[12px] text-muted">
                          {j.orderId?.number ?? "No order"} · {j.machineId?.name ?? "Unassigned"}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                          <span>
                            {j.qtyCompleted ?? 0}/{j.qtyPlanned ?? 0}
                            {j.materialsConsumed ? " · issued" : ""}
                          </span>
                          <StatusBadge status={j.status} />
                        </div>
                        <QtyBar done={j.qtyCompleted} planned={j.qtyPlanned} />
                      </button>
                    ))}
                    {!cards.length && <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-muted">None</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {!jobs.data?.data?.length && <Empty title="No production jobs" hint="Jobs appear when an order is marked ready to print." />}
          <TablePager
            page={jobs.data?.meta?.page ?? 1}
            pages={jobs.data?.meta?.pages ?? 1}
            total={jobs.data?.meta?.total ?? 0}
            onPage={jobsTable.setPage}
            pageSize={jobsTable.limit}
            onPageSize={jobsTable.setLimit}
            noun="jobs"
          />
        </>
      )}

      {tab === "machines" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="overflow-hidden xl:col-span-2">
            <div className="border-b border-line p-3">
              <TableSearch value={machineTable.search} onChange={machineTable.setSearch} placeholder="Search machines" />
            </div>
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" sortKey={machineTable.sortKey} sortDir={machineTable.sortDir} onSort={machineTable.toggleSort}>
                    Machine
                  </SortTh>
                  <Th>Type</Th>
                  <Th>Department</Th>
                  <Th>Status</Th>
                  {canManage && <Th />}
                </tr>
              </thead>
              <tbody>
                {machineTable.rows.map((m) => (
                  <tr key={m._id}>
                    <Td>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-[12px] text-muted">
                        {m.code}
                        {m.capacity ? ` · ${m.capacity}` : ""}
                      </div>
                    </Td>
                    <Td className="capitalize">{(m.type ?? "—").replaceAll("_", " ")}</Td>
                    <Td>{m.department || "—"}</Td>
                    <Td>
                      <StatusBadge status={m.status} />
                    </Td>
                    {canManage && (
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {m.status !== "available" && (
                            <Button size="sm" variant="secondary" onClick={() => patchMachine.mutate({ id: m._id, status: "available" })}>
                              Available
                            </Button>
                          )}
                          {m.status !== "maintenance" && (
                            <Button size="sm" variant="ghost" onClick={() => patchMachine.mutate({ id: m._id, status: "maintenance" })}>
                              Maintenance
                            </Button>
                          )}
                          {m.status !== "offline" && (
                            <Button size="sm" variant="ghost" onClick={() => patchMachine.mutate({ id: m._id, status: "offline" })}>
                              Offline
                            </Button>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!machines.data?.length && <Empty title="No machines" hint="Add the presses and finishers on this floor." />}
            <TablePager page={machineTable.page} pages={machineTable.pages} total={machineTable.total} onPage={machineTable.setPage} noun="machines" />
          </Card>
          {canManage && (
            <Card className="p-5">
              <h3 className="mb-3 text-[15px] font-semibold">Add machine</h3>
              <div className="space-y-2">
                <Field label="Name" required>
                  <Input value={machineForm.name} onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })} />
                </Field>
                <Field label="Code" required>
                  <Input value={machineForm.code} onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="Type">
                  <SearchableSelect
                    value={machineForm.type}
                    onChange={(v) => setMachineForm({ ...machineForm, type: v })}
                    options={(machineTypes.data ?? []).map((t) => ({ value: t.code, label: t.name }))}
                  />
                </Field>
                <Field label="Department">
                  <SearchableSelect
                    value={machineForm.department}
                    onChange={(v) => setMachineForm({ ...machineForm, department: v })}
                    emptyLabel="None"
                    options={deptOptions}
                  />
                </Field>
                <Field label="Capacity">
                  <Input value={machineForm.capacity} onChange={(e) => setMachineForm({ ...machineForm, capacity: e.target.value })} />
                </Field>
                <Field label="Cost / hour">
                  <Input
                    type="number"
                    value={machineForm.costPerHour}
                    onChange={(e) => setMachineForm({ ...machineForm, costPerHour: Number(e.target.value) })}
                  />
                </Field>
                <Button className="w-full" disabled={!machineForm.name || !machineForm.code} onClick={() => addMachine.mutate()}>
                  Save machine
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "departments" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <div className="border-b border-line p-3">
              <TableSearch value={deptTable.search} onChange={deptTable.setSearch} placeholder="Search departments" />
            </div>
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" sortKey={deptTable.sortKey} sortDir={deptTable.sortDir} onSort={deptTable.toggleSort}>
                    Department
                  </SortTh>
                  <Th>Code</Th>
                </tr>
              </thead>
              <tbody>
                {deptTable.rows.map((d) => (
                  <tr key={d._id}>
                    <Td>{d.name}</Td>
                    <Td mono>{d.code}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!departments.data?.length && <Empty title="No departments" hint="Typical print shops split prepress, press and finishing." />}
            <TablePager page={deptTable.page} pages={deptTable.pages} total={deptTable.total} onPage={deptTable.setPage} noun="departments" />
          </Card>
          {canManage && (
            <Card className="p-5">
              <h3 className="mb-3 text-[15px] font-semibold">Add department</h3>
              <div className="space-y-2">
                <Field label="Name" required>
                  <Input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} />
                </Field>
                <Field label="Code" required>
                  <Input value={deptForm.code} onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })} />
                </Field>
                <Button className="w-full" disabled={deptForm.name.length < 2 || deptForm.code.length < 2} onClick={() => addDept.mutate()}>
                  Save department
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {selected && (
        <Modal title={`${selected.number} · ${selected.title ?? "Job"}`} onClose={() => setSelectedId(null)} wide>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.status} />
                <Badge color={priorityColor(selected.priority)}>{selected.priority}</Badge>
                {selected.orderId?._id ? (
                  <Link className="text-[13px] font-medium text-accent hover:underline" to={`/orders/${selected.orderId._id}`}>
                    Order {selected.orderId.number}
                  </Link>
                ) : (
                  <span className="text-[13px] text-muted">No order link</span>
                )}
                {selected.orderId?.status && <StatusBadge status={selected.orderId.status} />}
              </div>
              <p className="text-[13px] text-muted">
                {selected.actualStart ? `Started ${fmtDate(selected.actualStart)}` : "Not started"}
                {selected.actualEnd ? ` · closed ${fmtDate(selected.actualEnd)}` : ""}
                {selected.materialsConsumed ? " · materials issued from reserved stock" : " · materials still reserved"}
              </p>
              {(selected.holdReason || selected.delayReason) && (
                <Card className="border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-950">
                  {selected.holdReason ? `Hold: ${selected.holdReason}` : `Delay: ${selected.delayReason}`}
                </Card>
              )}
              <div>
                <div className="mb-1 flex justify-between text-[12px] text-muted">
                  <span>Quantity</span>
                  <span className="font-mono">
                    {selected.qtyCompleted ?? 0} / {selected.qtyPlanned ?? 0}
                    {selected.qtyRejected ? ` · reject ${selected.qtyRejected}` : ""}
                  </span>
                </div>
                <QtyBar done={selected.qtyCompleted} planned={selected.qtyPlanned} />
              </div>
              {(selected.materials ?? []).length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Bill of materials</h4>
                  <Card className="overflow-hidden">
                    <table className="app-table w-full">
                      <thead>
                        <tr>
                          <Th>Item</Th>
                          <Th className="text-right">Qty</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected.materials ?? []).map((m, i) => (
                          <tr key={m.inventoryItemId ?? String(i)}>
                            <Td>{m.name ?? "Material"}</Td>
                            <Td mono className="text-right">
                              {m.quantity ?? 0} {m.unit ?? ""}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </div>
              )}
              {(selected.events ?? []).length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Floor log</h4>
                  <ul className="space-y-1.5 text-[13px]">
                    {[...(selected.events ?? [])].slice(-8).reverse().map((ev, i) => (
                      <li key={`${ev.at}-${i}`} className="flex justify-between gap-3 text-muted">
                        <span>
                          {(ev.action ?? "").replaceAll("_", " ")}
                          {ev.toStatus ? ` → ${ev.toStatus.replaceAll("_", " ")}` : ""}
                          {ev.note ? ` · ${ev.note}` : ""}
                        </span>
                        <span className="shrink-0 font-mono text-[11px]">{ev.at ? fmtDate(ev.at) : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {canManage && !closed && (
              <div className="space-y-3 lg:col-span-2">
                <Field label="Department">
                  <SearchableSelect value={assign.department} onChange={(v) => setAssign({ ...assign, department: v })} emptyLabel="None" options={deptOptions} />
                </Field>
                <Field label="Machine">
                  <SearchableSelect value={assign.machineId} onChange={(v) => setAssign({ ...assign, machineId: v })} emptyLabel="Unassigned" options={machineOptions} />
                </Field>
                <Field label="Operator">
                  <SearchableSelect value={assign.assignedTo} onChange={(v) => setAssign({ ...assign, assignedTo: v })} emptyLabel="Unassigned" options={staffOptions} />
                </Field>
                <Field label="Priority">
                  <SearchableSelect
                    value={assign.priority}
                    onChange={(v) => setAssign({ ...assign, priority: v })}
                    options={["low", "normal", "high", "urgent"].map((p) => ({ value: p, label: p }))}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Scheduled start">
                    <Input type="datetime-local" value={assign.scheduledStart} onChange={(e) => setAssign({ ...assign, scheduledStart: e.target.value })} />
                  </Field>
                  <Field label="Scheduled end">
                    <Input type="datetime-local" value={assign.scheduledEnd} onChange={(e) => setAssign({ ...assign, scheduledEnd: e.target.value })} />
                  </Field>
                </div>
                <Field label="Notes">
                  <Textarea rows={2} value={assign.notes} onChange={(e) => setAssign({ ...assign, notes: e.target.value })} />
                </Field>
                <Button className="w-full" variant="secondary" onClick={() => patchJob.mutate()} disabled={patchJob.isPending}>
                  Save assignment
                </Button>
                {canStart && (
                  <Button className="w-full" onClick={() => start.mutate(selected._id)} disabled={start.isPending}>
                    Start & issue materials
                  </Button>
                )}
                {canResume && (
                  <Button className="w-full" onClick={() => resume.mutate(selected._id)} disabled={resume.isPending}>
                    Resume
                  </Button>
                )}
                {canProgress && (
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input type="number" min={0} value={progressQty} onChange={(e) => setProgressQty(Number(e.target.value))} />
                    <Button variant="secondary" onClick={() => progress.mutate()}>
                      Progress
                    </Button>
                  </div>
                )}
                {canQc && (
                  <Card className="space-y-2 p-3">
                    <Field label="QC notes" hint={!qcPass ? "Required when sending back for rework" : undefined}>
                      <Input value={complete.qualityNotes} onChange={(e) => setComplete({ ...complete, qualityNotes: e.target.value })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant={qcPass ? "primary" : "secondary"}
                        onClick={() => {
                          setQcPass(true);
                          quality.mutate(true);
                        }}
                      >
                        QC pass
                      </Button>
                      <Button
                        variant={!qcPass ? "danger" : "ghost"}
                        onClick={() => {
                          setQcPass(false);
                          quality.mutate(false);
                        }}
                      >
                        Rework
                      </Button>
                    </div>
                  </Card>
                )}
                {canComplete && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Good">
                        <Input type="number" value={complete.qtyCompleted} onChange={(e) => setComplete({ ...complete, qtyCompleted: Number(e.target.value) })} />
                      </Field>
                      <Field label="Reject">
                        <Input type="number" value={complete.qtyRejected} onChange={(e) => setComplete({ ...complete, qtyRejected: Number(e.target.value) })} />
                      </Field>
                      <Field label="Waste">
                        <Input type="number" value={complete.wastage} onChange={(e) => setComplete({ ...complete, wastage: Number(e.target.value) })} />
                      </Field>
                    </div>
                    <Button className="w-full" onClick={() => finish.mutate()} disabled={finish.isPending}>
                      Complete job
                    </Button>
                  </>
                )}
                {canHold && (
                  <>
                    <Input placeholder="Hold reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
                    <Button className="w-full" variant="ghost" disabled={holdReason.length < 3} onClick={() => hold.mutate()}>
                      Put on hold
                    </Button>
                  </>
                )}
                {canDelay && (
                  <>
                    <Input placeholder="Delay reason" value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
                    <Button className="w-full" variant="ghost" disabled={delayReason.length < 3} onClick={() => delay.mutate()}>
                      Mark delayed
                    </Button>
                  </>
                )}
              </div>
            )}
            {closed && (
              <p className="text-[13px] text-muted lg:col-span-2">This job is closed. Open the linked order to continue dispatch.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
