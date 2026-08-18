"""Banding and attribution — where a risk score becomes a budget decision."""

import numpy as np
from pravaah.kavach.severity import (
    FEATURES,
    Factor,
    band_for,
    countermeasures_for,
    top_factors_from_shap,
)


def test_bands_are_relative_to_the_base_rate() -> None:
    # The same absolute risk means opposite things depending on how often a
    # crash is fatal at all. A fixed floor put every segment into one band
    # twice over — all "low" under a fatality target, all "critical" under an
    # injury one.
    assert band_for(0.44, base_rate=0.337) == "critical"
    assert band_for(0.44, base_rate=0.86) == "low"


def test_a_segment_at_the_base_rate_is_moderate_not_low() -> None:
    # "Average" is not "safe" in a city where a third of crashes kill someone.
    assert band_for(0.337, base_rate=0.337) == "moderate"


def test_an_unknown_base_rate_cannot_produce_a_confident_band() -> None:
    assert band_for(0.9, base_rate=0.0) == "low"


def test_top_factors_are_ranked_by_magnitude_and_keep_their_sign() -> None:
    row = np.zeros(len(FEATURES))
    row[FEATURES.index("pedestrian_involved")] = 0.8
    row[FEATURES.index("is_divided")] = -0.5
    row[FEATURES.index("lanes")] = 0.1
    factors = top_factors_from_shap(row, FEATURES, limit=2)
    assert factors[0].feature == "pedestrian_involved"
    assert factors[0].direction == "increases"
    # A protective factor must survive into the explanation rather than being
    # filtered for being negative — "dangerous despite a median" is a finding.
    assert factors[1].feature == "is_divided"
    assert factors[1].direction == "reduces"


def test_countermeasures_ignore_protective_factors() -> None:
    # Proposing "median treatment review" where the median is what holds the
    # score down wastes a budget line and undermines the rest of the list.
    protective = Factor("is_divided", "median", "डिवाइडर", -0.6)
    raising = Factor("pedestrian_involved", "pedestrian", "पैदल", 0.7)
    actions = countermeasures_for((raising, protective))
    assert any("crossing" in a.lower() for a in actions)
    assert not any("median" in a.lower() for a in actions)


def test_countermeasures_are_capped_so_the_list_stays_actionable() -> None:
    many = tuple(Factor(f, f, f, 0.5) for f in FEATURES[:6])
    assert len(countermeasures_for(many)) <= 4
