"""Live Jaipur air quality. Open-Meteo — no API key, no account.

This source earns its place in a *traffic* platform for one reason: the
pollutants it reports are the ones road traffic produces. NO2 is very largely a
combustion product, and in an Indian city the dominant roadside source is
vehicle exhaust; PM2.5 and PM10 are a mix of exhaust, brake and tyre wear, and
re-suspended road dust — all of which scale with the vehicle-kilometres the rest
of this platform measures.

That is what makes the low-emission-zone case in NEETI checkable rather than
rhetorical. A LEZ modelled as removing 8% of PCU is an argument about road
space; the same LEZ argued against a measured NO2 concentration is an argument
about the air people breathe, and the second one is the one a health department
will act on.

Deliberate limits, stated because a pollution number is easy to over-claim:

* This is a **modelled** reanalysis product (CAMS), not a reading from a Jaipur
  monitoring station. It is real data about Jaipur, not a Jaipur instrument.
  `source_kind` says so and the interface repeats it.
* Nothing here attributes a share of the pollution to traffic. Doing that needs
  source apportionment the platform does not have, and inventing a percentage
  would be exactly the kind of confident wrong number this project refuses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

import httpx

JAIPUR: Final = (26.9124, 75.7873)
ENDPOINT: Final = "https://air-quality-api.open-meteo.com/v1/air-quality"

#: CPCB's 24-hour national standards, in ug/m3. Indian standards rather than
#: WHO's, because a Jaipur official is accountable against these and quoting a
#: standard they are not measured on is not useful to them.
CPCB_PM25_24H: Final = 60.0
CPCB_PM10_24H: Final = 100.0
CPCB_NO2_24H: Final = 80.0


@dataclass(frozen=True)
class AirQuality:
    pm2_5: float | None
    pm10: float | None
    nitrogen_dioxide: float | None
    ozone: float | None
    carbon_monoxide: float | None
    us_aqi: int | None
    observed_at: str

    @property
    def exceeds_cpcb(self) -> tuple[str, ...]:
        """Which Indian 24-hour standards the current value is above.

        Named as an exceedance of a *standard* rather than as "bad air", because
        the standard is the thing with a legal meaning and a number attached.
        """
        over: list[str] = []
        if self.pm2_5 is not None and self.pm2_5 > CPCB_PM25_24H:
            over.append("PM2.5")
        if self.pm10 is not None and self.pm10 > CPCB_PM10_24H:
            over.append("PM10")
        if self.nitrogen_dioxide is not None and self.nitrogen_dioxide > CPCB_NO2_24H:
            over.append("NO2")
        return tuple(over)

    @property
    def band(self) -> str:
        """US AQI band. Reported alongside CPCB rather than instead of it —
        the AQI is what a citizen recognises, the standard is what a department
        is measured on."""
        if self.us_aqi is None:
            return "unknown"
        if self.us_aqi <= 50:
            return "good"
        if self.us_aqi <= 100:
            return "moderate"
        if self.us_aqi <= 150:
            return "unhealthy_sensitive"
        if self.us_aqi <= 200:
            return "unhealthy"
        if self.us_aqi <= 300:
            return "very_unhealthy"
        return "hazardous"


async def fetch_air_quality(client: httpx.AsyncClient | None = None) -> AirQuality | None:
    """Current Jaipur air quality, or None if the source is unreachable.

    Returning None rather than raising: air quality is context, not a
    measurement the platform depends on. A console that fails to load because a
    pollution API was slow would be trading something load-bearing for
    something that is not.
    """
    params: dict[str, str | float] = {
        "latitude": JAIPUR[0],
        "longitude": JAIPUR[1],
        "current": "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,us_aqi",
        "timezone": "Asia/Kolkata",
    }
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=6.0)
    try:
        response = await client.get(ENDPOINT, params=params)
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    finally:
        if owns_client:
            await client.aclose()

    current = payload.get("current") or {}
    if not current:
        return None

    def num(key: str) -> float | None:
        value = current.get(key)
        return float(value) if isinstance(value, (int, float)) else None

    aqi = current.get("us_aqi")
    return AirQuality(
        pm2_5=num("pm2_5"),
        pm10=num("pm10"),
        nitrogen_dioxide=num("nitrogen_dioxide"),
        ozone=num("ozone"),
        carbon_monoxide=num("carbon_monoxide"),
        us_aqi=int(aqi) if isinstance(aqi, (int, float)) else None,
        observed_at=str(current.get("time", "")),
    )
