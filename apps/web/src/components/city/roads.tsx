"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { buildRoadGeometry, type RoadInput } from "@/lib/ribbon";

/**
 * The road network, as emissive ribbons coloured by measured congestion.
 *
 * Two coincident layers: an opaque ribbon that reads as tarmac, and a slightly
 * wider additive layer beneath it that spills light onto the ground. The spill
 * is what makes the roads look like they are glowing rather than painted, and
 * it costs one extra draw call for the whole network.
 */
export function Roads({ roads }: { roads: RoadInput[] }) {
  const surface = useMemo(() => buildRoadGeometry(roads), [roads]);
  const spill = useMemo(
    () => buildRoadGeometry(roads.map((r) => ({ ...r, width: r.width * 3.2 }))),
    [roads],
  );

  return (
    <group>
      <mesh geometry={spill} position={[0, 0.02, 0]} renderOrder={0}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={surface} position={[0, 0.06, 0]} renderOrder={1}>
        <meshStandardMaterial
          vertexColors
          emissive="#ffffff"
          emissiveIntensity={0.35}
          roughness={0.55}
          metalness={0.1}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
