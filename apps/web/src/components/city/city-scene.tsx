"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, Environment, OrbitControls, Stats } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

import { Buildings, type BuildingBox } from "./buildings";
import type { Origin } from "@/lib/geo";
import { Ground, Roads } from "./roads";
import { Traffic, type TrafficRoad } from "./traffic";
import type { Ramp, RoadInput } from "@/lib/ribbon";

export interface CityData {
  ramp: Ramp;
  roads: RoadInput[];
  traffic: TrafficRoad[];
  buildings: BuildingBox[];
}

/**
 * Camera flight on load (docs plan, signature moment 1).
 *
 * Opens high above Jaipur and descends along the corridor while the light
 * trails resolve. Four seconds, once, and any pointer input cancels it — a
 * cinematic that fights the user is a cinematic that gets hated.
 */
function IntroFlight({
  onDone,
  skip,
  radius,
}: {
  onDone: () => void;
  skip: boolean;
  radius: number;
}) {
  const { camera } = useThree();
  const elapsed = useRef(0);
  const cancelled = useRef(skip);

  useEffect(() => {
    if (skip) return;
    const cancel = () => {
      cancelled.current = true;
    };
    window.addEventListener("pointerdown", cancel, { once: true });
    window.addEventListener("wheel", cancel, { once: true });
    return () => {
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("wheel", cancel);
    };
  }, [skip]);

  useFrame((_state, delta) => {
    if (cancelled.current) {
      onDone();
      return;
    }
    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / 4);
    // ease-out-expo, matching the CSS easing used everywhere else
    const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    // Framed off the scene's own bounding radius, so the flight always ends
    // with the whole corridor in shot whatever its extent.
    const far = radius * 2.4;
    // The framing this scene lives or dies on. Too far and a 21 m carriageway
    // is sub-pixel; too close and the camera sits in the road and the vehicles
    // merge into one bar. This is an aerial oblique — high enough to read the
    // corridor's shape, low enough to resolve individual cars.
    const near = radius * 0.55;
    camera.position.set(
      THREE.MathUtils.lerp(far * 0.40, near * 0.55, e),
      THREE.MathUtils.lerp(far * 1.05, near * 0.95, e),
      THREE.MathUtils.lerp(far * 0.95, near * 0.85, e),
    );
    camera.lookAt(0, 0, 0);
    if (t >= 1) onDone();
  });
  return null;
}

/**
 * Frame-budget guard (docs/06 §3): if FPS sits under 30 for three seconds the
 * particle budget halves. Better a thinner scene than a stuttering one, and it
 * happens without the user having to know there is a setting.
 */
function useFrameBudget() {
  const [quality, setQuality] = useState(1);
  const frames = useRef(0);
  const slowFor = useRef(0);

  useFrame((_state, delta) => {
    frames.current += 1;
    if (delta > 1 / 30) slowFor.current += delta;
    else slowFor.current = Math.max(0, slowFor.current - delta * 0.5);
    if (slowFor.current > 3) {
      slowFor.current = 0;
      setQuality((q) => Math.max(0.25, q / 2));
    }
  });
  return quality;
}

/** Night is the control-room native mode; day is the public-facing one. */
export type SceneMode = "night" | "day";

const PALETTE_BY_MODE: Record<SceneMode, {
  background: string; fog: string;
  ambient: number; key: number; windows: number; bloom: number;
}> = {
  night: {
    background: "#04060F", fog: "#060A16",
    ambient: 0.35, key: 0.9, windows: 1, bloom: 0.7,
  },
  // A genuine daylight scene rather than a lightened night one: sky-blue
  // ground, haze instead of darkness, the window lights out because a lit
  // window is invisible at noon, and bloom off because nothing is emitting.
  // The congestion ramp is identical in both — it is the one thing that must
  // never change meaning.
  day: {
    background: "#9FBBDC", fog: "#C7D6E9",
    ambient: 1.5, key: 2.2, windows: 0, bloom: 0.0,
  },
};

function Scene({
  data,
  showStats,
  radius,
  origin,
  scene,
}: {
  data: CityData;
  showStats: boolean;
  radius: number;
  origin: Origin;
  scene: SceneMode;
}) {
  const [flying, setFlying] = useState(true);
  const quality = useFrameBudget();
  const fogDensity = 1.6 / Math.max(60, radius);
  const mode = PALETTE_BY_MODE[scene];

  return (
    <>
      <color attach="background" args={[mode.background]} />
      {/* Volumetric-feeling depth without a volumetric cost. */}
      {/* Fog density scales with the scene so a small corridor is not lost in
          it and a large one still has depth. The buildings' shader is handed
          the same value — a raw ShaderMaterial gets no fog for free. */}
      <fogExp2 attach="fog" args={[mode.fog, fogDensity]} />

      <ambientLight intensity={mode.ambient} />
      <directionalLight
        position={[radius, radius * 2, -radius]}
        intensity={mode.key}
        color={scene === "day" ? "#FFF6E2" : "#8FA6FF"}
      />
      <Environment preset={scene === "day" ? "city" : "night"} />

      <Ground radius={radius} daylight={scene === "day"} />
      <Roads roads={data.roads} ramp={data.ramp} daylight={scene === "day"} />
      <Buildings
        boxes={data.buildings}
        origin={origin}
        fogDensity={fogDensity}
        fogColor={mode.fog}
        windowStrength={mode.windows}
      />
      <Traffic roads={data.traffic} quality={quality} daylight={scene === "day"} />

      <IntroFlight skip={false} radius={radius} onDone={() => setFlying(false)} />
      <OrbitControls
        enabled={!flying}
        enableDamping
        dampingFactor={0.06}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={radius * 0.04}
        maxDistance={radius * 5}
        target={[0, 0, 0]}
      />

      <EffectComposer enabled={scene === "night"}>
        {/* Bloom is what turns emissive ribbons into light at night. In daylight
            nothing is emitting, so blooming would only smear the image. */}
        <Bloom
          intensity={mode.bloom}
          luminanceThreshold={0.45}
          luminanceSmoothing={0.5}
          mipmapBlur
        />
        <Vignette offset={0.28} darkness={0.68} />
      </EffectComposer>

      <AdaptiveDpr pixelated />
      {showStats && <Stats />}
    </>
  );
}

export default function CityScene({
  data,
  radius,
  origin,
  scene,
  showStats = false,
}: {
  data: CityData;
  radius: number;
  origin: Origin;
  scene: SceneMode;
  showStats?: boolean;
}) {
  const dpr = useMemo<[number, number]>(() => [1, 2], []);
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ position: [radius * 0.7, radius * 1.9, radius * 1.8], fov: 40, near: 0.5, far: radius * 40 }}
      className="absolute inset-0"
    >
      <Suspense fallback={null}>
        <Scene data={data} showStats={showStats} radius={radius} origin={origin} scene={scene} />
      </Suspense>
    </Canvas>
  );
}
