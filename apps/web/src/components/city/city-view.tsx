"use client";

import { useEffect, useMemo, useState } from "react";

import { City } from "./city-scene.loader";
import type { CityData } from "./city-scene";
import { boundsOf, centroidOf, projectLine } from "@/lib/geo";
import type { Ramp } from "@/lib/ribbon";

export const PALETTES = [
  { id: "night", label: "Jaipur Night", note: "indigo + molten brass" },
  { id: "signal", label: "Signal", note: "charcoal + electric cyan" },
  { id: "pinkcity", label: "Pink City After Dark", note: "plum + hot coral" },
  { id: "araish", label: "Araish Reversed", note: "the original thesis, taken dark" },
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
    free: "#2DD4A7", light: "#8CD65B", moderate: "#FFB020",
    severe: "#FF6B4A", critical: "#FF2D55", suppressed: "#6B7280",
  },
  signal: {
    free: "#00E5A0", light: "#A3E635", moderate: "#FFC531",
    severe: "#FF7849", critical: "#FF3366", suppressed: "#6B7280",
  },
  pinkcity: {
    free: "#3DDC97", light: "#9BE564", moderate: "#FFB627",
    severe: "#FF6B35", critical: "#E5383B", suppressed: "#6B7280",
  },
  araish: {
    free: "#2DD4A7", light: "#8CD65B", moderate: "#FFB020",
    severe: "#FF6B4A", critical: "#FF2D55", suppressed: "#6B7280",
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
  suppressed: boolean;
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
  const [palette, setPalette] = useState<PaletteId>(initialPalette);
  /** Night is the control-room native mode; day is the public-facing one. */
  const [scene, setScene] = useState<"night" | "day">("night");
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
    document.documentElement.setAttribute("data-scene", scene);
  }, [palette, scene]);

  // Committed in the click handler as well as the effect. With only the effect,
  // the DOM lagged one click behind the button state and the two disagreed on
  // screen — visibly wrong in a demo.
  const choosePalette = (next: PaletteId) => {
    document.documentElement.setAttribute("data-palette", next);
    setPalette(next);
  };

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

          <div className="pointer-events-auto glass flex flex-wrap gap-1 rounded-2xl p-1.5">
            <button
              type="button"
              onClick={() => setScene(scene === "night" ? "day" : "night")}
              aria-label={scene === "night" ? "Switch to day" : "Switch to night"}
              className="mr-1 rounded-xl px-3 py-2 text-xs text-[var(--ink-muted)]
                         transition-colors hover:text-[var(--ink)]"
            >
              {scene === "night" ? "☾" : "☀"}
            </button>
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePalette(p.id)}
                aria-pressed={palette === p.id}
                className="rounded-xl px-3 py-2 text-xs transition-colors
                           text-[var(--ink-muted)] hover:text-[var(--ink)]
                           aria-pressed:bg-[var(--accent)] aria-pressed:text-[var(--accent-ink)]"
              >
                {p.label}
              </button>
            ))}
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
