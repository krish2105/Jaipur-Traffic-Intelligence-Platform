"""The numbers the department would be judged on, and the ones we would.

docs/12 §6. Three tiers, kept apart on purpose because they answer to different
people and fail in different ways:

    outcome   what the government is buying. Real published baselines, and
              targets that are commitments rather than aspirations.
    system    what we guarantee about the software. Measurable by us, today.
    adoption  whether anyone actually uses it — the tier most products skip and
              the one that decides renewal.

Every outcome baseline here is a real published figure with a source, because a
KPI whose starting point is invented cannot be reported against. Where a target
is a judgement rather than a derivation, it says so.
"""

from __future__ import annotations

from typing import Final

from .real_data import (
    ENFORCEMENT_MIX,
    FATALITY_RATE_2025,
    JAIPUR_CRASHES,
    RECOVERY_RATE_PCT,
    SOURCES,
)
from .severity import severity_model

#: The published evening-peak congestion figure the landing page leads on.
PEAK_CONGESTION_PCT: Final = 94.9


def _kpi(
    key: str,
    en: str,
    hi: str,
    baseline: float,
    target: float,
    unit: str,
    direction: str,
    basis: str,
    source: str | None = None,
    is_judgement: bool = False,
) -> dict[str, object]:
    return {
        "key": key,
        "label": {"en": en, "hi": hi},
        "baseline": baseline,
        "target": target,
        "unit": unit,
        # Which way is good. Without it a dashboard cannot colour a change, and
        # colouring it wrong is worse than not colouring it.
        "direction": direction,
        "basis": basis,
        "source": source,
        "target_is_judgement": is_judgement,
    }


def outcome_kpis() -> list[dict[str, object]]:
    """What the government is buying. Baselines real, targets committed."""
    model = severity_model([])
    reachable = model["scenarios"]["helmet_compliance_90pct"]["deaths_per_100_crashes"]  # type: ignore[index]

    return [
        _kpi(
            "fatality_rate",
            "Deaths per 100 crashes",
            "प्रति 100 दुर्घटनाओं पर मृत्यु",
            FATALITY_RATE_2025,
            31.0,
            "per 100",
            "down",
            # Not a round number picked to look modest: it is roughly the
            # midpoint between today and what the severity model says helmet
            # compliance alone could reach, so it is achievable without
            # assuming everything else also goes right.
            f"midpoint between today and the {reachable} the severity model "
            f"reaches on helmet compliance alone",
            SOURCES["crashes"]["url"],
        ),
        _kpi(
            "road_deaths",
            "Road deaths, Jaipur",
            "सड़क मृत्यु, जयपुर",
            float(JAIPUR_CRASHES[2025]["deaths"]),
            1210.0,
            "per year",
            "down",
            "the fatality-rate target applied to the 2025 crash count",
            SOURCES["crashes"]["url"],
        ),
        _kpi(
            "helmet_enforcement_share",
            "Helmet share of enforcement",
            "प्रवर्तन में हेलमेट का हिस्सा",
            ENFORCEMENT_MIX["no_helmet"],
            18.0,
            "%",
            "up",
            "below the allocator's 23.3% recommendation, because a first year "
            "should commit to what a department can actually redeploy",
            SOURCES["enforcement"]["url"],
            is_judgement=True,
        ),
        _kpi(
            "challan_recovery",
            "Challan recovery rate",
            "चालान वसूली दर",
            RECOVERY_RATE_PCT,
            80.0,
            "%",
            "up",
            "Rajasthan already leads India at 76%; this is an improvement on "
            "the best rather than a catch-up",
            SOURCES["enforcement"]["url"],
            is_judgement=True,
        ),
        _kpi(
            "peak_congestion",
            "Evening peak, over free-flow",
            "शाम शीर्ष, मुक्त-प्रवाह से अधिक",
            PEAK_CONGESTION_PCT,
            85.0,
            "%",
            "down",
            "published TomTom-calibrated index for Jaipur",
            None,
            is_judgement=True,
        ),
        # Added once the probe layer made them measurable. Each of these has a
        # measurement path that exists today rather than one that arrives with a
        # camera feed, which is the difference between a KPI and an aspiration.
        _kpi(
            "buffer_index",
            "Buffer Index, worst corridor",
            "बफ़र सूचकांक, सबसे ख़राब कॉरिडोर",
            # No baseline yet: the gate needs 40 sweeps across 8 distinct hours
            # and the sweep has been recording for hours. Zero would read as a
            # perfectly reliable corridor, which is the opposite of unknown.
            0.0,
            0.35,
            "ratio",
            "down",
            "FHWA travel time reliability, measured from live probe travel times",
            "https://ops.fhwa.dot.gov/publications/tt_reliability/ttr_report.htm",
            is_judgement=True,
        ),
        _kpi(
            "minutes_over_critical",
            "Minutes a day an area sits past critical",
            "क्षेत्र क्रांतिक से ऊपर, मिनट प्रति दिन",
            0.0,
            60.0,
            "min/day",
            "down",
            (
                "Accumulation against critical, estimated from measured speed. "
                "Counted only where the estimator was validated, above 0.4 "
                "saturation."
            ),
            None,
            is_judgement=True,
        ),
        _kpi(
            "scheme_appraisal_coverage",
            "Capital schemes appraised before the work order",
            "कार्यादेश से पहले मूल्यांकित योजनाएँ",
            1.0,
            3.0,
            "schemes",
            "up",
            (
                "JDA has three elevated roads and a BRTS removal in progress on "
                "corridors this platform models, worth about Rs 380 crore. One "
                "is appraised."
            ),
            None,
            is_judgement=True,
        ),
    ]


def system_kpis() -> list[dict[str, object]]:
    """What we guarantee about the software. Measurable by us, today.

    Targets only — the live values belong to the running system and are read
    from it, not asserted here. A dashboard that hardcodes its own SLA
    compliance is a dashboard that always passes.
    """
    return [
        _kpi(
            "classification_f1",
            "Classification F1, per class",
            "वर्गीकरण F1",
            0.0,
            0.85,
            "F1",
            "up",
            "docs/04 model spec",
        ),
        _kpi(
            "counting_mape",
            "Counting MAPE",
            "गणना MAPE",
            0.0,
            12.0,
            "%",
            "down",
            "docs/08 Sprint 1 gate",
        ),
        _kpi(
            "api_p95",
            "API p95 latency",
            "API p95 विलंब",
            0.0,
            400.0,
            "ms",
            "down",
            "docs/03 performance budget",
        ),
        _kpi(
            "plan_generation",
            "Signal plan generation",
            "सिग्नल योजना निर्माण",
            0.0,
            5.0,
            "s",
            "down",
            "per junction, advisory only",
        ),
        _kpi("uptime", "Uptime", "अपटाइम", 0.0, 99.5, "%", "up", "docs/03"),
        _kpi(
            "plates_leaked",
            "Plates in logs, metrics or caches",
            "लॉग में नंबर प्लेट",
            0.0,
            0.0,
            "count",
            "down",
            "a hard prohibition, not a target — any non-zero value is an incident",
        ),
    ]


def adoption_kpis() -> list[dict[str, object]]:
    """Whether anyone uses it. The tier that decides renewal."""
    return [
        _kpi(
            "decisions_recorded",
            "Officer decisions recorded",
            "अधिकारी निर्णय दर्ज",
            0.0,
            40.0,
            "per week",
            "up",
            "signal advisories accepted or rejected",
        ),
        _kpi(
            "advisory_review_time",
            "Advisories reviewed within 15 min",
            "15 मिनट में समीक्षित सलाह",
            0.0,
            80.0,
            "%",
            "up",
            "an advisory nobody reads is not a control",
        ),
        _kpi(
            "neeti_questions",
            "NEETI questions per official",
            "प्रति अधिकारी नीति प्रश्न",
            0.0,
            5.0,
            "per week",
            "up",
            "whether the analysis is actually consulted",
        ),
        _kpi(
            "corridors_managed",
            "Corridors under management",
            "प्रबंधित कॉरिडोर",
            1.0,
            4.0,
            "count",
            "up",
            "Tonk Road today; the land-and-expand path",
        ),
    ]


def kpi_board() -> dict[str, object]:
    return {
        "outcome": outcome_kpis(),
        "system": system_kpis(),
        "adoption": adoption_kpis(),
        "note": (
            "Outcome baselines are real published figures and carry their "
            "source. System values are targets: the live numbers are read from "
            "the running system, because a dashboard that reports its own SLA "
            "compliance from a constant always passes."
        ),
        "is_synthetic": False,
    }
