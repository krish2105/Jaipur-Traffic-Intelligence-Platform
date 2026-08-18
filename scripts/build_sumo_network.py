"""Build the Tonk Road SUMO network and demand from the measured warehouse.

    uv run python scripts/build_sumo_network.py [--hour 19]

Geometry comes from `road_links` (real OpenStreetMap), demand from
`traffic_counts` (the same measurements the console publishes). Nothing here is
hand-drawn, because a simulation calibrated against measured counts is only
meaningful if it runs on the road those counts came from.

Outputs land in `sim/` and are gitignored: they are derived artefacts, and a
checked-in .net.xml drifts from the warehouse the first time a link changes.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
from pathlib import Path

import asyncpg
from dotenv import load_dotenv
from pravaah.setu.network import VEHICLE_TYPES, Link, build_plain_xml
from sumolib import checkBinary

OUT = Path("sim")


async def load_links(conn: asyncpg.Connection, corridor_id: int) -> list[Link]:
    rows = await conn.fetch(
        """
        SELECT link_id, name_en, lanes, free_flow_speed_kmh,
               ST_AsGeoJSON(geom) AS geojson
        FROM road_links
        WHERE corridor_id = $1
        ORDER BY link_id
        """,
        corridor_id,
    )
    import json

    links = []
    for r in rows:
        coords = json.loads(r["geojson"])["coordinates"]
        if len(coords) < 2:
            continue
        links.append(
            Link(
                link_id=int(r["link_id"]),
                name=r["name_en"] or f"link {r['link_id']}",
                lanes=int(r["lanes"] or 2),
                speed_kmh=float(r["free_flow_speed_kmh"] or 50),
                shape=[(float(c[0]), float(c[1])) for c in coords],
            )
        )
    return links


async def load_demand(
    conn: asyncpg.Connection, corridor_id: int, hour: int
) -> dict[int, dict[str, int]]:
    """Measured hourly volume PER LINK, by class.

    Per link rather than a corridor total, because the corridor total is a sum
    of link-crossings: a vehicle traversing ten links is counted ten times, so
    injecting that total as fresh demand would put an order of magnitude too
    many vehicles into the network. Reproducing each link's own volume is both
    correct and the only thing a detector can be checked against.
    """
    rows = await conn.fetch(
        """
        SELECT tc.link_id AS lid,
               tc.class_code,
               sum(tc.vehicle_count)::int AS vehicles
        FROM traffic_counts tc
        JOIN road_links l ON l.link_id = tc.link_id
        WHERE l.corridor_id = $1
          AND extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = $2
          AND tc.bucket_start >= now() - INTERVAL '7 days'
        GROUP BY tc.link_id, tc.class_code
        """,
        corridor_id,
        hour,
    )
    demand: dict[int, dict[str, int]] = {}
    for r in rows:
        # Seven days of that hour; the simulation runs one.
        demand.setdefault(int(r["lid"]), {})[r["class_code"]] = max(
            0, int(r["vehicles"]) // 7
        )
    return demand


def write_routes(
    path: Path,
    demand: dict[int, dict[str, int]],
    available_edges: set[str],
    seconds: int,
) -> int:
    """One `flow` per class per link, departing on that link's own edge.

    Flows rather than enumerated trips: SUMO spaces a flow evenly and
    reproducibly, and writing tens of thousands of `<trip>` elements produces a
    file that takes longer to parse than to simulate.

    A link whose edge did not survive netconvert's junction joining is skipped
    and reported. Silently dropping its demand would quietly under-load the
    corridor and make the calibration look better than it is.
    """
    known = {vt.id for vt in VEHICLE_TYPES}
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<routes>"]
    for vt in VEHICLE_TYPES:
        lines.append(
            f'  <vType id="{vt.id}" length="{vt.length_m}" width="{vt.width_m}" '
            f'maxSpeed="{vt.max_speed_kmh / 3.6:.3f}" minGap="{vt.min_gap_m}" '
            f'sigma="{vt.sigma}" latAlignment="arbitrary" '
            f'vClass="{"motorcycle" if vt.id == "2W" else "passenger"}"/>'
        )
    total = 0
    missing = 0
    for link_id, by_class in sorted(demand.items()):
        edge = f"e{link_id}"
        if edge not in available_edges:
            missing += 1
            continue
        for class_code, vehicles in sorted(by_class.items()):
            if class_code not in known or vehicles <= 0:
                # A class with no vType cannot be simulated. Skipped rather
                # than mapped onto a car, which would inflate PCU.
                continue
            lines.append(
                f'  <flow id="f{link_id}_{class_code}" type="{class_code}" from="{edge}" '
                f'begin="0" end="{seconds}" number="{vehicles}"/>'
            )
            total += vehicles
    lines.append("</routes>")
    path.write_text("\n".join(lines))
    if missing:
        print(f"  {missing} links had no surviving edge — their demand is not injected")
    return total


async def read_warehouse(corridor: int, hour: int) -> tuple[list[Link], dict[str, int]]:
    """The only async part. Everything after this is files and subprocesses,
    which have no business inside a coroutine."""
    load_dotenv()
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        return await load_links(conn, corridor), await load_demand(conn, corridor, hour)
    finally:
        await conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corridor", type=int, default=1)
    ap.add_argument("--hour", type=int, default=19, help="IST hour to reproduce")
    args = ap.parse_args()

    links, demand = asyncio.run(read_warehouse(args.corridor, args.hour))

    OUT.mkdir(exist_ok=True)
    nodes_xml, edges_xml, types_xml = build_plain_xml(links)
    (OUT / "corridor.nod.xml").write_text(nodes_xml)
    (OUT / "corridor.edg.xml").write_text(edges_xml)
    (OUT / "vtypes.add.xml").write_text(types_xml)
    print(f"{len(links)} links -> plain XML")

    netconvert = checkBinary("netconvert")
    result = subprocess.run(  # noqa: S603
        [
            netconvert,
            "--node-files", str(OUT / "corridor.nod.xml"),
            "--edge-files", str(OUT / "corridor.edg.xml"),
            "--output-file", str(OUT / "corridor.net.xml"),
            # Our coordinates are lon/lat; without this netconvert treats them
            # as metres and builds a network 13 metres across.
            "--proj.utm",
            # NOT --geometry.remove and NOT --junctions.join. Both merge
            # edges, and a merged edge cannot be compared against the link it
            # came from: the first attempt collapsed 35 measured links into 17
            # edges, so two thirds of the corridor's demand had nowhere to be
            # injected and the calibration was measuring a different road.
            # Keeping edges 1:1 with links costs a slightly uglier network and
            # buys a comparison that means something.
            "--no-internal-links",
            # Signals. The department has not supplied timings, so these are
            # netconvert's own plans at junctions it identifies as signalised,
            # with a cycle in the range Webster gives for this corridor's
            # saturation. Stated as an assumption in the calibration output —
            # a simulation whose delay comes from invented signal timings is
            # not evidence about this corridor.
            "--tls.guess",
            "--tls.guess-signals",
            "--tls.default-type", "static",
            "--tls.cycle.time", "90",
            "--no-turnarounds",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print("netconvert failed:\n", result.stderr[:1500])
        raise SystemExit(1)
    warnings = [w for w in result.stderr.splitlines() if "Warning" in w]
    print(f"netconvert ok ({len(warnings)} warnings)")

    import sumolib

    net = sumolib.net.readNet(str(OUT / "corridor.net.xml"))
    all_edges = [e.getID() for e in net.getEdges()]
    # Entry edges: those with no incoming edge are where demand enters. If the
    # network is fully connected there are none, so fall back to the longest
    # edges, which are the corridor's own trunk sections.
    entries = [e.getID() for e in net.getEdges() if not e.getIncoming()]
    if not entries:
        entries = [
            e.getID() for e in sorted(net.getEdges(), key=lambda x: -x.getLength())[:4]
        ]
    print(f"network: {len(all_edges)} edges, {len(net.getNodes())} nodes, "
          f"{len(entries)} entry points")

    seconds = 3600
    edge_ids = set(all_edges)
    written = write_routes(OUT / "corridor.rou.xml", demand, edge_ids, seconds)
    measured_total = sum(sum(c.values()) for c in demand.values())
    print(f"demand hour {args.hour:02d}: {measured_total:,} link-crossings measured, "
          f"{written:,} injected")

    # Induction loops, one per edge. Without these the "volume check" compares
    # what we injected against what we intended to inject, which is circular
    # and always passes. A detector measures what actually crossed.
    detectors = ['<?xml version="1.0" encoding="UTF-8"?>', "<additional>"]
    for edge_id in sorted(edge_ids):
        detectors.append(
            f'  <inductionLoop id="d_{edge_id}" lane="{edge_id}_0" pos="-5" '
            f'freq="{seconds}" file="detectors.out.xml"/>'
        )
    detectors.append("</additional>")
    (OUT / "detectors.add.xml").write_text("\n".join(detectors))
    print(f"wrote {len(edge_ids)} induction loops")

    (OUT / "corridor.sumocfg").write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <input>
    <net-file value="corridor.net.xml"/>
    <route-files value="corridor.rou.xml"/>
    <additional-files value="detectors.add.xml"/>
  </input>
  <time><begin value="0"/><end value="{seconds}"/></time>
  <processing>
    <!-- Sublane model: this is what lets two-wheelers filter rather than
         queue one per lane. On a 61%-two-wheeler arterial, without it the
         queues come out roughly double and every scenario result is wrong. -->
    <lateral-resolution value="0.8"/>
    <ignore-route-errors value="true"/>
  </processing>
  <report><no-step-log value="true"/><duration-log.statistics value="true"/></report>
</configuration>
"""
    )
    print(f"wrote {OUT}/corridor.sumocfg")


if __name__ == "__main__":
    main()
