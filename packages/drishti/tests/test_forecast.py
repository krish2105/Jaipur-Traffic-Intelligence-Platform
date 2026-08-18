"""The ship gate, and the two shaping choices behind it."""

import numpy as np
from pravaah.drishti.forecast import LAGS, Score, build_supervised, prediction_interval


def _score(model: float, baseline: float) -> Score:
    return Score(horizon_min=15, model_mae=model, baseline_mae=baseline, n=1000)


def test_a_model_must_beat_persistence_by_a_margin_not_a_hair() -> None:
    # Half a point of MAE on one holdout is noise, and shipping it buys a
    # retraining pipeline and a version to support in exchange for nothing.
    assert not _score(model=3.95, baseline=4.00).beats_baseline
    assert _score(model=2.43, baseline=3.95).beats_baseline


def test_a_model_worse_than_persistence_never_ships() -> None:
    assert not _score(model=5.0, baseline=4.0).beats_baseline
    assert _score(model=5.0, baseline=4.0).improvement_pct < 0


def test_a_zero_baseline_cannot_manufacture_an_improvement() -> None:
    # Dividing by a perfect baseline would otherwise report infinite gain.
    assert _score(model=1.0, baseline=0.0).improvement_pct == 0.0


def test_model_and_baseline_are_scored_on_identical_rows() -> None:
    # The comparison is only meaningful if both predict the same samples.
    # Returning them together is what guarantees it.
    series = np.arange(40, dtype=float)
    hours = np.tile(np.arange(0, 24, 0.6)[:40], 1)
    dows = np.zeros(40)
    X, y, base = build_supervised(series, hours, dows, horizon_steps=2)
    assert len(X) == len(y) == len(base)
    # Persistence is the value at prediction time, so it must equal the last
    # observation in each row's window.
    # Persistence is the last observation in the window, so both model and
    # baseline stand on identical information.
    assert np.allclose(base, X[:, LAGS - 1])


def test_time_of_day_is_cyclical_so_midnight_is_next_to_23_45() -> None:
    series = np.zeros(20)
    dows = np.zeros(20)
    late = build_supervised(series, np.full(20, 23.75), dows, 1)[0]
    early = build_supervised(series, np.full(20, 0.25), dows, 1)[0]
    # Distance in (sin, cos) space, which is the thing that matters: 23:45 and
    # 00:15 land next to each other. An integer hour would put them 23.5 apart
    # and make the trees spend splits rediscovering that midnight wraps.
    separation = float(np.linalg.norm(late[0, -3:-1] - early[0, -3:-1]))
    assert separation < 0.2


def test_the_interval_is_empirical_and_may_be_asymmetric() -> None:
    # Congestion residuals are skewed: a link can be far worse than predicted
    # much more easily than far better than free-flowing. A symmetric interval
    # understates the side an operations room cares about.
    residuals = np.concatenate([np.full(90, -1.0), np.full(10, 25.0)])
    low, high = prediction_interval(residuals)
    assert low < 0 < high
    assert abs(high) > abs(low)


def test_an_empty_residual_set_yields_no_interval() -> None:
    assert prediction_interval(np.empty(0)) == (0.0, 0.0)
