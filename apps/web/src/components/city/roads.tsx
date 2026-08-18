"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { buildRoadGeometry, type Ramp, type RoadInput } from "@/lib/ribbon";

/**
 * The road network, as emissive ribbons coloured by measured congestion.
 *
 * Two coincident layers: an opaque ribbon that reads as tarmac, and a slightly
 * wider additive layer beneath it that spills light onto the ground. The spill
 * is what makes the roads look like they are glowing rather than painted, and
 * it costs one extra draw call for the whole network.
 */
export function Roads({ roads, ramp }: { roads: RoadInput[]; ramp: Ramp }) {
  const surface = useMemo(() => buildRoadGeometry(roads, ramp), [roads, ramp]);
  const spill = useMemo(
    () => buildRoadGeometry(roads.map((r) => ({ ...r, width: r.width * 4.5 })), ramp),
    [roads, ramp],
  );

  return (
    <group>
      <mesh geometry={spill} position={[0, 0.02, 0]} renderOrder={0}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.30}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={surface} position={[0, 0.06, 0]} renderOrder={1}>
        {/* Basic, not standard: the congestion colour has to BE the emitted
            light. On a standard material the vertex colour lands on diffuse and
            needs a lamp to reveal it, which in a night scene means it reads as
            near-black. toneMapped={false} keeps the value above 1.0 so bloom
            has something to bloom. */}
        <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
