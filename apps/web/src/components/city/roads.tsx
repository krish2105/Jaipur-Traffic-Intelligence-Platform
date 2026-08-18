"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { buildRoadGeometry, type Ramp, type RoadInput } from "@/lib/ribbon";

/**
 * The road network.
 *
 * A road is not a glowing slab. Painting the whole carriageway in the
 * congestion colour produced a wash that swamped the city and read as neon
 * soup — so the surface is dark asphalt, and the measurement is carried where a
 * road actually carries information: the edge lines and the centre line.
 *
 * The vertex colour is the congestion band. `v` runs across the carriageway and
 * `u` along it, which is what lets the shader place edges, dashes and a slow
 * flow without any texture.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  uniform vec3 uAsphalt;
  uniform vec3 uMarking;
  uniform float uDaylight;
  #include <fog_pars_fragment>

  void main() {
    // Distance from the nearest kerb, 0 at the edge, 0.5 at the centre line.
    float fromEdge = min(vUv.y, 1.0 - vUv.y);

    // Kerb lines: the brightest thing on the road, and where the congestion
    // band actually reads.
    float edge = 1.0 - smoothstep(0.0, 0.09, fromEdge);

    // Centre line, dashed, and only on wider carriageways.
    float centre = 1.0 - smoothstep(0.0, 0.035, abs(vUv.y - 0.5));
    float dash = step(0.45, fract(vUv.x * 220.0));
    centre *= dash;

    // A static bias of light along the carriageway, so the surface is not dead
    // flat but never competes with the lines.
    float sheen = 0.05 + 0.05 * sin(vUv.x * 12.0);

    vec3 colour = uAsphalt;
    // At night the surface carries a faint wash of its own congestion band; by
    // day the tarmac is just tarmac and the data lives on the lines, exactly as
    // it does on a real road.
    colour = mix(colour, vColor * 0.30, sheen * 4.0 * (1.0 - uDaylight));

    // The kerb line always carries the measurement — it is the data, and it
    // must mean the same thing in both lighting modes.
    colour += vColor * edge * mix(1.35, 0.9, uDaylight);

    // The centre line is a road marking: white in daylight, tinted at night
    // where a white line would read as another light source.
    vec3 centreColour = mix(vColor * 0.55, uMarking, uDaylight);
    colour += centreColour * centre;

    gl_FragColor = vec4(colour, 1.0);
    #include <fog_fragment>
  }
`;

export function Roads({
  roads,
  ramp,
  daylight = false,
}: {
  roads: RoadInput[];
  ramp: Ramp;
  daylight?: boolean;
}) {
  const surface = useMemo(() => buildRoadGeometry(roads, ramp), [roads, ramp]);
  // A tight halo, not a floodlight. The previous 4.5x spill was ~200 m wide at
  // this scale and turned the whole corridor into a green smear.
  const halo = useMemo(
    () => buildRoadGeometry(roads.map((r) => ({ ...r, width: r.width * 1.9 })), ramp),
    [roads, ramp],
  );
  // No animated uniform here on purpose. The road surface does not need to
  // move — the traffic particles already carry all the motion the scene needs,
  // and a time uniform means either mutating a memoised value or a ref read
  // during render, both of which React's compiler correctly rejects.
  const uniforms = useMemo(
    () => ({
      uAsphalt: { value: new THREE.Color(daylight ? "#565C66" : "#0A0D15") },
      uMarking: { value: new THREE.Color("#F2F4F8") },
      uDaylight: { value: daylight ? 1 : 0 },
      fogColor: { value: new THREE.Color(daylight ? "#C3D0E4" : "#060A16") },
      fogDensity: { value: 0.0 },
    }),
    [daylight],
  );

  return (
    <group>
      <mesh geometry={halo} position={[0, 0.015, 0]} renderOrder={0} visible={!daylight}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.075}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={surface} position={[0, 0.05, 0]} renderOrder={1}>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          vertexColors
          fog
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** The ground the city stands on. Without it everything floats in void. */
export function Ground({ radius, daylight = false }: { radius: number; daylight?: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow={false}>
      <circleGeometry args={[radius * 4, 64]} />
      <meshStandardMaterial color={daylight ? "#B9BFC9" : "#070A12"} roughness={1} metalness={0} />
    </mesh>
  );
}
