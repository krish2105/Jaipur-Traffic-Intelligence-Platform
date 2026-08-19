"""The speed-to-vehicles estimator, and the places it must refuse or admit.

This module turns a measured speed into an inferred vehicle count, which is the
most consequential inference the platform makes. Everything downstream — area
accumulation, the saturation regime, the decision to hold a cordon — inherits
whatever this gets wrong. So the tests check three separate things:

  * the arithmetic, against values chosen so the answer is exact
  * the boundaries, where the model leaves its valid range
  * the honesty, that a clamped answer says it was clamped

The exact cases use v = v_f / e. Underwood inverts to k = -k_c * ln(v / v_f),
and ln(1/e) is exactly -1, so density lands exactly on the critical density with
no floating point argument to have.
"""

from __future__ import annotations

import math

import pytest
from pravaah.drishti import fundamental as fd


class TestUnderwoodInversion:
    def test_one_over_e_lands_exactly_on_critical_density(self) -> None:
        # v / v_f = 1/e  ->  ln = -1  ->  k = k_c
        estimate = fd.density_from_speed(100 / math.e, 100.0)
        assert estimate is not None
        assert estimate.density == pytest.approx(fd.CRITICAL_DENSITY)
        assert estimate.saturation == pytest.approx(1.0)

    def test_one_over_e_squared_is_twice_critical(self) -> None:
        estimate = fd.density_from_speed(100 / (math.e**2), 100.0)
        assert estimate is not None
        assert estimate.density == pytest.approx(2 * fd.CRITICAL_DENSITY)
        assert estimate.saturation == pytest.approx(2.0)

    def test_jam_density_sits_well_above_critical(self) -> None:
        # A jam that is only 1.6x critical is not a jam, and would clamp inside
        # the range the model is supposed to cover. This caught exactly that
        # when critical density moved from 32 to 88 and jam stayed at 145.
        assert fd.JAM_DENSITY > 2 * fd.CRITICAL_DENSITY

    def test_vehicles_scale_with_lanes_and_length(self) -> None:
        # Density is per lane per km, so a 4-lane 2 km link holds 8x a 1-lane 1 km.
        narrow = fd.density_from_speed(100 / math.e, 100.0, lanes=1, length_km=1.0)
        wide = fd.density_from_speed(100 / math.e, 100.0, lanes=4, length_km=2.0)
        assert narrow is not None and wide is not None
        assert wide.vehicles == pytest.approx(narrow.vehicles * 8)
        # But density itself is unchanged — it is an intensity, not a total.
        assert wide.density == pytest.approx(narrow.density)


class TestBoundaries:
    def test_free_flow_speed_means_an_empty_road(self) -> None:
        estimate = fd.density_from_speed(53.0, 53.0)
        assert estimate is not None
        assert estimate.density == 0.0
        assert estimate.regime == "free"

    def test_faster_than_free_flow_is_zero_not_negative(self) -> None:
        # A probe reading can run slightly above TomTom's own free-flow figure.
        # Underwood would return a negative density, which would then be summed
        # into an area total and quietly cancel out real vehicles elsewhere.
        estimate = fd.density_from_speed(60.0, 53.0)
        assert estimate is not None
        assert estimate.density == 0.0
        assert estimate.vehicles == 0.0

    def test_a_crawl_is_clamped_and_says_so(self) -> None:
        # Underwood sends density to infinity as speed goes to zero. The clamp
        # is the answer, and `within_model_range` is how the caller finds out
        # the model was not the thing that produced the number.
        estimate = fd.density_from_speed(0.5, 50.0)
        assert estimate is not None
        assert estimate.within_model_range is False
        assert estimate.density <= fd.JAM_DENSITY

    def test_density_never_exceeds_jam(self) -> None:
        for speed in (0.0, 0.1, 1.0, 2.0):
            estimate = fd.density_from_speed(speed, 80.0)
            assert estimate is not None
            assert estimate.density <= fd.JAM_DENSITY
            assert estimate.vehicles_high <= fd.JAM_DENSITY * 2  # default 2 lanes, 1 km

    def test_impossible_inputs_return_none_not_zero(self) -> None:
        # None means "no estimate". Zero means "an empty road". Summing the
        # second where the first was true would report a clear area.
        assert fd.density_from_speed(30.0, 0.0) is None
        assert fd.density_from_speed(30.0, 50.0, lanes=0) is None
        assert fd.density_from_speed(30.0, 50.0, length_km=0) is None
        assert fd.density_from_speed(-1.0, 50.0) is None


class TestUncertainty:
    def test_every_estimate_carries_a_band(self) -> None:
        estimate = fd.density_from_speed(30.0, 53.0)
        assert estimate is not None
        assert estimate.vehicles_low < estimate.vehicles < estimate.vehicles_high

    def test_the_band_widens_as_the_road_slows(self) -> None:
        # dk/dv = -k_c / v, so the slower it goes the less speed tells you. This
        # is the model admitting its weakest point rather than hiding it.
        fast = fd.density_from_speed(45.0, 53.0)
        slow = fd.density_from_speed(12.0, 53.0)
        assert fast is not None and slow is not None
        assert (slow.density_high - slow.density_low) > (fast.density_high - fast.density_low)

    def test_the_band_never_goes_negative(self) -> None:
        estimate = fd.density_from_speed(52.0, 53.0)
        assert estimate is not None
        assert estimate.density_low >= 0.0
        assert estimate.vehicles_low >= 0.0


class TestRegimes:
    @pytest.mark.parametrize(
        ("saturation", "expected"),
        [
            (0.0, "free"),
            (0.49, "free"),
            (0.5, "accumulating"),
            (0.99, "accumulating"),
            (1.0, "saturated"),
            (1.99, "saturated"),
            (2.0, "gridlock"),
            (5.0, "gridlock"),
        ],
    )
    def test_boundaries(self, saturation: float, expected: str) -> None:
        assert fd.regime_for(saturation) == expected

    def test_one_is_the_boundary_that_matters(self) -> None:
        # Below 1.0 a road is filling. Above it, every further vehicle costs
        # throughput — the moment a control room acts rather than watches.
        assert fd.regime_for(0.999) == "accumulating"
        assert fd.regime_for(1.001) == "saturated"


class TestCriticalAccumulation:
    def test_it_is_geometry_times_critical_density(self) -> None:
        # Derived from the constant rather than hard-coded, because the constant
        # is measured and has already moved once: 32 to 88 after validation.
        expected = fd.CRITICAL_DENSITY * 4 * 1.2 * 10
        assert fd.critical_accumulation([(4, 1.2)] * 10) == pytest.approx(expected)

    def test_an_area_with_no_links_holds_nothing(self) -> None:
        assert fd.critical_accumulation([]) == 0.0

    def test_it_scales_with_the_network_not_the_area(self) -> None:
        # Two identical thanas, one with twice the road, hold twice the traffic
        # before throughput turns over. Land area does not enter into it.
        small = fd.critical_accumulation([(2, 1.0)] * 5)
        large = fd.critical_accumulation([(2, 1.0)] * 10)
        assert large == pytest.approx(small * 2)


class TestProvenance:
    def test_the_method_block_calls_it_estimated(self) -> None:
        # This string is what the UI keys its badge off. If it ever says
        # "measured", a modelled count starts wearing a measurement's label.
        assert fd.method()["provenance"] == "estimated"

    def test_the_limits_are_stated_not_implied(self) -> None:
        limits = str(fd.method()["limits"])
        assert "not a count" in limits
