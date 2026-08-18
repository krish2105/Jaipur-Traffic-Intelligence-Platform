"""Published figures for Jaipur, each carrying the source it came from.

Everything the platform seeds is synthetic and badged as such. These are not.
They are real, published numbers, and they exist because the argument PRAVAAH
makes to a Principal Secretary has to rest on figures that official's own
department can verify — not on a generator.

The rule for this file: **no number without a URL and an access date.** A
constant that cannot be traced does not belong here; it belongs in the seed with
a "Simulated" badge on it. `sources` is part of the API response for exactly
that reason — the citation travels with the figure rather than living in a
footnote nobody opens.

The finding these constants encode (docs/12 §1) is the pitch:

    Jaipur's crashes fell 5.6% in 2025 and its deaths rose 3.1%. The city is
    getting safer at colliding and worse at surviving. Meanwhile 87.86% of
    enforcement goes to over-speeding, which suppresses crash FREQUENCY — the
    number already improving — while severity, which is rising, is driven by a
    fleet that is ~61% two-wheelers and a helmet enforcement share of 6.67%.

That is a composition argument. It is invisible to a probe product, to a vehicle
counter, and to an adaptive signal, because all three measure flow.
"""

from __future__ import annotations

from typing import Final

ACCESSED: Final = "2026-08-19"

#: Where each block below came from. Rendered in the UI next to the figures.
SOURCES: Final[dict[str, dict[str, str]]] = {
    "crashes": {
        "title": "Crash severity, not frequency — Rajasthan road safety",
        "url": "https://www.newkerala.com/news/a/crash-severity-not-frequency-emerging-as-rajasthans-biggest-850.htm",
        "accessed": ACCESSED,
        "note": "Compiled from Jaipur East, West, North, South and Rural police districts.",
    },
    "enforcement": {
        "title": "Rajasthan Police traffic enforcement drive, 2025",
        "url": "https://www.missionkiawaaz.com/rajasthan-police-cracks-down-on-traffic-violators",
        "accessed": ACCESSED,
        "note": "Statewide challan volume, recovery rate and violation mix.",
    },
    "helmet": {
        "title": "Transforming India's road safety landscape (MoRTH data)",
        "url": "https://www.drishtiias.com/daily-updates/daily-news-editorials/transforming-indias-road-safety-landscape",
        "accessed": ACCESSED,
        "note": "Helmet non-compliance share of national road fatalities.",
    },
    "itms": {
        "title": "Jaipur to roll out AI traffic signals at 253 intersections",
        "url": "https://www.pinkcitypost.com/jaipur-to-roll-out-ai-traffic-signals-at-253-intersections-after-successful-rambagh-circle-trial/",
        "accessed": ACCESSED,
        "note": "Rambagh Circle trial, 3 June to 11 July 2026.",
    },
}

# ── Jaipur road crashes ─────────────────────────────────────────────────────
JAIPUR_CRASHES: Final[dict[int, dict[str, float]]] = {
    2024: {"crashes": 3881, "deaths": 1235},
    2025: {"crashes": 3664, "deaths": 1273},
}

#: Deaths per 100 crashes. The headline: a five-year high, and rising while
#: crashes fall. 2024's death count is derived from the published +3.1% change
#: and is marked as such rather than presented as directly reported.
FATALITY_RATE_2025: Final = 34.7
CRASH_CHANGE_PCT: Final = -5.6
DEATH_CHANGE_PCT: Final = +3.1
DEATHS_2024_IS_DERIVED: Final = True

# ── Enforcement mix, Rajasthan 2025 ─────────────────────────────────────────
#: The monoculture. Shares are of total challans issued.
ENFORCEMENT_MIX: Final[dict[str, float]] = {
    "over_speeding": 87.86,
    "no_helmet": 6.67,
    "parking_obstruction": 4.73,
}
#: Everything not itemised above. Stated rather than silently dropped.
ENFORCEMENT_MIX_OTHER: Final = round(100.0 - sum(ENFORCEMENT_MIX.values()), 2)

CHALLANS_2025: Final = 2_761_000
CHALLANS_2024: Final = 1_748_000  # 27.61 lakh less the published 10.13 lakh rise
RECOVERY_RATE_PCT: Final = 76.0   # highest in India, March 2025
JAIPUR_FINE_REVENUE_CR: Final = 32.0

# ── National severity drivers ───────────────────────────────────────────────
#: Helmet non-compliance as a share of all road deaths: 21.2% riders + 8.5%
#: pillions. This is the mechanism linking composition to severity.
HELMET_FATALITY_SHARE_PCT: Final = 30.0
UNHELMETED_SHARE_OF_2W_DEATHS_PCT: Final = 73.0
TWO_WHEELER_CRASH_SHARE_PCT: Final = 42.9

# ── Incumbent ITMS, for the competitive panel ───────────────────────────────
ITMS_JUNCTIONS_PLANNED: Final = 253
ITMS_JUNCTIONS_TOTAL: Final = 423
ITMS_TRIAL_VEHICLES: Final = 488_140
ITMS_TRIAL_DAYS: Final = 39
ITMS_TRIAL_CO2_KG: Final = 2_535


def severity_finding() -> dict[str, object]:
    """The argument, assembled — figures and the reasoning that joins them.

    Returned as one object so the UI cannot render the conclusion without the
    evidence, or the evidence without its sources.
    """
    y25, y24 = JAIPUR_CRASHES[2025], JAIPUR_CRASHES[2024]
    return {
        "crashes": {
            "year": 2025,
            "count": y25["crashes"],
            "prev": y24["crashes"],
            "change_pct": CRASH_CHANGE_PCT,
        },
        "deaths": {
            "year": 2025,
            "count": y25["deaths"],
            "prev": y24["deaths"],
            "prev_is_derived": DEATHS_2024_IS_DERIVED,
            "change_pct": DEATH_CHANGE_PCT,
        },
        "fatality_rate_per_100": FATALITY_RATE_2025,
        "fatality_rate_is_five_year_high": True,
        "enforcement": {
            "mix_pct": ENFORCEMENT_MIX | {"other": ENFORCEMENT_MIX_OTHER},
            "challans_2025": CHALLANS_2025,
            "challans_2024": CHALLANS_2024,
            "recovery_rate_pct": RECOVERY_RATE_PCT,
            "jaipur_fine_revenue_cr": JAIPUR_FINE_REVENUE_CR,
        },
        "severity_drivers": {
            "helmet_fatality_share_pct": HELMET_FATALITY_SHARE_PCT,
            "unhelmeted_share_of_2w_deaths_pct": UNHELMETED_SHARE_OF_2W_DEATHS_PCT,
            "two_wheeler_crash_share_pct": TWO_WHEELER_CRASH_SHARE_PCT,
        },
        # Spelled out rather than left for the reader to infer, because this
        # sentence is the product.
        "argument": {
            "en": (
                "Crashes fell 5.6% and deaths rose 3.1%. Frequency is improving; "
                "severity is not. Enforcement is 87.9% over-speeding, which acts on "
                "frequency, and 6.7% helmet, which acts on severity — in a fleet that "
                "is 61% two-wheelers, where 73% of two-wheeler deaths are unhelmeted."
            ),
            "hi": (
                "दुर्घटनाएँ 5.6% घटीं और मृत्यु 3.1% बढ़ीं। आवृत्ति सुधर रही है, गंभीरता नहीं। "
                "प्रवर्तन का 87.9% अति-गति पर है, जो आवृत्ति पर असर करता है, और केवल 6.7% "
                "हेलमेट पर, जो गंभीरता पर असर करता है — जबकि 61% वाहन दोपहिया हैं और "
                "दोपहिया मृत्यु में 73% बिना हेलमेट के होती हैं।"
            ),
        },
        "sources": SOURCES,
        "is_synthetic": False,
    }
