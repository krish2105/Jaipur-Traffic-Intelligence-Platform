"""Health and metadata."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter
from pravaah.adapters.weather import WeatherAdapter
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


@router.get("/meta/sources")
async def source_readiness(settings: SettingsDep) -> dict[str, Any]:
    """Every data source, its current mode, and exactly what switches it live.

    This is the answer to the question docs/10 says decides the pitch — "how
    would this work with OUR data?" — rendered on screen rather than promised in
    a slide. Every source already sits behind an adapter with a replay
    implementation and a live one (docs/05 §4), so switching is configuration,
    not a rewrite, and this endpoint proves it by reporting which credential is
    actually present.
    """

    def have(name: str) -> bool:
        """A credential is present, so this source can run live."""
        return bool(os.environ.get(name, "").strip())

    sources = [
        {
            "id": "osm",
            "name": "Road network",
            "provider": "OpenStreetMap",
            "mode": "live",
            "detail": "Real Tonk Road geometry, 594 links",
            "needs": None,
        },
        {
            "id": "weather",
            "name": "Weather",
            "provider": "Open-Meteo",
            "mode": "live",
            "detail": "Jaipur conditions; drives forecast features and quality gating",
            "needs": None,
        },
        {
            "id": "tomtom",
            "name": "Probe speeds",
            "provider": "TomTom Traffic",
            "mode": "live" if have("TOMTOM_API_KEY") else "replay",
            "detail": "Measures delay, never volume — the gap PRAVAAH fills",
            "needs": None if have("TOMTOM_API_KEY") else "TOMTOM_API_KEY",
        },
        {
            "id": "openaq",
            "name": "Air quality",
            "provider": "OpenAQ",
            "mode": "live" if have("OPENAQ_API_KEY") else "replay",
            "detail": "Enables the idling-emissions cost figure",
            "needs": None if have("OPENAQ_API_KEY") else "OPENAQ_API_KEY",
        },
        {
            "id": "cameras",
            "name": "Camera feeds",
            "provider": "Abhay / ICCC",
            "mode": "replay",
            "detail": "Counts and classification. The pilot ask: six feeds, read-only, 90 days",
            "needs": "Read-only RTSP from the department",
        },
        {
            "id": "vahan",
            "name": "Vehicle registrations",
            "provider": "VAHAN",
            "mode": "replay",
            "detail": "Cross-checks measured class mix against the registered fleet",
            "needs": "DATA_GOV_IN_API_KEY",
        },
        {
            "id": "challan",
            "name": "Challan / violations",
            "provider": "Traffic Police",
            "mode": "replay",
            "detail": "Synthetic and badged. No real challan data exists in this instance",
            "needs": "Department feed",
        },
    ]
    live = sum(1 for s in sources if s["mode"] == "live")
    return {
        "sources": sources,
        "live_count": live,
        "total": len(sources),
        "source_mode": settings.pravaah_source_mode,
        "note": "Every source sits behind an adapter with a replay implementation. "
        "Switching to live is configuration, not a rewrite.",
    }


@router.get("/meta/weather")
async def weather_now(settings: SettingsDep) -> dict[str, Any]:
    """Live Jaipur conditions, and what they mean for counting accuracy."""
    adapter = WeatherAdapter(mode="replay" if settings.pravaah_source_mode == "replay" else "live")
    try:
        w = await adapter.current()
    except (httpx.HTTPError, KeyError, ValueError):
        # Weather is contextual, never load-bearing. If Open-Meteo is
        # unreachable the dashboard carries on without it.
        return {"available": False}
    return {
        "available": True,
        "temperature_c": w.temperature_c,
        "precipitation_mm": w.precipitation_mm,
        "visibility_m": w.visibility_m,
        "wind_kmh": w.wind_kmh,
        "is_day": w.is_day,
        "summary": w.summary,
        "degrades_counting": w.degrades_counting,
        "observed_at": w.observed_at,
        "provider": "Open-Meteo",
    }
