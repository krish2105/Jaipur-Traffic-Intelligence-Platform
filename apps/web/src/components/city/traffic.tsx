"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { polylineLength } from "@/lib/geo";

export interface TrafficRoad {
  points: [number, number][];
  /** Measured vehicles per hour on this link. Drives particle count. */
  flow: number;
  /** Measured mean speed, km/h. Drives how fast they travel. */
  speedKmh: number;
  suppressed: boolean;
}

/**
 * Traffic, as light.
 *
 * Every particle here is a real measurement, not decoration (docs/06 §3). The
 * number of particles on a link is proportional to its measured flow; how fast
 * they move is its measured speed. Where counts were suppressed for low quality
 * the link carries no particles at all — the twin must never invent traffic it
 * did not measure, and you can watch it refusing to.
 *
 * One InstancedMesh for the whole city, capped, with each particle's progress
 * advanced on the GPU-friendly path: a single matrix write per frame per
 * particle and no allocation inside useFrame.
 */
// Enough to read as traffic, few enough that individual vehicles resolve.
// At 2,400 on a visible stretch they merged into a continuous bar.
const MAX_PARTICLES = 900;

interface Particle {
  road: number;
  offset: number; // 0..1 along the road
  speed: number; // scene units per second
  lane: number; // lateral offset so they don't run in a single file
}

export function Traffic({
  roads,
  quality = 1,
  daylight = false,
}: {
  roads: TrafficRoad[];
  /** 0..1 — the frame-budget guard halves this when FPS drops. */
  quality?: number;
  daylight?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const { particles, lengths } = useMemo(() => {
    const active = roads.filter((r) => !r.suppressed && r.flow > 0 && r.points.length > 1);
    const totalFlow = active.reduce((sum, r) => sum + r.flow, 0) || 1;
    const budget = Math.floor(MAX_PARTICLES * Math.max(0.1, Math.min(1, quality)));

    const lens = roads.map((r) => polylineLength(r.points) || 1);
    const out: Particle[] = [];
    active.forEach((road) => {
      const index = roads.indexOf(road);
      const share = road.flow / totalFlow;
      const count = Math.max(1, Math.round(budget * share));
      // km/h → scene units/second. SCENE_SCALE is 0.1 units per metre.
      const speed = (road.speedKmh * 1000) / 3600 / 10;
      for (let i = 0; i < count; i += 1) {
        out.push({
          road: index,
          offset: i / count,
          speed,
          lane: (i % 3) - 1,
        });
      }
    });
    return { particles: out.slice(0, budget), lengths: lens };
  }, [roads, quality]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => new THREE.Color(), []);

  // The frame loop advances each particle's offset, which is a mutation. It has
  // to target a ref rather than the memo's own array: mutating render output
  // makes later renders depend on how many frames happened to run first.
  const live = useRef<Particle[]>([]);

  useLayoutEffect(() => {
    live.current = particles.map((p) => ({ ...p }));
    const mesh = ref.current;
    if (!mesh) return;
    mesh.count = live.current.length;

    // Headlights coming toward you, tail lights going away — the single thing
    // that makes a night road photograph read as traffic rather than as dots.
    // Direction of travel decides which, so the two carriageways separate.
    live.current.forEach((p, i) => {
      const road = roads[p.road];
      const pts = road?.points;
      let heading = 0;
      if (pts && pts.length > 1) {
        heading = Math.atan2(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]);
      }
      const towardCamera = Math.cos(heading) < 0;
      if (daylight) {
        // In daylight a car is a painted body, not a lamp.
        const shade = 0.45 + 0.5 * ((i * 2654435761) % 100) / 100;
        scratch.setRGB(shade * 0.9, shade * 0.92, shade);
      } else if (towardCamera) {
        scratch.set("#FFF1CE");
      } else {
        scratch.set("#FF3B30");
      }
      mesh.setColorAt(i, scratch);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [particles, roads, daylight, scratch]);

  useFrame((_state, delta) => {
    const mesh = ref.current;
    const items = live.current;
    if (!mesh || items.length === 0) return;
    const step = Math.min(delta, 0.1); // a tab regaining focus must not teleport them

    for (let i = 0; i < items.length; i += 1) {
      const p = items[i]!;
      const road = roads[p.road];
      if (!road) continue;
      const length = lengths[p.road] || 1;

      p.offset = (p.offset + (p.speed * step) / length) % 1;

      // Walk the polyline to the particle's position.
      const target = p.offset * length;
      let travelled = 0;
      const pts = road.points;
      let x = pts[0]![0];
      let z = pts[0]![1];
      let dx = 1;
      let dz = 0;
      for (let s = 1; s < pts.length; s += 1) {
        const [x0, z0] = pts[s - 1]!;
        const [x1, z1] = pts[s]!;
        const seg = Math.hypot(x1 - x0, z1 - z0);
        if (travelled + seg >= target) {
          const t = seg === 0 ? 0 : (target - travelled) / seg;
          x = x0 + (x1 - x0) * t;
          z = z0 + (z1 - z0) * t;
          dx = (x1 - x0) / (seg || 1);
          dz = (z1 - z0) / (seg || 1);
          break;
        }
        travelled += seg;
      }

      dummy.position.set(x - dz * p.lane * 0.22, 0.13, z + dx * p.lane * 0.22);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (particles.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
      {/* A car-shaped box, not a capsule. Three's capsule is Y-axis aligned, so
          rotating only around Y left every vehicle standing upright — the
          picket-fence look. This is 1.8 m wide, 1.5 m tall, 4.2 m long in
          scene units, with its length on Z so a Y rotation aims it down the
          road. */}
      <boxGeometry args={[0.18, 0.15, 0.42]} />
      <meshBasicMaterial toneMapped={false} vertexColors={false} />
    </instancedMesh>
  );
}
