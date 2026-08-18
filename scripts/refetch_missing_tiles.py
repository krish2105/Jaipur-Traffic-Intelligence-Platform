"""Re-fetch the building tiles that came back empty.

The first pass lost 5 of 15 tiles to Overpass timeouts, leaving holes in the
massing. Rather than trusting that log, this recomputes which tiles are empty by
counting the buildings we already have inside each tile's bounds — a tile that
genuinely has no buildings and a tile that failed look identical in a log, but
only the second one is worth retrying, and re-running everything would risk
losing tiles that succeeded.

Retries each empty tile against every mirror with backoff, then merges.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
from pravaah.adapters.osm import OVERPASS_ENDPOINTS, USER_AGENT

from scripts.fetch_buildings import BBOX, QUERY, TILES_X, TILES_Y, _levels, _oriented_box

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "seeds" / "osm_buildings.json"

ATTEMPTS_PER_ENDPOINT = 2


def tile_bounds(ix: int, iy: int) -> tuple[float, float, float, float]:
    s, w, n, e = BBOX
    return (
        s + (n - s) * iy / TILES_Y,
        w + (e - w) * ix / TILES_X,
        s + (n - s) * (iy + 1) / TILES_Y,
        w + (e - w) * (ix + 1) / TILES_X,
    )


def fetch_tile(bounds: tuple[float, float, float, float]) -> list[dict[str, Any]] | None:
    """None means every endpoint failed; [] means the tile is genuinely empty."""
    s, w, n, e = bounds
    query = QUERY.format(s=s, w=w, n=n, e=e)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    for attempt in range(ATTEMPTS_PER_ENDPOINT):
        for url in OVERPASS_ENDPOINTS:
            try:
                response = httpx.post(url, data={"data": query}, headers=headers, timeout=180.0)
                response.raise_for_status()
                return response.json().get("elements", [])  # type: ignore[no-any-return]
            except (httpx.HTTPError, ValueError):
                continue
        # Overpass rate-limits aggressively; give it room before going again.
        time.sleep(20 * (attempt + 1))
    return None


def main() -> int:
    data = json.loads(OUT.read_text(encoding="utf-8"))
    existing = data["buildings"]
    print(f"  starting from {len(existing):,} buildings")

    empty: list[tuple[int, int]] = []
    for iy in range(TILES_Y):
        for ix in range(TILES_X):
            s, w, n, e = tile_bounds(ix, iy)
            count = sum(1 for b in existing if s <= b["lat"] < n and w <= b["lon"] < e)
            if count == 0:
                empty.append((ix, iy))
    print(f"  {len(empty)} tiles hold no buildings: {empty}")

    added = 0
    seen_positions = {(round(b["lon"], 6), round(b["lat"], 6)) for b in existing}
    for ix, iy in empty:
        bounds = tile_bounds(ix, iy)
        elements = fetch_tile(bounds)
        if elements is None:
            print(f"    tile ({ix},{iy}): still failing on every mirror")
            continue
        gained = 0
        for element in elements:
            if element.get("type") != "way" or "geometry" not in element:
                continue
            coords = [(p["lon"], p["lat"]) for p in element["geometry"]]
            box = _oriented_box(coords)
            if box is None:
                continue
            key = (round(box["lon"], 6), round(box["lat"], 6))
            if key in seen_positions:
                continue
            seen_positions.add(key)
            box["h"] = round(_levels(element.get("tags", {})) * 3.2, 1)
            existing.append(box)
            gained += 1
        added += gained
        print(f"    tile ({ix},{iy}): +{gained}")

    data["buildings"] = existing
    data["count"] = len(existing)
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(
        f"\n  +{added:,} buildings -> {len(existing):,} total, {OUT.stat().st_size / 1024:.0f} KB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
