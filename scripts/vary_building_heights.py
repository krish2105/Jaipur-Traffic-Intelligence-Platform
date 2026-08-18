"""Give the massing a believable height distribution.

OSM almost never carries `building:levels` in Jaipur, so the fetcher's fallback
assigned every building the same 6.4 m and the skyline came out as a field of
identical blocks — a cemetery, not a city.

Real height correlates with footprint: a large footprint is usually commercial
or an apartment block, a small one is usually a two-storey house. So height is
derived from area, then jittered deterministically from the building's own
coordinates so the result is varied but identical on every machine and every
run — the demo must look the same everywhere.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

SEEDS = Path(__file__).resolve().parents[1] / "data" / "seeds"
PATH = SEEDS / "osm_buildings.json"

STOREY_M = 3.2


def _hash_unit(lon: float, lat: float) -> float:
    """Deterministic 0..1 from position. Same building, same jitter, always."""
    digest = hashlib.sha256(f"{lon:.6f},{lat:.6f}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def storeys_for(area_m2: float, roll: float) -> float:
    """Plausible storey count for a Jaipur footprint.

    Bands rather than a smooth curve, because real building stock is banded:
    houses, low apartments, mid-rise commercial, the occasional tower.
    """
    if area_m2 < 80:
        base, spread = 1.6, 1.0  # small houses, outbuildings
    elif area_m2 < 250:
        base, spread = 2.4, 1.6  # typical residential plot
    elif area_m2 < 800:
        base, spread = 3.6, 2.6  # apartments, shops with flats above
    elif area_m2 < 2500:
        base, spread = 5.0, 3.5  # commercial blocks
    else:
        base, spread = 7.0, 5.0  # malls, institutions, the odd tower
    # Skew toward the lower end — tall buildings are the exception everywhere.
    return max(1.0, base + spread * (roll**2.2))


def main() -> int:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    buildings = data["buildings"]
    for b in buildings:
        area = b["w"] * b["d"]
        roll = _hash_unit(b["lon"], b["lat"])
        b["h"] = round(storeys_for(area, roll) * STOREY_M, 1)

    PATH.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

    heights = sorted(b["h"] for b in buildings)
    n = len(heights)
    print(f"  {n:,} buildings re-heighted")
    for label, q in (("p10", 0.10), ("p50", 0.50), ("p90", 0.90), ("p99", 0.99)):
        print(f"    {label}  {heights[min(n - 1, int(n * q))]:5.1f} m")
    print(f"    max  {heights[-1]:5.1f} m")
    distinct = len({b["h"] for b in buildings})
    print(f"  {distinct} distinct heights ({'varied' if distinct > 50 else 'STILL TOO UNIFORM'})")
    return 0 if distinct > 50 else 1


if __name__ == "__main__":
    raise SystemExit(main())
