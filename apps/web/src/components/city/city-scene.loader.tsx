"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

import type { CityData } from "./city-scene";

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
  fallback,
  force2D = false,
}: {
  data: CityData;
  fallback: React.ReactNode;
  force2D?: boolean;
}) {
  const reduce = useReducedMotion();
  const [capable, setCapable] = useState<boolean | null>(null);

  useEffect(() => {
    if (force2D) {
      setCapable(false);
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const lowCores = (navigator.hardwareConcurrency ?? 4) <= 2;
      const lowMemory = "deviceMemory" in navigator && (navigator as { deviceMemory?: number }).deviceMemory! <= 2;
      setCapable(Boolean(gl) && !lowCores && !lowMemory);
    } catch {
      setCapable(false);
    }
  }, [force2D]);

  // Undecided on the first paint — render the 2D interface rather than a
  // spinner, so the content is never gated behind a capability check.
  if (capable === null || capable === false || reduce) return <>{fallback}</>;
  return <CityScene data={data} />;
}
