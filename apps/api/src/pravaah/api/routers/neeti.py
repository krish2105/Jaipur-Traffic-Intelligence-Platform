"""NEETI — the policy question layer.

A question in, a table out, and **the SQL it ran shown every time**.

docs/07 §5 sets the rails: a read-only role, an allowlisted schema, a statement
timeout, a row cap, no DDL or DML, and the generated SQL surfaced to the user.
Those rails are the product. The part that turns a question into SQL is
replaceable — today it is a deterministic planner over a fixed catalogue of
questions, and a language model would widen the question space without changing
a single guarantee below.

Building it in this order was deliberate. A text-to-SQL feature whose guardrails
arrive in version two is a text-to-SQL feature that has already run unguarded
against a government database.

**Every statement is a literal in this file.** No SQL is assembled from user
input at any point — the planner selects a whole statement and binds
parameters. That makes injection structurally impossible rather than filtered:
there is no code path where user text becomes SQL text.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from ..core.rbac import require
from ..deps import ScopeDep, SessionDep

router = APIRouter(tags=["neeti"])

#: Hard cap on rows returned to a browser. A policy answer that needs more than
#: this is a report, not a question, and should be exported deliberately.
_ROW_CAP = 200

#: Statement timeout. A question that cannot be answered in three seconds is
#: one that would sit on a shared warehouse connection while an operations
#: console waits behind it.
_TIMEOUT_MS = 3000


@dataclass(frozen=True)
class Question:
    id: str
    en: str
    hi: str
    sql: str
    #: What the answer means, so a number never lands without its reading.
    reading_en: str
    reading_hi: str


CATALOGUE: tuple[Question, ...] = (
    Question(
        id="worst_hours",
        en="Which hours of the day are worst on the model corridor?",
        hi="मॉडल कॉरिडोर पर दिन के कौन से घंटे सबसे खराब हैं?",
        sql="""
            SELECT extract(hour FROM bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   round(avg(congestion_index), 1) AS mean_congestion,
                   count(*) AS observations
            FROM link_congestion
            WHERE bucket_start >= now() - INTERVAL '28 days'
            GROUP BY hour
            ORDER BY mean_congestion DESC
            LIMIT :cap
        """,
        reading_en="Mean congestion index by hour over the last 28 days, worst first.",
        reading_hi="पिछले 28 दिनों में घंटे के अनुसार औसत भीड़ सूचकांक, सबसे खराब पहले।",
    ),
    Question(
        id="freight_window",
        en="When is the quietest three-hour window for freight movement?",
        hi="माल ढुलाई के लिए सबसे शांत तीन-घंटे की खिड़की कब है?",
        sql="""
            WITH hourly AS (
                SELECT extract(hour FROM bucket_start AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                       avg(congestion_index) AS idx
                FROM link_congestion
                WHERE bucket_start >= now() - INTERVAL '28 days'
                GROUP BY hour
            )
            SELECT h.hour AS window_start,
                   round(avg(n.idx)::numeric, 1) AS mean_congestion
            FROM hourly h
            JOIN hourly n ON n.hour IN (h.hour, (h.hour + 1) % 24, (h.hour + 2) % 24)
            GROUP BY h.hour
            ORDER BY mean_congestion ASC
            LIMIT :cap
        """,
        reading_en=(
            "Mean congestion across each rolling three-hour window, quietest first. "
            "A freight window is chosen from the top of this list."
        ),
        reading_hi=("प्रत्येक तीन-घंटे की खिड़की में औसत भीड़, सबसे शांत पहले।"),
    ),
    Question(
        id="class_mix",
        en="What is the vehicle mix, by count and by road space?",
        hi="वाहन मिश्रण क्या है — संख्या और सड़क स्थान दोनों से?",
        sql="""
            SELECT v.name_en AS vehicle_class,
                   sum(tc.vehicle_count) AS vehicles,
                   round(sum(tc.pcu)::numeric, 0) AS pcu,
                   round(100.0 * sum(tc.vehicle_count) / NULLIF(sum(sum(tc.vehicle_count))
                         OVER (), 0), 1) AS pct_vehicles,
                   round(100.0 * sum(tc.pcu) / NULLIF(sum(sum(tc.pcu)) OVER (), 0), 1)
                         AS pct_road_space
            FROM traffic_counts tc
            JOIN vehicle_classes v ON v.class_code = tc.class_code
            WHERE tc.bucket_start >= now() - INTERVAL '7 days'
            GROUP BY v.name_en
            ORDER BY pcu DESC
            LIMIT :cap
        """,
        reading_en=(
            "Share of vehicles against share of road space. Where the two columns "
            "disagree is the case for classifying rather than sampling."
        ),
        reading_hi=(
            "वाहनों का हिस्सा बनाम सड़क स्थान का हिस्सा। जहाँ दोनों स्तंभ असहमत हैं, वही वर्गीकरण का तर्क है।"
        ),
    ),
    Question(
        id="crash_severity_by_hour",
        en="At which hours is a crash most likely to be fatal?",
        hi="किन घंटों में दुर्घटना के घातक होने की संभावना सबसे अधिक है?",
        sql="""
            SELECT extract(hour FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                   count(*) AS crashes,
                   sum(fatalities) AS deaths,
                   round(100.0 * count(*) FILTER (WHERE fatalities > 0)
                         / NULLIF(count(*), 0), 1) AS pct_fatal
            FROM crashes
            GROUP BY hour
            HAVING count(*) > 50
            ORDER BY pct_fatal DESC
            LIMIT :cap
        """,
        reading_en=(
            "Share of crashes involving a death, by hour. Hours with fewer than 50 "
            "crashes are excluded — a percentage over a small base is noise."
        ),
        reading_hi=("घंटे के अनुसार मृत्यु वाली दुर्घटनाओं का हिस्सा। 50 से कम दुर्घटनाओं वाले घंटे बाहर रखे गए हैं।"),
    ),
    Question(
        id="enforcement_gate",
        en="How many violations fall below the confidence gate?",
        hi="कितने उल्लंघन विश्वास सीमा से नीचे आते हैं?",
        sql="""
            SELECT violation_type,
                   count(*) AS total,
                   count(*) FILTER (WHERE ocr_confidence < 0.85) AS below_gate,
                   count(*) FILTER (WHERE ocr_confidence < 0.85
                                      AND review_status = 'auto_confirmed') AS breaches
            FROM violations
            GROUP BY violation_type
            ORDER BY below_gate DESC
            LIMIT :cap
        """,
        reading_en=(
            "Readings below 0.85 must go to a human. `breaches` is zero because a "
            "CHECK constraint makes it impossible, not because nothing went wrong."
        ),
        reading_hi=(
            "0.85 से नीचे की रीडिंग मानव समीक्षा में जानी चाहिए। `breaches` शून्य है "
            "क्योंकि एक डेटाबेस बाधा इसे असंभव बनाती है।"
        ),
    ),
)

_BY_ID = {q.id: q for q in CATALOGUE}


@router.get("/neeti/questions")
async def questions(scope: ScopeDep) -> dict[str, Any]:
    """The catalogue. Listing it is how the question space stays honest — a
    user can see exactly what can be asked rather than guessing at a prompt."""
    require(scope, "use:neeti")
    return {
        "questions": [{"id": q.id, "en": q.en, "hi": q.hi} for q in CATALOGUE],
        "planner": (
            "Deterministic planner over a fixed catalogue. Every statement is a "
            "literal in the source; no SQL is assembled from user input, which "
            "makes injection structurally impossible rather than filtered. A "
            "language model would widen the question space without changing any "
            "guarantee here — and is not wired on this instance."
        ),
        "rails": {
            "role": "read-only",
            "row_cap": _ROW_CAP,
            "statement_timeout_ms": _TIMEOUT_MS,
            "ddl_dml": "refused",
            "sql_shown": True,
        },
    }


@router.get("/neeti/ask")
async def ask(
    session: SessionDep,
    scope: ScopeDep,
    question_id: Annotated[str, Query()],
) -> dict[str, Any]:
    """Answer one catalogued question, and show the SQL that produced it."""
    require(scope, "use:neeti")

    question = _BY_ID.get(question_id)
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown question '{question_id}' — see /neeti/questions",
        )

    # Belt and braces. The statement is already a literal from this module, so
    # this timeout is not protecting against a hostile query; it protects the
    # shared connection from an honest question over a table that has grown.
    await session.execute(text(f"SET LOCAL statement_timeout = {_TIMEOUT_MS}"))

    started = time.perf_counter()
    result = await session.execute(text(question.sql), {"cap": _ROW_CAP})
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)

    columns = list(result.keys())
    rows = [
        {c: (float(v) if isinstance(v, float) else v) for c, v in zip(columns, row, strict=True)}
        for row in result.fetchall()
    ]

    return {
        "question": {"id": question.id, "en": question.en, "hi": question.hi},
        # Shown every time, not on request. docs/07 §5: a user who cannot see
        # the query cannot check the answer, and an answer nobody can check is
        # not evidence.
        "sql": question.sql.strip(),
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "elapsed_ms": elapsed_ms,
        "reading": {"en": question.reading_en, "hi": question.reading_hi},
        "is_synthetic": True,
    }
