"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";

import type { BlackSpots, Camera, CountsSummary, Corridor, Forecast, SignalAdvisory } from "@/lib/api";
import type { SceneLink } from "@/components/city/city-view";
import type { BuildingBox } from "@/components/city/buildings";
import { City } from "@/components/city/city-scene.loader";
import { boundsOf, centroidOf, projectLine } from "@/lib/geo";
import { RAMP_NIGHT } from "@/components/city/ramp";
import type { Locale } from "@/i18n/routing";
import { ModeDot } from "./primitives";
import {
  BlackSpotPanel,
  CompositionPanel,
  CountsPanel,
  ForecastPanel,
  IncidentPanel,
  QualityPanel,
  SignalPanel,
} from "./panels";

const NAV = [
  { id: "dashboard", en: "Dashboard", hi: "डैशबोर्ड" },
  { id: "map", en: "Live map", hi: "लाइव मानचित्र" },
  { id: "counts", en: "Counts", hi: "गणना" },
  { id: "junctions", en: "Junctions", hi: "चौराहे" },
  { id: "incidents", en: "Incidents", hi: "घटनाएँ" },
  { id: "signals", en: "Signals", hi: "सिग्नल" },
  { id: "enforcement", en: "Enforcement", hi: "प्रवर्तन" },
  { id: "neeti", en: "NEETI", hi: "नीति" },
  { id: "reports", en: "Reports", hi: "रिपोर्ट" },
] as const;

/**
 * Operations console.
 *
 * The layout a traffic department already recognises — left nav, map centre,
 * KPI rail, alert ticker — so nobody has to learn it in the room. What differs
 * from every ICCC dashboard in the country is what the panels contain: not
 * "total vehicles", but what those vehicles ARE.
 */
export function ConsoleShell({
  corridors,
  summary,
  cameras,
  forecast,
  links,
  buildings,
  blackspots,
  signals,
}: {
  corridors: Corridor[];
  summary: CountsSummary;
  cameras: Camera[];
  forecast: Forecast;
  links: SceneLink[];
  buildings: BuildingBox[];
  blackspots: BlackSpots;
  signals: SignalAdvisory;
}) {
  const locale = useLocale() as Locale;
  const [active, setActive] = useState<string>("dashboard");
  const [threeD, setThreeD] = useState(true);
  const corridor = corridors[0];

  // useMemo, not an IIFE. Rebuilt every render, `data` is a new object each
  // time, so the road geometry rebuilds every frame; that trips the
  // frame-budget guard, which calls setQuality, which re-renders — a loop that
  // never settles and leaves the pane blank. /city always memoised this; the
  // console did not, and that was the whole difference.
  const scene = useMemo(() => {
    const centre = centroidOf(links.map((l) => l.coordinates));
    const projected = links.map((l) => ({ link: l, points: projectLine(l.coordinates, centre) }));
    const bounds = boundsOf(projected.flatMap((p) => p.points));
    return {
      origin: centre,
      radius: bounds.radius,
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

  const measured = links.filter((l) => l.flow > 0).length;

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] bg-[var(--ground)] text-[var(--ink)]">
      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 border-b border-[var(--rule)] bg-[var(--surface)] px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg leading-none tracking-tight">PRAVAAH</span>
          <span className="text-sm text-[var(--ink-muted)]" lang="hi">प्रवाह</span>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full border border-[var(--rule-strong)]
                     px-2.5 py-1 text-[10px] uppercase tracking-widest text-[var(--ink-muted)]"
        >
          <ModeDot live title="System operational" /> Operational
        </span>
        <span className="ml-2 text-xs text-[var(--ink-muted)]">
          {corridor ? (locale === "hi" ? corridor.name.hi : corridor.name.en) : "—"} ·{" "}
          {measured} of {links.length} links instrumented
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--ink-muted)]">
          {new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date())}{" "}
          IST
        </span>
      </header>

      {/* ── nav | map | rail ────────────────────────────────────────────── */}
      <div className="grid min-h-0 grid-cols-[168px_1fr_312px]">
        <nav className="overflow-y-auto border-r border-[var(--rule)] bg-[var(--surface)] py-2">
          <ul>
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActive(item.id)}
                  aria-current={active === item.id ? "page" : undefined}
                  className="flex w-full items-center gap-2 border-l-2 border-transparent px-3.5 py-2
                             text-left text-[13px] text-[var(--ink-muted)] transition-colors
                             hover:bg-[var(--surface-2)] hover:text-[var(--ink)]
                             aria-[current=page]:border-l-[var(--accent)]
                             aria-[current=page]:bg-[var(--surface-2)]
                             aria-[current=page]:text-[var(--ink)]"
                >
                  {locale === "hi" ? item.hi : item.en}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="relative min-w-0">
          {threeD ? (
            <City
              data={scene.data}
              radius={scene.radius}
              origin={scene.origin}
              scene="night"
              fallback={<MapFallback links={links} />}
            />
          ) : (
            <MapFallback links={links} />
          )}
          {/* docs/06 §3 specifies this toggle on the map. */}
          <div className="absolute left-3 top-3 flex gap-1 rounded-lg border border-[var(--rule-strong)] bg-[var(--surface)]/85 p-1 backdrop-blur">
            {(["2D", "3D"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setThreeD(mode === "3D")}
                aria-pressed={threeD === (mode === "3D")}
                className="rounded px-2.5 py-1 text-[11px] text-[var(--ink-muted)]
                           transition-colors aria-pressed:bg-[var(--accent)]
                           aria-pressed:text-[var(--accent-ink)]"
              >
                {mode}
              </button>
            ))}
          </div>
        </main>

        <aside className="min-h-0 space-y-2.5 overflow-y-auto border-l border-[var(--rule)] bg-[var(--ground)] p-2.5">
          <CountsPanel summary={summary} />
          <CompositionPanel summary={summary} />
          <ForecastPanel forecast={forecast} />
          <QualityPanel summary={summary} cameras={cameras} />
          <IncidentPanel />
          <BlackSpotPanel data={blackspots} />
          <SignalPanel data={signals} />
        </aside>
      </div>

      {/* ── alert ticker ────────────────────────────────────────────────── */}
      <footer className="flex items-center gap-6 overflow-x-auto border-t border-[var(--rule)] bg-[var(--surface)] px-4 py-2 text-[11px]">
        <span className="shrink-0 uppercase tracking-widest text-[var(--ink-muted)]">Alerts</span>
        <span className="shrink-0 text-[var(--ink-muted)]">
          Seeded corridor — incident layer not yet wired
        </span>
        <span className="ml-auto shrink-0 text-[var(--accent)]">Simulated data</span>
      </footer>
    </div>
  );
}

/** The 2D surface. Designed, not a stub — ADR-015. */
function MapFallback({ links }: { links: SceneLink[] }) {
  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
            <th className="pb-2 font-medium">Link</th>
            <th className="pb-2 text-right font-medium">Index</th>
            <th className="pb-2 text-right font-medium">Flow</th>
            <th className="pb-2 text-right font-medium">Speed</th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.link_id} className="border-t border-[var(--rule)]">
              <td className="py-1.5">
                <span className="mr-2 inline-block size-1.5 rounded-full align-middle"
                  style={{
                    background: l.suppressed
                      ? "var(--quality-suppressed)"
                      : `var(--congestion-${
                          l.congestion_index <= 25 ? "free"
                          : l.congestion_index <= 50 ? "light"
                          : l.congestion_index <= 70 ? "moderate"
                          : l.congestion_index <= 85 ? "severe" : "critical"})`,
                  }}
                />
                {l.name.en}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {l.congestion_index.toFixed(0)}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                {l.flow > 0 ? Math.round(l.flow).toLocaleString("en-IN") : "—"}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                {l.speed_kmh.toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
