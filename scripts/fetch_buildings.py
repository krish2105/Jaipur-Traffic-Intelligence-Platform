"""Fetch and compact OSM building footprints along the Tonk Road corridor.

Rendering thousands of real extruded polygons would sink the frame budget for
no visible gain — the buildings are deliberately very dark massing that gives
the corridor urban context without competing with the data.

So each footprint is reduced to an oriented box: centre, width, depth, rotation
and height. That renders as a single InstancedMesh, which scales to thousands of
buildings at negligible cost.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import httpx
from pravaah.adapters.osm import OVERPASS_ENDPOINTS, USER_AGENT

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "seeds" / "osm_buildings.json"

# Tighter than the road bbox: a strip along the Tonk Road corridor. Buildings
# far from an instrumented corridor add payload and nothing else.
BBOX = (26.7900, 75.7780, 26.9150, 75.8280)  # S, W, N, E

QUERY = """
[out:json][timeout:90];
(
  way["building"]({s},{w},{n},{e});
);
out body geom;
"""

#: Buildings are an order of magnitude denser than roads, and a single query
#: over the whole corridor times out on every public Overpass mirror. Tiling is
#: the standard remedy: each tile is small enough to answer, and a failed tile
#: costs one tile rather than the whole fetch.
TILES_X, TILES_Y = 3, 5

#: Metres per degree at Jaipur's latitude (~26.9 N).
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(26.87))

#: Storeys are rarely tagged in Jaipur, so fall back on a plausible mix rather
#: than making every block the same height, which reads as a cemetery.
DEFAULT_LEVELS = {
    "yes": 2,
    "residential": 2,
    "house": 2,
    "apartments": 4,
    "commercial": 3,
    "retail": 2,
    "industrial": 1,
    "school": 2,
    "hospital": 4,
    "hotel": 5,
    "office": 5,
    "temple": 3,
}


def _levels(tags: dict[str, str]) -> float:
    for key in ("building:levels", "levels"):
        if key in tags:
            try:
                return float(tags[key])
            except ValueError:
                pass
    if "height" in tags:
        try:
            return float(tags["height"].split()[0]) / 3.2
        except (ValueError, IndexError):
            pass
    return float(DEFAULT_LEVELS.get(tags.get("building", "yes"), 2))


def _oriented_box(coords: list[tuple[float, float]]) -> dict[str, float] | None:
    """Reduce a footprint to the box that best covers it.

    Rotating-calipers would be exact; for dark background massing the dominant
    edge direction is indistinguishable and far cheaper.
    """
    if len(coords) < 3:
        return None
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    clon, clat = sum(lons) / len(lons), sum(lats) / len(lats)

    # longest edge sets the rotation
    best_len, angle = 0.0, 0.0
    for i in range(len(coords) - 1):
        dx = (coords[i + 1][0] - coords[i][0]) * M_PER_DEG_LON
        dy = (coords[i + 1][1] - coords[i][1]) * M_PER_DEG_LAT
        length = math.hypot(dx, dy)
        if length > best_len:
            best_len, angle = length, math.atan2(dy, dx)

    cos_a, sin_a = math.cos(-angle), math.sin(-angle)
    us, vs = [], []
    for lon, lat in coords:
        x = (lon - clon) * M_PER_DEG_LON
        y = (lat - clat) * M_PER_DEG_LAT
        us.append(x * cos_a - y * sin_a)
        vs.append(x * sin_a + y * cos_a)
    width = max(us) - min(us)
    depth = max(vs) - min(vs)
    if width < 3 or depth < 3 or width > 400 or depth > 400:
        return None
    return {
        "lon": round(clon, 6),
        "lat": round(clat, 6),
        "w": round(width, 1),
        "d": round(depth, 1),
        "r": round(angle, 3),
    }


def _fetch_tile(bounds: tuple[float, float, float, float]) -> list[dict[str, object]]:
    s, w, n, e = bounds
    query = QUERY.format(s=s, w=w, n=n, e=e)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    for url in OVERPASS_ENDPOINTS:
        try:
            response = httpx.post(url, data={"data": query}, headers=headers, timeout=150.0)
            response.raise_for_status()
            return response.json().get("elements", [])  # type: ignore[no-any-return]
        except (httpx.HTTPError, ValueError):
            continue
    return []


def main() -> int:
    s, w, n, e = BBOX
    elements: list[dict[str, object]] = []
    failed = 0
    total = TILES_X * TILES_Y
    for iy in range(TILES_Y):
        for ix in range(TILES_X):
            bounds = (
                s + (n - s) * iy / TILES_Y,
                w + (e - w) * ix / TILES_X,
                s + (n - s) * (iy + 1) / TILES_Y,
                w + (e - w) * (ix + 1) / TILES_X,
            )
            got = _fetch_tile(bounds)
            if not got:
                failed += 1
            elements.extend(got)
            done = iy * TILES_X + ix + 1
            print(f"  tile {done}/{total}: {len(got):>5} ways   (running total {len(elements):,})")
    if failed:
        # Never let a partial fetch masquerade as a complete one.
        print(f"  WARNING: {failed}/{total} tiles returned nothing")
    if not elements:
        print("every tile failed")
        return 1

    boxes = []
    seen: set[int] = set()
    for element in elements:
        if element.get("type") != "way" or "geometry" not in element:
            continue
        # Tiles overlap at their edges, so the same way can arrive twice.
        osm_id = int(element["id"])
        if osm_id in seen:
            continue
        seen.add(osm_id)
        coords = [(p["lon"], p["lat"]) for p in element["geometry"]]
        box = _oriented_box(coords)
        if box is None:
            continue
        box["h"] = round(_levels(element.get("tags", {})) * 3.2, 1)
        boxes.append(box)

    OUT.write_text(
        json.dumps({"bbox": BBOX, "count": len(boxes), "buildings": boxes}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"\n  {len(boxes):,} buildings -> {OUT.relative_to(ROOT)}")
    print(f"  {OUT.stat().st_size / 1024:.0f} KB")
    if boxes:
        heights = sorted(b["h"] for b in boxes)
        print(
            f"  height p50 {heights[len(heights) // 2]:.1f} m, "
            f"p95 {heights[int(len(heights) * 0.95)]:.1f} m"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
