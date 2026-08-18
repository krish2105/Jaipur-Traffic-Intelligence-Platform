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
const MAX_PARTICLES = 2400;

interface Particle {
  road: number;
  offset: number; // 0..1 along the road
  speed: number; // scene units per second
  lane: number; // lateral offset so they don't run in a single file
}

export function Traffic({
  roads,
  quality = 1,
}: {
  roads: TrafficRoad[];
  /** 0..1 — the frame-budget guard halves this when FPS drops. */
  quality?: number;
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

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (mesh) mesh.count = particles.length;
  }, [particles]);

  useFrame((_state, delta) => {
    const mesh = ref.current;
    if (!mesh || particles.length === 0) return;
    const step = Math.min(delta, 0.1); // a tab regaining focus must not teleport them

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]!;
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

      dummy.position.set(x - dz * p.lane * 0.35, 0.14, z + dx * p.lane * 0.35);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (particles.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
      {/* A short capsule reads as a vehicle's light trail at city scale far
          better than a sphere, and costs the same. */}
      <capsuleGeometry args={[0.055, 0.34, 3, 6]} />
      <meshBasicMaterial color="#FFF3D0" toneMapped={false} />
    </instancedMesh>
  );
}
