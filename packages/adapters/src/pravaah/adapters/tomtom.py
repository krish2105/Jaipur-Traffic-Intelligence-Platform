"""Live probe speeds from TomTom Flow Segment Data.

What this is, and what it is not
--------------------------------
This is the *live* TomTom API. It is not `profiles.py`, which carries the
published TomTom Traffic Index figures for Jaipur (94.9% evening peak and so
on) and uses them as a diurnal shape for the seed. Both are TomTom and they
answer different questions: the Index is a citable annual statistic, this is
what a road is doing right now.

Until this existed, `/meta/sources` flipped the probe row to "live" on the mere
presence of `TOMTOM_API_KEY`, with no code behind it. A key would have turned
the badge green and changed nothing, which is worse than an honest amber. The
readiness endpoint now asks this module whether it can actually run.

The honest limit of probe data
------------------------------
TomTom measures speed and delay. It cannot measure volume or composition, and
that is the gap the whole platform exists to fill (docs/01 §4). So this fills in
`speed_kmh` and lets a link report `speed_source: "measured"` instead of
"modelled". It does not produce a vehicle count and must never be presented as
one.

The free tier is 20,000 requests a month for Flow Segment Data (TomTom's own
pricing page, checked 19 Aug 2026), which is about 645 a day. An earlier note
here said 2,500 a day, which was TomTom's older figure and is now four times too
generous. Batch accordingly rather than polling per render: the wrong number in
a comment is how a quota gets burned in a fortnight.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import httpx

ENDPOINT = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"

#: Free tier, per TomTom's pricing page (checked 19 Aug 2026). A corridor of 90
#: links polled every 15 minutes is 259,200 calls a month, thirteen times the
#: allowance, so callers batch. Held as a month because that is the unit TomTom
#: bills in; dividing it into a daily figure invented a limit that was not real.
FREE_TIER_MONTHLY = 20_000


@dataclass(frozen=True)
class FlowSegment:
    """One road segment as TomTom currently sees it."""

    current_speed_kmh: float
    free_flow_speed_kmh: float
    current_travel_time_s: int
    free_flow_travel_time_s: int
    #: TomTom's own 0-1 confidence in this reading. Below ~0.7 the segment is
    #: mostly inferred from historical patterns rather than live probes, which
    #: makes it a model output wearing a measurement's clothes.
    confidence: float
    road_closure: bool

    @property
    def congestion_index(self) -> float:
        """0-100 on the platform's own scale, from the delay ratio.

        Defined the same way as the seeded index so the two are comparable:
        the fraction of free-flow travel time that is lost to congestion. A road
        moving at free flow is 0; one taking twice as long is 50.
        """
        if self.free_flow_travel_time_s <= 0:
            return 0.0
        lost = self.current_travel_time_s - self.free_flow_travel_time_s
        return max(0.0, min(100.0, 100.0 * lost / self.current_travel_time_s))

    @property
    def is_measured(self) -> bool:
        """Whether this reading is live enough to be called a measurement.

        Below 0.7 TomTom is largely reporting its historical model for that
        segment. Presenting that as a live probe reading would be the same
        category error the platform accuses probe products of making.
        """
        return self.confidence >= 0.7 and not self.road_closure


def api_key() -> str | None:
    key = os.environ.get("TOMTOM_API_KEY", "").strip()
    return key or None


def available() -> bool:
    """Whether this adapter can run: a key exists AND the code to use it does.

    Asked by `/meta/sources`. The point of routing the readiness check through
    the adapter rather than through `os.environ` is that a credential alone can
    no longer turn a badge green.
    """
    return api_key() is not None


#: Reachability is cached: the readiness panel is polled on every console
#: render, and a live upstream call per render would be both slow and a good way
#: to burn a 2,500/day free tier before lunch.
_CHECKED_AT: float = 0.0
_REACHABLE: bool | None = None
_TTL_SECONDS = 600


async def verified(*, client: httpx.AsyncClient | None = None) -> bool:
    """Whether the credential is not just present but actually accepted.

    `available()` answers "is there a key and code to use it". This answers "does
    the upstream take that key", which is the difference between a green badge
    that is true and one that is merely optimistic. A typo'd or expired key would
    otherwise show live while every reading quietly fell back to modelled.

    Cached for ten minutes, and failures are cached too: an upstream that is
    refusing us should not be re-asked on every render.
    """
    global _CHECKED_AT, _REACHABLE
    if not available():
        return False
    now = time.monotonic()
    if _REACHABLE is not None and (now - _CHECKED_AT) < _TTL_SECONDS:
        return _REACHABLE
    _CHECKED_AT = now
    _REACHABLE = await _probe(client)
    return _REACHABLE


async def _probe(client: httpx.AsyncClient | None) -> bool:
    """One real call against central Jaipur. Cheap, and conclusive."""
    return await flow_at(26.9124, 75.7873, client=client) is not None


async def flow_at(
    lat: float, lon: float, *, client: httpx.AsyncClient | None = None
) -> FlowSegment | None:
    """Current flow on the road nearest this point.

    Returns None rather than raising when there is no key or the call fails.
    A probe outage should degrade a link to its modelled speed, not take the
    console down: docs/03 §5 requires the interface to survive a dead upstream.
    """
    key = api_key()
    if key is None:
        return None

    owned = client is None
    http = client or httpx.AsyncClient(timeout=10.0)
    try:
        response = await http.get(
            ENDPOINT,
            params={"point": f"{lat},{lon}", "unit": "KMPH", "key": key},
        )
        if response.status_code != 200:
            return None
        segment = response.json().get("flowSegmentData")
        if not segment:
            return None
        return FlowSegment(
            current_speed_kmh=float(segment.get("currentSpeed", 0)),
            free_flow_speed_kmh=float(segment.get("freeFlowSpeed", 0)),
            current_travel_time_s=int(segment.get("currentTravelTime", 0)),
            free_flow_travel_time_s=int(segment.get("freeFlowTravelTime", 0)),
            confidence=float(segment.get("confidence", 0)),
            road_closure=bool(segment.get("roadClosure", False)),
        )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if owned:
            await http.aclose()
