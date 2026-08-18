"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { SCENE_SCALE, polylineLength } from "@/lib/geo";
import { DEFAULT_MIX, FLEET, TAIL_LIGHT, type VehicleType } from "./fleet";
import { vehicleGeometry } from "./vehicle-geometry";

export interface TrafficRoad {
  points: [number, number][];
  /** Measured vehicles per hour on this link. */
  flow: number;
  /** Measured mean speed, km/h. */
  speedKmh: number;
  suppressed: boolean;
  /** This link's OWN measured class mix. */
  classMix?: Record<string, number>;
}

/**
 * Traffic, by class.
 *
 * Every vehicle here is a real measurement. How many are on a link is its
 * measured flow; how fast they move is its measured speed; and *what they are*
 * is that link's own measured class composition. Where counts were suppressed
 * for low quality the link carries nothing at all — the twin must never invent
 * traffic it did not measure, and you can watch it refusing to.
 *
 * One InstancedMesh per class, so eight draw calls for the whole city.
 */
const MAX_VEHICLES = 1400;

interface Vehicle {
  road: number;
  offset: number;
  speed: number;
  lateral: number;
}

function buildVehicles(roads: TrafficRoad[], budget: number) {
  const active = roads.filter((r) => !r.suppressed && r.flow > 0 && r.points.length > 1);
  const totalFlow = active.reduce((s, r) => s + r.flow, 0) || 1;
  const byClass = new Map<string, Vehicle[]>(FLEET.map((t) => [t.code, []]));

  for (const road of active) {
    const index = roads.indexOf(road);
    const share = road.flow / totalFlow;
    const onThisLink = Math.max(1, Math.round(budget * share));
    const mix = road.classMix && Object.keys(road.classMix).length ? road.classMix : DEFAULT_MIX;
    // km/h -> scene units per second (SCENE_SCALE units per metre).
    const base = ((road.speedKmh * 1000) / 3600) * SCENE_SCALE;

    for (const type of FLEET) {
      const classShare = Number(mix[type.code] ?? 0);
      const count = Math.round(onThisLink * classShare);
      const bucket = byClass.get(type.code)!;
      for (let i = 0; i < count; i += 1) {
        // Deterministic spread — the demo must look identical on every run.
        const jitter = ((i * 2654435761) % 1000) / 1000 - 0.5;
        bucket.push({
          road: index,
          offset: (i + jitter * 0.5) / Math.max(1, count),
          speed: base * type.speed,
          lateral: type.lateral + jitter * type.wander,
        });
      }
    }
  }
  return byClass;
}

function ClassLayer({
  type,
  vehicles,
  roads,
  lengths,
  daylight,
}: {
  type: VehicleType;
  vehicles: Vehicle[];
  roads: TrafficRoad[];
  lengths: number[];
  daylight: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => new THREE.Color(), []);
  const live = useRef<Vehicle[]>([]);

  // The silhouette is already built to scale, in metres, and cached per class.
  const geometry = useMemo(() => vehicleGeometry(type.code), [type.code]);
  const rideHeight = 0.02;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    live.current = vehicles.map((v) => ({ ...v }));
    mesh.count = live.current.length;

    live.current.forEach((v, i) => {
      const pts = roads[v.road]?.points;
      let heading = 0;
      if (pts && pts.length > 1) {
        heading = Math.atan2(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]);
      }
      if (daylight) {
        scratch.set(type.day);
      } else {
        // Headlights toward you, tail lights away — the detail that makes a
        // night road read as traffic rather than as dots.
        scratch.set(Math.cos(heading) < 0 ? type.night : TAIL_LIGHT);
      }
      mesh.setColorAt(i, scratch);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [vehicles, roads, daylight, type, scratch]);

  useFrame((_s, delta) => {
    const mesh = ref.current;
    const items = live.current;
    if (!mesh || items.length === 0) return;
    const step = Math.min(delta, 0.1);

    for (let i = 0; i < items.length; i += 1) {
      const v = items[i]!;
      const road = roads[v.road];
      if (!road) continue;
      const length = lengths[v.road] || 1;
      v.offset = (v.offset + (v.speed * step) / length) % 1;

      const target = v.offset * length;
      const pts = road.points;
      let travelled = 0;
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

      // Lateral offset places the class across the carriageway: two-wheelers
      // filtering, buses holding the left lane.
      const across = v.lateral * 0.32;
      dummy.position.set(x - dz * across, rideHeight, z + dx * across);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (vehicles.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, vehicles.length]}
      frustumCulled={false}
    >
      {/* vertexColors carries the material — bodywork takes the instance colour,
          glass is dimmer, tyres stay dark whatever the body is lit to. */}
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

export function Traffic({
  roads,
  quality = 1,
  daylight = false,
}: {
  roads: TrafficRoad[];
  quality?: number;
  daylight?: boolean;
}) {
  const lengths = useMemo(() => roads.map((r) => polylineLength(r.points) || 1), [roads]);
  const byClass = useMemo(
    () => buildVehicles(roads, Math.floor(MAX_VEHICLES * Math.max(0.1, Math.min(1, quality)))),
    [roads, quality],
  );

  return (
    <group>
      {FLEET.map((type) => (
        <ClassLayer
          key={type.code}
          type={type}
          vehicles={byClass.get(type.code) ?? []}
          roads={roads}
          lengths={lengths}
          daylight={daylight}
        />
      ))}
    </group>
  );
}
