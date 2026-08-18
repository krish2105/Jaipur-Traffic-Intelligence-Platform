"""Congestion-anomaly classification.

The detector answers one question: *is this link, right now, unusually worse
than this link normally is at this hour on this day?* That framing matters.
An absolute threshold ("congestion above 80 is an incident") fires every
evening on Tonk Road and never fires at all on a quiet link — which is exactly
backwards, because 80 on Tonk Road at 19:00 is Tuesday, and 55 on a residential
link at 03:00 is something worth sending a vehicle to look at.

So the baseline is the link's own median for that (weekday, hour) cell, and the
scale is the median absolute deviation of that same cell. Both are robust: a
mean and a standard deviation would be dragged upward by the very incidents we
are trying to find, which is the classic failure of a z-score detector on
incident data — the more incidents in the history, the fewer it reports.

docs/04 §3 requires a false-positive rate as a first-class metric, and the
schema enforces that an incident can only be marked a false positive once a
human has verified it. Nothing here auto-confirms anything: every row this
produces is a candidate for a human queue.
"""

from __future__ import annotations

from typing import Final, Literal

Severity = Literal["low", "medium", "high", "critical"]

#: Below this robust z-score, a residual is ordinary day-to-day variation.
#: 2.5 on a MAD-based scale is roughly a 1-in-80 cell, which across 594 links
#: and 96 buckets a day is a workable queue rather than a flood.
Z_FLOOR: Final = 2.5

#: A link whose history is almost perfectly repeatable has a near-zero MAD, and
#: dividing by it manufactures enormous z-scores from a two-point wobble. The
#: residual must also be large in the units an engineer actually reads.
MIN_ABSOLUTE_RESIDUAL: Final = 12.0

_BANDS: Final[tuple[tuple[float, Severity], ...]] = (
    (6.0, "critical"),
    (4.5, "high"),
    (3.5, "medium"),
    (Z_FLOOR, "low"),
)


def is_anomalous(residual: float, z: float) -> bool:
    """Both tests must pass: statistically unusual *and* materially worse.

    The residual is signed. A link running 30 points *better* than its median
    is not an incident, and treating it as one is how a detector ends up
    reporting a public holiday as a city-wide emergency.
    """
    return residual >= MIN_ABSOLUTE_RESIDUAL and z >= Z_FLOOR


def severity_for(z: float) -> Severity:
    """Band a robust z-score. Assumes :func:`is_anomalous` already passed."""
    for floor, band in _BANDS:
        if z >= floor:
            return band
    return "low"


def confidence_for(z: float) -> float:
    """Map a z-score onto the detector's own confidence, capped below 1.

    Deliberately never returns 1.0. docs/07 §6 forbids an unexplained or
    unqualified score reaching a human, and a detector that claims certainty
    about a statistical residual is lying about what it knows. The ceiling of
    0.97 is reached at z = 8; beyond that the number stops being informative
    and the severity band carries the message instead.
    """
    if z <= Z_FLOOR:
        return 0.5
    span = (min(z, 8.0) - Z_FLOOR) / (8.0 - Z_FLOOR)
    return round(0.55 + span * 0.42, 2)
