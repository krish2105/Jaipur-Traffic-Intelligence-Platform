import * as THREE from "three";
// three's own addon rather than three-stdlib: stdlib exports this under a
// different name and pulls React 18 peers with it.
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { SCENE_SCALE } from "@/lib/geo";

/**
 * Vehicle silhouettes, built in code.
 *
 * A box is not a vehicle. What makes something read as a car at a glance is the
 * step from bonnet to cabin and the dark gap of the wheels underneath — so each
 * class is assembled from a few primitives and merged into ONE geometry, which
 * keeps every class at a single instanced draw call.
 *
 * Built procedurally rather than loaded as GLTF: no assets to license, nothing
 * to download, and the offline demo keeps working. Dimensions are real metres
 * from docs/04 §2's IRC classes, scaled to scene units at the end.
 *
 * Vertex colour encodes MATERIAL, not paint: 1.0 takes the instance colour
 * (bodywork, which becomes a headlight or tail light at night), 0.55 is glass,
 * 0.10 is tyre. Three multiplies vertex colour by instance colour, so wheels
 * stay dark however the body is lit.
 */

const BODY = 1.0;
const GLASS = 0.55;
const TYRE = 0.1;

function tinted(geometry: THREE.BufferGeometry, value: number): THREE.BufferGeometry {
  const count = geometry.attributes.position!.count;
  const colours = new Float32Array(count * 3).fill(value);
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return geometry;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  tint = BODY,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return tinted(g, tint);
}

/** Wheels are cylinders laid on their side — axis along X, the vehicle's width. */
function wheel(radius: number, width: number, x: number, y: number, z: number) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 10);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return tinted(g, TYRE);
}

function axle(radius: number, width: number, halfTrack: number, y: number, z: number) {
  return [wheel(radius, width, -halfTrack, y, z), wheel(radius, width, halfTrack, y, z)];
}

/** Metres in, scene units out. Everything below is written in real metres. */
function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("failed to merge vehicle geometry");
  merged.scale(SCENE_SCALE, SCENE_SCALE, SCENE_SCALE);
  merged.computeVertexNormals();
  return merged;
}

function car(): THREE.BufferGeometry {
  return finish([
    box(1.8, 0.62, 4.2, 0, 0.62, 0),               // lower body
    box(1.62, 0.52, 2.1, 0, 1.16, -0.15, GLASS),   // cabin + glasshouse
    box(1.7, 0.16, 1.2, 0, 0.94, 1.5),             // bonnet step
    ...axle(0.32, 0.22, 0.82, 0.32, 1.3),
    ...axle(0.32, 0.22, 0.82, 0.32, -1.35),
  ]);
}

/** The class that decides the whole product. 61% of what you see is this. */
function twoWheeler(): THREE.BufferGeometry {
  return finish([
    box(0.26, 0.34, 1.55, 0, 0.62, 0),             // frame + tank
    box(0.42, 0.62, 0.34, 0, 1.12, -0.18, GLASS),  // rider
    box(0.5, 0.1, 0.36, 0, 1.02, 0.5),             // handlebars
    wheel(0.29, 0.12, 0, 0.29, 0.62),
    wheel(0.29, 0.12, 0, 0.29, -0.62),
  ]);
}

/** Three wheels, upright cabin, canopy. Unmistakably Indian in silhouette. */
function autoRickshaw(): THREE.BufferGeometry {
  return finish([
    box(1.3, 0.72, 2.2, 0, 0.62, -0.1),
    box(1.24, 0.66, 1.7, 0, 1.3, -0.25, GLASS),    // canopy
    box(0.5, 0.5, 0.5, 0, 0.9, 1.05),              // front cowl
    wheel(0.3, 0.14, 0, 0.3, 1.0),                 // single front wheel
    ...axle(0.32, 0.16, 0.6, 0.32, -0.85),
  ]);
}

function eRickshaw(): THREE.BufferGeometry {
  return finish([
    box(1.24, 0.6, 2.0, 0, 0.58, 0),
    box(1.2, 0.9, 1.5, 0, 1.3, -0.2, GLASS),
    wheel(0.28, 0.12, 0, 0.28, 0.85),
    ...axle(0.28, 0.14, 0.56, 0.28, -0.75),
  ]);
}

function lcv(): THREE.BufferGeometry {
  return finish([
    box(2.0, 1.5, 3.3, 0, 1.15, -0.9),             // cargo box
    box(1.9, 1.0, 1.9, 0, 0.9, 1.6, GLASS),        // cab
    ...axle(0.38, 0.24, 0.9, 0.38, 1.5),
    ...axle(0.38, 0.26, 0.92, 0.38, -1.6),
  ]);
}

function bus(): THREE.BufferGeometry {
  return finish([
    box(2.6, 2.3, 11.0, 0, 1.55, 0),
    box(2.62, 0.75, 9.6, 0, 2.25, -0.2, GLASS),    // window band
    ...axle(0.5, 0.3, 1.2, 0.5, 4.0),
    ...axle(0.5, 0.34, 1.2, 0.5, -3.2),
    ...axle(0.5, 0.34, 1.2, 0.5, -4.2),
  ]);
}

function truck(): THREE.BufferGeometry {
  return finish([
    box(2.5, 2.4, 5.2, 0, 1.9, -1.3),              // load bed
    box(2.3, 1.9, 2.1, 0, 1.5, 2.4, GLASS),        // cab
    ...axle(0.52, 0.3, 1.1, 0.52, 2.3),
    ...axle(0.52, 0.34, 1.15, 0.52, -1.6),
    ...axle(0.52, 0.34, 1.15, 0.52, -2.7),
  ]);
}

function cycle(): THREE.BufferGeometry {
  return finish([
    box(0.14, 0.26, 1.3, 0, 0.66, 0),
    box(0.36, 0.58, 0.28, 0, 1.1, -0.1, GLASS),    // rider
    wheel(0.33, 0.06, 0, 0.33, 0.52),
    wheel(0.33, 0.06, 0, 0.33, -0.52),
  ]);
}

const BUILDERS: Record<string, () => THREE.BufferGeometry> = {
  "2W": twoWheeler,
  CAR: car,
  AUTO: autoRickshaw,
  ERIK: eRickshaw,
  LCV: lcv,
  BUS: bus,
  TRK2: truck,
  NMV: cycle,
};

const cache = new Map<string, THREE.BufferGeometry>();

export function vehicleGeometry(code: string): THREE.BufferGeometry {
  const hit = cache.get(code);
  if (hit) return hit;
  const built = (BUILDERS[code] ?? car)();
  cache.set(code, built);
  return built;
}
