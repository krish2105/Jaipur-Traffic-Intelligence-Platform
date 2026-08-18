"""Health and metadata."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from ..deps import SessionDep, SettingsDep

router = APIRouter(tags=["system"])


@router.get("/health")
async def health(session: SessionDep, settings: SettingsDep) -> dict[str, Any]:
    result = await session.execute(text("SELECT 1"))
    return {
        "status": "ok" if result.scalar() == 1 else "degraded",
        "environment": settings.pravaah_env,
        "source_mode": settings.pravaah_source_mode,
        "demo_mode": settings.demo_mode,
    }


@router.get("/meta/data-provenance")
async def data_provenance(session: SessionDep) -> dict[str, Any]:
    """What in this instance is measured and what is simulated.

    docs/02 rule 6: never let a screen imply we have live government feeds we do
    not have. The UI reads this to decide where to render the "Simulated data"
    badge, so provenance is served by the API rather than hardcoded in the
    frontend where it could drift out of date.
    """
    rows = await session.execute(
        text("""
            SELECT 'traffic_counts' AS dataset, bool_and(is_synthetic) AS synthetic,
                   count(*) AS rows FROM traffic_counts
            UNION ALL SELECT 'link_congestion', bool_and(is_synthetic), count(*)
                      FROM link_congestion
            UNION ALL SELECT 'crashes', bool_and(is_synthetic), count(*) FROM crashes
            UNION ALL SELECT 'road_links', FALSE, count(*) FROM road_links
        """)
    )
    datasets = [
        {"dataset": r.dataset, "is_synthetic": bool(r.synthetic), "rows": int(r.rows)} for r in rows
    ]
    return {
        "datasets": datasets,
        "notes": {
            "road_links": "Real geometry from OpenStreetMap. Not synthetic.",
            "traffic_counts": (
                "Synthetic volumes on a profile calibrated to the published "
                "TomTom Traffic Index 2025 figures for Jaipur."
            ),
            "crashes": "Synthetic incidents; annual totals match published Jaipur police data.",
        },
        "calibration": {
            "source": "TomTom Traffic Index 2025, Jaipur",
            "average_congestion_pct": 58.7,
            "morning_peak_pct": 73.9,
            "evening_peak_pct": 94.9,
            "rush_hour_speed_kmh": 17.5,
        },
    }
