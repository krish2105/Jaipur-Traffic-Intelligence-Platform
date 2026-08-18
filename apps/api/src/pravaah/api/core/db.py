"""Database session, with the RLS session variables set per transaction.

docs/07 §5 is explicit that corridor scoping is enforced in the query layer, not
in application code. That only works if every request actually sets the session
variables the policies read — so it happens here, in one place, rather than
being remembered at each call site.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .settings import get_settings

_settings = get_settings()
_engine = create_async_engine(_settings.async_dsn, pool_size=5, max_overflow=10, future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)


@dataclass(frozen=True)
class RequestScope:
    """Who is asking, in what role, scoped to which corridors."""

    user_id: str = "anonymous"
    roles: tuple[str, ...] = ("viewer",)
    corridors: tuple[int, ...] = field(default=())


async def session_for(scope: RequestScope) -> AsyncIterator[AsyncSession]:
    async with _session_factory() as session:
        await session.execute(
            text(
                "SELECT set_config('app.user_id', :uid, true),"
                "       set_config('app.roles', :roles, true),"
                "       set_config('app.corridors', :corridors, true)"
            ),
            {
                "uid": scope.user_id,
                "roles": ",".join(scope.roles),
                "corridors": ",".join(str(c) for c in scope.corridors),
            },
        )
        yield session


async def dispose() -> None:
    await _engine.dispose()
