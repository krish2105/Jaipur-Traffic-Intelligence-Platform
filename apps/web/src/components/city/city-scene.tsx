"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, Environment, OrbitControls, Stats } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

import { Buildings, type BuildingBox } from "./buildings";
import { Roads } from "./roads";
import { Traffic, type TrafficRoad } from "./traffic";
import type { RoadInput } from "@/lib/ribbon";

export interface CityData {
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
function IntroFlight({ onDone, skip }: { onDone: () => void; skip: boolean }) {
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
    camera.position.set(
      THREE.MathUtils.lerp(120, 34, e),
      THREE.MathUtils.lerp(340, 62, e),
      THREE.MathUtils.lerp(300, 118, e),
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

function Scene({ data, showStats }: { data: CityData; showStats: boolean }) {
  const [flying, setFlying] = useState(true);
  const quality = useFrameBudget();

  return (
    <>
      <color attach="background" args={["#04060F"]} />
      {/* Volumetric-feeling depth without a volumetric cost. */}
      <fogExp2 attach="fog" args={["#060A16", 0.0045]} />

      <ambientLight intensity={0.28} />
      <directionalLight position={[60, 120, -40]} intensity={0.5} color="#8FA6FF" />
      <Environment preset="night" />

      <Roads roads={data.roads} />
      <Buildings boxes={data.buildings} />
      <Traffic roads={data.traffic} quality={quality} />

      <IntroFlight skip={false} onDone={() => setFlying(false)} />
      <OrbitControls
        enabled={!flying}
        enableDamping
        dampingFactor={0.06}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={30}
        maxDistance={520}
        target={[0, 0, 0]}
      />

      <EffectComposer>
        {/* Bloom is what turns emissive ribbons into light. Kept tight so the
            whole screen does not wash out. */}
        <Bloom intensity={0.85} luminanceThreshold={0.22} luminanceSmoothing={0.5} mipmapBlur />
        <Vignette offset={0.28} darkness={0.68} />
      </EffectComposer>

      <AdaptiveDpr pixelated />
      {showStats && <Stats />}
    </>
  );
}

export default function CityScene({
  data,
  showStats = false,
}: {
  data: CityData;
  showStats?: boolean;
}) {
  const dpr = useMemo<[number, number]>(() => [1, 2], []);
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ position: [120, 340, 300], fov: 42, near: 1, far: 4000 }}
      className="absolute inset-0"
    >
      <Suspense fallback={null}>
        <Scene data={data} showStats={showStats} />
      </Suspense>
    </Canvas>
  );
}
