"""Reference data: vehicle classes, corridors, the real road network, junctions
and cameras.

The network geometry is genuinely Jaipur's, pulled from OpenStreetMap. The
cameras and their accuracy certificates are synthetic and flagged as such, since
we have no feed from Abhay or the ICCC (docs/10 Tier-1 question 2).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import psycopg
from pravaah.adapters.osm import OsmAdapter
from pravaah.contracts.enums import PCU_FACTORS, VehicleClass

SEEDS = Path(__file__).resolve().parents[2] / "data" / "seeds"

# docs/04 §2 — twelve IRC-aligned classes. Hindi names are the ones a Rajasthan
# traffic engineer would actually use, not machine transliterations.
VEHICLE_CLASSES: list[tuple[str, str, str, bool, bool, int]] = [
    ("2W", "Two-wheeler", "दोपहिया", False, False, 1),
    ("AUTO", "Auto-rickshaw", "ऑटो-रिक्शा", False, True, 2),
    ("ERIK", "E-rickshaw", "ई-रिक्शा", False, True, 3),
    ("CAR", "Car / Jeep / Van", "कार / जीप / वैन", False, False, 4),
    ("TAXI", "Taxi", "टैक्सी", False, True, 5),
    ("LCV", "Light commercial", "हल्का व्यावसायिक वाहन", False, True, 6),
    ("BUS", "Bus", "बस", True, True, 7),
    ("MBUS", "Mini-bus", "मिनी बस", True, True, 8),
    ("TRK2", "Truck (2-axle)", "ट्रक (2-एक्सल)", True, True, 9),
    ("TRKM", "Truck (multi-axle)", "ट्रक (मल्टी-एक्सल)", True, True, 10),
    ("TRAC", "Tractor / farm", "ट्रैक्टर / कृषि वाहन", True, True, 11),
    ("NMV", "Non-motorised", "गैर-मोटर चालित", False, False, 12),
]

# The four corridors we instrument. Tonk Road is the state's own declared first
# Model Traffic Corridor (docs/01 §3) — using it signals we read their plan.
CORRIDORS: list[tuple[str, str, str, str, str, bool]] = [
    ("Tonk Road", "टोंक रोड", "Tonk", "Yaadgaar", "Sanganer", True),
    ("JLN Marg", "जेएलएन मार्ग", "JLN", "Rambagh", "Malviya Nagar", False),
    ("Ajmer Road", "अजमेर रोड", "Ajmer", "Civil Lines", "Kamla Nehru Nagar", False),
    ("Gopalpura Bypass", "गोपालपुरा बाईपास", "Gopalpura", "Tonk Phatak", "Durgapura", False),
]

# Eight junctions along the Tonk Road corridor (docs/05 §5). Real places, with
# the coordinates OSM gives them.
TONK_JUNCTIONS: list[tuple[str, str, float, float, int, str]] = [
    ("Yaadgaar", "यादगार", 75.8060, 26.9080, 4, "fixed"),
    ("Ram Niwas Bagh", "राम निवास बाग", 75.8135, 26.9052, 4, "atcs"),
    ("Tonk Phatak", "टोंक फाटक", 75.8020, 26.8830, 4, "atcs"),
    ("Gandhi Nagar Mor", "गांधी नगर मोड़", 75.8065, 26.8720, 3, "fixed"),
    ("Durgapura", "दुर्गापुरा", 75.7970, 26.8520, 4, "atcs"),
    ("Riddhi Siddhi", "ऋद्धि सिद्धि", 75.7905, 26.8380, 4, "fixed"),
    ("Sanganer Airport", "सांगानेर हवाई अड्डा", 75.8035, 26.8240, 3, "fixed"),
    ("Sanganer", "सांगानेर", 75.7930, 26.8125, 4, "manual"),
]


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(h))


def _capacity_pcu_hr(highway: str, lanes: int) -> float:
    """IRC-derived design capacity per hour. Urban arterial values."""
    per_lane = {"trunk": 1800, "primary": 1600, "secondary": 1400, "tertiary": 1100}
    return float(per_lane.get(highway, 1000) * max(1, lanes))


def _free_flow_kmh(highway: str, maxspeed: float | None) -> float:
    if maxspeed:
        return float(maxspeed)
    return {"trunk": 60.0, "primary": 50.0, "secondary": 45.0, "tertiary": 35.0}.get(highway, 30.0)


def seed(conn: psycopg.Connection) -> dict[str, int]:
    cur = conn.cursor()
    counts: dict[str, int] = {}

    # ── vehicle classes ─────────────────────────────────────────────────────
    cur.executemany(
        "INSERT INTO vehicle_classes"
        " (class_code, name_en, name_hi, pcu_factor, is_heavy, is_commercial, sort_order)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (class_code) DO NOTHING",
        [
            (code, en, hi, PCU_FACTORS[VehicleClass(code)], heavy, comm, order)
            for code, en, hi, heavy, comm, order in VEHICLE_CLASSES
        ],
    )
    counts["vehicle_classes"] = len(VEHICLE_CLASSES)

    # ── corridors ───────────────────────────────────────────────────────────
    corridor_ids: dict[str, int] = {}
    for name_en, name_hi, _key, frm, to, model in CORRIDORS:
        cur.execute(
            "INSERT INTO corridors (name_en, name_hi, from_node, to_node, is_model_corridor)"
            " VALUES (%s,%s,%s,%s,%s) RETURNING corridor_id",
            (name_en, name_hi, frm, to, model),
        )
        corridor_ids[name_en] = cur.fetchone()[0]  # type: ignore[index]
    counts["corridors"] = len(CORRIDORS)

    # ── road links, from the real OSM extract ───────────────────────────────
    ways = OsmAdapter(SEEDS / "osm_tonk_road.json", mode="replay").fetch()
    match_keys = {c[2].lower(): c[0] for c in CORRIDORS}
    rows: list[tuple[Any, ...]] = []
    for way in ways:
        if not way.is_named:
            continue
        corridor_id = None
        lowered = way.name_en.lower()
        for key, corridor_name in match_keys.items():
            if key in lowered:
                corridor_id = corridor_ids[corridor_name]
                break
        lanes = way.lanes or (3 if way.highway in ("trunk", "primary") else 2)
        length = sum(
            _haversine_m(way.coordinates[i], way.coordinates[i + 1])
            for i in range(len(way.coordinates) - 1)
        )
        if length < 25:  # discard slivers; they carry no useful measurement
            continue
        wkt = "LINESTRING(" + ",".join(f"{lon} {lat}" for lon, lat in way.coordinates) + ")"
        rows.append(
            (
                way.osm_id,
                way.name_en,
                # Only 8 of 1,484 OSM ways carry name:hi. Where it is absent we fall
                # back to the Latin name rather than machine-transliterating — a
                # wrong Devanagari place name is worse than an English one in front
                # of this audience. Corridor names above are curated and correct.
                way.name_hi or way.name_en,
                corridor_id,
                wkt,
                round(length, 2),
                lanes,
                "one_way" if way.oneway else "divided",
                _capacity_pcu_hr(way.highway, lanes),
                _free_flow_kmh(way.highway, way.maxspeed_kmh),
                way.highway in ("trunk", "primary"),
            )
        )
    with cur.copy(
        "COPY road_links (osm_id, name_en, name_hi, corridor_id, geom, length_m, lanes,"
        " carriageway, design_capacity_pcu_hr, free_flow_speed_kmh, has_median)"
        " FROM STDIN"
    ) as copy:
        for r in rows:
            copy.write_row(r)
    counts["road_links"] = len(rows)

    # ── junctions ───────────────────────────────────────────────────────────
    tonk = corridor_ids["Tonk Road"]
    junction_ids: list[int] = []
    for name_en, name_hi, lon, lat, approaches, signal in TONK_JUNCTIONS:
        cur.execute(
            "INSERT INTO junctions (name_en, name_hi, corridor_id, geom, approach_count,"
            " signal_type, atcs_enabled)"
            " VALUES (%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s,%s,%s)"
            " RETURNING junction_id",
            (name_en, name_hi, tonk, lon, lat, approaches, signal, signal == "atcs"),
        )
        junction_ids.append(cur.fetchone()[0])  # type: ignore[index]
    counts["junctions"] = len(junction_ids)

    # ── cameras ─────────────────────────────────────────────────────────────
    # Six, matching the pilot ask in docs/09 §2: "One corridor. Six existing
    # camera feeds." Synthetic, because no feed has been granted — and the
    # accuracy certificates carry measured-looking values that the UI must
    # render as provisional until real validation replaces them.
    cur.execute(
        "SELECT link_id FROM road_links WHERE corridor_id = %s ORDER BY length_m DESC LIMIT 6",
        (tonk,),
    )
    link_ids = [r[0] for r in cur.fetchall()]
    camera_rows = 0
    for idx, junction_id in enumerate(junction_ids[:6]):
        lon, lat = TONK_JUNCTIONS[idx][2], TONK_JUNCTIONS[idx][3]
        homography = {
            "matrix": [[1.42, 0.03, -318.0], [0.01, 1.87, -204.0], [0.0, 0.0009, 1.0]],
            "reference_points_px": [[210, 640], [1080, 640], [1180, 410], [140, 410]],
            "reference_points_m": [[0, 0], [12.0, 0], [12.0, 30.0], [0, 30.0]],
            "note": "synthetic calibration — replace with a real ground survey per camera",
        }
        cert = {
            "day_mape": 0.061,
            "night_mape": 0.138,
            "per_class": {"2W": 0.084, "CAR": 0.039, "AUTO": 0.058, "BUS": 0.021},
            "validated_on": None,
            "status": "provisional",
            "basis": "public Indian datasets (IDD, UA-DETRAC); not yet validated on Jaipur video",
        }
        cur.execute(
            "INSERT INTO cameras (external_ref, source_system, junction_id, link_id, geom,"
            " bearing_deg, homography, calibrated_at, roi_polygons, accuracy_cert, is_synthetic)"
            " VALUES (%s,'replay',%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326),"
            " %s,%s, now(), %s,%s, TRUE)",
            (
                f"PRAVAAH-TONK-{idx + 1:02d}",
                junction_id,
                link_ids[idx] if idx < len(link_ids) else None,
                lon,
                lat,
                [0, 180, 90, 270, 45, 225][idx],
                json.dumps(homography),
                json.dumps({"count_lines": [[[180, 520], [1140, 520]]], "zones": []}),
                json.dumps(cert),
            ),
        )
        camera_rows += 1
    counts["cameras"] = camera_rows

    conn.commit()
    return counts
