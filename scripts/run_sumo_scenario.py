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
import contextlib
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


def run(scenario: str, steps: int = 3600) -> dict[str, float]:
    """Run one hour and return aggregate measures."""
    sumo = checkBinary("sumo")
    traci.start([sumo, "-c", str(SIM / "corridor.sumocfg"), "--no-warnings"])

    arrived = 0
    total_wait = 0.0
    total_time = 0.0
    departed = 0
    removed = 0

    try:
        for step in range(steps):
            traci.simulationStep()
            arrived += traci.simulation.getArrivedNumber()
            departed += traci.simulation.getDepartedNumber()

            if scenario == "lez" and step == 0:
                # The LEZ, applied as the policy actually would be: goods
                # vehicles are prevented from entering, not teleported away
                # mid-journey.
                for type_id in ("TRK2", "LCV"):
                    with contextlib.suppress(traci.TraCIException):
                        traci.vehicletype.setMaxSpeed(type_id, 0.001)

            if scenario == "lez":
                for vid in traci.simulation.getDepartedIDList():
                    if traci.vehicle.getTypeID(vid) in ("TRK2", "LCV"):
                        traci.vehicle.remove(vid)
                        removed += 1

            if step % 600 == 0 and step:
                total_wait += sum(
                    traci.vehicle.getAccumulatedWaitingTime(v)
                    for v in traci.vehicle.getIDList()
                )
                total_time += len(traci.vehicle.getIDList())

        mean_speed = 0.0
        vehicles = traci.vehicle.getIDList()
        if vehicles:
            mean_speed = sum(traci.vehicle.getSpeed(v) for v in vehicles) / len(vehicles)
    finally:
        traci.close()

    return {
        "departed": float(departed),
        "arrived": float(arrived),
        "removed": float(removed),
        "mean_speed_kmh": mean_speed * 3.6,
        "mean_wait_s": (total_wait / total_time) if total_time else 0.0,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="baseline", choices=("baseline", "lez"))
    ap.add_argument("--measured-vehicles", type=int, default=None)
    ap.add_argument("--measured-speed-kmh", type=float, default=None)
    args = ap.parse_args()

    if not (SIM / "corridor.sumocfg").exists():
        print("no network — run scripts/build_sumo_network.py first")
        return 1

    print(f"running {args.scenario} …")
    result = run(args.scenario)
    print(
        f"  departed {result['departed']:,.0f}  arrived {result['arrived']:,.0f}  "
        f"mean speed {result['mean_speed_kmh']:.1f} km/h"
    )
    if result["removed"]:
        print(f"  {result['removed']:,.0f} goods vehicles refused entry")

    if args.scenario != "baseline":
        return 0

    # The gate. Only meaningful for the baseline, which is what is supposed to
    # reproduce reality.
    measured_vehicles = args.measured_vehicles or int(os.environ.get("MEASURED_VEHICLES", 0))
    measured_speed = args.measured_speed_kmh or float(os.environ.get("MEASURED_SPEED", 0))
    if not measured_vehicles or not measured_speed:
        print(f"{DIM}  no measured baseline supplied — gate not evaluated{RESET}")
        return 0

    volume_error = abs(result["departed"] - measured_vehicles) / measured_vehicles
    speed_error = abs(result["mean_speed_kmh"] - measured_speed) / measured_speed
    volume_ok = volume_error <= VOLUME_TOLERANCE
    speed_ok = speed_error <= TRAVEL_TIME_TOLERANCE

    print()
    print(
        f"  volume      {result['departed']:>8,.0f} vs {measured_vehicles:>8,} measured   "
        f"{volume_error * 100:5.1f}%   "
        + (f"{GREEN}within 10%{RESET}" if volume_ok else f"{RED}OUTSIDE 10%{RESET}")
    )
    print(
        f"  mean speed  {result['mean_speed_kmh']:>8.1f} vs {measured_speed:>8.1f} measured   "
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
