"use client";

import { useLocale } from "next-intl";

import type { CountsSummary, DayProfile } from "@/lib/api";
import { formatCompact, formatPercent } from "@/lib/format";
import type { Locale } from "@/i18n/routing";
import { DayProfileChart } from "@/components/charts/day-profile";

export type CardStyle = "elevated" | "telemetry" | "editorial";

export const CARD_STYLES: { id: CardStyle; label: string; blurb: string }[] = [
  {
    id: "elevated",
    label: "Surface elevation",
    blurb:
      "No borders. Depth comes from surface colour, which is how dark interfaces actually signal it — a lighter surface reads as closer. Generous padding, one headline figure, one chart.",
  },
  {
    id: "telemetry",
    label: "Command telemetry",
    blurb:
      "Hairline borders, faint grid, monospace throughout, more numbers per panel. Reads as an instrument rather than a product. Denser, and harder on a projector.",
  },
  {
    id: "editorial",
    label: "Editorial data",
    blurb:
      "Half the panels, twice the size. The figure carries the panel. Most memorable in a room; you scroll or tab to reach everything, which costs you in operations.",
  },
];

/** The same Counts panel, three ways, on the same live data. */
export function CountsCard({
  style,
  summary,
  profile,
  nowMinutes,
}: {
  style: CardStyle;
  summary: CountsSummary;
  profile: DayProfile;
  /** Null before mount, so the marker is absent rather than at midnight. */
  nowMinutes: number | null;
}) {
  const locale = useLocale() as Locale;
  const q = summary.data_quality;
  const vehicles = formatCompact(summary.total_vehicles, locale);
  const pcu = formatCompact(summary.total_pcu, locale);

  if (style === "telemetry") {
    return (
      <section
        className="rounded-[var(--d-radius)] border border-[var(--rule-strong)] bg-[var(--surface)]"
        style={{ padding: "var(--d-pad)" }}
      >
        <header className="flex items-center justify-between border-b border-[var(--rule)] pb-2">
          <span
            className="font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]"
            style={{ fontSize: "var(--d-label)" }}
          >
            counts · live
          </span>
          <span className="font-mono text-[var(--congestion-free)]" style={{ fontSize: "var(--d-label)" }}>
            ● OK
          </span>
        </header>
        {/* Three cells share the width, so the figure has to be scaled down
            from the token or they collide — which they did, rendering as one
            run-together number. clamp keeps it legible without overflowing at
            any density. */}
        <div className="mt-3 grid grid-cols-3 gap-3 font-mono">
          {[
            { k: "VEH", v: vehicles },
            { k: "PCU", v: pcu },
            { k: "QUAL", v: q.mean_score.toFixed(2) },
          ].map((cell) => (
            <div key={cell.k}>
              <div
                className="truncate text-[var(--ink)] tabular-nums"
                style={{
                  fontSize: "clamp(1rem, calc(var(--d-figure) * 0.52), 1.75rem)",
                  lineHeight: 1.05,
                }}
              >
                {cell.v}
              </div>
              <div className="mt-1 text-[var(--ink-faint)]" style={{ fontSize: "var(--d-label)" }}>
                {cell.k}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-[var(--rule)] pt-3">
          <DayProfileChart points={profile.points} nowMinutes={nowMinutes} />
        </div>
        <div
          className="mt-2 flex justify-between font-mono text-[var(--ink-faint)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </section>
    );
  }

  if (style === "editorial") {
    return (
      <section
        className="rounded-[calc(var(--d-radius)*1.5)] bg-[var(--surface)]"
        style={{ padding: "calc(var(--d-pad) * 1.6)" }}
      >
        <p
          className="uppercase tracking-[0.2em] text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          Measured flow · Tonk Road
        </p>
        <p
          className="font-mono tabular-nums text-[var(--ink)]"
          style={{
            fontSize: "clamp(2.5rem, calc(var(--d-figure) * 1.6), 5rem)",
            lineHeight: 0.95,
            marginTop: "0.35em",
          }}
        >
          {vehicles}
        </p>
        <p className="mt-3 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-body)" }}>
          vehicles today · {pcu} PCU · quality {q.mean_score.toFixed(2)}
        </p>
        <div className="mt-6">
          <DayProfileChart
            points={profile.points}
            nowMinutes={nowMinutes}
            height={140}
          />
        </div>
      </section>
    );
  }

  // elevated — the recommended one
  return (
    <section
      className="rounded-[var(--d-radius)] bg-[var(--surface-2)]"
      style={{ padding: "var(--d-pad)", boxShadow: "var(--rim)" }}
    >
      <header className="flex items-center justify-between">
        <span
          className="uppercase tracking-[0.14em] text-[var(--ink-muted)]"
          style={{ fontSize: "var(--d-label)" }}
        >
          Counts · live
        </span>
        <span
          className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 uppercase tracking-wider text-[var(--accent)]"
          style={{ fontSize: "calc(var(--d-label) * 0.85)" }}
        >
          Simulated
        </span>
      </header>

      <div className="mt-4 flex items-end gap-6">
        <div>
          <p
            className="font-mono tabular-nums text-[var(--ink)]"
            style={{ fontSize: "var(--d-figure)", lineHeight: 1 }}
          >
            {vehicles}
          </p>
          <p className="mt-1.5 text-[var(--ink-muted)]" style={{ fontSize: "var(--d-support)" }}>
            vehicles
          </p>
        </div>
        <div>
          <p
            className="font-mono tabular-nums text-[var(--ink-muted)]"
            style={{ fontSize: "calc(var(--d-figure) * 0.62)", lineHeight: 1 }}
          >
            {pcu}
          </p>
          <p className="mt-1.5 text-[var(--ink-faint)]" style={{ fontSize: "var(--d-support)" }}>
            PCU
          </p>
        </div>
      </div>

      <div className="mt-5">
        <DayProfileChart points={profile.points} nowMinutes={nowMinutes} />
      </div>

      <p
        className="mt-3 text-[var(--ink-muted)]"
        style={{ fontSize: "var(--d-support)" }}
      >
        quality {q.mean_score.toFixed(2)} · {formatPercent(q.suppressed_pct, locale)} of bins
        suppressed and excluded
      </p>
    </section>
  );
}
