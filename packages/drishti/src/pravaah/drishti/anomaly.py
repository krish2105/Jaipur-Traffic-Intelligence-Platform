"""Finding the road that is wrong, from speeds alone.

Two independent questions
-------------------------
**Spatial.** Is this segment much slower than its neighbours on the same
corridor, right now? Needs no history at all, which is why it works today.

**Temporal.** Is this segment much slower than it usually is at this hour?
Needs history, and with one sweep on disk it has none, so it declines rather
than inventing a baseline out of a single reading.

They fail differently and that is the point of having both. Spatial misses an
incident that slows a whole corridor at once. Temporal misses a road that is
always bad. An alert that both agree on is worth interrupting someone for; one
that only one of them raises is worth showing quietly.

Median and MAD, not mean and standard deviation
-----------------------------------------------
A corridor here has between three and ten sampled segments. With samples that
few, one genuinely stuck segment drags the mean toward itself and inflates the
standard deviation, so the outlier ends up inside its own widened band and
hides. Median absolute deviation does not move when one value goes extreme,
which is exactly the property wanted when the extreme value is the thing being
looked for.

This is anomaly detection, not incident detection
-------------------------------------------------
A slow segment might be a crash, a procession, a burst water main, or a signal
stuck on red. This module says "this is unlike its neighbours" and nothing more.
Naming a cause would be a guess wearing an alert's authority, and the control
room already has people whose job is to look.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass

#: Robust z-score above which a segment is called unusual. 3.5 is the common
#: threshold for modified z-scores and is deliberately not tuned against our own
#: data, since with one sweep there is nothing honest to tune it on.
THRESHOLD = 3.5

#: Below this many peers a corridor cannot say what normal looks like. Two
#: segments have a median that is just their mean, and a MAD of half their gap.
MIN_PEERS = 4

#: 0.6745 makes the MAD-based score comparable to a standard z-score for
#: normally distributed data, which is what makes 3.5 mean anything.
MAD_SCALE = 0.6745


@dataclass(frozen=True)
class Observation:
    """One segment reading, as the caller has it.

    A typed input rather than a dict. The first version took dicts of `object`
    and needed a type-ignore on every field access, which is the compiler asking
    for a shape and being told to be quiet.
    """

    link_id: int
    name: str
    corridor_id: int
    congestion_index: float
    #: Which TomTom segment this reading came from. Several links share one.
    segment_key: str | None = None


@dataclass(frozen=True)
class Anomaly:
    """One segment that does not look like its surroundings."""

    link_id: int
    #: Every link sitting on this TomTom segment, including link_id itself.
    #: Several of our links routinely share one, and reporting them separately
    #: would turn a single slow stretch into three alerts.
    covers: tuple[int, ...]
    name: str
    corridor_id: int
    congestion_index: float
    peer_median: float
    score: float
    #: "spatial" today. "spatial+temporal" once there is history to compare to.
    basis: str
    #: What the reader should do with it: watch, or look now.
    severity: str


def _mad(values: Sequence[float], centre: float) -> float:
    return statistics.median([abs(v - centre) for v in values])


def spatial(observations: Sequence[Observation], *, threshold: float = THRESHOLD) -> list[Anomaly]:
    """Segments unlike their corridor peers, right now.

    Corridors with too few peers are skipped rather than scored, because a
    threshold applied to three numbers finds whatever it is pointed at.

    Links sharing a TomTom segment are collapsed first. Left alone they would
    both triple-count a slow stretch as three alerts and distort the peer median
    they are compared against, which is the worse half: the comparison would be
    against a set that silently contains the same road several times.
    """
    unique: dict[str, Observation] = {}
    covered: dict[str, list[int]] = {}
    for observation in observations:
        # Fall back to the link id when no segment key is known, so a link with
        # no shared-segment information is still its own observation.
        key = observation.segment_key or f"link:{observation.link_id}"
        unique.setdefault(key, observation)
        covered.setdefault(key, []).append(observation.link_id)

    by_corridor: dict[int, list[tuple[str, Observation]]] = {}
    for key, observation in unique.items():
        by_corridor.setdefault(observation.corridor_id, []).append((key, observation))

    found: list[Anomaly] = []
    for corridor, members in sorted(by_corridor.items()):
        if len(members) < MIN_PEERS:
            continue
        values = [m.congestion_index for _, m in members]
        centre = statistics.median(values)
        spread = _mad(values, centre)
        if spread <= 0:
            # Every peer identical. Any difference at all would score as
            # infinite, so there is nothing this can honestly say.
            continue
        for key, member in members:
            score = MAD_SCALE * (member.congestion_index - centre) / spread
            # One-sided: a segment moving unusually *well* is not an incident,
            # and alerting on it would train people to ignore the panel.
            if score < threshold:
                continue
            found.append(
                Anomaly(
                    link_id=member.link_id,
                    covers=tuple(sorted(covered[key])),
                    name=member.name,
                    corridor_id=corridor,
                    congestion_index=round(member.congestion_index, 1),
                    peer_median=round(centre, 1),
                    score=round(score, 1),
                    basis="spatial",
                    severity="look now" if score >= 2 * threshold else "watch",
                )
            )
    found.sort(key=lambda a: -a.score)
    return found


def method(peers_available: bool, history_available: bool) -> dict[str, object]:
    """What this run could and could not do, for the payload to carry."""
    return {
        "spatial": "modified z-score on congestion index against corridor peers",
        "statistic": "median and median absolute deviation, not mean and stdev",
        "why_robust": (
            "With three to ten peers, one stuck segment inflates a standard "
            "deviation enough to hide inside its own band."
        ),
        "threshold": THRESHOLD,
        "min_peers": MIN_PEERS,
        "spatial_available": peers_available,
        "temporal_available": history_available,
        "temporal_note": (
            "Comparing a segment against its own history at this hour needs "
            "history. Until there is enough, only the spatial test runs and "
            "an incident that slows a whole corridor at once will be missed."
        ),
        "limits": (
            "This says a segment is unlike its neighbours. It does not say why. "
            "A crash, a procession, a burst main and a signal stuck on red look "
            "identical from a speed reading."
        ),
    }
