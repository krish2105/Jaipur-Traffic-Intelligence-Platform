"""The client and server capability matrices must agree.

If they drift, the interface offers a control the server refuses — which
presents to an officer as a button that does nothing, and to a reviewer as an
authorisation model nobody can describe. Parsing the TypeScript is cruder than
sharing a generated contract, and it is what stops the drift today rather than
after the next refactor.
"""

from __future__ import annotations

import re
from pathlib import Path

from pravaah.api.core.rbac import MATRIX

_TS = (
    Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "lib" / "rbac.ts"
)


def _client_matrix() -> dict[str, set[str]]:
    source = _TS.read_text(encoding="utf-8")
    block = source.split("const MATRIX", 1)[1]
    block = block.split("};", 1)[0]
    found: dict[str, set[str]] = {}
    for role, body in re.findall(r"(\w+):\s*\[([^\]]*)\]", block, re.S):
        found[role] = set(re.findall(r'"([a-z:]+)"', body))
    return found


def test_every_role_exists_on_both_sides() -> None:
    assert set(_client_matrix()) == set(MATRIX)


def test_capabilities_match_exactly() -> None:
    client = _client_matrix()
    for role, caps in MATRIX.items():
        assert client[role] == set(caps), f"{role} differs between client and server"


def test_only_the_supervisor_may_unmask_a_plate() -> None:
    # docs/07 §3. Pinned separately because it is the single capability whose
    # accidental widening would be a privacy incident rather than a bug.
    holders = {role for role, caps in MATRIX.items() if "unmask:plate" in caps}
    assert holders == {"enforcement_supervisor"}


def test_no_enforcement_role_can_approve_signals() -> None:
    # Separation of duties: the people issuing challans are not the people
    # retiming the junction those challans are issued at.
    for role in ("enforcement_officer", "enforcement_supervisor"):
        assert "approve:signals" not in MATRIX[role]
