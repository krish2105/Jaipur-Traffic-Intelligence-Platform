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

import asyncio
import os
import time
from collections.abc import Sequence
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
    #: Fingerprint of the road segment TomTom actually matched, from the first
    #: and last coordinate it returns. Two of our links can sit on one TomTom
    #: segment — adjacent links on the same arterial routinely do — and without
    #: this they look like two independent measurements when they are one
    #: reading counted twice. Empty when the response carried no geometry.
    segment_key: str = ""

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


#: TomTom rate-limits per second as well as per month. Four at a time keeps a
#: twenty-link sweep under a second of wall clock without ever tripping it.
_CONCURRENCY = 4


async def flow_many(
    points: Sequence[tuple[str, float, float]],
    *,
    client: httpx.AsyncClient | None = None,
    concurrency: int = _CONCURRENCY,
) -> dict[str, FlowSegment | None]:
    """Flow for many points at once, keyed by the caller's own id.

    One connection pool and a small semaphore, rather than a loop of one-shot
    clients: a twenty-link sweep is twenty TLS handshakes otherwise, and the
    free tier is small enough that every call should be deliberate.

    A point that fails maps to None rather than dropping out of the result. The
    caller needs to tell "this link was not asked about" from "this link was
    asked about and had nothing to say" — they mean different things on a map.
    """
    owned = client is None
    http = client or httpx.AsyncClient(timeout=15.0)
    gate = asyncio.Semaphore(max(1, concurrency))

    async def one(key: str, lat: float, lon: float) -> tuple[str, FlowSegment | None]:
        async with gate:
            return key, await flow_at(lat, lon, client=http)

    try:
        results = await asyncio.gather(*(one(k, la, lo) for k, la, lo in points))
        return dict(results)
    finally:
        if owned:
            await http.aclose()


def _segment_key(segment: dict[str, object]) -> str:
    """A stable id for the road segment TomTom matched, from its own geometry.

    The v4 response has no segment id and no OpenLR code, but it does return the
    matched geometry, and its endpoints are stable between calls. Rounded to
    five decimal places, which is about a metre: finer than that and floating
    point noise would split one segment into two.
    """
    coords = segment.get("coordinates")
    points = coords.get("coordinate") if isinstance(coords, dict) else None
    if not points:
        return ""
    first, last = points[0], points[-1]
    return (
        f"{first['latitude']:.5f},{first['longitude']:.5f}"
        f"->{last['latitude']:.5f},{last['longitude']:.5f}"
    )


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
            segment_key=_segment_key(segment),
        )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if owned:
            await http.aclose()
