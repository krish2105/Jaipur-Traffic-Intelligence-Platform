"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { CountsSummary, DayProfile } from "@/lib/api";
import { GnomonArc } from "@/components/instrument/gnomon-arc";
import { ClassMixPanel, CorridorMetrics } from "@/components/dashboard/panels";
import { DIRECTIONS, type Direction } from "@/components/theme/use-theme";

const THEMES = ["light", "dark"] as const;

/**
 * Each tile is a real, live dashboard fragment scoped to one direction and one
 * theme. The `data-direction` / `data-theme` attributes are set on the tile
 * itself rather than on <html>, so all six render side by side on the same
 * page, on the same data, at the same moment.
 */
export function DirectionGallery({
  summary,
  profile,
}: {
  summary: CountsSummary;
  profile: DayProfile;
}) {
  const t = useTranslations("design");
  const [focus, setFocus] = useState<Direction | null>(null);
  const shown = focus ? [focus] : DIRECTIONS;

  return (
    <div className="space-y-(--space-6)">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFocus(null)}
          aria-pressed={focus === null}
          className="rounded-(--radius-token) border border-rule px-3 py-1.5 text-sm
                     transition-colors aria-pressed:bg-accent aria-pressed:text-accent-ink"
        >
          {t("compareAll")}
        </button>
        {DIRECTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setFocus(d)}
            aria-pressed={focus === d}
            className="rounded-(--radius-token) border border-rule px-3 py-1.5 text-sm
                       transition-colors aria-pressed:bg-accent aria-pressed:text-accent-ink"
          >
            {t(`direction.${d}`)}
          </button>
        ))}
      </div>

      {shown.map((direction) => (
        <section key={direction}>
          <h2 className="text-(length:--type-h2) font-medium">{t(`direction.${direction}`)}</h2>
          <p className="mt-1 max-w-prose text-(length:--type-caption) text-ink-muted">
            {t(`blurb.${direction}`)}
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {THEMES.map((theme) => (
              <div
                key={theme}
                data-direction={direction}
                data-theme={theme}
                className="overflow-hidden rounded-(--radius-token-lg) border border-rule bg-ground"
              >
                <div className="flex items-center justify-between border-b border-rule px-4 py-2">
                  <span className="text-(length:--type-caption) uppercase tracking-widest text-ink-muted">
                    {t(`theme.${theme}`)}
                  </span>
                  <span className="text-(length:--type-caption) text-ink-muted">
                    {direction}
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  <GnomonArc
                    points={profile.points}
                    peak={profile.peak}
                    nowMinutes={12 * 60}
                    className="mx-auto max-w-sm"
                  />
                  <CorridorMetrics
                    vehicles={summary.total_vehicles}
                    pcu={summary.total_pcu}
                    peakHour={summary.peak_hour}
                  />
                  <ClassMixPanel mix={summary.class_mix} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
