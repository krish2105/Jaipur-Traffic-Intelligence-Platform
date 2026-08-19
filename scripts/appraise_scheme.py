"""Appraise a capital scheme before the work order, not after the ribbon.

The scheme
----------
JDA is building a 2.16 km elevated road on Gopalpura Bypass, two lanes each way,
at Rs 184.87 crore. Gopalpura Bypass is one of the four corridors this platform
already models. Nobody has set up the measurement that would say afterwards
whether it worked, and once it opens the counterfactual is gone forever.

What is actually being asked
----------------------------
Not "will the flyover help" — of course it helps somebody. The useful questions
are how much, for whom, and what it costs the people it does not serve. A
flyover moves through traffic over the junctions and leaves local traffic at
grade with the same signals, so the two groups are reported separately. An
appraisal that reports only the mean hides exactly the trade a councillor will
be asked about.

The assumption that decides the answer
--------------------------------------
Through share: how much of the traffic on Gopalpura is passing along it rather
than turning off it. The benefit scales almost entirely with that number, and
nobody has measured it for this corridor. So it is swept rather than assumed,
and the output is a range with the assumption attached to each end.

Refusing to report noise
------------------------
Every arm runs on several seeds and the difference is reported with a confidence
interval. Where the interval spans zero the script says "inside seed noise"
rather than quoting a mean. The PCU experiments in this repo were corrected
twice by exactly this discipline, once after a 362-second "improvement" turned
out to be two identical simulations disagreeing with themselves.

    uv run python scripts/appraise_scheme.py
"""

from __future__ import annotations

import itertools
import json
import statistics
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Final

from sumolib import checkBinary

OUT = Path("sim/schemes")
REPORT = Path("data/schemes/gopalpura-elevated.json")

#: The scheme as JDA has specified it.
SCHEME: Final[dict[str, Any]] = {
    "id": "gopalpura-elevated",
    "name": "Elevated road, Gopalpura Bypass",
    "authority": "Jaipur Development Authority",
    "cost_crore": 184.87,
    "length_km": 2.16,
    "lanes_each_way": 2,
    "corridor_id": 4,
}

#: Junctions the flyover passes over. Four across 2.16 km is a signal roughly
#: every 540 m, which is ordinary for a Jaipur arterial.
JUNCTIONS: Final = 4
SEGMENT_M: Final = SCHEME["length_km"] * 1000 / (JUNCTIONS + 1)

LANES_AT_GRADE: Final = 3
SPEED_AT_GRADE: Final = 13.9  # 50 km/h
SPEED_ELEVATED: Final = 16.7  # 60 km/h, no signals

#: The number nobody has measured, so it is swept. Everything turns on it.
THROUGH_SHARES: Final = (0.40, 0.55, 0.70)

DEMAND_VEH_H: Final = 2400

#: Traffic on each cross street. This is what the red phase is for, and leaving
#: it out is what made the first run of this script overstate the scheme.
CROSS_VEH_H: Final = 600

#: Induced demand. A road that saves two and a half minutes attracts traffic
#: that was not there before — different routes, different departure times,
#: eventually different trips. It is the standard criticism of urban grade
#: separation and the standard omission from the appraisals that justify them.
#:
#: Modelled the cheap way: re-run the scheme arm with more demand and see how
#: much of the saving survives. That is not a forecast of how much demand is
#: induced, which nobody can give honestly. It answers the question a
#: sceptical official should ask: how wrong does this get if traffic grows.
INDUCED_STEPS: Final = (0.0, 0.15, 0.30)
SEEDS: Final = (42, 7, 1337, 2024, 99)

MIX: Final[dict[str, float]] = {
    "2W": 0.61,
    "AUTO": 0.09,
    "CAR": 0.24,
    "LCV": 0.03,
    "BUS": 0.02,
    "TRK2": 0.01,
}

CYCLE: Final = 90
GREEN: Final = 45
YELLOW: Final = 3
DURATION_S: Final = 3600


def write_network() -> None:
    """One corridor, built twice: at grade only, and with a flyover beside it."""
    OUT.mkdir(parents=True, exist_ok=True)

    nodes = ["<nodes>", '  <node id="in" x="0" y="0"/>']
    for j in range(1, JUNCTIONS + 1):
        nodes.append(f'  <node id="j{j}" x="{j * SEGMENT_M:.0f}" y="0" type="traffic_light"/>')
    nodes.append(f'  <node id="out" x="{(JUNCTIONS + 1) * SEGMENT_M:.0f}" y="0"/>')
    # A cross street at every junction. Without one the red phase serves
    # nothing, the arterial pays a penalty no traffic earned, and the flyover
    # scores against an imaginary cost. The first version of this script did
    # exactly that and made the scheme look twice as good as it is.
    for j in range(1, JUNCTIONS + 1):
        x = j * SEGMENT_M
        nodes.append(f'  <node id="n{j}" x="{x:.0f}" y="300"/>')
        nodes.append(f'  <node id="s{j}" x="{x:.0f}" y="-300"/>')
    # The flyover needs its own geometry or netconvert merges it into the
    # arterial and the whole comparison silently becomes one road.
    nodes.append('  <node id="up" x="60" y="40"/>')
    nodes.append(f'  <node id="down" x="{(JUNCTIONS + 1) * SEGMENT_M - 60:.0f}" y="40"/>')
    nodes.append("</nodes>")
    (OUT / "g.nod.xml").write_text("\n".join(nodes) + "\n")

    edges = ["<edges>"]
    chain = ["in", *[f"j{j}" for j in range(1, JUNCTIONS + 1)], "out"]
    for a, b in itertools.pairwise(chain):
        edges.append(
            f'  <edge id="g_{a}_{b}" from="{a}" to="{b}" '
            f'numLanes="{LANES_AT_GRADE}" speed="{SPEED_AT_GRADE}"/>'
        )
    for j in range(1, JUNCTIONS + 1):
        edges.append(
            f'  <edge id="x_n{j}" from="n{j}" to="j{j}" numLanes="2" speed="{SPEED_AT_GRADE}"/>'
        )
        edges.append(
            f'  <edge id="x_j{j}s" from="j{j}" to="s{j}" numLanes="2" speed="{SPEED_AT_GRADE}"/>'
        )
    # The scheme: a grade-separated pair of lanes over every junction.
    edges.append(
        f'  <edge id="ramp_up" from="in" to="up" numLanes="{SCHEME["lanes_each_way"]}" '
        f'speed="{SPEED_AT_GRADE}"/>'
    )
    edges.append(
        f'  <edge id="flyover" from="up" to="down" numLanes="{SCHEME["lanes_each_way"]}" '
        f'speed="{SPEED_ELEVATED}"/>'
    )
    edges.append(
        f'  <edge id="ramp_down" from="down" to="out" '
        f'numLanes="{SCHEME["lanes_each_way"]}" speed="{SPEED_AT_GRADE}"/>'
    )
    edges.append("</edges>")
    (OUT / "g.edg.xml").write_text("\n".join(edges) + "\n")

    subprocess.run(  # noqa: S603 — binary resolved by sumolib, args are literals
        [
            checkBinary("netconvert"),
            "-n",
            str(OUT / "g.nod.xml"),
            "-e",
            str(OUT / "g.edg.xml"),
            "-o",
            str(OUT / "g.net.xml"),
            "--no-turnarounds",
            "--tls.default-type",
            "static",
        ],
        check=True,
        capture_output=True,
    )

    # Let netconvert derive the phases. Hand-writing a state string means
    # counting links in the order netconvert happens to assign them, which is
    # how a previous experiment in this repo shipped an eight-character plan
    # for a junction with six links and measured nothing for a day.
    (OUT / "tls.add.xml").write_text("<additional>\n</additional>\n")


def write_routes(through_share: float, *, elevated: bool, induced: float = 0.0) -> None:
    """Through traffic takes the flyover when it exists; local traffic never does."""
    body = Path("sim/vtypes.add.xml").read_text().replace("</additional>", "")
    demand = DEMAND_VEH_H * (1 + induced)
    chain = ["in", *[f"j{j}" for j in range(1, JUNCTIONS + 1)], "out"]
    at_grade = " ".join(f"g_{a}_{b}" for a, b in itertools.pairwise(chain))
    over = "ramp_up flyover ramp_down"

    for cls, share in MIX.items():
        for label, portion, route in (
            ("through", through_share, over if elevated else at_grade),
            ("local", 1 - through_share, at_grade),
        ):
            rate = demand * share * portion
            if rate < 1:
                continue
            body += (
                f'  <flow id="f_{label}_{cls}" type="{cls}" begin="0" end="{DURATION_S}" '
                f'vehsPerHour="{rate:.1f}" departLane="random" departSpeed="max">\n'
                f'    <route edges="{route}"/>\n'
                f"  </flow>\n"
            )

    # Cross traffic. Identical in both arms, so it never moves the comparison —
    # it is there so the arterial's red phase is earned rather than imposed.
    for j in range(1, JUNCTIONS + 1):
        for cls, share in MIX.items():
            rate = CROSS_VEH_H * share
            if rate < 1:
                continue
            body += (
                f'  <flow id="f_cross{j}_{cls}" type="{cls}" begin="0" end="{DURATION_S}" '
                f'vehsPerHour="{rate:.1f}" departLane="random" departSpeed="max">\n'
                f'    <route edges="x_n{j} x_j{j}s"/>\n'
                f"  </flow>\n"
            )
    (OUT / "g.rou.xml").write_text(body + "</additional>\n")


def run(
    through_share: float, *, elevated: bool, seed: int, induced: float = 0.0
) -> dict[str, float] | None:
    write_routes(through_share, elevated=elevated, induced=induced)
    (OUT / "g.sumocfg").write_text(
        f"""<configuration>
  <input>
    <net-file value="g.net.xml"/>
    <route-files value="g.rou.xml"/>
    <additional-files value="tls.add.xml"/>
  </input>
  <output><tripinfo-output value="trips.xml"/></output>
  <time><begin value="0"/><end value="{DURATION_S + 1800}"/></time>
  <processing><time-to-teleport value="-1"/></processing>
  <random_number><seed value="{seed}"/></random_number>
</configuration>
"""
    )
    subprocess.run(  # noqa: S603 — binary resolved by sumolib, args are literals
        [checkBinary("sumo"), "-c", "g.sumocfg"],
        check=True,
        capture_output=True,
        cwd=OUT,
    )

    groups: dict[str, list[float]] = {"through": [], "local": []}
    # S314: written by SUMO one line above. No untrusted party in the loop.
    for _, element in ET.iterparse(OUT / "trips.xml"):  # noqa: S314
        if element.tag != "tripinfo":
            continue
        trip_id = element.get("id") or ""
        loss = element.get("timeLoss")
        if loss is None:
            continue
        for label in groups:
            if trip_id.startswith(f"f_{label}_"):
                groups[label].append(float(loss))
    if not groups["through"] or not groups["local"]:
        return None
    everyone = groups["through"] + groups["local"]
    return {
        "through_delay_s": statistics.fmean(groups["through"]),
        "local_delay_s": statistics.fmean(groups["local"]),
        "mean_delay_s": statistics.fmean(everyone),
        "trips": float(len(everyone)),
    }


def interval(values: list[float]) -> tuple[float, float, float]:
    """Mean and a 95% interval. Returns (mean, low, high)."""
    mean = statistics.fmean(values)
    if len(values) < 2:
        return mean, mean, mean
    # t is close enough to 2 at five seeds that using it directly would be false
    # precision; 2.78 is the two-sided 95% value for four degrees of freedom.
    half = 2.78 * statistics.stdev(values) / (len(values) ** 0.5)
    return mean, mean - half, mean + half


def main() -> None:
    write_network()
    print(
        f"  {SCHEME['name']} — Rs {SCHEME['cost_crore']} crore, "
        f"{SCHEME['length_km']} km, {SCHEME['lanes_each_way']} lanes each way"
    )
    print(
        f"  {JUNCTIONS} signalised junctions bypassed, {DEMAND_VEH_H} veh/h, "
        f"{len(SEEDS)} seeds per arm\n"
    )

    print(
        f"  {'through':>8} {'group':<9} {'without':>9} {'with':>9} "
        f"{'saved':>9} {'95% interval':>18}  verdict"
    )
    rows = []
    for share in THROUGH_SHARES:
        arms: dict[bool, list[dict[str, float]]] = {False: [], True: []}
        for elevated in (False, True):
            for seed in SEEDS:
                row = run(share, elevated=elevated, seed=seed)
                if row is not None:
                    arms[elevated].append(row)
        if not (arms[False] and arms[True]):
            continue

        entry: dict[str, Any] = {"through_share": share, "groups": {}}
        for group in ("through_delay_s", "local_delay_s", "mean_delay_s"):
            without = [r[group] for r in arms[False]]
            with_it = [r[group] for r in arms[True]]
            saved = [w - e for w, e in zip(without, with_it, strict=False)]
            mean, low, high = interval(saved)
            # An interval spanning zero means the seeds disagree about the sign.
            # Reporting the mean there would be reporting noise with a decimal.
            significant = (low > 0) or (high < 0)
            label = group.replace("_delay_s", "")
            print(
                f"  {share:>7.0%} {label:<9} {statistics.fmean(without):>8.1f}s "
                f"{statistics.fmean(with_it):>8.1f}s {mean:>+8.1f}s "
                f"{f'{low:+.1f} to {high:+.1f}':>18}  "
                f"{'real' if significant else 'inside seed noise'}"
            )
            entry["groups"][label] = {
                "without_s": round(statistics.fmean(without), 1),
                "with_s": round(statistics.fmean(with_it), 1),
                "saved_s": round(mean, 1),
                "ci_low_s": round(low, 1),
                "ci_high_s": round(high, 1),
                "significant": significant,
            }
        rows.append(entry)
        print()

    # How much of the saving survives if the road attracts traffic.
    middle = THROUGH_SHARES[len(THROUGH_SHARES) // 2]
    baseline = [run(middle, elevated=False, seed=s) for s in SEEDS]
    without_mean = statistics.fmean([r["mean_delay_s"] for r in baseline if r is not None])
    print(f"  induced demand, at {middle:.0%} through share:")
    print(f"  {'extra traffic':>14} {'mean delay':>11} {'saving':>9} {'of the original':>17}")
    induced_rows = []
    for step in INDUCED_STEPS:
        runs = [run(middle, elevated=True, seed=s, induced=step) for s in SEEDS]
        values = [r["mean_delay_s"] for r in runs if r is not None]
        if not values:
            continue
        with_mean = statistics.fmean(values)
        saved = without_mean - with_mean
        first = induced_rows[0]["saved_s"] if induced_rows else saved
        share_kept = saved / first if first else 0.0
        print(f"  {step:>13.0%} {with_mean:>10.1f}s {saved:>+8.1f}s {share_kept:>16.0%}")
        induced_rows.append(
            {
                "extra_demand": step,
                "mean_delay_s": round(with_mean, 1),
                "saved_s": round(saved, 1),
                "share_of_original_saving": round(share_kept, 3),
            }
        )
    print()

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "scheme": SCHEME,
                "simulator": "SUMO 1.27.1",
                "seeds": list(SEEDS),
                "demand_veh_per_hour": DEMAND_VEH_H,
                "junctions_bypassed": JUNCTIONS,
                "results": rows,
                "induced_demand": {
                    "through_share": middle,
                    "without_scheme_mean_delay_s": round(without_mean, 1),
                    "steps": induced_rows,
                    "note": (
                        "Not a forecast of how much demand a flyover induces, "
                        "which nobody can give honestly. It answers the question "
                        "a sceptical official should ask: how much of the saving "
                        "survives if the road attracts traffic."
                    ),
                },
                "swept_assumption": (
                    "Through share is the proportion of Gopalpura traffic passing "
                    "along the corridor rather than turning off it. Nobody has "
                    "measured it here, and the benefit scales almost entirely "
                    "with it, so it is swept rather than assumed."
                ),
                "reported_separately": (
                    "Through and local traffic are reported apart. A flyover "
                    "serves one and leaves the other at the same signals, and a "
                    "mean over both hides the trade a councillor will be asked "
                    "about."
                ),
                "limits": (
                    "A simulated difference on an abstracted corridor, not a "
                    "prediction of what the built road will do. Ramp queueing, "
                    "merge behaviour at the touchdown and induced demand are all "
                    "absent. Its use is to set up the before-measurement while "
                    "the before still exists."
                ),
                "is_synthetic": True,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote {REPORT}")


if __name__ == "__main__":
    main()
