"""Area screening: how loaded is each part of Jaipur, right now.

The gap this closes
-------------------
Everything in the platform was keyed to a *link* (one road segment) or a
*corridor* (one road end to end). An officer looking at the map could see which
stretch was jammed, but could not ask the question a control room actually asks:
"how bad is Vaishali Nagar right now, and how much traffic is sitting in it?"

Two levels, because the department works at two levels
-----------------------------------------------------
**Thana catchment.** Each area is the part of the city closest to one police
station, built from the 25 real station coordinates in OpenStreetMap. Named
after an actual thana, so an officer recognises it without a legend.

**Commissionerate zone.** Jaipur East, West, North and South, which is how the
Commissioner assigns people. Each thana is placed in a zone by its bearing from
the walled city.

Neither is a gazetted boundary, and the output says so on every record. Police
jurisdiction polygons are not in open data anywhere: an Overpass query for
`boundary=police` over the Jaipur bbox returns zero. So this is the nearest
honest construction, and `boundary_basis` marks it as approximate so the real
shapefile can replace it the day the Commissionerate supplies one, without
anything downstream changing.

Why there are no polygons here
------------------------------
Aggregation does not need them. A link belongs to the area whose station is
nearest its midpoint, which is the same assignment a Voronoi diagram would give,
computed directly. Polygons would only be for drawing, and drawing the links
themselves coloured by area is both cheaper and more truthful, because the
measurement lives on the links rather than on the empty ground between them.

    uv run python scripts/build_areas.py
"""

from __future__ import annotations

import json
import math
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Final

OUT = Path("apps/web/src/data/areas.json")
#: Built against the local API, which holds all four corridors. The deployed
#: read API serves a snapshot captured for corridor 1 only, so building from it
#: would silently produce a one-corridor city and a single zone.
API: Final = os.environ.get("PRAVAAH_API", "http://localhost:8001") + "/api/v1"
UA: Final = {"User-Agent": "PRAVAAH-research/0.1 (Jaipur traffic research)"}

#: IRC:106-1990, urban roads. Same table the signal work uses.
PCU: Final[dict[str, float]] = {
    "2W": 0.5, "AUTO": 1.2, "ERIK": 1.2, "CAR": 1.0,
    "LCV": 1.4, "BUS": 2.2, "TRK2": 2.2, "NMV": 0.4,
    "TAXI": 1.0, "MBUS": 2.2, "TRKM": 3.0, "TRAC": 1.5,
}

#: The walled city. Zones are assigned by bearing from here, because that is how
#: Jaipur is actually described: north of the wall, south of the wall.
CENTRE: Final = (75.8235, 26.9239)

BBOX: Final = "26.75,75.65,27.05,75.95"


def fetch_stations() -> list[dict]:
    query = (
        f'[out:json][timeout:90];('
        f'node["amenity"="police"]({BBOX});'
        f'way["amenity"="police"]({BBOX});'
        f');out center tags;'
    )
    request = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers=UA,
    )
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
        data = json.loads(response.read())

    out = []
    for el in data.get("elements", []):
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        if lon is None or lat is None:
            continue
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("name:en")
        if not name:
            continue  # an unnamed point cannot be an area an officer recognises
        out.append({"name": name.strip(), "lon": float(lon), "lat": float(lat)})

    # Two mapped buildings for one station would split its catchment in half.
    seen: dict[str, dict] = {}
    for s in out:
        seen.setdefault(s["name"].lower(), s)
    return sorted(seen.values(), key=lambda s: s["name"])


def zone_of(lon: float, lat: float) -> str:
    """North, South, East or West of the walled city, by bearing.

    Four sectors split on the diagonals rather than the axes, so a station due
    north-east lands in one of them rather than on a boundary.
    """
    bearing = math.degrees(math.atan2(lon - CENTRE[0], lat - CENTRE[1])) % 360
    if bearing < 45 or bearing >= 315:
        return "Jaipur North"
    if bearing < 135:
        return "Jaipur East"
    if bearing < 225:
        return "Jaipur South"
    return "Jaipur West"


def fetch_links() -> list[dict]:
    """Every modelled link, from the live read API."""
    corridors = json.loads(_get(f"{API}/corridors"))
    links: list[dict] = []
    for c in corridors:
        try:
            scene = json.loads(_get(f"{API}/scene?corridor_id={c['corridor_id']}"))
        except Exception as exc:
            print(f"  corridor {c['corridor_id']} unavailable: {type(exc).__name__}")
            continue
        for link in scene.get("links", []):
            link["corridor_name"] = c["name"]["en"]
            links.append(link)
    return links


def _get(url: str) -> bytes:
    with urllib.request.urlopen(  # noqa: S310 — fixed host from PRAVAAH_API
        urllib.request.Request(url, headers=UA), timeout=90  # noqa: S310
    ) as response:
        return response.read()


def midpoint(coords: list[list[float]]) -> tuple[float, float] | None:
    if not coords:
        return None
    p = coords[len(coords) // 2]
    return float(p[0]), float(p[1])


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(
        (lon2 - lon1) / 2
    ) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def pcu_of(link: dict) -> float:
    """Flow converted to PCU, which is what road space is measured in."""
    flow = float(link.get("flow") or 0)
    mix = link.get("class_mix") or {}
    if not mix or flow <= 0:
        return flow
    total = sum(mix.values()) or 1
    return flow * sum((n / total) * PCU.get(c, 1.0) for c, n in mix.items())


def summarise(name: str, kind: str, members: list[dict], station: dict | None) -> dict:
    measured = [x for x in members if float(x.get("flow") or 0) > 0]
    congestion = [float(x.get("congestion_index") or 0) for x in members]
    vehicles = sum(float(x.get("flow") or 0) for x in members)
    pcu = sum(pcu_of(x) for x in members)
    worst = max(members, key=lambda x: float(x.get("congestion_index") or 0), default=None)

    return {
        "name": name,
        "kind": kind,
        "station": {"lon": station["lon"], "lat": station["lat"]} if station else None,
        "links": len(members),
        "links_measured": len(measured),
        "vehicles_per_hour": round(vehicles),
        "pcu_per_hour": round(pcu),
        "mean_congestion": round(sum(congestion) / len(congestion), 1) if congestion else 0.0,
        "max_congestion": round(max(congestion), 1) if congestion else 0.0,
        "worst_link": (
            {
                "link_id": worst.get("link_id"),
                "name": (worst.get("name") or {}).get("en"),
                "congestion_index": round(float(worst.get("congestion_index") or 0), 1),
                "speed_kmh": round(float(worst.get("speed_kmh") or 0), 1),
            }
            if worst
            else None
        ),
        # A mean over links with no counts behind them is a mean over models.
        "coverage": round(len(measured) / len(members), 2) if members else 0.0,
    }


def cordon(links: list[dict], stations: list[dict]) -> dict[str, list[dict]]:
    """Which links cross an area boundary, and therefore need a camera.

    This is the point of the whole exercise. Vehicles *inside* an area cannot be
    counted by instrumenting every road in it: that is a hundred cameras per
    thana and nobody is buying that. They are counted at the **cordon** by
    counting what enters and what leaves, and integrating. So the only roads
    that need a detector are the ones that cross the boundary.

    A link crosses a boundary when its two ends fall in different catchments.
    Assignment is by nearest station, so a link whose start is nearest thana A
    and whose end is nearest thana B is, by construction, a boundary crossing.

    The output turns "we need camera access" into a named list an official can
    approve or refuse: instrument these specific junctions, measure these
    specific areas.
    """
    def nearest(point: tuple[float, float]) -> str:
        return min(stations, key=lambda s: haversine(point, (s["lon"], s["lat"])))["name"]

    out: dict[str, list[dict]] = {}
    for link in links:
        coords = link.get("coordinates") or []
        if len(coords) < 2:
            continue
        a = nearest((float(coords[0][0]), float(coords[0][1])))
        b = nearest((float(coords[-1][0]), float(coords[-1][1])))
        if a == b:
            continue  # wholly inside one catchment, so it carries no flow across
        entry = {
            "link_id": link.get("link_id"),
            "name": (link.get("name") or {}).get("en"),
            "between": sorted([a, b]),
            "lanes": link.get("lanes"),
            "congestion_index": round(float(link.get("congestion_index") or 0), 1),
        }
        for area in (a, b):
            out.setdefault(area, []).append(entry)
    return out


def main() -> None:
    stations = fetch_stations()
    links = fetch_links()
    print(f"{len(stations)} named police stations, {len(links)} links\n")

    # Nearest-station assignment. This is the Voronoi cell without the geometry:
    # a link belongs to the area whose station is closest to its midpoint.
    by_station: dict[str, list[dict]] = {s["name"]: [] for s in stations}
    unassigned = 0
    for link in links:
        mid = midpoint(link.get("coordinates") or [])
        if not mid:
            unassigned += 1
            continue
        nearest = min(stations, key=lambda s: haversine(mid, (s["lon"], s["lat"])))
        by_station[nearest["name"]].append(link)

    station_index = {s["name"]: s for s in stations}
    thanas = [
        summarise(name, "thana_catchment", members, station_index[name])
        for name, members in by_station.items()
        if members
    ]
    thanas.sort(key=lambda a: a["mean_congestion"], reverse=True)

    # Zones, from the same assignment rolled up by bearing.
    by_zone: dict[str, list[dict]] = {}
    for name, members in by_station.items():
        s = station_index[name]
        by_zone.setdefault(zone_of(s["lon"], s["lat"]), []).extend(members)
    zones = [summarise(z, "commissionerate_zone", m, None) for z, m in by_zone.items() if m]
    zones.sort(key=lambda a: a["mean_congestion"], reverse=True)

    crossings = cordon(links, stations)
    # Cheapest first: an area with four boundary crossings is four cameras away
    # from being measurable, and that is where a pilot should start.
    plan = sorted(
        (
            {
                "area": name,
                "cordon_links": len(entries),
                "cameras_needed": len(entries),
                "unlocks": name,
                "links": entries,
            }
            for name, entries in crossings.items()
        ),
        key=lambda r: r["cordon_links"],
    )
    cumulative = 0
    for row in plan:
        cumulative += row["cordon_links"]
        row["cumulative_cameras"] = cumulative

    payload = {
        "cordon_plan": plan,
        "cordon_note": (
            "Vehicles inside an area are counted at its boundary, not on every "
            "road within it. These are the links that cross each catchment "
            "boundary: instrument them and that area's accumulation becomes "
            "measurable. cumulative_cameras reads down the list cheapest first, "
            "so a pilot can pick a budget and see what it buys."
        ),
        "zones": zones,
        "thanas": thanas,
        "stations_total": len(stations),
        "links_total": len(links),
        "links_unassigned": unassigned,
        "boundary_basis": (
            "Approximate, not gazetted. Police jurisdiction polygons are not in "
            "open data: an Overpass query for boundary=police over Jaipur returns "
            "zero. Each area is the set of links whose midpoint is nearest that "
            "station, which is the Voronoi cell computed directly. Zones roll "
            "those up by bearing from the walled city. Replace with the "
            "Commissionerate's own shapefile when supplied; nothing downstream "
            "changes."
        ),
        "pcu_source": "IRC:106-1990, urban roads",
        "coverage_note": (
            "coverage is the share of an area's links that carry measured counts. "
            "Congestion is modelled on the rest, so a low-coverage area is an "
            "estimate and the panel says so."
        ),
        # Stated because the headline number is currently zero and a reader
        # deserves to know why. `flow` is empty on the scene endpoint for these
        # links: only the instrumented ones ever carry a count, and the rest
        # carry a modelled congestion index with no vehicle total behind it.
        # The aggregation is correct; it has nothing to add up yet. Connect one
        # corridor's cameras and vehicles_per_hour fills in with no code change.
        "vehicle_counts_available": any(
            a["vehicles_per_hour"] > 0 for a in zones + thanas
        ),
        "vehicle_count_note": (
            "Congestion and worst-link are live for every area. Vehicle and PCU "
            "totals need measured counts, which exist only on instrumented "
            "links; until cameras are connected these read zero rather than "
            "being estimated."
        ),
        "is_synthetic": True,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False))

    print(f"{'ZONE':<16}{'links':>7}{'veh/h':>9}{'PCU/h':>9}{'cong':>7}{'cover':>7}")
    for z in zones:
        print(f"{z['name']:<16}{z['links']:>7}{z['vehicles_per_hour']:>9}"
              f"{z['pcu_per_hour']:>9}{z['mean_congestion']:>7}{z['coverage']:>7}")
    print("\ntop thana catchments by congestion:")
    for t in thanas[:6]:
        print(f"  {t['name'][:30]:<32}{t['mean_congestion']:>6}  {t['vehicles_per_hour']:>7} veh/h"
              f"  worst: {(t['worst_link'] or {}).get('name','-')}")
    print("\ncordon plan, cheapest area first:")
    print(f"  {'area':<34}{'cameras':>8}{'cumulative':>12}")
    for row in plan[:8]:
        print(f"  {row['area'][:32]:<34}{row['cameras_needed']:>8}{row['cumulative_cameras']:>12}")
    total = sum(r["cameras_needed"] for r in plan)
    print(f"\n  {len(plan)} areas measurable for {total} cordon cameras in total")
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
