"""Crashes, violations, defaulter scores and the policy corpus.

The crash series matches the published Jaipur totals in docs/01 §2 — that is the
strongest evidence in the whole pitch, because crashes fell 5.6% in 2025 while
deaths rose 3.1%, and severity is exactly what cannot be seen without classified
counts.

Enforcement data is entirely synthetic and flagged. No real challan data exists
(docs/10), and docs/08 §2 notes that a designed mockup plus the governance
framework is often *more* persuasive to a government audience than a working
scoring engine, because it proves the risk was thought about.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg

# docs/01 §2, Jaipur Police data reported July 2026. Where deaths were not
# published for a year, the fatality rate is interpolated between the years that
# were — and that interpolation is stated here rather than presented as fact.
IST = ZoneInfo("Asia/Kolkata")

CRASH_SERIES: list[tuple[int, int, int | None]] = [
    (2021, 3205, 1106),
    (2022, 3935, 1327),
    (2023, 3893, None),  # deaths not published
    (2024, 3881, None),  # deaths not published
    (2025, 3664, 1273),
]

CAUSES = [
    ("over_speeding", 0.46),
    ("wrong_side", 0.13),
    ("red_light_jump", 0.10),
    ("drunk_driving", 0.08),
    ("overtaking", 0.09),
    ("pedestrian_crossing", 0.08),
    ("vehicle_defect", 0.06),
]

VIOLATION_TYPES = [
    ("no_helmet", 0.38),
    ("red_light", 0.19),
    ("speed", 0.17),
    ("wrong_side", 0.11),
    ("triple_riding", 0.08),
    ("no_seatbelt", 0.05),
    ("lane", 0.02),
]

# docs/04 §9 retrieval corpus. Real instrument names and real provisions; the
# body text is a summary, marked synthetic, not a reproduction of the source.
POLICY_DOCS: list[tuple[str, str, str, str, str]] = [
    (
        "IRC:106-1990 Guidelines for Capacity of Urban Roads in Plain Areas",
        "आईआरसी:106-1990 समतल क्षेत्रों में शहरी सड़कों की क्षमता",
        "irc_code",
        "IRC",
        "en",
    ),
    (
        "IRC:SP:41 Guidelines for Design of At-Grade Intersections",
        "आईआरसी:एसपी:41 समपार चौराहों के डिज़ाइन दिशानिर्देश",
        "irc_code",
        "IRC",
        "en",
    ),
    (
        "IRC:93 Guidelines on Design and Installation of Road Traffic Signals",
        "आईआरसी:93 यातायात संकेतों के डिज़ाइन दिशानिर्देश",
        "irc_code",
        "IRC",
        "en",
    ),
    (
        "Motor Vehicles Act 1988, Section 112 — Limits of Speed",
        "मोटर वाहन अधिनियम 1988, धारा 112 — गति सीमा",
        "mv_act",
        "Government of India",
        "en",
    ),
    (
        "Motor Vehicles Act 1988, Section 129 — Wearing of Protective Headgear",
        "मोटर वाहन अधिनियम 1988, धारा 129 — सुरक्षात्मक हेडगियर",
        "mv_act",
        "Government of India",
        "en",
    ),
    (
        "Motor Vehicles (Amendment) Act 2019 — Revised Penalties",
        "मोटर वाहन (संशोधन) अधिनियम 2019 — संशोधित दंड",
        "mv_act",
        "Government of India",
        "en",
    ),
    (
        "Jaipur Traffic Reform Plan, April 2026 — Model Traffic Corridor",
        "जयपुर यातायात सुधार योजना, अप्रैल 2026 — मॉडल ट्रैफिक कॉरिडोर",
        "notification",
        "Government of Rajasthan",
        "mixed",
    ),
    (
        "Rajasthan Road Safety Policy — Severity Reduction Targets",
        "राजस्थान सड़क सुरक्षा नीति — गंभीरता में कमी के लक्ष्य",
        "circular",
        "Transport Department, Rajasthan",
        "mixed",
    ),
]


def _plate_hash(plate: str, salt: bytes) -> str:
    """The join key. docs/07 §3: HMAC-SHA256, salt held in the edge keystore.
    The raw plate never leaves this function."""
    return hmac.new(salt, plate.encode(), hashlib.sha256).hexdigest()


def _weighted(rng: random.Random, options: list[tuple[str, float]]) -> str:
    roll = rng.random()
    cumulative = 0.0
    for name, weight in options:
        cumulative += weight
        if roll <= cumulative:
            return name
    return options[-1][0]


def seed(conn: psycopg.Connection, *, seed_value: int = 20260818) -> dict[str, int]:
    rng = random.Random(seed_value)  # noqa: S311 — reproducible generator, not a security primitive
    cur = conn.cursor()
    cur.execute("SELECT link_id FROM road_links ORDER BY link_id")
    link_ids = [r[0] for r in cur.fetchall()]
    counts: dict[str, int] = {}

    # ── crashes: the published five-year series ─────────────────────────────
    total_crashes = 0
    with cur.copy(
        "COPY crashes (occurred_at, link_id, geom, fir_ref, fatalities, grievous, minor,"
        " vehicle_classes_involved, primary_cause, light_condition, weather, source,"
        " is_synthetic) FROM STDIN"
    ) as copy:
        for year, accidents, deaths in CRASH_SERIES:
            # Where deaths were not published, interpolate the fatality rate
            # between the years that were, rather than inventing a total.
            fatal_rate = (deaths / accidents) if deaths else (1106 / 3205 + 1273 / 3664) / 2
            for _ in range(accidents):
                link_id = rng.choice(link_ids)
                day_of_year = rng.randint(1, 365)
                hour = rng.choices(
                    range(24),
                    weights=[
                        2,
                        1,
                        1,
                        1,
                        2,
                        3,
                        5,
                        7,
                        8,
                        7,
                        6,
                        6,
                        6,
                        5,
                        5,
                        6,
                        7,
                        9,
                        11,
                        10,
                        7,
                        5,
                        4,
                        3,
                    ],
                )[0]
                occurred = datetime(year, 1, 1, hour, rng.randint(0, 59), tzinfo=IST) + timedelta(
                    days=day_of_year - 1
                )
                is_fatal = rng.random() < fatal_rate
                night = hour < 6 or hour >= 19
                copy.write_row(
                    (
                        occurred,
                        link_id,
                        None,
                        f"FIR/{year}/{rng.randint(1000, 99999)}",
                        1 if is_fatal else 0,
                        rng.randint(0, 2) if not is_fatal else rng.randint(0, 1),
                        rng.randint(0, 3),
                        rng.sample(["2W", "CAR", "LCV", "BUS", "TRK2", "NMV"], k=rng.randint(1, 2)),
                        _weighted(rng, CAUSES),
                        "night" if night else "day",
                        rng.choice(["clear", "clear", "clear", "rain", "fog"]),
                        "police",
                        True,
                    )
                )
                total_crashes += 1
    counts["crashes"] = total_crashes
    conn.commit()

    # ── violations and defaulters ───────────────────────────────────────────
    salt = b"pravaah-local-demo-salt-not-a-secret"

    # A deliberately long-tailed population: a small number of vehicles commit a
    # disproportionate share of serious violations. That tail IS the product
    # thesis (docs/01 §2) — find the 3% driving the severity numbers.
    def _synthetic_plate() -> str:
        """A structurally valid Rajasthan registration, generated and discarded.

        RTO codes run RJ01-RJ58 (docs/04 §4). The value is hashed immediately and
        the plain list is deleted below — no raw plate is ever persisted.
        """
        series = "".join(rng.choice("ABCDEFGHJK") for _ in range(2))
        return f"RJ{rng.randint(1, 58):02d}{series}{rng.randint(1000, 9999)}"

    plates = [_synthetic_plate() for _ in range(500)]
    hashes = [_plate_hash(p, salt) for p in plates]
    del plates  # the raw plates do not outlive this function

    cur.execute("SELECT camera_id FROM cameras ORDER BY camera_id")
    camera_ids = [r[0] for r in cur.fetchall()]

    violation_rows = 0
    with cur.copy(
        "COPY violations (occurred_at, camera_id, link_id, violation_type, plate_hash,"
        " ocr_confidence, evidence_uri, review_status, reviewed_by, reviewed_at,"
        " is_synthetic) FROM STDIN"
    ) as copy:
        for idx, plate_hash in enumerate(hashes):
            # Pareto-ish: index 0 offends most, the tail barely at all.
            n_violations = max(1, round(rng.paretovariate(1.6))) if idx < 60 else rng.randint(1, 3)
            n_violations = min(n_violations, 40)
            for _ in range(n_violations):
                occurred = datetime.now(IST) - timedelta(
                    days=rng.randint(1, 400), hours=rng.randint(0, 23)
                )
                confidence = round(rng.uniform(0.62, 0.995), 2)
                needs_review = confidence < 0.85
                status = (
                    "pending"
                    if needs_review
                    else rng.choice(["confirmed", "auto_confirmed", "auto_confirmed"])
                )
                reviewed_by = "officer.demo" if status == "confirmed" else None
                copy.write_row(
                    (
                        occurred,
                        rng.choice(camera_ids),
                        rng.choice(link_ids),
                        _weighted(rng, VIOLATION_TYPES),
                        plate_hash,
                        confidence,
                        f"s3://pravaah-evidence/{plate_hash[:12]}/{int(occurred.timestamp())}.jpg",
                        status,
                        reviewed_by,
                        occurred if reviewed_by else None,
                        True,
                    )
                )
                violation_rows += 1
    counts["violations"] = violation_rows
    conn.commit()

    # ── defaulter scores, each with its SHAP explanation ────────────────────
    cur.execute(
        "SELECT plate_hash, count(*), sum(CASE WHEN violation_type IN"
        " ('speed','red_light','wrong_side') THEN 1 ELSE 0 END)"
        " FROM violations GROUP BY plate_hash"
    )
    # Materialise before opening the COPY below: starting a copy on this cursor
    # discards any result set still pending on it.
    offender_totals = cur.fetchall()
    score_rows = 0
    today = datetime.now(IST).date()
    with cur.copy(
        "COPY defaulter_scores (computed_on, plate_hash, repeat_risk, recovery_propensity,"
        " severity_weighted_score, pending_challan_count, pending_amount_inr,"
        " shap_explanation, model_version, is_synthetic) FROM STDIN"
    ) as copy:
        for plate_hash, total, severe in offender_totals:
            repeat_risk = min(0.99, 0.06 + 0.045 * total + 0.05 * severe)
            recovery = max(0.02, min(0.97, 0.82 - 0.028 * total + rng.uniform(-0.08, 0.08)))
            pending = max(0, int(total * rng.uniform(0.2, 0.7)))
            # docs/07 §6: SHAP is mandatory. The database CHECK constraint
            # rejects an empty explanation, so this cannot be skipped.
            shap = [
                {
                    "feature": "violation_count",
                    "shap_value": round(0.041 * total, 4),
                    "direction": "increases",
                },
                {
                    "feature": "severe_violation_share",
                    "shap_value": round(0.05 * severe, 4),
                    "direction": "increases",
                },
                {
                    "feature": "days_since_last_violation",
                    "shap_value": round(-rng.uniform(0.01, 0.09), 4),
                    "direction": "decreases",
                },
            ]
            copy.write_row(
                (
                    today,
                    plate_hash,
                    round(repeat_risk, 3),
                    round(recovery, 3),
                    round(repeat_risk * 100 * (1 + severe * 0.15), 2),
                    pending,
                    round(pending * rng.choice([500, 1000, 1500, 2000]), 2),
                    json.dumps(shap),
                    "lightgbm-defaulter-0.1.0",
                    True,
                )
            )
            score_rows += 1
    counts["defaulter_scores"] = score_rows
    conn.commit()

    # ── policy corpus ───────────────────────────────────────────────────────
    for title_en, title_hi, doc_type, issued_by, language in POLICY_DOCS:
        cur.execute(
            "INSERT INTO policy_documents (title_en, title_hi, doc_type, issued_by,"
            " issued_on, content, language, is_synthetic) VALUES (%s,%s,%s,%s,%s,%s,%s,TRUE)",
            (
                title_en,
                title_hi,
                doc_type,
                issued_by,
                None,
                f"[Summary placeholder for {title_en}. Replace with the licensed "
                f"source text before any published output cites it.]",
                language,
            ),
        )
    counts["policy_documents"] = len(POLICY_DOCS)
    conn.commit()
    return counts
