"""Jaipur's own city data, through the national exchange.

What this found
---------------
The plan called for an adapter written blind against a guessed ITMS schema.
It turned out not to be necessary. India Urban Data Exchange is the Smart Cities
Mission's data platform, built with IISc Bangalore, and its API specification is
approved by the Bureau of Indian Standards. Thirty-five cities publish to it.

Jaipur is one of them, and already publishes eleven resources. Two matter here:

    VCC System Locations in Jaipur City    Vehicle Classification Cameras
    ANPR Camera Locations in Jaipur City   Number plate recognition

Both carry a real data sample in the public catalogue:

    {"name": "VCC - Johari Bazar", "address": "Johari Bazar", "deviceCount": 1,
     "location": {"type": "Point", "coordinates": [75.825355, 26.917703]}}

That changes the ask. This platform has been saying "vehicle counts need cameras
Jaipur does not have". Jaipur has cameras that classify vehicles, their
positions are published on a national exchange under a Bureau of Indian
Standards API, and what is missing is a consumer token.

Two halves, deliberately separate
---------------------------------
The catalogue is open and needs no credential, so resource discovery works right
now and is not a promise. The data behind those resources is `SECURE` and needs
a token from the provider.

`discover()` therefore works today and `latest()` does not, and `/meta/sources`
is told the difference. "We can see that Jaipur publishes vehicle classification
cameras and cannot yet read them" is a more useful thing for a department to
hear than a single amber dot.

Locations are not counts
------------------------
The published resources are camera *positions*. A count stream would be a
sibling resource, and whether Jaipur publishes one is not answerable from the
open catalogue. So this adapter does not claim it can produce vehicle counts.
It claims it can reach the exchange, name what Jaipur publishes, and read
anything a token is granted for.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import httpx

#: Open. No credential, no registration, and the reason discovery works today.
CATALOGUE = "https://api.catalogue.iudx.org.in/iudx/cat/v1"

#: The instance name Jaipur is registered under.
INSTANCE = "jaipur"

#: Resources this platform would use if a token were granted, by catalogue id.
#: Recorded here so the ask in the pitch names something specific rather than
#: asking for "traffic data".
WANTED: dict[str, str] = {
    "38fc0178-0b17-42b2-ad83-948633263156": "VCC System Locations in Jaipur City",
    "4c6818cf-ed3d-4e55-b4db-f18612912e73": "ANPR Camera Locations in Jaipur City",
}


@dataclass(frozen=True)
class Resource:
    """One thing Jaipur publishes to the exchange."""

    id: str
    label: str
    description: str
    #: OPEN needs no token. SECURE needs one from the provider. None means the
    #: provider has not declared a policy, which is not the same as open.
    access_policy: str | None
    fields: tuple[str, ...]

    @property
    def needs_token(self) -> bool:
        return self.access_policy != "OPEN"


def api_token() -> str | None:
    token = os.environ.get("IUDX_TOKEN", "").strip()
    return token or None


def available() -> bool:
    """Whether the *data* side can run. Discovery does not need this."""
    return api_token() is not None


_CHECKED_AT: float = 0.0
_REACHABLE: bool | None = None
_TTL_SECONDS = 600


async def catalogue_reachable(*, client: httpx.AsyncClient | None = None) -> bool:
    """Whether the exchange itself answers. Cached, and needs no credential.

    Worth checking separately from the token: an exchange that is up and a
    resource we may not read is a completely different conversation from an
    exchange nobody can reach.
    """
    global _CHECKED_AT, _REACHABLE
    now = time.monotonic()
    if _REACHABLE is not None and (now - _CHECKED_AT) < _TTL_SECONDS:
        return _REACHABLE
    _CHECKED_AT = now
    _REACHABLE = bool(await discover(client=client))
    return _REACHABLE


async def verified(*, client: httpx.AsyncClient | None = None) -> bool:
    """Whether we can actually read secure data, not merely see that it exists."""
    if not available():
        return False
    for resource_id in WANTED:
        if await latest(resource_id, client=client) is not None:
            return True
    return False


async def discover(*, client: httpx.AsyncClient | None = None) -> list[Resource]:
    """Everything Jaipur publishes. Open catalogue, no token, works today.

    Empty on any failure rather than raising: a readiness panel asking what a
    city publishes should degrade to "could not ask" and not to a 500.
    """
    owned = client is None
    http = client or httpx.AsyncClient(timeout=20.0, follow_redirects=True)
    try:
        response = await http.get(
            f"{CATALOGUE}/search",
            params={"property": "[instance]", "value": f"[[{INSTANCE}]]"},
        )
        if response.status_code != 200:
            return []
        results = response.json().get("results") or []
    except (httpx.HTTPError, ValueError, KeyError):
        return []
    finally:
        if owned:
            await http.aclose()

    out = []
    for item in results:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        descriptor = item.get("dataDescriptor") or {}
        fields = tuple(
            k
            for k in descriptor
            if not k.startswith("@") and k not in {"type", "dataDescriptorLabel", "description"}
        )
        out.append(
            Resource(
                id=str(item["id"]),
                label=str(item.get("label") or ""),
                description=str(item.get("description") or ""),
                access_policy=item.get("accessPolicy"),
                fields=fields,
            )
        )
    return out


async def latest(
    resource_id: str, *, client: httpx.AsyncClient | None = None
) -> list[dict[str, object]] | None:
    """Current data for one resource, or None if we cannot read it.

    None covers every failure on purpose: no token, a token the provider has not
    granted for this resource, an exchange outage. They are all "no data" to a
    caller, and the readiness panel is where the difference gets explained.
    """
    token = api_token()
    if token is None:
        return None

    owned = client is None
    http = client or httpx.AsyncClient(timeout=20.0, follow_redirects=True)
    try:
        # The resource server is per-provider and is named in the catalogue
        # entry, so it is looked up rather than hardcoded to one host.
        item = await http.get(f"{CATALOGUE}/item", params={"id": resource_id})
        if item.status_code != 200:
            return None
        results = item.json().get("results") or []
        if not results:
            return None
        server = results[0].get("resourceServerRegURL") or "rs.iudx.org.in"

        response = await http.get(
            f"https://{server}/ngsi-ld/v1/entities",
            params={"id": resource_id},
            headers={"token": token},
        )
        if response.status_code != 200:
            return None
        payload = response.json().get("results")
        return payload if isinstance(payload, list) else None
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if owned:
            await http.aclose()


def needs() -> str:
    """What is actually missing, in words a department can act on."""
    if api_token() is None:
        return (
            "IUDX_TOKEN — a consumer token for the Jaipur instance. The camera "
            "locations are already published; only read access is missing."
        )
    return "IUDX_TOKEN present but the provider has not granted these resources"
