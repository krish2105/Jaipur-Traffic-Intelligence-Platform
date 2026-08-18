"""Officer decisions on advisory outputs, and the audit trail they write.

docs/07 §6 is the load-bearing rule: **no model actuates anything.** A signal
timing suggestion is a recommendation until a named human accepts it, and the
acceptance is what gets recorded — not the recommendation.

So this router does not apply anything to a controller and has no code path to
one. It records that a person, in a role that permits it, decided something at
a moment, and it writes that to an append-only log. The value of the record is
that it survives the person: six months later someone can ask who shortened the
Durgapura cycle and read the answer.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..core.rbac import require
from ..deps import ScopeDep, SessionDep

router = APIRouter(tags=["decisions"])


class SignalDecision(BaseModel):
    """An officer's decision on one junction's advisory."""

    junction_id: int
    decision: Literal["accepted", "rejected", "deferred"]
    #: Free text, capped. An accepted plan with no note is legal; a rejected one
    #: without a reason teaches the model nothing and tells the next officer
    #: nothing either, so the API asks for one.
    note: Annotated[str, Field(default="", max_length=500)]
    #: What the officer saw when they decided. Stored so the record is
    #: interpretable later, when the advisory has long since changed.
    cycle_s: Annotated[int, Field(ge=20, le=240)]


@router.post("/signals/decision", status_code=status.HTTP_201_CREATED)
async def record_signal_decision(
    body: SignalDecision,
    session: SessionDep,
    scope: ScopeDep,
) -> dict[str, Any]:
    """Record a decision. Applies nothing.

    The response says so explicitly, in a field named `applied`, which is always
    false. A future version that genuinely drives a controller would have to
    change that field — which makes it impossible to add actuation quietly.
    """
    require(scope, "approve:signals")

    if body.decision == "rejected" and not body.note.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="a rejected advisory needs a reason — the next officer will read it",
        )

    exists = await session.execute(
        text("SELECT 1 FROM junctions WHERE junction_id = :jid"),
        {"jid": body.junction_id},
    )
    if exists.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown junction")

    row = await session.execute(
        text("""
            INSERT INTO audit_log
                (actor_id, actor_role, action, resource_type, resource_id, reason_code)
            VALUES
                (:actor, :role, :action, 'signal_advisory', :rid, :reason)
            RETURNING audit_id, occurred_at
        """),
        {
            "actor": scope.user_id,
            "role": scope.roles[0] if scope.roles else "unknown",
            "action": f"signal_{body.decision}",
            "rid": str(body.junction_id),
            "reason": body.note.strip() or None,
        },
    )
    record = row.one()
    await session.commit()

    return {
        "audit_id": int(record.audit_id),
        "recorded_at": record.occurred_at.isoformat(),
        "decision": body.decision,
        "junction_id": body.junction_id,
        # Always false. docs/07 §6: nothing here reaches a signal controller.
        "applied": False,
        "note": (
            "Recorded, not applied. No code path in this system reaches a signal "
            "controller; an engineer takes this record to the ATCS operator."
        ),
    }


@router.get("/audit/recent")
async def recent_audit(session: SessionDep, scope: ScopeDep) -> dict[str, Any]:
    """The audit trail. Readable by roles that hold `read:audit`, and by nobody
    else — an audit log that everyone can read is a directory of who did what,
    which is itself sensitive.
    """
    require(scope, "read:audit")

    rows = await session.execute(
        text("""
            SELECT audit_id, occurred_at, actor_id, actor_role, action,
                   resource_type, resource_id, reason_code
            FROM audit_log
            ORDER BY occurred_at DESC
            LIMIT 50
        """)
    )
    return {
        "entries": [
            {
                "audit_id": int(r.audit_id),
                "occurred_at": r.occurred_at.isoformat(),
                "actor": r.actor_id,
                "role": r.actor_role,
                "action": r.action,
                "resource": (
                    f"{r.resource_type}:{r.resource_id}"
                    if r.resource_id
                    else r.resource_type
                ),
                "reason": r.reason_code,
            }
            for r in rows
        ],
        "immutability": (
            "Append-only by grant and by trigger: the application role holds "
            "INSERT and has no UPDATE or DELETE. Verified by scripts/verify_security.py."
        ),
    }
