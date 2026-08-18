import * as THREE from "three";

import { polylineLength } from "@/lib/geo";

/**
 * Turn projected road polylines into ONE merged ribbon geometry.
 *
 * 594 separate meshes would be 594 draw calls; merged with per-vertex colour it
 * is one. That is the difference between a scene that holds 60fps on a laptop
 * and one that does not.
 *
 * UVs carry meaning: `u` runs 0→1 along the road's length so a shader or
 * texture can flow along it, and `v` runs across the width so the edges can be
 * feathered. Vertex colour carries the congestion band, so the road literally
 * glows the colour of its own measurement.
 */

export interface RoadInput {
  points: [number, number][];
  congestionIndex: number;
  /** Lanes drive ribbon width — a six-lane trunk should not look like a lane. */
  width: number;
  suppressed: boolean;
}

/**
 * The five congestion band colours, resolved for the active palette.
 *
 * Passed in rather than read from `getComputedStyle` inside the builder: the
 * palette attribute is set by an effect, so a builder that reads the DOM during
 * render always sees the *previous* palette. That bug shipped once — every
 * palette rendered the first one's colours.
 */
export interface Ramp {
  free: string;
  light: string;
  moderate: string;
  severe: string;
  critical: string;
  suppressed: string;
}

function bandFor(index: number, ramp: Ramp): string {
  if (index <= 25) return ramp.free;
  if (index <= 50) return ramp.light;
  if (index <= 70) return ramp.moderate;
  if (index <= 85) return ramp.severe;
  return ramp.critical;
}

export function buildRoadGeometry(roads: RoadInput[], ramp: Ramp): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexCursor = 0;

  for (const road of roads) {
    const pts = road.points;
    if (pts.length < 2) continue;

    // docs/06 §3 — suppressed stretches render inert, never a colour that
    // implies a measurement we do not have.
    const colour = new THREE.Color(
      road.suppressed ? ramp.suppressed : bandFor(road.congestionIndex, ramp),
    );
    const total = polylineLength(pts) || 1;
    const half = road.width / 2;
    let travelled = 0;

    for (let i = 0; i < pts.length; i += 1) {
      const [x, z] = pts[i]!;
      // Direction is the average of the incoming and outgoing segments, so
      // corners miter instead of pinching.
      const prev = pts[i - 1] ?? pts[i]!;
      const next = pts[i + 1] ?? pts[i]!;
      let dx = next[0] - prev[0];
      let dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // Perpendicular in the ground plane.
      const nx = -dz;
      const nz = dx;

      if (i > 0) {
        const [px, pz] = pts[i - 1]!;
        travelled += Math.hypot(x - px, z - pz);
      }
      const u = travelled / total;

      positions.push(x + nx * half, 0, z + nz * half);
      positions.push(x - nx * half, 0, z - nz * half);
      colors.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
      uvs.push(u, 0, u, 1);

      if (i < pts.length - 1) {
        const a = vertexCursor + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    vertexCursor += pts.length * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
