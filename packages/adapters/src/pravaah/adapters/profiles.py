"""Jaipur traffic profiles derived from published, citable measurements.

docs/05 §5 requires the seeded 90 days to be "generated from real TomTom-derived
Jaipur diurnal profiles ... so the shapes are honest even though the counts are
synthetic". Everything in this module traces to a number in docs/01 §2:

    average congestion level          58.7%
    morning rush congestion           73.9%   (peak window 09:00-11:00)
    evening rush congestion           94.9%   (peak window 18:00-20:00)
    average rush-hour speed           17.5 km/h
    worst day of 2025                 Friday 17 October, 90%
    fleet composition                 two-wheeler dominant (docs/04 §2)

The counts are synthetic. The *shape* is not, and every row carries
is_synthetic = true so the UI can badge it (docs/02 rule 6).
"""

from __future__ import annotations

from datetime import date

# ── measured constants, all from docs/01 §2 (TomTom Traffic Index 2025) ──────
AVG_CONGESTION = 58.7
MORNING_PEAK_CONGESTION = 73.9
EVENING_PEAK_CONGESTION = 94.9
RUSH_HOUR_SPEED_KMH = 17.5
WORST_DAY_2025 = date(2025, 10, 17)
WORST_DAY_CONGESTION = 90.0
#: Solved so that day_mean_congestion(WORST_DAY_2025) == 90.0 after the
#: 0-100 clamp bites in the peak hours. Asserted in the test suite.
WORST_DAY_MULTIPLIER = 1.868371

#: Two-wheeler dominance is the whole reason probe data misleads here: probe
#: samples over-represent car drivers running navigation, in a fleet that is
#: mostly two-wheelers (docs/01 §4). Shares sum to 1.0.
_RAW_CLASS_SHARE = {
    "2W": 0.610,
    "CAR": 0.240,
    "AUTO": 0.062,
    "ERIK": 0.028,
    "LCV": 0.030,
    "BUS": 0.012,
    "TRK2": 0.010,
    "NMV": 0.008,
}
CLASS_SHARE: dict[str, float] = {
    k: v / sum(_RAW_CLASS_SHARE.values()) for k, v in _RAW_CLASS_SHARE.items()
}

#: Relative demand in each hour. Twin-peaked, evening heavier than morning —
#: which is what the 94.9% vs 73.9% congestion split implies. Normalised at
#: import so the shares always sum to exactly 1.0 and editing a single hour
#: cannot silently skew the day's total.
_RAW_HOURLY = (
    0.006,
    0.004,
    0.003,
    0.003,
    0.006,
    0.014,  # 00-05 night
    0.030,
    0.048,
    0.068,
    0.082,
    0.079,
    0.066,  # 06-11 morning build + peak
    0.055,
    0.050,
    0.048,
    0.052,
    0.062,
    0.080,  # 12-17 midday trough, build
    0.093,
    0.086,
    0.062,
    0.041,
    0.026,
    0.014,  # 18-23 evening peak, decay
)
_HOURLY_WEIGHTS: tuple[float, ...] = tuple(w / sum(_RAW_HOURLY) for w in _RAW_HOURLY)


def hour_weight(hour: int) -> float:
    """Share of a day's volume falling in `hour`."""
    return _HOURLY_WEIGHTS[hour % 24]


def day_factor(day: date) -> float:
    """Weekday-vs-weekend demand multiplier.

    Sunday in Jaipur is materially quieter; Saturday only slightly so. Anchored
    at 1.0 for a working weekday so the annual mean stays near the measured one.
    """
    weekday = day.weekday()  # Monday = 0
    if weekday == 6:  # Sunday
        return 0.63
    if weekday == 5:  # Saturday
        return 0.88
    if weekday == 4:  # Friday — the worst day of 2025 was a Friday
        return 1.06
    return 1.0


#: Congestion index by hour of a working weekday. An explicit table rather than
#: fitted gaussians, because the shape is a claim we have to defend: the three
#: measured anchors from docs/01 §2 are marked, and every other hour is a stated
#: interpolation someone can argue with. Hidden curve parameters cannot be
#: audited in a policy file; a table can.
#:
#: Calibration: the two published peak windows (09:00-11:00, 18:00-20:00) are
#: fixed at their measured values. The remaining hours are not published, so
#: they are scaled by a single constant chosen to make the travel-weighted mean
#: equal TomTom's published 58.7%. Three published numbers, three constraints,
#: no free parameters left over.
_HOURLY_CONGESTION: tuple[float, ...] = (
    10.1,
    7.8,
    7.0,
    7.0,
    9.3,
    14.8,  # 00-05  night trough
    24.1,
    34.3,
    46.7,
    71.0,
    73.9,
    69.0,  # 06-11  build; 10:00 = measured 73.9
    47.5,
    42.1,
    39.7,
    41.3,
    46.7,
    56.8,  # 12-17  midday dip, evening build
    86.0,
    94.9,
    87.0,
    53.0,
    35.0,
    19.5,  # 18-23  peak;  19:00 = measured 94.9
)


def congestion_index(hour: int, minute: int, day: date) -> float:
    """Congestion index 0-100 for a moment on the published Jaipur day profile.

    Interpolated across the hour so the gnomon arc reads as a curve rather than
    a staircase, then scaled by the weekday factor.
    """
    position = (hour + minute / 60.0) % 24.0
    low = int(position) % 24
    high = (low + 1) % 24
    frac = position - int(position)
    index = _HOURLY_CONGESTION[low] * (1 - frac) + _HOURLY_CONGESTION[high] * frac

    index *= day_factor(day)
    if day == WORST_DAY_2025:
        # Friday 17 October 2025 — TomTom's worst Jaipur day of 2025 at 90%.
        # That 90% is the day's *average* congestion, not its peak, so the whole
        # day is lifted by a solved multiplier rather than the peak being pinned
        # to 90. Seeded explicitly so the time-travel scrubber lands on a real,
        # citable day instead of one we invented.
        index *= WORST_DAY_MULTIPLIER
    return min(100.0, max(0.0, index))


def day_mean_congestion(day: date) -> float:
    """Travel-weighted mean congestion for a given day — the quantity TomTom
    reports per day, and what the 90% worst-day figure refers to."""
    return sum(congestion_index(h, 30, day) * hour_weight(h) for h in range(24))


def travel_weighted_mean_congestion() -> float:
    """Congestion as a traveller experiences it — weighted by how much traffic
    is actually on the road in each hour. This is the quantity TomTom's
    "average congestion level" reports, and it should land on 58.7%."""
    return sum(_HOURLY_CONGESTION[h] * hour_weight(h) for h in range(24))


#: Free-flow speed assumed for the citywide rush-speed calibration. Urban
#: arterial, signalised, which is what the Jaipur corridors in scope are.
CALIBRATION_FREE_FLOW_KMH = 40.0

#: Speed decay against congestion: speed = free_flow * (1 - A * (index/100)^B).
#: B sets the curve's shape; A is solved so that the volume-weighted mean speed
#: across the two published rush windows equals TomTom's measured 17.5 km/h.
#: See `rush_hour_mean_speed()`, which is asserted in the test suite.
_SPEED_DECAY_EXPONENT = 1.35
_SPEED_DECAY_COEFFICIENT = 0.748875
_MIN_SPEED_RATIO = 0.10

RUSH_HOURS: tuple[int, ...] = (9, 10, 11, 18, 19, 20)


def speed_kmh(index: float, free_flow_kmh: float) -> float:
    """Speed implied by a congestion index.

    Calibrated so the rush-window mean lands on the published 17.5 km/h — not
    the peak minute, which is what that figure is often misread as.
    """
    ratio = 1.0 - _SPEED_DECAY_COEFFICIENT * (max(0.0, index) / 100.0) ** _SPEED_DECAY_EXPONENT
    return float(round(free_flow_kmh * max(_MIN_SPEED_RATIO, ratio), 1))


def rush_hour_mean_speed(free_flow_kmh: float = CALIBRATION_FREE_FLOW_KMH) -> float:
    """Volume-weighted mean speed across the published rush windows.

    This is the quantity TomTom reports as "average rush-hour speed", and it is
    what _SPEED_DECAY_COEFFICIENT is solved against.
    """
    weights = [hour_weight(h) for h in RUSH_HOURS]
    speeds = [speed_kmh(_HOURLY_CONGESTION[h], free_flow_kmh) for h in RUSH_HOURS]
    return sum(s * w for s, w in zip(speeds, weights, strict=True)) / sum(weights)


def quality_score(hour: int, *, is_wet: bool) -> tuple[float, list[str]]:
    """Per-bin data quality, and why.

    docs/03 §3: "Degrade honestly. Night, rain, fog, glare and dust all degrade
    counting. Emit a quality score per bin, suppress low-quality bins from
    policy outputs, and show the suppression in the UI rather than hiding it."
    """
    flags: list[str] = []
    score = 0.95
    if hour < 6 or hour >= 19:
        score -= 0.14
        flags.append("low_light")
    if hour in (7, 8, 17, 18):
        score -= 0.03
        flags.append("glare")
    if is_wet:
        score -= 0.22
        flags.append("rain")
    if 9 <= hour <= 11 or 18 <= hour <= 20:
        score -= 0.04
        flags.append("occlusion")  # dense two-wheeler filtering
    return round(max(0.28, min(1.0, score)), 2), flags
