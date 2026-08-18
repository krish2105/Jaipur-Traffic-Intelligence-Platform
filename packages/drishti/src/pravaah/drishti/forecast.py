"""DRISHTI — short-horizon congestion forecasting.

The console already tells the user what this package has to do: *"persistence-
baseline-0.1.0 — a learned model ships only once it beats this."* That sentence
is a contract, and this module exists to be held to it.

**Persistence is a hard baseline, not a straw man.** For a 15-minute horizon on
a road network, "it will be exactly as congested as it is now" is right most of
the time, and a great many published traffic-forecasting results quietly fail to
beat it. Any model here is scored against persistence on a held-out period, and
`beats_baseline` is what decides whether it ships.

The features are deliberately plain — recent history, time of day, day of week.
A short-horizon congestion forecast is mostly a statement about the diurnal
profile plus the last twenty minutes; reaching for something more elaborate
before beating persistence with something simple is how a model ends up
expensive and no better.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

import numpy as np

MODEL_VERSION: Final = "drishti-gbt-0.1.0"
BASELINE_VERSION: Final = "persistence-baseline-0.1.0"

#: Horizons the console asks for, in minutes.
HORIZONS: Final[tuple[int, ...]] = (15, 30, 60)

#: Fifteen-minute buckets of history fed to the model. Ninety minutes: long
#: enough to carry the shape of a building peak, short enough that a model does
#: not simply memorise the day.
LAGS: Final[int] = 6


@dataclass(frozen=True)
class Score:
    horizon_min: int
    model_mae: float
    baseline_mae: float
    n: int

    @property
    def improvement_pct(self) -> float:
        """How much error the model removes relative to persistence."""
        if self.baseline_mae <= 0:
            return 0.0
        return (self.baseline_mae - self.model_mae) / self.baseline_mae * 100

    @property
    def beats_baseline(self) -> bool:
        """The ship gate.

        A 2% margin, not zero. A model that beats persistence by half a point
        of MAE on one held-out period has not demonstrated anything except that
        it was fitted on the period before it, and shipping it buys a retraining
        pipeline, an inference path and a version to support in exchange for
        noise.
        """
        return self.improvement_pct > 2.0


def build_supervised(
    series: np.ndarray,
    hours: np.ndarray,
    dows: np.ndarray,
    horizon_steps: int,
    lags: int = LAGS,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Turn one link's evenly-spaced series into (X, y, baseline).

    Returns the persistence prediction alongside, from the same rows, so model
    and baseline are always scored on exactly the same samples. Computing them
    separately is how a comparison quietly comes to rest on different data.

    Time of day enters as sine and cosine rather than as an hour number, so that
    23:45 and 00:15 are adjacent to the model. An integer hour puts them
    twenty-three units apart and asks the trees to spend splits rediscovering
    that midnight wraps.
    """
    n = len(series)
    rows, targets, baseline = [], [], []
    for t in range(lags - 1, n - horizon_steps):
        # The window ENDS at t inclusive, and persistence is series[t]. An
        # earlier version ended the window at t-1 while giving persistence
        # series[t], so the baseline saw one observation the model did not —
        # which made the comparison unfair in the baseline's favour. Both must
        # stand on exactly the same information or the margin means nothing.
        window = series[t - lags + 1 : t + 1]
        angle = 2 * np.pi * (hours[t] / 24.0)
        rows.append([
            *window,
            float(window[-1] - window[0]),  # recent trend
            float(window.mean()),
            np.sin(angle),
            np.cos(angle),
            float(dows[t]),
        ])
        targets.append(series[t + horizon_steps])
        # Persistence: the value now, carried forward unchanged.
        baseline.append(series[t])
    if not rows:
        empty = np.empty((0, lags + 5))
        return empty, np.empty(0), np.empty(0)
    return np.asarray(rows), np.asarray(targets), np.asarray(baseline)


def prediction_interval(residuals: np.ndarray) -> tuple[float, float]:
    """An 80% interval from the model's own held-out residuals.

    Empirical quantiles rather than a normal assumption. Congestion residuals
    are skewed — a link can be far worse than predicted much more easily than it
    can be far better than free-flowing — and a symmetric interval understates
    the upside risk, which is the side an operations room cares about.
    """
    if residuals.size == 0:
        return (0.0, 0.0)
    return (float(np.quantile(residuals, 0.10)), float(np.quantile(residuals, 0.90)))
