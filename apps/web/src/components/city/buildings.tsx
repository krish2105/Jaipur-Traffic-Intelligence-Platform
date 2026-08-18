"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { metres, project, type Origin } from "@/lib/geo";

export interface BuildingBox {
  lon: number;
  lat: number;
  w: number;
  d: number;
  h: number;
  r: number;
}

/**
 * Urban massing with lit windows.
 *
 * Flat grey boxes read as crates, not buildings — the thing that makes a night
 * city legible is the window grid, not the silhouette. So the material injects
 * a procedural window pattern computed in each instance's own local metres,
 * which means windows stay a constant real-world size whatever the building's
 * dimensions, instead of stretching with it.
 *
 * Still one InstancedMesh and one draw call for several thousand buildings.
 */
export function Buildings({
  boxes,
  origin,
  max = 6000,
}: {
  boxes: BuildingBox[];
  origin: Origin;
  max?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const shown = useMemo(() => {
    if (boxes.length <= max) return boxes;
    return [...boxes].sort((a, b) => b.h - a.h).slice(0, max);
  }, [boxes, max]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      // Light enough to hold a silhouette against the fog. Pure dark grey
      // disappears into the background and the city stops existing.
      color: "#232B3E",
      roughness: 0.82,
      metalness: 0.06,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           attribute float aSeed;
           varying float vSeed;
           varying vec3 vLocal;
           varying vec3 vScale;
           varying float vUpness;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vSeed = aSeed;
           // Recover this instance's real-world size from its matrix, so the
           // window grid is sized in metres rather than in box-fractions.
           vScale = vec3(
             length(instanceMatrix[0].xyz),
             length(instanceMatrix[1].xyz),
             length(instanceMatrix[2].xyz)
           );
           vLocal = position * vScale;
           // World-space up, computed here on purpose: vNormal in the fragment
           // shader is in VIEW space, so testing it for "is this a roof" makes
           // the windows appear and disappear as the camera orbits.
           vec3 worldNormal = normalize(mat3(instanceMatrix) * normal);
           vUpness = abs(worldNormal.y);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           varying float vSeed;
           varying vec3 vLocal;
           varying vec3 vScale;
           varying float vUpness;
           uniform vec3 uWindowWarm;
           uniform vec3 uWindowCool;

           float hash(vec2 p) {
             return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
           }`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           {
             // Windows only on the vertical faces — a roof full of windows is
             // the classic tell of a procedural city.
             float verticality = 1.0 - smoothstep(0.35, 0.75, vUpness);
             // ~3.2 m floors, ~2.6 m bays, in this instance's own metres.
             vec2 grid = vec2(
               abs(vLocal.x) > abs(vLocal.z) ? vLocal.z : vLocal.x,
               vLocal.y
             );
             vec2 cell = floor(vec2(grid.x / 2.6, grid.y / 3.2));
             // Roughly half the windows lit. Too few reads as derelict, too
             // many as a render test.
             float lit = step(0.48, hash(cell + vSeed * 97.0));
             // Leave a margin so windows are panes, not a continuous band.
             vec2 f = fract(vec2(grid.x / 7.0, grid.y / 5.0));
             float pane = step(0.12, f.x) * step(f.x, 0.88)
                        * step(0.18, f.y) * step(f.y, 0.74);
             // Ground floor stays dark; shopfronts at this zoom are noise.
             float aboveGround = step(3.4, vLocal.y + vScale.y * 0.5);
             vec3 tint = mix(uWindowCool, uWindowWarm, hash(cell.yx + vSeed));
             // Strong enough to clear the bloom threshold and the fog. This is
             // the single thing that makes massing read as buildings.
             totalEmissiveRadiance += tint * lit * pane * verticality * aboveGround * 14.0;
           }`,
        );

      shader.uniforms.uWindowWarm = { value: new THREE.Color("#FFD9A0") };
      shader.uniforms.uWindowCool = { value: new THREE.Color("#9FC4FF") };
    };
    // Any change to the injected chunks needs a distinct cache key or three
    // silently reuses the previous program.
    mat.customProgramCacheKey = () => "pravaah-building-windows-v3";
    return mat;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const seeds = new Float32Array(shown.length);

    shown.forEach((b, i) => {
      const [x, z] = project(b.lon, b.lat, origin);
      const height = metres(b.h);
      dummy.position.set(x, height / 2, z);
      dummy.rotation.set(0, -b.r, 0);
      dummy.scale.set(metres(b.w), height, metres(b.d));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Deterministic per building, so the same windows are lit on every run.
      seeds[i] = ((Math.abs(Math.sin(b.lon * 127.1 + b.lat * 311.7)) * 43758.5453) % 1);
    });

    mesh.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shown, origin]);

  if (shown.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, shown.length]}
      material={material}
      castShadow={false}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}
