"""Registered fleet composition for Jaipur, from data.gov.in.

Why this matters more than it looks
-----------------------------------
The whole severity argument turns on one number: Jaipur's fleet being about 61%
two-wheelers. That figure currently comes from published Rajasthan-wide
registration data, which is real and citable and also neither Jaipur-specific
nor current. VAHAN through data.gov.in makes it both.

It is a cross-check, not a measurement of traffic
-------------------------------------------------
Registrations tell you what is *owned* in a district. Cameras tell you what is
*on the road at 18:00*, which is a different distribution: a scooter is driven
daily, a tractor is not. So this is used to sanity-check measured class mix and
to fill the gap while no camera feed exists. Presenting a registration share as
a traffic share would be exactly the kind of substitution this project accuses
probe products of.

The resource id is configuration, with no default
------------------------------------------------
data.gov.in publishes VAHAN extracts as separately-identified resources that are
re-issued rather than versioned in place, so hardcoding one guarantees a silent
break. It is `VAHAN_RESOURCE_ID`, and there is deliberately no fallback: this
module used to ship a plausible-looking UUID as a default, which is worse than
nothing. A resource id that does not resolve fails as a 403, which is exactly
what a rejected key looks like, so the default would have sent whoever was
debugging it to the wrong problem. No id now means the adapter reports itself
unavailable and says which piece is missing.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import httpx

ENDPOINT = "https://api.data.gov.in/resource/{resource_id}"

#: VAHAN's own class names to the platform's twelve. Anything unmapped is
#: dropped rather than bucketed into "other", because a silent catch-all is how
#: a composition figure quietly stops meaning what it says.
CLASS_MAP: dict[str, str] = {
    "TWO WHEELER(NT)": "2W",
    "TWO WHEELER(T)": "2W",
    "MOTOR CYCLE": "2W",
    "MOTOR CAR": "CAR",
    "LIGHT MOTOR VEHICLE": "CAR",
    "THREE WHEELER(T)": "AUTO",
    "THREE WHEELER(NT)": "AUTO",
    "E-RICKSHAW(P)": "ERIK",
    "LIGHT GOODS VEHICLE": "LCV",
    "BUS": "BUS",
    "OMNI BUS": "MBUS",
    "HEAVY GOODS VEHICLE": "TRK2",
    "HEAVY MOTOR VEHICLE": "TRKM",
    "AGRICULTURAL TRACTOR": "TRAC",
    "MOTOR CAB": "TAXI",
}


@dataclass(frozen=True)
class FleetMix:
    """Registered vehicles by platform class, for one district."""

    district: str
    counts: dict[str, int]
    total: int
    unmapped: int
    source: str

    @property
    def shares(self) -> dict[str, float]:
        if self.total <= 0:
            return {}
        return {k: v / self.total for k, v in self.counts.items()}

    @property
    def two_wheeler_share(self) -> float:
        """The figure the severity model and the PCU argument both rest on."""
        return self.shares.get("2W", 0.0)

    @property
    def coverage(self) -> float:
        """Share of rows that mapped to a known class.

        Reported because a mapping that silently drops a third of the fleet
        produces a confident, wrong composition.
        """
        seen = self.total + self.unmapped
        return self.total / seen if seen else 0.0


def api_key() -> str | None:
    key = os.environ.get("DATA_GOV_IN_API_KEY", "").strip()
    return key or None


def resource_id() -> str | None:
    """Which data.gov.in resource to read, or None if it has not been chosen."""
    return os.environ.get("VAHAN_RESOURCE_ID", "").strip() or None


def available() -> bool:
    """Whether this adapter can run: key, resource id, AND this code.

    Routed through here by `/meta/sources` so a credential on its own can no
    longer turn the badge green with nothing behind it. The resource id counts
    as a credential for this purpose: a key with nowhere to point it reads
    exactly like a refused key at the upstream, and the panel should say which
    of the two is actually missing.
    """
    return api_key() is not None and resource_id() is not None


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
    """One real call for Jaipur. Also catches a retired resource id."""
    return await fleet("Jaipur", client=client) is not None


async def fleet(
    district: str = "Jaipur", *, client: httpx.AsyncClient | None = None
) -> FleetMix | None:
    """Registered fleet composition for a district, or None if unavailable.

    None on any failure, deliberately. A wrong composition is worse than a
    missing one: it would flow straight into the severity model and the PCU
    conversion and change a recommendation without anyone noticing.
    """
    key = api_key()
    resource = resource_id()
    if key is None or resource is None:
        return None

    owned = client is None
    http = client or httpx.AsyncClient(timeout=20.0)
    try:
        response = await http.get(
            ENDPOINT.format(resource_id=resource),
            params={
                "api-key": key,
                "format": "json",
                "limit": "1000",
                "filters[district]": district,
            },
        )
        if response.status_code != 200:
            return None
        records = response.json().get("records") or []
        if not records:
            return None

        counts: dict[str, int] = {}
        unmapped = 0
        for row in records:
            raw = str(row.get("vehicle_class") or row.get("vehicleclass") or "").upper().strip()
            n = row.get("count") or row.get("total") or row.get("value") or 0
            try:
                n = int(float(n))
            except (TypeError, ValueError):
                continue
            cls = CLASS_MAP.get(raw)
            if cls is None:
                unmapped += n
                continue
            counts[cls] = counts.get(cls, 0) + n

        total = sum(counts.values())
        if total <= 0:
            return None
        return FleetMix(
            district=district,
            counts=counts,
            total=total,
            unmapped=unmapped,
            source=f"data.gov.in resource {resource}",
        )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if owned:
            await http.aclose()
