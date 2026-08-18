"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { currentScene, serverScene, setTheme, subscribeScene } from "@/lib/theme";
import { City } from "./city-scene.loader";
import type { CityData } from "./city-scene";
import { boundsOf, centroidOf, projectLine } from "@/lib/geo";
import type { Ramp } from "@/lib/ribbon";

/**
 * Jaipur Night is the product palette (ADR-016).
 *
 * The other three stay defined in palettes.css and are still measured by
 * scripts/check_contrast.py, so reverting is a one-line change — but the
 * switcher itself is gone. It was a decision aid, the decision has been taken,
 * and shipping an evaluation control to a government audience invites the
 * question "which one is the real one?"
 */
export const PALETTES = [
  { id: "night", label: "Jaipur Night", note: "indigo + molten brass" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

/**
 * Congestion ramps for the WebGL layer, keyed by palette.
 *
 * Declared here rather than read back out of CSS. Reading computed style was
 * how every palette ended up rendering the first one's colours: the attribute
 * is set by an effect, so a build during render sees the palette being left,
 * not the one being entered. These values mirror palettes.css, and
 * scripts/check_contrast.py measures that file — the DOM keeps its own copy for
 * the HTML layer, the scene gets deterministic values with no timing to get
 * wrong.
 */
const RAMPS: Record<PaletteId, Ramp> = {
  night: {
    free: "#2DD4A7",
    light: "#8CD65B",
    moderate: "#FFB020",
    severe: "#FF6B4A",
    critical: "#FF2D55",
    suppressed: "#6B7280",
  },
};

export interface SceneLink {
  link_id: number;
  name: { en: string; hi: string };
  lanes: number;
  coordinates: [number, number][];
  congestion_index: number;
  flow: number;
  speed_kmh: number;
  /** Whether that speed was seen by a camera or derived from the index. */
  speed_source?: "measured" | "modelled";
  free_flow_kmh?: number;
  suppressed: boolean;
  class_mix?: Record<string, number>;
}

export function CityView({
  links: initialLinks,
  buildings,
  initialPalette = "night",
}: {
  links: SceneLink[];
  buildings: CityData["buildings"];
  initialPalette?: PaletteId;
}) {
  const palette = initialPalette;
  // Night is the control-room native mode; day is the public-facing one. The
  // value is read from the document rather than held here — this component
  // previously owned a second copy, and its effect re-asserted night over
  // whatever the header toggle had just set.
  const scene = useSyncExternalStore(subscribeScene, currentScene, serverScene);
  /** Hour of the seeded day the whole city is rendered at. */
  const [hour, setHour] = useState<number | null>(null);
  const [liveLinks, setLiveLinks] = useState<SceneLink[] | null>(null);

  // Scrubbing re-resolves every link at that moment. One request per release,
  // not per pixel — the slider commits on change, not on drag.
  useEffect(() => {
    if (hour === null) return;
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";
    const day = new Date();
    day.setDate(day.getDate() - 1);
    const stamp = `${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00+05:30`;
    const controller = new AbortController();
    fetch(`${base}/api/v1/scene?corridor_id=1&at=${encodeURIComponent(stamp)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLiveLinks(d.links as SceneLink[]))
      .catch(() => {});
    return () => controller.abort();
  }, [hour]);

  // The palette lives on <html> so the CSS variables cascade to the glass
  // panels AND are readable by the WebGL layer, which resolves the congestion
  // ramp from computed style rather than duplicating hex values in JS.
  // Derived, not stateful: no effect, no cascading render, and nothing that can
  // observe the wrong palette mid-build.
  const ramp = RAMPS[palette];

  // The attribute sync is a genuine external-system update — the CSS layer
  // needs it — and sets no React state.
  useEffect(() => {
    document.documentElement.setAttribute("data-palette", palette);
  }, [palette]);


  const links = liveLinks ?? initialLinks;

  const { data, radius, origin } = useMemo(() => {
    // Centre on the geometry we actually have, so the camera always frames the
    // city rather than a hardcoded coordinate near it.
    const centre = centroidOf(links.map((l) => l.coordinates));
    const projected = links.map((l) => ({
      link: l,
      points: projectLine(l.coordinates, centre),
    }));
    const bounds = boundsOf(projected.flatMap((p) => p.points));
    const scene: CityData = {
      roads: projected.map(({ link, points }) => ({
        points,
        congestionIndex: link.congestion_index,
        // True-to-scale: ~3.5 m per lane, and one scene unit is 10 m. A
        // six-lane trunk comes out at 21 m, which is what Tonk Road actually
        // is. The previous value was up to 50 m wide and made every road look
        // like a runway.
        width: Math.max(0.7, link.lanes * 0.35),
        suppressed: link.suppressed,
      })),
      traffic: projected.map(({ link, points }) => ({
        points,
        flow: link.flow,
        speedKmh: link.speed_kmh,
        suppressed: link.suppressed,
        // Each link populates from its OWN measured composition.
        classMix: link.class_mix ?? {},
      })),
      buildings,
      ramp,
    };
    return { data: scene, radius: bounds.radius, origin: centre };
  }, [links, buildings, ramp]);

  const measured = links.filter((l) => l.flow > 0);
  const totalFlow = Math.round(measured.reduce((s, l) => s + l.flow, 0));

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[var(--ground)]">
      {/* key forces a full remount on palette change so the merged road
          geometry re-resolves its vertex colours from the new ramp */}
      <City data={data} scene={scene} radius={radius} origin={origin} fallback={<Fallback links={links} />} />

      {/* ── glass overlay ───────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 md:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="pointer-events-auto glass rounded-2xl px-5 py-4">
            <p className="font-display text-2xl leading-none tracking-tight text-[var(--ink)]">
              PRAVAAH
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]" lang="hi">
              प्रवाह · टोंक रोड
            </p>
          </div>

          <div className="pointer-events-auto glass flex items-center gap-1 rounded-2xl p-1.5">
            <button
              type="button"
              onClick={() => setTheme(scene === "night" ? "day" : "night")}
              aria-label={scene === "night" ? "Switch to day" : "Switch to night"}
              className="rounded-xl px-3.5 py-2 text-sm text-[var(--ink-muted)]
                         transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <span aria-hidden="true">{scene === "night" ? "☾" : "☀"}</span>
            </button>
          </div>
        </header>

        <footer className="flex flex-wrap items-end justify-between gap-4">
          <div className="pointer-events-auto glass rounded-2xl px-5 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              Measured flow · live
            </p>
            <p className="mt-1 font-mono text-4xl leading-none tabular-nums text-[var(--ink)]">
              {new Intl.NumberFormat("en-IN").format(totalFlow)}
              <span className="ml-2 text-sm text-[var(--ink-muted)]">veh/hr</span>
            </p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              {measured.length} of {links.length} links instrumented ·{" "}
              <span className="text-[var(--accent)]">Simulated data</span>
            </p>
          </div>

          <div className="pointer-events-auto glass flex-1 rounded-2xl px-5 py-4 sm:max-w-md">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {hour === null ? "Live" : "Time travel"}
              </p>
              <p className="font-mono text-sm tabular-nums text-[var(--ink)]">
                {hour === null
                  ? "now"
                  : `${String(hour).padStart(2, "0")}:00 IST`}
              </p>
            </div>
            <input
              type="range"
              min={0}
              max={23}
              step={1}
              value={hour ?? new Date().getHours()}
              onChange={(e) => setHour(Number(e.target.value))}
              aria-label="Scrub the city through the day"
              className="mt-3 w-full accent-[var(--accent)]"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--ink-muted)]">
              <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
            </div>
          </div>

          <div className="pointer-events-auto glass rounded-2xl px-5 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              Congestion
            </p>
            <div className="mt-2 flex items-center gap-1">
              {(["free", "light", "moderate", "severe", "critical"] as const).map((band) => (
                <span
                  key={band}
                  className="h-2 w-9 rounded-full"
                  style={{ background: `var(--congestion-${band})` }}
                  title={band}
                />
              ))}
            </div>
            <p className="mt-2 font-mono text-xs text-[var(--ink-muted)]">0 — 100</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** The 2D front door. Designed, not a stub — see ADR-015. */
function Fallback({ links }: { links: SceneLink[] }) {
  const measured = links.filter((l) => l.flow > 0);
  return (
    <div className="absolute inset-0 overflow-auto p-8">
      <p className="font-display text-4xl tracking-tight text-[var(--ink)]">Tonk Road</p>
      <p className="mt-1 text-[var(--ink-muted)]">
        Yaadgaar to Sanganer · {links.length} links · {measured.length} instrumented
      </p>
      <ul className="mt-8 space-y-2">
        {links.slice(0, 24).map((l) => (
          <li key={l.link_id} className="flex items-center gap-3">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: l.suppressed
                  ? "var(--quality-suppressed)"
                  : `var(--congestion-${
                      l.congestion_index <= 25
                        ? "free"
                        : l.congestion_index <= 50
                          ? "light"
                          : l.congestion_index <= 70
                            ? "moderate"
                            : l.congestion_index <= 85
                              ? "severe"
                              : "critical"
                    })`,
              }}
            />
            <span className="flex-1 truncate text-sm text-[var(--ink)]">{l.name.en}</span>
            <span className="font-mono text-xs tabular-nums text-[var(--ink-muted)]">
              {l.congestion_index.toFixed(0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
