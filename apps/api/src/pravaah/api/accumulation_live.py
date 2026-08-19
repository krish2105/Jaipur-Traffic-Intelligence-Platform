"""How many vehicles are inside each area, right now.

The question this closes
------------------------
It has been asked more than any other on this project, and until now the answer
was zero: `/areas` returned `vehicle_counts_available: false` and every thana
read `vehicles_per_hour: 0`, because a count needs a camera and there is no
camera feed.

There is now a live measured speed on 90 corridor links. This joins those speeds
to the road geometry, turns each one into a vehicle count with
`drishti.fundamental`, assigns it to a police station catchment, and sums.

An estimate is not a count, and this file will not pretend otherwise
--------------------------------------------------------------------
Every number here is inferred from a measured speed through a fitted model. It
carries a band, it is labelled `estimated`, and it is kept separate from the
`measured` fields rather than filling them in. The moment an estimate is written
into a field that used to mean "a camera saw this", the platform's whole
argument about probe products stops being true of itself.

The threshold is the part that makes it actionable
--------------------------------------------------
An accumulation on its own is trivia. The Macroscopic Fundamental Diagram gives
it a meaning: below a critical accumulation an area absorbs more vehicles, above
it every further vehicle *reduces* how many get through. So the useful output is
not "8,400 vehicles" but "8,400 against a critical 6,900, and here are the four
gates to hold".

Critical accumulation is computed over exactly the links that contributed an
estimate, never over the whole catchment. Summing vehicles on ten links and
dividing by the capacity of fifty would make every area look permanently clear.

Perimeter control stays advisory
--------------------------------
The gates this names are a recommendation for an officer to approve, in the same
way signal timing is. Nothing here actuates anything (CLAUDE.md prohibitions).
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

from pravaah.drishti import fundamental as fd

from . import probe


def _load(*parts: str) -> dict[str, Any]:
    """Read a JSON file by walking up from this module, as the seed loader does."""
    for directory in Path(__file__).resolve().parents:
        candidate = directory.joinpath(*parts)
        if candidate.exists():
            try:
                loaded = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return {}
            return loaded if isinstance(loaded, dict) else {}
    return {}


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = (math.radians(x) for x in (a[0], a[1], b[0], b[1]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def _stations(areas: dict[str, Any]) -> list[tuple[str, float, float]]:
    out = []
    for thana in areas.get("thanas") or []:
        station = thana.get("station")
        if station and thana.get("name"):
            out.append((str(thana["name"]), float(station["lon"]), float(station["lat"])))
    return out


def live(at: datetime | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Estimated accumulation per police station catchment.

    Empty when no sweep is fresh. That is deliberate: a stale accumulation is
    worse than none, because an area that cleared twenty minutes ago would still
    be shown saturated and someone might hold a cordon on it.
    """
    geometry = (_load("data", "probe", "segments.json").get("link_points")) or {}
    areas = _load("apps", "web", "src", "data", "areas.json")
    stations = _stations(areas)
    readings = probe.readings(at, now)

    if not (geometry and stations and readings):
        return {
            "areas": [],
            "available": False,
            "reason": (
                "No fresh probe sweep, or the network cache is missing. An area "
                "with a stale accumulation is worse than one with none."
            ),
            **_method(),
        }

    # Nearest station wins, which is the same Voronoi-equivalent rule the cordon
    # plan uses. Sharing the rule matters: an accumulation assigned by one
    # boundary and a gate list drawn by another would not describe one area.
    buckets: dict[str, dict[str, Any]] = {}
    for link_id, meta in geometry.items():
        reading = readings.get(link_id)
        if reading is None or not reading.get("is_measured"):
            continue
        estimate = fd.density_from_speed(
            float(reading["speed_kmh"]),
            float(reading["free_flow_kmh"]),
            lanes=int(meta.get("lanes") or 2),
            length_km=float(meta.get("length_km") or 0.0),
        )
        if estimate is None:
            continue
        point = (float(meta["lon"]), float(meta["lat"]))
        name = min(stations, key=lambda s: _haversine_km(point, (s[1], s[2])))[0]
        bucket = buckets.setdefault(
            name,
            {"vehicles": 0.0, "low": 0.0, "high": 0.0, "links": [], "clamped": 0, "lane_km": 0.0},
        )
        bucket["vehicles"] += estimate.vehicles
        bucket["low"] += estimate.vehicles_low
        bucket["high"] += estimate.vehicles_high
        bucket["lane_km"] += int(meta.get("lanes") or 2) * float(meta.get("length_km") or 0.0)
        bucket["links"].append(
            {
                "link_id": int(link_id),
                "name": meta.get("name"),
                "vehicles": round(estimate.vehicles, 1),
                "saturation": round(estimate.saturation, 2),
                "regime": estimate.regime,
                "speed_kmh": float(reading["speed_kmh"]),
            }
        )
        if not estimate.within_model_range:
            bucket["clamped"] += 1

    out = []
    for name, bucket in sorted(buckets.items()):
        # Capacity of exactly the links that contributed, never of the whole
        # catchment. Dividing ten links of traffic by fifty links of capacity
        # would show every area permanently clear.
        critical = fd.critical_accumulation(
            [(1, bucket["lane_km"])]  # lane_km already folds lanes in
        )
        saturation = bucket["vehicles"] / critical if critical > 0 else 0.0
        worst = max(bucket["links"], key=lambda link: link["saturation"], default=None)
        out.append(
            {
                "area": name,
                "kind": "thana_catchment",
                "vehicles_estimated": round(bucket["vehicles"]),
                "vehicles_low": round(bucket["low"]),
                "vehicles_high": round(bucket["high"]),
                "critical_accumulation": round(critical),
                "saturation": round(saturation, 2),
                "regime": fd.regime_for(saturation),
                "links_estimated": len(bucket["links"]),
                "lane_km_seen": round(bucket["lane_km"], 2),
                # How many links were so slow the clamp, not the model, answered.
                "links_clamped": bucket["clamped"],
                "worst_link": worst,
                "gates": _gates(areas, name),
            }
        )

    out.sort(key=lambda a: -a["saturation"])
    return {
        "areas": out,
        "available": True,
        "observed_at": probe.coverage().get("captured_at"),
        "areas_with_estimate": len(out),
        "areas_total": len(stations),
        "coverage_note": (
            "Only catchments containing a sampled corridor link get an estimate. "
            "The rest are unmeasured, which is not the same as clear."
        ),
        **_method(),
    }


def _gates(areas: dict[str, Any], name: str) -> dict[str, Any] | None:
    """The boundary links for this catchment, from the existing cordon plan."""
    for row in areas.get("cordon_plan") or []:
        if row.get("area") == name:
            return {
                "cordon_links": row.get("cordon_links"),
                "note": "Advisory. Holding inflow is an officer's decision, not the model's.",
            }
    return None


def _method() -> dict[str, Any]:
    method = dict(fd.method())
    method["accumulation"] = (
        "Sum of per-link estimates inside a police station catchment, assigned "
        "by nearest station, which is the same rule the cordon plan uses."
    )
    method["critical_accumulation"] = (
        "Critical density times the lane-km that actually contributed an "
        "estimate, so the ratio compares like with like."
    )
    method["actuation"] = "Advisory only. An officer approves any inflow restriction."
    return {"method": method, "is_synthetic": False, "provenance": "estimated"}
