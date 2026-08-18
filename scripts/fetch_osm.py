"""Refresh the cached Jaipur road-network extract from Overpass.

Run this when the network is available; the seed loader and the whole demo then
work from the cache with no network at all.

    uv run python scripts/fetch_osm.py
"""

from __future__ import annotations

from pathlib import Path

from pravaah.adapters.osm import OsmAdapter

CACHE = Path(__file__).resolve().parents[1] / "data" / "seeds" / "osm_tonk_road.json"


def main() -> int:
    adapter = OsmAdapter(CACHE, mode="live")
    ways = adapter.fetch()
    named = [w for w in ways if w.is_named]
    print(f"fetched {len(ways)} ways ({len(named)} named) -> {CACHE}")
    print(f"cache size: {CACHE.stat().st_size / 1024:.0f} KB")
    for w in sorted({w.name_en for w in named})[:15]:
        print(f"  {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
