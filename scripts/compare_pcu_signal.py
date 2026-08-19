"""Count-optimised signal timing vs PCU-optimised, measured in SUMO.

docs/12 §2 claims this is the technical wedge against the incumbent ITMS. A
claim in a plan is not evidence, so this runs it.

The experiment
--------------
One four-arm signalised junction. Both arms are given the **same vehicle count**
— 900 veh/h each — and very different compositions:

    north-south   two-wheeler heavy, the Jaipur default
    east-west     mixed with freight: buses, trucks, light commercials

A controller that allocates green time by vehicle count sees two identical
approaches and splits the green evenly. A controller that converts to PCU first
sees roughly twice the demand on the freight arm and splits accordingly.

The point is not that one number is bigger. It is that **the count-based
controller cannot see the difference at all** — its input is identical on both
arms. That is a units error rather than a tuning error, which is why no amount
of retuning a count-based ITMS reaches the same answer, and why it compounds
once junctions are synchronised along a corridor.

PCU factors are IRC:106 for urban roads. They are the standard the department's
own engineers already design to, which is the point: this is not a novel model,
it is the arithmetic their own code of practice specifies, applied where the
incumbent applies vehicle counts instead.

Honesty
-------
* One isolated junction, one hour, one demand level. It is a demonstration of a
  mechanism, not a forecast of city-wide benefit, and the output says so.
* Both runs use identical demand, identical seed, identical network and
  identical cycle length. The **only** difference is the green split.
* Signal output stays advisory (CLAUDE.md). This computes a plan; it does not
  actuate one.

    uv run python scripts/compare_pcu_signal.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Final

from sumolib import checkBinary

OUT = Path("sim/pcu")
RESULT = Path("apps/web/src/data/pcu-comparison.json")

#: IRC:106-1990, urban roads. The department designs to these already.
PCU: Final[dict[str, float]] = {
    "2W": 0.5,
    "AUTO": 1.2,
    "ERIK": 1.2,
    "CAR": 1.0,
    "LCV": 1.4,
    "BUS": 2.2,
    "TRK2": 2.2,
}

#: Same vehicle count on both arms. That equality is the whole experiment.
#:
#: Swept rather than fixed. At one demand level the answer was ambiguous — at
#: 900 veh/h the junction is under-saturated on both arms (v/c 0.39 and 0.71),
#: the split barely binds, and the PCU plan came out slightly WORSE on mean
#: vehicle delay while better on freight delay. Reporting that single point
#: either way would have been cherry-picking. The sweep shows where the
#: mechanism actually starts to bite, which is the honest form of the claim.
DEMAND_SWEEP: Final = (600, 800, 1000, 1200, 1400, 1600)
VEH_PER_HOUR: Final = 900

#: Two compositions a count-based controller cannot tell apart.
MIX: Final[dict[str, dict[str, float]]] = {
    "ns": {"2W": 0.75, "AUTO": 0.10, "CAR": 0.12, "LCV": 0.03},
    "ew": {"2W": 0.25, "AUTO": 0.10, "CAR": 0.30, "LCV": 0.15, "BUS": 0.12, "TRK2": 0.08},
}

CYCLE: Final = 90
#: Startup lost time + clearance, per phase. Webster's usual allowance.
LOST_PER_PHASE: Final = 4
YELLOW: Final = 3
SEED: Final = 42


def pcu_demand(arm: str, veh_per_hour: float = VEH_PER_HOUR) -> float:
    return veh_per_hour * sum(share * PCU[cls] for cls, share in MIX[arm].items())


def write_network() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # A 400 m approach on each arm: long enough to hold a queue without
    # spillback masking the delay we are trying to measure.
    (OUT / "j.nod.xml").write_text(
        """<nodes>
  <node id="c" x="0" y="0" type="traffic_light"/>
  <node id="n" x="0" y="400"/>
  <node id="s" x="0" y="-400"/>
  <node id="e" x="400" y="0"/>
  <node id="w" x="-400" y="0"/>
</nodes>
"""
    )
    # Two lanes per approach, 50 km/h — an ordinary Jaipur arterial arm.
    edges = ["<edges>"]
    for a in ("n", "s", "e", "w"):
        edges.append(f'  <edge id="{a}c" from="{a}" to="c" numLanes="2" speed="13.9"/>')
        edges.append(f'  <edge id="c{a}" from="c" to="{a}" numLanes="2" speed="13.9"/>')
    edges.append("</edges>")
    (OUT / "j.edg.xml").write_text("\n".join(edges) + "\n")

    netconvert = checkBinary("netconvert")
    subprocess.run(  # noqa: S603 — binary resolved by sumolib, args are literals
        [
            netconvert,
            "-n",
            str(OUT / "j.nod.xml"),
            "-e",
            str(OUT / "j.edg.xml"),
            "-o",
            str(OUT / "j.net.xml"),
            "--no-turnarounds",
            "--tls.default-type",
            "static",
        ],
        check=True,
        capture_output=True,
    )


def write_routes(veh_per_hour: float = VEH_PER_HOUR) -> None:
    """Straight-through movements only.

    Turning traffic would add a second, separate question — turn-lane capacity —
    and this experiment is about one thing. Through-only keeps the two arms
    strictly comparable.
    """
    vtypes = Path("sim/vtypes.add.xml").read_text()
    body = vtypes.replace("</additional>", "")

    for arm, pairs in (("ns", (("n", "s"), ("s", "n"))), ("ew", (("e", "w"), ("w", "e")))):
        for cls, share in MIX[arm].items():
            for src, dst in pairs:
                # Halved: each direction of the arm carries half its flow.
                veh_h = veh_per_hour * share / 2
                if veh_h < 1:
                    continue
                body += (
                    f'  <flow id="f_{arm}_{cls}_{src}" type="{cls}" begin="0" end="3600" '
                    f'vehsPerHour="{veh_h:.1f}" departLane="random" departSpeed="max">\n'
                    f'    <route edges="{src}c c{dst}"/>\n'
                    f"  </flow>\n"
                )
    (OUT / "j.rou.xml").write_text(body + "</additional>\n")


def write_tls(name: str, green_ns: int, green_ew: int) -> None:
    """A fixed two-phase plan. Only the split differs between the two runs."""
    # Phase order: NS green, NS yellow, EW green, EW yellow.
    # 4 approaches x 2 lanes, netconvert orders links by approach.
    ns_g = "GGGGrrrrGGGGrrrr"
    ew_g = "rrrrGGGGrrrrGGGG"
    ns_y = ns_g.replace("G", "y")
    ew_y = ew_g.replace("G", "y")
    (OUT / f"tls_{name}.add.xml").write_text(
        f"""<additional>
  <tlLogic id="c" type="static" programID="{name}" offset="0">
    <phase duration="{green_ns}" state="{ns_g}"/>
    <phase duration="{YELLOW}" state="{ns_y}"/>
    <phase duration="{green_ew}" state="{ew_g}"/>
    <phase duration="{YELLOW}" state="{ew_y}"/>
  </tlLogic>
</additional>
"""
    )


def run(name: str) -> dict[str, float]:
    trip = OUT / f"trip_{name}.xml"
    cfg = OUT / f"j_{name}.sumocfg"
    cfg.write_text(
        f"""<configuration>
  <input>
    <net-file value="j.net.xml"/>
    <route-files value="j.rou.xml"/>
    <additional-files value="tls_{name}.add.xml"/>
  </input>
  <time><begin value="0"/><end value="3600"/></time>
  <processing><time-to-teleport value="-1"/></processing>
  <report><no-step-log value="true"/><no-warnings value="true"/></report>
  <output><tripinfo-output value="{trip.name}"/></output>
  <random_number><seed value="{SEED}"/></random_number>
</configuration>
"""
    )
    subprocess.run(  # noqa: S603 — binary resolved by sumolib, args are literals
        [checkBinary("sumo"), "-c", str(cfg)], check=True, capture_output=True
    )

    # timeLoss is delay against a free-flow run of the same trip: the right
    # measure here, because the two plans are compared on what they cost drivers
    # rather than on raw travel time, which the geometry alone would dominate.
    per_arm: dict[str, list[float]] = {"ns": [], "ew": []}
    pcu_weighted: dict[str, list[tuple[float, float]]] = {"ns": [], "ew": []}
    # Our own SUMO output, written moments earlier by a binary we invoked.
    for _, el in ET.iterparse(trip):  # noqa: S314 — not untrusted input
        if el.tag != "tripinfo":
            continue
        vid = el.get("id", "")
        arm = "ns" if "_ns_" in vid else "ew" if "_ew_" in vid else None
        if arm:
            loss = float(el.get("timeLoss", 0))
            cls = vid.split("_")[2]
            per_arm[arm].append(loss)
            pcu_weighted[arm].append((loss, PCU.get(cls, 1.0)))
        el.clear()

    def mean(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    total = per_arm["ns"] + per_arm["ew"]
    # Person-and-goods delay is closer to what a PCU is a proxy for than a plain
    # vehicle mean, which counts a bus as one delayed unit and a scooter as one.
    all_w = pcu_weighted["ns"] + pcu_weighted["ew"]
    weighted = sum(loss * w for loss, w in all_w) / sum(w for _, w in all_w) if all_w else 0.0

    return {
        "delay_ns_s": round(mean(per_arm["ns"]), 1),
        "delay_ew_s": round(mean(per_arm["ew"]), 1),
        "delay_mean_s": round(mean(total), 1),
        "delay_pcu_weighted_s": round(weighted, 1),
        "vehicles_ns": len(per_arm["ns"]),
        "vehicles_ew": len(per_arm["ew"]),
    }


def main() -> None:
    write_network()
    effective = CYCLE - 2 * (LOST_PER_PHASE + YELLOW)

    rows = []
    for demand in DEMAND_SWEEP:
        write_routes(demand)
        ns_pcu, ew_pcu = pcu_demand("ns", demand), pcu_demand("ew", demand)

        # Plan A is the incumbent's basis. Both arms report the same veh/h, so
        # the split is even — the controller has no input that separates them.
        count_ns = round(effective * 0.5)
        pcu_ns = round(effective * ns_pcu / (ns_pcu + ew_pcu))

        write_tls("count", count_ns, effective - count_ns)
        write_tls("pcu", pcu_ns, effective - pcu_ns)
        count, pcu = run("count"), run("pcu")

        # Saturation on the freight arm under the EVEN split — the condition
        # that decides whether the split binds at all. 1800 PCU/h/lane is the
        # usual saturation flow; 2 lanes, green fraction from the count plan.
        capacity_ew = 2 * 1800 * (effective - count_ns) / CYCLE
        rows.append(
            {
                "veh_per_hour_each_arm": demand,
                "ns_pcu_per_hour": round(ns_pcu),
                "ew_pcu_per_hour": round(ew_pcu),
                "ew_vc_under_count_plan": round(ew_pcu / capacity_ew, 2),
                "green_count_ns_s": count_ns,
                "green_pcu_ns_s": pcu_ns,
                "count": count,
                "pcu": pcu,
                "mean_delay_saved_s": round(count["delay_mean_s"] - pcu["delay_mean_s"], 1),
                "pcu_weighted_saved_s": round(
                    count["delay_pcu_weighted_s"] - pcu["delay_pcu_weighted_s"], 1
                ),
                "freight_arm_saved_s": round(count["delay_ew_s"] - pcu["delay_ew_s"], 1),
            }
        )

    wins = [r for r in rows if r["mean_delay_saved_s"] > 0]
    threshold = min((r["veh_per_hour_each_arm"] for r in wins), default=None)

    result = {
        "junction": "synthetic 4-arm, 2 lanes per approach, through movements only",
        "mix": MIX,
        "pcu_ratio": round(pcu_demand("ew") / pcu_demand("ns"), 2),
        "sweep": rows,
        "finding": {
            "wins_on_mean_delay_above_veh_per_hour": threshold,
            "wins_on_pcu_weighted_delay_at_all_levels": all(
                r["pcu_weighted_saved_s"] > 0 for r in rows
            ),
            "wins_on_freight_arm_at_all_levels": all(r["freight_arm_saved_s"] > 0 for r in rows),
        },
        "method": {
            "pcu_source": "IRC:106-1990, urban roads",
            "cycle_s": CYCLE,
            "effective_green_s": effective,
            "seed": SEED,
            "sumo": "1.27.1",
            "identical": "demand, seed, network and cycle. Only the split differs.",
        },
        "caveat": (
            "One isolated junction, through movements only, one hour per point. This "
            "demonstrates a mechanism — a count-based controller receives identical "
            "input from two arms with very different demand — not a forecast of "
            "city-wide benefit. Below the threshold above, the junction is "
            "under-saturated and the split does not bind, so the even split is close "
            "to as good on mean vehicle delay."
        ),
        "advisory_only": True,
        "is_synthetic": True,
    }

    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(result, indent=2))

    print(f"PCU ratio EW:NS = {result['pcu_ratio']}x at identical vehicle counts\n")
    hdr = (
        f"{'veh/h':>6} {'EW v/c':>7} {'green':>9} {'mean saved':>11} {'pcu-wtd':>9} {'freight':>8}"
    )
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(
            f"{r['veh_per_hour_each_arm']:>6} "
            f"{r['ew_vc_under_count_plan']:>7.2f} "
            f"{r['green_count_ns_s']}/{r['green_pcu_ns_s']:<6} "
            f"{r['mean_delay_saved_s']:>11.1f} {r['pcu_weighted_saved_s']:>9.1f} "
            f"{r['freight_arm_saved_s']:>8.1f}"
        )
    print(f"\nPCU plan beats count plan on MEAN delay above ~{threshold} veh/h per arm")
    print(f"-> {RESULT}")


if __name__ == "__main__":
    sys.exit(main())
