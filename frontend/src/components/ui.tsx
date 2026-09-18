import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Link } from "react-router-dom";
import { cn, initials } from "@/lib/cn";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-white shadow-sm hover:brightness-110 dark:text-[#0c0e12]",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-paper",
        variant === "ghost" && "bg-transparent text-ink/80 hover:bg-paper-2",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-700",
        variant === "gold" && "border border-line bg-surface text-ink hover:bg-paper",
        className
      )}
      {...props}
    />
  );
}

const fieldControl =
  "h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] outline-none transition placeholder:text-muted/80 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:bg-paper disabled:text-ink/50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldControl, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldControl, className)} {...props} />;
}

export type SearchableOption = { value: string; label: string; hint?: string; disabled?: boolean };

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  emptyLabel,
  disabled,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    const extra: SearchableOption[] = emptyLabel ? [{ value: "", label: emptyLabel }] : [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter((o) => `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase().includes(q))
      : options;
    return [...extra, ...filtered];
  }, [options, query, emptyLabel]);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(fieldControl, "flex items-center justify-between gap-2 text-left", disabled && "pointer-events-none")}
      >
        <span className={cn("truncate", !selected && !value && "text-muted/80")}>{selected?.label || emptyLabel || placeholder}</span>
        <span className="text-[10px] text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const pick = list[active];
                if (pick && !pick.disabled) {
                  onChange(pick.value);
                  setOpen(false);
                }
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search"
            className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none"
          />
          <ul className="max-h-56 overflow-y-auto py-1">
            {list.map((opt, i) => (
              <li key={`${opt.value}-${i}`}>
                <button
                  type="button"
                  disabled={opt.disabled}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px]",
                    i === active && "bg-paper",
                    opt.value === value && "font-medium",
                    opt.disabled && "opacity-40"
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                  {opt.hint ? <span className="text-[11px] text-muted">{opt.hint}</span> : null}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-2 text-[12px] text-muted">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Avatar({ name, src, size = 32 }: { name?: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-paper-2 text-[10px] font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
    >
      {initials(name)}
    </span>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[92px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[12px] font-medium text-ink-2", className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(17,19,24,0.04)]", className)} {...props} />;
}

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize"
      style={color ? { background: `${color}22`, color } : { background: "var(--paper-2)", color: "var(--ink-2)" }}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const key = status.replaceAll("_", " ");
  const tone =
    /paid|active|approved|verified|completed|ready/.test(status)
      ? "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40"
      : /in_production|quality/.test(status)
        ? "text-sky-800 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/40"
        : /hold|block|overdue|reject|cancel|fail|expired|off/.test(status)
          ? "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40"
          : /pending|draft|prospect|partial|delay|inactive/.test(status)
            ? "text-amber-800 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40"
            : "text-ink-2 bg-paper-2";
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize", tone)}>{key}</span>;
}

export function Field({
  label,
  children,
  hint,
  error,
  required
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label>
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="mt-1 text-[12px] text-rose-600">{error}</p> : hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-paper-2", className)} />;
}

export function ErrorState({ title = "Something went wrong", hint, onRetry }: { title?: string; hint?: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-2 p-6">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      {onRetry && (
        <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </Card>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  crumbs?: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav className="mb-1.5 flex flex-wrap items-center gap-1 text-[12px] text-muted">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <span className="text-line">/</span>}
                {c.to ? (
                  <Link to={c.to} className="hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-ink-2">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[20px] font-semibold leading-tight tracking-tight sm:text-[22px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions ? <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-1 max-w-xl text-[13px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6", className)}>{children}</Card>;
}

export function Kpi({
  label,
  value,
  hint,
  tone = "default",
  delta,
  invertDelta
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "danger";
  delta?: number | null;
  invertDelta?: boolean;
}) {
  const deltaTone =
    delta == null || delta === 0
      ? "text-muted"
      : (delta > 0) !== Boolean(invertDelta)
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-rose-700 dark:text-rose-300";
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-[20px] font-semibold tabular-nums tracking-tight",
          tone === "warn" && "text-amber-700 dark:text-amber-300",
          tone === "danger" && "text-rose-700 dark:text-rose-300"
        )}
      >
        {value}
      </div>
      {delta != null && !Number.isNaN(delta) || hint ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
          {delta != null && !Number.isNaN(delta) ? (
            <span className={cn("font-medium tabular-nums", deltaTone)}>
              {delta > 0 ? "+" : ""}
              {Math.abs(delta) >= 10 ? delta.toFixed(0) : delta.toFixed(1)}% vs prior
            </span>
          ) : null}
          {hint ? <span className="truncate">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("mb-5 grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4", className)}>
      {children}
    </Card>
  );
}

export function Tabs({
  tabs,
  value,
  onChange
}: {
  tabs: Array<{ id: string; label: string; hint?: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={cn(
            "-mb-px min-h-11 shrink-0 whitespace-nowrap rounded-t-lg px-3 py-2.5 text-[13px] font-medium transition",
            value === t.id ? "border-b-2 border-accent text-ink" : "border-b-2 border-transparent text-muted hover:text-ink"
          )}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.hint ? <span className="ml-1.5 text-[11px] font-normal text-rose-600">{t.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-[#111318]/50 p-0 backdrop-blur-[2px] sm:place-items-center sm:p-6" onClick={onClose}>
      <Card
        className={cn(
          "h-[min(92dvh,100%)] w-full overflow-y-auto rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:p-6",
          wide ? "sm:max-w-5xl" : "sm:max-w-lg"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h3 className="pr-4 text-[16px] font-semibold tracking-tight sm:text-lg">{title}</h3>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] text-muted hover:bg-paper hover:text-ink" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("border-b border-line bg-paper/80 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, mono }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle text-[13px]", mono && "font-mono text-[12px] tabular-nums", className)}>{children}</td>;
}
