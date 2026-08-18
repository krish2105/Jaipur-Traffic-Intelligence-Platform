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
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";

import type { SceneLink } from "@/components/city/city-view";
import type { BlackSpot, Camera, Junction } from "@/lib/api";
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

/**
 * OpenStreetMap raster tiles.
 *
 * Raster rather than the vector basemap this used before, because a survey-grade
 * raster map is what reads as *cartography* — named localities, tehsil
 * boundaries, the actual street grid — and that is what makes a corridor
 * trackable rather than merely drawn. It is also one HTTP request per tile with
 * no style JSON to parse, so it degrades tile-by-tile instead of all at once.
 *
 * Attribution is mandatory under ODbL and is rendered by AttributionControl
 * below. OSM's tile usage policy does not cover heavy production traffic, so
 * this is the demo source: ADR-064 records swapping to self-hosted or keyed
 * tiles before this is deployed for real.
 */
const OSM_TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];

/**
 * The basemap has to sit *under* a pink interface without fighting it.
 *
 * OSM's default carto is a bright, high-saturation map — correct on its own,
 * wrong beneath rose-black chrome, and it would drown the congestion ramp it is
 * supposed to be a backdrop for. So the tiles are pushed back optically per
 * scene: darkened and rose-shifted at night, lightly desaturated by day. The
 * ramp is never touched, so the only saturated colour left on the map is the
 * measurement.
 */
const RASTER_PAINT = {
  night: {
    "raster-brightness-min": 0.03,
    "raster-brightness-max": 0.46,
    "raster-saturation": -0.45,
    "raster-contrast": 0.05,
    "raster-hue-rotate": 318,
    "raster-opacity": 0.9,
  },
  day: {
    "raster-brightness-min": 0.06,
    "raster-brightness-max": 1,
    "raster-saturation": -0.32,
    "raster-contrast": -0.04,
    "raster-hue-rotate": 336,
    "raster-opacity": 0.94,
  },
} as const;

function rasterStyle(scene: "day" | "night") {
  return {
    version: 8 as const,
    sources: {
      osm: {
        type: "raster" as const,
        tiles: OSM_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "osm", type: "raster" as const, source: "osm", paint: RASTER_PAINT[scene] },
    ],
  };
}

function rampColour(index: number, suppressed: boolean): [number, number, number] {
  if (suppressed) return [107, 114, 128];
  if (index <= 25) return [45, 212, 167];
  if (index <= 50) return [140, 214, 91];
  if (index <= 70) return [255, 176, 32];
  if (index <= 85) return [255, 107, 74];
  return [255, 45, 85];
}

/** A thing on the map that can be pointed at and talked about. */
interface Marker {
  kind: "camera" | "junction" | "blackspot";
  id: string;
  lon: number;
  lat: number;
  label: string;
  detail: string;
  /** Cameras that are not reporting, and blackspots, both read as "attend". */
  alert: boolean;
}

export function CorridorMap({
  links,
  locale,
  onSelect,
  cameras = [],
  junctions = [],
  blackspots = [],
}: {
  links: SceneLink[];
  locale: Locale;
  onSelect?: (link: SceneLink) => void;
  /** Optional overlays. Absent ones simply do not draw, so the console's
   *  existing two call sites keep working unchanged. */
  cameras?: Camera[];
  junctions?: Junction[];
  blackspots?: BlackSpot[];
}) {
  const hi = locale === "hi";
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const scene = useSyncExternalStore(subscribeScene, currentScene, serverScene);
  const [basemap, setBasemap] = useState<"pending" | "loaded" | "offline">("pending");
  const [hovered, setHovered] = useState<SceneLink | null>(null);
  const [pin, setPin] = useState<Marker | null>(null);
  /** The scene to build the style with. Held in a ref so constructing the map
   *  does not take `scene` as a dependency — that would tear the map down and
   *  refetch every tile on each theme toggle. Written only from an effect. */
  const built = useRef<"day" | "night">(scene);
  /** What the live style currently shows, so a scene change restyles once
   *  and a remount does not restyle at all. */
  const applied = useRef<"day" | "night" | null>(null);

  useEffect(() => {
    built.current = scene;
  }, [scene]);

  const centre = useMemo(() => {
    const points = links.flatMap((l) => l.coordinates);
    if (points.length === 0) return { lon: 75.7873, lat: 26.9124 };
    const lon = points.reduce((a, p) => a + p[0], 0) / points.length;
    const lat = points.reduce((a, p) => a + p[1], 0) / points.length;
    return { lon, lat };
  }, [links]);

  /**
   * Everything trackable, flattened to one list.
   *
   * Blackspots carry no coordinates of their own — only a link_id — so they are
   * placed at the midpoint of the link they describe. That is honest: a
   * blackspot IS a stretch of road, not a pin, and the midpoint is the least
   * misleading single point for one. Any blackspot whose link is not in view
   * is dropped rather than placed at a guess.
   */
  const markers = useMemo<Marker[]>(() => {
    const byLink = new Map(links.map((l) => [l.link_id, l]));
    const out: Marker[] = [];

    for (const c of cameras) {
      if (!c.position) continue;
      out.push({
        kind: "camera",
        id: `cam-${c.camera_id}`,
        lon: c.position.lon,
        lat: c.position.lat,
        label: hi ? c.junction.hi : c.junction.en,
        detail: c.status,
        alert: c.status !== "active" && c.status !== "live",
      });
    }

    for (const j of junctions) {
      if (!j.coordinates) continue;
      out.push({
        kind: "junction",
        id: `jn-${j.junction_id}`,
        lon: j.coordinates[0],
        lat: j.coordinates[1],
        label: hi ? j.name.hi : j.name.en,
        detail: `${j.approaches} ${hi ? "पहुँच" : "approaches"} · ${j.signal_type}`,
        alert: false,
      });
    }

    for (const b of blackspots) {
      const link = byLink.get(b.link_id);
      if (!link || link.coordinates.length === 0) continue;
      const mid = link.coordinates[Math.floor(link.coordinates.length / 2)];
      if (!mid) continue;
      out.push({
        kind: "blackspot",
        id: `bs-${b.link_id}`,
        lon: mid[0],
        lat: mid[1],
        label: hi ? b.name.hi : b.name.en,
        detail: `${b.crashes} ${hi ? "दुर्घटनाएँ" : "crashes"} · ${b.deaths} ${hi ? "मृत्यु" : "deaths"}`,
        alert: true,
      });
    }
    return out;
  }, [cameras, junctions, blackspots, links, hi]);

  // Create the map once. Re-creating it on every theme change would refetch
  // the basemap and lose the user's pan and zoom.
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: rasterStyle(built.current),
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
    applied.current = built.current;

    // MapLibre measures its container exactly once, at construction. This one
    // sits in a flex/grid shell that has usually not settled by then — and when
    // it later grows, the canvas keeps its original box and the map renders as
    // a small square in the corner of a black panel, which is precisely what it
    // did. Re-measure on every box change instead of trusting the first read.
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);

    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
      overlay.current = null;
      applied.current = null;
    };
  }, [centre.lon, centre.lat]);

  // Try the basemap, and carry on without it. `setStyle` keeps the deck
  // overlay because it is a control, not a style layer.
  //
  // The style is a local object now rather than a fetched JSON document, so
  // applying it cannot fail — which means reachability has to be probed
  // separately. One tile answers that: if it loads, the rest will, and if it
  // does not, the corridor still draws over a plain ground. That ordering is
  // the whole design (see the note at the top of this file).
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    let cancelled = false;

    // Only on a *change* of scene. The map is now constructed with the basemap
    // already in it, because calling setStyle during mount raced the initial
    // style load — MapLibre logged "Style is not done loading" and dropped the
    // new style, leaving a black panel. Building it in removes the race rather
    // than trying to win it.
    //
    // The offline guarantee is unaffected: if the tiles never arrive, the raster
    // layer simply draws nothing and the deck.gl corridor still renders over the
    // ground colour, which is exactly the fallback the old blank style provided.
    if (applied.current !== scene) {
      const apply = () => {
        instance.setStyle(rasterStyle(scene));
        applied.current = scene;
      };
      if (instance.isStyleLoaded()) apply();
      else instance.once("load", apply);
    }

    const probe = new Image();
    probe.onload = () => !cancelled && setBasemap("loaded");
    probe.onerror = () => !cancelled && setBasemap("offline");
    // A tile that covers central Jaipur, so a cache hit here warms the view.
    probe.src = "https://tile.openstreetmap.org/12/2896/1798.png";

    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
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
        // Drawn above the corridor: a marker exists to be found, so it must not
        // disappear under the ribbon it sits on. Radius is in pixels, not
        // metres, because a camera is a point of interest at every zoom rather
        // than an object with a real-world size.
        new ScatterplotLayer<Marker>({
          id: "markers-halo",
          data: markers,
          getPosition: (m: Marker) => [m.lon, m.lat],
          getRadius: (m: Marker) => (m.kind === "blackspot" ? 11 : 9),
          radiusUnits: "pixels",
          getFillColor: (m: Marker) => (m.alert ? [255, 45, 85, 60] : [226, 79, 176, 55]),
          pickable: false,
        }),
        new ScatterplotLayer<Marker>({
          id: "markers",
          data: markers,
          getPosition: (m: Marker) => [m.lon, m.lat],
          getRadius: (m: Marker) => (m.kind === "blackspot" ? 5.5 : 4.5),
          radiusUnits: "pixels",
          // Blackspots take the ramp's critical colour because they ARE a
          // severity statement. Cameras and junctions take the brand magenta,
          // which is 28 deg clear of every ramp hue — so infrastructure can
          // never be misread as a measurement.
          getFillColor: (m: Marker) =>
            m.kind === "blackspot"
              ? [255, 45, 85]
              : m.alert
                ? [255, 176, 32]
                : [226, 79, 176],
          getLineColor: [255, 241, 246],
          lineWidthUnits: "pixels",
          getLineWidth: 1.2,
          stroked: true,
          pickable: true,
          onHover: ({ object }) => setPin((object as Marker) ?? null),
          updateTriggers: { getFillColor: markers.map((m) => m.alert).join(",") },
        }),
      ],
    });
  }, [links, onSelect, markers]);

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

      {/* A legend, because an unlabelled dot is decoration. Only renders the
          kinds actually present, so the console's link-only map stays clean. */}
      {markers.length > 0 && (
        <ul
          className="pointer-events-none absolute right-3 top-3 space-y-1 rounded-xl
                     bg-[var(--surface-2)]/90 px-2.5 py-2 backdrop-blur"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          {[
            { on: cameras.length > 0, c: "#E24FB0", en: "Camera", hiL: "कैमरा" },
            { on: junctions.length > 0, c: "#E24FB0", en: "Junction", hiL: "चौराहा" },
            { on: blackspots.length > 0, c: "#FF2D55", en: "Blackspot", hiL: "दुर्घटना स्थल" },
          ]
            .filter((r) => r.on)
            .map((r) => (
              <li
                key={r.en}
                className="flex items-center gap-2 text-[var(--ink-muted)]"
                style={{ fontSize: "calc(var(--d-support) * 0.9)" }}
              >
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ background: r.c }}
                />
                {hi ? r.hiL : r.en}
              </li>
            ))}
        </ul>
      )}

      {pin && (
        <div
          className="pointer-events-none absolute bottom-14 left-3 max-w-[16rem] rounded-xl
                     bg-[var(--surface-2)] p-3"
          style={{ boxShadow: "var(--shadow-float)" }}
        >
          <p className="truncate text-[var(--ink)]" style={{ fontSize: "var(--d-support)" }}>
            {pin.label}
          </p>
          <p
            className="mt-1 font-mono tabular-nums text-[var(--ink-muted)]"
            style={{ fontSize: "calc(var(--d-support) * 0.94)" }}
          >
            {pin.detail}
          </p>
        </div>
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
