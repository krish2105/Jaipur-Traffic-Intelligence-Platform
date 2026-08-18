"""KAVACH — crash severity risk.

**This model predicts severity, not frequency**, and that distinction is the
entire reason the package exists. docs/01 §2 records the finding it is built on:
Jaipur crashes fell 5.6% in 2025 while deaths rose 3.1%. A department that ranks
its black spots by how many crashes happen there will spend its budget on the
busiest junctions; a department that ranks by how likely a crash is to kill
someone will spend it where people die. Those are different lists.

So the target here is: **given that a crash occurred, did someone die?**
Exposure — how much traffic passes, how often crashes happen — is deliberately
not a feature. Including it would smuggle frequency back in through the side
door and produce the ranking we are trying to avoid.

Fatality rather than "fatal or grievous", which covers 86% of crashes in this
warehouse and leaves a model nothing to discriminate on — a score that is high
everywhere cannot rank anything. A department allocating a countermeasure
budget is choosing where people die.

The model is gradient-boosted trees over a handful of interpretable features,
and every score ships with its SHAP attribution. That is not decoration:
`segment_risk` has a CHECK constraint refusing any row whose `top_factors` is
not a non-empty array, so an unexplained score is structurally unable to reach a
human (docs/07 §6).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

import numpy as np

#: Bands an engineer acts on. Four, not a continuous scale: a countermeasure
#: budget is allocated in tiers, and a 0.41 that renders as "high" is more use
#: to a junction engineer than a 0.41 that renders as 0.41.
#:
#: Expressed as MULTIPLES OF THE BASE RATE rather than absolute probabilities.
#: An absolute cut is meaningless without knowing how often a crash is fatal at
#: all: fixed floors of 0.85/0.70/0.50 put every segment in "low" once the
#: target became fatality (base rate 0.34), and would have put every segment in
#: "critical" under the previous injury target (base rate 0.86). The same
#: numbers, opposite and equally useless answers.
#:
#: A multiple says the thing an engineer needs: this segment kills more often
#: than a Jaipur crash normally does, by this much.
BAND_MULTIPLES: Final[tuple[tuple[float, str], ...]] = (
    (1.30, "critical"),
    (1.15, "high"),
    (1.00, "moderate"),
    (0.0, "low"),
)

FEATURES: Final[tuple[str, ...]] = (
    "is_night",
    "speed_limit_kmh",
    "lanes",
    "is_divided",
    "heavy_vehicle_involved",
    "pedestrian_involved",
    "two_wheeler_involved",
    "cause_over_speeding",
    "cause_wrong_side",
    "cause_drunk_driving",
    "cause_pedestrian_crossing",
    "is_wet",
)

#: What an engineer can actually do about each factor. A risk score with no
#: attached action is a number that gets filed; the schema stores these
#: alongside the score so the two arrive together.
COUNTERMEASURES: Final[dict[str, tuple[str, ...]]] = {
    "is_night": (
        "Street lighting audit on this segment",
        "Retro-reflective edge and centre-line marking",
    ),
    "speed_limit_kmh": (
        "Speed-limit review against roadside activity",
        "Vertical deflection or speed table on approach",
    ),
    "pedestrian_involved": (
        "Signalised or raised pedestrian crossing",
        "Footpath continuity and guard-railing review",
    ),
    "two_wheeler_involved": (
        "Helmet enforcement at the adjoining junction",
        "Segregated two-wheeler lane where width permits",
    ),
    "heavy_vehicle_involved": (
        "Freight time-window restriction",
        "Lane discipline enforcement for goods vehicles",
    ),
    "cause_over_speeding": (
        "Speed camera siting review",
        "Gateway treatment on the approach",
    ),
    "cause_wrong_side": (
        "Median closure review — wrong-side movement usually follows a long detour",
        "Directional signage and enforcement",
    ),
    "cause_drunk_driving": ("Night-time breath-testing at the adjoining junction",),
    "cause_pedestrian_crossing": (
        "Refuge island or raised crossing",
        "Crossing distance reduction at the kerb",
    ),
    "is_divided": ("Median treatment review",),
    "is_wet": ("Surface drainage and skid-resistance survey",),
    "lanes": ("Lane-width and merge-taper review",),
}

FACTOR_LABELS: Final[dict[str, tuple[str, str]]] = {
    "is_night": ("crashes at night", "रात में दुर्घटनाएँ"),
    "speed_limit_kmh": ("speed environment", "गति परिवेश"),
    "lanes": ("carriageway width", "सड़क चौड़ाई"),
    "is_divided": ("median treatment", "डिवाइडर"),
    "heavy_vehicle_involved": ("heavy vehicle involved", "भारी वाहन शामिल"),
    "pedestrian_involved": ("pedestrian involved", "पैदल यात्री शामिल"),
    "two_wheeler_involved": ("two-wheeler involved", "दोपहिया शामिल"),
    "cause_over_speeding": ("over-speeding", "तेज़ गति"),
    "cause_wrong_side": ("wrong-side driving", "गलत दिशा"),
    "cause_drunk_driving": ("drink driving", "नशे में वाहन"),
    "cause_pedestrian_crossing": ("pedestrian crossing conflict", "पैदल क्रॉसिंग"),
    "is_wet": ("wet surface", "गीली सतह"),
}


def band_for(risk: float, base_rate: float) -> str:
    """Band a risk against the rate at which crashes are fatal generally.

    `base_rate` is required rather than defaulted: a caller that does not know
    the base rate cannot band a score meaningfully, and letting them pass
    nothing is how the fixed-floor bug above reaches production twice.
    """
    if base_rate <= 0:
        return "low"
    multiple = risk / base_rate
    for floor, name in BAND_MULTIPLES:
        if multiple >= floor:
            return name
    return "low"


@dataclass(frozen=True)
class Factor:
    feature: str
    label_en: str
    label_hi: str
    #: Signed SHAP value in log-odds. Positive raises the severity risk.
    contribution: float

    @property
    def direction(self) -> str:
        return "increases" if self.contribution > 0 else "reduces"

    def as_json(self) -> dict[str, Any]:
        return {
            "feature": self.feature,
            "label": {"en": self.label_en, "hi": self.label_hi},
            "direction": self.direction,
            "shap_value": round(self.contribution, 4),
        }


@dataclass(frozen=True)
class SegmentRisk:
    link_id: int
    severity_risk: float
    risk_band: str
    top_factors: tuple[Factor, ...]
    countermeasures: tuple[str, ...]
    #: Crashes behind this estimate. Reported so a reader can discount a score
    #: built on four crashes — a link with almost no history gets a score that
    #: is mostly the model's prior, and pretending otherwise is how a risk
    #: index acquires false precision.
    crash_count: int


def top_factors_from_shap(
    shap_row: np.ndarray,
    feature_names: tuple[str, ...],
    limit: int = 3,
) -> tuple[Factor, ...]:
    """The largest absolute contributions, signed.

    Absolute magnitude, then signed presentation: an engineer needs to know
    what is *driving* the score, and a factor that strongly reduces risk is as
    informative as one that raises it — "this segment is dangerous despite
    being divided" points somewhere different from "dangerous and undivided".
    """
    order = np.argsort(np.abs(shap_row))[::-1][:limit]
    factors = []
    for index in order:
        name = feature_names[int(index)]
        en, hi = FACTOR_LABELS.get(name, (name, name))
        factors.append(Factor(name, en, hi, float(shap_row[int(index)])))
    return tuple(factors)


def countermeasures_for(factors: tuple[Factor, ...]) -> tuple[str, ...]:
    """Actions for the factors that RAISE risk.

    Only the raising ones. Proposing a countermeasure against a factor that is
    already protective — "improve the median" where the median is what is
    holding the score down — wastes a budget line and undermines the rest of
    the list.
    """
    actions: list[str] = []
    for factor in factors:
        if factor.contribution <= 0:
            continue
        for action in COUNTERMEASURES.get(factor.feature, ()):
            if action not in actions:
                actions.append(action)
    return tuple(actions[:4])
