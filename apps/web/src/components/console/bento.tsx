"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";

import type {
  BlackSpots,
  Camera,
  Corridor,
  CountsSummary,
  Forecast,
  SignalAdvisory,
  SourceReadiness,
  WeatherNow,
} from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { BuildingBox } from "@/components/city/buildings";
import { City } from "@/components/city/city-scene.loader";
import { RAMP_NIGHT } from "@/components/city/ramp";
import { boundsOf, centroidOf, projectLine } from "@/lib/geo";
import type { Locale } from "@/i18n/routing";
import {
  BlackSpotPanel,
  CompositionPanel,
  CountsPanel,
  ForecastPanel,
  IncidentPanel,
  QualityPanel,
  ReadinessPanel,
  SignalPanel,
  WeatherPanel,
} from "./panels";
import { ModeDot } from "./primitives";

/**
 * Bento command.
 *
 * The same panels as the operations console, arranged as a modular grid rather
 * than a fixed rail — so the story can be reordered per audience (counts
 * forward for JDA, enforcement forward for Traffic Police) and any tile can be
 * expanded to fill the screen for a wall display.
 *
 * Sharing the panel components is the whole point: this shell is a layout, not
 * a second product. Choosing between the two costs nothing downstream.
 */

interface Tile {
  id: string;
  /** Tailwind span classes at the `lg` breakpoint. */
  span: string;
  render: () => ReactNode;
  label: string;
}

export function BentoShell({
  corridors,
  summary,
  cameras,
  forecast,
  links,
  buildings,
  blackspots,
  signals,
  readiness,
  weather,
}: {
  corridors: Corridor[];
  summary: CountsSummary;
  cameras: Camera[];
  forecast: Forecast;
  links: SceneLink[];
  buildings: BuildingBox[];
  blackspots: BlackSpots;
  signals: SignalAdvisory;
  readiness: SourceReadiness;
  weather: WeatherNow;
}) {
  const locale = useLocale() as Locale;
  const [expanded, setExpanded] = useState<string | null>(null);
  const corridor = corridors[0];

  // Memoised for the same reason the console's is: an unmemoised scene object
  // rebuilds the road geometry every frame and never settles.
  const scene = useMemo(() => {
    const centre = centroidOf(links.map((l) => l.coordinates));
    const projected = links.map((l) => ({ link: l, points: projectLine(l.coordinates, centre) }));
    return {
      origin: centre,
      radius: boundsOf(projected.flatMap((p) => p.points)).radius,
      data: {
        ramp: RAMP_NIGHT,
        roads: projected.map(({ link, points }) => ({
          points,
          congestionIndex: link.congestion_index,
          width: Math.max(0.7, link.lanes * 0.35),
          suppressed: link.suppressed,
        })),
        traffic: projected.map(({ link, points }) => ({
          points,
          flow: link.flow,
          speedKmh: link.speed_kmh,
          suppressed: link.suppressed,
          classMix: link.class_mix ?? {},
        })),
        buildings,
      },
    };
  }, [links, buildings]);

  // Escape closes an expanded tile — a full-screen panel with no visible way
  // out is a trap, and a wall display has no obvious close button to aim at.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const mapTile = useCallback(
    () => (
      <div className="relative h-full min-h-[280px] overflow-hidden rounded-xl border border-[var(--rule)]">
        <City
          data={scene.data}
          radius={scene.radius}
          origin={scene.origin}
          scene="night"
          fallback={
            <div className="grid h-full place-items-center text-[12px] text-[var(--ink-muted)]">
              2D view
            </div>
          }
        />
      </div>
    ),
    [scene],
  );

  const tiles: Tile[] = useMemo(
    () => [
      { id: "map", label: "Live map", span: "lg:col-span-2 lg:row-span-2", render: mapTile },
      { id: "counts", label: "Counts", span: "", render: () => <CountsPanel summary={summary} /> },
      {
        id: "composition",
        label: "Composition",
        span: "lg:row-span-2",
        render: () => <CompositionPanel summary={summary} />,
      },
      { id: "forecast", label: "Forecast", span: "", render: () => <ForecastPanel forecast={forecast} /> },
      {
        id: "quality",
        label: "Data quality",
        span: "",
        render: () => <QualityPanel summary={summary} cameras={cameras} />,
      },
      {
        id: "blackspots",
        label: "Black spots",
        span: "lg:col-span-2",
        render: () => <BlackSpotPanel data={blackspots} />,
      },
      { id: "signals", label: "Signals", span: "", render: () => <SignalPanel data={signals} /> },
      { id: "incidents", label: "Incidents", span: "", render: () => <IncidentPanel /> },
      { id: "weather", label: "Conditions", span: "", render: () => <WeatherPanel data={weather} /> },
      {
        id: "readiness",
        label: "Readiness",
        span: "lg:col-span-2",
        render: () => <ReadinessPanel data={readiness} />,
      },
    ],
    [mapTile, summary, forecast, cameras, blackspots, signals, weather, readiness],
  );

  const focused = tiles.find((t) => t.id === expanded);

  return (
    <div className="min-h-dvh bg-[var(--ground)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-[var(--rule)] bg-[var(--surface)]/92 px-4 py-2.5 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg leading-none tracking-tight">PRAVAAH</span>
          <span className="text-sm text-[var(--ink-muted)]" lang="hi">प्रवाह</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-[var(--rule-strong)] px-2.5 py-1 text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
          <ModeDot live title="System operational" /> Operational
        </span>
        <span className="text-xs text-[var(--ink-muted)]">
          {corridor ? (locale === "hi" ? corridor.name.hi : corridor.name.en) : "—"}
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--ink-muted)]">
          {readiness.live_count}/{readiness.total} sources live
        </span>
      </header>

      <main
        className="grid auto-rows-[minmax(150px,auto)] gap-2.5 p-2.5
                   grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
      >
        {tiles.map((tile) => (
          <section key={tile.id} className={`relative min-w-0 ${tile.span}`}>
            {tile.render()}
            <button
              type="button"
              onClick={() => setExpanded(tile.id)}
              aria-label={`Expand ${tile.label}`}
              className="absolute right-1.5 top-1.5 rounded-md px-1.5 py-1 text-[11px]
                         text-[var(--ink-faint)] opacity-0 transition
                         hover:bg-[var(--surface-2)] hover:text-[var(--ink)]
                         focus-visible:opacity-100 group-hover:opacity-100
                         [section:hover_&]:opacity-100"
            >
              ⤢
            </button>
          </section>
        ))}
      </main>

      {focused && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={focused.label}
          onClick={() => setExpanded(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-5xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[var(--ink-muted)]">
                {focused.label}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(null)}
                className="rounded-md px-2 py-1 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Close · Esc
              </button>
            </div>
            <div className={focused.id === "map" ? "h-[78vh]" : ""}>{focused.render()}</div>
          </div>
        </div>
      )}
    </div>
  );
}
