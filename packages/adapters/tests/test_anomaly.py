"""The detector's contract, in the two directions that matter.

These are not coverage tests. Each one pins a decision that a plausible
refactor would quietly reverse, and every reversal here is a demo that shows a
Jaipur official either a flood of false alarms or an empty queue.
"""

from pravaah.adapters.anomaly import (
    MIN_ABSOLUTE_RESIDUAL,
    Z_FLOOR,
    confidence_for,
    is_anomalous,
    severity_for,
)


def test_a_link_running_better_than_usual_is_never_an_incident() -> None:
    # An unsigned residual would make a public holiday look like a city-wide
    # emergency: hugely unusual, and hugely *good*.
    assert not is_anomalous(residual=-40.0, z=9.0)


def test_a_statistically_wild_but_tiny_residual_is_rejected() -> None:
    # A link with a near-zero MAD produces enormous z-scores from noise.
    assert not is_anomalous(residual=3.0, z=40.0)


def test_a_large_residual_on_a_variable_link_is_rejected() -> None:
    # 25 points worse than median is nothing on a link that swings 25 points
    # routinely. This is the case an absolute threshold gets wrong.
    assert not is_anomalous(residual=25.0, z=1.4)


def test_both_tests_passing_reports_an_incident() -> None:
    assert is_anomalous(residual=MIN_ABSOLUTE_RESIDUAL, z=Z_FLOOR)


def test_severity_bands_are_ordered_and_reachable() -> None:
    assert severity_for(2.6) == "low"
    assert severity_for(3.9) == "medium"
    assert severity_for(5.0) == "high"
    assert severity_for(7.2) == "critical"


def test_confidence_never_claims_certainty() -> None:
    # docs/07 §6. A residual-based detector does not get to say 1.00.
    assert confidence_for(100.0) < 1.0
    assert confidence_for(100.0) == confidence_for(8.0)  # capped, not asymptotic


def test_confidence_rises_with_the_z_score() -> None:
    scores = [confidence_for(z) for z in (2.6, 3.5, 4.5, 6.0, 8.0)]
    assert scores == sorted(scores)
    assert all(0.5 <= s <= 0.97 for s in scores)
