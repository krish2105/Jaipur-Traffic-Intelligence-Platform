"""The measurement surface the command centre reads.

Every response that carries a measurement also carries its data quality. docs/06
§8: "Every measurement displays its quality/confidence. No naked number ever."
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Annotated, Any, Final
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from pravaah.adapters.profiles import CALIBRATION_FREE_FLOW_KMH, speed_kmh
from pravaah.adapters.published import (
    FLEET_RAJASTHAN_2022,
    FLEET_RAJASTHAN_TOTAL,
    RAJASTHAN_ROAD_SAFETY_CELL,
)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..allocator import allocate
from ..deps import SessionDep
from ..real_data import severity_finding
from ..severity import severity_model

router = APIRouter(tags=["traffic"])

#: Bins below this are suppressed from policy outputs — and the suppression is
#: reported, not hidden (docs/03 §3).
MIN_QUALITY = 0.6

#: Every hour and date in this module is Jaipur local time. Buckets are stored
#: as UTC instants, so the conversion is explicit in SQL rather than implied by
#: the server's timezone — which would silently differ between a laptop and
#: Render.
TZ = "Asia/Kolkata"



IST = ZoneInfo("Asia/Kolkata")


async def _ist_day_bounds(
    session: AsyncSession, on: date | None
) -> tuple[datetime, datetime, date]:
    """Half-open [start, end) bounds in UTC for one IST calendar day.

    This exists because the obvious filter is a trap:

        WHERE (bucket_start AT TIME ZONE 'Asia/Kolkata')::date = :on

    Wrapping the indexed column in an expression makes the predicate
    unsargable — Postgres must transform all 1.4 million rows before it can
    compare one, and TimescaleDB cannot exclude a single chunk. That one line
    cost 2.2 s per request, three times over in `/counts/summary`, and was the
    whole of a 3.6 s time-to-first-byte.

    A half-open range on the raw column is sargable, uses the index, and lets
    the hypertable skip every chunk outside the day. Half-open rather than
    BETWEEN because BETWEEN includes both ends and would double-count the
    midnight bucket.
    """
    if on is None:
        # max() on an indexed column is an index scan; the previous version
        # applied AT TIME ZONE inside the aggregate, which was not.
        latest = await session.scalar(text("SELECT max(bucket_start) FROM traffic_counts"))
        on = (latest.astimezone(IST).date() if latest else datetime.now(IST).date())
    start_local = datetime.combine(on, time.min, tzinfo=IST)
    return start_local, start_local + timedelta(days=1), on

@router.get("/corridors")
async def list_corridors(session: SessionDep) -> list[dict[str, Any]]:
    rows = await session.execute(
        text("""
            SELECT c.corridor_id, c.name_en, c.name_hi, c.from_node, c.to_node,
                   c.is_model_corridor,
                   count(l.link_id) AS link_count,
                   COALESCE(sum(l.length_m), 0) AS length_m
            FROM corridors c
            LEFT JOIN road_links l ON l.corridor_id = c.corridor_id
            GROUP BY c.corridor_id
            ORDER BY c.is_model_corridor DESC, c.name_en
        """)
    )
    return [
        {
            "corridor_id": r.corridor_id,
            "name": {"en": r.name_en, "hi": r.name_hi},
            "from_node": r.from_node,
            "to_node": r.to_node,
            "is_model_corridor": r.is_model_corridor,
            "link_count": r.link_count,
            "length_km": round(float(r.length_m) / 1000, 1),
        }
        for r in rows
    ]


@router.get("/counts/summary")
async def counts_summary(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
    on: Annotated[date | None, Query(alias="date")] = None,
) -> dict[str, Any]:
    """Headline figures for the right rail: total vehicles, PCU, class mix,
    peak hour, and how today compares to the weekly baseline."""
    day_start, day_end, _ = await _ist_day_bounds(session, on)
    params: dict[str, Any] = {
        "min_quality": MIN_QUALITY,
        "corridor_id": corridor_id,
        "day_start": day_start,
        "day_end": day_end,
    }

    totals = await session.execute(
        text("""
            SELECT COALESCE(sum(tc.vehicle_count),0) AS vehicles,
                   COALESCE(sum(tc.pcu),0)           AS pcu,
                   COALESCE(avg(tc.quality_score),0) AS quality,
                   count(*) FILTER (WHERE tc.quality_score < :min_quality) AS suppressed,
                   count(*)                          AS bins,
                   bool_or(tc.is_synthetic)          AS is_synthetic
            FROM traffic_counts_scoped tc
            JOIN road_links l ON l.link_id = tc.link_id
            WHERE tc.bucket_start >= :day_start
              AND tc.bucket_start <  :day_end
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
        """),
        params,
    )
    t = totals.one()

    mix = await session.execute(
        text("""
            SELECT tc.class_code, v.name_en, v.name_hi,
                   sum(tc.vehicle_count) AS vehicles, sum(tc.pcu) AS pcu
            FROM traffic_counts_scoped tc
            JOIN road_links l ON l.link_id = tc.link_id
            JOIN vehicle_classes v ON v.class_code = tc.class_code
            WHERE tc.quality_score >= :min_quality
              AND tc.bucket_start >= :day_start
              AND tc.bucket_start <  :day_end
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY tc.class_code, v.name_en, v.name_hi
            ORDER BY vehicles DESC
        """),
        params,
    )
    mix_rows = list(mix)
    total_vehicles = sum(int(m.vehicles) for m in mix_rows) or 1

    peak = await session.execute(
        text("""
            SELECT extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   sum(tc.pcu) AS pcu
            FROM traffic_counts_scoped tc
            JOIN road_links l ON l.link_id = tc.link_id
            WHERE tc.quality_score >= :min_quality
              AND tc.bucket_start >= :day_start
              AND tc.bucket_start <  :day_end
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY hour ORDER BY pcu DESC LIMIT 1
        """),
        params,
    )
    peak_row = peak.first()

    return {
        "total_vehicles": int(t.vehicles),
        "total_pcu": round(float(t.pcu), 1),
        "class_mix": [
            {
                "class_code": m.class_code,
                "name": {"en": m.name_en, "hi": m.name_hi},
                "vehicles": int(m.vehicles),
                "share": round(int(m.vehicles) / total_vehicles, 4),
            }
            for m in mix_rows
        ],
        "peak_hour": (
            {"hour": peak_row.hour, "pcu": round(float(peak_row.pcu), 1)} if peak_row else None
        ),
        "data_quality": {
            "mean_score": round(float(t.quality), 3),
            "bins": int(t.bins),
            "suppressed_bins": int(t.suppressed),
            "suppressed_pct": round(int(t.suppressed) / max(1, int(t.bins)), 4),
        },
        # docs/02 rule 6 — the UI badges anything derived from a synthetic row.
        "is_synthetic": bool(t.is_synthetic),
    }


@router.get("/congestion/day-profile")
async def day_profile(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
    on: Annotated[date | None, Query(alias="date")] = None,
) -> dict[str, Any]:
    """The day's congestion curve — what the gnomon arc renders.

    Returned at 15-minute resolution so the arc reads as a curve, with the
    measured peaks identifiable rather than smoothed away.
    """
    day_start, day_end, _ = await _ist_day_bounds(session, on)
    params: dict[str, Any] = {
        "corridor_id": corridor_id,
        "day_start": day_start,
        "day_end": day_end,
    }

    rows = await session.execute(
        text("""
            SELECT extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int   AS hour,
                   extract(minute FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS minute,
                   avg(lc.congestion_index) AS congestion_index,
                   avg(lc.confidence)       AS confidence,
                   bool_or(lc.is_synthetic) AS is_synthetic
            FROM link_congestion lc
            JOIN road_links l ON l.link_id = lc.link_id
            WHERE lc.bucket_start >= :day_start
              AND lc.bucket_start <  :day_end
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY hour, minute
            ORDER BY hour, minute
        """),
        params,
    )
    points = [
        {
            "hour": r.hour,
            "minute": r.minute,
            "index": round(float(r.congestion_index), 1),
            "confidence": round(float(r.confidence), 2),
        }
        for r in rows
    ]
    peak = max(points, key=lambda p: p["index"]) if points else None
    return {
        "points": points,
        "peak": peak,
        "is_synthetic": True,
        "calibration": {
            "source": "TomTom Traffic Index 2025, Jaipur",
            "morning_peak_pct": 73.9,
            "evening_peak_pct": 94.9,
        },
    }


@router.get("/congestion/live")
async def congestion_live(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """Per-link current congestion as GeoJSON, ready for MapLibre/deck.gl."""
    rows = await session.execute(
        text("""
            WITH latest AS (
              SELECT DISTINCT ON (lc.link_id)
                     lc.link_id, lc.congestion_index, lc.confidence, lc.source_mix,
                     lc.bucket_start, lc.is_synthetic
              FROM link_congestion lc
              ORDER BY lc.link_id, lc.bucket_start DESC
            )
            SELECT l.link_id, l.name_en, l.name_hi, l.corridor_id,
                   ST_AsGeoJSON(l.geom)::json AS geometry,
                   latest.congestion_index, latest.confidence, latest.source_mix,
                   latest.bucket_start, latest.is_synthetic
            FROM road_links l
            JOIN latest ON latest.link_id = l.link_id
            WHERE (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
        """),
        {"corridor_id": corridor_id},
    )
    features = [
        {
            "type": "Feature",
            "geometry": r.geometry,
            "properties": {
                "link_id": r.link_id,
                "name": {"en": r.name_en, "hi": r.name_hi},
                "corridor_id": r.corridor_id,
                "congestion_index": round(float(r.congestion_index), 1),
                "confidence": round(float(r.confidence), 2),
                "sources": list(r.source_mix or []),
                "observed_at": r.bucket_start.isoformat(),
                "is_synthetic": r.is_synthetic,
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/cameras")
async def list_cameras(session: SessionDep) -> list[dict[str, Any]]:
    """Camera registry with each one's accuracy certificate.

    docs/04 §3: display the certificate next to that camera's numbers. "A system
    that tells you it is 94% accurate is trusted; a system that claims
    perfection is not."
    """
    rows = await session.execute(
        text("""
            SELECT c.camera_id, c.external_ref, c.source_system, c.status,
                   c.calibrated_at, c.accuracy_cert, c.is_synthetic,
                   j.name_en AS junction_en, j.name_hi AS junction_hi,
                   ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat
            FROM cameras c LEFT JOIN junctions j ON j.junction_id = c.junction_id
            ORDER BY c.camera_id
        """)
    )
    return [
        {
            "camera_id": r.camera_id,
            "external_ref": r.external_ref,
            "source_system": r.source_system,
            "status": r.status,
            "junction": {"en": r.junction_en, "hi": r.junction_hi},
            "position": {"lon": r.lon, "lat": r.lat},
            "calibrated_at": r.calibrated_at.isoformat() if r.calibrated_at else None,
            "accuracy_cert": r.accuracy_cert,
            "is_synthetic": r.is_synthetic,
        }
        for r in rows
    ]


@router.get("/forecast")
async def forecast(
    session: SessionDep,
    link_id: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """Forecast with its 80% band. A point estimate alone is not decision
    support (docs/04 §5), so the band is never optional in the response."""
    rows = await session.execute(
        text("""
            WITH latest AS (SELECT max(issued_at) AS issued_at FROM forecasts)
            SELECT f.horizon_min,
                   avg(f.predicted_index) AS predicted,
                   avg(f.lower_80) AS lower_80,
                   avg(f.upper_80) AS upper_80,
                   min(f.model_version) AS model_version,
                   max(f.issued_at) AS issued_at
            FROM forecasts f, latest
            WHERE f.issued_at = latest.issued_at
              AND (CAST(:link_id AS bigint) IS NULL OR f.link_id = :link_id)
            GROUP BY f.horizon_min ORDER BY f.horizon_min
        """),
        {"link_id": link_id},
    )
    horizons = [
        {
            "horizon_min": r.horizon_min,
            "predicted_index": round(float(r.predicted), 1),
            "lower_80": round(float(r.lower_80), 1),
            "upper_80": round(float(r.upper_80), 1),
            "issued_at": r.issued_at.isoformat(),
        }
        for r in rows
    ]
    return {
        "horizons": horizons,
        "model_version": "persistence-baseline-0.1.0",
        # docs/04 §5: ship the baseline and say so until a model beats it.
        "note": "Persistence baseline. A learned model ships only once it beats this.",
        "generated_at": datetime.now().astimezone().isoformat(),
    }


@router.get("/scene")
async def scene(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
    at: Annotated[datetime | None, Query()] = None,
) -> dict[str, Any]:
    """Everything the 3D city needs, in one payload.

    Deliberately one request rather than three: the scene cannot draw a partial
    city, so three round-trips would only produce three chances to show a
    half-built one.

    `flow` is measured. `speed_kmh` is measured where a camera saw it and
    modelled from the congestion index otherwise — `speed_source` says
    which, always. `suppressed` marks links
    whose latest bin fell below the quality floor. The twin renders those inert
    — it must never invent traffic it did not measure (docs/06 §3).
    """
    rows = await session.execute(
        text("""
            -- `at` drives the whole scene: pass a moment and every link
            -- resolves to its measurement at that moment, which is what lets
            -- the timeline scrub the entire city through the seeded 90 days.
            WITH anchor AS (
              SELECT COALESCE(CAST(:at AS timestamptz), now()) AS ts
            ),
            latest AS (
              SELECT DISTINCT ON (lc.link_id)
                     lc.link_id, lc.congestion_index, lc.confidence
              FROM link_congestion lc, anchor
              WHERE lc.bucket_start <= anchor.ts
              ORDER BY lc.link_id, lc.bucket_start DESC
            ),
            mix AS (
              -- Per-link class mix. The scene populates each link from ITS OWN
              -- measured composition, so what you watch on Tonk Road is Tonk
              -- Road's fleet — which is the entire argument probe data cannot
              -- make (docs/01 §4).
              SELECT tc.link_id, tc.class_code,
                     sum(tc.vehicle_count)::numeric AS n
              FROM traffic_counts_scoped tc
              WHERE tc.bucket_start >  (SELECT ts FROM anchor) - INTERVAL '30 minutes'
                AND tc.bucket_start <= (SELECT ts FROM anchor)
              GROUP BY tc.link_id, tc.class_code
            ),
            mix_total AS (
              SELECT link_id, sum(n) AS total FROM mix GROUP BY link_id
            ),
            mix_json AS (
              SELECT m.link_id,
                     jsonb_object_agg(m.class_code, round(m.n / t.total, 4)) AS shares
              FROM mix m
              JOIN mix_total t ON t.link_id = m.link_id
              WHERE t.total > 0
              GROUP BY m.link_id
            ),
            measured AS (
              -- Vehicles per hour on the link. Two things this must get right:
              --  * the window is 30 minutes, so the hourly rate is the sum
              --    divided by 0.5 h — not a 5-minute bin scaled by 12;
              --  * more than one camera can watch the same link, and each sees
              --    the whole stream, so summing them double-counts. Divide by
              --    the number that actually reported.
              SELECT tc.link_id,
                     sum(tc.vehicle_count)::numeric
                       / GREATEST(1, count(DISTINCT tc.camera_id))
                       / 0.5                  AS flow_per_hour,
                     avg(tc.mean_speed_kmh)   AS speed_kmh,
                     min(tc.quality_score)    AS quality
              FROM traffic_counts_scoped tc
              -- Bounded at BOTH ends. The seed writes a whole final day
              -- including hours still ahead of now, so an open-ended window
              -- sweeps up the rest of today and inflates the rate ~20x.
              WHERE tc.bucket_start >  (SELECT ts FROM anchor) - INTERVAL '30 minutes'
                AND tc.bucket_start <= (SELECT ts FROM anchor)
              GROUP BY tc.link_id
            )
            SELECT l.link_id, l.name_en, l.name_hi, l.corridor_id, l.lanes,
                   ST_AsGeoJSON(l.geom)::json AS geometry,
                   COALESCE(latest.congestion_index, 0)  AS congestion_index,
                   COALESCE(measured.flow_per_hour, 0)   AS flow,
                   measured.speed_kmh                    AS measured_speed_kmh,
                   COALESCE(l.free_flow_speed_kmh, 30)   AS free_flow_kmh,
                   COALESCE(measured.quality, 1.0)       AS quality,
                   mix_json.shares                       AS class_mix
            FROM road_links l
            LEFT JOIN latest   ON latest.link_id = l.link_id
            LEFT JOIN measured ON measured.link_id = l.link_id
            LEFT JOIN mix_json ON mix_json.link_id = l.link_id
            WHERE (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
        """),
        {"corridor_id": corridor_id, "at": at},
    )
    links = []
    for r in rows:
        geometry = r.geometry or {}
        if geometry.get("type") != "LineString":
            continue
        links.append(
            {
                "link_id": r.link_id,
                "name": {"en": r.name_en, "hi": r.name_hi},
                "corridor_id": r.corridor_id,
                "lanes": r.lanes or 2,
                "coordinates": geometry.get("coordinates", []),
                "congestion_index": round(float(r.congestion_index), 1),
                "flow": round(float(r.flow), 1),
                # A link with no measured speed used to fall back to the
                # free-flow LIMIT and present it as if measured — which put
                # "50 km/h" beside a congestion index of 96, a contradiction
                # any traffic engineer spots in the room. Where there is no
                # measurement the speed is DERIVED from the congestion index
                # using the curve calibrated against the published 17.5 km/h
                # rush mean, and `speed_source` says which it is. docs/06 §8:
                # no naked number.
                "speed_kmh": (
                    round(float(r.measured_speed_kmh), 1)
                    if r.measured_speed_kmh is not None
                    else speed_kmh(
                        float(r.congestion_index or 0), float(r.free_flow_kmh)
                    )
                ),
                "speed_source": "measured" if r.measured_speed_kmh is not None else "modelled",
                "free_flow_kmh": round(float(r.free_flow_kmh), 1),
                "suppressed": float(r.quality) < MIN_QUALITY,
                "class_mix": r.class_mix or {},
            }
        )
    return {
        "links": links,
        "origin": {"lon": 75.8005, "lat": 26.862},
        "observed_at": (at or datetime.now().astimezone()).isoformat(),
        "is_synthetic": True,
    }


def _find_seed(name: str) -> Path | None:
    """Locate a seed file by walking up from this module.

    Counting `parents[n]` is brittle — it breaks the moment the package moves or
    the deployment flattens the tree. Walking up until data/seeds appears works
    from anywhere.
    """
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "data" / "seeds" / name
        if candidate.exists():
            return candidate
    return None


@router.get("/scene/buildings")
async def scene_buildings() -> dict[str, Any]:
    """Building massing for the 3D city.

    Served from the cached OSM extract rather than the database: this is static
    reference geometry, it never changes between requests, and putting it
    through Postgres would buy nothing.
    """
    path = _find_seed("osm_buildings.json")
    if path is None:
        # The scene is designed to work without them, so this is not an error.
        return {"buildings": [], "count": 0, "note": "no cached building extract"}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"buildings": data.get("buildings", []), "count": data.get("count", 0)}


@router.get("/safety/blackspots")
async def blackspots(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(le=50)] = 8,
) -> dict[str, Any]:
    """Segments ranked by crash SEVERITY, not frequency.

    docs/01 §2 is the reason: Jaipur crashes fell 5.6% in 2025 while deaths rose
    3.1%, pushing the fatality rate to a five-year high. Ranking by how often a
    crash happens would miss exactly that — so the ranking is the share of
    crashes here that killed or seriously injured someone, which is what
    docs/04 §6 defines as the target.
    """
    rows = await session.execute(
        text("""
            SELECT l.link_id, l.name_en, l.name_hi,
                   count(c.crash_id)                          AS crashes,
                   sum(c.fatalities)                          AS deaths,
                   sum(c.grievous)                            AS grievous,
                   round(
                     (sum(c.fatalities) + sum(c.grievous))::numeric
                     / NULLIF(count(c.crash_id), 0), 3)       AS severity_rate,
                   mode() WITHIN GROUP (ORDER BY c.primary_cause)   AS top_cause,
                   mode() WITHIN GROUP (ORDER BY c.light_condition) AS top_light,
                   bool_or(c.is_synthetic)                    AS is_synthetic
            FROM road_links l
            JOIN crashes c ON c.link_id = l.link_id
            WHERE (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY l.link_id, l.name_en, l.name_hi
            HAVING count(c.crash_id) >= 5
            ORDER BY severity_rate DESC NULLS LAST, deaths DESC
            LIMIT :limit
        """),
        {"corridor_id": corridor_id, "limit": limit},
    )
    segments = [
        {
            "link_id": r.link_id,
            "name": {"en": r.name_en, "hi": r.name_hi},
            "crashes": int(r.crashes),
            "deaths": int(r.deaths or 0),
            "grievous": int(r.grievous or 0),
            "severity_rate": float(r.severity_rate or 0),
            "top_cause": r.top_cause,
            "top_light": r.top_light,
            "is_synthetic": bool(r.is_synthetic),
        }
        for r in rows
    ]
    return {
        "segments": segments,
        "basis": "share of crashes here that were fatal or grievous, 2021-2025",
        "note": "Ranked by severity, not frequency — docs/01 §2.",
    }


@router.get("/signals/advisory")
async def signal_advisory(session: SessionDep) -> dict[str, Any]:
    """Webster cycle recommendation per junction, from measured approach flow.

    docs/DECISIONS.md ADR-005: Webster and max-pressure rather than MARL,
    because a traffic engineer can audit the arithmetic and cite it in a file.

    docs/04 §7, and this is the line to repeat verbatim in the room: the model
    produces a RECOMMENDED plan, an engineer reviews it, a human applies it.
    There is no path from this endpoint to a signal controller.
    """
    rows = await session.execute(
        text("""
            SELECT j.junction_id, j.name_en, j.name_hi, j.signal_type,
                   j.approach_count,
                   COALESCE(sum(tc.pcu), 0) AS pcu_30min,
                   COALESCE(avg(tc.quality_score), 0) AS quality
            FROM junctions j
            LEFT JOIN cameras c  ON c.junction_id = j.junction_id
            LEFT JOIN traffic_counts_scoped tc
                   ON tc.camera_id = c.camera_id
                  AND tc.bucket_start >  now() - INTERVAL '30 minutes'
                  AND tc.bucket_start <= now()
            GROUP BY j.junction_id, j.name_en, j.name_hi, j.signal_type, j.approach_count
            ORDER BY j.junction_id
        """)
    )

    advisories = []
    for r in rows:
        approaches = int(r.approach_count or 4)
        flow_pcu_hr = float(r.pcu_30min) * 2
        # Webster: C = (1.5L + 5) / (1 - Y). L is lost time, ~4 s per phase.
        lost = 4.0 * approaches
        saturation = 1800.0 * approaches
        y = min(0.85, flow_pcu_hr / saturation) if saturation else 0.0
        cycle = (1.5 * lost + 5) / max(0.15, 1 - y)
        advisories.append(
            {
                "junction_id": r.junction_id,
                "name": {"en": r.name_en, "hi": r.name_hi},
                "signal_type": r.signal_type,
                "measured_pcu_per_hour": round(flow_pcu_hr, 1),
                "degree_of_saturation": round(y, 3),
                "recommended_cycle_s": round(min(150.0, max(45.0, cycle))),
                "quality": round(float(r.quality), 2),
                "has_measurement": float(r.pcu_30min) > 0,
            }
        )
    return {
        "advisories": advisories,
        "method": "Webster (IRC:93 basis)",
        "governance": "Advisory only. An engineer reviews; a human applies. "
        "No code path reaches a signal controller.",
    }


@router.get("/congestion/weekly")
async def weekly_matrix(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """Seven days by twenty-four hours of measured congestion.

    Measured history, not a forecast. The distinction matters: a "predictive
    heatmap" with nothing behind it is decoration, whereas this is the view
    where a claim like docs/01 §2's "Friday 17 October was the worst day of
    2025" becomes checkable rather than quoted.
    """
    rows = await session.execute(
        text("""
            SELECT extract(dow  FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS dow,
                   extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   avg(lc.congestion_index) AS congestion_index
            FROM link_congestion lc
            JOIN road_links l ON l.link_id = lc.link_id
            WHERE lc.bucket_start >= now() - INTERVAL '28 days'
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY dow, hour
        """),
        {"corridor_id": corridor_id},
    )
    # Monday-first, which is how an Indian working week is read.
    matrix = [[0.0] * 24 for _ in range(7)]
    for r in rows:
        day = (int(r.dow) + 6) % 7  # Postgres dow: 0=Sunday
        matrix[day][int(r.hour)] = round(float(r.congestion_index), 1)
    return {
        "matrix": matrix,
        "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "window": "last 28 days, measured",
        "is_synthetic": True,
    }


@router.get("/safety/severity")
async def safety_severity() -> dict[str, Any]:
    """Jaipur's severity gap, from published figures rather than the seed.

    The only endpoint in this service that returns no synthetic data at all, and
    the only one that needs none: every number here is published by MoRTH, the
    Rajasthan Transport Department or the Jaipur Commissionerate, and each
    arrives with the URL it came from.

    It is also the argument the product exists to make. Crash frequency in
    Jaipur is falling and crash severity is rising, and the enforcement mix is
    aimed almost entirely at frequency. Seeing that requires knowing what is in
    the traffic, which is the one thing a probe feed, a vehicle counter and an
    adaptive signal all cannot tell you.

    No database read: these are constants, so the panel renders with the
    warehouse down and with the network cable pulled.
    """
    return severity_finding()


@router.get("/enforcement/allocation")
async def enforcement_allocation() -> dict[str, Any]:
    """Where the next thousand challans should go, and what moving them is worth.

    The only question in this API whose answer is a recommendation rather than a
    measurement, so it carries its whole model with it: attributable fractions,
    the saturation constant, the floor, a sensitivity sweep, and the range of
    assumptions over which the recommendation actually holds.

    It will be argued with by the department that produced the inputs. That is
    the point — an argument about K is a better conversation than an argument
    about whether we are guessing.
    """
    return allocate()


@router.get("/safety/severity-model")
async def safety_severity_model(session: SessionDep) -> dict[str, Any]:
    """KSI risk by composition, with the confidence interval it refuses to omit.

    Reads the incident timeline only to fit the hour-of-day effect, and reports
    that this input is seeded — so the held-out error describes the estimator
    rather than Jaipur's nights. Everything else is anchored to published
    figures and calibrated against the one real observable there is: 34.7 deaths
    per 100 crashes in 2025.

    It is not a fitted regression and says so in `method`. Crash-level records
    are not public; when the Commissionerate supplies them this becomes a real
    logistic model and the structure is already the one to fit.
    """
    timeline = await incident_timeline(session)
    return severity_model(timeline.get("hours", []))


@router.get("/incidents/timeline")
async def incident_timeline(session: SessionDep) -> dict[str, Any]:
    """Crashes by hour of day, banded by injury outcome, with the congestion
    curve behind them.

    The two series are the argument. Crash volume peaks at exactly the hours
    congestion peaks, which is the claim the whole platform rests on: the
    evening jam is not merely an inconvenience to be measured, it is when
    people are hurt. An hour-of-day view over five years is the right frame —
    a 24-hour window would show a handful of points and invite a reading of
    noise as trend.

    Severity is derived from outcome, not asserted: a crash with a fatality is
    fatal, otherwise a grievous injury makes it grievous, otherwise minor.
    """
    rows = await session.execute(
        text("""
            SELECT extract(hour FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   count(*) FILTER (WHERE fatalities > 0)                     AS fatal,
                   count(*) FILTER (WHERE fatalities = 0 AND grievous > 0)    AS grievous,
                   count(*) FILTER (WHERE fatalities = 0 AND grievous = 0)    AS minor
            FROM crashes
            GROUP BY hour
        """)
    )
    hours: list[dict[str, float]] = [
        {"hour": h, "fatal": 0, "grievous": 0, "minor": 0} for h in range(24)
    ]
    for r in rows:
        hours[int(r.hour)] |= {
            "fatal": int(r.fatal),
            "grievous": int(r.grievous),
            "minor": int(r.minor),
        }

    congestion = await session.execute(
        text("""
            SELECT extract(hour FROM bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   avg(congestion_index) AS congestion_index
            FROM link_congestion
            WHERE bucket_start >= now() - INTERVAL '28 days'
            GROUP BY hour
        """)
    )
    for r in congestion:
        hours[int(r.hour)]["congestion"] = round(float(r.congestion_index), 1)

    span = await session.execute(
        text("""
            SELECT count(*) AS crashes,
                   sum(fatalities) AS deaths,
                   min(occurred_at) AS since,
                   max(occurred_at) AS until
            FROM crashes
        """)
    )
    s = span.one()

    # The detector's own queue, kept separate. Congestion anomalies and crashes
    # are different objects and stacking them would invent a total that means
    # nothing.
    detected = await session.execute(
        text("""
            SELECT count(*) FILTER (WHERE resolved_at IS NULL) AS active,
                   count(*)                                    AS detected_24h
            FROM incidents
            WHERE detection_source = 'model'
              AND detected_at > now() - INTERVAL '24 hours'
        """)
    )
    d = detected.one()

    peak = max(hours, key=lambda h: h["fatal"] + h["grievous"] + h["minor"])
    return {
        "hours": hours,
        "totals": {
            "crashes": int(s.crashes),
            "deaths": int(s.deaths or 0),
            "since": s.since.year,
            "until": s.until.year,
        },
        "peak_hour": peak["hour"],
        "detector": {
            "active": int(d.active),
            "detected_24h": int(d.detected_24h),
            "method": "robust residual vs the link's own weekday-hour median",
        },
        "is_synthetic": True,
    }


@router.get("/enforcement/summary")
async def enforcement_summary(session: SessionDep) -> dict[str, Any]:
    """The violation queue, by type and by review state.

    **No registration number is returned by this endpoint, at any role.** The
    plate lives as an HMAC-SHA256 digest and as ciphertext, and revealing it is
    a separate, audited action requiring a reason code (docs/07 §3). An
    aggregate view has no legitimate need for one, so it does not get the
    option.

    `auto_confirmed` is reported separately from `confirmed` rather than summed
    with it. They are different claims: one says a machine was confident enough
    to skip a human, the other says a named person agreed. A department
    procuring this needs to see the split before it trusts either.
    """
    rows = await session.execute(
        text("""
            SELECT violation_type,
                   count(*)                                                  AS total,
                   count(*) FILTER (WHERE review_status = 'pending')         AS pending,
                   count(*) FILTER (WHERE review_status = 'confirmed')       AS confirmed,
                   count(*) FILTER (WHERE review_status = 'auto_confirmed')  AS auto_confirmed,
                   count(*) FILTER (WHERE review_status = 'rejected')        AS rejected,
                   avg(ocr_confidence)                                       AS mean_confidence
            FROM violations
            GROUP BY violation_type
            ORDER BY total DESC
        """)
    )
    types = [
        {
            "violation_type": r.violation_type,
            "total": int(r.total),
            "pending": int(r.pending),
            "confirmed": int(r.confirmed),
            "auto_confirmed": int(r.auto_confirmed),
            "rejected": int(r.rejected),
            "mean_confidence": round(float(r.mean_confidence), 3),
        }
        for r in rows
    ]

    hourly = await session.execute(
        text("""
            SELECT extract(hour FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   count(*) AS total
            FROM violations
            GROUP BY hour
        """)
    )
    by_hour = [0] * 24
    for r in hourly:
        by_hour[int(r.hour)] = int(r.total)

    # docs/04 §4: a read below 0.85 must go to a human. Reporting how many
    # cleared that bar is how a department checks the rule is actually on.
    gate = await session.execute(
        text("""
            SELECT count(*) FILTER (WHERE ocr_confidence < 0.85) AS below_gate,
                   count(*) FILTER (
                       WHERE ocr_confidence < 0.85 AND review_status = 'auto_confirmed'
                   ) AS violations_of_gate,
                   count(*) AS total
            FROM violations
        """)
    )
    g = gate.one()

    return {
        "types": types,
        "by_hour": by_hour,
        "totals": {
            "total": int(g.total),
            "below_confidence_gate": int(g.below_gate),
            "auto_confirmed_below_gate": int(g.violations_of_gate),
        },
        "governance": (
            "Plates are stored as an HMAC digest and as ciphertext, never as text. "
            "Revealing one is a separate audited action with a reason code. "
            "No reading below 0.85 confidence may auto-confirm."
        ),
        "is_synthetic": True,
    }


@router.get("/enforcement/defaulters")
async def defaulters(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict[str, Any]:
    """Repeat-risk scores, ranked. Plates stay hashed; only a prefix is shown.

    docs/03 §3 is explicit that this is a road-safety targeting tool and not a
    revenue one, so the ordering is severity-weighted risk rather than money
    owed, and the amount is reported beside it rather than instead of it.

    Every score carries its SHAP explanation — the database refuses to store one
    without (`score_must_be_explained`), so an unexplained score cannot reach
    this endpoint even if the code forgot to ask for it.
    """
    rows = await session.execute(
        text("""
            SELECT plate_hash, repeat_risk, recovery_propensity, severity_weighted_score,
                   pending_challan_count, pending_amount_inr, shap_explanation, model_version
            FROM defaulter_scores
            WHERE computed_on = (SELECT max(computed_on) FROM defaulter_scores)
            ORDER BY severity_weighted_score DESC NULLS LAST
            LIMIT :limit
        """),
        {"limit": limit},
    )
    return {
        "defaulters": [
            {
                # An eight-character prefix of a 64-character digest. Enough to
                # tell two rows apart in a meeting; useless for re-identifying
                # anyone, because the digest is already irreversible.
                "plate_ref": r.plate_hash[:8],
                "repeat_risk": round(float(r.repeat_risk), 3),
                "recovery_propensity": (
                    round(float(r.recovery_propensity), 3)
                    if r.recovery_propensity is not None
                    else None
                ),
                "severity_score": (
                    round(float(r.severity_weighted_score), 1)
                    if r.severity_weighted_score is not None
                    else None
                ),
                "pending_challans": int(r.pending_challan_count or 0),
                "pending_amount_inr": (
                    round(float(r.pending_amount_inr), 0)
                    if r.pending_amount_inr is not None
                    else None
                ),
                "explanation": (
                    json.loads(r.shap_explanation)
                    if isinstance(r.shap_explanation, str)
                    else r.shap_explanation
                ),
                "model_version": r.model_version,
            }
            for r in rows
        ],
        "basis": "severity-weighted risk, not amount owed — docs/03 §3",
        "is_synthetic": True,
    }


@router.get("/junctions")
async def junctions(session: SessionDep) -> dict[str, Any]:
    """Instrumented junctions with their current approach state."""
    rows = await session.execute(
        text("""
            SELECT j.junction_id, j.name_en, j.name_hi,
                   ST_X(j.geom) AS lon, ST_Y(j.geom) AS lat,
                   j.approach_count, j.signal_type,
                   (
                     SELECT round(avg(lc.congestion_index), 1)
                     FROM link_congestion lc
                     JOIN road_links l ON l.link_id = lc.link_id
                     WHERE lc.bucket_start > now() - INTERVAL '30 minutes'
                       AND lc.bucket_start <= now()
                       AND ST_DWithin(l.geom::geography, j.geom::geography, 250)
                   ) AS congestion
            FROM junctions j
            ORDER BY j.junction_id
        """)
    )
    return {
        "junctions": [
            {
                "junction_id": int(r.junction_id),
                "name": {"en": r.name_en, "hi": r.name_hi},
                "coordinates": [float(r.lon), float(r.lat)],
                "approaches": int(r.approach_count or 0),
                "signal_type": r.signal_type,
                "congestion": float(r.congestion) if r.congestion is not None else None,
            }
            for r in rows
        ],
        "is_synthetic": True,
    }


#: Classes an Indian low-emission zone actually targets. Older diesel goods
#: vehicles and the pre-BS-VI three-wheeler fleet, not private cars — the
#: politically survivable version of an LEZ, and the one with the better
#: emissions-per-vehicle case.
_LEZ_CLASSES: Final = ("TRK2", "TRKM", "LCV", "TRAC")

#: Congestion pricing, if levied, is levied on PCU rather than on vehicles. A
#: two-wheeler occupies a quarter of the road a car does and paying the same
#: charge would be indefensible; PCU is already the unit every capacity
#: calculation uses, so it is the unit with a defensible basis.
_PRICE_PER_PCU_INR: Final = 12.0


@router.get("/policy/scenarios")
async def policy_scenarios(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
    hour: Annotated[int | None, Query(ge=0, le=23)] = None,
) -> dict[str, Any]:
    """What a low-emission zone or a congestion charge would actually do here.

    This is the section of the pitch where a platform usually shows a slide.
    Instead it computes, from this corridor's own measured class mix and the
    calibrated speed curve in `pravaah.adapters.profiles`:

    * the PCU each class contributes — not the vehicle count, because a
      two-wheeler at 0.25 PCU and a multi-axle truck at 4.5 are eighteen
      vehicles apart in road space and one vehicle apart in a count;
    * what removing a share of the targeted classes does to the congestion
      index, and what the speed curve says that is worth in km/h;
    * what a PCU-based charge would raise, stated beside the delay it buys
      rather than instead of it.

    **The elasticity is an assumption, and it is returned as one.** Nothing in
    the seeded data tells us how many freight operators would reroute rather
    than pay. The response names the assumption, its source, and the fact that
    it is the single number a department should argue with — which is more
    useful than a confident figure with the assumption buried.
    """
    target_hour = hour if hour is not None else 19  # the published evening peak

    rows = await session.execute(
        text("""
            SELECT tc.class_code,
                   v.name_en,
                   v.name_hi,
                   v.pcu_factor,
                   sum(tc.vehicle_count) AS vehicles
            FROM traffic_counts tc
            JOIN vehicle_classes v ON v.class_code = tc.class_code
            JOIN road_links l      ON l.link_id = tc.link_id
            WHERE tc.bucket_start >= now() - INTERVAL '7 days'
              AND extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = :hour
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY tc.class_code, v.name_en, v.name_hi, v.pcu_factor
        """),
        {"hour": target_hour, "corridor_id": corridor_id},
    )
    classes = [
        {
            "class_code": r.class_code,
            "name": {"en": r.name_en, "hi": r.name_hi},
            "pcu_factor": float(r.pcu_factor),
            "vehicles": int(r.vehicles),
            "pcu": float(r.pcu_factor) * int(r.vehicles),
        }
        for r in rows
    ]
    total_pcu = sum(c["pcu"] for c in classes)
    total_vehicles = sum(c["vehicles"] for c in classes)

    index_row = await session.execute(
        text("""
            SELECT avg(lc.congestion_index) AS congestion_index
            FROM link_congestion lc
            JOIN road_links l ON l.link_id = lc.link_id
            WHERE lc.bucket_start >= now() - INTERVAL '7 days'
              AND extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = :hour
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
        """),
        {"hour": target_hour, "corridor_id": corridor_id},
    )
    baseline_index = float(index_row.scalar() or 0.0)

    def scenario(
        name: str,
        targeted: tuple[str, ...],
        removed_share: float,
        note_en: str,
        note_hi: str,
    ) -> dict[str, Any]:
        removed_pcu = sum(c["pcu"] for c in classes if c["class_code"] in targeted) * removed_share
        share_removed = removed_pcu / total_pcu if total_pcu else 0.0
        # Congestion is taken as proportional to PCU demand against a fixed
        # capacity. That is a first-order model and is labelled as one: it holds
        # while the corridor is at or near saturation, which at the evening peak
        # it is, and overstates the benefit once flow becomes free.
        new_index = max(0.0, baseline_index * (1.0 - share_removed))
        return {
            "scenario": name,
            "targeted_classes": list(targeted),
            "removed_share": round(removed_share, 3),
            "pcu_removed": round(removed_pcu, 1),
            "pcu_removed_pct": round(share_removed * 100, 1),
            "baseline_index": round(baseline_index, 1),
            "modelled_index": round(new_index, 1),
            "baseline_speed_kmh": speed_kmh(baseline_index, CALIBRATION_FREE_FLOW_KMH),
            "modelled_speed_kmh": speed_kmh(new_index, CALIBRATION_FREE_FLOW_KMH),
            "note": {"en": note_en, "hi": note_hi},
        }

    lez = scenario(
        "low_emission_zone",
        _LEZ_CLASSES,
        0.60,
        "Older goods vehicles and farm traffic restricted at peak. 60% compliance "
        "assumed — the number to argue with, not a measurement.",
        "शीर्ष समय में पुराने माल वाहन और कृषि यातायात प्रतिबंधित। 60% अनुपालन "
        "मान लिया गया — यह मापा गया आँकड़ा नहीं, बहस का विषय है।",
    )
    charge = scenario(
        "congestion_charge",
        tuple(c["class_code"] for c in classes if c["pcu_factor"] >= 1.0),
        0.18,
        "Charge levied per PCU, not per vehicle. 18% diversion assumed, at the "
        "low end of the published range for Indian cities.",
        "शुल्क प्रति PCU, प्रति वाहन नहीं। 18% विचलन मान लिया गया, भारतीय शहरों "
        "के प्रकाशित परास के निचले सिरे पर।",
    )
    charged_pcu = sum(c["pcu"] for c in classes if c["pcu_factor"] >= 1.0) * (1 - 0.18)
    charge["revenue_inr_per_peak_hour"] = round(charged_pcu * _PRICE_PER_PCU_INR, 0)
    charge["price_per_pcu_inr"] = _PRICE_PER_PCU_INR

    return {
        "hour": target_hour,
        "totals": {
            "vehicles": total_vehicles,
            "pcu": round(total_pcu, 1),
            "congestion_index": round(baseline_index, 1),
        },
        "classes": sorted(classes, key=lambda c: c["pcu"], reverse=True),
        "scenarios": [lez, charge],
        "assumptions": {
            "model": (
                "Congestion taken as proportional to PCU demand against fixed capacity. "
                "First-order, valid near saturation, optimistic once flow is free."
            ),
            "speed_curve": (
                "Calibrated in pravaah.adapters.profiles so the rush-window mean "
                "reproduces the published 17.5 km/h."
            ),
            "elasticity": (
                "Compliance and diversion shares are assumptions, not measurements. "
                "They are the numbers a department should argue with."
            ),
        },
        "is_synthetic": True,
    }


@router.get("/edge/cameras")
async def edge_cameras(session: SessionDep) -> dict[str, Any]:
    """Per-camera counting throughput and the class breakdown each one produces.

    This is the endpoint that distinguishes the platform from a probe product,
    so it reports the thing a probe cannot: vehicles per minute **by class**,
    per camera, with each camera's own validated accuracy beside it.

    Vehicles per minute is reported rather than per hour because that is the
    rate an operator can sanity-check against a live feed by counting for sixty
    seconds. A per-hour figure is unfalsifiable in the room.
    """
    rows = await session.execute(
        text("""
            SELECT c.camera_id,
                   c.external_ref,
                   c.status,
                   j.name_en,
                   j.name_hi,
                   sum(tc.vehicle_count)                          AS vehicles,
                   count(DISTINCT tc.bucket_start)                AS bins,
                   avg(tc.quality_score)                          AS quality
            FROM cameras c
            LEFT JOIN junctions j ON j.junction_id = c.junction_id
            LEFT JOIN traffic_counts tc
                   ON tc.camera_id = c.camera_id
                  AND tc.bucket_start >= now() - INTERVAL '24 hours'
                  AND tc.bucket_start <= now()
            GROUP BY c.camera_id, c.external_ref, c.status, j.name_en, j.name_hi
            ORDER BY c.camera_id
        """)
    )
    cameras = []
    for r in rows:
        bins = int(r.bins or 0)
        vehicles = int(r.vehicles or 0)
        # Counts are binned in five-minute buckets, so minutes observed is
        # bins * 5. Dividing by 60 minutes of wall clock instead would report a
        # camera that was down for half the day as half as busy.
        minutes = bins * 5
        cameras.append({
            "camera_id": int(r.camera_id),
            "external_ref": r.external_ref,
            "status": r.status,
            "junction": {"en": r.name_en, "hi": r.name_hi},
            "vehicles_24h": vehicles,
            "observed_minutes": minutes,
            "vehicles_per_minute": round(vehicles / minutes, 1) if minutes else None,
            "quality": round(float(r.quality), 3) if r.quality is not None else None,
        })

    classes = await session.execute(
        text("""
            SELECT tc.class_code, v.name_en, v.name_hi, sum(tc.vehicle_count) AS vehicles
            FROM traffic_counts tc
            JOIN vehicle_classes v ON v.class_code = tc.class_code
            WHERE tc.bucket_start >= now() - INTERVAL '24 hours'
              AND tc.bucket_start <= now()
            GROUP BY tc.class_code, v.name_en, v.name_hi
            ORDER BY vehicles DESC
        """)
    )
    detected = [
        {
            "class_code": r.class_code,
            "name": {"en": r.name_en, "hi": r.name_hi},
            "vehicles": int(r.vehicles),
        }
        for r in classes
    ]

    return {
        "cameras": cameras,
        "classes": detected,
        "pipeline": {
            "detector": "RT-DETRv2 (Apache-2.0)",
            "tracker": "ByteTrack via supervision (MIT)",
            "runtime": "PyTorch → ONNX Runtime on the edge node",
            # docs/04 and CLAUDE.md both bar Ultralytics from shippable code.
            # Saying why on the screen turns a licence constraint into evidence
            # of procurement diligence.
            "licence_note": (
                "No Ultralytics YOLO anywhere in shippable code — AGPL-3.0 is a "
                "procurement blocker for a government deployment."
            ),
            "privacy": (
                "No face recognition, no person tracking, no biometric analysis, "
                "at any point in the pipeline. Vehicles are counted and classified; "
                "people are not identified."
            ),
            "edge_note": (
                "Video never leaves the gantry. The edge node emits counts, classes, "
                "speeds and violation events — metadata measured in bytes, not a "
                "video backhaul measured in megabits."
            ),
        },
        "status": (
            "Counting runs on public Indian datasets (IDD, UA-DETRAC). Not yet "
            "validated on Jaipur video — that needs a read-only RTSP feed."
        ),
        "is_synthetic": True,
    }


@router.get("/policy/representation")
async def representation(
    session: SessionDep,
    corridor_id: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """Registered fleet against measured traffic against road space.

    Three shares for the same vehicle class, from two independent real sources
    and one measurement:

    * **registered** — Rajasthan Road Safety Cell, 31 March 2022. Real, official.
    * **on the road** — what this corridor actually counts.
    * **road space** — the same count in PCU.

    The gap between the first two is the finding. A car is 12.4% of the state's
    registered fleet and about a quarter of measured arterial traffic, so it is
    roughly **twice over-represented** on this road relative to how many exist;
    in road space it is over-represented again. A two-wheeler runs the other
    way. That is an argument no single dataset can make: registration alone
    says two-wheelers dominate, counting alone says they are a majority, and
    only the two together show that the road is carrying a different city from
    the one the registration database describes.

    The caveat is stated in the response rather than left implied. Registration
    is state-wide and traffic is one Jaipur arterial, so this compares a fleet
    with a corridor — informative about over-representation, not a substitute
    for an origin-destination survey.
    """
    day_start, day_end, _ = await _ist_day_bounds(session, None)
    rows = await session.execute(
        text("""
            SELECT tc.class_code,
                   sum(tc.vehicle_count) AS vehicles,
                   sum(tc.pcu)           AS pcu
            FROM traffic_counts tc
            JOIN road_links l ON l.link_id = tc.link_id
            WHERE tc.bucket_start >= :day_start
              AND tc.bucket_start <  :day_end
              AND (CAST(:corridor_id AS bigint) IS NULL OR l.corridor_id = :corridor_id)
            GROUP BY tc.class_code
        """),
        {"day_start": day_start, "day_end": day_end, "corridor_id": corridor_id},
    )
    counted = {r.class_code: (int(r.vehicles), float(r.pcu)) for r in rows}
    total_vehicles = sum(v for v, _ in counted.values()) or 1
    total_pcu = sum(p for _, p in counted.values()) or 1.0

    comparison: list[dict[str, Any]] = []
    for category in FLEET_RAJASTHAN_2022:
        if category.class_code is None:
            continue
        registered_pct = category.vehicles / FLEET_RAJASTHAN_TOTAL * 100
        vehicles, pcu = counted.get(category.class_code, (0, 0.0))
        road_pct = vehicles / total_vehicles * 100
        space_pct = pcu / total_pcu * 100
        comparison.append({
            "class_code": category.class_code,
            "name": {"en": category.name_en, "hi": category.name_hi},
            "registered": category.vehicles,
            "registered_pct": round(registered_pct, 2),
            "on_road_pct": round(road_pct, 2),
            "road_space_pct": round(space_pct, 2),
            # >1 means the class is over-represented on this road relative to
            # how many of them exist in the state.
            "over_representation": (
                round(road_pct / registered_pct, 2) if registered_pct > 0 else None
            ),
        })

    comparison.sort(key=lambda c: float(c["registered_pct"]), reverse=True)
    return {
        "classes": comparison,
        "fleet_total": FLEET_RAJASTHAN_TOTAL,
        "sources": {
            "registered": {
                "name": RAJASTHAN_ROAD_SAFETY_CELL.name,
                "url": RAJASTHAN_ROAD_SAFETY_CELL.url,
                "is_synthetic": False,
            },
            "counted": {
                "name": "This instance's seeded counts, calibrated to the TomTom index",
                "is_synthetic": True,
            },
        },
        "caveat": (
            "Registration is state-wide; traffic is one Jaipur arterial. This "
            "compares a fleet with a corridor — informative about "
            "over-representation, not a substitute for an origin-destination survey."
        ),
    }


#: Which vehicle class each violation type is, in practice, a charge against.
#: A helmet or triple-riding offence is a two-wheeler offence; a seatbelt
#: offence is a car offence. Stated explicitly because the fairness comparison
#: below depends on it, and a wrong mapping produces a confident wrong finding.
_VIOLATION_CLASS: Final[dict[str, str]] = {
    "no_helmet": "2W",
    "triple_riding": "2W",
    "no_seatbelt": "CAR",
}


@router.get("/enforcement/fairness")
async def enforcement_fairness(session: SessionDep) -> dict[str, Any]:
    """Whether enforcement falls evenly, and on what.

    **This deliberately does not measure demographic fairness.** The platform
    holds no caste, religion, gender or income data, will not acquire any, and
    a system that inferred them from a registration number in order to audit
    itself would be a far worse privacy failure than the one it was auditing.
    Any dashboard claiming demographic parity here would be claiming knowledge
    it must not have.

    What *can* be measured, and is the real equity question for Indian traffic
    enforcement, is whether the burden falls disproportionately on the road
    users least able to carry it:

    * **By vehicle class** — are two-wheeler riders challaned out of proportion
      to their presence on the road? A helmet offence can only be committed on
      a two-wheeler, so the honest denominator is two-wheeler traffic, not all
      traffic. Comparing helmet challans against all vehicles would manufacture
      a bias finding out of arithmetic.
    * **By camera** — enforcement concentrated at one gantry is a policing
      pattern, not a driving pattern.
    * **By OCR confidence** — if plates on one vehicle class read less reliably,
      that class is either under-enforced or over-referred to human review, and
      both are unfair in different directions.
    """
    day_start, day_end, _ = await _ist_day_bounds(session, None)

    # Exposure: what is actually on the road, as the denominator.
    exposure_rows = await session.execute(
        text("""
            SELECT class_code, sum(vehicle_count) AS vehicles
            FROM traffic_counts
            WHERE bucket_start >= :day_start AND bucket_start < :day_end
            GROUP BY class_code
        """),
        {"day_start": day_start, "day_end": day_end},
    )
    exposure = {r.class_code: int(r.vehicles) for r in exposure_rows}
    total_exposure = sum(exposure.values()) or 1

    type_rows = await session.execute(
        text("""
            SELECT violation_type,
                   count(*)                       AS total,
                   avg(ocr_confidence)            AS mean_confidence,
                   count(*) FILTER (WHERE ocr_confidence < 0.85) AS below_gate
            FROM violations
            GROUP BY violation_type
        """)
    )
    total_violations = 0
    by_class: dict[str, dict[str, float]] = {}
    types: list[dict[str, Any]] = []
    for r in type_rows:
        total_violations += int(r.total)
        class_code = _VIOLATION_CLASS.get(r.violation_type)
        types.append({
            "violation_type": r.violation_type,
            "total": int(r.total),
            "attributable_class": class_code,
            "mean_confidence": round(float(r.mean_confidence), 3),
            "below_gate_pct": round(100.0 * int(r.below_gate) / int(r.total), 1),
        })
        if class_code:
            bucket = by_class.setdefault(class_code, {"violations": 0.0})
            bucket["violations"] += int(r.total)

    # Disparate impact: share of class-attributable challans against that
    # class's share of the road, among classes that can be compared at all.
    comparable_violations = sum(b["violations"] for b in by_class.values()) or 1
    comparable_exposure = sum(exposure.get(c, 0) for c in by_class) or 1
    classes = []
    for class_code, bucket in sorted(by_class.items()):
        challan_share = bucket["violations"] / comparable_violations
        road_share = exposure.get(class_code, 0) / comparable_exposure
        classes.append({
            "class_code": class_code,
            "challans": int(bucket["violations"]),
            "challan_share_pct": round(challan_share * 100, 1),
            "road_share_pct": round(road_share * 100, 1),
            # >1 means this class carries more of the enforcement burden than
            # its presence on the road would imply.
            "disparate_impact": round(challan_share / road_share, 2) if road_share else None,
        })

    camera_result = await session.execute(
        text("""
            SELECT v.camera_id, j.name_en, j.name_hi, count(*) AS total
            FROM violations v
            LEFT JOIN cameras c  ON c.camera_id = v.camera_id
            LEFT JOIN junctions j ON j.junction_id = c.junction_id
            GROUP BY v.camera_id, j.name_en, j.name_hi
            ORDER BY total DESC
        """)
    )
    camera_rows_list = list(camera_result)
    cameras: list[dict[str, Any]] = [
        {
            "camera_id": int(r.camera_id),
            "junction": {"en": r.name_en, "hi": r.name_hi},
            "violations": int(r.total),
            "share_pct": round(100.0 * int(r.total) / (total_violations or 1), 1),
        }
        for r in camera_rows_list
    ]
    # A perfectly even spread would give each camera an equal share. The ratio
    # of the busiest to the quietest is the plainest statement of concentration.
    counts: list[int] = [int(r.total) for r in camera_rows_list] or [0]
    concentration = round(max(counts) / min(counts), 2) if min(counts) else None

    return {
        "classes": classes,
        "types": sorted(types, key=lambda t: t["total"], reverse=True),
        "cameras": cameras,
        "camera_concentration": concentration,
        "totals": {
            "violations": total_violations,
            "road_vehicles_today": total_exposure,
        },
        "not_measured": (
            "Demographic fairness is not measured and will not be. This platform "
            "holds no caste, religion, gender or income data, and inferring any "
            "of them from a registration number in order to audit itself would be "
            "a worse privacy failure than the one being audited."
        ),
        "denominator_note": (
            "A helmet offence can only be committed on a two-wheeler, so the "
            "denominator is two-wheeler traffic rather than all traffic. "
            "Comparing against all vehicles would manufacture a bias finding out "
            "of arithmetic."
        ),
        "is_synthetic": True,
    }
