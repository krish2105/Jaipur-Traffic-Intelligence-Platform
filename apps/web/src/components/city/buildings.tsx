"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { metres, project } from "@/lib/geo";

export interface BuildingBox {
  lon: number;
  lat: number;
  w: number;
  d: number;
  h: number;
  r: number;
}

/**
 * Urban context, as one InstancedMesh.
 *
 * Deliberately very dark and unlit-looking: the buildings exist to give the
 * corridor a city to sit in, and the moment they compete with the roads for
 * attention the data stops being the subject. A faint emissive floor keeps
 * them from reading as black holes against the fog.
 */
export function Buildings({ boxes, max = 6000 }: { boxes: BuildingBox[]; max?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const shown = useMemo(() => {
    if (boxes.length <= max) return boxes;
    // Keep the tallest — they carry the skyline; the rest is visual noise.
    return [...boxes].sort((a, b) => b.h - a.h).slice(0, max);
  }, [boxes, max]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    shown.forEach((b, i) => {
      const [x, z] = project(b.lon, b.lat);
      const height = metres(b.h);
      dummy.position.set(x, height / 2, z);
      dummy.rotation.set(0, -b.r, 0);
      dummy.scale.set(metres(b.w), height, metres(b.d));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shown]);

  if (shown.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, shown.length]} castShadow={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#0B0F1A"
        roughness={0.92}
        metalness={0.05}
        emissive="#141B2E"
        emissiveIntensity={0.32}
      />
    </instancedMesh>
  );
}
