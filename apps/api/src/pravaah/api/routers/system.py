"""Health and metadata."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter
from pravaah.adapters import iudx, tomtom, vahan
from pravaah.adapters.air import (
    CPCB_NO2_24H,
    CPCB_PM10_24H,
    CPCB_PM25_24H,
    fetch_air_quality,
)
from pravaah.adapters.published import (
    ACCIDENTS_CHANGE_2025_PCT,
    CONGESTION_AVERAGE_PCT,
    CONGESTION_EVENING_PEAK_PCT,
    CONGESTION_MORNING_PEAK_PCT,
    CRASHES_BY_YEAR,
    DISTRICTS_2025,
    FATALITIES_CHANGE_2025_PCT,
    FATALITY_RATE_2025,
    RAJASTHAN_POLICE,
    RAJASTHAN_SEVERITY_RATE_PCT,
    RUSH_HOUR_SPEED_KMH,
    TOMTOM,
    TOTAL_ACCIDENTS,
)
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


@router.get("/meta/city-data")
async def city_data() -> dict[str, Any]:
    """What Jaipur already publishes to the national data exchange.

    Read live from the IUDX catalogue, which is open and needs no credential, so
    this is a fact rather than a proposal. It exists because the ask it supports
    is much smaller than the one this platform has been making: not "install
    cameras" but "grant a consumer token for the vehicle classification cameras
    you already run".
    """
    resources = await iudx.discover()
    return {
        "instance": iudx.INSTANCE,
        "exchange": "India Urban Data Exchange",
        "standard": "API specification approved by the Bureau of Indian Standards",
        "catalogue_reachable": bool(resources),
        "resources": [
            {
                "id": r.id,
                "label": r.label,
                "description": r.description,
                "access_policy": r.access_policy,
                "needs_token": r.needs_token,
                "fields": list(r.fields),
                # Flagged rather than filtered: the others are real municipal
                # data and a reader should see the whole picture, not our slice.
                "wanted_by_pravaah": r.id in iudx.WANTED,
            }
            for r in resources
        ],
        "we_have_a_token": iudx.available(),
        "needs": None if iudx.available() else iudx.needs(),
        "note": (
            "Camera locations are published; the counts behind them are not "
            "readable without a consumer token. This adapter has never run "
            "against a granted token, so nothing here is proven beyond discovery."
        ),
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
        """A credential is present.

        Necessary and NOT sufficient. See `runs_live` below.
        """
        return bool(os.environ.get(name, "").strip())

    async def runs_live(adapter: object) -> bool:
        """Whether a source can genuinely run live: credential AND adapter.

        This used to be `have(KEY)` alone, and that was a lie waiting to be
        told. There was no TomTom adapter and no VAHAN adapter, so setting
        either key would have turned the row green while changing nothing —
        a green badge that is wrong is far worse than an honest amber one, and
        this panel is the first thing a department engineer reads.

        Two questions, and both must be yes. `available()` asks whether a key
        and the code to use it both exist. `verified()` asks whether the upstream
        actually accepts that key, which is what stops a typo'd or expired
        credential showing green while every reading quietly falls back to
        modelled. The result is cached in the adapter, so this costs one call
        per source per ten minutes rather than one per render.
        """
        checker = getattr(adapter, "available", None)
        if not (checker and checker()):
            return False
        prove = getattr(adapter, "verified", None)
        return bool(await prove()) if prove else True

    tomtom_live = await runs_live(tomtom)
    vahan_live = await runs_live(vahan)
    # Two separate questions for the exchange, because the answers differ and
    # the difference is the whole point of the ask. The catalogue is open and
    # answers today; the data behind it needs a token Jaipur has not issued.
    iudx_live = await runs_live(iudx)
    iudx_reachable = await iudx.catalogue_reachable()

    # A key that is present but refused is its own state, and saying so is the
    # difference between "you have not given us this yet" and "what you gave us
    # does not work" — two very different conversations to have with a
    # department.
    tomtom_needs = (
        "TOMTOM_API_KEY"
        if not tomtom.available()
        else "TOMTOM_API_KEY present but refused by TomTom"
    )
    # VAHAN needs two things, and a key pointed at no resource fails upstream as
    # a 403 — identical to a bad key. Naming the missing piece saves an hour.
    if vahan.api_key() is None:
        vahan_needs = "DATA_GOV_IN_API_KEY"
    elif vahan.resource_id() is None:
        vahan_needs = "VAHAN_RESOURCE_ID (the data.gov.in resource to read)"
    else:
        vahan_needs = "DATA_GOV_IN_API_KEY present but refused by data.gov.in"

    sources: list[dict[str, str | None]] = [
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
            "mode": "live" if tomtom_live else "replay",
            "detail": "Measures delay, never volume — the gap PRAVAAH fills",
            "needs": None if tomtom_live else tomtom_needs,
        },
        {
            "id": "openaq",
            "name": "Air quality",
            "provider": "Open-Meteo · CAMS",
            # Genuinely live, and with no key at all. OpenAQ was the original
            # plan and now gates registration behind an account; the CAMS
            # reanalysis is a modelled product rather than a station reading,
            # which is a real difference and is stated wherever it is shown.
            "mode": "live",
            "detail": "PM2.5, PM10, NO2 against CPCB 24-hour standards",
            "needs": None,
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
            # Not "an integration we could build". The catalogue is answering
            # right now, and it says Jaipur already publishes Vehicle
            # Classification Camera locations. Only read access is missing.
            "id": "iudx",
            "name": "Jaipur city data",
            "provider": "IUDX (Smart Cities Mission)",
            "mode": "live" if iudx_live else "replay",
            "detail": (
                "National exchange, API approved by the Bureau of Indian "
                "Standards. Jaipur publishes VCC and ANPR camera locations"
                + ("" if iudx_reachable else " — catalogue unreachable right now")
            ),
            "needs": None if iudx_live else iudx.needs(),
        },
        {
            "id": "vahan",
            "name": "Vehicle registrations",
            "provider": "VAHAN",
            "mode": "live" if vahan_live else "replay",
            "detail": "Cross-checks measured class mix against the registered fleet",
            "needs": None if vahan_live else vahan_needs,
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


@router.get("/meta/air")
async def air_now() -> dict[str, Any]:
    """Live Jaipur air quality, and which Indian standards it is under.

    Real data, no key. It belongs in a traffic platform because the pollutants
    reported here are the ones road traffic produces — NO2 is overwhelmingly a
    combustion product, and PM is exhaust, brake and tyre wear plus re-suspended
    road dust. That is what turns the low-emission-zone case from an argument
    about road space into an argument about the air people breathe.

    Two things this deliberately does NOT do. It does not attribute a share of
    the pollution to traffic — source apportionment needs data the platform does
    not have, and a confident invented percentage is exactly what this project
    refuses. And it does not call the reading a station measurement: it is a
    modelled reanalysis, real about Jaipur but not from a Jaipur instrument, and
    `source_kind` says so.
    """
    aq = await fetch_air_quality()
    if aq is None:
        return {"available": False}
    return {
        "available": True,
        "pm2_5": aq.pm2_5,
        "pm10": aq.pm10,
        "nitrogen_dioxide": aq.nitrogen_dioxide,
        "ozone": aq.ozone,
        "us_aqi": aq.us_aqi,
        "band": aq.band,
        "exceeds_cpcb": list(aq.exceeds_cpcb),
        "standards": {"pm2_5": CPCB_PM25_24H, "pm10": CPCB_PM10_24H, "no2": CPCB_NO2_24H},
        "observed_at": aq.observed_at,
        "provider": "Open-Meteo · CAMS",
        "source_kind": "modelled reanalysis, not a Jaipur monitoring station",
        "is_synthetic": False,
        "traffic_note": (
            "NO2 and PM are the traffic-linked pollutants. No share of them is "
            "attributed to traffic here — that needs source apportionment this "
            "platform does not have."
        ),
    }


@router.get("/meta/published")
async def published_figures() -> dict[str, Any]:
    """The real, published figures this platform argues from.

    Separated from everything the seed generates, and deliberately so. A Jaipur
    official can check every number below against their own department's
    returns or a published index; the per-record data in the warehouse is
    synthetic, calibrated to these totals, and badged as such wherever it
    appears.

    The test suite asserts the seed still reproduces these, so a regenerated
    demo fails the build rather than quietly drifting away from its evidence.
    """
    return {
        "crashes": {
            "by_year": [
                {"year": y.year, "accidents": y.accidents, "deaths": y.deaths}
                for y in CRASHES_BY_YEAR
            ],
            "total_accidents": TOTAL_ACCIDENTS,
            # Fewer crashes, more deaths. The finding the whole safety layer
            # is built on, and the reason black spots rank by severity.
            "accidents_change_2025_pct": ACCIDENTS_CHANGE_2025_PCT,
            "fatalities_change_2025_pct": FATALITIES_CHANGE_2025_PCT,
            "fatality_rate_2025": FATALITY_RATE_2025,
            "rajasthan_severity_rate_pct": RAJASTHAN_SEVERITY_RATE_PCT,
            "districts_2025": [
                {
                    "name": {"en": d.name_en, "hi": d.name_hi},
                    "accidents": d.accidents,
                    "deaths": d.deaths,
                }
                for d in DISTRICTS_2025
            ],
            "source": {
                "name": RAJASTHAN_POLICE.name,
                "detail": RAJASTHAN_POLICE.detail,
                "url": RAJASTHAN_POLICE.url,
            },
        },
        "congestion": {
            "average_pct": CONGESTION_AVERAGE_PCT,
            "morning_peak_pct": CONGESTION_MORNING_PEAK_PCT,
            "evening_peak_pct": CONGESTION_EVENING_PEAK_PCT,
            "rush_hour_speed_kmh": RUSH_HOUR_SPEED_KMH,
            "source": {
                "name": TOMTOM.name,
                "detail": TOMTOM.detail,
                "url": TOMTOM.url,
            },
        },
        "note": (
            "Published figures, not generated. Per-record data in this instance "
            "is synthetic and calibrated to these totals; the seed reproduces "
            "every accident count here exactly, asserted by the test suite."
        ),
        "is_synthetic": False,
    }
