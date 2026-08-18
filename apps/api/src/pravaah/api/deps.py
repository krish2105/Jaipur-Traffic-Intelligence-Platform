"""Request dependencies: identity, scope, session."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .core.db import RequestScope, session_for
from .core.settings import Settings, get_settings

VALID_ROLES = {
    "viewer",
    "analyst",
    "traffic_officer",
    "enforcement_officer",
    "enforcement_supervisor",
    "data_admin",
    "auditor",
}


SettingsDep = Annotated[Settings, Depends(get_settings)]


async def request_scope(
    settings: SettingsDep,
    x_demo_role: Annotated[str | None, Header(alias="X-Demo-Role")] = None,
    x_demo_corridors: Annotated[str | None, Header(alias="X-Demo-Corridors")] = None,
) -> RequestScope:
    """Resolve who is asking.

    In production this comes from the verified Keycloak access token. The
    header-driven path is the demo role switcher (docs plan §9) and is refused
    outright when DEMO_MODE is off — a demo affordance that survives into
    production is an authentication bypass, not a convenience.
    """
    if x_demo_role is not None:
        if settings.is_production or not settings.demo_role_switcher:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="the demo role switcher is disabled in this environment",
            )
        if x_demo_role not in VALID_ROLES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"unknown role '{x_demo_role}'",
            )
        corridors: tuple[int, ...] = ()
        if x_demo_corridors:
            try:
                corridors = tuple(int(c) for c in x_demo_corridors.split(",") if c.strip())
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="X-Demo-Corridors must be comma-separated integers",
                ) from exc
        return RequestScope(
            user_id=f"demo:{x_demo_role}", roles=(x_demo_role,), corridors=corridors
        )

    return RequestScope()


ScopeDep = Annotated[RequestScope, Depends(request_scope)]


async def db(scope: ScopeDep) -> AsyncIterator[AsyncSession]:
    async for session in session_for(scope):
        yield session


SessionDep = Annotated[AsyncSession, Depends(db)]
