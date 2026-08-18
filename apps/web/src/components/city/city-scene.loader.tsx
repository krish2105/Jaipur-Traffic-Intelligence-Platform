"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

import type { CityData } from "./city-scene";
import type { Origin } from "@/lib/geo";

const CityScene = dynamic(() => import("./city-scene"), {
  ssr: false,
  loading: () => null,
});

const subscribeNever = () => () => {};

let cachedCapability: boolean | null = null;

/** Reads the platform once. The answer cannot change without a reload. */
function detectCapability(): boolean {
  if (cachedCapability !== null) return cachedCapability;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const lowCores = (navigator.hardwareConcurrency ?? 4) <= 2;
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    const lowMemory = memory !== undefined && memory <= 2;
    cachedCapability = Boolean(gl) && !lowCores && !lowMemory;
  } catch {
    cachedCapability = false;
  }
  return cachedCapability;
}

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
  scene,
  fallback,
  force2D = false,
}: {
  data: CityData;
  radius: number;
  origin: Origin;
  scene: "night" | "day";
  fallback: React.ReactNode;
  force2D?: boolean;
}) {
  const reduce = useReducedMotion();
  // useSyncExternalStore, not useState or useEffect.
  //
  // A lazy useState initialiser that reads `document` renders one tree on the
  // server and a different one on the client, which is a hydration mismatch —
  // that shipped once and blanked the whole scene. An effect would fix the
  // mismatch but reintroduces setState-in-effect. This reads a platform value
  // with a distinct server snapshot, which is exactly what it is for.
  const capable = useSyncExternalStore(
    subscribeNever,
    () => (force2D ? false : detectCapability()),
    () => null,
  );

  // Undecided on the first paint — render the 2D interface rather than a
  // spinner, so the content is never gated behind a capability check.
  if (capable === null || capable === false || reduce) return <>{fallback}</>;
  return <CityScene data={data} radius={radius} origin={origin} scene={scene} />;
}
