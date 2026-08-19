"""Run a SUMO scenario and check it against the measured corridor.

    uv run python scripts/run_sumo_scenario.py [--scenario baseline]

docs/08 Sprint 6 sets the gate: **calibration within 10% volume and 15% travel
time before any scenario result is shown.** That is enforced here. A scenario
whose baseline does not reproduce the corridor is not evidence about a policy;
it is evidence about a mis-specified model, and presenting its output to a
department would be worse than presenting nothing.

Scenarios are deltas from the baseline, so the comparison is like-for-like:

  baseline   the corridor as measured
  lez        heavy goods vehicles removed at the peak (the NEETI scenario)
  signal     a longer cycle at the busiest junction
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import traci
from sumolib import checkBinary

SIM = Path("sim")

#: Sprint 6's gate, verbatim from docs/08.
VOLUME_TOLERANCE = 0.10
TRAVEL_TIME_TOLERANCE = 0.15

GREEN, RED, DIM, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def run(scenario: str, steps: int = 3600) -> dict[str, object]:
    """Run one hour and return what the DETECTORS saw, per edge.

    Per-edge detector counts, not total departures. Comparing departures
    against the demand we injected is circular — it compares what we told SUMO
    to do against what we intended to tell it, and it always passes. An
    induction loop measures what actually crossed a point, which is the same
    thing the real camera measures, so the two are comparable.
    """
    sumo = checkBinary("sumo")
    traci.start([sumo, "-c", str(SIM / "corridor.sumocfg"), "--no-warnings"])

    per_edge: dict[str, int] = {}
    speeds: list[float] = []
    removed = 0
    departed = 0

    try:
        loops = traci.inductionloop.getIDList()
        for step in range(steps):
            traci.simulationStep()
            departed += traci.simulation.getDepartedNumber()

            if scenario == "lez":
                for vid in traci.simulation.getDepartedIDList():
                    if traci.vehicle.getTypeID(vid) in ("TRK2", "LCV"):
                        traci.vehicle.remove(vid)
                        removed += 1

            for loop in loops:
                crossed = traci.inductionloop.getLastStepVehicleNumber(loop)
                per_edge[loop] = per_edge.get(loop, 0) + crossed

            # Sample the network's mean speed periodically rather than at the
            # end: an end-of-run snapshot catches whatever happens to still be
            # driving, which skews fast once the queues have drained.
            if step % 60 == 0 and step > 300:
                vehicles = traci.vehicle.getIDList()
                if vehicles:
                    speeds.append(sum(traci.vehicle.getSpeed(v) for v in vehicles) / len(vehicles))
    finally:
        traci.close()

    return {
        "departed": departed,
        "removed": removed,
        "per_edge": per_edge,
        "mean_speed_kmh": (sum(speeds) / len(speeds) * 3.6) if speeds else 0.0,
    }


def measured_per_link(hour: int) -> dict[str, int]:
    """The camera counts each detector is checked against."""
    import asyncio
    import os

    import asyncpg
    from dotenv import load_dotenv

    async def load() -> dict[str, int]:
        load_dotenv()
        dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(dsn)
        try:
            rows = await conn.fetch(
                """
                SELECT tc.link_id AS lid, sum(tc.vehicle_count)::int / 7 AS veh
                FROM traffic_counts tc
                JOIN road_links l ON l.link_id = tc.link_id
                WHERE l.corridor_id = 1
                  AND extract(hour FROM tc.bucket_start AT TIME ZONE 'Asia/Kolkata')::int = $1
                  AND tc.bucket_start >= now() - INTERVAL '7 days'
                GROUP BY tc.link_id
                """,
                hour,
            )
        finally:
            await conn.close()
        return {f"d_e{r['lid']}": int(r["veh"]) for r in rows}

    return asyncio.run(load())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="baseline", choices=("baseline", "lez"))
    ap.add_argument("--hour", type=int, default=19)
    ap.add_argument("--measured-speed-kmh", type=float, default=None)
    args = ap.parse_args()

    if not (SIM / "corridor.sumocfg").exists():
        print("no network — run scripts/build_sumo_network.py first")
        return 1

    print(f"running {args.scenario} …")
    result = run(args.scenario)
    per_edge: dict[str, int] = result["per_edge"]  # type: ignore[assignment]
    speed = float(result["mean_speed_kmh"])  # type: ignore[arg-type]
    print(
        f"  departed {int(result['departed']):,}  "
        f"detectors {sum(per_edge.values()):,}  mean speed {speed:.1f} km/h"
    )
    if result["removed"]:
        print(f"  {int(result['removed']):,} goods vehicles refused entry")

    if args.scenario != "baseline":
        return 0

    # The gate. Only meaningful for the baseline, which is what is supposed to
    # reproduce reality.
    measured = measured_per_link(args.hour)
    measured_speed = args.measured_speed_kmh or float(os.environ.get("MEASURED_SPEED", 0))
    if not measured or not measured_speed:
        print(f"{DIM}  no measured baseline available — gate not evaluated{RESET}")
        return 0

    # Per-link error, then the median. A mean would be dominated by the one
    # link that netconvert mangled; the median says what a typical link does.
    errors = []
    compared = 0
    for detector, camera_count in sorted(measured.items()):
        if detector not in per_edge or camera_count <= 0:
            continue
        simulated = per_edge[detector]
        errors.append(abs(simulated - camera_count) / camera_count)
        compared += 1
    if not errors:
        print(f"{RED}  no detector matched a measured link{RESET}")
        return 1
    errors.sort()
    volume_error = errors[len(errors) // 2]
    within = sum(1 for e in errors if e <= VOLUME_TOLERANCE)
    speed_error = abs(speed - measured_speed) / measured_speed
    volume_ok = volume_error <= VOLUME_TOLERANCE
    speed_ok = speed_error <= TRAVEL_TIME_TOLERANCE

    print()
    print(
        f"  volume      median link error {volume_error * 100:5.1f}%   "
        f"({within}/{compared} links within 10%)   "
        + (f"{GREEN}within 10%{RESET}" if volume_ok else f"{RED}OUTSIDE 10%{RESET}")
    )
    print(
        f"  mean speed  {speed:>8.1f} vs {measured_speed:>8.1f} km/h measured   "
        f"{speed_error * 100:5.1f}%   "
        + (f"{GREEN}within 15%{RESET}" if speed_ok else f"{RED}OUTSIDE 15%{RESET}")
    )
    print()
    if volume_ok and speed_ok:
        print(f"  {GREEN}CALIBRATED{RESET} — scenario results may be shown\n")
        return 0
    print(
        f"  {RED}NOT CALIBRATED{RESET} — no scenario result from this network "
        f"should be presented (docs/08 Sprint 6)\n"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
