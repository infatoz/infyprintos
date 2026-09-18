import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Search, Trash2, Minus, Plus, UserRound, Ban, ChevronDown, Percent } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Field, Input, Modal, SearchableSelect, StatusBadge } from "@/components/ui";
import { cn, inr, initials } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { can } from "@/lib/access";
import { CatalogItemEditor, catalogItemFromSaved } from "@/modules/catalog/CatalogItemEditor";
import { CatalogThumb } from "@/modules/catalog/CatalogMedia";
import { isIndianMobile } from "@/lib/phone";
import { pickWhatsapp, WhatsAppShareModal, type WhatsappShare } from "@/components/WhatsAppShare";

type Variant = { _id: string; name: string; salesPrice?: number; resolvedPrice?: number };
type Category = { _id: string; name: string; imageUrl?: string };
type CatalogType = { _id: string; name: string; slug: string; active?: boolean };
type Item = {
  _id: string;
  name: string;
  sku: string;
  salesPrice: number;
  resolvedPrice?: number;
  unit: string;
  requiresDesign?: boolean;
  taxRate?: number;
  taxInclusive?: boolean;
  itemType?: string;
  imageUrl?: string;
  categoryId?: { _id?: string; name?: string } | string;
  variants?: Variant[];
};
type Customer = {
  _id: string;
  name: string;
  phone: string;
  code: string;
  outstanding?: number;
  creditHold?: boolean;
  creditLimit?: number;
  tierId?: { _id?: string; name?: string };
};
type Line = {
  key: string;
  item: Item;
  variant?: Variant;
  quantity: number;
  unitPrice: number;
  discountType: "none" | "percent" | "fixed";
  discountValue: number;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lineAmount(l: Line) {
  const base = l.unitPrice * l.quantity;
  if (l.discountType === "percent") return Math.max(0, base * (1 - (Number(l.discountValue) || 0) / 100));
  if (l.discountType === "fixed") return Math.max(0, base - (Number(l.discountValue) || 0));
  return base;
}

export function PosPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const canOverride = can(user, "orders.price_override");
  const canCreateItem = can(user, "catalog.create");
  const [q, setQ] = useState("");
  const [cq, setCq] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [itemType, setItemType] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState("cash");
  const [paid, setPaid] = useState(0);
  const [notes, setNotes] = useState("");
  const [coupon, setCoupon] = useState("");
  const [orderDiscountType, setOrderDiscountType] = useState<"none" | "percent" | "fixed">("none");
  const [orderDiscountValue, setOrderDiscountValue] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [chargeName, setChargeName] = useState("Packing");
  const [chargeAmt, setChargeAmt] = useState(0);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);
  const [autoRound, setAutoRound] = useState(true);
  const [newCust, setNewCust] = useState<{ open: boolean; name: string; phone: string }>({ open: false, name: "", phone: "" });
  const [idempotencyKey, setIdempotencyKey] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : newKey()));
  const [payRef, setPayRef] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [discLine, setDiscLine] = useState<string | null>(null);
  const [itemEditor, setItemEditor] = useState(false);
  const [createdItem, setCreatedItem] = useState<Item | null>(null);
  const [waShare, setWaShare] = useState<WhatsappShare | null>(null);
  const cartEnd = useRef<HTMLDivElement>(null);

  const items = useQuery({
    queryKey: ["pos-items", q, categoryId, itemType, customer?.tierId?._id],
    queryFn: async () =>
      (
        await api.get("/catalog/items", {
          params: {
            search: q || undefined,
            limit: 48,
            active: true,
            categoryId: categoryId || undefined,
            itemType: itemType || undefined,
            tierId: customer?.tierId?._id
          }
        })
      ).data.data as Item[]
  });
  const categories = useQuery({
    queryKey: ["pos-cats"],
    queryFn: async () => (await api.get("/catalog/categories")).data.data as Category[]
  });
  const catalogTypes = useQuery({
    queryKey: ["catalog-types"],
    queryFn: async () => (await api.get("/catalog/types")).data.data as CatalogType[]
  });
  const customers = useQuery({
    queryKey: ["pos-customers", cq],
    enabled: cq.length > 1,
    queryFn: async () => (await api.get("/customers", { params: { search: cq, limit: 8 } })).data.data as Customer[]
  });
  const methods = useQuery({
    queryKey: ["pay-methods"],
    queryFn: async () => (await api.get("/settings/payment-methods")).data.data as { code: string; name: string }[]
  });

  const payload = useMemo(
    () =>
      customer && lines.length
        ? {
            customerId: customer._id,
            items: lines.map((l) => ({
              itemId: l.item._id,
              variantId: l.variant?._id,
              quantity: l.quantity,
              unitPrice: canOverride ? l.unitPrice : undefined,
              discountType: l.discountType,
              discountValue: l.discountValue
            })),
            couponCode: coupon || undefined,
            discountType: orderDiscountType,
            discountValue: orderDiscountValue,
            charges: chargeAmt ? [{ name: chargeName || "Charge", amount: chargeAmt }] : [],
            deliveryCharges: delivery,
            autoRound,
            taxInclusive,
            interstate,
            notes,
            paymentMethod: method,
            paymentAmount: paid,
            paymentReference: payRef || undefined
          }
        : null,
    [customer, lines, coupon, orderDiscountType, orderDiscountValue, chargeAmt, chargeName, delivery, autoRound, taxInclusive, interstate, notes, method, paid, payRef, canOverride]
  );

  const preview = useQuery({
    queryKey: ["pos-preview", payload],
    enabled: Boolean(payload),
    queryFn: async () => (await api.post("/orders/preview", payload)).data.data
  });

  const create = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!payload) throw new Error("Select a customer and items");
      const { data } = await api.post(
        "/orders",
        { ...payload, source: "pos", submit, idempotencyKey: `${idempotencyKey}:${submit ? "charge" : "draft"}` },
        { headers: { "Idempotency-Key": `${idempotencyKey}:${submit ? "charge" : "draft"}` } }
      );
      return data.data;
    },
    onSuccess: (order) => {
      toast.success(`Order ${order.number} created · ${inr(order.totals.grandTotal)}`);
      const share = pickWhatsapp(order);
      if (share) setWaShare(share);
      setLines([]);
      setPaid(0);
      setPayRef("");
      setNotes("");
      setCoupon("");
      setOrderDiscountType("none");
      setOrderDiscountValue(0);
      setDelivery(0);
      setChargeAmt(0);
      setPicking(null);
      setTicketOpen(false);
      setIdempotencyKey(crypto.randomUUID ? crypto.randomUUID() : newKey());
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (e as Error).message;
      toast.error(msg);
    }
  });

  async function addItem(item: Item, variant?: Variant) {
    let merged = false;
    setLines((prev) => {
      const found = prev.find((l) => l.item._id === item._id && (l.variant?._id || "") === (variant?._id || ""));
      if (found) {
        merged = true;
        return prev.map((l) => (l.key === found.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return prev;
    });
    if (merged) {
      setPicking(null);
      return;
    }
    let unitPrice = variant?.resolvedPrice ?? variant?.salesPrice ?? item.resolvedPrice ?? item.salesPrice;
    const key = newKey();
    if (customer?.tierId?._id) {
      try {
        const priced = await api.get("/catalog/price", { params: { itemId: item._id, variantId: variant?._id, tierId: customer.tierId._id, qty: 1 } });
        unitPrice = priced.data.data.price ?? unitPrice;
      } catch {
        /* keep base */
      }
    }
    setLines((prev) => {
      const found = prev.find((l) => l.item._id === item._id && (l.variant?._id || "") === (variant?._id || ""));
      if (found) return prev.map((l) => (l.key === found.key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key, item, variant, quantity: 1, unitPrice, discountType: "none", discountValue: 0 }];
    });
    setPicking(null);
  }

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const totals = preview.data?.totals;
  const due = totals ? Math.max(0, Number(totals.grandTotal) - paid) : 0;
  const catalog = useMemo(() => {
    const rows = items.data ?? [];
    if (createdItem && !rows.some((r) => r._id === createdItem._id)) return [createdItem, ...rows];
    return rows;
  }, [items.data, createdItem]);
  const payMethods = methods.data ?? [{ code: "cash", name: "Cash" }];
  const pieceCount = lines.reduce((n, l) => n + l.quantity, 0);
  const taxAmt = interstate ? Number(totals?.igst ?? 0) : Number(totals?.cgst ?? 0) + Number(totals?.sgst ?? 0);

  useEffect(() => {
    cartEnd.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  useEffect(() => {
    const priced = preview.data?.items as Array<{ itemId: string; variantId?: string; unitPrice: number }> | undefined;
    if (!priced?.length || canOverride) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        const row = priced.find((p) => String(p.itemId) === l.item._id && String(p.variantId || "") === String(l.variant?._id || ""));
        if (!row || row.unitPrice === l.unitPrice) return l;
        changed = true;
        return { ...l, unitPrice: row.unitPrice };
      });
      return changed ? next : prev;
    });
  }, [preview.data, canOverride]);

  return (
    <div className="pos-floor lg:h-full">
      <section className="flex min-h-0 flex-col border-b border-line bg-paper lg:border-b-0 lg:border-r">
        <div className="border-b border-line bg-surface px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                className="h-10 pl-9"
                placeholder="Search customer name, phone or code"
                value={cq}
                onChange={(e) => setCq(e.target.value)}
              />
              {customers.data && cq.length > 1 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
                  {customers.data.map((c) => (
                    <button
                      key={c._id}
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] hover:bg-paper"
                      onClick={() => {
                        setCustomer(c);
                        setCq("");
                      }}
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-paper-2 text-[10px] font-semibold">{initials(c.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="text-[12px] text-muted">
                          {c.code} · {c.phone}
                        </span>
                      </span>
                      <Badge>{c.tierId?.name ?? "Basic"}</Badge>
                    </button>
                  ))}
                  {can(user, "customers.create") && (
                    <button
                      type="button"
                      className="w-full border-t border-line px-3 py-2.5 text-left text-[13px] font-medium text-accent"
                      onClick={() => setNewCust({ open: true, name: cq, phone: "" })}
                    >
                      Create “{cq}”
                    </button>
                  )}
                  {!customers.data.length && !can(user, "customers.create") && (
                    <p className="px-3 py-3 text-[13px] text-muted">No matching customers</p>
                  )}
                </div>
              )}
            </div>
            {customer ? (
              <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-sidebar text-[10px] font-semibold text-white">{initials(customer.name)}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">{customer.name}</span>
                    {customer.creditHold ? <StatusBadge status="hold" /> : <Badge>{customer.tierId?.name ?? "Basic"}</Badge>}
                  </div>
                  <div className="text-[12px] text-muted">
                    {customer.code} · AR {inr(customer.outstanding)}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 text-[13px] text-muted lg:flex">
                <UserRound size={16} />
                Walk-up — pick a customer to ticket
              </div>
            )}
          </div>
          {customer?.creditHold && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-rose-700">
              <Ban size={13} /> Credit hold is on. Collections may reject a charge until finance clears it.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
                className="h-10 pl-9 font-mono text-[13px]"
                placeholder="Scan barcode or search SKU / item — Enter adds the first match"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const first = catalog[0];
                if (!first) return;
                e.preventDefault();
                if (first.variants?.length) setPicking(first._id);
                else void addItem(first);
              }}
            />
          </div>
          <div className="hidden w-44 shrink-0 sm:block">
            <SearchableSelect
              value={itemType}
              onChange={setItemType}
              emptyLabel="All types"
              options={(catalogTypes.data ?? []).filter((t) => t.active !== false).map((t) => ({ value: t.slug, label: t.name }))}
              placeholder="Type"
            />
          </div>
          {canCreateItem && (
            <Button type="button" variant="secondary" className="shrink-0" onClick={() => setItemEditor(true)}>
              <Plus size={14} /> New item
            </Button>
          )}
        </div>

        {(categories.data ?? []).length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-4 py-2">
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-[12px] font-medium",
                !categoryId ? "bg-ink text-paper" : "bg-paper text-ink-2 hover:bg-paper-2"
              )}
              onClick={() => setCategoryId("")}
            >
              All
            </button>
            {(categories.data ?? []).map((c) => (
              <button
                key={c._id}
                type="button"
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[12px] font-medium",
                  categoryId === c._id ? "bg-ink text-paper" : "bg-paper text-ink-2 hover:bg-paper-2"
                )}
                onClick={() => setCategoryId(c._id === categoryId ? "" : c._id)}
              >
                <CatalogThumb src={c.imageUrl} size="sm" className="h-6 w-6 rounded-full" />
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="border-b border-line bg-surface px-4 py-2 sm:hidden">
          <SearchableSelect
            value={itemType}
            onChange={setItemType}
            emptyLabel="All types"
            options={(catalogTypes.data ?? []).filter((t) => t.active !== false).map((t) => ({ value: t.slug, label: t.name }))}
            placeholder="Type"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.isLoading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-56 animate-pulse rounded-xl bg-paper-2" />
              ))}
            </div>
          )}
          {!items.isLoading && !catalog.length && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="text-sm font-medium">No items match</p>
                <p className="mt-1 text-[13px] text-muted">Clear search or switch category. Catalog must be active to sell.</p>
                {canCreateItem && (
                  <Button className="mt-3" variant="secondary" onClick={() => setItemEditor(true)}>
                    Create item
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {catalog.map((item) => {
              const onTicket = lines.filter((l) => l.item._id === item._id).reduce((n, l) => n + l.quantity, 0);
              const open = picking === item._id;
              return (
                <div
                  key={item._id}
                  className={cn(
                    "flex flex-col rounded-xl border bg-surface p-3 text-left shadow-[0_1px_2px_rgba(17,19,24,0.04)] transition",
                    open ? "border-accent" : "border-line hover:border-accent/40"
                  )}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      if (item.variants?.length) setPicking(open ? null : item._id);
                      else void addItem(item);
                    }}
                  >
                    <CatalogThumb src={item.imageUrl} size="lg" className="mb-2 rounded-lg" alt={item.name} />
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted">{item.sku}</span>
                      <span className="flex items-center gap-1">
                        {onTicket > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                            {onTicket}
                          </span>
                        )}
                        {item.requiresDesign && <Badge color="#5b4b8a">Design</Badge>}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 min-h-[40px] text-[13px] font-semibold leading-snug">{item.name}</div>
                    {item.itemType ? (
                      <div className="mt-0.5 text-[11px] capitalize text-muted">{item.itemType.replaceAll("_", " ")}</div>
                    ) : null}
                    <div className="mt-3 flex items-end justify-between">
                      <span className="font-mono text-[15px] font-semibold tabular-nums">
                        {item.resolvedPrice != null && item.resolvedPrice !== item.salesPrice ? (
                          <span className="flex flex-col">
                            <span className="text-[11px] font-normal text-muted line-through">{inr(item.salesPrice)}</span>
                            {inr(item.resolvedPrice)}
                          </span>
                        ) : (
                          inr(item.resolvedPrice ?? item.salesPrice)
                        )}
                      </span>
                      <span className="text-[11px] uppercase tracking-wide text-muted">{item.unit}</span>
                    </div>
                  </button>
                  {item.variants?.length ? (
                    open ? (
                      <div className="mt-3 grid gap-1.5">
                        {item.variants.map((v) => (
                          <button
                            key={v._id}
                            type="button"
                            className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-[12px] hover:bg-paper"
                            onClick={() => void addItem(item, v)}
                          >
                            <span>{v.name}</span>
                            <span className="font-mono tabular-nums">{inr(v.resolvedPrice ?? v.salesPrice ?? item.salesPrice)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted">{item.variants.length} variants</p>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {ticketOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-[#111318]/40 lg:hidden"
          aria-label="Close ticket"
          onClick={() => setTicketOpen(false)}
        />
      )}

      <aside
        className={cn(
          "flex flex-col bg-surface",
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[min(92dvh,100%)] max-lg:rounded-t-2xl max-lg:border-t max-lg:border-line max-lg:shadow-2xl max-lg:pb-[env(safe-area-inset-bottom)]",
          !ticketOpen && "max-lg:hidden",
          "lg:relative lg:h-full lg:min-h-0"
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2.5">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight">Ticket</h2>
            <p className="text-[11px] text-muted">
              {lines.length ? `${lines.length} line${lines.length === 1 ? "" : "s"} · ${pieceCount} qty` : "Empty"}
              {customer ? ` · ${customer.name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lines.length > 0 && (
              <button type="button" className="text-[12px] font-medium text-muted hover:text-ink" onClick={() => setLines([])}>
                Clear
              </button>
            )}
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-lg text-[12px] font-medium text-muted hover:bg-paper hover:text-ink lg:hidden"
              onClick={() => setTicketOpen(false)}
            >
              Close
            </button>
          </div>
        </div>

        {lines.length > 0 && (
          <div className="grid shrink-0 grid-cols-[80px_minmax(0,1fr)_minmax(72px,1fr)_52px] gap-2 border-b border-line bg-paper px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <span>Qty</span>
            <span>Item</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!lines.length && (
            <div className="grid h-full min-h-[10rem] place-items-center px-6 text-center">
              <p className="max-w-[16rem] text-[13px] leading-relaxed text-muted">
                Scan a SKU or tap a catalog card. Line amounts are estimates; the due total is the server preview.
              </p>
            </div>
          )}
          {lines.map((l) => {
            const discOn = l.discountType !== "none" && Number(l.discountValue) > 0;
            const open = discLine === l.key;
            return (
              <div key={l.key} className="border-b border-line px-3 py-1.5 hover:bg-paper/70">
                <div className="grid grid-cols-[80px_minmax(0,1fr)_minmax(72px,1fr)_52px] items-center gap-2">
                  <div className="flex h-7 items-center rounded-md border border-line bg-surface">
                    <button
                      type="button"
                      className="grid h-7 w-6 place-items-center text-muted hover:text-ink"
                      aria-label="Decrease quantity"
                      onClick={() => patchLine(l.key, { quantity: Math.max(1, l.quantity - 1) })}
                    >
                      <Minus size={11} />
                    </button>
                    <input
                      className="h-7 w-7 border-x border-line bg-transparent text-center text-[12px] tabular-nums outline-none"
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => patchLine(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <button
                      type="button"
                      className="grid h-7 w-6 place-items-center text-muted hover:text-ink"
                      aria-label="Increase quantity"
                      onClick={() => patchLine(l.key, { quantity: l.quantity + 1 })}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <CatalogThumb src={l.item.imageUrl} size="sm" className="h-7 w-7" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium leading-tight">{l.item.name}</div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                          <span className="truncate font-mono">{l.variant?.name || l.item.sku}</span>
                          {discOn && (
                            <span className="shrink-0 rounded bg-amber-50 px-1 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                              {l.discountType === "percent" ? `−${l.discountValue}%` : `−${inr(l.discountValue)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="font-mono text-[13px] font-semibold tabular-nums leading-tight">{inr(lineAmount(l))}</div>
                    {canOverride ? (
                      <input
                        className="mt-0.5 h-5 w-full bg-transparent text-right font-mono text-[11px] tabular-nums text-muted outline-none"
                        type="number"
                        aria-label="Unit price"
                        value={l.unitPrice}
                        onChange={(e) => patchLine(l.key, { unitPrice: Number(e.target.value) })}
                      />
                    ) : (
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">@{inr(l.unitPrice)}</div>
                    )}
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      className={cn(
                        "grid h-7 w-6 place-items-center rounded-md",
                        open || discOn ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "text-muted hover:bg-paper-2 hover:text-ink"
                      )}
                      aria-label="Line discount"
                      onClick={() => setDiscLine(open ? null : l.key)}
                    >
                      <Percent size={12} />
                    </button>
                    <button
                      type="button"
                      className="grid h-7 w-6 place-items-center rounded-md text-muted hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Remove ${l.item.name}`}
                      onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="mt-1.5 grid grid-cols-2 gap-2 pb-0.5">
                    <select
                      className="h-7 w-full rounded-md border border-line bg-surface px-2 text-[12px] outline-none"
                      value={l.discountType}
                      onChange={(e) => patchLine(l.key, { discountType: e.target.value as Line["discountType"] })}
                    >
                      <option value="none">No discount</option>
                      <option value="percent">Percent %</option>
                      <option value="fixed">Fixed ₹</option>
                    </select>
                    <Input
                      className="h-7"
                      type="number"
                      disabled={l.discountType === "none"}
                      value={l.discountValue || ""}
                      onChange={(e) => patchLine(l.key, { discountValue: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={cartEnd} />
        </div>

        <div className="shrink-0 border-t border-line bg-surface">
          <div className="px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-[12px] font-medium text-ink-2"
              onClick={() => setExtrasOpen((v) => !v)}
            >
              Discounts, tax & notes
              <ChevronDown size={14} className={cn("transition", extrasOpen && "rotate-180")} />
            </button>
            {extrasOpen && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12px]"
                    value={orderDiscountType}
                    onChange={(e) => setOrderDiscountType(e.target.value as typeof orderDiscountType)}
                  >
                    <option value="none">Order discount</option>
                    <option value="percent">Order %</option>
                    <option value="fixed">Order ₹</option>
                  </select>
                  <Input className="h-8" type="number" disabled={orderDiscountType === "none"} value={orderDiscountValue || ""} onChange={(e) => setOrderDiscountValue(Number(e.target.value))} />
                </div>
                <Input className="h-8" placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
                <div className="grid grid-cols-2 gap-2">
                  <Input className="h-8" placeholder="Delivery" type="number" value={delivery || ""} onChange={(e) => setDelivery(Number(e.target.value))} />
                  <Input className="h-8" placeholder="Extra charge" type="number" value={chargeAmt || ""} onChange={(e) => setChargeAmt(Number(e.target.value))} />
                </div>
                {chargeAmt > 0 && <Input className="h-8" placeholder="Charge name" value={chargeName} onChange={(e) => setChargeName(e.target.value)} />}
                <Input className="h-8" placeholder="Notes / artwork instructions" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-ink-2">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} /> Tax inclusive
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={interstate} onChange={(e) => setInterstate(e.target.checked)} /> Interstate (IGST)
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={autoRound} onChange={(e) => setAutoRound(e.target.checked)} /> Round to rupee
                  </label>
                </div>
              </div>
            )}
          </div>

          <dl className={cn("space-y-0.5 border-t border-line px-3 py-2 text-[12px]", preview.isFetching && "opacity-60")}>
            <div className="flex justify-between text-muted">
              <dt>Subtotal</dt>
              <dd className="font-mono tabular-nums">{inr(totals?.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>{interstate ? "IGST" : "GST"}</dt>
              <dd className="font-mono tabular-nums">{inr(taxAmt)}</dd>
            </div>
            {totals?.roundOff ? (
              <div className="flex justify-between text-muted">
                <dt>Round off</dt>
                <dd className="font-mono tabular-nums">{inr(totals.roundOff)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between pt-1">
              <dt className="text-[13px] font-semibold">Due</dt>
              <dd className="font-mono text-[20px] font-semibold tabular-nums leading-none">{inr(totals?.grandTotal)}</dd>
            </div>
          </dl>

          <div className="border-t border-line px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-[12px] font-medium text-ink-2"
              onClick={() => setPayOpen((v) => !v)}
            >
              Tender · {payMethods.find((m) => m.code === method)?.name ?? method}
              {paid > 0 ? ` · ${inr(paid)}` : ""}
              <ChevronDown size={14} className={cn("transition", payOpen && "rotate-180")} />
            </button>
            {payOpen && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {payMethods.map((m) => (
                    <button
                      key={m.code}
                      type="button"
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-medium capitalize",
                        method === m.code ? "border-accent bg-accent text-white dark:text-[#0c0e12]" : "border-line bg-paper text-ink-2 hover:bg-paper-2"
                      )}
                      onClick={() => setMethod(m.code)}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input className="h-8 flex-1" type="number" placeholder="Amount paid now" value={paid || ""} onChange={(e) => setPaid(Number(e.target.value))} />
                  {totals && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPaid(Number(totals.grandTotal))}>
                      Full
                    </Button>
                  )}
                </div>
                {method !== "cash" && (
                  <Input className="h-8" placeholder="Payment reference (UPI / cheque)" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                )}
                {totals && paid > 0 && (
                  <p className="text-[11px] text-muted">
                    Balance after this tender: <span className="font-mono">{inr(due)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_1.4fr] gap-2 px-3 pb-3 pt-1">
            <Button variant="secondary" className="h-10" onClick={() => create.mutate(false)} disabled={create.isPending || !payload}>
              Draft
            </Button>
            <Button className="h-10 text-[14px]" onClick={() => create.mutate(true)} disabled={create.isPending || !payload}>
              {create.isPending ? "Charging…" : `Charge${totals ? ` ${inr(totals.grandTotal)}` : ""}`}
            </Button>
            <button
              type="button"
              className="col-span-2 text-center text-[12px] font-medium text-muted hover:text-ink disabled:opacity-40"
              disabled={!payload}
              onClick={async () => {
                if (!payload) return;
                try {
                  const { data } = await api.post("/quotations", payload);
                  toast.success(`Quotation ${data.data.number} saved`);
                  try {
                    const sent = await api.post(`/quotations/${data.data._id}/send`);
                    const share = pickWhatsapp(sent.data.data);
                    if (share) setWaShare(share);
                  } catch {
                    /* draft saved — share from Quotations if send is blocked */
                  }
                } catch (e: unknown) {
                  toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not save quotation");
                }
              }}
            >
              Save as quotation
            </button>
          </div>
        </div>
      </aside>

      <div
        className="fixed inset-x-0 z-20 border-t border-line bg-surface/95 px-3 py-2 backdrop-blur lg:hidden"
        style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-2">
          <button type="button" className="min-w-0 flex-1 rounded-lg py-1 text-left" onClick={() => setTicketOpen(true)}>
            <span className="block text-[11px] text-muted">
              {lines.length ? `${lines.length} line${lines.length === 1 ? "" : "s"} · ${pieceCount} qty` : "Ticket"}
              {customer ? ` · ${customer.name}` : " · pick a customer"}
            </span>
            <span className="font-mono text-[16px] font-semibold tabular-nums">{inr(totals?.grandTotal)}</span>
          </button>
          <Button className="h-11 shrink-0 px-4" disabled={!payload || create.isPending} onClick={() => create.mutate(true)}>
            {create.isPending ? "Charging…" : "Charge"}
          </Button>
        </div>
      </div>

      {itemEditor && (
        <Modal title="New catalog item" onClose={() => setItemEditor(false)} wide>
          <CatalogItemEditor
            compact
            onCancel={() => setItemEditor(false)}
            onSaved={(data) => {
              const item = catalogItemFromSaved(data) as Item;
              setItemEditor(false);
              setCreatedItem(item);
              void qc.invalidateQueries({ queryKey: ["pos-items"] });
              if (item.variants?.length) setPicking(item._id);
              else void addItem(item);
            }}
          />
        </Modal>
      )}
      {newCust.open && (
        <Modal title="Quick customer" onClose={() => setNewCust({ ...newCust, open: false })}>
          <div className="space-y-3">
            <Field label="Name">
              <Input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
            </Field>
            <Field label="Phone" hint="10-digit mobile number">
              <Input inputMode="numeric" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setNewCust({ ...newCust, open: false })}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!isIndianMobile(newCust.phone)) {
                    toast.error("Phone must be a 10-digit mobile number");
                    return;
                  }
                  try {
                    const { data } = await api.post("/customers", { name: newCust.name, phone: newCust.phone, whatsapp: newCust.phone });
                    setCustomer(data.data.customer);
                    setNewCust({ open: false, name: "", phone: "" });
                    toast.success("Customer created");
                    const share = pickWhatsapp(data.data);
                    if (share) setWaShare(share);
                  } catch (e: unknown) {
                    toast.error((e as { response?: { data?: { message?: string } } }).response?.data?.message || "Could not create");
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {waShare && (
        <WhatsAppShareModal
          share={waShare}
          title="Share with customer on WhatsApp"
          onClose={() => setWaShare(null)}
        />
      )}
    </div>
  );
}
