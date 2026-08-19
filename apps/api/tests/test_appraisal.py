"""The statistics that decide whether a scheme appraisal is allowed to claim anything.

The appraisal itself runs SUMO and takes a couple of minutes, so it is not run
here. What is tested is the part that decides what the simulation is permitted
to say: the confidence interval, and the rule that a difference whose interval
spans zero is reported as noise rather than as a saving.

That rule has already earned its place twice in this repo. A 362-second signal
"improvement" turned out to be two identical simulations disagreeing with
themselves, and a corridor result flipped sign between seeds. Both were caught
by refusing to quote a mean without an interval around it, and a government
appraisal is exactly where that failure would be most expensive.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


def _load_appraisal():
    """Import the script by path, since scripts/ is not an installed package."""
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "scripts" / "appraise_scheme.py"
        if candidate.exists():
            spec = importlib.util.spec_from_file_location("appraise_scheme", candidate)
            assert spec and spec.loader
            module = importlib.util.module_from_spec(spec)
            sys.modules["appraise_scheme"] = module
            spec.loader.exec_module(module)
            return module
    pytest.skip("appraise_scheme.py not found")


appraisal = _load_appraisal()


class TestTheInterval:
    def test_identical_runs_have_no_spread(self) -> None:
        mean, low, high = appraisal.interval([10.0] * 5)
        assert (mean, low, high) == (10.0, 10.0, 10.0)

    def test_a_single_run_cannot_produce_an_interval(self) -> None:
        # One seed is an anecdote. It returns its own value as both bounds
        # rather than pretending to a spread it has no basis for.
        mean, low, high = appraisal.interval([42.0])
        assert low == high == mean == 42.0

    def test_the_interval_widens_with_disagreement(self) -> None:
        _, tight_low, tight_high = appraisal.interval([100.0, 101.0, 99.0, 100.0, 100.0])
        _, wide_low, wide_high = appraisal.interval([100.0, 200.0, 10.0, 150.0, 40.0])
        assert (wide_high - wide_low) > (tight_high - tight_low)

    def test_it_is_centred_on_the_mean(self) -> None:
        values = [12.0, 18.0, 15.0, 9.0, 21.0]
        mean, low, high = appraisal.interval(values)
        assert mean == pytest.approx(15.0)
        assert mean - low == pytest.approx(high - mean)


class TestRefusingToReportNoise:
    """An interval spanning zero means the seeds disagree about the sign."""

    def test_a_consistent_saving_is_significant(self) -> None:
        _, low, high = appraisal.interval([120.0, 118.0, 122.0, 119.0, 121.0])
        assert (low > 0) or (high < 0)

    def test_a_saving_the_seeds_disagree_about_is_not(self) -> None:
        # This is the 362-second bug in miniature: a positive mean that five
        # seeds cannot agree on the sign of.
        _, low, high = appraisal.interval([40.0, -35.0, 20.0, -50.0, 30.0])
        assert low < 0 < high
        assert not ((low > 0) or (high < 0))

    def test_a_consistent_worsening_is_also_significant(self) -> None:
        # The rule is about agreement, not about the answer being good news.
        _, _low, high = appraisal.interval([-60.0, -58.0, -62.0, -59.0, -61.0])
        assert high < 0


class TestTheSchemeIsTheRealOne:
    def test_it_describes_the_actual_jda_project(self) -> None:
        # If these drift from what JDA published, the appraisal is about a road
        # that does not exist and the pitch quotes a number for the wrong thing.
        assert appraisal.SCHEME["cost_crore"] == 184.87
        assert appraisal.SCHEME["length_km"] == 2.16
        assert appraisal.SCHEME["lanes_each_way"] == 2

    def test_through_share_is_swept_not_assumed(self) -> None:
        # The benefit scales almost entirely with this, and nobody has measured
        # it for Gopalpura. A single value would be a guess wearing a result.
        assert len(appraisal.THROUGH_SHARES) >= 3

    def test_induced_demand_is_tested_not_ignored(self) -> None:
        # The standard criticism of urban grade separation, and the standard
        # omission from the appraisals that justify them.
        assert max(appraisal.INDUCED_STEPS) >= 0.15

    def test_cross_traffic_exists(self) -> None:
        # Without it the arterial's red phase serves nothing, the corridor pays
        # a penalty no traffic earned, and the flyover scores against an
        # imaginary cost. The first run of this script did exactly that.
        assert appraisal.CROSS_VEH_H > 0

    def test_more_than_one_seed(self) -> None:
        assert len(appraisal.SEEDS) >= 5
