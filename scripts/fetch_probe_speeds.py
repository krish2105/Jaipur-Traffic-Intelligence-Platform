"""Sample live probe speeds from TomTom and spread them across corridor links.

The free tier is the whole design constraint
--------------------------------------------
20,000 calls a month. Polling all 90 corridor links every fifteen minutes is
259,200, thirteen times the allowance, so the question is never "can we fetch"
but "what do we spend the allowance on".

The answer turned out better than the budget suggested: those 90 links resolve
to 25 TomTom segments, so 25 calls speak for the whole corridor network. Every
45 minutes between 06:00 and 22:00 is 16,000 a month — full coverage, 4,000 to
spare, and cheaper than the partial plan this replaced.

Links are not what TomTom sells
-------------------------------
The first version of this script asked about twenty links and treated the answer
as twenty measurements. It was not. TomTom matches a point to *its* nearest road
segment, and several of our links routinely sit on one of those: the first real
sweep returned twenty readings covering fifteen segments, so a quarter of the
budget bought a number we already had, and the map would have shown two links as
independently measured when they shared one reading.

So this works in two phases.

`--discover` asks about every corridor link once and records which TomTom
segment each one matched. Ninety calls, paid once, re-runnable when the road
network changes.

A normal sweep then reads each distinct *segment* once and applies that reading
to every link sitting on it. The same allowance covers far more of the network,
and the coverage figure counts something real. Nothing is presented as
separately measured when it is one reading shared.

What a reading is, and is not
-----------------------------
TomTom measures speed and delay. It cannot measure volume or composition, and
that gap is the whole reason this platform exists (docs/01 section 4). A reading
replaces a link's *modelled* speed and nothing else. It never becomes a vehicle
count and it never becomes a class mix.

Below 0.7 confidence TomTom is largely reporting its own historical model for
that segment. Those come back `is_measured: false` and the API leaves the link
modelled rather than dressing a model as a measurement.

    uv run python scripts/fetch_probe_speeds.py --discover  # once, 90 calls
    uv run python scripts/fetch_probe_speeds.py             # a sweep
    uv run python scripts/fetch_probe_speeds.py --dry-run   # selection only
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pravaah.api.core.settings  # noqa: F401  — exports .env to os.environ
from pravaah.adapters import tomtom
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

OUT = Path("data/probe/speeds.json")
MAP = Path("data/probe/segments.json")

#: The shape of the sampling decision, kept here so the output can state it.
#: Discovery found 90 corridor links resolving to 25 TomTom segments, so 25
#: calls covers the entire corridor network rather than a fifth of it. At 45
#: minutes that is 16,000 a month against a 20,000 allowance, which is both
#: fuller coverage and cheaper than the 20-links-every-30-minutes plan it
#: replaced. The cap stays as a guard: if a re-discovery ever finds many more
#: segments, the sweep thins rather than quietly overrunning the budget.
SAMPLE_SIZE = 25
WINDOW_START_HOUR = 6
WINDOW_END_HOUR = 22
SWEEP_MINUTES = 45

IST = timezone(timedelta(hours=5, minutes=30))


def planned_monthly_calls(per_sweep: int = SAMPLE_SIZE) -> int:
    sweeps_per_day = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60 // SWEEP_MINUTES
    return per_sweep * sweeps_per_day * 30


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Metres between two lon/lat pairs. Good enough for picking a midpoint."""
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def midpoint(coords: list[list[float]]) -> tuple[float, float]:
    """The point half way along a link by arc length, as (lat, lon).

    Not the mean of the endpoints: a link that bends puts that point off the
    carriageway, and TomTom snaps to whatever road is nearest — which on a
    divided arterial can be the service lane, or the wrong carriageway.
    """
    if len(coords) < 2:
        lon, lat = coords[0]
        return lat, lon
    spans = [_haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
    half = sum(spans) / 2
    run = 0.0
    for i, span in enumerate(spans):
        if run + span >= half:
            frac = (half - run) / span if span else 0.0
            (lon1, lat1), (lon2, lat2) = coords[i], coords[i + 1]
            return lat1 + (lat2 - lat1) * frac, lon1 + (lon2 - lon1) * frac
        run += span
    lon, lat = coords[-1]
    return lat, lon


async def corridor_links() -> list[dict[str, Any]]:
    """Every corridor link, with the point to ask TomTom about."""
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with engine.connect() as conn:
            rows = (
                await conn.execute(
                    text("""
                    SELECT l.link_id, l.name_en, l.corridor_id,
                           ST_AsGeoJSON(l.geom)::json AS geometry,
                           COALESCE(l.free_flow_speed_kmh, 30) AS free_flow_kmh
                    FROM road_links l
                    WHERE l.corridor_id IS NOT NULL
                    ORDER BY l.corridor_id, l.link_id
                """)
                )
            ).all()
    finally:
        await engine.dispose()

    out: list[dict[str, Any]] = []
    for r in rows:
        geometry = r.geometry or {}
        if geometry.get("type") != "LineString":
            continue
        lat, lon = midpoint(geometry["coordinates"])
        out.append(
            {
                "link_id": r.link_id,
                "name": r.name_en,
                "corridor_id": r.corridor_id,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "free_flow_kmh": float(r.free_flow_kmh),
            }
        )
    return out


def _write(path: Path, payload: dict[str, Any]) -> None:
    """Kept out of the async path: ruff rightly objects to blocking IO there."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _read(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def month_key(now: datetime) -> str:
    return now.strftime("%Y-%m")


def spend_so_far(previous: dict[str, Any], month: str) -> int:
    """Calls already made this calendar month.

    Resets with the month rather than rolling, because that is how TomTom
    counts. A rolling window here would drift out of step with the thing that
    actually shuts the tap off.
    """
    budget = previous.get("budget") or {}
    return int(budget.get("calls_used", 0)) if budget.get("month") == month else 0


def group_by_segment(mapping: dict[str, str]) -> dict[str, list[str]]:
    """Segment key to the links sitting on it, from the discovery pass."""
    groups: dict[str, list[str]] = {}
    for link_id, seg in mapping.items():
        if seg:
            groups.setdefault(seg, []).append(link_id)
    return groups


def choose_segments(
    groups: dict[str, list[str]], links_by_id: dict[str, dict[str, Any]], limit: int
) -> list[dict[str, Any]]:
    """One representative link per segment, spread across corridors.

    When there are more segments than the sweep can afford, what gets dropped is
    taken round-robin from the corridors, so a short budget thins the sample
    evenly rather than blinding one corridor entirely. Within a corridor the
    segments covering the most links go first: one call that speaks for four
    links is worth more than one that speaks for one.
    """
    reps: list[dict[str, Any]] = []
    for seg, members in groups.items():
        present = [links_by_id[m] for m in members if m in links_by_id]
        if not present:
            continue
        reps.append({**present[0], "segment_key": seg, "covers": [p["link_id"] for p in present]})

    if len(reps) <= limit:
        return reps

    per_corridor: dict[int, list[dict[str, Any]]] = {}
    for rep in reps:
        per_corridor.setdefault(rep["corridor_id"], []).append(rep)
    for bucket in per_corridor.values():
        bucket.sort(key=lambda r: -len(r["covers"]))

    keep: list[dict[str, Any]] = []
    while len(keep) < limit and any(per_corridor.values()):
        for corridor in sorted(per_corridor):
            if len(keep) >= limit:
                break
            bucket = per_corridor[corridor]
            if bucket:
                keep.append(bucket.pop(0))
    return keep


async def discover(links: list[dict[str, Any]], used: int) -> int:
    """Ask about every link once and record the segment each one matched."""
    if used + len(links) > tomtom.FREE_TIER_MONTHLY:
        print(f"  REFUSED  {used:,} + {len(links)} would exceed {tomtom.FREE_TIER_MONTHLY:,}")
        return 1
    print(f"  discovering segments for {len(links)} links ({len(links)} calls)")
    segments = await tomtom.flow_many([(str(x["link_id"]), x["lat"], x["lon"]) for x in links])

    mapping = {k: (v.segment_key if v else "") for k, v in segments.items()}
    groups = group_by_segment(mapping)
    unmatched = sorted(k for k, v in mapping.items() if not v)
    sizes = sorted((len(v) for v in groups.values()), reverse=True)
    per_sweep = min(len(groups), SAMPLE_SIZE)
    _write(
        MAP,
        {
            "discovered_at": datetime.now(UTC).isoformat(),
            "links": len(links),
            "distinct_segments": len(groups),
            "unmatched_links": unmatched,
            "calls_spent": len(links),
            "note": (
                "Several corridor links share one TomTom segment. A sweep reads "
                "each segment once and applies the reading to every link on it, "
                "so coverage counts segments and never double-counts a reading."
            ),
            "link_to_segment": mapping,
        },
    )
    biggest = sizes[0] if sizes else 0
    median = sizes[len(sizes) // 2] if sizes else 0
    print(f"  {len(links)} links -> {len(groups)} segments ({len(unmatched)} matched nothing)")
    print(f"  links per segment: max {biggest}, median {median}")
    print(f"  a sweep is now {per_sweep} calls, {planned_monthly_calls(per_sweep):,}/month")
    print(f"  wrote {MAP}")
    return 0


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", action="store_true", help="map links to segments, once")
    parser.add_argument("--dry-run", action="store_true", help="select but do not call")
    parser.add_argument("--limit", type=int, default=SAMPLE_SIZE)
    parser.add_argument(
        "--ignore-window",
        action="store_true",
        help="sweep outside 06:00-22:00 IST (the budget assumes you do not)",
    )
    args = parser.parse_args()

    now_ist = datetime.now(IST)
    month = month_key(now_ist)
    previous = _read(OUT)
    used = spend_so_far(previous, month)
    print(f"  month {month}   used {used:,} of {tomtom.FREE_TIER_MONTHLY:,}")

    links = await corridor_links()
    links_by_id = {str(x["link_id"]): x for x in links}

    if args.discover:
        if not tomtom.available():
            print("  SKIP  no TOMTOM_API_KEY")
            return 0
        return await discover(links, used)

    mapping = _read(MAP).get("link_to_segment") or {}
    if not mapping:
        print("  no segment map. Run --discover once first.")
        return 1

    groups = group_by_segment(mapping)
    chosen = choose_segments(groups, links_by_id, args.limit)
    covered = {lid for c in chosen for lid in c["covers"]}
    print(
        f"  {len(groups)} segments known; sweeping {len(chosen)}, "
        f"covering {len(covered)} of {len(links)} links"
    )
    for c in chosen:
        print(
            f"    corridor {c['corridor_id']}  via link {c['link_id']:>4}  "
            f"covers {len(c['covers']):>2} link(s)  {c['name']}"
        )

    if args.dry_run:
        print("\n  dry run — nothing fetched, nothing spent")
        return 0
    if not tomtom.available():
        print("  SKIP  no TOMTOM_API_KEY")
        return 0
    if used + len(chosen) > tomtom.FREE_TIER_MONTHLY:
        # Refusing is the point. A budget that is only a comment gets exceeded.
        print(
            f"  REFUSED  {used:,} + {len(chosen)} would exceed "
            f"{tomtom.FREE_TIER_MONTHLY:,} for {month}"
        )
        return 1
    if not (WINDOW_START_HOUR <= now_ist.hour < WINDOW_END_HOUR) and not args.ignore_window:
        print(
            f"  SKIP  {now_ist:%H:%M} IST is outside {WINDOW_START_HOUR:02d}:00-"
            f"{WINDOW_END_HOUR:02d}:00. Use --ignore-window to override."
        )
        return 0

    segments = await tomtom.flow_many([(str(c["link_id"]), c["lat"], c["lon"]) for c in chosen])

    captured_at = datetime.now(UTC).isoformat()
    readings: dict[str, Any] = {}
    measured_segments = 0
    for c in chosen:
        seg = segments.get(str(c["link_id"]))
        if seg is None:
            continue
        if seg.is_measured:
            measured_segments += 1
        reading = {
            "speed_kmh": round(seg.current_speed_kmh, 1),
            "free_flow_kmh": round(seg.free_flow_speed_kmh, 1),
            "congestion_index": round(seg.congestion_index, 1),
            "confidence": round(seg.confidence, 2),
            "road_closure": seg.road_closure,
            "is_measured": seg.is_measured,
            "observed_at": captured_at,
            "segment_key": seg.segment_key,
            # Named so nobody reading the JSON can mistake one reading shared by
            # four links for four independent measurements.
            "shared_with_links": [x for x in c["covers"] if str(x) != str(c["link_id"])],
        }
        for link_id in c["covers"]:
            readings[str(link_id)] = reading

    payload = {
        "captured_at": captured_at,
        "provider": "TomTom Flow Segment Data v4",
        "measures": "speed and delay only — never volume, never composition",
        "window_ist": f"{WINDOW_START_HOUR:02d}:00-{WINDOW_END_HOUR:02d}:00",
        "cadence_minutes": SWEEP_MINUTES,
        "sample": {
            "segments_read": len(chosen),
            "segments_known": len(groups),
            "links_covered": len(readings),
            "corridor_links": len(links),
            "rule": "one call per distinct TomTom segment, applied to every link on it",
        },
        "budget": {
            "monthly_limit": tomtom.FREE_TIER_MONTHLY,
            "month": month,
            "calls_used": used + len(chosen),
            "calls_remaining": tomtom.FREE_TIER_MONTHLY - (used + len(chosen)),
            "planned_monthly": planned_monthly_calls(len(chosen)),
        },
        "measured_segments": measured_segments,
        "links": readings,
    }
    _write(OUT, payload)
    print(f"\n  {len(chosen)} calls -> {len(readings)} links carry a reading")
    print(f"  {measured_segments}/{len(chosen)} segments above the confidence floor")
    print(
        f"  budget now {payload['budget']['calls_used']:,} used, "
        f"{payload['budget']['calls_remaining']:,} left this month"
    )
    print(f"  wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
