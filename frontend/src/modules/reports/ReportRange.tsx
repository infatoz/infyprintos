import { cn } from "@/lib/cn";
import { REPORT_PRESETS, type ReportPreset } from "@/lib/reports";
import { Input } from "@/components/ui";

export function ReportRangeBar({
  preset,
  fromDay,
  toDay,
  onPreset,
  onFromDay,
  onToDay
}: {
  preset: ReportPreset | "custom";
  fromDay: string;
  toDay: string;
  onPreset: (preset: ReportPreset) => void;
  onFromDay: (value: string) => void;
  onToDay: (value: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1">
        {REPORT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p.id)}
            className={cn(
              "h-9 rounded-lg px-3 text-[13px] font-medium transition",
              preset === p.id ? "bg-accent text-white shadow-sm" : "border border-line bg-surface text-ink hover:bg-paper"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={fromDay} onChange={(e) => onFromDay(e.target.value)} className="w-auto min-w-[9.5rem]" aria-label="From date" />
        <span className="text-[12px] text-muted">to</span>
        <Input type="date" value={toDay} onChange={(e) => onToDay(e.target.value)} className="w-auto min-w-[9.5rem]" aria-label="To date" />
      </div>
    </div>
  );
}
