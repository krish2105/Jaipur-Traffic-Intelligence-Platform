"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useReducedMotion } from "motion/react";

import type { CityData } from "./city-scene";
import type { Origin } from "@/lib/geo";

const CityScene = dynamic(() => import("./city-scene"), {
  ssr: false,
  loading: () => null,
});

/**
 * Capability gate for the 3D city.
 *
 * docs/06 §3: WebGL is feature-detected, and its absence produces the 2D
 * interface with no error and no degraded message. Reduced-motion and low-core
 * devices take the same path — and per ADR-015 the officer PWA passes
 * `force2D` so a mid-range Android never attempts the scene at all.
 */
export function City({
  data,
  radius,
  origin,
  fallback,
  force2D = false,
}: {
  data: CityData;
  radius: number;
  origin: Origin;
  fallback: React.ReactNode;
  force2D?: boolean;
}) {
  const reduce = useReducedMotion();
  // Computed once, lazily, instead of set from an effect: the check reads the
  // platform and never changes afterwards, so an effect would only buy a
  // cascading render. Guarded for SSR, where document does not exist.
  const [capable] = useState<boolean | null>(() => {
    if (typeof document === "undefined") return null;
    if (force2D) return false;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const lowCores = (navigator.hardwareConcurrency ?? 4) <= 2;
      const memory = (navigator as { deviceMemory?: number }).deviceMemory;
      const lowMemory = memory !== undefined && memory <= 2;
      return Boolean(gl) && !lowCores && !lowMemory;
    } catch {
      return false;
    }
  });

  // Undecided on the first paint — render the 2D interface rather than a
  // spinner, so the content is never gated behind a capability check.
  if (capable === null || capable === false || reduce) return <>{fallback}</>;
  return <CityScene data={data} radius={radius} origin={origin} />;
}
