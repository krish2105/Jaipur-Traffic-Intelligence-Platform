"""Live probe speeds, as read from disk by the API.

`scripts/fetch_probe_speeds.py` writes the file; this reads it. Keeping the
fetch in a script and the read in the API means a TomTom outage, a rate limit or
an expired key can never take a request down: the worst case is that no reading
is fresh and every link stays modelled, which is the honest answer anyway.

Freshness is the whole safety property
--------------------------------------
A speed is a claim about *now*. The sweep runs every 45 minutes, so a reading is
usable for 90 — two cadences, which tolerates one missed sweep and no more.
Past that the file still parses and the numbers still look plausible, which is
exactly why the limit is enforced here rather than trusted to whoever runs the
cron.

Scrubbing the timeline must not pick these up
---------------------------------------------
The console can ask for the scene at any moment in the seeded 90 days. A probe
reading taken this afternoon says nothing about 14 March, so it is offered only
when the caller is asking about now. Applying it to a historical timestamp would
put a real number on a moment it never described.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

#: Two sweeps at the 45-minute cadence. One missed sweep is tolerated; two is a
#: signal that something is wrong, and stale is worse than modelled.
MAX_AGE = timedelta(minutes=90)


def _find(name: str) -> Path | None:
    """Locate a probe file by walking up, as the seed loader does.

    Counting `parents[n]` breaks the moment the package moves or a deployment
    flattens the tree.
    """
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "data" / "probe" / name
        if candidate.exists():
            return candidate
    return None


def _load(name: str) -> dict[str, Any]:
    path = _find(name)
    if path is None:
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        # A half-written file during a sweep is not worth a 500. Callers treat
        # an empty payload as "no probe data", which is a state they handle.
        return {}
    return loaded if isinstance(loaded, dict) else {}


def age(payload: dict[str, Any], now: datetime | None = None) -> timedelta | None:
    stamp = payload.get("captured_at")
    if not stamp:
        return None
    try:
        captured = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    if captured.tzinfo is None:
        captured = captured.replace(tzinfo=UTC)
    return (now or datetime.now(UTC)) - captured


def readings(at: datetime | None = None, now: datetime | None = None) -> dict[str, dict[str, Any]]:
    """Per-link probe readings that may be used right now, keyed by link id.

    Empty when the caller is asking about a past moment, when the file is
    missing, or when the sweep is more than `MAX_AGE` old. Each of those is a
    reason to leave a link modelled rather than to reach for the nearest number.
    """
    if at is not None:
        # Asking about a specific moment. Only honour the probe if that moment
        # is effectively now — the console passes `at` even for the live view.
        moment = at if at.tzinfo else at.replace(tzinfo=UTC)
        if abs((now or datetime.now(UTC)) - moment) > MAX_AGE:
            return {}

    payload = _load("speeds.json")
    how_old = age(payload, now)
    if how_old is None or how_old > MAX_AGE:
        return {}
    links = payload.get("links")
    return links if isinstance(links, dict) else {}


def coverage() -> dict[str, Any]:
    """What the probe layer currently covers, for the readiness panel.

    Reports segments as well as links, because several links share one TomTom
    segment and counting links alone would overstate how many independent
    measurements exist.
    """
    speeds = _load("speeds.json")
    segments = _load("segments.json")
    how_old = age(speeds)
    sample = speeds.get("sample") or {}
    budget = speeds.get("budget") or {}
    fresh = how_old is not None and how_old <= MAX_AGE
    return {
        "provider": speeds.get("provider"),
        "measures": speeds.get("measures"),
        "captured_at": speeds.get("captured_at"),
        "age_minutes": round(how_old.total_seconds() / 60, 1) if how_old else None,
        "max_age_minutes": round(MAX_AGE.total_seconds() / 60),
        "is_fresh": fresh,
        "cadence_minutes": speeds.get("cadence_minutes"),
        "window_ist": speeds.get("window_ist"),
        "segments_read": sample.get("segments_read"),
        "segments_known": sample.get("segments_known"),
        "links_covered": sample.get("links_covered"),
        "corridor_links": sample.get("corridor_links"),
        "measured_segments": speeds.get("measured_segments"),
        "discovery": {
            "discovered_at": segments.get("discovered_at"),
            "links": segments.get("links"),
            "distinct_segments": segments.get("distinct_segments"),
            "calls_spent": segments.get("calls_spent"),
        },
        "budget": budget,
        "note": (
            "TomTom measures speed and delay. It cannot measure volume or "
            "composition, so a probe reading replaces a modelled speed and "
            "never becomes a vehicle count or a class mix."
        ),
    }
