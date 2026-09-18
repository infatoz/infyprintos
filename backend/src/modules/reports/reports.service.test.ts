import { describe, expect, it } from "vitest";
import { deltaPct, groupForSpan, resolveRange, toCsv } from "./reports.service";

describe("report range helpers", () => {
  it("defaults to a 30-day window", () => {
    const range = resolveRange({});
    expect(range.preset).toBe("30d");
    expect(range.to.getTime()).toBeGreaterThan(range.from.getTime());
    expect(range.previousTo.getTime()).toBeLessThan(range.from.getTime());
  });

  it("honours an explicit from/to window", () => {
    const range = resolveRange({ from: "2026-04-01T00:00:00", to: "2026-04-30T23:59:59" });
    expect(range.preset).toBe("custom");
    expect(range.to.getTime()).toBeGreaterThan(range.from.getTime());
    expect(range.group).toBe("week");
  });

  it("picks grouping from span length", () => {
    expect(groupForSpan(new Date("2026-09-01"), new Date("2026-09-05"))).toBe("day");
    expect(groupForSpan(new Date("2026-09-01"), new Date("2026-10-10"))).toBe("week");
    expect(groupForSpan(new Date("2026-01-01"), new Date("2026-06-01"))).toBe("month");
  });

  it("computes period deltas and CSV", () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(50, 0)).toBe(100);
    expect(deltaPct(0, 0)).toBe(0);
    const csv = toCsv(["a", "b"], [["x", 'say "hi"']]);
    expect(csv).toContain("a,b");
    expect(csv).toContain('"say ""hi"""');
  });
});
