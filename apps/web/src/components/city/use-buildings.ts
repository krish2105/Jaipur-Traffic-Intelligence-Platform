"use client";

import { useEffect, useState } from "react";

import type { BuildingBox } from "./buildings";

const NONE: BuildingBox[] = [];

/**
 * The city's building massing, resolved before the 3D scene mounts.
 *
 * The footprints are ~300 KB, so they are the one part of the offline snapshot
 * (ADR-062) served as a static file rather than bundled — putting them in the
 * payload of every page would tax the pages with no map on them. That leaves
 * them to be fetched on the client, and *when* matters: the scene is a
 * `dynamic(ssr:false)` import that builds its geometry from one `data` object,
 * so handing it buildings a second after mount rebuilt that geometry mid-life
 * and the canvas came back collapsed — an empty map pane on the deployment,
 * with the road data sitting right there in the payload.
 *
 * So this returns `null` for "still asking", and the caller holds the 2D
 * fallback until it resolves. One mount, one geometry build.
 *
 * When the API is reachable it has already served the buildings, and this
 * resolves synchronously without a request.
 */
export function useBuildings(served: BuildingBox[]): BuildingBox[] | null {
  const [buildings, setBuildings] = useState<BuildingBox[] | null>(
    served.length > 0 ? served : null,
  );

  useEffect(() => {
    if (served.length > 0) return;
    let cancelled = false;
    fetch("/data/buildings.json")
      .then((r) => (r.ok ? r.json() : { buildings: NONE }))
      .then((d: { buildings?: BuildingBox[] }) => {
        if (!cancelled) setBuildings(d.buildings ?? NONE);
      })
      .catch(() => {
        // A city with no buildings still renders its roads, which are the
        // measurement. The massing is context, so its loss is not an error —
        // resolve to empty and let the scene mount without it.
        if (!cancelled) setBuildings(NONE);
      });
    return () => {
      cancelled = true;
    };
  }, [served.length]);

  return buildings;
}
