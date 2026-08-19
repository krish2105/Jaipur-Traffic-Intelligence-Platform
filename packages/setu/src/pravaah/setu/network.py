"""SETU — building a SUMO network from the corridor we actually measured.

The network is generated from `road_links`, which is real OpenStreetMap
geometry with real lane counts and speed limits. That matters more than it
sounds: a simulation calibrated against measured counts is only meaningful if
the road it runs on is the road those counts came from. Hand-drawing a
"representative arterial" and calibrating to Tonk Road's numbers would produce
confident results about a road that does not exist.

Two decisions shape everything downstream.

**Nodes are shared by coordinate, not created per link.** Two links whose
endpoints coincide must meet at one junction, or SUMO builds a network of
disconnected stubs where vehicles vanish at every boundary. Snapping is done on
rounded coordinates because floating-point endpoints from PostGIS agree to
about a centimetre, not exactly.

**Vehicle types carry Indian PCU factors and real dimensions.** A SUMO default
fleet is European: no auto-rickshaws, no lane-sharing two-wheelers, and a
passenger car unit that assumes disciplined lane behaviour. Running that against
Jaipur counts would calibrate the wrong thing — the mix is the entire point of
this platform, so it has to survive into the simulation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final
from xml.etree import ElementTree as ET

#: Coordinate rounding for node identity, in degrees. 1e-6 is about 11 cm at
#: this latitude — tight enough that distinct junctions stay distinct, loose
#: enough that the same junction reached from two links snaps to one node.
NODE_PRECISION: Final = 6


#: Vehicle types, with PCU matching `vehicle_classes.pcu_factor` and physical
#: dimensions from IRC:106. `sigma` is driver imperfection: higher for the
#: classes that behave less predictably in mixed traffic.
@dataclass(frozen=True)
class VehicleType:
    id: str
    length_m: float
    width_m: float
    max_speed_kmh: float
    #: Minimum gap to the vehicle in front. Small for two-wheelers, which is
    #: how they filter, and is the single most important parameter for
    #: reproducing an Indian arterial rather than a European one.
    min_gap_m: float
    sigma: float
    pcu: float


VEHICLE_TYPES: Final[tuple[VehicleType, ...]] = (
    VehicleType("2W", 1.8, 0.6, 60, 0.5, 0.7, 0.25),
    VehicleType("AUTO", 2.6, 1.4, 45, 0.8, 0.6, 0.50),
    VehicleType("ERIK", 2.7, 1.2, 25, 0.8, 0.6, 0.50),
    VehicleType("CAR", 4.0, 1.7, 70, 1.5, 0.5, 1.00),
    VehicleType("LCV", 6.0, 2.2, 60, 2.0, 0.5, 1.50),
    VehicleType("BUS", 10.5, 2.5, 55, 2.5, 0.4, 3.00),
    VehicleType("TRK2", 9.0, 2.5, 55, 2.5, 0.4, 3.00),
)


@dataclass(frozen=True)
class Link:
    link_id: int
    name: str
    lanes: int
    speed_kmh: float
    shape: list[tuple[float, float]]


def node_id(lon: float, lat: float) -> str:
    """Stable id for a coordinate, so coincident endpoints share a junction."""
    return f"n{round(lon, NODE_PRECISION)}_{round(lat, NODE_PRECISION)}".replace(".", "d").replace(
        "-", "m"
    )


def build_plain_xml(links: list[Link]) -> tuple[str, str, str]:
    """Return (nodes.xml, edges.xml, types.xml) as strings for netconvert.

    Plain XML rather than driving netconvert at OSM directly: we already hold
    the corridor's geometry, lane counts and speed limits in the warehouse, and
    re-deriving them from a fresh OSM extract would let the simulation and the
    measurements drift apart at the next OSM edit.
    """
    nodes = ET.Element("nodes")
    seen: set[str] = set()
    for link in links:
        for lon, lat in (link.shape[0], link.shape[-1]):
            nid = node_id(lon, lat)
            if nid in seen:
                continue
            seen.add(nid)
            ET.SubElement(
                nodes,
                "node",
                id=nid,
                x=f"{lon:.7f}",
                y=f"{lat:.7f}",
                # `priority` lets netconvert infer junction control; the real
                # signal plan is applied separately from `junctions`.
                type="priority",
            )

    edges = ET.Element("edges")
    for link in links:
        from_node = node_id(*link.shape[0])
        to_node = node_id(*link.shape[-1])
        if from_node == to_node:
            # A zero-length or closed link cannot be an edge. Skipping is
            # correct; silently collapsing it to a node would lose the road.
            continue
        edge = ET.SubElement(
            edges,
            "edge",
            id=f"e{link.link_id}",
            attrib={"from": from_node, "to": to_node},
            numLanes=str(max(1, link.lanes)),
            speed=f"{link.speed_kmh / 3.6:.3f}",
            name=link.name,
        )
        # Interior geometry, so a curved flyover is curved in the simulation.
        # Without it every link is a straight line and turning movements at the
        # ends are wrong.
        interior = link.shape[1:-1]
        if interior:
            edge.set("shape", " ".join(f"{lon:.7f},{lat:.7f}" for lon, lat in interior))

    types = ET.Element("additional")
    for vt in VEHICLE_TYPES:
        ET.SubElement(
            types,
            "vType",
            id=vt.id,
            length=str(vt.length_m),
            width=str(vt.width_m),
            maxSpeed=f"{vt.max_speed_kmh / 3.6:.3f}",
            minGap=str(vt.min_gap_m),
            sigma=str(vt.sigma),
            # `sublane` behaviour is what lets two-wheelers filter rather than
            # queue one-per-lane. Without it a 61%-two-wheeler fleet simulates
            # as if every rider waited politely in a car-sized box, and the
            # queue lengths come out roughly double.
            latAlignment="arbitrary",
            vClass="motorcycle" if vt.id == "2W" else "passenger",
        )

    def dump(element: ET.Element) -> str:
        ET.indent(element, space="  ")
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(element, encoding="unicode")

    return dump(nodes), dump(edges), dump(types)
