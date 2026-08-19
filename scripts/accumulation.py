"""How many vehicles are inside an area, from counts at its boundary.

The method
----------
You cannot count what is inside an area by instrumenting every road in it. You
count what crosses the boundary and integrate:

    inside(h+1) = inside(h) + in(h) - out(h)

That is all cordon counting is. It is old, it is standard, and it is what makes
"how many vehicles are in Vaishali Nagar right now" answerable with a handful of
cameras instead of a hundred.

Run on synthetic flow, deliberately
-----------------------------------
No camera feed exists yet. So the inflow and outflow series here are generated
from the corridor's own measured diurnal shape, with an offset between the two
directions: traffic accumulates in the commercial core through the morning and
drains in the evening. That is a *demonstration of the method*, not a
measurement of Jaipur, and every record says so.

What is genuinely worth reading is the drift analysis, which does not depend on
the flow being real.

Drift is the thing that kills cordon counting
---------------------------------------------
Every count has an error. Integration accumulates it. A detector that is 2%
optimistic on a cordon carrying 8,000 vehicles an hour invents 160 vehicles an
hour, which is 3,840 phantom vehicles by the end of a day, on an area that may
only hold 4,000. The estimate is worthless by mid-afternoon and looks perfectly
plausible the whole way.

So this reports, per area, how much accuracy the method actually requires and
how often the count must be re-anchored to a known state. That number is the
real specification for the camera procurement, and nobody asks for it.

    uv run python scripts/accumulation.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Final

AREAS = Path("apps/web/src/data/areas.json")
OUT = Path("apps/web/src/data/accumulation.json")

#: Jaipur's evening peak is bigger than its morning one (docs/01). The shape is
#: the corridor's own measured profile, normalised.
DIURNAL: Final[tuple[float, ...]] = (
    0.18, 0.12, 0.09, 0.08, 0.10, 0.22, 0.45, 0.72, 0.92, 0.85, 0.78, 0.80,
    0.84, 0.82, 0.79, 0.83, 0.90, 0.97, 1.00, 0.93, 0.74, 0.55, 0.38, 0.26,
)

#: Vehicles per hour across one cordon crossing at the daily peak. An arterial
#: entry to a thana catchment, order-of-magnitude.
PEAK_PER_CROSSING: Final = 900

#: Outflow lags inflow by three hours: what arrives in the morning leaves in the
#: evening. This is what makes accumulation rise and fall rather than cancel.
LAG_HOURS: Final = 3

#: Detector error rates to test. 2% is a good camera in good light; 8% is a
#: cheap one at night in monsoon.
ERROR_RATES: Final = (0.01, 0.02, 0.05, 0.08)


def series(crossings: int) -> tuple[list[float], list[float]]:
    """Inflow and outflow across one area's cordon, by hour."""
    scale = crossings * PEAK_PER_CROSSING / 2  # half the crossings face each way
    inflow = [round(scale * d) for d in DIURNAL]
    outflow = [round(scale * DIURNAL[(h - LAG_HOURS) % 24]) for h in range(24)]
    return inflow, outflow


def baseline(inflow: list[float], outflow: list[float]) -> float:
    """The resident population an area must already hold at midnight.

    Starting the integration at zero says the area is empty at 00:00, which is
    false and not harmlessly so: the pre-dawn hours run a net outflow, the count
    hits the floor, mass is destroyed, and the day then ends thousands of
    vehicles above where it started. Total inflow equals total outflow over 24
    hours, so a correct integration must return to its starting value. The first
    version of this did not, and that was the tell.

    The baseline is whatever offset keeps the trough at zero. Physically it is
    the area's resident vehicle population, and measuring it is exactly the
    one-off manual count the method needs to be anchored to reality.
    """
    running, low = 0.0, 0.0
    for h in range(24):
        running += inflow[h] - outflow[h]
        low = min(low, running)
    return -low


def integrate(
    inflow: list[float], outflow: list[float], start: float | None = None
) -> list[float]:
    """inside(h+1) = inside(h) + in(h) - out(h).

    No floor. Clamping at zero silently destroys vehicles and leaves a broken
    estimate looking plausible; a negative value is the signal that the two
    counts have drifted apart, and it should be visible rather than absorbed.
    """
    inside = [baseline(inflow, outflow) if start is None else start]
    for h in range(24):
        inside.append(inside[-1] + inflow[h] - outflow[h])
    return inside[1:]


def drift(inflow: list[float], outflow: list[float], error: float) -> float:
    """Phantom vehicles after 24h when the detector is `error` optimistic.

    Only the inflow is biased. A detector that over-counts does it on both
    cordons, but the two do not cancel: they are offset in time, so the error
    lands on a rising series and a falling one at different hours and leaves a
    residue.
    """
    anchor = baseline(inflow, outflow)
    biased = integrate([v * (1 + error) for v in inflow], outflow, anchor)
    clean = integrate(inflow, outflow, anchor)
    return biased[-1] - clean[-1]


def main() -> None:
    areas = json.loads(AREAS.read_text())
    plan = {row["area"]: row["cameras_needed"] for row in areas["cordon_plan"]}

    results = []
    for area in areas["thanas"]:
        crossings = plan.get(area["name"])
        if not crossings:
            continue
        inflow, outflow = series(crossings)
        inside = integrate(inflow, outflow)
        peak = max(inside)
        peak_hour = inside.index(peak)

        # How long until drift exceeds a tenth of the peak, which is the point
        # the number stops being useful for a decision.
        tolerance = peak * 0.10
        reanchor = {}
        for err in ERROR_RATES:
            per_day = drift(inflow, outflow, err)
            hours = (tolerance / (per_day / 24)) if per_day > 0 else math.inf
            reanchor[f"{int(err * 100)}pct"] = {
                "phantom_vehicles_per_day": round(per_day),
                "reanchor_every_hours": round(hours, 1) if hours != math.inf else None,
            }

        results.append(
            {
                "area": area["name"],
                "cordon_cameras": crossings,
                "peak_inside": round(peak),
                "peak_hour": peak_hour,
                "mean_inside": round(sum(inside) / len(inside)),
                "resident_baseline": round(baseline(inflow, outflow)),
                "conserved": abs(inside[-1] - baseline(inflow, outflow)) < 1,
                "hourly": [round(v) for v in inside],
                "drift": reanchor,
            }
        )

    results.sort(key=lambda r: r["peak_inside"], reverse=True)

    payload = {
        "method": "cordon counting: inside(h+1) = inside(h) + in(h) - out(h)",
        "areas": results,
        "assumptions": {
            "peak_vehicles_per_crossing_per_hour": PEAK_PER_CROSSING,
            "outflow_lag_hours": LAG_HOURS,
            "diurnal_shape": "corridor's own measured profile, normalised",
        },
        "drift_note": (
            "Integration accumulates counting error. A detector 2% optimistic on "
            "a cordon carrying 8,000 vehicles an hour invents 160 an hour, which "
            "is thousands of phantom vehicles by evening on an area that may hold "
            "a few thousand. reanchor_every_hours is how often the count must be "
            "reset to a known state before the estimate stops supporting a "
            "decision. This is the real accuracy specification for the camera "
            "procurement and it is the question nobody asks."
        ),
        "flow_is_synthetic": True,
        "flow_note": (
            "Inflow and outflow are generated from the measured diurnal shape "
            "with a three-hour lag, because no camera feed exists yet. This "
            "demonstrates the method and does not measure Jaipur. Connect a "
            "cordon and the same integration runs on real counts unchanged."
        ),
        "is_synthetic": True,
    }
    OUT.write_text(json.dumps(payload, indent=2))

    print(f"{'area':<34}{'cameras':>8}{'peak inside':>13}{'at':>5}")
    for r in results[:6]:
        print(f"{r['area'][:32]:<34}{r['cordon_cameras']:>8}"
              f"{r['peak_inside']:>13}{r['peak_hour']:>5}:00")

    print("\nhow often the count must be re-anchored, by detector error:")
    sample = results[0]
    print(f"  (for {sample['area'][:40]}, peak {sample['peak_inside']} vehicles)")
    for rate, d in sample["drift"].items():
        h = d["reanchor_every_hours"]
        print(f"    {rate:>5} error  {d['phantom_vehicles_per_day']:>7} phantom/day  "
              f"re-anchor every {h if h else 'never needed'} h")
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
