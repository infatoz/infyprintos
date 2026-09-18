import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Field, Input, SearchableSelect, Textarea } from "@/components/ui";
import { can } from "@/lib/access";
import { useAuth } from "@/stores/auth";
import { CatalogImagePicker, CatalogThumb } from "./CatalogMedia";

export type CatalogVariant = {
  _id?: string;
  name: string;
  sku: string;
  salesPrice: number | "";
  cost: number | "";
  barcode: string;
};

export type CatalogSaved = {
  item: {
    _id: string;
    name: string;
    sku: string;
    salesPrice: number;
    unit: string;
    requiresDesign?: boolean;
    taxRate?: number;
    itemType?: string;
    imageUrl?: string;
    categoryId?: string;
  };
  variants: Array<{ _id: string; name: string; sku?: string; salesPrice?: number }>;
  prices: unknown[];
};

type Tier = { _id: string; name: string; discountPercent?: number };
type CatalogType = {
  _id: string;
  name: string;
  slug: string;
  defaultUnit?: string;
  requiresDesign?: boolean;
  trackInventory?: boolean;
  active?: boolean;
};
type Category = { _id: string; name: string; type?: string; active?: boolean };

function emptyVariant(): CatalogVariant {
  return { name: "", sku: "", salesPrice: "", cost: "", barcode: "" };
}

function cellKey(row: string, tierId: string) {
  return `${row}:${tierId}`;
}

function autoPrice(list: number | "", pct?: number) {
  if (list === "" || Number.isNaN(Number(list))) return "";
  const p = Number(pct) || 0;
  return String(Math.round(Number(list) * (1 - p / 100) * 100) / 100);
}

function invalidClass(on: boolean) {
  return on ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/15" : undefined;
}

export function CatalogItemEditor({
  itemId,
  onCancel,
  onSaved,
  compact = false
}: {
  itemId?: string;
  onCancel: () => void;
  onSaved: (data: CatalogSaved) => void;
  compact?: boolean;
}) {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [itemType, setItemType] = useState("custom_print");
  const [categoryId, setCategoryId] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [salesPrice, setSalesPrice] = useState<number | "">("");
  const [originalPrice, setOriginalPrice] = useState<number | "">("");
  const [baseCost, setBaseCost] = useState<number | "">("");
  const [taxRate, setTaxRate] = useState(18);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [requiresDesign, setRequiresDesign] = useState(true);
  const [trackInventory, setTrackInventory] = useState(false);
  const [active, setActive] = useState(true);
  const [hsn, setHsn] = useState("");
  const [sac, setSac] = useState("");
  const [description, setDescription] = useState("");
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [tierPrices, setTierPrices] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coverUrl, setCoverUrl] = useState<string | undefined>();
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [gallery, setGallery] = useState<string[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [removedGallery, setRemovedGallery] = useState<string[]>([]);
  const galleryInput = useRef<HTMLInputElement>(null);

  const cats = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/catalog/categories")).data.data as Category[] });
  const types = useQuery({ queryKey: ["catalog-types"], queryFn: async () => (await api.get("/catalog/types")).data.data as CatalogType[] });
  const units = useQuery({ queryKey: ["catalog-units"], queryFn: async () => (await api.get("/catalog/units")).data.data as Array<{ code: string; name: string }> });
  const tiers = useQuery({
    queryKey: ["tiers"],
    enabled: can(user, "customers.view"),
    queryFn: async () => (await api.get("/customers/tiers")).data.data as Tier[]
  });
  const detail = useQuery({
    queryKey: ["catalog-item", itemId],
    enabled: Boolean(itemId),
    queryFn: async () =>
      (await api.get(`/catalog/items/${itemId}`)).data.data as {
        item: Record<string, unknown>;
        variants: Array<Record<string, unknown>>;
        prices: Array<Record<string, unknown>>;
      }
  });

  useEffect(() => {
    if (!detail.data) return;
    const item = detail.data.item;
    setName(String(item.name ?? ""));
    setSku(String(item.sku ?? ""));
    setBarcode(String(item.barcode ?? ""));
    setBrand(String(item.brand ?? ""));
    setItemType(String(item.itemType ?? "custom_print"));
    setCategoryId(item.categoryId ? String(item.categoryId) : "");
    setUnit(String(item.unit ?? "pcs"));
    setSalesPrice(Number(item.salesPrice ?? 0));
    setOriginalPrice(item.originalPrice != null && Number(item.originalPrice) > 0 ? Number(item.originalPrice) : "");
    setBaseCost(item.baseCost != null ? Number(item.baseCost) : "");
    setTaxRate(Number(item.taxRate ?? 18));
    setTaxInclusive(Boolean(item.taxInclusive));
    setRequiresDesign(item.requiresDesign !== false);
    setTrackInventory(Boolean(item.trackInventory));
    setActive(item.active !== false);
    setHsn(String(item.hsn ?? ""));
    setSac(String(item.sac ?? ""));
    setDescription(String(item.description ?? ""));
    setCoverUrl(item.imageUrl ? String(item.imageUrl) : undefined);
    setGallery(Array.isArray(item.gallery) ? (item.gallery as string[]) : []);
    setCoverFile(null);
    setRemoveCover(false);
    setGalleryFiles([]);
    setRemovedGallery([]);
    const vs = (detail.data.variants ?? []).map((v) => ({
      _id: String(v._id),
      name: String(v.name ?? ""),
      sku: String(v.sku ?? ""),
      salesPrice: v.salesPrice != null ? Number(v.salesPrice) : ("" as const),
      cost: v.cost != null ? Number(v.cost) : ("" as const),
      barcode: String(v.barcode ?? "")
    }));
    setVariants(vs);
    const next: Record<string, string> = {};
    for (const p of detail.data.prices ?? []) {
      if (!p.tierId) continue;
      const row = p.variantId ? String(p.variantId) : "base";
      next[cellKey(row, String(p.tierId))] = String(p.price);
    }
    setTierPrices(next);
  }, [detail.data]);

  const typeOptions = useMemo(
    () =>
      (types.data ?? [])
        .filter((t) => t.active !== false)
        .map((t) => ({ value: t.slug, label: t.name, hint: t.defaultUnit })),
    [types.data]
  );
  const categoryOptions = useMemo(
    () =>
      (cats.data ?? [])
        .filter((c) => c.active !== false)
        .map((c) => ({ value: c._id, label: c.name, hint: c.type })),
    [cats.data]
  );
  const unitOptions = useMemo(
    () => (units.data ?? []).map((u) => ({ value: u.code, label: u.name })),
    [units.data]
  );

  function applyType(slug: string) {
    setItemType(slug);
    const t = (types.data ?? []).find((row) => row.slug === slug);
    if (!t) return;
    setUnit(t.defaultUnit || "pcs");
    setRequiresDesign(Boolean(t.requiresDesign));
    setTrackInventory(Boolean(t.trackInventory));
  }

  const priceRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; list: number | "" }> = [{ key: "base", label: "Base item", list: salesPrice }];
    variants.forEach((v, i) => {
      if (!v.name.trim()) return;
      rows.push({ key: v._id || `new-${i}`, label: v.name, list: v.salesPrice });
    });
    return rows;
  }, [variants, salesPrice]);

  function validateForm() {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = "Name is required";
    if (!itemType) next.itemType = "Type is required";
    if (salesPrice === "" || Number(salesPrice) < 0 || Number.isNaN(Number(salesPrice))) next.salesPrice = "List price is required";
    if (taxRate < 0 || taxRate > 100) next.taxRate = "GST must be between 0 and 100";
    if (originalPrice !== "" && Number(originalPrice) < 0) next.originalPrice = "MRP cannot be negative";
    if (baseCost !== "" && Number(baseCost) < 0) next.baseCost = "Cost cannot be negative";
    if (hsn.trim() && !/^\d{4,8}$/.test(hsn.trim())) next.hsn = "HSN must be 4–8 digits";
    if (sac.trim() && !/^\d{4,6}$/.test(sac.trim())) next.sac = "SAC must be 4–6 digits";
    variants.forEach((v, i) => {
      if (!v.name.trim() && (v.sku || v.salesPrice !== "" || v.barcode)) next[`variant-${i}`] = "Variant name is required";
      if (v.salesPrice !== "" && Number(v.salesPrice) < 0) next[`variant-price-${i}`] = "Variant price cannot be negative";
    });
    setErrors(next);
    return next;
  }

  function fillTierPrices(mode: "empty" | "all") {
    const next = { ...tierPrices };
    for (const row of priceRows) {
      for (const tier of tiers.data ?? []) {
        const key = cellKey(row.key, tier._id);
        if (mode === "empty" && next[key]) continue;
        next[key] = autoPrice(row.list, tier.discountPercent);
      }
    }
    setTierPrices(next);
  }

  const coverPreview = removeCover ? undefined : coverFile ? URL.createObjectURL(coverFile) : coverUrl;

  const save = useMutation({
    mutationFn: async () => {
      const errs = validateForm();
      if (Object.keys(errs).length) throw new Error("Fix the highlighted fields");
      let cat = categoryId;
      if (newCategory.trim() && can(user, "catalog.create")) {
        const created = await api.post("/catalog/categories", { name: newCategory.trim(), type: itemType || "product" });
        cat = created.data.data._id;
      }
      const namedVariants = variants.map((v, i) => ({ v, i })).filter(({ v }) => v.name.trim());
      const variantPayload = namedVariants.map(({ v }) => ({
        _id: v._id,
        name: v.name.trim(),
        sku: v.sku.trim() || undefined,
        salesPrice: v.salesPrice === "" ? undefined : Number(v.salesPrice),
        cost: v.cost === "" ? undefined : Number(v.cost),
        barcode: v.barcode.trim() || undefined
      }));
      const prices: Array<{ variantId?: string; variantIndex?: number; tierId: string; price: number }> = [];
      for (const tier of tiers.data ?? []) {
        const baseVal = tierPrices[cellKey("base", tier._id)];
        if (baseVal !== undefined && baseVal !== "") prices.push({ tierId: tier._id, price: Number(baseVal) });
        namedVariants.forEach(({ v, i }, payloadIndex) => {
          const rowKey = v._id || `new-${i}`;
          const val = tierPrices[cellKey(rowKey, tier._id)];
          if (val === undefined || val === "") return;
          if (v._id) prices.push({ variantId: v._id, tierId: tier._id, price: Number(val) });
          else prices.push({ variantIndex: payloadIndex, tierId: tier._id, price: Number(val) });
        });
      }
      const payload = {
        name: name.trim(),
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        brand: brand.trim() || undefined,
        itemType,
        categoryId: cat || undefined,
        unit,
        salesPrice: Number(salesPrice || 0),
        originalPrice: originalPrice === "" ? undefined : Number(originalPrice),
        baseCost: baseCost === "" ? undefined : Number(baseCost),
        taxRate: Number(taxRate),
        taxInclusive,
        requiresDesign,
        trackInventory,
        active,
        hsn: hsn.trim() || undefined,
        sac: sac.trim() || undefined,
        description: description.trim() || undefined,
        variants: variantPayload,
        prices
      };
      const res = itemId ? await api.patch(`/catalog/items/${itemId}`, payload) : await api.post("/catalog/items", payload);
      const saved = res.data.data as CatalogSaved;
      const id = saved.item._id;
      if (coverFile) {
        const fd = new FormData();
        fd.append("file", coverFile);
        const uploaded = await api.post(`/catalog/items/${id}/image`, fd);
        saved.item.imageUrl = uploaded.data.data.imageUrl;
      } else if (removeCover && itemId) {
        await api.delete(`/catalog/items/${id}/image`);
        saved.item.imageUrl = undefined;
      }
      if (galleryFiles.length) {
        const fd = new FormData();
        galleryFiles.forEach((f) => fd.append("files", f));
        await api.post(`/catalog/items/${id}/gallery`, fd);
      }
      for (const url of removedGallery) {
        await api.delete(`/catalog/items/${id}/gallery`, { data: { url } });
      }
      return saved;
    },
    onSuccess: (data) => {
      toast.success(itemId ? "Item updated" : "Item created");
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["pos-items"] });
      qc.invalidateQueries({ queryKey: ["cats"] });
      qc.invalidateQueries({ queryKey: ["catalog-item", itemId] });
      onSaved(data);
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message || (e as Error).message || "Could not save item");
    }
  });

  if (itemId && detail.isLoading) {
    return <p className="text-[13px] text-muted">Loading item…</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h4 className="mb-3 text-[13px] font-semibold">Item details</h4>
        <div className="mb-4">
          <CatalogImagePicker
            label="Cover image"
            src={coverPreview}
            onFile={(file) => {
              setCoverFile(file);
              setRemoveCover(false);
            }}
            onClear={() => {
              setCoverFile(null);
              setRemoveCover(true);
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" required error={errors.name}>
            <Input className={invalidClass(Boolean(errors.name))} value={name} onChange={(e) => setName(e.target.value)} placeholder="Visiting cards — 300gsm" />
          </Field>
          <Field label="SKU" hint="Leave blank to auto-generate">
            <Input className="font-mono" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Barcode">
            <Input className="font-mono" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </Field>
          <Field label="Type" required error={errors.itemType}>
            <SearchableSelect value={itemType} onChange={applyType} options={typeOptions} placeholder="Select type" />
          </Field>
          <Field label="Category">
            <SearchableSelect value={categoryId} onChange={setCategoryId} options={categoryOptions} emptyLabel="No category" placeholder="Select category" />
          </Field>
          {can(user, "catalog.create") ? (
            <Field label="New category" hint="Optional — creates on save">
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Stickers" />
            </Field>
          ) : null}
          <Field label="Unit">
            <SearchableSelect value={unit} onChange={setUnit} options={unitOptions} placeholder="Unit" />
          </Field>
          <Field label="List price (₹)" required error={errors.salesPrice}>
            <Input
              className={invalidClass(Boolean(errors.salesPrice))}
              type="number"
              min={0}
              value={salesPrice}
              onChange={(e) => setSalesPrice(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>
          <Field label="MRP (₹)" error={errors.originalPrice}>
            <Input
              type="number"
              min={0}
              value={originalPrice}
              onChange={(e) => setOriginalPrice(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>
          <Field label="Cost (₹)" error={errors.baseCost}>
            <Input type="number" min={0} value={baseCost} onChange={(e) => setBaseCost(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
          <Field label="GST %" error={errors.taxRate}>
            <Input type="number" min={0} max={100} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
          </Field>
          <Field label="Brand">
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="HSN" hint="Optional, 4–8 digits" error={errors.hsn}>
            <Input className={invalidClass(Boolean(errors.hsn))} value={hsn} onChange={(e) => setHsn(e.target.value)} />
          </Field>
          <Field label="SAC" hint="Optional, 4–6 digits" error={errors.sac}>
            <Input className={invalidClass(Boolean(errors.sac))} value={sac} onChange={(e) => setSac(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-ink-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={requiresDesign} onChange={(e) => setRequiresDesign(e.target.checked)} /> Design required
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} /> Track inventory
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} /> Tax inclusive
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active in POS
          </label>
        </div>
        {!compact && (
          <div className="mt-3">
            <Field label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Finish, size, turnaround notes" />
            </Field>
          </div>
        )}
      </section>

      {!compact && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="text-[13px] font-semibold">Gallery</h4>
              <p className="text-[12px] text-muted">Optional extra photos. Cover image is used on POS cards.</p>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => galleryInput.current?.click()}>
              <Plus size={14} /> Add photos
            </Button>
            <input
              ref={galleryInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setGalleryFiles((prev) => [...prev, ...files].slice(0, 8));
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {gallery
              .filter((url) => !removedGallery.includes(url))
              .map((url) => (
                <div key={url} className="relative">
                  <CatalogThumb src={url} size="md" className="h-20 w-20" />
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] text-paper"
                    onClick={() => setRemovedGallery((prev) => [...prev, url])}
                  >
                    ×
                  </button>
                </div>
              ))}
            {galleryFiles.map((file, i) => (
              <div key={`${file.name}-${i}`} className="relative">
                <CatalogThumb src={URL.createObjectURL(file)} size="md" className="h-20 w-20" />
                <button
                  type="button"
                  className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] text-paper"
                  onClick={() => setGalleryFiles((prev) => prev.filter((_, n) => n !== i))}
                >
                  ×
                </button>
              </div>
            ))}
            {!gallery.filter((url) => !removedGallery.includes(url)).length && !galleryFiles.length && (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-[13px] text-muted">No extra photos yet.</p>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-[13px] font-semibold">Variants</h4>
            <p className="text-[12px] text-muted">Size, finish, pack qty. Leave empty if the item has a single price.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setVariants((prev) => [...prev, emptyVariant()])}>
            <Plus size={14} /> Add variant
          </Button>
        </div>
        {variants.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-[13px] text-muted">
            No variants — the list price above is used for every customer unless a tier price is set.
          </p>
        )}
        {variants.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">List ₹</th>
                  <th className="px-3 py-2">Cost ₹</th>
                  <th className="px-3 py-2">Barcode</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={v._id || `v-${i}`} className="border-b border-line last:border-0">
                    <td className="px-2 py-1.5">
                      <Input
                        className={invalidClass(Boolean(errors[`variant-${i}`]))}
                        value={v.name}
                        onChange={(e) => setVariants((prev) => prev.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="font-mono" value={v.sku} onChange={(e) => setVariants((prev) => prev.map((x, n) => (n === i ? { ...x, sku: e.target.value.toUpperCase() } : x)))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={v.salesPrice}
                        onChange={(e) =>
                          setVariants((prev) => prev.map((x, n) => (n === i ? { ...x, salesPrice: e.target.value === "" ? "" : Number(e.target.value) } : x)))
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={v.cost}
                        onChange={(e) => setVariants((prev) => prev.map((x, n) => (n === i ? { ...x, cost: e.target.value === "" ? "" : Number(e.target.value) } : x)))}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="font-mono" value={v.barcode} onChange={(e) => setVariants((prev) => prev.map((x, n) => (n === i ? { ...x, barcode: e.target.value } : x)))} />
                    </td>
                    <td className="px-1">
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center text-muted hover:text-rose-600"
                        onClick={() => setVariants((prev) => prev.filter((_, n) => n !== i))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(tiers.data ?? []).length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-semibold">Tier prices</h4>
              <p className="text-[12px] text-muted">
                Blank cells use list price, then the tier’s % discount. Fill a cell to lock a rupee price. Auto-calc writes list × (1 − discount).
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => fillTierPrices("empty")}>
                Fill empty
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => fillTierPrices("all")}>
                Recalculate all
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Applies to</th>
                  <th className="px-3 py-2">List</th>
                  {(tiers.data ?? []).map((t) => (
                    <th key={t._id} className="px-3 py-2">
                      {t.name}
                      {t.discountPercent ? <span className="ml-1 font-normal normal-case">({t.discountPercent}%)</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {priceRows.map((row) => (
                  <tr key={row.key} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">{row.list === "" ? "—" : Number(row.list)}</td>
                    {(tiers.data ?? []).map((t) => (
                      <td key={t._id} className="px-2 py-1.5">
                        <Input
                          className="h-8 font-mono"
                          type="number"
                          min={0}
                          placeholder={autoPrice(row.list, t.discountPercent) || "auto"}
                          value={tierPrices[cellKey(row.key, t._id)] ?? ""}
                          onChange={(e) => setTierPrices((prev) => ({ ...prev, [cellKey(row.key, t._id)]: e.target.value }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : itemId ? "Save item" : "Create item"}
        </Button>
      </div>
    </div>
  );
}

export function catalogItemFromSaved(data: CatalogSaved) {
  return {
    _id: data.item._id,
    name: data.item.name,
    sku: data.item.sku,
    salesPrice: data.item.salesPrice,
    unit: data.item.unit,
    requiresDesign: data.item.requiresDesign,
    taxRate: data.item.taxRate,
    itemType: data.item.itemType,
    imageUrl: data.item.imageUrl,
    variants: data.variants ?? []
  };
}
