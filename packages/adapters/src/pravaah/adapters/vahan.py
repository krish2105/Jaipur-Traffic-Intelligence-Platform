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

The resource id is configuration
--------------------------------
data.gov.in publishes VAHAN extracts as separately-identified resources that are
re-issued rather than versioned in place. Hardcoding one guarantees a silent
break, so it is an environment variable with a documented default, and a wrong
or retired id degrades to None rather than to a wrong number.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import httpx

ENDPOINT = "https://api.data.gov.in/resource/{resource_id}"

#: Overridable, because data.gov.in re-issues these rather than versioning them.
DEFAULT_RESOURCE = "cf0e6a0e-1b0d-4a1f-9d4a-2f2b0d1e1f00"

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


def resource_id() -> str:
    return os.environ.get("VAHAN_RESOURCE_ID", "").strip() or DEFAULT_RESOURCE


def available() -> bool:
    """Whether this adapter can run: a key exists AND this code exists.

    Routed through here by `/meta/sources` so a credential on its own can no
    longer turn the badge green with nothing behind it.
    """
    return api_key() is not None


async def fleet(
    district: str = "Jaipur", *, client: httpx.AsyncClient | None = None
) -> FleetMix | None:
    """Registered fleet composition for a district, or None if unavailable.

    None on any failure, deliberately. A wrong composition is worse than a
    missing one: it would flow straight into the severity model and the PCU
    conversion and change a recommendation without anyone noticing.
    """
    key = api_key()
    if key is None:
        return None

    owned = client is None
    http = client or httpx.AsyncClient(timeout=20.0)
    try:
        response = await http.get(
            ENDPOINT.format(resource_id=resource_id()),
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
            source=f"data.gov.in resource {resource_id()}",
        )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if owned:
            await http.aclose()
