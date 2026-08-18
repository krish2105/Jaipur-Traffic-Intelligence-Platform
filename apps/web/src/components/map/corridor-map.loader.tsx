"use client";

import dynamic from "next/dynamic";

/**
 * MapLibre and deck.gl together are a large dependency, and the console's
 * default view is the 3D scene. Loading them on first paint would cost every
 * user the bundle for a view most never open. `ssr: false` because MapLibre
 * touches `window` at module scope.
 */
export const CorridorMap = dynamic(
  () => import("./corridor-map").then((m) => m.CorridorMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="grid h-full w-full place-items-center text-[var(--ink-faint)]"
        style={{ background: "var(--ground-deep)", fontSize: "var(--d-support)" }}
      >
        …
      </div>
    ),
  },
);
