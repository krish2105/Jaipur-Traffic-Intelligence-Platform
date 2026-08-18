"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, OrbitControls, Stats } from "@react-three/drei";
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
    // Framing computed from the camera's own field of view rather than from a
    // hand-tuned multiple of the radius. Every time I tuned that multiple by
    // eye it drifted — too far and a 21 m carriageway went sub-pixel, too close
    // and the camera sat in the road. `fit` is the distance at which a sphere
    // of `radius` exactly fills the frame, so the fractions below mean
    // something: 1.0 is the whole corridor, 0.34 is a readable stretch.
    // three's `fov` is the VERTICAL field of view. In a portrait pane — which
    // the console's map column is — the horizontal frustum is far narrower, so
    // framing on the vertical alone puts a wide corridor outside the shot. Fit
    // to whichever axis is tighter.
    const perspective = camera as THREE.PerspectiveCamera;
    const fovRad = ((perspective.fov ?? 40) * Math.PI) / 180;
    const aspect = perspective.aspect || 1;
    const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
    const fit = Math.max(
      radius / Math.sin(fovRad / 2),
      radius / Math.sin(hFovRad / 2),
    );
    const far = fit * 0.85;
    // 0.12 frames a readable stretch. There is no single distance that shows a
    // 17 km corridor AND a 4 m car — they are four orders of magnitude apart —
    // so the default is the stretch, and the overview is a zoom level reached
    // by scrolling out. See ADR-018.
    // 0.12 is the resting zoom: a readable stretch of corridor with vehicles
    // still legible on it. It was briefly 0.028 to answer a "show me the
    // vehicles close up" request, and that close-up then became the default an
    // official would open the dashboard to — two cars and a strip of tarmac,
    // with no city in shot. A close-up is a thing you zoom TO, never the thing
    // you land on.
    //
    // Below roughly 0.03 the camera also passes BESIDE the road rather than
    // along it, because OrbitControls targets the centroid of every link and
    // the corridor is a curve — its centroid is not on the carriageway. Fixing
    // that needs the target snapped to the nearest point ON a link, the same
    // machinery junction click-to-fly needs. See ADR-019.
    const near = fit * 0.12;
    // A fixed aerial-oblique bearing: 38 degrees elevation, 35 degrees round.
    // Only the distance changes during the flight, so the corridor stays framed
    // the whole way down instead of swinging out of shot.
    const d = THREE.MathUtils.lerp(far, near, e);
    const elev = (38 * Math.PI) / 180;
    const azim = (35 * Math.PI) / 180;
    camera.position.set(
      d * Math.cos(elev) * Math.sin(azim),
      d * Math.sin(elev),
      d * Math.cos(elev) * Math.cos(azim),
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
  // A genuine daylight scene rather than a lightened night one: window lights
  // out because a lit window is invisible at noon, and bloom off because
  // nothing is emitting. The congestion ramp is identical in both — it is the
  // one thing that must never change meaning.
  //
  // The intensities below are far lower than they were. Ambient 1.5 with a 2.2
  // key, through the ACES tone curve R3F applies by default, clipped every
  // surface to white: buildings lost their form, the asphalt lost its
  // congestion colour, and the whole pane read as fog. Daylight is not "more
  // light everywhere" — it is ONE hard sun plus a little bounce, and it is the
  // shadow side of a building that tells you the building is there.
  //
  // The haze is warm rather than sky-blue. Jaipur's daytime air carries desert
  // dust, so a cold blue haze reads as a European overcast and, more
  // practically, sat within a few percent of the light interface's own
  // background — which is why the scene looked like an empty panel.
  day: {
    background: "#AFC4DA", fog: "#D6CBB8",
    ambient: 0.5, key: 1.8, windows: 0, bloom: 0.0,
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

      {/* Explicit lights, no <Environment>.
          drei's Environment fetches an HDR from a CDN and SUSPENDS until it
          arrives. Where that request is slow or blocked, nothing inside
          <Suspense> ever mounts — no meshes, no useFrame, a blank canvas at
          full size, which is exactly how this presented. It also broke
          docs/03 §5: the demo must render with the network cable pulled, and a
          scene that waits on a CDN cannot. */}
      <ambientLight intensity={mode.ambient} />
      {/* Sky above, warm bounce from the ground below. The ground colour is
          doing real work in daylight: it is the light coming back UP off
          Jaipur's sand that fills the underside of every overpass and keeps
          the shadow side from going flat grey. */}
      <hemisphereLight
        intensity={scene === "day" ? 0.75 : 0.35}
        color={scene === "day" ? "#CFE0F5" : "#2A3A66"}
        groundColor={scene === "day" ? "#C9AE85" : "#080B14"}
      />
      <directionalLight
        position={[-radius, radius * 1.2, radius * 0.6]}
        intensity={scene === "day" ? 0.3 : 0.25}
        color={scene === "day" ? "#FFE9C4" : "#5B6FA8"}
      />
      <directionalLight
        position={[radius, radius * 2, -radius]}
        intensity={mode.key}
        color={scene === "day" ? "#FFF6E2" : "#8FA6FF"}
      />

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
      camera={{ position: [radius * 1.4, radius * 1.8, radius * 2.0], fov: 40, near: 0.5, far: radius * 40 }}
      className="absolute inset-0"
    >
      <Suspense fallback={null}>
        <Scene data={data} showStats={showStats} radius={radius} origin={origin} scene={scene} />
      </Suspense>
    </Canvas>
  );
}
