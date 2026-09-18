import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/cn";

type Hit = { id: string; kind: "Customer" | "Order" | "Item"; title: string; meta: string; to: string };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const enabled = open && q.trim().length >= 2;

  const customers = useQuery({
    queryKey: ["cmd-c", q],
    enabled: enabled && can(user, "customers.view"),
    queryFn: async () => (await api.get("/customers", { params: { search: q, limit: 6 } })).data.data as Array<{ _id: string; name: string; code: string; phone: string }>
  });
  const orders = useQuery({
    queryKey: ["cmd-o", q],
    enabled: enabled && can(user, "orders.view"),
    queryFn: async () => (await api.get("/orders", { params: { search: q, limit: 6 } })).data.data as Array<{ _id: string; number: string; status: string; customerSnapshot?: { name?: string } }>
  });
  const items = useQuery({
    queryKey: ["cmd-i", q],
    enabled: enabled && can(user, "catalog.view"),
    queryFn: async () => (await api.get("/catalog/items", { params: { search: q, limit: 6 } })).data.data as Array<{ _id: string; name: string; sku: string }>
  });

  const hits: Hit[] = useMemo(() => {
    const rows: Hit[] = [];
    for (const c of customers.data ?? []) {
      rows.push({ id: c._id, kind: "Customer", title: c.name, meta: `${c.code} · ${c.phone}`, to: `/customers/${c._id}` });
    }
    for (const o of orders.data ?? []) {
      rows.push({ id: o._id, kind: "Order", title: o.number, meta: `${o.customerSnapshot?.name ?? ""} · ${o.status.replaceAll("_", " ")}`, to: `/orders/${o._id}` });
    }
    for (const i of items.data ?? []) {
      rows.push({ id: i._id, kind: "Item", title: i.name, meta: i.sku, to: "/catalog" });
    }
    return rows;
  }, [customers.data, orders.data, items.data]);

  useEffect(() => {
    setActive(0);
  }, [q, open]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  if (!open) return null;

  function go(hit?: Hit) {
    const row = hit ?? hits[active];
    if (!row) return;
    navigate(row.to);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#111318]/45 p-4 backdrop-blur-[2px] sm:p-24" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customers, orders, SKUs"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {!enabled && <p className="px-4 py-8 text-center text-[13px] text-muted">Type at least two characters. Esc to close.</p>}
          {enabled && !hits.length && <p className="px-4 py-8 text-center text-[13px] text-muted">No matches for “{q}”.</p>}
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              type="button"
              className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px]", i === active && "bg-paper")}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
            >
              <span>
                <span className="font-medium">{hit.title}</span>
                <span className="ml-2 text-muted">{hit.meta}</span>
              </span>
              <span className="rounded-md bg-paper-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">{hit.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
