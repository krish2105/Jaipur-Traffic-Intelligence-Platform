"""Freeze the API's responses into a snapshot the frontend can serve alone.

The deployed console showed 0 for every figure, because Vercel cannot reach a
`localhost` API and the backend is not hosted. Every panel fell back to its
"unavailable" shape and the product looked broken rather than undeployed.

docs/03 §5 already requires the demo to render with the network cable pulled, so
the fix is the offline mode the spec asked for: a captured snapshot of the same
endpoints, shipped with the build.

Two files, split on size:

* `apps/web/src/data/snapshot.json` — everything except the 3D buildings, ~48 KB.
  Imported directly, so it is available to a Server Component with no fetch.
* `apps/web/src/data/buildings.json` — the 3D building footprints, ~300 KB.
  Kept separate because only the two pages with a map import it, and only on
  the failure path. It was briefly a static asset fetched by the client
  instead, to keep it out of the payload — but that made the scene mount
  before its geometry existed, and on the deployment the canvas came back
  unmeasured and the map pane stayed empty. Serving it from the server means
  the offline path renders through exactly the same code as the live one,
  which is worth more than the bytes it saves.

**`/audit/recent` is deliberately not captured.** It is role-gated, and a
public JSON bundle containing an audit trail would contradict the access-control
story the rest of the platform makes. It has no snapshot and stays empty until
a real API is reachable.

    uv run python scripts/export_snapshot.py
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("PRAVAAH_API", "http://localhost:8001") + "/api/v1"
WEB = Path("apps/web")

#: Keyed by the exact path the web client requests, so lookup is a dict hit
#: rather than a second URL-building implementation that can drift.
PATHS: tuple[str, ...] = (
    "/corridors",
    "/safety/severity",
    "/safety/severity-model",
    "/enforcement/allocation",
    "/counts/summary?corridor_id=1",
    "/congestion/day-profile?corridor_id=1",
    "/congestion/weekly?corridor_id=1",
    "/cameras",
    "/forecast",
    "/safety/blackspots?corridor_id=1",
    "/signals/advisory",
    "/meta/sources",
    "/meta/kpis",
    "/meta/weather",
    "/meta/air",
    "/meta/published",
    "/incidents/timeline",
    "/junctions",
    "/edge/cameras",
    "/policy/scenarios?corridor_id=1",
    "/policy/representation?corridor_id=1",
    "/enforcement/summary",
    "/enforcement/fairness",
    "/enforcement/defaulters?limit=8",
    "/enforcement/defaulters?limit=10",
    "/neeti/questions",
    "/scene?corridor_id=1",
)

#: NEETI answers, captured per question so the policy page works offline too.
NEETI_QUESTIONS = (
    "worst_hours",
    "freight_window",
    "class_mix",
    "crash_severity_by_hour",
    "enforcement_gate",
)

#: Roles with the capability each endpoint needs. The demo header is accepted
#: only while DEMO_MODE is on, which is exactly when a snapshot is captured.
ROLE_FOR = {
    "/enforcement": "enforcement_supervisor",
    "/neeti": "analyst",
}


def fetch(path: str) -> object | None:
    role = next((r for prefix, r in ROLE_FOR.items() if path.startswith(prefix)), None)
    request = urllib.request.Request(f"{BASE}{path}")  # noqa: S310 — fixed local base
    if role:
        request.add_header("X-Demo-Role", role)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"  SKIP {path}: {type(exc).__name__}")
        return None


def main() -> None:
    snapshot: dict[str, object] = {}
    for path in PATHS:
        payload = fetch(path)
        if payload is not None:
            snapshot[path] = payload
            print(f"  ok  {path}")

    for question in NEETI_QUESTIONS:
        path = f"/neeti/ask?question_id={question}"
        payload = fetch(path)
        if payload is not None:
            snapshot[path] = payload
            print(f"  ok  {path}")

    buildings = fetch("/scene/buildings")

    if not snapshot:
        print("\nnothing captured — is the API running?")
        raise SystemExit(1)

    data_dir = WEB / "src" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    small = data_dir / "snapshot.json"
    small.write_text(json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False))
    print(f"\n{small}  {small.stat().st_size / 1024:.0f} KB  ({len(snapshot)} endpoints)")

    if buildings is not None:
        big = data_dir / "buildings.json"
        big.write_text(json.dumps(buildings, separators=(",", ":")))
        print(f"{big}  {big.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
