"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * A point guaranteed to lie ON the carriageway.
 *
 * This closes ADR-019. Everything that framed this scene — the intro flight's
 * lookAt and OrbitControls' target — pointed at (0,0,0), which is the centroid
 * of every link. Tonk Road is a curve, and the centroid of a curve is not on
 * the curve: it sits out in the fields beside it. On a wide desktop pane the
 * corridor was still inside the frustum despite that, which is why it looked
 * fine and hid the bug. Narrow the pane to a phone and the horizontal field of
 * view collapses, the road leaves the shot, and what is left is a correctly
 * rendered picture of empty ground — the "empty" mobile map.
 *
 * The midpoint by arc length of the longest road is the natural choice: longest
 * because it is the corridor rather than a side stub, and by arc length rather
 * than by index because the vertices are not evenly spaced.
 */
function carriagewayTarget(roads: CityData["roads"]): [number, number, number] {
  let best: CityData["roads"][number] | null = null;
  let bestLength = -1;

  const lengthOf = (points: [number, number][]) => {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return total;
  };

  for (const road of roads) {
    const length = lengthOf(road.points);
    if (length > bestLength) {
      bestLength = length;
      best = road;
    }
  }
  if (!best || best.points.length === 0 || bestLength <= 0) return [0, 0, 0];

  const half = bestLength / 2;
  let walked = 0;
  for (let i = 1; i < best.points.length; i += 1) {
    const a = best.points[i - 1];
    const b = best.points[i];
    if (!a || !b) continue;
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + segment >= half) {
      const t = segment === 0 ? 0 : (half - walked) / segment;
      return [a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t];
    }
    walked += segment;
  }
  const last = best.points[best.points.length - 1];
  return last ? [last[0], 0, last[1]] : [0, 0, 0];
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
  target,
}: {
  onDone: () => void;
  skip: boolean;
  radius: number;
  /** A point on the carriageway — see carriagewayTarget. */
  target: [number, number, number];
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
    // 0.12. Raised to 0.30 once to try to rescue the mobile framing; that did
    // not fix mobile AND it pushed the desktop camera off the corridor, so it
    // is back. The resting distance was never the problem.
    //
    // The real fault is the one ADR-019 already names: OrbitControls targets
    // the centroid of every link, a curved corridor's centroid is not on the
    // carriageway, and at a narrow aspect the camera therefore looks at empty
    // ground. Fixing it needs the target snapped to a point ON a link. Until
    // then the 3D scene is a desktop surface and the 2D atlas is the one that
    // works everywhere.
    const near = fit * 0.12;
    // A fixed aerial-oblique bearing: 38 degrees elevation, 35 degrees round.
    // Only the distance changes during the flight, so the corridor stays framed
    // the whole way down instead of swinging out of shot.
    const d = THREE.MathUtils.lerp(far, near, e);
    const elev = (38 * Math.PI) / 180;
    const azim = (35 * Math.PI) / 180;
    camera.position.set(
      target[0] + d * Math.cos(elev) * Math.sin(azim),
      target[1] + d * Math.sin(elev),
      target[2] + d * Math.cos(elev) * Math.cos(azim),
    );
    camera.lookAt(target[0], target[1], target[2]);
    if (t >= 1) onDone();
  });
  return null;
}



/**
 * Drive the renderer's size from the container, not from React Three Fiber's
 * own measurement.
 *
 * R3F measures the container once at mount and relies on a ResizeObserver
 * afterwards. When this canvas mounts inside a pane that has not laid out yet —
 * which is what happens on the console, where the map column is sized by a flex
 * rule that settles a frame later — the measurement is zero, and the canvas
 * falls back to its intrinsic 300x150 and stays there. A 300x150 canvas
 * stretched across an 876x457 pane is what "the live map is empty" looked like:
 * the scene is rendering perfectly, into a viewport the size of a postage stamp.
 *
 * Exactly the fault MapLibre had in corridor-map.tsx, for exactly the same
 * reason, so it gets the same remedy: observe the box and re-measure whenever
 * it changes, rather than trusting the first read.
 */
function TrackContainerSize() {
  const gl = useThree((state) => state.gl);
  const setSize = useThree((state) => state.setSize);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const apply = () => {
      const { width, height } = parent.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(width, height);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [gl, setSize]);

  return null;
}

/**
 * Keep the corridor framed when the pane changes shape.
 *
 * `IntroFlight` fits the camera to the viewport aspect once, during its four
 * seconds, and then hands over to OrbitControls. That is fine until the pane
 * itself resizes — which it does every time an officer switches from Dashboard,
 * where the map is 45vh, to Live map, where it is the full column. The canvas
 * resizes, the camera does not re-frame, and the corridor slides into a corner
 * of a mostly empty black panel. That is what "the live map is empty" was.
 *
 * The fix preserves what the user was looking at rather than snapping home:
 * the camera's distance is rescaled by the ratio of the new fit distance to the
 * old one, so the same fraction of the corridor stays in shot at whatever
 * aspect. Someone who had zoomed in keeps their zoom.
 */
function RefitOnResize({
  radius,
  target,
}: {
  radius: number;
  target: [number, number, number];
}) {
  const { camera, size } = useThree();
  const lastFit = useRef<number | null>(null);

  const fitFor = useCallback(
    (aspect: number) => {
      const perspective = camera as THREE.PerspectiveCamera;
      const fovRad = ((perspective.fov ?? 40) * Math.PI) / 180;
      const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * Math.max(aspect, 0.0001));
      return Math.max(radius / Math.sin(fovRad / 2), radius / Math.sin(hFovRad / 2));
    },
    [camera, radius],
  );

  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const fit = fitFor(size.width / size.height);
    const previous = lastFit.current;
    lastFit.current = fit;
    // First measurement is the baseline; IntroFlight owns the framing until it
    // finishes, and rescaling underneath it would fight the animation.
    if (previous === null || previous === fit) return;

    // Scale the offset FROM the target, not the position from the world origin
    // — otherwise a resize drags the camera back toward (0,0,0) and undoes the
    // carriagewayTarget fix on the very first reflow.
    const focus = new THREE.Vector3(target[0], target[1], target[2]);
    const offset = camera.position.clone().sub(focus);
    if (offset.lengthSq() === 0) return;
    camera.position.copy(focus).add(offset.multiplyScalar(fit / previous));
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
  }, [size.width, size.height, camera, fitFor, target]);

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
  // Recomputed only when the roads change; every framing consumer shares it.
  const target = useMemo(() => carriagewayTarget(data.roads), [data.roads]);
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

      <IntroFlight
        skip={false}
        radius={radius}
        target={target}
        onDone={() => setFlying(false)}
      />
      <TrackContainerSize />
      <RefitOnResize radius={radius} target={target} />
      <OrbitControls
        enabled={!flying}
        enableDamping
        dampingFactor={0.06}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={radius * 0.04}
        maxDistance={radius * 5}
        target={target}
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
