"""Live Jaipur weather. Open-Meteo — no API key, no account, no rate limit worth
worrying about.

Weather earns its place twice over. It is a forecast feature, and it is the
honest explanation for degraded counting: docs/03 §3 requires that rain, fog and
low light visibly reduce the quality score rather than silently corrupting the
numbers. "Counts suppressed, heavy rain 14:20-15:05" is a sentence that builds
trust; a quiet dip in accuracy destroys it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

JAIPUR = (26.9124, 75.7873)
ENDPOINT = "https://api.open-meteo.com/v1/forecast"


@dataclass(frozen=True)
class Weather:
    temperature_c: float
    precipitation_mm: float
    visibility_m: float | None
    cloud_cover_pct: float
    wind_kmh: float
    is_day: bool
    code: int
    observed_at: str

    @property
    def is_wet(self) -> bool:
        return self.precipitation_mm > 0.1

    @property
    def degrades_counting(self) -> bool:
        """Conditions under which docs/04 §2 expects detection to suffer."""
        return self.is_wet or (self.visibility_m is not None and self.visibility_m < 2000)

    @property
    def summary(self) -> str:
        if self.precipitation_mm > 2:
            return "heavy rain"
        if self.is_wet:
            return "light rain"
        if self.visibility_m is not None and self.visibility_m < 2000:
            return "low visibility"
        if self.cloud_cover_pct > 70:
            return "overcast"
        return "clear"


class WeatherAdapter:
    """Live, or a fixed clear-day reading in replay so the offline demo runs."""

    def __init__(self, *, mode: str = "live", timeout: float = 8.0) -> None:
        self.mode = mode
        self.timeout = timeout

    async def current(self) -> Weather:
        if self.mode == "replay":
            return Weather(
                temperature_c=29.0,
                precipitation_mm=0.0,
                visibility_m=12000.0,
                cloud_cover_pct=18.0,
                wind_kmh=9.0,
                is_day=True,
                code=0,
                observed_at="replay",
            )
        lat, lon = JAIPUR
        params: dict[str, Any] = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,precipitation,cloud_cover,wind_speed_10m,"
            "visibility,is_day,weather_code",
            "timezone": "Asia/Kolkata",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(ENDPOINT, params=params)
            response.raise_for_status()
            current = response.json()["current"]
        return Weather(
            temperature_c=float(current["temperature_2m"]),
            precipitation_mm=float(current["precipitation"]),
            visibility_m=(
                float(current["visibility"]) if current.get("visibility") is not None else None
            ),
            cloud_cover_pct=float(current["cloud_cover"]),
            wind_kmh=float(current["wind_speed_10m"]),
            is_day=bool(current["is_day"]),
            code=int(current["weather_code"]),
            observed_at=str(current["time"]),
        )
