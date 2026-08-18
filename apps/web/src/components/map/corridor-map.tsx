"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
} from "maplibre-gl";
// From the sub-packages rather than the `deck.gl` umbrella: the umbrella
// re-exports the layers but not MapboxOverlay, and both were already in the
// dependency tree as transitives. Declaring them directly means the import
// states what it actually rests on.
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";

import type { SceneLink } from "@/components/city/city-view";
import type { Locale } from "@/i18n/routing";
import { currentScene, serverScene, subscribeScene } from "@/lib/theme";
import { useSyncExternalStore } from "react";

/**
 * The 2D corridor map.
 *
 * The 3D city answers "what does this road look like". This answers "where is
 * it", which is the question an officer dispatching a vehicle actually has, and
 * it is the view that works on a five-year-old phone with no WebGL headroom.
 *
 * **The basemap is optional and its absence is designed for.** docs/03 §5
 * requires the demo to render with the network cable pulled, and a vector
 * basemap is a CDN request. So the corridor geometry — which is real
 * OpenStreetMap data already in our own payload — is drawn by deck.gl over a
 * plain themed background, and the raster basemap is layered *underneath* if it
 * happens to load. Pull the cable and the roads are still there, correctly
 * placed, correctly coloured; you simply lose the surrounding city.
 *
 * That ordering is the whole design. A map that shows nothing without tiles is
 * a map that fails in the room.
 */

const CARTO_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Empty style: valid MapLibre, zero network. The offline fallback.
 *
 * No `glyphs` key at all. An empty string is not "no glyph source" to
 * MapLibre — it is an invalid URL missing its {fontstack} and {range} tokens,
 * and it throws on every style load. The field is optional; omitting it is the
 * way to say there are no labels. */
const BLANK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [],
};

function rampColour(index: number, suppressed: boolean): [number, number, number] {
  if (suppressed) return [107, 114, 128];
  if (index <= 25) return [45, 212, 167];
  if (index <= 50) return [140, 214, 91];
  if (index <= 70) return [255, 176, 32];
  if (index <= 85) return [255, 107, 74];
  return [255, 45, 85];
}

export function CorridorMap({
  links,
  locale,
  onSelect,
}: {
  links: SceneLink[];
  locale: Locale;
  onSelect?: (link: SceneLink) => void;
}) {
  const hi = locale === "hi";
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const scene = useSyncExternalStore(subscribeScene, currentScene, serverScene);
  const [basemap, setBasemap] = useState<"pending" | "loaded" | "offline">("pending");
  const [hovered, setHovered] = useState<SceneLink | null>(null);

  const centre = useMemo(() => {
    const points = links.flatMap((l) => l.coordinates);
    if (points.length === 0) return { lon: 75.7873, lat: 26.9124 };
    const lon = points.reduce((a, p) => a + p[0], 0) / points.length;
    const lat = points.reduce((a, p) => a + p[1], 0) / points.length;
    return { lon, lat };
  }, [links]);

  // Create the map once. Re-creating it on every theme change would refetch
  // the basemap and lose the user's pan and zoom.
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: BLANK_STYLE,
      center: [centre.lon, centre.lat],
      zoom: 12.4,
      attributionControl: false,
      // The corridor is the subject; tilting it turns this back into the 3D
      // view it exists to be an alternative to.
      pitchWithRotate: false,
      dragRotate: false,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    instance.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: "© OpenStreetMap contributors",
      }),
      "bottom-left",
    );

    const deck = new MapboxOverlay({ interleaved: false, layers: [] });
    instance.addControl(deck);

    map.current = instance;
    overlay.current = deck;

    return () => {
      instance.remove();
      map.current = null;
      overlay.current = null;
    };
  }, [centre.lon, centre.lat]);

  // Try the basemap, and carry on without it. `setStyle` keeps the deck
  // overlay because it is a control, not a style layer.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    let cancelled = false;
    const url = scene === "day" ? CARTO_LIGHT : CARTO_DARK;

    fetch(url, { mode: "cors" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((style) => {
        if (cancelled || !map.current) return;
        map.current.setStyle(style);
        setBasemap("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        // No tiles. The corridor still draws — that is the point.
        setBasemap("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [scene]);

  // Redraw the corridor whenever the data or the hover changes.
  useEffect(() => {
    const deck = overlay.current;
    if (!deck) return;
    deck.setProps({
      layers: [
        new PathLayer<SceneLink>({
          id: "corridor",
          data: links,
          getPath: (l: SceneLink) => l.coordinates as [number, number][],
          getColor: (l: SceneLink) => rampColour(l.congestion_index, l.suppressed),
          // Metres, so the line thickens as you zoom in the way a road does,
          // rather than staying a constant pixel width like a diagram.
          widthUnits: "meters",
          getWidth: (l: SceneLink) => Math.max(6, l.lanes * 3.5),
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onHover: ({ object }) => setHovered((object as SceneLink) ?? null),
          onClick: ({ object }) => object && onSelect?.(object as SceneLink),
          updateTriggers: { getColor: links.map((l) => l.congestion_index).join(",") },
        }),
      ],
    });
  }, [links, onSelect]);

  return (
    <div className="relative h-full w-full" style={{ background: "var(--ground-deep)" }}>
      <div ref={container} className="h-full w-full" />

      {/* Honest about what is missing rather than looking merely empty. */}
      {basemap === "offline" && (
        <p
          className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-[var(--surface)]/85
                     px-2.5 py-1.5 text-[var(--ink-muted)] backdrop-blur"
          style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
        >
          {hi
            ? "बेसमैप उपलब्ध नहीं — कॉरिडोर ज्यामिति फिर भी वास्तविक है"
            : "Basemap unavailable — corridor geometry is still real"}
        </p>
      )}

      {hovered && (
        <div
          className="pointer-events-none absolute left-3 top-3 max-w-[16rem] rounded-xl
                     bg-[var(--surface-2)] p-3"
          style={{ boxShadow: "var(--shadow-float)" }}
        >
          <p className="truncate text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
            {hi ? hovered.name.hi : hovered.name.en}
          </p>
          <p
            className="mt-1 font-mono tabular-nums"
            style={{
              fontSize: "var(--d-support)",
              color: `rgb(${rampColour(hovered.congestion_index, hovered.suppressed).join(",")})`,
            }}
          >
            {hovered.congestion_index.toFixed(0)} / 100 · {hovered.speed_kmh.toFixed(0)} km/h
            {hovered.speed_source === "modelled" && (
              <span className="text-[var(--ink-faint)]">~</span>
            )}
          </p>
          {hovered.suppressed && (
            <p
              className="mt-1 text-[var(--ink-faint)]"
              style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
            >
              {hi ? "कम विश्वास — दबाया गया" : "low confidence — suppressed"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
