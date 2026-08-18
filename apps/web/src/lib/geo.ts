/**
 * Projecting Jaipur onto the scene floor.
 *
 * The corridor is ~17 km end to end, so a local tangent-plane (equirectangular)
 * projection is accurate to well under a metre across it — a full Mercator
 * projection would add distortion we would then have to undo, and Three.js
 * wants metres, not degrees.
 *
 * Scene axes: +X east, +Z south, +Y up. Origin is the corridor centroid so the
 * camera orbits something meaningful rather than the Gulf of Guinea.
 */

export const M_PER_DEG_LAT = 111_132;
/** Longitude degrees shrink with latitude; Jaipur sits at ~26.87 N. */
export const M_PER_DEG_LON = 111_320 * Math.cos((26.87 * Math.PI) / 180);

export interface Origin {
  lon: number;
  lat: number;
}

/**
 * Fallback origin only. The real origin is computed from the geometry actually
 * loaded — see `centroidOf`. A hardcoded centre is a guess that silently drifts
 * the moment the corridor changes, and the symptom is a camera pointing at
 * empty space next to the city.
 */
export const SCENE_ORIGIN: Origin = { lon: 75.8005, lat: 26.862 };

/** True centroid of a set of lon/lat rings — the origin the camera should orbit. */
export function centroidOf(lines: [number, number][][]): Origin {
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const line of lines) {
    for (const [x, y] of line) {
      lon += x;
      lat += y;
      n += 1;
    }
  }
  return n === 0 ? SCENE_ORIGIN : { lon: lon / n, lat: lat / n };
}

/** Bounding radius of projected points, for framing the camera. */
export function boundsOf(points: [number, number][]): { radius: number } {
  if (points.length === 0) return { radius: 100 };
  let maxX = -Infinity;
  let minX = Infinity;
  let maxZ = -Infinity;
  let minZ = Infinity;
  for (const [x, z] of points) {
    if (x > maxX) maxX = x;
    if (x < minX) minX = x;
    if (z > maxZ) maxZ = z;
    if (z < minZ) minZ = z;
  }
  return { radius: Math.max(20, Math.hypot(maxX - minX, maxZ - minZ) / 2) };
}

/** Metres are unwieldy at city scale, so the scene works in units of 10 m. */
export const SCENE_SCALE = 0.1;

export function project(lon: number, lat: number, origin: Origin = SCENE_ORIGIN): [number, number] {
  const x = (lon - origin.lon) * M_PER_DEG_LON * SCENE_SCALE;
  // +Z points south in Three.js's right-handed frame, so northward latitude
  // becomes negative Z. Getting this backwards mirrors the whole city.
  const z = -(lat - origin.lat) * M_PER_DEG_LAT * SCENE_SCALE;
  return [x, z];
}

export function metres(value: number): number {
  return value * SCENE_SCALE;
}

/** GeoJSON LineString coordinates → scene-space points on the ground plane. */
export function projectLine(
  coordinates: [number, number][],
  origin: Origin = SCENE_ORIGIN,
): [number, number][] {
  return coordinates.map(([lon, lat]) => project(lon, lat, origin));
}

/** Cumulative length of a projected polyline, in scene units. */
export function polylineLength(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1]!;
    const [x1, z1] = points[i]!;
    total += Math.hypot(x1 - x0, z1 - z0);
  }
  return total;
}
