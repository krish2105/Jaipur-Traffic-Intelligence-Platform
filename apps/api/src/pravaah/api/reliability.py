"""Travel time reliability, from the probe history.

Why reliability and not delay
-----------------------------
Mean delay is the number every traffic product reports and the number nobody
outside the department feels. What a commuter experiences is variance: the trip
that takes 19 minutes most days and 34 on the day it matters. FHWA measures this
with two indices and runs them across more than 30 cities, so this is a
standard, not an invention:

    Buffer Index        (95th percentile - mean) / mean
    Planning Time Index  95th percentile / free flow

Buffer Index is the cushion you add to a *typical* trip. Planning Time Index is
the whole journey against an empty road. A Buffer Index of 0.4 means budget 40%
on top of your usual time to arrive on time nineteen days in twenty.

This is the one capability the platform can measure today with no vehicle counts
at all, because it needs travel times and nothing else.

The gate is the honest part
---------------------------
A 95th percentile from six samples is arithmetic, not evidence. Worse, six
samples taken within one hour describe that hour and get reported as if they
described the road. So there are two thresholds and both must pass: enough
samples, and enough *distinct hours* for those samples to have seen a peak and
an off-peak. Below either, this refuses and says which one failed.

Refusing is cheap. A Buffer Index quoted to a Commissioner from a Tuesday
afternoon is not.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

#: Below this many sweeps a percentile is a rounding artefact of the sample size.
MIN_SAMPLES = 40

#: And they must span this many distinct clock hours, so the spread reflects the
#: day rather than one afternoon. 40 samples inside two hours is not reliability.
MIN_DISTINCT_HOURS = 8

#: How far back to look. Reliability is a claim about the road as it is now, and
#: a corridor that was rebuilt last month should not be judged on last quarter.
WINDOW_DAYS = 30

#: TomTom below this is reporting its own history, not a probe reading. Those
#: samples are dropped rather than blended in, for the same reason a modelled
#: speed is never labelled measured.
MIN_CONFIDENCE = 0.7


def _find(name: str) -> Path | None:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "data" / "probe" / name
        if candidate.exists():
            return candidate
    return None


def percentile(values: list[float], p: float) -> float:
    """Linear-interpolated percentile, written out rather than imported.

    numpy is not a dependency of the API and `statistics.quantiles` uses a
    different convention at the tails, which would make the figure disagree with
    the hand-computed fixture in the tests. An index quoted to a department
    should be reproducible with a calculator.
    """
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * p
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def load_history(now: datetime | None = None) -> list[dict[str, Any]]:
    """Every sweep inside the window, oldest first.

    A malformed line is skipped rather than fatal: this file is appended to by a
    cron and a half-written final line is a normal thing to find, not a reason to
    take reliability off the console.
    """
    path = _find("history.jsonl")
    if path is None:
        return []
    cutoff = (now or datetime.now(UTC)) - timedelta(days=WINDOW_DAYS)
    sweeps: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
            when = datetime.fromisoformat(row["t"])
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if when >= cutoff:
            sweeps.append({"at": when, "readings": row.get("r") or {}})
    sweeps.sort(key=lambda s: s["at"])
    return sweeps


def _indices(travel_times: list[float], free_flow: float) -> dict[str, float]:
    mean = sum(travel_times) / len(travel_times)
    p95 = percentile(travel_times, 0.95)
    p50 = percentile(travel_times, 0.50)
    return {
        "mean_travel_time_s": round(mean, 1),
        "median_travel_time_s": round(p50, 1),
        "p95_travel_time_s": round(p95, 1),
        "free_flow_travel_time_s": round(free_flow, 1),
        # The cushion on top of a typical trip.
        "buffer_index": round((p95 - mean) / mean, 3) if mean > 0 else 0.0,
        # The whole journey against an empty road.
        "planning_time_index": round(p95 / free_flow, 3) if free_flow > 0 else 0.0,
        # Reported alongside because a high PTI with a low Buffer Index means a
        # road that is reliably slow, which is a different problem needing a
        # different fix from one that is unpredictably slow.
        "travel_time_index": round(mean / free_flow, 3) if free_flow > 0 else 0.0,
    }


def by_segment(now: datetime | None = None) -> dict[str, Any]:
    """Reliability per sampled segment, or a refusal saying what is missing."""
    sweeps = load_history(now)
    times: dict[str, list[float]] = defaultdict(list)
    free_flows: dict[str, list[float]] = defaultdict(list)
    hours: dict[str, set[int]] = defaultdict(set)

    for sweep in sweeps:
        for link_id, sample in sweep["readings"].items():
            try:
                current, free_flow, confidence = (
                    float(sample[0]),
                    float(sample[1]),
                    float(sample[2]),
                )
            except (TypeError, ValueError, IndexError):
                continue
            if confidence < MIN_CONFIDENCE or current <= 0 or free_flow <= 0:
                continue
            times[link_id].append(current)
            free_flows[link_id].append(free_flow)
            hours[link_id].add(sweep["at"].hour)

    segments = []
    for link_id, values in sorted(times.items(), key=lambda kv: int(kv[0])):
        distinct_hours = len(hours[link_id])
        enough = len(values) >= MIN_SAMPLES and distinct_hours >= MIN_DISTINCT_HOURS
        row: dict[str, Any] = {
            "link_id": int(link_id),
            "samples": len(values),
            "distinct_hours": distinct_hours,
            "sufficient": enough,
        }
        if enough:
            # Free-flow travel time is TomTom's own and should be constant for a
            # segment; taking the median guards against a single odd response
            # shifting every index derived from it.
            row.update(_indices(values, percentile(free_flows[link_id], 0.5)))
        else:
            row["needs"] = _shortfall(len(values), distinct_hours)
        segments.append(row)

    return {
        "segments": segments,
        "sweeps_in_window": len(sweeps),
        **_method(),
    }


def by_corridor(link_corridors: dict[str, int], now: datetime | None = None) -> dict[str, Any]:
    """Reliability per corridor, summed across its segments within each sweep.

    Summing inside the sweep and then taking percentiles is deliberate. Taking
    percentiles per segment and adding them would assume every segment has its
    bad day simultaneously, which overstates the 95th percentile of an actual
    journey. This way the percentile is of a real traverse.

    The traverse is an approximation: the sampled segments are spread along the
    corridor but do not tile it end to end, so this is the reliability of the
    sampled portion and is reported as such.
    """
    sweeps = load_history(now)
    totals: dict[int, list[float]] = defaultdict(list)
    free_totals: dict[int, list[float]] = defaultdict(list)
    hours: dict[int, set[int]] = defaultdict(set)
    widths: dict[int, set[str]] = defaultdict(set)

    for sweep in sweeps:
        current_by_corridor: dict[int, float] = defaultdict(float)
        free_by_corridor: dict[int, float] = defaultdict(float)
        seen: dict[int, int] = defaultdict(int)
        for link_id, sample in sweep["readings"].items():
            corridor = link_corridors.get(str(link_id))
            if corridor is None:
                continue
            try:
                current, free_flow, confidence = (
                    float(sample[0]),
                    float(sample[1]),
                    float(sample[2]),
                )
            except (TypeError, ValueError, IndexError):
                continue
            if confidence < MIN_CONFIDENCE or current <= 0 or free_flow <= 0:
                continue
            current_by_corridor[corridor] += current
            free_by_corridor[corridor] += free_flow
            seen[corridor] += 1
            widths[corridor].add(str(link_id))
        for corridor, total in current_by_corridor.items():
            totals[corridor].append(total)
            free_totals[corridor].append(free_by_corridor[corridor])
            hours[corridor].add(sweep["at"].hour)

    corridors = []
    for corridor, values in sorted(totals.items()):
        distinct_hours = len(hours[corridor])
        enough = len(values) >= MIN_SAMPLES and distinct_hours >= MIN_DISTINCT_HOURS
        row: dict[str, Any] = {
            "corridor_id": corridor,
            "segments_sampled": len(widths[corridor]),
            "samples": len(values),
            "distinct_hours": distinct_hours,
            "sufficient": enough,
        }
        if enough:
            row.update(_indices(values, percentile(free_totals[corridor], 0.5)))
        else:
            row["needs"] = _shortfall(len(values), distinct_hours)
        corridors.append(row)

    return {
        "corridors": corridors,
        "sweeps_in_window": len(sweeps),
        "traverse_note": (
            "Sampled segments are spread along each corridor but do not tile it "
            "end to end. These indices describe the sampled portion of the "
            "journey, not the full corridor."
        ),
        **_method(),
    }


def _shortfall(samples: int, distinct_hours: int) -> str:
    missing = []
    if samples < MIN_SAMPLES:
        missing.append(f"{MIN_SAMPLES - samples} more sweeps")
    if distinct_hours < MIN_DISTINCT_HOURS:
        missing.append(f"{MIN_DISTINCT_HOURS - distinct_hours} more distinct hours of day")
    return " and ".join(missing)


def _method() -> dict[str, Any]:
    return {
        "method": {
            "buffer_index": "(95th percentile travel time - mean) / mean",
            "planning_time_index": "95th percentile travel time / free flow travel time",
            "travel_time_index": "mean travel time / free flow travel time",
            "source": "FHWA Travel Time Reliability measures",
            "window_days": WINDOW_DAYS,
            "min_samples": MIN_SAMPLES,
            "min_distinct_hours": MIN_DISTINCT_HOURS,
            "min_confidence": MIN_CONFIDENCE,
        },
        "gate_note": (
            "An index is withheld until it has both enough sweeps and enough "
            "distinct hours behind it. Forty samples from one afternoon describe "
            "that afternoon, not the road."
        ),
        "is_measured": True,
        "measured_note": (
            "Travel times are live TomTom readings above its confidence floor. "
            "No part of this is modelled or seeded."
        ),
    }
