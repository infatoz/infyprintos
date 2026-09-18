import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Modal, Select, StatusBadge, Tabs, Td, Textarea, Th } from "@/components/ui";
import { SortTh, TablePager, useClientTable, useServerTable } from "@/components/data-table";
import { cn, initials } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can, modulesFromPermissions } from "@/lib/access";

type PermGroup = { id: string; label: string; permissions: string[] };
type ModuleRow = { id: string; label: string; path: string };
type RoleRow = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  system?: boolean;
  active?: boolean;
  memberCount?: number;
  permissionCount?: number;
  modules?: ModuleRow[];
};
type StaffRow = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  active?: boolean;
  lastLoginAt?: string;
  roleId?: RoleRow;
  permissionOverrides?: { grant?: string[]; revoke?: string[] };
  effectivePermissions?: string[];
  modules?: ModuleRow[];
};

function ModuleChips({ modules }: { modules?: ModuleRow[] }) {
  if (!modules?.length) return <span className="text-[12px] text-muted">No modules</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {modules.map((m) => (
        <Badge key={m.id}>{m.label}</Badge>
      ))}
    </span>
  );
}

function apiErr(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

function PermissionMatrix({
  groups,
  selected,
  onChange,
  locked,
  hideOwnerKey,
  labels
}: {
  groups: PermGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  locked?: boolean;
  hideOwnerKey?: boolean;
  labels?: Record<string, string>;
}) {
  const toggle = (perm: string) => {
    if (locked) return;
    const next = new Set(selected);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    onChange(next);
  };
  const toggleGroup = (group: PermGroup) => {
    if (locked) return;
    const perms = group.permissions.filter((p) => !(hideOwnerKey && p === "settings.owner"));
    const allOn = perms.every((p) => selected.has(p));
    const next = new Set(selected);
    for (const p of perms) {
      if (allOn) next.delete(p);
      else next.add(p);
    }
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {groups.map((group) => {
        const perms = group.permissions.filter((p) => !(hideOwnerKey && p === "settings.owner"));
        if (!perms.length) return null;
        const onCount = perms.filter((p) => selected.has(p)).length;
        return (
          <div key={group.id} className="rounded-lg border border-line">
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
              <div>
                <p className="text-[13px] font-semibold">{group.label}</p>
                <p className="text-[11px] text-muted">
                  {onCount} of {perms.length}
                </p>
              </div>
              <button
                type="button"
                disabled={locked}
                onClick={() => toggleGroup(group)}
                className="text-[12px] font-medium text-accent disabled:text-muted"
              >
                {onCount === perms.length ? "Clear" : "Select all"}
              </button>
            </div>
            <div className="grid gap-1 p-2 sm:grid-cols-2">
              {perms.map((perm) => (
                <label
                  key={perm}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px]",
                    locked ? "cursor-default text-muted" : "cursor-pointer hover:bg-paper"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has(perm)}
                    disabled={locked}
                    onChange={() => toggle(perm)}
                  />
                  <span>
                    <span className="block font-medium capitalize text-ink">
                      {labels?.[perm] ?? perm.split(".")[1]?.replaceAll("_", " ")}
                    </span>
                    <span className="font-mono text-[10px] text-muted">{perm}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AccessPanel() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const manageUsers = can(user, "users.manage");
  const manageRoles = can(user, "roles.manage");
  const isOwner = can(user, "settings.owner") || user?.role?.slug === "owner";
  const [pane, setPane] = useState("staff");
  const staffTable = useServerTable({ limit: 20, sort: "-createdAt" });
  const [roleFilter, setRoleFilter] = useState("");
  const [status, setStatus] = useState("");
  const [staffEditor, setStaffEditor] = useState<Partial<StaffRow> & { open: boolean; isNew?: boolean }>({ open: false });
  const [roleEditor, setRoleEditor] = useState<Partial<RoleRow> & { open: boolean; isNew?: boolean }>({ open: false });
  const [confirm, setConfirm] = useState<{ kind: "user" | "role"; id: string; name: string } | null>(null);
  const [staffForm, setStaffForm] = useState({
    name: "",
    email: "",
    phone: "",
    department: "",
    roleId: "",
    password: "",
    active: true,
    grant: [] as string[],
    revoke: [] as string[]
  });
  const [roleForm, setRoleForm] = useState({ name: "", description: "", permissions: [] as string[] });

  const catalog = useQuery({
    queryKey: ["permission-catalog"],
    enabled: can(user, ["users.view", "roles.manage"], "any"),
    queryFn: async () =>
      (await api.get("/users/permissions")).data.data as {
        permissions: string[];
        groups: PermGroup[];
        labels?: Record<string, string>;
        modules?: ModuleRow[];
      }
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/users/roles")).data.data as RoleRow[],
    enabled: can(user, ["users.view", "roles.manage"], "any")
  });
  const staff = useQuery({
    queryKey: ["users", staffTable.params, roleFilter, status],
    enabled: can(user, "users.view"),
    queryFn: async () =>
      (
        await api.get("/users", {
          params: { ...staffTable.params, roleId: roleFilter || undefined, status: status || undefined }
        })
      ).data as { data: StaffRow[]; meta?: { page: number; pages: number; total: number } }
  });

  const assignableRoles = useMemo(
    () => (roles.data ?? []).filter((r) => r.slug !== "customer" && (isOwner || r.slug !== "owner") && r.active !== false),
    [roles.data, isOwner]
  );
  const roleTable = useClientTable(roles.data, (r) => `${r.name} ${r.slug} ${r.description ?? ""}`);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["roles"] });
  };

  const saveStaff = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: staffForm.name,
        email: staffForm.email,
        phone: staffForm.phone || undefined,
        department: staffForm.department || undefined,
        roleId: staffForm.roleId,
        permissionOverrides: { grant: staffForm.grant, revoke: staffForm.revoke }
      };
      if (staffForm.password) payload.password = staffForm.password;
      if (!staffEditor.isNew) payload.active = staffForm.active;
      if (staffEditor.isNew) {
        return api.post("/users", payload);
      }
      return api.patch(`/users/${staffEditor._id}`, payload);
    },
    onSuccess: () => {
      toast.success(staffEditor.isNew ? "Staff member created" : "Staff member updated");
      setStaffEditor({ open: false });
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save staff"))
  });

  const saveRole = useMutation({
    mutationFn: async () => {
      const payload = { name: roleForm.name, description: roleForm.description, permissions: roleForm.permissions };
      if (roleEditor.isNew) return api.post("/users/roles", payload);
      return api.patch(`/users/roles/${roleEditor._id}`, payload);
    },
    onSuccess: () => {
      toast.success(roleEditor.isNew ? "Role created" : "Role updated");
      setRoleEditor({ open: false });
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Could not save role"))
  });

  const resetRole = useMutation({
    mutationFn: async (id: string) => api.post(`/users/roles/${id}/reset`),
    onSuccess: () => {
      toast.success("Role reset to defaults");
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Reset failed"))
  });

  const duplicateRole = useMutation({
    mutationFn: async (role: RoleRow) => api.post(`/users/roles/${role._id}/duplicate`, { name: `Copy of ${role.name}` }),
    onSuccess: () => {
      toast.success("Role duplicated");
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Duplicate failed"))
  });

  const destroy = useMutation({
    mutationFn: async () => {
      if (!confirm) return;
      if (confirm.kind === "user") return api.delete(`/users/${confirm.id}`);
      return api.delete(`/users/roles/${confirm.id}`);
    },
    onSuccess: () => {
      toast.success(confirm?.kind === "user" ? "Staff member removed" : "Role deleted");
      setConfirm(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErr(e, "Delete failed"))
  });

  const revokeSessions = useMutation({
    mutationFn: async (id: string) => api.post(`/users/${id}/revoke-sessions`),
    onSuccess: () => toast.success("Sessions revoked"),
    onError: (e: unknown) => toast.error(apiErr(e, "Could not revoke sessions"))
  });

  const openNewStaff = () => {
    setStaffForm({
      name: "",
      email: "",
      phone: "",
      department: "",
      roleId: assignableRoles.find((r) => r.slug === "viewer")?._id || assignableRoles[0]?._id || "",
      password: "",
      active: true,
      grant: [],
      revoke: []
    });
    setStaffEditor({ open: true, isNew: true });
  };

  const openEditStaff = (row: StaffRow) => {
    setStaffForm({
      name: row.name,
      email: row.email,
      phone: row.phone ?? "",
      department: row.department ?? "",
      roleId: row.roleId?._id ?? "",
      password: "",
      active: row.active !== false,
      grant: row.permissionOverrides?.grant ?? [],
      revoke: row.permissionOverrides?.revoke ?? []
    });
    setStaffEditor({ ...row, open: true, isNew: false });
  };

  const openNewRole = () => {
    setRoleForm({ name: "", description: "", permissions: [] });
    setRoleEditor({ open: true, isNew: true });
  };

  const openEditRole = (row: RoleRow) => {
    setRoleForm({ name: row.name, description: row.description ?? "", permissions: row.permissions ?? [] });
    setRoleEditor({ ...row, open: true, isNew: false });
  };

  const groups = catalog.data?.groups ?? [];
  const labels = catalog.data?.labels ?? {};
  const catalogPerms = catalog.data?.permissions ?? [];
  const selectedRolePerms = new Set(roleForm.permissions);
  const roleLocked = roleEditor.slug === "owner";
  const grantSet = new Set(staffForm.grant);
  const revokeSet = new Set(staffForm.revoke);
  const selectedRole = assignableRoles.find((r) => r._id === staffForm.roleId);
  const previewPerms = useMemo(() => {
    if (selectedRole?.slug === "owner") return catalogPerms;
    const next = new Set(selectedRole?.permissions ?? []);
    for (const p of staffForm.grant) next.add(p);
    for (const p of staffForm.revoke) next.delete(p);
    return [...next];
  }, [selectedRole, staffForm.grant, staffForm.revoke, catalogPerms]);
  const previewModules = modulesFromPermissions(previewPerms, selectedRole?.slug);

  return (
    <div>
      <Tabs
        tabs={[
          { id: "staff", label: "Staff" },
          { id: "roles", label: "Roles & permissions" }
        ]}
        value={pane}
        onChange={setPane}
      />

      {pane === "staff" && (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input placeholder="Search name or email" value={staffTable.search} onChange={(e) => staffTable.setSearch(e.target.value)} className="sm:max-w-xs" />
            <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="sm:max-w-[180px]">
              <option value="">All roles</option>
              {(roles.data ?? []).map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:max-w-[140px]">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <div className="sm:ml-auto">
              {manageUsers && (
                <Button size="sm" onClick={openNewStaff}>
                  New staff
                </Button>
              )}
            </div>
          </div>
          {staff.isError ? (
            <ErrorState title="Could not load staff" onRetry={() => staff.refetch()} />
          ) : (
            <Card className="overflow-hidden">
              <table className="app-table w-full">
                <thead>
                  <tr>
                    <SortTh id="name" serverSort={staffTable.sort} onSort={staffTable.toggleSort}>
                      Name
                    </SortTh>
                    <Th>Role</Th>
                    <Th>Modules</Th>
                    <Th>Status</Th>
                    <Th>Overrides</Th>
                    {manageUsers && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {(staff.data?.data ?? []).map((row) => {
                    const grants = row.permissionOverrides?.grant?.length ?? 0;
                    const revokes = row.permissionOverrides?.revoke?.length ?? 0;
                    return (
                      <tr key={row._id}>
                        <Td>
                          <span className="flex items-center gap-2.5">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-paper-2 text-[10px] font-semibold text-ink-2">
                              {initials(row.name)}
                            </span>
                            <span>
                              <span className="block font-medium">{row.name}</span>
                              <span className="block text-[12px] text-muted">{row.email}</span>
                            </span>
                          </span>
                        </Td>
                        <Td>{row.roleId?.name ?? "—"}</Td>
                        <Td>
                          <ModuleChips modules={row.modules ?? modulesFromPermissions(row.effectivePermissions ?? [], row.roleId?.slug)} />
                        </Td>
                        <Td>
                          <StatusBadge status={row.active === false ? "inactive" : "active"} />
                        </Td>
                        <Td>
                          {grants || revokes ? (
                            <span className="text-[12px] text-muted">
                              +{grants} / −{revokes}
                            </span>
                          ) : (
                            <span className="text-[12px] text-muted">Role default</span>
                          )}
                        </Td>
                        {manageUsers && (
                          <Td>
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openEditStaff(row)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => revokeSessions.mutate(row._id)}>
                                Sign out
                              </Button>
                              {row._id !== user?.id && (
                                <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "user", id: row._id, name: row.name })}>
                                  Remove
                                </Button>
                              )}
                            </div>
                          </Td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!(staff.data?.data ?? []).length && !staff.isLoading && (
                <Empty title="No staff visible" hint="Create a staff member and assign a role such as Order Manager or Viewer." />
              )}
              <TablePager
                page={staff.data?.meta?.page ?? 1}
                pages={staff.data?.meta?.pages ?? 1}
                total={staff.data?.meta?.total ?? 0}
                onPage={staffTable.setPage}
                pageSize={staffTable.limit}
                onPageSize={staffTable.setLimit}
                noun="staff"
              />
            </Card>
          )}
        </>
      )}

      {pane === "roles" && (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Input className="sm:max-w-xs" placeholder="Search roles" value={roleTable.search} onChange={(e) => roleTable.setSearch(e.target.value)} />
            {manageRoles && (
              <Button size="sm" onClick={openNewRole}>
                New role
              </Button>
            )}
          </div>
          {roles.isError ? (
            <ErrorState title="Could not load roles" onRetry={() => roles.refetch()} />
          ) : (
            <div className="grid gap-3">
              {roleTable.rows.map((role) => (
                <Card key={role._id} className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14px] font-semibold">{role.name}</h3>
                        {role.system && <Badge>System</Badge>}
                        {role.slug === "owner" && <Badge>Owner key</Badge>}
                        {role.active === false && <StatusBadge status="inactive" />}
                      </div>
                      <p className="mt-1 text-[13px] text-muted">{role.description || "No description"}</p>
                      <div className="mt-2">
                        <ModuleChips modules={role.modules ?? modulesFromPermissions(role.permissions ?? [], role.slug)} />
                      </div>
                      <p className="mt-2 font-mono text-[11px] text-muted">
                        {role.slug} · {role.permissionCount ?? role.permissions?.length ?? 0} permissions · {role.memberCount ?? 0} staff
                      </p>
                    </div>
                    {manageRoles && (
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="secondary" onClick={() => openEditRole(role)}>
                          Permissions
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => duplicateRole.mutate(role)}>
                          Duplicate
                        </Button>
                        {DEFAULT_SLUGS.has(role.slug) && (
                          <Button size="sm" variant="ghost" onClick={() => resetRole.mutate(role._id)}>
                            Reset
                          </Button>
                        )}
                        {!role.system && (
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "role", id: role._id, name: role.name })}>
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
              {!(roles.data ?? []).length && !roles.isLoading && <Empty title="No roles" />}
            </div>
          )}
        </>
      )}

      {staffEditor.open && (
        <Modal title={staffEditor.isNew ? "New staff member" : "Edit staff member"} onClose={() => setStaffEditor({ open: false })} wide>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} />
            </Field>
            <Field label="Department">
              <Input value={staffForm.department} onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={staffForm.roleId} onChange={(e) => setStaffForm({ ...staffForm, roleId: e.target.value, grant: [], revoke: [] })}>
                <option value="">Select role</option>
                {assignableRoles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={staffEditor.isNew ? "Password" : "New password"} hint={staffEditor.isNew ? "Minimum 8 characters." : "Leave blank to keep the current password."}>
              <Input type="password" autoComplete="new-password" value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} />
            </Field>
          </div>
          {selectedRole && (
            <div className="mt-4 rounded-lg border border-line bg-paper-2 p-3">
              <p className="text-[12px] font-semibold text-ink">This person will only see</p>
              <p className="mt-1 text-[12px] text-muted">{selectedRole.description || selectedRole.name}</p>
              <div className="mt-2">
                <ModuleChips modules={previewModules} />
              </div>
            </div>
          )}
          {!staffEditor.isNew && (
            <label className="mt-4 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={staffForm.active} onChange={(e) => setStaffForm({ ...staffForm, active: e.target.checked })} />
              Active account
            </label>
          )}
          {manageUsers && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-semibold">Grant extra permissions</p>
                <p className="mb-3 text-[12px] text-muted">Added on top of the selected role. Owner-only keys cannot be granted here.</p>
                <PermissionMatrix
                  groups={groups}
                  selected={grantSet}
                  hideOwnerKey
                  labels={labels}
                  onChange={(next) => setStaffForm({ ...staffForm, grant: [...next] })}
                />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold">Revoke from role</p>
                <p className="mb-3 text-[12px] text-muted">Removes a permission the role would otherwise include.</p>
                <PermissionMatrix
                  groups={groups}
                  selected={revokeSet}
                  hideOwnerKey
                  labels={labels}
                  onChange={(next) => setStaffForm({ ...staffForm, revoke: [...next] })}
                />
              </div>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStaffEditor({ open: false })}>
              Cancel
            </Button>
            <Button
              disabled={saveStaff.isPending || !staffForm.name || !staffForm.email || !staffForm.roleId || (staffEditor.isNew && staffForm.password.length < 8)}
              onClick={() => saveStaff.mutate()}
            >
              {saveStaff.isPending ? "Saving…" : "Save staff"}
            </Button>
          </div>
        </Modal>
      )}

      {roleEditor.open && (
        <Modal title={roleEditor.isNew ? "New role" : `${roleEditor.name} permissions`} onClose={() => setRoleEditor({ open: false })} wide>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={roleForm.name} disabled={roleLocked && !isOwner} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} />
            </Field>
            <Field label="Description">
              <Textarea value={roleForm.description} disabled={roleLocked && !isOwner} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} />
            </Field>
          </div>
          {roleLocked && (
            <p className="mb-4 rounded-lg bg-paper-2 px-3 py-2 text-[12px] text-muted">
              Owner always receives every permission. The matrix is locked so this role cannot be reduced.
            </p>
          )}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-semibold">
              {roleLocked ? catalogPerms.length : roleForm.permissions.length} of {catalogPerms.length} permissions
            </p>
            {!roleLocked && manageRoles && (
              <button
                type="button"
                className="text-[12px] font-medium text-accent"
                onClick={() =>
                  setRoleForm({
                    ...roleForm,
                    permissions: roleForm.permissions.length === catalogPerms.filter((p) => p !== "settings.owner").length
                      ? []
                      : catalogPerms.filter((p) => p !== "settings.owner")
                  })
                }
              >
                {roleForm.permissions.length ? "Clear all" : "Select operational"}
              </button>
            )}
          </div>
          <PermissionMatrix
            groups={groups}
            selected={roleLocked ? new Set(catalogPerms) : selectedRolePerms}
            locked={roleLocked || !manageRoles}
            hideOwnerKey={!roleLocked}
            labels={labels}
            onChange={(next) => setRoleForm({ ...roleForm, permissions: [...next] })}
          />
          {manageRoles && (!roleLocked || isOwner) && (
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRoleEditor({ open: false })}>
                Cancel
              </Button>
              <Button disabled={saveRole.isPending || !roleForm.name} onClick={() => saveRole.mutate()}>
                {saveRole.isPending ? "Saving…" : "Save role"}
              </Button>
            </div>
          )}
        </Modal>
      )}

      {confirm && (
        <Modal title={confirm.kind === "user" ? "Remove staff member" : "Delete role"} onClose={() => setConfirm(null)}>
          <p className="text-[13px] text-ink-2">
            {confirm.kind === "user"
              ? `${confirm.name} will be removed from this organisation and signed out of every session.`
              : `${confirm.name} will be deleted. Staff must be reassigned first.`}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={destroy.isPending} onClick={() => destroy.mutate()}>
              {destroy.isPending ? "Removing…" : "Confirm"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const DEFAULT_SLUGS = new Set(["owner", "administrator", "order_manager", "viewer", "production_manager", "designer", "inventory_manager", "accountant", "delivery_executive", "customer"]);
