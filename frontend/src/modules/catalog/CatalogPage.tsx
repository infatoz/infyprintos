import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, SearchableSelect, StatusBadge, Tabs, Td, Textarea, Th } from "@/components/ui";
import { SortTh, TablePager, TableSearch, useClientTable, useServerTable } from "@/components/data-table";
import { inr } from "@/lib/cn";
import { can } from "@/lib/access";
import { useAuth } from "@/stores/auth";
import { CatalogItemEditor } from "./CatalogItemEditor";
import { CatalogImagePicker, CatalogThumb } from "./CatalogMedia";

type CatalogRow = {
  _id: string;
  name: string;
  sku: string;
  itemType?: string;
  unit?: string;
  salesPrice: number;
  requiresDesign?: boolean;
  active?: boolean;
  imageUrl?: string;
  variants?: Array<{ _id: string; name: string }>;
  categoryId?: { name?: string } | string;
};

type CategoryRow = {
  _id: string;
  name: string;
  slug: string;
  type?: string;
  description?: string;
  imageUrl?: string;
  parentId?: string;
  sortOrder?: number;
  active?: boolean;
};

type TypeRow = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  defaultUnit?: string;
  requiresDesign?: boolean;
  trackInventory?: boolean;
  sortOrder?: number;
  system?: boolean;
  active?: boolean;
};

type ConfirmState = { kind: "item" | "category" | "type"; id: string; name: string } | null;

export function CatalogPage() {
  const user = useAuth((s) => s.user);
  const canWrite = can(user, ["catalog.create"], "any") || can(user, "catalog.update");
  const canDelete = can(user, "catalog.delete");
  const [tab, setTab] = useState("items");
  const itemsTable = useServerTable({ limit: 20, sort: "name" });
  const [categoryId, setCategoryId] = useState("");
  const [itemType, setItemType] = useState("");
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [categoryForm, setCategoryForm] = useState<{ open: boolean; id?: string }>({ open: false });
  const [typeForm, setTypeForm] = useState<{ open: boolean; id?: string }>({ open: false });
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const items = useQuery({
    queryKey: ["items", itemsTable.params, categoryId, itemType],
    queryFn: async () =>
      (
        await api.get("/catalog/items", {
          params: { ...itemsTable.params, categoryId: categoryId || undefined, itemType: itemType || undefined }
        })
      ).data
  });
  const cats = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/catalog/categories")).data.data as CategoryRow[] });
  const types = useQuery({ queryKey: ["catalog-types"], queryFn: async () => (await api.get("/catalog/types")).data.data as TypeRow[] });
  const rows: CatalogRow[] = items.data?.data ?? [];
  const typeLabel = useMemo(() => Object.fromEntries((types.data ?? []).map((t) => [t.slug, t.name])), [types.data]);

  return (
    <div>
      <PageHeader
        title="Catalog"
        subtitle="Items, categories and types. POS and billing always re-price on the server from this catalog."
        actions={
          tab === "items" && can(user, "catalog.create") ? (
            <Button onClick={() => setEditor({ open: true })}>New item</Button>
          ) : tab === "categories" && canDelete ? (
            <Button onClick={() => setCategoryForm({ open: true })}>New category</Button>
          ) : tab === "types" && canDelete ? (
            <Button onClick={() => setTypeForm({ open: true })}>New type</Button>
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "items", label: "Items" },
          { id: "categories", label: "Categories" },
          { id: "types", label: "Types" }
        ]}
      />

      {tab === "items" && (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input placeholder="Search name, SKU, barcode" value={itemsTable.search} onChange={(e) => itemsTable.setSearch(e.target.value)} />
            <SearchableSelect
              value={categoryId}
              onChange={setCategoryId}
              emptyLabel="All categories"
              options={(cats.data ?? []).map((c) => ({ value: c._id, label: c.name }))}
            />
            <SearchableSelect
              value={itemType}
              onChange={setItemType}
              emptyLabel="All types"
              options={(types.data ?? []).map((t) => ({ value: t.slug, label: t.name }))}
            />
          </div>
          <Card className="overflow-hidden">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <SortTh id="name" serverSort={itemsTable.sort} onSort={itemsTable.toggleSort}>
                    Item
                  </SortTh>
                  <SortTh id="sku" serverSort={itemsTable.sort} onSort={itemsTable.toggleSort}>
                    SKU
                  </SortTh>
                  <Th>Category</Th>
                  <Th>Type</Th>
                  <Th>Variants</Th>
                  <SortTh id="salesPrice" serverSort={itemsTable.sort} onSort={itemsTable.toggleSort} className="text-right">
                    List price
                  </SortTh>
                  <Th>Design</Th>
                  {canDelete ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item._id}
                    className={canWrite ? "cursor-pointer hover:bg-paper/80" : "hover:bg-paper/80"}
                    onClick={() => can(user, "catalog.update") && setEditor({ open: true, id: item._id })}
                  >
                    <Td>
                      <div className="flex items-center gap-3">
                        <CatalogThumb src={item.imageUrl} size="sm" />
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </Td>
                    <Td mono>{item.sku}</Td>
                    <Td>{typeof item.categoryId === "object" ? item.categoryId?.name ?? "—" : "—"}</Td>
                    <Td>{typeLabel[item.itemType ?? ""] ?? (item.itemType ?? "—").replaceAll("_", " ")}</Td>
                    <Td>{item.variants?.length ? item.variants.length : "—"}</Td>
                    <Td mono className="text-right">
                      {inr(item.salesPrice)}
                    </Td>
                    <Td>{item.requiresDesign ? <Badge color="#5b4b8a">Required</Badge> : <StatusBadge status="off" />}</Td>
                    {canDelete ? (
                      <Td>
                        <button
                          type="button"
                          className="text-[12px] font-medium text-rose-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirm({ kind: "item", id: item._id, name: item.name });
                          }}
                        >
                          Delete
                        </button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty title="Catalog is empty" hint="Add a visiting card, banner or service SKU to start quoting." />}
            <TablePager
              page={items.data?.meta?.page ?? 1}
              pages={items.data?.meta?.pages ?? 1}
              total={items.data?.meta?.total ?? 0}
              onPage={itemsTable.setPage}
              pageSize={itemsTable.limit}
              onPageSize={itemsTable.setLimit}
              noun="items"
            />
          </Card>
        </>
      )}

      {tab === "categories" && (
        <CategoryTable
          rows={cats.data ?? []}
          types={types.data ?? []}
          canDelete={canDelete}
          onEdit={(id) => setCategoryForm({ open: true, id })}
          onDelete={(row) => setConfirm({ kind: "category", id: row._id, name: row.name })}
        />
      )}

      {tab === "types" && (
        <TypeTable
          rows={types.data ?? []}
          canDelete={canDelete}
          onEdit={(id) => setTypeForm({ open: true, id })}
          onDelete={(row) => setConfirm({ kind: "type", id: row._id, name: row.name })}
        />
      )}

      {editor.open && (
        <Modal title={editor.id ? "Edit catalog item" : "New catalog item"} onClose={() => setEditor({ open: false })} wide>
          <CatalogItemEditor itemId={editor.id} onCancel={() => setEditor({ open: false })} onSaved={() => setEditor({ open: false })} />
        </Modal>
      )}
      {categoryForm.open && (
        <Modal title={categoryForm.id ? "Edit category" : "New category"} onClose={() => setCategoryForm({ open: false })}>
          <CategoryEditor id={categoryForm.id} categories={cats.data ?? []} types={types.data ?? []} onCancel={() => setCategoryForm({ open: false })} />
        </Modal>
      )}
      {typeForm.open && (
        <Modal title={typeForm.id ? "Edit type" : "New type"} onClose={() => setTypeForm({ open: false })}>
          <TypeEditor id={typeForm.id} types={types.data ?? []} onCancel={() => setTypeForm({ open: false })} />
        </Modal>
      )}
      {confirm && <ConfirmDelete state={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function CategoryTable({
  rows,
  types,
  canDelete,
  onEdit,
  onDelete
}: {
  rows: CategoryRow[];
  types: TypeRow[];
  canDelete: boolean;
  onEdit: (id: string) => void;
  onDelete: (row: CategoryRow) => void;
}) {
  const typeLabel = Object.fromEntries(types.map((t) => [t.slug, t.name]));
  const table = useClientTable(rows, (r) => `${r.name} ${r.slug} ${r.type ?? ""} ${r.description ?? ""}`);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-3">
        <TableSearch value={table.search} onChange={table.setSearch} placeholder="Search categories" />
      </div>
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Category
            </SortTh>
            <Th>Type</Th>
            <Th>Slug</Th>
            <Th>Status</Th>
            {canDelete ? <Th /> : null}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id} className={canDelete ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canDelete && onEdit(row._id)}>
              <Td>
                <div className="flex items-center gap-3">
                  <CatalogThumb src={row.imageUrl} size="sm" />
                  <div>
                    <div className="font-medium">{row.name}</div>
                    {row.description ? <div className="text-[12px] text-muted">{row.description}</div> : null}
                  </div>
                </div>
              </Td>
              <Td>{typeLabel[row.type ?? ""] ?? (row.type ?? "—").replaceAll("_", " ")}</Td>
              <Td mono>{row.slug}</Td>
              <Td>
                <StatusBadge status={row.active === false ? "off" : "active"} />
              </Td>
              {canDelete ? (
                <Td>
                  <button
                    type="button"
                    className="text-[12px] font-medium text-rose-600 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(row);
                    }}
                  >
                    Delete
                  </button>
                </Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty title="No categories" hint="Owner and admin can create categories used by items and POS filters." />}
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} noun="categories" />
    </Card>
  );
}

function TypeTable({
  rows,
  canDelete,
  onEdit,
  onDelete
}: {
  rows: TypeRow[];
  canDelete: boolean;
  onEdit: (id: string) => void;
  onDelete: (row: TypeRow) => void;
}) {
  const table = useClientTable(rows, (r) => `${r.name} ${r.slug} ${r.description ?? ""} ${r.defaultUnit ?? ""}`);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-3">
        <TableSearch value={table.search} onChange={table.setSearch} placeholder="Search types" />
      </div>
      <table className="app-table w-full">
        <thead>
          <tr>
            <SortTh id="name" sortKey={table.sortKey} sortDir={table.sortDir} onSort={table.toggleSort}>
              Type
            </SortTh>
            <Th>Default unit</Th>
            <Th>Design</Th>
            <Th>Inventory</Th>
            <Th>Status</Th>
            {canDelete ? <Th /> : null}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row._id} className={canDelete ? "cursor-pointer hover:bg-paper/80" : ""} onClick={() => canDelete && onEdit(row._id)}>
              <Td>
                <div className="font-medium">{row.name}</div>
                {row.description ? <div className="text-[12px] text-muted">{row.description}</div> : null}
                {row.system ? <Badge>System</Badge> : null}
              </Td>
              <Td className="uppercase">{row.defaultUnit ?? "pcs"}</Td>
              <Td>{row.requiresDesign ? "Yes" : "—"}</Td>
              <Td>{row.trackInventory ? "Tracked" : "—"}</Td>
              <Td>
                <StatusBadge status={row.active === false ? "off" : "active"} />
              </Td>
              {canDelete ? (
                <Td>
                  {row.system ? (
                    <span className="text-[12px] text-muted">Locked</span>
                  ) : (
                    <button
                      type="button"
                      className="text-[12px] font-medium text-rose-600 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(row);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty title="No types" hint="Default print, product and service types are created automatically." />}
      <TablePager page={table.page} pages={table.pages} total={table.total} onPage={table.setPage} noun="types" />
    </Card>
  );
}

function CategoryEditor({
  id,
  categories,
  types,
  onCancel
}: {
  id?: string;
  categories: CategoryRow[];
  types: TypeRow[];
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const existing = categories.find((c) => c._id === id);
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState(existing?.type || types[0]?.slug || "product");
  const [parentId, setParentId] = useState(existing?.parentId ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? 0);
  const [active, setActive] = useState(existing?.active !== false);
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [error, setError] = useState("");
  const preview = removeImage ? undefined : imageFile ? URL.createObjectURL(imageFile) : imageUrl;

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) {
        setError("Name is required");
        throw new Error("Name is required");
      }
      if (!type) {
        setError("Type is required");
        throw new Error("Type is required");
      }
      setError("");
      const payload = { name: name.trim(), type, parentId: parentId || undefined, description: description.trim() || undefined, sortOrder, active };
      const res = id ? await api.patch(`/catalog/categories/${id}`, payload) : await api.post("/catalog/categories", payload);
      const saved = res.data.data as CategoryRow;
      if (imageFile) {
        const fd = new FormData();
        fd.append("file", imageFile);
        await api.post(`/catalog/categories/${saved._id}/image`, fd);
      } else if (removeImage && id) {
        await api.delete(`/catalog/categories/${saved._id}/image`);
      }
      return saved;
    },
    onSuccess: () => {
      toast.success(id ? "Category updated" : "Category created");
      qc.invalidateQueries({ queryKey: ["cats"] });
      qc.invalidateQueries({ queryKey: ["pos-cats"] });
      onCancel();
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message || (e as Error).message);
    }
  });

  return (
    <div className="space-y-3">
      <CatalogImagePicker
        label="Category image"
        src={preview}
        onFile={(file) => {
          setImageFile(file);
          setRemoveImage(false);
        }}
        onClear={() => {
          setImageFile(null);
          setRemoveImage(true);
        }}
      />
      <Field label="Name" required error={error && name.trim().length < 2 ? error : undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Type" required>
        <SearchableSelect value={type} onChange={setType} options={types.map((t) => ({ value: t.slug, label: t.name }))} placeholder="Select type" />
      </Field>
      <Field label="Parent category">
        <SearchableSelect
          value={parentId}
          onChange={setParentId}
          emptyLabel="None"
          options={categories.filter((c) => c._id !== id).map((c) => ({ value: c._id, label: c.name }))}
        />
      </Field>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Sort order">
        <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
      </Field>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : id ? "Save category" : "Create category"}
        </Button>
      </div>
    </div>
  );
}

function TypeEditor({ id, types, onCancel }: { id?: string; types: TypeRow[]; onCancel: () => void }) {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ["catalog-units"], queryFn: async () => (await api.get("/catalog/units")).data.data as Array<{ code: string; name: string }> });
  const existing = types.find((t) => t._id === id);
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [defaultUnit, setDefaultUnit] = useState(existing?.defaultUnit ?? "pcs");
  const [requiresDesign, setRequiresDesign] = useState(Boolean(existing?.requiresDesign));
  const [trackInventory, setTrackInventory] = useState(Boolean(existing?.trackInventory));
  const [active, setActive] = useState(existing?.active !== false);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) {
        setError("Name is required");
        throw new Error("Name is required");
      }
      setError("");
      const payload = { name: name.trim(), description: description.trim() || undefined, defaultUnit, requiresDesign, trackInventory, active };
      const res = id ? await api.patch(`/catalog/types/${id}`, payload) : await api.post("/catalog/types", payload);
      return res.data.data;
    },
    onSuccess: () => {
      toast.success(id ? "Type updated" : "Type created");
      qc.invalidateQueries({ queryKey: ["catalog-types"] });
      onCancel();
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message || (e as Error).message);
    }
  });

  return (
    <div className="space-y-3">
      <Field label="Name" required error={error}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Finishing" />
      </Field>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Default unit">
        <SearchableSelect value={defaultUnit} onChange={setDefaultUnit} options={(units.data ?? []).map((u) => ({ value: u.code, label: u.name }))} />
      </Field>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={requiresDesign} onChange={(e) => setRequiresDesign(e.target.checked)} /> Design required by default
      </label>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} /> Track inventory by default
      </label>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : id ? "Save type" : "Create type"}
        </Button>
      </div>
    </div>
  );
}

function ConfirmDelete({ state, onClose }: { state: NonNullable<ConfirmState>; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      if (state.kind === "item") await api.delete(`/catalog/items/${state.id}`);
      if (state.kind === "category") await api.delete(`/catalog/categories/${state.id}`);
      if (state.kind === "type") await api.delete(`/catalog/types/${state.id}`);
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["pos-items"] });
      qc.invalidateQueries({ queryKey: ["cats"] });
      qc.invalidateQueries({ queryKey: ["pos-cats"] });
      qc.invalidateQueries({ queryKey: ["catalog-types"] });
      onClose();
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not delete");
    }
  });
  return (
    <Modal title={`Delete ${state.kind}`} onClose={onClose}>
      <p className="text-[13px] text-ink-2">
        Delete <span className="font-semibold">{state.name}</span>? This hides it from POS and billing. Items in a category or type must be moved first.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Modal>
  );
}
