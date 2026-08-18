"""Capabilities, server side.

The web client has a matrix of the same shape in `apps/web/src/lib/rbac.ts`, and
that one is a rendering aid: it decides which controls to draw. **This one is
the boundary.** Any request that reaches the API without passing through the
interface — which is every request an attacker makes — is refused here.

The two matrices must agree, or the interface offers a control the server
rejects. They are asserted equal by a test rather than by good intentions.
"""

from __future__ import annotations

from typing import Final

from fastapi import HTTPException, status

from .db import RequestScope

Capability = str

MATRIX: Final[dict[str, tuple[Capability, ...]]] = {
    "viewer": ("read:traffic",),
    "analyst": ("read:traffic", "read:analytics", "read:signals", "use:neeti"),
    "traffic_officer": (
        "read:traffic",
        "read:analytics",
        "read:signals",
        "approve:signals",
        "use:neeti",
    ),
    "enforcement_officer": ("read:traffic", "read:enforcement", "review:violations"),
    "enforcement_supervisor": (
        "read:traffic",
        "read:analytics",
        "read:enforcement",
        "review:violations",
        "unmask:plate",
        "read:defaulters",
    ),
    "data_admin": ("read:traffic", "read:analytics", "admin:sources", "read:audit"),
    "auditor": ("read:traffic", "read:audit", "read:analytics"),
}


def has(scope: RequestScope, capability: Capability) -> bool:
    return any(capability in MATRIX.get(role, ()) for role in scope.roles)


def require(scope: RequestScope, capability: Capability) -> None:
    """Refuse the request unless the caller holds the capability.

    403 rather than 404: the resource exists and the caller is authenticated,
    they simply may not do this. Disguising it as a 404 hides a real
    authorisation decision from the audit trail and from the operator trying to
    work out why their console is missing a button.
    """
    if not has(scope, capability):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"role {scope.roles} lacks capability '{capability}'",
        )
