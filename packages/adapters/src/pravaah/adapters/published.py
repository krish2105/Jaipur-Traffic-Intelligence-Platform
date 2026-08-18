"""Published figures for Jaipur, with their sources.

This module exists so that the numbers the platform *argues from* are separable
from the numbers it *generates*. Everything here is real, published, and
attributable. The seeded per-record data in the warehouse is calibrated against
these totals and is labelled synthetic everywhere it appears; these are the
figures a Jaipur official can check against their own department's reporting.

Keeping them in code rather than in a slide has a practical payoff: the test
suite asserts the seed still reproduces them, so the demo cannot quietly drift
away from the evidence it claims to rest on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class Source:
    name: str
    detail: str
    url: str


TOMTOM: Final = Source(
    name="TomTom Traffic Index 2025 — Jaipur",
    detail="Congestion level and travel-time delay, published annually.",
    url="https://www.tomtom.com/traffic-index/jaipur-traffic/",
)

RAJASTHAN_POLICE: Final = Source(
    name="Jaipur police district crash returns, 2021-2025",
    detail=(
        "Compiled from the Jaipur East, West, North, South and Rural police "
        "districts and reported in the state press."
    ),
    url="https://www.prokerala.com/news/articles/a1791924.html",
)


@dataclass(frozen=True)
class CrashYear:
    year: int
    accidents: int
    #: Deaths are published for some years only. None means not published —
    #: never zero, and never an estimate presented as a figure.
    deaths: int | None


#: Jaipur, all five police districts. Accidents are published for every year;
#: deaths only for 2021, 2022 and 2025.
CRASHES_BY_YEAR: Final[tuple[CrashYear, ...]] = (
    CrashYear(2021, 3205, 1106),
    CrashYear(2022, 3935, 1327),
    CrashYear(2023, 3893, None),
    CrashYear(2024, 3881, None),  # deaths not published; see DEATHS_2024_DERIVED
    CrashYear(2025, 3664, 1273),
)

TOTAL_ACCIDENTS: Final = sum(y.accidents for y in CRASHES_BY_YEAR)

#: The headline of the safety case, and the reason this platform ranks black
#: spots by severity rather than by frequency: in 2025 Jaipur had FEWER crashes
#: than 2024 and MORE deaths.
ACCIDENTS_CHANGE_2025_PCT: Final = -5.6
FATALITIES_CHANGE_2025_PCT: Final = +3.1

#: Deaths per 100 crashes, 2025 — the highest in five years.
FATALITY_RATE_2025: Final = 34.7

#: 2024 deaths are not published directly, but they are *derivable* from two
#: figures that are: 2025 deaths (1,273) and the reported +3.1% year-on-year
#: rise. 1273 / 1.031 = 1,235.
#:
#: Kept as a separate constant rather than folded into CRASHES_BY_YEAR, because
#: derived and published are different kinds of number and a reader deserves to
#: know which they are looking at. The seed targets this value so that the
#: severity reversal — fewer crashes, more deaths — is reproducible in the
#: warehouse and not merely quoted at it.
DEATHS_2024_DERIVED: Final = 1235

#: Rajasthan's crash severity rate, third highest of any Indian state.
RAJASTHAN_SEVERITY_RATE_PCT: Final = 47.47


@dataclass(frozen=True)
class PoliceDistrict:
    name_en: str
    name_hi: str
    accidents: int
    deaths: int | None


#: 2025, by Jaipur police district.
DISTRICTS_2025: Final[tuple[PoliceDistrict, ...]] = (
    PoliceDistrict("Jaipur East", "जयपुर पूर्व", 1011, None),
    PoliceDistrict("Jaipur West", "जयपुर पश्चिम", 964, None),
    PoliceDistrict("Jaipur Rural", "जयपुर ग्रामीण", 805, 426),
    PoliceDistrict("Jaipur South", "जयपुर दक्षिण", 666, 184),
    PoliceDistrict("Jaipur North", "जयपुर उत्तर", 218, 71),
)

#: TomTom Traffic Index 2025, Jaipur. These four drive the seed calibration in
#: `profiles.py`, which reproduces each one exactly.
CONGESTION_AVERAGE_PCT: Final = 58.7
CONGESTION_MORNING_PEAK_PCT: Final = 73.9
CONGESTION_EVENING_PEAK_PCT: Final = 94.9
RUSH_HOUR_SPEED_KMH: Final = 17.5
