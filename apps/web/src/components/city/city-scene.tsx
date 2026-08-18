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
    // Close enough that a 21 m carriageway and a 12 m building are legible.
    // Framing the entire 17 km corridor makes both sub-pixel — the overview is
    // a different zoom level, not the default one.
    const near = radius * 0.16;
    camera.position.set(
      THREE.MathUtils.lerp(far * 0.35, near * 0.32, e),
      THREE.MathUtils.lerp(far * 1.1, near * 0.62, e),
      THREE.MathUtils.lerp(far * 0.95, near * 0.95, e),
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

function Scene({
  data,
  showStats,
  radius,
  origin,
}: {
  data: CityData;
  showStats: boolean;
  radius: number;
  origin: Origin;
}) {
  const [flying, setFlying] = useState(true);
  const quality = useFrameBudget();

  return (
    <>
      <color attach="background" args={["#04060F"]} />
      {/* Volumetric-feeling depth without a volumetric cost. */}
      {/* Fog density scales with the scene so a small corridor is not lost in
          it and a large one still has depth. */}
      <fogExp2 attach="fog" args={["#060A16", 1.6 / Math.max(60, radius)]} />

      <ambientLight intensity={0.75} />
      <directionalLight
        position={[radius, radius * 2, -radius]}
        intensity={0.5}
        color="#8FA6FF"
      />
      <Environment preset="night" />

      <Ground radius={radius} />
      <Roads roads={data.roads} ramp={data.ramp} />
      <Buildings boxes={data.buildings} origin={origin} />
      <Traffic roads={data.traffic} quality={quality} />

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

      <EffectComposer>
        {/* Bloom is what turns emissive ribbons into light. Kept tight so the
            whole screen does not wash out. */}
        <Bloom intensity={0.7} luminanceThreshold={0.45} luminanceSmoothing={0.5} mipmapBlur />
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
  showStats = false,
}: {
  data: CityData;
  radius: number;
  origin: Origin;
  showStats?: boolean;
}) {
  const dpr = useMemo<[number, number]>(() => [1, 2], []);
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ position: [radius * 0.8, radius * 2.4, radius * 2.2], fov: 42, near: 0.5, far: radius * 40 }}
      className="absolute inset-0"
    >
      <Suspense fallback={null}>
        <Scene data={data} showStats={showStats} radius={radius} origin={origin} />
      </Suspense>
    </Canvas>
  );
}
