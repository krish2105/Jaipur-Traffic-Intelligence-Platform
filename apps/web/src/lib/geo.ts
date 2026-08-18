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

/** Corridor centroid — the scene origin. Tonk Road, Yaadgaar to Sanganer. */
export const SCENE_ORIGIN: Origin = { lon: 75.8005, lat: 26.862 };

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
