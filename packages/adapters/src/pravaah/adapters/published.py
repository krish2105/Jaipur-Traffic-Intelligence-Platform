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

RAJASTHAN_ROAD_SAFETY_CELL: Final = Source(
    name="Rajasthan Road Safety Cell — vehicle population, 31 March 2022",
    detail="Registered motor vehicles in Rajasthan by category, published by the state.",
    url="https://roadsafetycell.rkcl.in/",
)


@dataclass(frozen=True)
class FleetCategory:
    """One row of the state's registered-vehicle population."""

    #: Maps to `vehicle_classes.class_code` where the two align. None where the
    #: registration category has no counting equivalent — a trailer is not a
    #: thing a camera counts as a distinct vehicle on a carriageway.
    class_code: str | None
    name_en: str
    name_hi: str
    vehicles: int


#: Rajasthan, as of 31 March 2022. Real, official, and the reason the
#: composition argument has two ends rather than one.
#:
#: The registered fleet is NOT the traffic mix and must never be presented as
#: it. A two-wheeler is registered more often than a car and driven fewer
#: kilometres per day; an arterial like Tonk Road carries a different mix again
#: from a residential lane. Putting the two side by side is exactly what makes
#: that visible — and it is visible: cars are 12.4% of the registered fleet and
#: 24% of measured arterial traffic, so they are roughly twice over-represented
#: on the road compared with how many exist.
FLEET_RAJASTHAN_2022: Final[tuple[FleetCategory, ...]] = (
    FleetCategory("2W", "Two-wheelers", "दोपहिया", 12_524_664),
    FleetCategory("CAR", "Cars", "कार", 2_131_612),
    FleetCategory("TRAC", "Tractors", "ट्रैक्टर", 1_180_769),
    FleetCategory("TRK2", "Trucks", "ट्रक", 640_733),
    FleetCategory("AUTO", "Three-wheelers", "तिपहिया", 225_950),
    FleetCategory("TAXI", "Maxi cabs", "मैक्सी कैब", 127_510),
    FleetCategory(None, "Trailers", "ट्रेलर", 124_528),
    FleetCategory("BUS", "Buses", "बस", 83_562),
    FleetCategory(None, "Construction equipment", "निर्माण उपकरण", 45_426),
    FleetCategory("ERIK", "E-rickshaws", "ई-रिक्शा", 33_462),
)

#: The state's own published total, which is larger than the sum above because
#: the tail (school buses, ambulances, tractor trolleys, "others") is omitted.
#: Kept as the published figure rather than recomputed, so a reader comparing
#: against the source finds the same number.
FLEET_RAJASTHAN_TOTAL: Final = 17_174_784

#: Published shares, quoted rather than derived — the state rounds to two places
#: and a recomputed value that differs in the last digit invites a pointless
#: argument about which is right.
FLEET_TWO_WHEELER_PCT: Final = 72.92
FLEET_CAR_PCT: Final = 12.41


MORTH: Final = Source(
    name="MoRTH, Road Accidents in India 2022",
    detail="National accident and fatality statistics by cause and road-user type.",
    url="https://morth.nic.in/road-accident-in-india",
)

#: MoRTH 2022, national. 4,61,312 accidents and 1,68,491 deaths.
MORTH_ACCIDENTS_2022: Final = 461_312
MORTH_DEATHS_2022: Final = 168_491

#: Share of all road deaths, by the road user who died or the cause assigned.
#: These are what make a severity model possible: they say that WHO is involved
#: changes the odds of dying far more than how many crashes occur.
MORTH_TWO_WHEELER_DEATH_SHARE_PCT: Final = 44.5
MORTH_PEDESTRIAN_DEATH_SHARE_PCT: Final = 19.5
MORTH_OVERSPEED_ACCIDENT_SHARE_PCT: Final = 72.3
MORTH_OVERSPEED_DEATH_SHARE_PCT: Final = 71.2

#: Relative odds that a crash is fatal or grievous, given who was involved.
#:
#: Derived from the shares above rather than invented. A pedestrian is present
#: in a small minority of crashes and accounts for roughly one death in five,
#: so pedestrian involvement raises severity odds sharply. A two-wheeler rider
#: is involved in a large share of crashes and 44.5% of deaths, so the lift is
#: real but smaller. Over-speeding is 72.3% of accidents and 71.2% of deaths —
#: almost identical, which is the interesting part: speeding causes an enormous
#: NUMBER of crashes without making an individual crash much more likely to
#: kill. Its multiplier is therefore ~1.0, and a model that assigned it a large
#: severity effect would be reading volume as risk.
SEVERITY_ODDS: Final[dict[str, float]] = {
    "pedestrian_involved": 3.1,
    "two_wheeler_involved": 1.7,
    "heavy_vehicle_involved": 2.2,
    "night": 1.45,
    "over_speeding": 1.02,
}


#: TomTom Traffic Index 2025, Jaipur. These four drive the seed calibration in
#: `profiles.py`, which reproduces each one exactly.
CONGESTION_AVERAGE_PCT: Final = 58.7
CONGESTION_MORNING_PEAK_PCT: Final = 73.9
CONGESTION_EVENING_PEAK_PCT: Final = 94.9
RUSH_HOUR_SPEED_KMH: Final = 17.5
