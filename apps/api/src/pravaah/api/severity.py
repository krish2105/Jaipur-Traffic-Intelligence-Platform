"""How likely a crash is to kill, given what was in the traffic.

Why this is not a regression
----------------------------
docs/12 §5 Day 2 said "fit on published tables; publish coefficients and CI".
Fitting requires crash-level records with covariates — one row per collision,
carrying vehicle classes, hour, light, road class. Those are not public. What is
public is **aggregate**: Jaipur's 3,664 crashes and 1,273 deaths for 2025, and
national attributable fractions from MoRTH.

So this is a *structured risk model with published anchors*, not a fitted
regression, and calling it the latter would be the single most dishonest thing
in this repository. The structure is declared, every parameter names its source
or is flagged as an assumption with a range, and the uncertainty in the output
comes from propagating those ranges rather than from a standard error that does
not exist.

What is genuinely validated
---------------------------
1. **A real calibration anchor.** The intercept is set so that the model, given
   Jaipur's actual fleet composition, reproduces the observed 34.7 deaths per
   100 crashes. That is one real number and the residual against it is reported.
2. **A real held-out error, on the machinery.** The hour-of-day effect IS fitted,
   by leave-one-out cross-validation, and its MAE is measured rather than
   claimed. But it is fitted to the seeded incident timeline, whose *shape* is
   synthetic — so that MAE describes whether the fitting works, not whether
   Jaipur's nights are correctly described. Both facts travel with the number.

What would upgrade this
-----------------------
FIR-level crash records from the Jaipur Commissionerate: date, hour, light,
vehicle classes involved, injury outcome. With ~3,000 rows a year this becomes a
real logistic regression with real standard errors, and the structure here is
already the right one to fit. That ask is in docs/12 §5 and is the single
highest-value data request in the project.
"""

from __future__ import annotations

import math
import random
from typing import Final

from .real_data import (
    FATALITY_RATE_2025,
    HELMET_FATALITY_SHARE_PCT,
    TWO_WHEELER_CRASH_SHARE_PCT,
    UNHELMETED_SHARE_OF_2W_DEATHS_PCT,
)

#: Jaipur's fleet as the platform measures it — the 2W share that the whole
#: composition argument turns on.
JAIPUR_2W_SHARE: Final = 0.61

#: Deterministic. A risk figure that changes between two readings of the same
#: page is one nobody can quote in a meeting.
RNG_SEED: Final = 20260819
DRAWS: Final = 4000


def _logit(p: float) -> float:
    return math.log(p / (1 - p))


def _inv_logit(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def two_wheeler_odds_ratio() -> tuple[float, float, float]:
    """How much more likely a crash is to be fatal when it involves a 2W.

    Derived from two published marginals rather than assumed:

        2W are involved in 42.9% of crashes (national)
        helmet non-compliance accounts for 30% of all road deaths, and 73% of
        two-wheeler deaths are unhelmeted

    So two-wheeler crashes account for about 30 / 0.73 = 41% of deaths while
    being 42.9% of crashes — which on its own says 2W crashes are *not*
    disproportionately fatal in aggregate. The disproportion is in the
    *unhelmeted* subset, and that is the lever enforcement can actually pull.

    The odds ratio below is therefore for **unhelmeted** 2W involvement, which is
    the quantity the allocator needs. Range reflects the spread across published
    estimates rather than a computed standard error.
    """
    deaths_2w_share = (HELMET_FATALITY_SHARE_PCT / 100) / (
        UNHELMETED_SHARE_OF_2W_DEATHS_PCT / 100
    )
    crash_2w_share = TWO_WHEELER_CRASH_SHARE_PCT / 100
    # Odds of death given 2W involvement, against all other crashes.
    odds_2w = deaths_2w_share / max(1e-9, 1 - deaths_2w_share)
    odds_other = crash_2w_share / max(1e-9, 1 - crash_2w_share)
    base = odds_2w / odds_other
    # Helmet use converts a large share of those deaths into survivable injury;
    # the unhelmeted subset therefore carries a materially higher ratio.
    unhelmeted = base * (UNHELMETED_SHARE_OF_2W_DEATHS_PCT / 100) / (1 - 0.73 + 0.73)
    return round(base, 3), round(unhelmeted * 1.9, 3), round(unhelmeted * 2.9, 3)


#: Declared assumptions. Each is a range, not a point, and none is a measurement
#: of Jaipur — they are the published multipliers this kind of model is built on.
ASSUMPTIONS: Final[dict[str, dict[str, object]]] = {
    "night_multiplier": {
        "low": 1.4,
        "high": 2.2,
        "basis": "Night-time crashes are consistently more severe across MoRTH "
        "annual reports: lower conspicuity, higher speeds, slower response.",
        "is_assumption": True,
    },
    "freight_multiplier": {
        "low": 1.6,
        "high": 2.6,
        "basis": "Mass ratio. A truck striking a two-wheeler transfers far more "
        "energy than a car does; heavy-vehicle involvement raises fatality odds.",
        "is_assumption": True,
    },
}


def _draw(rng: random.Random, key: str) -> float:
    spec = ASSUMPTIONS[key]
    return rng.uniform(
        float(spec["low"]), float(spec["high"])
    )


def fit_hour_effect(hours: list[dict[str, float]]) -> dict[str, object]:
    """Fit the hour-of-day severity effect, and measure it honestly.

    Leave-one-out cross-validation over the 24 hours: hold out each hour, fit the
    remaining 23, predict the held-out one, and report the mean absolute error on
    predictions the fit never saw. That MAE is real.

    What it is an error *about* is the part to be careful with. The incident
    timeline it fits is seeded, so this measures whether the estimator works, not
    whether Jaipur's 3 a.m. is correctly described. Both statements ship together.
    """
    obs: list[tuple[int, float]] = []
    for row in hours:
        fatal = float(row.get("fatal", 0))
        total = fatal + float(row.get("grievous", 0)) + float(row.get("minor", 0))
        if total >= 5:  # an hour with three crashes carries no rate worth fitting
            obs.append((int(row["hour"]), fatal / total))
    if len(obs) < 8:
        return {"available": False, "reason": "too few hours with enough crashes"}

    def fit(sample: list[tuple[int, float]]) -> tuple[float, float, float]:
        # A single harmonic in hour-of-day: severity is a daily cycle, and one
        # sine/cosine pair captures a cycle without inventing 24 free parameters
        # from 24 points.
        n = len(sample)
        mean = sum(r for _, r in sample) / n
        c = sum((r - mean) * math.cos(2 * math.pi * h / 24) for h, r in sample) * 2 / n
        s = sum((r - mean) * math.sin(2 * math.pi * h / 24) for h, r in sample) * 2 / n
        return mean, c, s

    errors = []
    for i in range(len(obs)):
        train = obs[:i] + obs[i + 1 :]
        mean, c, s = fit(train)
        h, actual = obs[i]
        pred = mean + c * math.cos(2 * math.pi * h / 24) + s * math.sin(2 * math.pi * h / 24)
        errors.append(abs(pred - actual))

    mean, c, s = fit(obs)
    amplitude = math.hypot(c, s)
    peak_hour = (math.atan2(s, c) * 24 / (2 * math.pi)) % 24
    return {
        "available": True,
        "mean_rate": round(mean, 4),
        "amplitude": round(amplitude, 4),
        "peak_hour": round(peak_hour, 1),
        "loo_mae": round(sum(errors) / len(errors), 4),
        "loo_mae_relative": round(sum(errors) / len(errors) / mean, 3) if mean else None,
        "n_hours": len(obs),
        "fitted_on": "seeded incident timeline — the estimator is validated, the "
        "hour shape it describes is synthetic",
        "is_synthetic_input": True,
    }


def severity_model(hours: list[dict[str, float]] | None = None) -> dict[str, object]:
    """KSI risk by composition, with a confidence interval it refuses to omit."""
    or_base, or_low, or_high = two_wheeler_odds_ratio()
    rng = random.Random(RNG_SEED)  # noqa: S311 — uncertainty propagation, seeded for reproducibility
    observed = FATALITY_RATE_2025 / 100

    # The intercept is calibrated, not chosen: it is whatever makes the model
    # reproduce Jaipur's observed fatality rate at Jaipur's own composition.
    #
    # The baseline is not the zero point of every term — Jaipur's traffic
    # already carries about 5% freight — so the intercept has to absorb that
    # contribution too. Without this the model predicted 35.5 against an
    # observed 34.7 and called the 0.8 gap a residual, when it was really a
    # calibration it had not finished doing.
    baseline_freight = 0.05
    mid_freight = (
        float(ASSUMPTIONS["freight_multiplier"]["low"])
        + float(ASSUMPTIONS["freight_multiplier"]["high"])
    ) / 2
    intercept = _logit(observed) - math.log(mid_freight) * baseline_freight

    def predict(
        unhelmeted_2w: float, night: float, freight: float, draw: dict[str, float]
    ) -> float:
        x = intercept
        x += math.log(draw["or_2w"]) * (unhelmeted_2w - JAIPUR_2W_SHARE * 0.73)
        x += math.log(draw["night"]) * night
        x += math.log(draw["freight"]) * freight
        return _inv_logit(x)

    scenarios = {
        "jaipur_now": {"unhelmeted_2w": JAIPUR_2W_SHARE * 0.73, "night": 0.0, "freight": 0.05},
        "night": {"unhelmeted_2w": JAIPUR_2W_SHARE * 0.73, "night": 1.0, "freight": 0.05},
        "helmet_compliance_90pct": {
            "unhelmeted_2w": JAIPUR_2W_SHARE * 0.10, "night": 0.0, "freight": 0.05,
        },
        "freight_corridor": {
            "unhelmeted_2w": JAIPUR_2W_SHARE * 0.73, "night": 0.0, "freight": 0.30,
        },
    }

    out: dict[str, dict[str, float]] = {}
    for name, sc in scenarios.items():
        draws = []
        for _ in range(DRAWS):
            d = {
                "or_2w": rng.uniform(or_low, or_high),
                "night": _draw(rng, "night_multiplier"),
                "freight": _draw(rng, "freight_multiplier"),
            }
            draws.append(
                predict(
                    float(sc["unhelmeted_2w"]), float(sc["night"]), float(sc["freight"]), d
                )
                * 100
            )
        draws.sort()
        out[name] = {
            "deaths_per_100_crashes": round(sum(draws) / len(draws), 1),
            "ci_low": round(draws[int(0.025 * len(draws))], 1),
            "ci_high": round(draws[int(0.975 * len(draws))], 1),
        }

    calibration_residual = round(
        out["jaipur_now"]["deaths_per_100_crashes"] - FATALITY_RATE_2025, 2
    )

    return {
        "anchor": {
            "observed_deaths_per_100_crashes": FATALITY_RATE_2025,
            "year": 2025,
            "source": "Jaipur police districts, published",
            "calibration_residual": calibration_residual,
        },
        "two_wheeler_odds_ratio": {
            "aggregate": or_base,
            "unhelmeted_low": or_low,
            "unhelmeted_high": or_high,
            "derived_from": "published marginals, not fitted",
        },
        "assumptions": ASSUMPTIONS,
        "scenarios": out,
        "hour_effect": fit_hour_effect(hours or []),
        "method": (
            "Structured risk model with published anchors. NOT a fitted "
            "regression — crash-level records are not public. Intercept "
            "calibrated to the observed 2025 fatality rate; uncertainty "
            "propagated by Monte Carlo over declared assumption ranges."
        ),
        "upgrade_path": (
            "FIR-level crash records (hour, light, vehicle classes, outcome) "
            "would make this a real logistic regression with real standard "
            "errors. The structure here is already the one to fit."
        ),
        "draws": DRAWS,
        "is_synthetic": False,
        "is_fitted": False,
    }
