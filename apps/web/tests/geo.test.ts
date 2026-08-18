import { describe, expect, it } from "vitest";
import { M_PER_DEG_LON, SCENE_ORIGIN, project, projectLine, polylineLength } from "@/lib/geo";

describe("scene projection", () => {
  it("puts the origin at the scene centre", () => {
    expect(project(SCENE_ORIGIN.lon, SCENE_ORIGIN.lat)).toEqual([0, -0]);
  });

  it("maps east to +X", () => {
    const [x] = project(SCENE_ORIGIN.lon + 0.01, SCENE_ORIGIN.lat);
    expect(x).toBeGreaterThan(0);
  });

  it("maps north to -Z, because +Z is south in a right-handed frame", () => {
    const [, z] = project(SCENE_ORIGIN.lon, SCENE_ORIGIN.lat + 0.01);
    expect(z).toBeLessThan(0);
  });

  it("shrinks longitude degrees for Jaipur's latitude", () => {
    // A degree of longitude at 26.87 N is ~89 km, not 111 km. Getting this
    // wrong stretches the city east-west by about 12%.
    expect(M_PER_DEG_LON).toBeGreaterThan(99_000);
    expect(M_PER_DEG_LON).toBeLessThan(100_000);
  });

  it("measures a known distance correctly", () => {
    // 0.01 degrees of latitude is 1111.32 m; at 0.1 scene units per metre
    // that is 111.132 scene units.
    const line = projectLine([
      [SCENE_ORIGIN.lon, SCENE_ORIGIN.lat],
      [SCENE_ORIGIN.lon, SCENE_ORIGIN.lat + 0.01],
    ]);
    expect(polylineLength(line)).toBeCloseTo(111.132, 2);
  });
});
