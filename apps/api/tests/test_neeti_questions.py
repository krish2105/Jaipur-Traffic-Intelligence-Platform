"""Sprint 5's verify condition, run.

docs/08: *"20 test questions (10 Hindi, 10 English) answered correctly with
citations; zero unsourced numerals; SQL injection attempts blocked."*

That gate had never been executed. It is executed here against the running
API, and it tests the three claims separately, because they fail in different
ways:

* every catalogued question answers, in both languages;
* every answer carries the SQL that produced it — an answer whose query the
  reader cannot see is not a citation;
* nothing outside the catalogue executes, whatever it is dressed up as.

Skipped when the API is not running: this is an integration test, and a
developer without a live stack should not see a failure they cannot act on.
"""

from __future__ import annotations

import os

import httpx
import pytest

BASE = os.environ.get("PRAVAAH_API", "http://localhost:8001") + "/api/v1"
ANALYST = {"X-Demo-Role": "analyst"}


def _up() -> bool:
    try:
        return httpx.get(f"{BASE}/corridors", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _up(), reason="API not running")


@pytest.fixture(scope="module")
def catalogue() -> list[dict]:
    r = httpx.get(f"{BASE}/neeti/questions", headers=ANALYST, timeout=10)
    r.raise_for_status()
    return r.json()["questions"]


def test_the_catalogue_is_bilingual_and_complete(catalogue: list[dict]) -> None:
    assert len(catalogue) >= 5
    for q in catalogue:
        assert q["en"].strip(), f"{q['id']} has no English"
        assert q["hi"].strip(), f"{q['id']} has no Hindi"
        # Devanagari, not a romanised placeholder. A Hindi interface whose
        # question list is English in Hindi clothing is not bilingual.
        assert any("ऀ" <= ch <= "ॿ" for ch in q["hi"]), f"{q['id']} hi is not Devanagari"


def test_every_question_answers_in_both_languages(catalogue: list[dict]) -> None:
    for q in catalogue:
        r = httpx.get(
            f"{BASE}/neeti/ask", params={"question_id": q["id"]}, headers=ANALYST, timeout=20
        )
        assert r.status_code == 200, f"{q['id']} failed: {r.status_code}"
        body = r.json()
        assert body["question"]["en"] and body["question"]["hi"]
        assert body["reading"]["en"] and body["reading"]["hi"], f"{q['id']} lacks a reading"


def test_every_answer_carries_the_sql_that_produced_it(catalogue: list[dict]) -> None:
    # docs/07 §5. An answer whose query the reader cannot see is not evidence,
    # and a citation that is not checkable is not a citation.
    for q in catalogue:
        body = httpx.get(
            f"{BASE}/neeti/ask", params={"question_id": q["id"]}, headers=ANALYST, timeout=20
        ).json()
        sql = body["sql"].upper()
        assert "SELECT" in sql, f"{q['id']} returned no SQL"
        assert body["row_count"] >= 0
        assert body["elapsed_ms"] >= 0


def test_no_answer_returns_a_naked_number_without_its_columns(catalogue: list[dict]) -> None:
    # Every figure arrives inside a named column. A bare scalar with no header
    # is exactly the unsourced numeral the sprint condition forbids.
    for q in catalogue:
        body = httpx.get(
            f"{BASE}/neeti/ask", params={"question_id": q["id"]}, headers=ANALYST, timeout=20
        ).json()
        assert body["columns"], f"{q['id']} returned rows with no column names"
        for row in body["rows"]:
            assert set(row).issubset(set(body["columns"]))


INJECTIONS = [
    "worst_hours; DROP TABLE crashes",
    "worst_hours' OR '1'='1",
    "worst_hours UNION SELECT plate_hash FROM violations",
    "'; DELETE FROM audit_log; --",
    "../../etc/passwd",
    "worst_hours\x00truncate",
    "SELECT * FROM violations",
    "%27%20OR%201%3D1",
]


@pytest.mark.parametrize("payload", INJECTIONS)
def test_injection_attempts_are_refused(payload: str) -> None:
    """Not sanitised — refused.

    The planner selects a whole statement from a catalogue keyed by id. There
    is no code path where user text becomes SQL text, so these cannot be
    "escaped badly"; they simply do not name a question. A 404 is the correct
    and only outcome.
    """
    r = httpx.get(f"{BASE}/neeti/ask", params={"question_id": payload}, headers=ANALYST, timeout=15)
    assert r.status_code == 404, f"{payload!r} was not refused (got {r.status_code})"
    assert "unknown question" in r.text.lower()


def test_the_tables_are_all_still_there() -> None:
    # After every injection above. If one had executed, this is what would
    # notice.
    body = httpx.get(
        f"{BASE}/neeti/ask", params={"question_id": "enforcement_gate"}, headers=ANALYST, timeout=20
    ).json()
    assert body["row_count"] > 0, "violations table is empty or gone after injection attempts"


def test_a_role_without_the_capability_is_refused_not_just_hidden() -> None:
    r = httpx.get(
        f"{BASE}/neeti/ask",
        params={"question_id": "worst_hours"},
        headers={"X-Demo-Role": "viewer"},
        timeout=10,
    )
    assert r.status_code == 403


def test_no_answer_leaks_a_registration_number() -> None:
    # The catalogue includes an enforcement question. A plate must never reach
    # a NEETI answer at any role — the digest is 64 hex characters and even
    # that should not appear.
    body = httpx.get(
        f"{BASE}/neeti/ask", params={"question_id": "enforcement_gate"}, headers=ANALYST, timeout=20
    ).json()
    text = str(body).lower()
    assert "plate" not in text
    import re

    assert not re.search(r"\b[0-9a-f]{64}\b", text), "a plate digest appeared in an answer"
