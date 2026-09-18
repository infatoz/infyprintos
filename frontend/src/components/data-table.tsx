import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button, Input, Select, Th } from "@/components/ui";

export type SortDir = "asc" | "desc";

function valueAt(row: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, row);
}

function compareValues(a: unknown, b: unknown) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const da = typeof a === "string" && /^\d{4}-\d{2}/.test(a) ? Date.parse(a) : NaN;
  const db = typeof b === "string" && /^\d{4}-\d{2}/.test(b) ? Date.parse(b) : NaN;
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export function useClientTable<T>(
  rows: T[] | undefined,
  getSearchText: (row: T) => string,
  opts?: { pageSize?: number; getSortValue?: (row: T, key: string) => unknown }
) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(opts?.pageSize ?? 20);
  const source = rows ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((row) => getSearchText(row).toLowerCase().includes(q));
  }, [source, search, getSearchText]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = opts?.getSortValue ? opts.getSortValue(a, sortKey) : valueAt(a, sortKey);
      const bv = opts?.getSortValue ? opts.getSortValue(b, sortKey) : valueAt(b, sortKey);
      const cmp = compareValues(av, bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, opts]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize) || 1);
  const safePage = Math.min(page, pages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function onSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  return {
    search,
    setSearch: onSearch,
    sortKey,
    sortDir,
    toggleSort,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
    rows: paged,
    total: sorted.length,
    pages,
    empty: sorted.length === 0
  };
}

export function useServerTable(defaults?: { limit?: number; sort?: string }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaults?.limit ?? 20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(defaults?.sort ?? "-createdAt");

  function toggleSort(key: string) {
    setSort((current) => (current === key ? `-${key}` : key));
    setPage(1);
  }

  function onSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  return {
    page,
    setPage,
    limit,
    setLimit: (n: number) => {
      setLimit(n);
      setPage(1);
    },
    search,
    setSearch: onSearch,
    sort,
    toggleSort,
    params: { page, limit, search: search.trim() || undefined, sort }
  };
}

export function SortTh({
  id,
  sortKey,
  sortDir,
  onSort,
  children,
  className,
  serverSort
}: {
  id: string;
  sortKey?: string;
  sortDir?: SortDir | string;
  onSort: (id: string) => void;
  children?: ReactNode;
  className?: string;
  serverSort?: string;
}) {
  const active = serverSort ? serverSort === id || serverSort === `-${id}` : sortKey === id;
  const desc = serverSort ? serverSort === `-${id}` : sortDir === "desc";
  return (
    <Th className={className}>
      <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={() => onSort(id)}>
        {children}
        <span className={cn("text-[10px]", active ? "text-ink" : "text-muted/50")}>{active ? (desc ? "↓" : "↑") : "↕"}</span>
      </button>
    </Th>
  );
}

export function TableSearch({
  value,
  onChange,
  placeholder = "Search",
  className
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return <Input className={className} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function TablePager({
  page,
  pages,
  total,
  onPage,
  pageSize,
  onPageSize,
  noun = "rows"
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
  onPageSize?: (size: number) => void;
  noun?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-muted">
      <span>
        {total} {noun}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize ? (
          <Select
            className="h-8 w-[4.5rem] px-2 text-[12px]"
            value={String(pageSize ?? 20)}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        ) : null}
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function TableToolbar({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border-b border-line bg-paper/50 px-3 py-2", className)}>{children}</div>;
}
