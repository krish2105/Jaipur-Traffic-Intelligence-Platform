"""Corridor synchronisation: count-based green wave vs PCU-based, in SUMO.

docs/12 §2 says the units error "compounds across a synchronised corridor".
§2.1 already corrected the single-junction claim after measuring it. This
measures the corridor claim, which is the one the incumbent's phase 2 is about.

The experiment
--------------
N signalised junctions in a line, 600 m apart, one arterial running through
them and a cross street at each. Junction count is swept from 1 to 5 so that
"compounds" is a testable statement rather than a rhetorical one: if the gap
between the two plans grows with N, it compounds; if it is flat, it does not.

Two plans, differing in both things a green wave is made of:

    count   equal splits, offsets from the posted speed
    pcu     PCU-weighted splits, offsets from the speed the platoon can
            actually hold given what is in it

The second half of that matters more than the split. A green wave's offset is
distance divided by progression speed, and progression speed is a property of
the platoon, not of the sign at the roadside. A platoon that is 70% two-wheelers
discharges and travels differently from one carrying buses and trucks. Timing
offsets to the posted speed assumes a platoon nobody is driving.

Honesty
-------
* Synthetic corridor, uniform spacing, no turning traffic, no pedestrians. It
  isolates one mechanism; it is not a model of Tonk Road.
* Both plans get identical demand, seed, network and cycle.
* Advisory only (CLAUDE.md). This computes plans; it actuates nothing.

    uv run python scripts/compare_pcu_corridor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Final

from sumolib import checkBinary

OUT = Path("sim/corridor_pcu")
RESULT = Path("apps/web/src/data/pcu-corridor.json")

#: IRC:106-1990, urban roads — as in the single-junction comparison.
PCU: Final[dict[str, float]] = {
    "2W": 0.5, "AUTO": 1.2, "ERIK": 1.2, "CAR": 1.0,
    "LCV": 1.4, "BUS": 2.2, "TRK2": 2.2,
}

#: Free-flow speed each class can actually hold, m/s. From sim/vtypes.add.xml.
VMAX: Final[dict[str, float]] = {
    "2W": 16.667, "AUTO": 12.5, "ERIK": 6.944, "CAR": 19.444,
    "LCV": 16.667, "BUS": 15.278, "TRK2": 15.278,
}

#: The arterial's own composition — freight-bearing, as a Jaipur arterial is.
ARTERIAL: Final[dict[str, float]] = {
    "2W": 0.45, "AUTO": 0.10, "CAR": 0.22, "LCV": 0.10, "BUS": 0.08, "TRK2": 0.05,
}
#: The cross streets are the two-wheeler-heavy local roads.
CROSS: Final[dict[str, float]] = {"2W": 0.75, "AUTO": 0.10, "CAR": 0.12, "LCV": 0.03}

ARTERIAL_VPH: Final = 1200
CROSS_VPH: Final = 600
SPACING_M: Final = 600
POSTED_MS: Final = 13.9
CYCLE: Final = 90
LOST_PER_PHASE: Final = 4
YELLOW: Final = 3
#: Replicated, not a single run. The first sweep showed 5 junctions scoring
#: LOWER than 4, which is not a mechanism — it is one seed's noise. A claim
#: about how the benefit scales cannot rest on one sample per point.
SEEDS: Final = (42, 101, 202, 303, 404)
JUNCTION_SWEEP: Final = (1, 2, 3, 4, 5)


def pcu_of(mix: dict[str, float], vph: float) -> float:
    return vph * sum(share * PCU[c] for c, share in mix.items())


def progression_speed(mix: dict[str, float]) -> float:
    """The speed the platoon can hold, PCU-weighted and harmonic.

    Harmonic because travel *time* over a fixed distance is what an offset has
    to match, and the mean of times is not the reciprocal of the mean of speeds.
    PCU-weighted because a bus occupies the road — and therefore constrains the
    vehicles behind it — far more than its single vehicle count suggests.
    """
    num = sum(share * PCU[c] for c, share in mix.items())
    den = sum(share * PCU[c] / min(VMAX[c], POSTED_MS) for c, share in mix.items())
    return num / den if den else POSTED_MS


def write_network(n: int) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    nodes = ['<nodes>']
    edges = ['<edges>']

    # Arterial runs west to east through j0..j(n-1), with a tail each end so
    # vehicles reach a steady speed before the first stop line.
    nodes.append(f'  <node id="w" x="{-SPACING_M}" y="0"/>')
    for i in range(n):
        nodes.append(f'  <node id="j{i}" x="{i * SPACING_M}" y="0" type="traffic_light"/>')
        nodes.append(f'  <node id="n{i}" x="{i * SPACING_M}" y="300"/>')
        nodes.append(f'  <node id="s{i}" x="{i * SPACING_M}" y="-300"/>')
    nodes.append(f'  <node id="e" x="{(n - 1) * SPACING_M + SPACING_M}" y="0"/>')
    nodes.append("</nodes>")

    def edge(a: str, b: str) -> str:
        return f'  <edge id="{a}_{b}" from="{a}" to="{b}" numLanes="2" speed="{POSTED_MS}"/>'

    prev = "w"
    for i in range(n):
        edges.append(edge(prev, f"j{i}"))
        edges.append(edge(f"n{i}", f"j{i}"))
        edges.append(edge(f"j{i}", f"s{i}"))
        prev = f"j{i}"
    edges.append(edge(prev, "e"))
    edges.append("</edges>")

    (OUT / "c.nod.xml").write_text("\n".join(nodes) + "\n")
    (OUT / "c.edg.xml").write_text("\n".join(edges) + "\n")
    subprocess.run(  # noqa: S603 — binary from sumolib, args are literals
        [
            checkBinary("netconvert"),
            "-n", str(OUT / "c.nod.xml"), "-e", str(OUT / "c.edg.xml"),
            "-o", str(OUT / "c.net.xml"),
            "--no-turnarounds", "--tls.default-type", "static",
        ],
        check=True, capture_output=True,
    )


def write_routes(n: int) -> None:
    body = Path("sim/vtypes.add.xml").read_text().replace("</additional>", "")
    route_art = " ".join(
        ["w_j0"] + [f"j{i}_j{i+1}" for i in range(n - 1)] + [f"j{n-1}_e"]
    )
    for cls, share in ARTERIAL.items():
        vph = ARTERIAL_VPH * share
        if vph < 1:
            continue
        body += (
            f'  <flow id="art_{cls}" type="{cls}" begin="0" end="3600" '
            f'vehsPerHour="{vph:.1f}" departLane="random" departSpeed="max">\n'
            f'    <route edges="{route_art}"/>\n  </flow>\n'
        )
    for i in range(n):
        for cls, share in CROSS.items():
            vph = CROSS_VPH * share
            if vph < 1:
                continue
            body += (
                f'  <flow id="x{i}_{cls}" type="{cls}" begin="0" end="3600" '
                f'vehsPerHour="{vph:.1f}" departLane="random" departSpeed="max">\n'
                f'    <route edges="n{i}_j{i} j{i}_s{i}"/>\n  </flow>\n'
            )
    (OUT / "c.rou.xml").write_text(body + "</additional>\n")


def write_tls(name: str, n: int, green_art: int, speed_ms: float) -> None:
    """Write a plan by patching the network's own signal logic.

    Not an additional file. SUMO refuses a second logic with the same id and
    programID ("Another logic with id 'j0' and programID '0' exists"), and a
    *different* programID is simply never activated — which is how the first
    version of this script produced two plans that were both the netconvert
    default, and differences that were pure noise.

    Patching the net keeps SUMO's own phase states, which are correct by
    construction, and changes only the two things a signal plan actually sets:
    the phase durations and the offset. That is also what an optimiser does.

    Offset i = i * spacing / progression speed, mod cycle — the standard
    forward-progression band.
    """
    effective = CYCLE - 2 * (LOST_PER_PHASE + YELLOW)
    green_cross = effective - green_art

    # Our own network, written by netconvert moments earlier.
    tree = ET.parse(OUT / "c.net.xml")  # noqa: S314 — not untrusted input
    root = tree.getroot()

    # Which controlled links are the arterial, read from the network's own
    # connections rather than assumed from a hand-written string.
    arterial: dict[str, set[int]] = {f"j{i}": set() for i in range(n)}
    for conn in root.iter("connection"):
        tl = conn.get("tl")
        if tl in arterial and not conn.get("from", "").startswith("n"):
            arterial[tl].add(int(conn.get("linkIndex", -1)))

    for tl in root.iter("tlLogic"):
        jid = tl.get("id", "")
        if jid not in arterial:
            continue
        i = int(jid[1:])
        tl.set("offset", str(round(i * SPACING_M / speed_ms) % CYCLE))
        art = arterial[jid]
        for phase in tl.findall("phase"):
            state = phase.get("state", "")
            if "G" not in state:
                continue  # a yellow/clearance phase keeps its duration
            serves_arterial = any(
                k in art for k, ch in enumerate(state) if ch in "Gg"
            )
            phase.set("duration", str(green_art if serves_arterial else green_cross))

    tree.write(OUT / f"c_{name}.net.xml", encoding="UTF-8", xml_declaration=True)


def run(name: str, seed: int) -> dict[str, float]:
    trip = OUT / f"trip_{name}_{seed}.xml"
    cfg = OUT / f"c_{name}_{seed}.sumocfg"
    cfg.write_text(
        f"""<configuration>
  <input>
    <net-file value="c_{name}.net.xml"/>
    <route-files value="c.rou.xml"/>
  </input>
  <time><begin value="0"/><end value="3600"/></time>
  <processing><time-to-teleport value="-1"/></processing>
  <report><no-step-log value="true"/><no-warnings value="true"/></report>
  <output><tripinfo-output value="{trip.name}"/></output>
  <random_number><seed value="{seed}"/></random_number>
</configuration>
"""
    )
    subprocess.run(  # noqa: S603 — binary from sumolib, args are literals
        [checkBinary("sumo"), "-c", str(cfg)],
        check=True, capture_output=True,
    )

    art_loss: list[float] = []
    art_stops: list[float] = []
    art_pcu: list[tuple[float, float]] = []
    cross_loss: list[float] = []
    for _, el in ET.iterparse(trip):  # noqa: S314 — our own output, written above
        if el.tag != "tripinfo":
            continue
        vid = el.get("id", "")
        loss = float(el.get("timeLoss", 0))
        if vid.startswith("art_"):
            cls = vid.split("_")[1].split(".")[0]
            art_loss.append(loss)
            art_stops.append(float(el.get("waitingCount", 0)))
            art_pcu.append((loss, PCU.get(cls, 1.0)))
        elif vid.startswith("x"):
            cross_loss.append(loss)
        el.clear()

    def mean(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    wsum = sum(w for _, w in art_pcu)
    return {
        "arterial_delay_s": round(mean(art_loss), 1),
        "arterial_stops": round(mean(art_stops), 2),
        "arterial_delay_pcu_s": round(
            sum(loss * w for loss, w in art_pcu) / wsum if wsum else 0.0, 1
        ),
        "cross_delay_s": round(mean(cross_loss), 1),
        "arterial_vehicles": len(art_loss),
    }


def main() -> None:
    effective = CYCLE - 2 * (LOST_PER_PHASE + YELLOW)
    art_pcu_h, cross_pcu_h = pcu_of(ARTERIAL, ARTERIAL_VPH), pcu_of(CROSS, CROSS_VPH)
    v_prog = progression_speed(ARTERIAL)

    # Count plan: split by vehicle count, offsets from the posted speed.
    green_count = round(effective * ARTERIAL_VPH / (ARTERIAL_VPH + CROSS_VPH))
    # PCU plan: split by PCU demand, offsets from what the platoon can hold.
    green_pcu = round(effective * art_pcu_h / (art_pcu_h + cross_pcu_h))

    def mean_of(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    rows = []
    for n in JUNCTION_SWEEP:
        write_network(n)
        write_routes(n)
        write_tls("count", n, green_count, POSTED_MS)
        write_tls("pcu", n, green_pcu, v_prog)

        deltas: list[float] = []
        stops: list[float] = []
        cross: list[float] = []
        for seed in SEEDS:
            c, q = run("count", seed), run("pcu", seed)
            deltas.append(c["arterial_delay_s"] - q["arterial_delay_s"])
            stops.append(c["arterial_stops"] - q["arterial_stops"])
            cross.append(q["cross_delay_s"] - c["cross_delay_s"])

        rows.append(
            {
                "junctions": n,
                "seeds": len(SEEDS),
                "arterial_delay_saved_s": round(mean_of(deltas), 1),
                "arterial_delay_saved_min_s": round(min(deltas), 1),
                "arterial_delay_saved_max_s": round(max(deltas), 1),
                "arterial_stops_saved": round(mean_of(stops), 2),
                "cross_delay_cost_s": round(mean_of(cross), 1),
                # The trade-off in whole vehicle-seconds. The arterial carries
                # one flow; the cross streets carry n of them, so a per-vehicle
                # comparison flatters the arterial as the corridor lengthens.
                "arterial_veh_seconds_saved": round(ARTERIAL_VPH * mean_of(deltas)),
                "cross_veh_seconds_cost": round(CROSS_VPH * n * mean_of(cross)),
                "net_veh_seconds": round(
                    ARTERIAL_VPH * mean_of(deltas) - CROSS_VPH * n * mean_of(cross)
                ),
            }
        )

    saved = [r["arterial_delay_saved_s"] for r in rows]
    per_junction = [round(s / r["junctions"], 2) for s, r in zip(saved, rows, strict=True)]
    # "Compounds" means the per-junction gain grows with corridor length. If it
    # is flat, the effect is additive; if it shrinks, it does not compound.
    # Compounding means the benefit PER JUNCTION grows as the corridor gets
    # longer. If total benefit grows while per-junction benefit stays flat, the
    # effect is additive — worth having, but not the compounding §2 claimed.
    compounds = per_junction[-1] > per_junction[0] * 1.15
    additive = saved[-1] > saved[0]

    result = {
        "corridor": f"{SPACING_M} m spacing, 2 lanes, no turns, cross street at each junction",
        "arterial": {"veh_per_hour": ARTERIAL_VPH, "pcu_per_hour": round(art_pcu_h), "mix": ARTERIAL},
        "cross": {"veh_per_hour": CROSS_VPH, "pcu_per_hour": round(cross_pcu_h), "mix": CROSS},
        "plans": {
            "count": {"green_arterial_s": green_count, "progression_speed_ms": POSTED_MS},
            "pcu": {"green_arterial_s": green_pcu, "progression_speed_ms": round(v_prog, 2)},
        },
        "sweep": rows,
        "finding": {
            "per_junction_saving_s": per_junction,
            "compounds_with_corridor_length": compounds,
            "additive_with_corridor_length": additive,
            "net_positive_in_vehicle_seconds": [
                r["junctions"] for r in rows if r["net_veh_seconds"] > 0
            ],
            "seeds_per_point": len(SEEDS),
            "arterial_improves_at_all_lengths": all(s > 0 for s in saved),
        },
        "method": {
            "pcu_source": "IRC:106-1990",
            "offset_rule": "i * spacing / progression speed, mod cycle",
            "cycle_s": CYCLE, "seeds": list(SEEDS), "sumo": "1.27.1",
            "identical": "demand, seed, network, cycle. Split and offset differ.",
        },
        "caveat": (
            "Synthetic corridor: uniform spacing, no turning traffic, no pedestrians, "
            "one demand level. It isolates one mechanism and is not a model of Tonk Road."
        ),
        "advisory_only": True,
        "is_synthetic": True,
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(result, indent=2))

    print(f"arterial {ARTERIAL_VPH} veh/h = {art_pcu_h:.0f} PCU/h")
    print(f"posted speed {POSTED_MS} m/s   platoon progression speed {v_prog:.2f} m/s")
    print(f"green arterial: count {green_count}s   pcu {green_pcu}s\n")
    hdr = (
        f"{'junctions':>9} {'art saved':>10} {'[min,max]':>14}"
        f" {'stops saved':>11} {'cross cost':>10} {'per-jn':>7}"
    )
    print(hdr)
    print("-" * len(hdr))
    for r, pj in zip(rows, per_junction, strict=True):
        print(
            f"{r['junctions']:>9} {r['arterial_delay_saved_s']:>10.1f}"
            f" [{r['arterial_delay_saved_min_s']:>5.1f},{r['arterial_delay_saved_max_s']:>5.1f}]"
            f" {r['arterial_stops_saved']:>11.2f} {r['cross_delay_cost_s']:>10.1f} {pj:>7.2f}"
        )
    print(f"\nper-junction saving: {per_junction} -> compounds: {compounds}")
    print(f"total arterial saving grows {saved[0]}s -> {saved[-1]}s: additive {additive}")
    print("\nnet, in whole vehicle-seconds (arterial gain minus cross-street cost):")
    for r in rows:
        print(
            f"   {r['junctions']} junction(s): "
            f"+{r['arterial_veh_seconds_saved']:>6} arterial "
            f"-{r['cross_veh_seconds_cost']:>6} cross "
            f"= {r['net_veh_seconds']:>+7}"
        )
    print(f"-> {RESULT}")


if __name__ == "__main__":
    sys.exit(main())
