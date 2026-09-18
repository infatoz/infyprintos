export const REPORT_PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
  { id: "fy", label: "This FY" }
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number]["id"];

export function startOfDay(d: Date) {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(d: Date) {
  const next = new Date(d);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function isoDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rangeFromPreset(preset: ReportPreset, fyMonth = 4) {
  const now = new Date();
  const to = endOfDay(now);
  let from = startOfDay(now);
  if (preset === "7d") from = startOfDay(new Date(now.getTime() - 6 * 86_400_000));
  else if (preset === "30d") from = startOfDay(new Date(now.getTime() - 29 * 86_400_000));
  else if (preset === "month") from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  else if (preset === "fy") {
    const month = now.getMonth() + 1;
    const year = month >= fyMonth ? now.getFullYear() : now.getFullYear() - 1;
    from = new Date(year, fyMonth - 1, 1, 0, 0, 0, 0);
  }
  return { from: from.toISOString(), to: to.toISOString(), fromDay: isoDay(from), toDay: isoDay(to) };
}

export function groupForRange(fromIso: string, toIso: string) {
  const days = Math.max(1, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
  if (days > 90) return "month";
  if (days > 21) return "week";
  return "day";
}

export function reportQuery(from: string, to: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ from, to, ...(extra ?? {}) });
  return params.toString();
}
