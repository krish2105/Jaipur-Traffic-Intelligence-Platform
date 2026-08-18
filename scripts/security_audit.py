"""Prove the prohibitions, rather than asserting them.

docs/12 §7 and `CLAUDE.md` list prohibitions that a government buyer has to take
on trust unless something checks them. This checks them, against the source
tree, and exits non-zero if any is violated — so it can sit in CI and a claim
cannot quietly stop being true between one demo and the next.

Each check names what would make it fail. A check nobody can fail is not a
check, and would be worse than none because it would look like assurance.

    uv run python scripts/security_audit.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".venv", "node_modules", ".git", ".next", "__pycache__", "sim", "dist"}


def sources() -> list[Path]:
    out: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in {".py", ".ts", ".tsx", ".sql"}:
            continue
        if any(part in SKIP for part in path.parts):
            continue
        # This file defines every banned pattern as a literal, so scanning
        # it reports itself. Not a loophole: it holds no product code, and
        # CI runs it rather than shipping it.
        if path.resolve() == Path(__file__).resolve():
            continue
        out.append(path)
    return out


def code_lines(path: Path) -> list[tuple[int, str]]:
    """Executable lines only — comments and docstrings stripped.

    Necessary rather than tidy. Every banned term appears in this repository's
    prose *because* it is banned, so a scanner that reads docstrings reports the
    prohibition as its own violation. That is what the first run did: it failed
    on a module docstring in ganana/classes.py whose entire purpose is to record
    that person detection is forbidden.

    Python is parsed rather than pattern-matched: `ast` knows exactly which line
    ranges are docstrings, where a hand-written quote tracker gets it wrong on
    the second line of a docstring, which is precisely the case that bit here.
    """
    text = path.read_text(encoding="utf-8", errors="ignore")
    skip: set[int] = set()

    if path.suffix == ".py":
        import ast

        try:
            tree = ast.parse(text)
        except SyntaxError:
            return []
        for node in ast.walk(tree):
            if not isinstance(
                node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
            ):
                continue
            body = getattr(node, "body", [])
            if not body:
                continue
            first = body[0]
            if (
                isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)
                and first.end_lineno is not None
            ):
                skip.update(range(first.lineno, first.end_lineno + 1))

    out: list[tuple[int, str]] = []
    in_block = False
    for i, raw in enumerate(text.splitlines(), 1):
        if i in skip:
            continue
        line = raw
        if in_block:
            if "*/" in line:
                line = line.split("*/", 1)[1]
                in_block = False
            else:
                continue
        if "/*" in line:
            head, _, tail = line.partition("/*")
            if "*/" in tail:
                line = head + tail.split("*/", 1)[1]
            else:
                line = head
                in_block = True
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "//", "*")):
            continue
        out.append((i, stripped))
    return out


Finding = tuple[str, str]


def check_no_biometrics(files: list[Path]) -> list[Finding]:
    """No facial recognition, person detection, gait or biometric analysis.

    Fails on an actual import or model reference, not on the words appearing in
    prose — every one of these terms appears in the docs precisely because they
    are forbidden, and a checker that cannot tell a prohibition from a violation
    is noise.
    """
    banned = re.compile(
        r"\b(face_recognition|facenet|insightface|deepface|mediapipe\.face|"
        r"dlib\.get_frontal_face|gait|reid|person_reid|arcface)\b",
        re.I,
    )
    out: list[Finding] = []
    for f in files:
        for i, line in code_lines(f):
            if banned.search(line):
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:90]))
    return out


def check_no_agpl(files: list[Path]) -> list[Finding]:
    """No Ultralytics YOLO in shippable code — AGPL-3.0 is a procurement blocker."""
    banned = re.compile(r"\b(from|import)\s+ultralytics\b|ultralytics\.YOLO", re.I)
    out: list[Finding] = []
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        if "non-shippable" in text.lower():
            continue  # explicitly marked experiment, per CLAUDE.md
        for i, line in code_lines(f):
            if banned.search(line):
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:90]))
    return out


def check_no_plate_logging(files: list[Path]) -> list[Finding]:
    """No raw plate into a log, metric or cache.

    Looks for a logging or print call whose arguments mention a plate field
    without a hash or ciphertext marker on the same line.
    """
    call = re.compile(r"(logger\.\w+|logging\.\w+|print|console\.(log|info|warn|error))\s*\(")
    plate = re.compile(r"\b(plate|number_plate|licence_plate|license_plate|reg_no)\b", re.I)
    safe = re.compile(r"(hash|hashed|salted|cipher|encrypted|_enc|redact|mask)", re.I)
    out: list[Finding] = []
    for f in files:
        for i, line in code_lines(f):
            if call.search(line) and plate.search(line) and not safe.search(line):
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:90]))
    return out


def check_no_direct_actuation(files: list[Path]) -> list[Finding]:
    """Signal output is advisory; a human approves.

    Fails on anything that looks like a write to a controller. The owner
    confirmed this prohibition stays, so it is enforced rather than documented.
    """
    banned = re.compile(
        r"\b(set_signal_state|write_to_controller|actuate|ntcip|push_signal_plan|"
        r"apply_plan_to_junction)\s*\(",
        re.I,
    )
    out: list[Finding] = []
    for f in files:
        for i, line in code_lines(f):
            if banned.search(line):
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:90]))
    return out


def check_no_secrets(files: list[Path]) -> list[Finding]:
    """No key, token or password committed. The repository is public."""
    banned = re.compile(
        r"(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{30,}|"
        r"postgres(ql)?://[^\s\"']*:[^\s\"'@]+@|"
        r"(api[_-]?key|secret|password|token)\s*[:=]\s*[\"'][A-Za-z0-9_\-]{16,}[\"'])",
        re.I,
    )
    allow = re.compile(
        r"(process\.env|os\.environ|getenv|settings\.|example|placeholder|xxx)", re.I
    )
    out: list[Finding] = []
    for f in files:
        for i, line in code_lines(f):
            if banned.search(line) and not allow.search(line):
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:90]))
    return out


CHECKS = (
    ("no facial recognition / person tracking / gait", check_no_biometrics),
    ("no AGPL detection model in shippable code", check_no_agpl),
    ("no raw plate in logs, metrics or caches", check_no_plate_logging),
    ("no direct model-to-signal actuation", check_no_direct_actuation),
    ("no secrets committed (public repository)", check_no_secrets),
)


def main() -> int:
    files = sources()
    print(f"security audit over {len(files)} source files\n")
    failed = 0
    for name, fn in CHECKS:
        findings = fn(files)
        if findings:
            failed += 1
            print(f"  FAIL  {name}")
            for where, what in findings[:5]:
                print(f"          {where}  {what}")
            if len(findings) > 5:
                print(f"          ... and {len(findings) - 5} more")
        else:
            print(f"  pass  {name}")

    print()
    if failed:
        print(f"{failed} prohibition(s) violated — this is a release blocker.")
        return 1
    print("All prohibitions hold. Re-run in CI; a claim that is not checked stops being true.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
