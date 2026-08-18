"""The measurement surface the command centre reads.

Every response that carries a measurement also carries its data quality. docs/06
§8: "Every measurement displays its quality/confidence. No naked number ever."
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import text

from ..deps import SessionDep

router = APIRouter(tags=["traffic"])

#: Bins below this are suppressed from policy outputs — and the suppression is
#: reported, not hidden (docs/03 §3).
MIN_QUALITY = 0.6

#: Every hour and date in this module is Jaipur local time. Buckets are stored
#: as UTC instants, so the conversion is explicit in SQL rather than implied by
#: the server's timezone — which would silently differ between a laptop and
#: Render.
TZ = "Asia/Kolkata"


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
    params: dict[str, Any] = {
        "min_quality": MIN_QUALITY,
        "corridor_id": corridor_id,
        "on": on,
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
            WHERE (tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::date = COALESCE(
                    CAST(:on AS date),
                    (SELECT max(bucket_start AT TIME ZONE 'Asia/Kolkata')::date
                       FROM traffic_counts))
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
              AND (tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::date = COALESCE(
                    CAST(:on AS date),
                    (SELECT max(bucket_start AT TIME ZONE 'Asia/Kolkata')::date
                       FROM traffic_counts))
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
              AND (tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::date = COALESCE(
                    CAST(:on AS date),
                    (SELECT max(bucket_start AT TIME ZONE 'Asia/Kolkata')::date
                       FROM traffic_counts))
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
    params: dict[str, Any] = {"corridor_id": corridor_id, "on": on}

    rows = await session.execute(
        text("""
            SELECT extract(hour FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int   AS hour,
                   extract(minute FROM lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS minute,
                   avg(lc.congestion_index) AS index,
                   avg(lc.confidence)       AS confidence,
                   bool_or(lc.is_synthetic) AS is_synthetic
            FROM link_congestion lc
            JOIN road_links l ON l.link_id = lc.link_id
            WHERE (lc.bucket_start AT TIME ZONE 'Asia/Kolkata')::date = COALESCE(
                    CAST(:on AS date),
                    (SELECT max(bucket_start AT TIME ZONE 'Asia/Kolkata')::date
                       FROM link_congestion))
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
            "index": round(float(r.index), 1),
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

    `flow` and `speed_kmh` are measured values, and `suppressed` marks links
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
                   COALESCE(measured.speed_kmh,
                            l.free_flow_speed_kmh, 30)   AS speed_kmh,
                   COALESCE(measured.quality, 1.0)       AS quality
            FROM road_links l
            LEFT JOIN latest   ON latest.link_id = l.link_id
            LEFT JOIN measured ON measured.link_id = l.link_id
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
                "speed_kmh": round(float(r.speed_kmh), 1),
                "suppressed": float(r.quality) < MIN_QUALITY,
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
