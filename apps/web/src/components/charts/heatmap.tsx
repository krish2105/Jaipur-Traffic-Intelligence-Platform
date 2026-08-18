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
    // Genuinely fluid rather than a 420px block behind a scrollbar. The gap and
    // the day-label column shrink with the container, so 24 hours fit at 360px
    // without sideways scrolling — a heatmap you have to drag is one nobody
    // reads the right-hand end of, and the evening peak lives there.
    //
    // `overflow-x-auto` stays as the floor: below ~300px the cells would fall
    // under a pixel and the row would stop being a chart at all.
    <div className="w-full overflow-x-auto">
      <div className="min-w-[300px]">
        <div className="flex gap-[1px] sm:gap-[3px]">
          <div className="w-5 shrink-0 sm:w-8" />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="min-w-0 flex-1 text-center font-mono text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-label) * 0.8)" }}
            >
              {/* Every sixth hour on a phone, every third once there is room:
                  a label per hour turns into a grey smear at this width. */}
              <span className="hidden sm:inline">{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>
              <span className="sm:hidden">{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>
            </div>
          ))}
        </div>
        {matrix.map((row, d) => (
          <div
            key={days[d] ?? d}
            className="mt-[1px] flex items-center gap-[1px] sm:mt-[3px] sm:gap-[3px]"
          >
            <div
              className="w-5 shrink-0 truncate text-[var(--ink-muted)] sm:w-8"
              style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
            >
              {/* One letter on a phone, three once the column is wide enough. */}
              <span className="hidden sm:inline">{days[d]}</span>
              <span className="sm:hidden">{(days[d] ?? "").slice(0, 1)}</span>
            </div>
            {row.map((value, h) => (
              <div
                key={h}
                className="h-3 min-w-0 flex-1 rounded-[1px] transition-opacity hover:opacity-70
                           sm:h-4 sm:rounded-[2px]"
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
