"""WebSocket push for the live console.

docs/08 Sprint 2 asks for pushes within 2 s. The console had been polling on a
20-second timer, which is three things wrong at once: an operations room sees a
figure up to twenty seconds stale, every open console costs a request whether or
not anything changed, and a wall display left overnight keeps asking.

Two design points that matter more than the transport:

**The server pushes only on change.** A socket that re-sends an identical
payload every two seconds is a poll wearing a different hat, and it defeats the
one property that makes the pulse in the interface honest — that a flash means
something happened (ADR-031).

**A dropped socket falls back to polling rather than to nothing.** The console
already has a working poll path; the socket is an optimisation on top of it, so
a proxy that eats WebSocket upgrades degrades to the previous behaviour instead
of freezing the dashboard. Government networks eat WebSocket upgrades.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import text

from ..core.db import RequestScope, session_for

router = APIRouter(tags=["live"])

#: How often the server looks for a change. Not how often it sends — it sends
#: only when the payload differs.
POLL_SECONDS = 2.0

_SNAPSHOT = """
    SELECT COALESCE(round(avg(lc.congestion_index), 1), 0) AS congestion,
           count(*) FILTER (WHERE lc.confidence < 0.55)    AS suppressed,
           count(*)                                        AS links
    FROM link_congestion lc
    JOIN road_links l ON l.link_id = lc.link_id
    WHERE lc.bucket_start > now() - INTERVAL '30 minutes'
      AND lc.bucket_start <= now()
      AND l.corridor_id = 1
"""


async def _snapshot() -> dict[str, Any]:
    async for session in session_for(RequestScope()):
        row = (await session.execute(text(_SNAPSHOT))).one()
        return {
            "congestion_index": float(row.congestion),
            "suppressed_links": int(row.suppressed),
            "links": int(row.links),
        }
    return {}


@router.websocket("/ws/live")
async def live(socket: WebSocket) -> None:
    await socket.accept()
    previous: str | None = None
    try:
        while True:
            payload = await _snapshot()
            encoded = json.dumps(payload, sort_keys=True)
            if encoded != previous:
                previous = encoded
                await socket.send_json({"type": "congestion", **payload})
            await asyncio.sleep(POLL_SECONDS)
    except WebSocketDisconnect:
        # The client went away. Normal, and not worth a log line per console.
        return
    except Exception:
        # Any other failure closes cleanly so the client's fallback poll takes
        # over rather than the socket hanging half-open.
        with contextlib.suppress(Exception):
            await socket.close(code=1011)
