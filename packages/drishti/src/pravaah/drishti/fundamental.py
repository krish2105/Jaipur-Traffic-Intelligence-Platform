"""Speed to density to vehicles: the estimator that answers the area question.

The question this exists for
----------------------------
"How many vehicles are in this area right now." Until now the honest answer was
zero, because vehicle counts need cameras and there is no camera feed. Every
thana read `vehicles_per_hour: 0` and `links_measured: 0`, which was true and
was also a hole where the product's central claim should be.

TomTom now gives measured speed on 90 corridor links. Speed alone is not a
count, but traffic flow theory has connected the two since the 1930s, and the
connection is not a fudge: it is the fundamental diagram.

Why Underwood and not Greenshields
----------------------------------
Greenshields is linear and the one everyone learns. It fits lane-disciplined
motorway traffic and fits Indian urban arterials badly. Across the Indian
literature the exponential Underwood form is consistently the better fit for
heterogeneous, non-lane-based traffic, reported at R2 = 0.96 and RMSE 4.3 km/h
against field data, versus visibly worse fits for Greenshields and Greenberg.

    Underwood     v = v_f * exp(-k / k_c)
    inverted      k = -k_c * ln(v / v_f)

Its known weakness is the tail: density goes to infinity as speed goes to zero,
so it never reaches a jam density on its own. That is handled by clamping, and
the clamp is stated rather than hidden, because a stopped road is exactly where
someone would want the number most and exactly where this model is weakest.

What this is, precisely
-----------------------
An **estimate**, and it must be labelled one everywhere it surfaces. It is the
same discipline the platform applies to speeds, applied to counts: `measured`
means a camera counted vehicles, `estimated` means this module inferred them
from a measured speed, and the two must never share a label. The error band is
carried on every result rather than offered on request, because a number that
travels without its uncertainty arrives without it.

Free flow comes from the segment, not the literature
----------------------------------------------------
`v_f` is TomTom's own free-flow speed for that segment, not a book value of
65 km/h. A service road and a flyover have different free-flow speeds and using
one constant for both would put the error into every link on the network. The
literature constants are only used for the density parameters, which are
properties of driver behaviour rather than of a particular road.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: Critical density, vehicles per km per lane. MEASURED, not cited.
#:
#: The literature figure for Indian urban arterials is 32, and this module
#: shipped with it for about an hour. Validated against SUMO, where the true
#: vehicle count is known, k_c = 32 was wrong by a factor of nearly three: 63%
#: mean error on busy links and a band that covered the truth 9% of the time.
#: Least squares over 54 runs puts it at 88, which cuts the error on the busiest
#: quarter to 4.2%.
#:
#: The likely reason is that the published 32 is per road rather than per lane,
#: or is calibrated on a lane width Jaipur does not have. Either way the fix is
#: the same and the lesson is the older one: a constant borrowed from a paper is
#: an assumption, not a measurement, until someone checks it against a truth.
#:
#: Re-derive with `scripts/validate_accumulation.py` if the network changes.
CRITICAL_DENSITY = 88.0

#: Jam density, vehicles per km per lane. A clamp, not a model parameter:
#: Underwood approaches infinity as speed approaches zero and never reaches a
#: jam on its own, so this exists only to stop the tail running away.
#:
#: Raised from the literature's 145 when critical density was measured at 88.
#: 145 would have been 1.6x critical, which is not a jam — a fundamental diagram
#: normally has jam several times critical — and worse, the validation observed
#: 139.5 veh/km/lane at 8 km/h on a road that was still moving. A clamp below
#: the densities we have already seen would have been binding inside the range
#: it was meant to sit outside.
#:
#: 250 is roughly four metres per vehicle in a stream that is 61% two-wheelers.
#: It is deliberately above anything observed, so it never silently caps a real
#: answer; when it does bind, `within_model_range` says so.
JAM_DENSITY = 250.0

#: Reported RMSE of the fitted Underwood speed-density relationship, km/h. This
#: is what the error band is propagated from.
SPEED_RMSE_KMH = 4.3

#: Below this the inversion is numerically meaningless and the clamp is doing
#: all the work, so the result says so rather than quoting a number.
MIN_TRUSTWORTHY_SPEED_KMH = 3.0

#: Below this saturation the estimate is not reported as a count at all.
#:
#: Measured, and it is the most important number in this file. Validation error
#: by loading, over 54 SUMO runs:
#:
#:     saturation 0.0-0.2   65.0% error, under-reads by ~18 vehicles
#:     saturation 0.4-0.7    2.8%
#:     saturation 0.7-1.2    9.9%
#:     saturation 1.2+       2.1%
#:
#: The low-end error is structural rather than noisy: on a lightly loaded road
#: the model reads near zero while twenty vehicles are present, and no widening
#: of the uncertainty band repairs that. A search for the band that would cover
#: 95% of cases ran to 60 km/h of speed RMSE without getting there, which is the
#: arithmetic saying the shape is wrong, not the spread.
#:
#: So a count is withheld below this and the regime is reported instead. The
#: number appears exactly where it has been shown to be right, which is also
#: where anyone would act on it.
MIN_REPORTABLE_SATURATION = 0.4


@dataclass(frozen=True)
class DensityEstimate:
    """Density and vehicle count for one link, with the band around them."""

    density: float
    density_low: float
    density_high: float
    vehicles: float
    vehicles_low: float
    vehicles_high: float
    #: k / k_c. Above 1.0 the link is past the point where throughput peaks.
    saturation: float
    regime: str
    #: False when speed fell below the floor and the clamp, not the model,
    #: produced the answer.
    within_model_range: bool
    #: False on a lightly loaded road, where the estimator was measured to be
    #: 65% wrong. The regime is still meaningful; the count is not.
    reportable: bool = True


def regime_for(saturation: float) -> str:
    """Name the traffic state, so a screen can say it in a word.

    The boundary that matters is 1.0. Below it a road is filling; above it every
    further vehicle costs throughput, which is the moment a control room needs
    to act rather than watch.
    """
    if saturation < 0.5:
        return "free"
    if saturation < 1.0:
        return "accumulating"
    if saturation < 2.0:
        return "saturated"
    return "gridlock"


def density_from_speed(
    speed_kmh: float,
    free_flow_kmh: float,
    *,
    lanes: int = 2,
    length_km: float = 1.0,
    critical_density: float = CRITICAL_DENSITY,
    jam_density: float = JAM_DENSITY,
    speed_rmse_kmh: float = SPEED_RMSE_KMH,
) -> DensityEstimate | None:
    """Vehicles on a link, inferred from its measured speed.

    Returns None when the inputs cannot support an estimate at all, rather than
    returning a zero that would be summed into an area total as if it were a
    measurement of an empty road.
    """
    if free_flow_kmh <= 0 or speed_kmh < 0 or lanes <= 0 or length_km <= 0:
        return None

    # At or above free flow the model gives zero or negative density. Zero is
    # the right answer; negative is the model being asked a question outside
    # its range by a probe reading that ran slightly hot.
    if speed_kmh >= free_flow_kmh:
        return DensityEstimate(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "free", True, False)

    within_range = speed_kmh >= MIN_TRUSTWORTHY_SPEED_KMH
    effective = max(speed_kmh, MIN_TRUSTWORTHY_SPEED_KMH)

    density = min(-critical_density * math.log(effective / free_flow_kmh), jam_density)

    # d(k)/d(v) = -k_c / v, so the band widens as the road slows. That is not a
    # defect: at a crawl, speed genuinely stops telling you much about how many
    # vehicles are present, and the band should say so rather than flatter us.
    spread = critical_density * speed_rmse_kmh / effective
    low = max(0.0, density - spread)
    high = min(jam_density, density + spread)

    capacity = lanes * length_km
    return DensityEstimate(
        density=density,
        density_low=low,
        density_high=high,
        vehicles=density * capacity,
        vehicles_low=low * capacity,
        vehicles_high=high * capacity,
        saturation=density / critical_density,
        regime=regime_for(density / critical_density),
        within_model_range=within_range,
        reportable=(density / critical_density) >= MIN_REPORTABLE_SATURATION,
    )


def critical_accumulation(
    links: list[tuple[int, float]], *, critical_density: float = CRITICAL_DENSITY
) -> float:
    """How many vehicles an area holds before throughput starts falling.

    `links` is (lanes, length_km) for every link inside the boundary. This is
    the accumulation at which the area's Macroscopic Fundamental Diagram peaks,
    derived from network geometry rather than fitted from history, so it is
    available on day one instead of after a month of observation.

    Geometry-derived means it assumes every link reaches critical together,
    which a real network does not. It therefore reads slightly high, and is the
    right kind of wrong for a threshold: it warns late rather than crying wolf,
    and a fitted value should replace it once there is history to fit.
    """
    return sum(critical_density * lanes * length_km for lanes, length_km in links)


def method() -> dict[str, object]:
    """The provenance block, so every consumer states the same thing."""
    return {
        "model": "Underwood exponential speed-density, inverted",
        "formula": "k = -k_c * ln(v / v_f)",
        "why": (
            "Consistently the better fit for Indian heterogeneous, non-lane-based "
            "traffic than Greenshields or Greenberg (R2 0.96, RMSE 4.3 km/h)."
        ),
        "critical_density_veh_per_km_lane": CRITICAL_DENSITY,
        "critical_density_source": (
            "Fitted against SUMO ground truth over 54 runs. The literature's 32 "
            "was wrong by nearly threefold and is not used."
        ),
        "jam_density_veh_per_km_lane": JAM_DENSITY,
        "speed_rmse_kmh": SPEED_RMSE_KMH,
        "min_reportable_saturation": MIN_REPORTABLE_SATURATION,
        "measured_error": (
            "2.8% on links at 0.4-0.7 saturation, 2.1% above 1.2, and 65% below "
            "0.2 — which is why a count is withheld below 0.4."
        ),
        "free_flow_source": "per segment, from TomTom, not a literature constant",
        "provenance": "estimated",
        "limits": (
            "This infers vehicles from measured speed. It is not a count. It "
            "cannot distinguish a bus from a scooter, it under-reads lightly "
            "loaded roads badly enough that no figure is given below 0.4 "
            "saturation, and it was calibrated in simulation rather than against "
            "Jaipur counts, which do not exist yet."
        ),
    }
