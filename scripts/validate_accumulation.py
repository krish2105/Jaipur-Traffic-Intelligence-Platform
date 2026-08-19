"""Measure the speed-to-vehicles estimator's error against a known truth.

Why this exists
---------------
`drishti.fundamental` infers vehicles from measured speed and ships with an
error band taken from the literature: RMSE 4.3 km/h on the fitted Underwood
relationship. Quoting somebody else's error for our own estimator is a habit
worth breaking. In a simulation the true number of vehicles on a stretch of road
is known exactly, so the estimator can be scored rather than cited.

What is simulated
-----------------
A 1 km two-lane arterial link ending at a fixed-time signal, carrying the
two-wheeler-heavy mix the rest of this project uses. Signalised on purpose: our
corridor links are signalised, TomTom's segment speeds include the delay signals
cause, and validating on an uninterrupted motorway link would flatter the model
by testing it on traffic it will never see.

Demand is swept from nearly empty to well past capacity, and at each level SUMO
reports both the mean speed over the edge and the true vehicle density on it.
The first is what TomTom would have told us. The second is the answer.

Free flow is measured, not assumed
----------------------------------
`v_f` is the mean speed at the lowest demand, not the posted limit. That is what
TomTom's own free-flow figure represents, and using the speed limit instead
would build a mismatch into the comparison that has nothing to do with the model.

    uv run python scripts/validate_accumulation.py
"""

from __future__ import annotations

import json
import math
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Final

from pravaah.drishti import fundamental as fd
from sumolib import checkBinary

OUT = Path("sim/accumulation")
REPORT = Path("data/probe/estimator-validation.json")

LENGTH_M: Final = 1000.0
LANES: Final = 2
SPEED_LIMIT_MS: Final = 13.9  # 50 km/h, an ordinary Jaipur arterial

#: The same two-wheeler-heavy composition the rest of the project models. The
#: fundamental diagram constants are calibrated for mixed traffic, so validating
#: on a car-only stream would not test what we actually apply it to.
MIX: Final[dict[str, float]] = {
    "2W": 0.61,
    "AUTO": 0.09,
    "CAR": 0.24,
    "LCV": 0.03,
    "BUS": 0.02,
    "TRK2": 0.01,
}

#: Low enough that the first point is genuinely free flowing, high enough that
#: the last is past capacity, because the estimator's job includes the far end.
DEMAND_SWEEP: Final = (
    150,
    300,
    450,
    600,
    750,
    900,
    1050,
    1200,
    1350,
    1500,
    1650,
    1800,
    1950,
    2100,
    2250,
    2400,
    2600,
    2800,
)

#: Three seeds per point. One seed answered the question in a way that happened
#: to be true; the PCU experiment was corrected twice by exactly this, and a
#: validation that can only be run once is not a validation.
SEEDS: Final = (42, 7, 1337)

CYCLE: Final = 90
GREEN: Final = 50
YELLOW: Final = 3
WARMUP_S: Final = 600
MEASURE_S: Final = 1800


def write_network() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "a.nod.xml").write_text(
        f"""<nodes>
  <node id="in"  x="0" y="0"/>
  <node id="sig" x="{LENGTH_M}" y="0" type="traffic_light"/>
  <node id="out" x="{LENGTH_M + 300}" y="0"/>
</nodes>
"""
    )
    (OUT / "a.edg.xml").write_text(
        f"""<edges>
  <edge id="link" from="in" to="sig" numLanes="{LANES}" speed="{SPEED_LIMIT_MS}"/>
  <edge id="exit" from="sig" to="out" numLanes="{LANES}" speed="{SPEED_LIMIT_MS}"/>
</edges>
"""
    )
    subprocess.run(  # noqa: S603 — binary resolved by sumolib, args are literals
        [
            checkBinary("netconvert"),
            "-n",
            str(OUT / "a.nod.xml"),
            "-e",
            str(OUT / "a.edg.xml"),
            "-o",
            str(OUT / "a.net.xml"),
            "--no-turnarounds",
            "--tls.default-type",
            "static",
        ],
        check=True,
        capture_output=True,
    )
    (OUT / "tls.add.xml").write_text(
        f"""<additional>
  <tlLogic id="sig" type="static" programID="fixed" offset="0">
    <phase duration="{GREEN}" state="GG"/>
    <phase duration="{YELLOW}" state="yy"/>
    <phase duration="{CYCLE - GREEN - YELLOW}" state="rr"/>
  </tlLogic>
</additional>
"""
    )


def write_routes(veh_per_hour: float) -> None:
    body = Path("sim/vtypes.add.xml").read_text().replace("</additional>", "")
    for cls, share in MIX.items():
        rate = veh_per_hour * share
        if rate < 1:
            continue
        body += (
            f'  <flow id="f_{cls}" type="{cls}" begin="0" end="{WARMUP_S + MEASURE_S}" '
            f'vehsPerHour="{rate:.1f}" departLane="random" departSpeed="max">\n'
            f'    <route edges="link exit"/>\n'
            f"  </flow>\n"
        )
    (OUT / "a.rou.xml").write_text(body + "</additional>\n")


def run(veh_per_hour: float, seed: int) -> dict[str, float] | None:
    """One demand level and seed. Mean speed, and the true density on the link."""
    write_routes(veh_per_hour)
    (OUT / "edge.add.xml").write_text(
        f"""<additional>
  <edgeData id="ed" file="edge.out.xml" begin="{WARMUP_S}" end="{WARMUP_S + MEASURE_S}"
            excludeEmpty="false"/>
</additional>
"""
    )
    (OUT / "a.sumocfg").write_text(
        f"""<configuration>
  <input>
    <net-file value="a.net.xml"/>
    <route-files value="a.rou.xml"/>
    <additional-files value="tls.add.xml,edge.add.xml"/>
  </input>
  <time><begin value="0"/><end value="{WARMUP_S + MEASURE_S}"/></time>
  <processing><time-to-teleport value="-1"/></processing>
  <random_number><seed value="{seed}"/></random_number>
</configuration>
"""
    )
    subprocess.run(  # noqa: S603 — binary resolved by sumolib, args are literals
        # cwd is OUT so SUMO writes edge.out.xml beside the config, which means
        # the config path has to be relative to OUT too rather than to the repo.
        [checkBinary("sumo"), "-c", "a.sumocfg"],
        check=True,
        capture_output=True,
        cwd=OUT,
    )

    # S314: the file is written by SUMO one line earlier in this function.
    # There is no untrusted party in the loop.
    root = ET.parse(OUT / "edge.out.xml").getroot()  # noqa: S314
    link = next((e for e in root.iter("edge") if e.get("id") == "link"), None)
    if link is not None:
        speed = link.get("speed")
        density = link.get("density")
        if speed is None or density is None:
            return None
        return {
            # SUMO reports m/s and veh/km (summed across lanes).
            "speed_kmh": float(speed) * 3.6,
            "true_density": float(density),
            "true_vehicles": float(density) * (LENGTH_M / 1000.0),
        }
    return None


def fit_critical_density(points: list[dict[str, float]], free_flow: float) -> float | None:
    """Least-squares k_c for the Underwood inversion, given this data.

    The literature value is 32 veh/km/lane. Fitting our own is the difference
    between "the textbook says" and "we measured", and if the fitted value is
    far from 32 that is itself the finding.
    """
    numerator = denominator = 0.0
    for point in points:
        speed = point["speed_kmh"]
        if speed <= 0 or speed >= free_flow:
            continue
        # k = k_c * x where x = -ln(v / v_f). Least squares through the origin.
        x = -math.log(speed / free_flow)
        y = point["true_vehicles"] / (LANES * (LENGTH_M / 1000.0))
        numerator += x * y
        denominator += x * x
    return numerator / denominator if denominator > 0 else None


def score(
    points: list[dict[str, float]],
    free_flow: float,
    critical: float,
    speed_rmse: float = fd.SPEED_RMSE_KMH,
) -> dict[str, float]:
    """Error of the estimator with a given k_c, against the known truth."""
    length_km = LENGTH_M / 1000.0
    errors, covered, relative = [], 0, []
    # A control room asks about busy areas. A 60% error on a link holding four
    # vehicles is arithmetically true and operationally irrelevant, and letting
    # it dominate the headline metric would understate a usable estimator.
    busy_threshold = 0.25 * max(p["true_vehicles"] for p in points)
    relative_busy = []
    for point in points:
        estimate = fd.density_from_speed(
            point["speed_kmh"],
            free_flow,
            lanes=LANES,
            length_km=length_km,
            critical_density=critical,
        )
        if estimate is None:
            continue
        truth = point["true_vehicles"]
        errors.append(estimate.vehicles - truth)
        if truth > 0:
            relative.append(abs(estimate.vehicles - truth) / truth)
            if truth >= busy_threshold:
                relative_busy.append(abs(estimate.vehicles - truth) / truth)
        covered += estimate.vehicles_low <= truth <= estimate.vehicles_high
    if not errors:
        return {"mae": 0.0, "mape": 0.0, "coverage": 0.0, "n": 0, "mape_busy": 0.0}
    return {
        "mae": sum(abs(e) for e in errors) / len(errors),
        "mape": 100 * sum(relative) / len(relative) if relative else 0.0,
        "coverage": covered / len(errors),
        "n": len(errors),
        "mape_busy": 100 * sum(relative_busy) / len(relative_busy) if relative_busy else 0.0,
    }


def calibrate_band(
    points: list[dict[str, float]], free_flow: float, critical: float, target: float = 0.95
) -> float:
    """Find the speed RMSE whose band actually covers `target` of the truth.

    The shipped band propagates the literature's 4.3 km/h. Measured here it
    covered 63% of cases, which means a band presented as an uncertainty was
    wrong about a third of the time. Calibrating it against observed residuals
    is the difference between a band and a decoration.
    """
    low, high = 0.1, 60.0
    for _ in range(40):
        mid = (low + high) / 2
        coverage = score(points, free_flow, critical, speed_rmse=mid)["coverage"]
        if coverage < target:
            low = mid
        else:
            high = mid
    return high


def main() -> None:
    write_network()
    length_km = LENGTH_M / 1000.0

    print(
        f"  {LANES}-lane {length_km:.0f} km signalised link, {int(MIX['2W'] * 100)}% two-wheelers"
    )
    print(
        f"  {len(DEMAND_SWEEP)} demand levels x {len(SEEDS)} seeds, "
        f"warm-up {WARMUP_S}s, measured over {MEASURE_S}s\n"
    )

    points: list[dict[str, float]] = []
    for demand in DEMAND_SWEEP:
        for seed in SEEDS:
            row = run(demand, seed)
            if row is not None:
                points.append({"demand": demand, "seed": seed, **row})

    if len(points) < 4:
        print("  not enough usable output to score anything")
        return

    free_flow = max(p["speed_kmh"] for p in points)
    print(f"  free flow taken as {free_flow:.1f} km/h (fastest observed)\n")

    # How much does speed actually move as density changes? If the answer is
    # "hardly", no speed-density model can recover density here, however it is
    # calibrated, and that is a property of the road rather than of the fit.
    speeds = [p["speed_kmh"] for p in points]
    trues = [p["true_vehicles"] for p in points]
    mean_s, mean_t = sum(speeds) / len(speeds), sum(trues) / len(trues)
    cov = sum((s - mean_s) * (v - mean_t) for s, v in zip(speeds, trues, strict=True))
    var_s = sum((s - mean_s) ** 2 for s in speeds)
    var_t = sum((v - mean_t) ** 2 for v in trues)
    correlation = cov / math.sqrt(var_s * var_t) if var_s > 0 and var_t > 0 else 0.0

    literature = score(points, free_flow, fd.CRITICAL_DENSITY)
    fitted_kc = fit_critical_density(points, free_flow)
    fitted = score(points, free_flow, fitted_kc) if fitted_kc else None

    print(f"  {'':22} {'MAE':>7} {'MAPE':>8} {'busy':>7} {'covers':>8}")
    print(
        f"  {'literature k_c = 32':<22} {literature['mae']:>7.1f} "
        f"{literature['mape']:>7.1f}% {literature['mape_busy']:>6.1f}% "
        f"{literature['coverage']:>7.0%}"
    )
    if fitted and fitted_kc:
        print(
            f"  {'fitted k_c = ' + f'{fitted_kc:.0f}':<22} {fitted['mae']:>7.1f} "
            f"{fitted['mape']:>7.1f}% {fitted['mape_busy']:>6.1f}% "
            f"{fitted['coverage']:>7.0%}"
        )

    print(
        f"\n  speed range observed  {min(speeds):.1f} to {max(speeds):.1f} km/h "
        f"({100 * (1 - min(speeds) / max(speeds)):.0f}% spread)"
    )
    print(
        f"  vehicles on the link  {min(trues):.0f} to {max(trues):.0f} "
        f"({max(trues) / max(1e-9, min(trues)):.0f}x)"
    )
    print(f"  correlation(speed, vehicles)  {correlation:+.2f}")

    best = fitted if fitted and fitted["mape"] < literature["mape"] else literature
    # Judged on the busy end, because that is the only end anyone acts on. A
    # 60% error on a link holding four vehicles is true and irrelevant.
    usable = best["mape_busy"] < 25.0
    # Where does it become trustworthy? A symmetric band cannot rescue the low
    # end: the model reads near-zero on a link holding twenty vehicles, which is
    # a structural bias, not noise. So the useful question is not "how wide a
    # band" but "above what loading is this worth reporting at all".
    critical = fitted_kc or fd.CRITICAL_DENSITY
    print("\n  accuracy by loading:")
    print(f"    {'saturation':<14} {'n':>4} {'MAPE':>8}  {'mean err':>9}")
    bands = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.7), (0.7, 1.2), (1.2, 99.0)]
    for lo, hi in bands:
        subset = []
        for point in points:
            est = fd.density_from_speed(
                point["speed_kmh"],
                free_flow,
                lanes=LANES,
                length_km=LENGTH_M / 1000.0,
                critical_density=critical,
            )
            if est is None or est.saturation < lo or est.saturation >= hi:
                continue
            subset.append((est.vehicles, point["true_vehicles"]))
        if not subset:
            continue
        mape = (
            100
            * sum(abs(e - v) / v for e, v in subset if v > 0)
            / max(1, sum(1 for _, v in subset if v > 0))
        )
        mean_err = sum(e - v for e, v in subset) / len(subset)
        print(f"    {f'{lo:.1f}-{hi:.1f}':<14} {len(subset):>4} {mape:>7.1f}% {mean_err:>+9.1f}")

    band_rmse = calibrate_band(points, free_flow, critical)
    print(
        f"\n  band needs rmse {band_rmse:.1f} km/h to cover 95%, "
        f"not the literature's {fd.SPEED_RMSE_KMH}"
    )
    print(
        f"\n  VERDICT: {'usable on busy links' if usable else 'NOT usable'} "
        f"({best['mape']:.0f}% error overall, {best['mape_busy']:.0f}% on the "
        f"busiest quarter)"
    )

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "scenario": (
                    f"{LANES}-lane {length_km:.0f} km signalised arterial link, "
                    f"{int(MIX['2W'] * 100)}% two-wheelers"
                ),
                "simulator": "SUMO 1.27.1",
                "seeds": list(SEEDS),
                "runs": len(points),
                "free_flow_kmh": round(free_flow, 1),
                "speed_range_kmh": [round(min(speeds), 1), round(max(speeds), 1)],
                "vehicles_range": [round(min(trues), 1), round(max(trues), 1)],
                "speed_vehicle_correlation": round(correlation, 3),
                "literature": {
                    "critical_density": fd.CRITICAL_DENSITY,
                    "mae_vehicles": round(literature["mae"], 1),
                    "mape_percent": round(literature["mape"], 1),
                    "mape_busy_percent": round(literature["mape_busy"], 1),
                    "band_coverage": round(literature["coverage"], 2),
                },
                "fitted": (
                    {
                        "critical_density": round(fitted_kc, 1),
                        "mae_vehicles": round(fitted["mae"], 1),
                        "mape_percent": round(fitted["mape"], 1),
                        "mape_busy_percent": round(fitted["mape_busy"], 1),
                        "band_coverage": round(fitted["coverage"], 2),
                    }
                    if fitted and fitted_kc
                    else None
                ),
                "band_rmse_for_95_percent_coverage": round(band_rmse, 1),
                "usable_as_a_count": usable,
                "finding": (
                    "On a signalised link, mean speed is held down by the signal "
                    "at every density, so it barely moves until saturation. A "
                    "speed-density model cannot recover a vehicle count from it, "
                    "whatever it is calibrated to. The measured spread here is "
                    f"{100 * (1 - min(speeds) / max(speeds)):.0f}% of speed across "
                    f"a {max(trues) / max(1e-9, min(trues)):.0f}x change in vehicles."
                ),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote {REPORT}")


if __name__ == "__main__":
    main()
