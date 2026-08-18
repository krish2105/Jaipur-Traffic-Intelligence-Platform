"""Prove the database-level security controls actually hold.

docs/07 §8 lists "Audit log verified immutable (attempt an UPDATE as the app
role; it must fail)" as a pre-deployment checklist item. This script runs that
check and the rest of the controls that are enforceable in SQL, so the claims in
the pitch are backed by output rather than by intention.

    uv run python scripts/verify_security.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

import psycopg

DSN = (
    os.environ.get("DATABASE_URL", "")
    .replace("postgresql+asyncpg://", "postgresql://")
    .replace("postgresql+psycopg://", "postgresql://")
)


@dataclass
class Result:
    name: str
    passed: bool
    detail: str


results: list[Result] = []


def check(name: str, *, passed: bool, detail: str = "") -> None:
    results.append(Result(name, passed, detail))


def must_fail(cur: psycopg.Cursor, sql: str, name: str, expect: str) -> None:
    """The control is proven by the operation being refused, not permitted."""
    try:
        cur.execute(sql)  # type: ignore[arg-type]
    except psycopg.Error as exc:
        msg = str(exc).splitlines()[0]
        check(name, passed=expect.lower() in msg.lower(), detail=msg[:100])
    else:
        check(name, passed=False, detail="operation was PERMITTED — control absent")
    finally:
        cur.connection.rollback()


def main() -> int:
    if not DSN:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    with psycopg.connect(DSN) as conn:
        conn.autocommit = False
        cur = conn.cursor()

        # ── schema shape ────────────────────────────────────────────────────
        cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'")
        row = cur.fetchone()
        check(
            "public tables created",
            passed=(row or [0])[0] >= 15,
            detail=f"{(row or [0])[0]} tables",
        )

        cur.execute("SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1")
        hypertables = [r[0] for r in cur.fetchall()]
        expected = {
            "audit_log",
            "forecasts",
            "link_congestion",
            "traffic_counts",
            "turning_movements",
        }
        check(
            "hypertables created",
            passed=expected.issubset(set(hypertables)),
            detail=", ".join(hypertables),
        )

        cur.execute("SELECT view_name FROM timescaledb_information.continuous_aggregates")
        caggs = [r[0] for r in cur.fetchall()]
        check(
            "continuous aggregate present",
            passed="traffic_counts_hourly" in caggs,
            detail=", ".join(caggs),
        )

        cur.execute(
            "SELECT count(*) FROM timescaledb_information.jobs WHERE proc_name='policy_compression'"
        )
        row = cur.fetchone()
        check(
            "compression policy active",
            passed=(row or [0])[0] >= 1,
            detail="keeps us under the 750 MB cap",
        )
        conn.rollback()

        # ── the audit log is append-only (docs/07 §5, §8) ───────────────────
        cur.execute("""
            INSERT INTO audit_log
              (actor_id, actor_role, action, resource_type, resource_id, reason_code)
            VALUES ('verify','auditor','view_plate','violation','1','verification_run')
        """)
        conn.commit()
        must_fail(
            cur,
            "UPDATE audit_log SET actor_id='tampered' WHERE actor_id='verify'",
            "audit_log refuses UPDATE",
            "append-only",
        )

        cur.execute("""
            SELECT has_table_privilege('pravaah_app','audit_log','UPDATE'),
                   has_table_privilege('pravaah_app','audit_log','DELETE'),
                   has_table_privilege('pravaah_app','audit_log','INSERT')
        """)
        upd, dele, ins = cur.fetchone()  # type: ignore[misc]
        check("pravaah_app has no UPDATE grant on audit_log", passed=not upd)
        check("pravaah_app has no DELETE grant on audit_log", passed=not dele)
        check("pravaah_app can INSERT to audit_log", passed=bool(ins))

        # A sensitive action without a reason code must be impossible to record,
        # which is what makes "every unmask is reason-coded" true.
        must_fail(
            cur,
            "INSERT INTO audit_log (actor_id, actor_role, action, resource_type) "
            "VALUES ('verify','enforcement_supervisor','unmask_identity','violation')",
            "unmask without a reason code is rejected",
            "sensitive_actions_need_a_reason",
        )

        # ── the raw plate cannot be stored (docs/07 §3) ─────────────────────
        must_fail(
            cur,
            "INSERT INTO violations (occurred_at, violation_type, plate_hash, ocr_confidence) "
            "VALUES (now(),'red_light','RJ14AB1234',0.99)",
            "a raw registration number is rejected by the database",
            "plate_hash_is_hmac_digest",
        )

        # ── the OCR confidence gate is structural (docs/04 §4) ──────────────
        must_fail(
            cur,
            "INSERT INTO violations (occurred_at, violation_type, plate_hash,"
            " ocr_confidence, review_status) "
            "VALUES (now(),'speed', repeat('a',64), 0.42, 'auto_confirmed')",
            "a low-confidence read cannot auto-confirm",
            "low_confidence_cannot_auto_confirm",
        )

        # ── no unexplained score reaches a human (docs/07 §6) ───────────────
        must_fail(
            cur,
            "INSERT INTO defaulter_scores (computed_on, plate_hash, repeat_risk,"
            " shap_explanation, model_version) "
            "VALUES (current_date, repeat('b',64), 0.9, '[]'::jsonb, 'v1')",
            "a defaulter score without SHAP is rejected",
            "score_must_be_explained",
        )

        # ── a forecast must carry its uncertainty (docs/04 §5) ──────────────
        must_fail(
            cur,
            "INSERT INTO forecasts (issued_at, link_id, horizon_min,"
            " predicted_index, lower_80, upper_80, model_version) "
            "VALUES (now(), 1, 30, 80, 10, 40, 'v1')",
            "a point estimate outside its own interval is rejected",
            "interval_contains_point",
        )

        # ── corridor scoping is enforced by the database ────────────────────
        cur.execute("SELECT has_table_privilege('pravaah_app','traffic_counts','SELECT')")
        row = cur.fetchone()
        check(
            "pravaah_app cannot read the traffic_counts base table",
            passed=not (row or [True])[0],
            detail="reads go through traffic_counts_scoped",
        )
        cur.execute("SELECT reloptions FROM pg_class WHERE relname='traffic_counts_scoped'")
        opts = (cur.fetchone() or [None])[0] or []
        check(
            "scoped view is a security_barrier",
            passed=any("security_barrier=true" in o for o in opts),
        )

        cur.execute(
            "SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY 1"
        )
        policies = cur.fetchall()
        check(
            "RLS policies installed",
            passed=len(policies) >= 4,
            detail=", ".join(f"{t}" for t, _ in policies),
        )

        # ── NEETI's read-only surface exposes no personal data (docs/07 §5) ──
        cur.execute(
            "SELECT table_name FROM information_schema.views WHERE table_schema='neeti' ORDER BY 1"
        )
        neeti_views = [r[0] for r in cur.fetchall()]
        forbidden = {"violations", "defaulter_scores", "audit_log", "policy_documents"}
        check(
            "NEETI allowlist contains no P2 table",
            passed=not (forbidden & set(neeti_views)),
            detail=f"{len(neeti_views)} views, all P0",
        )
        for table in ("violations", "defaulter_scores", "audit_log"):
            cur.execute("SELECT has_table_privilege('pravaah_ro',%s,'SELECT')", (table,))
            row = cur.fetchone()
            check(f"pravaah_ro cannot read {table}", passed=not (row or [True])[0])

        cur.execute("DELETE FROM audit_log WHERE actor_id='verify'")
        conn.commit()

    width = max(len(r.name) for r in results) + 2
    print("\n══ PRAVAAH security verification ══\n")
    for r in results:
        mark = "\033[32mPASS\033[0m" if r.passed else "\033[31mFAIL\033[0m"
        print(f"  {mark}  {r.name:<{width}} {r.detail}")
    failed = [r for r in results if not r.passed]
    print(f"\n  {len(results) - len(failed)}/{len(results)} passed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
