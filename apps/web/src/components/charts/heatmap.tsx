"use client";

import { congestionVar } from "@/lib/api";

/**
 * Congestion heatmap — seven days by twenty-four hours.
 *
 * The weekly pattern at a glance: which evenings are worst, whether Friday
 * really is the peak. docs/01 §2 names Friday 17 October 2025 as TomTom's worst
 * Jaipur day of the year, and this is the view where a claim like that becomes
 * checkable rather than quoted.
 *
 * Measured history, not a forecast — a distinction worth keeping, because your
 * reference portal shows a "predictive" heatmap with nothing behind it.
 */
export function CongestionHeatmap({
  matrix,
  days,
}: {
  /** [day][hour] congestion index 0-100 */
  matrix: number[][];
  days: string[];
}) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[420px]">
        <div className="flex gap-[3px]">
          <div className="w-8 shrink-0" />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="flex-1 text-center font-mono text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-label) * 0.8)" }}
            >
              {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
            </div>
          ))}
        </div>
        {matrix.map((row, d) => (
          <div key={days[d] ?? d} className="mt-[3px] flex items-center gap-[3px]">
            <div
              className="w-8 shrink-0 text-[var(--ink-muted)]"
              style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
            >
              {days[d]}
            </div>
            {row.map((value, h) => (
              <div
                key={h}
                className="h-4 flex-1 rounded-[2px] transition-opacity hover:opacity-70"
                style={{ background: congestionVar(value), opacity: 0.25 + (value / 100) * 0.75 }}
                title={`${days[d]} ${String(h).padStart(2, "0")}:00 — ${value.toFixed(0)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
