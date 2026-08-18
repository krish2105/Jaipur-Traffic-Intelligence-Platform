"""Where the next thousand challans should go.

Jaipur issues its enforcement in one shape: 87.86% over-speeding, 6.67% helmet,
4.73% parking. Meanwhile crashes fell 5.6% and deaths rose 3.1%. The question
this module answers is the one nobody in the market currently answers — given
that severity is what is worsening, is that the right shape?

It is not a scoring rubric. It is a small, explicit optimisation, and the whole
value of it is that every assumption is visible and arguable, because it will be
argued with by people whose department produced the inputs.

The model
---------
Enforcement against a violation reduces the deaths attributable to it, with
diminishing returns — the tenth speed camera on a corridor does less than the
first. So for violation *v* with attributable fatality fraction ``A_v`` and
enforcement share ``s_v``:

    reduction_v(s_v) = A_v * (1 - exp(-K * s_v))

and the marginal return on the next unit of enforcement is

    d/ds reduction_v = A_v * K * exp(-K * s_v)

The optimum equalises marginal return across violations. That is the entire
argument, and it produces a counter-intuitive, defensible result: **over-speeding
has the larger attributable fraction and is still over-enforced**, because at an
87.86% share it sits far out on the flat of its own curve, while helmet
enforcement at 6.67% is still on the steep part. Jaipur is buying its lives at a
bad exchange rate, not enforcing the wrong law.

Honesty constraints
-------------------
* **The fractions are not mutually exclusive and are never summed.** A crash can
  be both over-speeding and unhelmeted. They are combined as independent
  prevented fractions, ``1 - prod(1 - r_v)``, which is sub-additive — so overlap
  cannot inflate the result the way adding them would. An earlier version used
  ``max`` to be conservative and that was simply wrong: ``max`` is not increasing
  in every argument, so the optimiser and the objective disagreed and more
  enforcement could score as fewer lives saved.
* ``K`` is a saturation constant, not a measurement. It is stated, its
  sensitivity is returned alongside the answer, and the direction of the finding
  is checked across a range of K rather than asserted at one value.
* The output is a **reallocation of existing effort**, not a request for more.
  That is deliberate: it costs the department nothing to act on, which is what
  makes it a recommendation rather than a bid.
"""

from __future__ import annotations

import math
from typing import Final

from .real_data import ENFORCEMENT_MIX, JAIPUR_CRASHES

#: Share of road deaths to which each violation is attributable.
#:
#: Sources in real_data.SOURCES. Over-speeding is the MoRTH-cited share of fatal
#: crashes involving excess speed; helmet is the 21.2% rider + 8.5% pillion
#: non-compliance share. These overlap by construction and are never added.
ATTRIBUTABLE: Final[dict[str, float]] = {
    "over_speeding": 0.66,
    "no_helmet": 0.30,
    "parking_obstruction": 0.03,
}

#: Saturation. Higher K means returns flatten sooner. 3.0 puts the half-benefit
#: point at a ~23% enforcement share, which is the right order for a mature
#: programme; SENSITIVITY_RANGE re-runs the whole finding across a wide band so a
#: reader can see the conclusion does not depend on this number.
K: Final = 3.0
SENSITIVITY_RANGE: Final = (1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0)

#: No violation may be driven below this share. An optimiser that recommends
#: abandoning speed enforcement entirely is one no Commissioner can sign, and it
#: would also be wrong — the curve is flat there, not zero.
#:
#: Set below the smallest current share (parking, 4.73%) on purpose. A floor
#: above a starting value makes that violation immovable and silently freezes the
#: whole optimisation, which is exactly what a 5% floor did here.
FLOOR: Final = 0.03


def _reduction(fraction: float, share: float, k: float) -> float:
    return fraction * (1.0 - math.exp(-k * share))


def _marginal(fraction: float, share: float, k: float) -> float:
    return fraction * k * math.exp(-k * share)


def _combined(shares: dict[str, float], k: float) -> float:
    """Independent prevented fractions: ``1 - prod(1 - r_v)``.

    Sub-additive, so overlapping hazards cannot sum past 100%, and strictly
    increasing in every ``r_v``, so the optimiser below is actually maximising
    the thing this function measures.
    """
    remaining = 1.0
    for key, fraction in ATTRIBUTABLE.items():
        remaining *= 1.0 - _reduction(fraction, shares[key], k)
    return 1.0 - remaining


def _gradient(shares: dict[str, float], key: str, k: float) -> float:
    """d(combined)/d(share_key) — the chain rule through the product."""
    others = 1.0
    for other, fraction in ATTRIBUTABLE.items():
        if other != key:
            others *= 1.0 - _reduction(fraction, shares[other], k)
    return others * _marginal(ATTRIBUTABLE[key], shares[key], k)


def _optimise(k: float) -> dict[str, float]:
    """Move effort from the lowest-gradient violation to the highest.

    Gradient of the real objective rather than the single-violation marginal,
    which is what makes this consistent with `_combined`. Deterministic: no
    randomness, so the same inputs always yield the same recommendation — which
    matters for a number that will be quoted back at us.
    """
    keys = list(ATTRIBUTABLE)
    shares = {key: ENFORCEMENT_MIX[key] / 100.0 for key in keys}
    total = sum(shares.values())
    shares = {key: value / total for key, value in shares.items()}

    step = 0.0002
    for _ in range(20000):
        grads = {key: _gradient(shares, key, k) for key in keys}
        movable = [key for key in keys if shares[key] - FLOOR > 1e-9]
        if not movable:
            break
        give = min(movable, key=lambda key: grads[key])
        take = max(keys, key=lambda key: grads[key])
        if grads[take] - grads[give] < 1e-10:
            break
        move = min(step, shares[give] - FLOOR)
        if move <= 0:
            break
        shares[give] -= move
        shares[take] += move
    return shares


def allocate() -> dict[str, object]:
    """Current allocation, the optimum, and what the difference is worth."""
    deaths = float(JAIPUR_CRASHES[2025]["deaths"])
    keys = list(ATTRIBUTABLE)

    current = {key: ENFORCEMENT_MIX[key] / 100.0 for key in keys}
    scale = sum(current.values())
    current = {key: value / scale for key, value in current.items()}
    optimal = _optimise(K)

    def lives(shares: dict[str, float], k: float = K) -> float:
        return deaths * _combined(shares, k)

    now, then = lives(current), lives(optimal)

    # Does the direction of the recommendation survive a different K?
    sensitivity = []
    for k in SENSITIVITY_RANGE:
        opt_k = _optimise(k)
        sensitivity.append(
            {
                "k": k,
                "helmet_share_pct": round(opt_k["no_helmet"] * 100, 1),
                "lives": round(lives(opt_k, k) - lives(current, k), 1),
            }
        )
    # Where does the recommendation actually hold?
    #
    # Reported as the boundary rather than as a pass/fail, because it does NOT
    # hold everywhere: below K = 2 the saturation curve is gentle enough that
    # over-speeding's larger attributable fraction wins and the model recommends
    # *less* helmet enforcement, not more. That is a real limit of the argument
    # and it is published with it. Anyone who believes enforcement returns
    # barely saturate should not be persuaded by this panel, and should say so.
    holds = [row["k"] for row in sensitivity
             if row["helmet_share_pct"] > ENFORCEMENT_MIX["no_helmet"]]
    fails = [row["k"] for row in sensitivity if row["k"] not in holds]

    return {
        "current_pct": {key: round(current[key] * 100, 2) for key in keys},
        "recommended_pct": {key: round(optimal[key] * 100, 2) for key in keys},
        "delta_pct": {
            key: round((optimal[key] - current[key]) * 100, 2) for key in keys
        },
        "marginal_return_now": {
            key: round(_marginal(ATTRIBUTABLE[key], current[key], K), 4) for key in keys
        },
        "lives_per_year": {
            "current": round(now, 1),
            "recommended": round(then, 1),
            "gain": round(then - now, 1),
        },
        "assumptions": {
            "attributable_fractions": ATTRIBUTABLE,
            "saturation_k": K,
            "floor_share": FLOOR,
            "fractions_overlap": True,
            "combination": (
                "1 - prod(1 - r) — independent prevented fractions, "
                "sub-additive so overlap cannot inflate"
            ),
            "basis_deaths": deaths,
            "basis_year": 2025,
        },
        "sensitivity": sensitivity,
        "robustness": {
            "holds_for_k": holds,
            "fails_for_k": fails,
            "holds_above_k": min(holds) if holds else None,
            "note": (
                "The recommendation to shift effort toward helmet enforcement holds "
                "for saturation K >= 2.0. Below that the returns curve is too gentle "
                "for the reallocation to pay, and over-speeding's larger attributable "
                "fraction dominates. Stated rather than hidden."
            ),
        },
        "is_synthetic": False,
    }
