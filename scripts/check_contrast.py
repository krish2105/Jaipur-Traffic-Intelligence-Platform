"""Fail the build if any palette token drops below its contrast target.

docs/03 §7 sets WCAG 2.2 AA. A palette is easy to nudge during design and hard
to re-audit by eye, so this runs in CI: every --ink*/--accent token is measured
against its own palette's --ground, and the congestion ramp against the same.
"""

from __future__ import annotations

import pathlib
import re
import sys

PALETTES = pathlib.Path(__file__).resolve().parents[1] / "apps/web/src/styles/palettes.css"

BODY_AA = 4.5
LARGE_AA = 3.0
#: --ink-faint is documented as decorative/large only, so it holds the 3:1 floor.
TARGETS = {"ink": BODY_AA, "ink-muted": BODY_AA, "ink-faint": LARGE_AA, "accent": BODY_AA}
RAMP = (
    "congestion-free",
    "congestion-light",
    "congestion-moderate",
    "congestion-severe",
    "congestion-critical",
)


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(value: str) -> float:
    h = value.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def ratio(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def main() -> int:
    css = PALETTES.read_text(encoding="utf-8")
    blocks = re.findall(r'\[data-(?:palette|scene)="(\w+)"\]\s*\{(.*?)\n\}', css, re.S)
    palettes: dict[str, dict[str, str]] = {}
    for name, body in blocks:
        values = dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", body))
        palettes.setdefault(name, {}).update(values)

    failures: list[str] = []
    for name, values in palettes.items():
        ground = values.get("ground")
        if not ground:
            continue
        # Daylight chrome sits on --surface (white panels), not on the page
        # ground, so measure it against what the text is actually printed on.
        if name == "day":
            ground = values.get("surface", ground)
        for token, target in TARGETS.items():
            if token not in values:
                continue
            got = ratio(values[token], ground)
            if got < target:
                failures.append(f"{name}/--{token}: {got:.2f}:1 < {target}:1")
        for token in RAMP:
            if token in values and ratio(values[token], ground) < LARGE_AA:
                failures.append(
                    f"{name}/--{token}: {ratio(values[token], ground):.2f}:1 < {LARGE_AA}:1"
                )

    if failures:
        print("CONTRAST FAILURES:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    print(f"PASS  {len(palettes)} palettes, all tokens meet their contrast target")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
