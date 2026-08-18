"""Accessibility checks that run without a browser.

Government procurement increasingly asks for an accessibility position, and
"we tested it manually once" is not one. This checks the failures that are
actually detectable in source and that this codebase can plausibly commit:
clickable divs, unlabelled inputs, images without alt text, positive tabindex,
and Devanagari text with no lang attribute.

It does not replace axe in a real browser. Contrast is already gated separately
by check_contrast.py, and focus order and screen-reader flow need a human. What
this catches is the set of regressions that slip in during a refactor, which is
where they actually come from.

    uv run python scripts/a11y_audit.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps/web/src"

Finding = tuple[str, str]


def files() -> list[Path]:
    return sorted(p for p in SRC.rglob("*.tsx") if "node_modules" not in p.parts)


def lines(path: Path) -> list[tuple[int, str]]:
    out = []
    for i, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if stripped and not stripped.startswith(("//", "*", "/*")):
            out.append((i, stripped))
    return out


def check_clickable_non_interactive(fs: list[Path]) -> list[Finding]:
    """A div with onClick cannot be reached by keyboard.

    Real controls are <button> and <a>. A div carrying onClick is invisible to
    tab order and to a screen reader's control list, so the feature exists only
    for people using a mouse.
    """
    out: list[Finding] = []
    for f in fs:
        text = f.read_text(encoding="utf-8")
        # A dialog dismissed by a document-level Escape listener is keyboard
        # operable even though the element itself carries no key handler, so the
        # presence of that listener is checked at file level.
        has_escape = 'e.key === "Escape"' in text or "'Escape'" in text
        for match in re.finditer(r"<(div|span|li|td|tr)\b", text):
            tag = _jsx_tag(text, match.start())
            if "onClick" not in tag:
                continue
            # An explicit role plus a key handler is a deliberate custom control.
            if "role=" in tag and ("onKeyDown" in tag or "onKeyUp" in tag):
                continue
            # A labelled modal, closable with Escape.
            if 'role="dialog"' in tag and "aria-modal" in tag and has_escape:
                continue
            # A wrapper marked presentational whose only job is to stop a
            # backdrop click reaching through. It adds no behaviour, so there is
            # nothing for a keyboard user to reach.
            if 'role="presentation"' in tag:
                continue
            line = text[: match.start()].count("\n") + 1
            out.append((f"{f.relative_to(ROOT)}:{line}", tag.replace("\n", " ")[:80]))
    return out


def _jsx_tag(text: str, start: int) -> str:
    """Read a JSX tag from `<` to its real closing `>`.

    A naive `[^>]*` stops at the first `>` in the source, and JSX attributes are
    full of them: every `onChange={(e) => ...}` contains one. That truncation is
    why the first run of this script reported four unlabelled inputs, three of
    which were labelled a few lines further down than the regex could see. A
    checker that cries wolf gets switched off, so it counts braces instead.
    """
    depth = 0
    for i in range(start, min(len(text), start + 4000)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == ">" and depth == 0:
            return text[start : i + 1]
    return text[start : start + 400]


def check_unlabelled_inputs(fs: list[Path]) -> list[Finding]:
    """An input with no label, aria-label or aria-labelledby is unusable blind."""
    out: list[Finding] = []
    for f in fs:
        text = f.read_text(encoding="utf-8")
        for match in re.finditer(r"<input\b", text):
            tag = _jsx_tag(text, match.start())
            if 'type="hidden"' in tag:
                continue
            has_aria = "aria-label" in tag or "aria-labelledby" in tag
            # A paired <label for=...> counts, so accept an id that a label targets.
            ident = re.search(r'id="([^"]+)"', tag)
            paired = bool(ident and f'htmlFor="{ident.group(1)}"' in text)
            # An input nested inside a <label> is labelled by it. Detected by
            # walking back for a <label that has not yet closed, because the
            # markup carries no id to pair on.
            before = text[: match.start()]
            wrapped = before.rfind("<label") > before.rfind("</label>")
            if not has_aria and not paired and not wrapped:
                line = text[: match.start()].count("\n") + 1
                out.append((f"{f.relative_to(ROOT)}:{line}", tag.replace("\n", " ")[:80]))
    return out


def check_images_without_alt(fs: list[Path]) -> list[Finding]:
    out: list[Finding] = []
    for f in fs:
        text = f.read_text(encoding="utf-8")
        for match in re.finditer(r"<img\b", text):
            tag = _jsx_tag(text, match.start())
            if "alt=" not in tag:
                line = text[: match.start()].count("\n") + 1
                out.append((f"{f.relative_to(ROOT)}:{line}", tag[:80]))
    return out


def check_positive_tabindex(fs: list[Path]) -> list[Finding]:
    """Anything above 0 rewrites tab order for the whole page."""
    out: list[Finding] = []
    for f in fs:
        for i, line in lines(f):
            m = re.search(r"tabIndex=\{(\d+)\}", line)
            if m and int(m.group(1)) > 0:
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:80]))
    return out


def check_devanagari_lang(fs: list[Path]) -> list[Finding]:
    """Hindi inside an English document needs lang, or it is read in English.

    Only flagged for static Devanagari in JSX text. Bilingual components that
    switch on locale set lang on a wrapper, and the page itself carries the
    locale, so a `hi ? ... : ...` expression is not a finding.
    """
    out: list[Finding] = []
    devanagari = re.compile(r"[ऀ-ॿ]")
    for f in fs:
        text = f.read_text(encoding="utf-8")
        skip = ("lang=", "useLocale", "hi ?", "{hi", 'locale === "hi"')
        if any(t in text for t in skip):
            continue
        for i, line in lines(f):
            if devanagari.search(line) and not line.startswith(("#", "//")):
                out.append((f"{f.relative_to(ROOT)}:{i}", line[:80]))
    return out


CHECKS = (
    ("interactive elements are real controls", check_clickable_non_interactive),
    ("every input is labelled", check_unlabelled_inputs),
    ("every image has alt text", check_images_without_alt),
    ("no positive tabindex", check_positive_tabindex),
    ("Devanagari carries a lang attribute", check_devanagari_lang),
)


def main() -> int:
    fs = files()
    print(f"accessibility audit over {len(fs)} components\n")
    failed = 0
    for name, fn in CHECKS:
        findings = fn(fs)
        if findings:
            failed += 1
            print(f"  FAIL  {name}  ({len(findings)})")
            for where, what in findings[:6]:
                print(f"          {where}  {what}")
            if len(findings) > 6:
                print(f"          ... and {len(findings) - 6} more")
        else:
            print(f"  pass  {name}")

    print()
    print("Not covered here: focus order, screen-reader flow, and motion. Contrast")
    print("is gated separately by check_contrast.py.")
    if failed:
        print(f"\n{failed} check(s) failing.")
        return 1
    print("\nAll automated accessibility checks pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
