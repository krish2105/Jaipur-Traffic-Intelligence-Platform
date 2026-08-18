"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { SCENE_SCALE, metres, project, type Origin } from "@/lib/geo";

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
 * An explicit ShaderMaterial rather than onBeforeCompile injection. Patching
 * three's chunk system meant guessing which varyings existed at which include
 * point, and two rounds of plausible-looking fixes produced no windows at all.
 * Everything here is declared, so there is nothing to guess at: instancing,
 * fog and lighting are applied by hand.
 *
 * Still one InstancedMesh — a single draw call for several thousand buildings.
 */

const vertexShader = /* glsl */ `
  attribute float aSeed;

  varying float vSeed;
  varying vec3  vLocalM;   // position within this building, in metres
  varying vec3  vScaleM;   // this building's real size, in metres
  varying float vUpness;   // 1 on the roof, 0 on the walls — WORLD space
  varying float vFogDepth;

  void main() {
    vSeed = aSeed;

    // Recover the instance's real dimensions from its matrix so the window
    // grid can be sized in metres instead of in box-fractions.
    vScaleM = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vLocalM = position * vScaleM;

    // World space, deliberately. A view-space normal makes roofs light up and
    // go dark as the camera orbits, which is what the previous version did.
    vec3 worldNormal = normalize(mat3(instanceMatrix) * normal);
    vUpness = abs(worldNormal.y);

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying float vSeed;
  varying vec3  vLocalM;
  varying vec3  vScaleM;
  varying float vUpness;
  varying float vFogDepth;

  uniform vec3  uBase;
  uniform vec3  uWarm;
  uniform vec3  uCool;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform vec2  uCell;     // window bay size, metres
  uniform float uLitRatio;
  // Scene units per metre. The instance matrix is built in SCENE units
  // (1 unit = 10 m), so every length coming out of it must be converted before
  // being compared against a value expressed in metres. Skipping this made the
  // ground-floor cutoff of 4 m taller than the tallest building in the city,
  // and no window ever lit.
  uniform float uUnitsPerMetre;
  uniform float uWindowStrength;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }

  void main() {
    // Height above this building's own base, converted to metres.
    float heightM = (vLocalM.y + vScaleM.y * 0.5) / uUnitsPerMetre;

    // Walls only. A roof full of windows is the classic procedural-city tell.
    float wall = 1.0 - smoothstep(0.35, 0.72, vUpness);

    // Which wall we are on decides which horizontal axis runs along it.
    float along = (abs(vLocalM.x) > abs(vLocalM.z) ? vLocalM.z : vLocalM.x)
                / uUnitsPerMetre;

    vec2 uvM  = vec2(along, heightM) / uCell;
    vec2 cell = floor(uvM);
    vec2 f    = fract(uvM);

    float lit  = step(1.0 - uLitRatio, hash(cell + vSeed * 97.0));
    float pane = step(0.12, f.x) * step(f.x, 0.88)
               * step(0.16, f.y) * step(f.y, 0.78);
    // Ground floor stays dark; shopfront detail is noise at this distance.
    float above = step(4.0, heightM);

    vec3 tint = mix(uCool, uWarm, hash(cell.yx + vSeed * 13.0));

    // Cheap directional shading so the faces separate without a light rig.
    float facing = 0.55 + 0.45 * (1.0 - vUpness);
    vec3 colour = uBase * facing;
    float window = lit * pane * wall * above;
    // Night: the window emits. Day: it is dark glazing against pale stone,
    // which is what a window actually looks like from outside at noon.
    colour += tint * window * uWindowStrength;
    colour = mix(colour, colour * 0.42, window * (1.0 - uWindowStrength));

    // Exponential-squared fog, matching the scene's.
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    colour = mix(colour, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export function Buildings({
  boxes,
  origin,
  fogDensity,
  fogColor,
  windowStrength,
  max = 6000,
}: {
  boxes: BuildingBox[];
  origin: Origin;
  fogDensity: number;
  fogColor: string;
  windowStrength: number;
  max?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const shown = useMemo(() => {
    if (boxes.length <= max) return boxes;
    return [...boxes].sort((a, b) => b.h - a.h).slice(0, max);
  }, [boxes, max]);

  const uniforms = useMemo(
    () => ({
      // Daylight base is warm plaster. Jaipur's walls are washed in
      // sandstone pink and ochre; a cool grey reads as concrete and, against
      // warm ground, as an absence rather than a building.
      uBase: { value: new THREE.Color(windowStrength > 0 ? "#1E2536" : "#CDBBA4") },
      uWarm: { value: new THREE.Color("#FFCE8A") },
      uCool: { value: new THREE.Color("#A9C8FF") },
      uFogColor: { value: new THREE.Color(fogColor) },
      uFogDensity: { value: fogDensity },
      uWindowStrength: { value: windowStrength },
      // Bays sized for the viewing distance, not for architectural truth: a
      // real 2.6 m pane is sub-pixel across a corridor and averages to grey.
      uCell: { value: new THREE.Vector2(6.5, 4.2) },
      uLitRatio: { value: 0.55 },
      uUnitsPerMetre: { value: SCENE_SCALE },
    }),
    [fogDensity, fogColor, windowStrength],
  );

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
      // Deterministic per building: the same windows are lit on every run, so
      // the demo looks identical on any machine.
      seeds[i] = Math.abs(Math.sin(b.lon * 127.1 + b.lat * 311.7) * 43758.5453) % 1;
    });

    mesh.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shown, origin]);

  if (shown.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, shown.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </instancedMesh>
  );
}
