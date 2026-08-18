"""OpenStreetMap / Overpass adapter — the real Jaipur road network.

docs/05 §4: every government-facing integration sits behind an adapter with a
file-replay implementation first and a live one as a swappable second. The
demo runs on replay, so `docker`-free, network-free operation is the default and
the live fetch is an explicit refresh step.

This one is not a government system, but the same rule earns its keep: Overpass
is rate-limited and occasionally down, and a pitch demo must never depend on it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

# Overpass rejects requests without a descriptive User-Agent (406), and the
# main instance is frequently rate-limited. Mirrors are tried in order.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
DEFAULT_OVERPASS = OVERPASS_ENDPOINTS[0]
USER_AGENT = "PRAVAAH/0.1 (Jaipur traffic decision intelligence; contact: krishna.mathur)"

# Tonk Road, Yaadgaar -> Sanganer. The state's own declared first "Model Traffic
# Corridor" from the April 2026 reform plan (docs/01 §3) — using it signals we
# read their plan. Bounding box covers the corridor plus a margin for the
# junctions that feed it.
TONK_ROAD_BBOX = (26.7550, 75.7700, 26.9150, 75.8450)  # S, W, N, E

_QUERY = """
[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]
     ({s},{w},{n},{e});
);
out body geom;
"""


@dataclass(frozen=True)
class OsmWay:
    osm_id: int
    name_en: str
    name_hi: str
    highway: str
    lanes: int | None
    oneway: bool
    maxspeed_kmh: float | None
    coordinates: list[tuple[float, float]]  # (lon, lat)

    @property
    def is_named(self) -> bool:
        return bool(self.name_en.strip())


class OsmAdapter:
    """Fetches from Overpass, or replays a cached extract.

    `mode="replay"` never touches the network — that is what lets the whole
    system come up with the cable pulled.
    """

    def __init__(
        self,
        cache_path: Path,
        *,
        mode: str = "replay",
        endpoint: str = DEFAULT_OVERPASS,
    ) -> None:
        self.cache_path = cache_path
        self.mode = mode
        self.endpoint = endpoint

    def fetch(self) -> list[OsmWay]:
        if self.mode == "replay":
            return self._from_cache()
        raw = self._from_overpass()
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        return self._parse(raw)

    def _from_cache(self) -> list[OsmWay]:
        if not self.cache_path.exists():
            msg = (
                f"No cached OSM extract at {self.cache_path}. "
                "Run scripts/fetch_osm.py once with network access."
            )
            raise FileNotFoundError(msg)
        return self._parse(json.loads(self.cache_path.read_text(encoding="utf-8")))

    def _from_overpass(self) -> dict[str, Any]:
        s, w, n, e = TONK_ROAD_BBOX
        query = _QUERY.format(s=s, w=w, n=n, e=e)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        endpoints = (self.endpoint, *[u for u in OVERPASS_ENDPOINTS if u != self.endpoint])
        errors: list[str] = []
        for url in endpoints:
            try:
                response = httpx.post(url, data={"data": query}, headers=headers, timeout=180.0)
                response.raise_for_status()
                return response.json()  # type: ignore[no-any-return]
            except (httpx.HTTPError, ValueError) as exc:
                errors.append(f"{url}: {type(exc).__name__} {exc}")
                continue
        msg = "every Overpass endpoint failed:\n  " + "\n  ".join(errors)
        raise RuntimeError(msg)

    @staticmethod
    def _parse(raw: dict[str, Any]) -> list[OsmWay]:
        ways: list[OsmWay] = []
        for element in raw.get("elements", []):
            if element.get("type") != "way" or "geometry" not in element:
                continue
            tags: dict[str, str] = element.get("tags", {})
            coords = [(p["lon"], p["lat"]) for p in element["geometry"]]
            if len(coords) < 2:
                continue
            ways.append(
                OsmWay(
                    osm_id=int(element["id"]),
                    name_en=tags.get("name:en") or tags.get("name", ""),
                    # OSM carries the Devanagari name on name:hi where it exists.
                    # Place names come from the database, never from translation
                    # files (docs/06 §5), so this is where the Hindi name enters.
                    name_hi=tags.get("name:hi") or tags.get("name", ""),
                    highway=tags.get("highway", "unclassified"),
                    lanes=_int_or_none(tags.get("lanes")),
                    oneway=tags.get("oneway") in {"yes", "true", "1"},
                    maxspeed_kmh=_float_or_none(tags.get("maxspeed")),
                    coordinates=coords,
                )
            )
        return ways


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value else None
    except ValueError:
        return None


def _float_or_none(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.split()[0])
    except (ValueError, IndexError):
        return None
