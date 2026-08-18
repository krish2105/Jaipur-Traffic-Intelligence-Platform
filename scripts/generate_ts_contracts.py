"""Generate TypeScript types from the Pydantic contracts.

docs/03 §6: types are defined once in `packages/contracts` and generated into
TypeScript. Never hand-maintain parallel type definitions — that divergence is
the most reliable source of bugs in a project like this.

Pipeline: Pydantic model -> JSON Schema -> json-schema-to-typescript.
CI runs this and fails if the checked-in output differs from a fresh run.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from pravaah.contracts import events
from pydantic import BaseModel
from pydantic.json_schema import GenerateJsonSchema

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "apps" / "web" / "src" / "contracts"
SCHEMA_PATH = OUT_DIR / "schema.json"
TS_PATH = OUT_DIR / "index.ts"

BANNER = (
    "/* eslint-disable */\n"
    "/**\n"
    " * GENERATED FILE — DO NOT EDIT.\n"
    " *\n"
    " * Source of truth: packages/contracts/src/pravaah/contracts/events.py\n"
    " * Regenerate with:  make contracts\n"
    " *\n"
    " * docs/03 §6 — types are authored once in Pydantic and generated here.\n"
    " */\n\n"
)


def _models() -> list[type[BaseModel]]:
    found = [
        obj
        for name, obj in vars(events).items()
        if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel
    ]
    return sorted(found, key=lambda m: m.__name__)


def build_schema() -> dict[str, object]:
    """One bundled schema with every event under $defs, so cross-references
    between models resolve instead of duplicating."""
    models = _models()
    generator = GenerateJsonSchema(ref_template="#/$defs/{model}")
    _, defs = generator.generate_definitions(
        [(m, "validation", m.__pydantic_core_schema__) for m in models]
    )
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "PravaahContracts",
        "type": "object",
        "properties": {m.__name__: {"$ref": f"#/$defs/{m.__name__}"} for m in models},
        "$defs": defs,
    }


def _strip_property_titles(node: object) -> None:
    """Pydantic gives every field a `title`, and json2ts turns each one into a
    hoisted named type (`EventId1`, `OccurredAt2`...). We want titles on the
    models and nowhere else, so the emitted interfaces stay readable."""
    if isinstance(node, dict):
        for props_key in ("properties", "patternProperties"):
            props = node.get(props_key)
            if isinstance(props, dict):
                for prop in props.values():
                    if isinstance(prop, dict):
                        prop.pop("title", None)
        for value in node.values():
            _strip_property_titles(value)
    elif isinstance(node, list):
        for item in node:
            _strip_property_titles(item)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    schema = build_schema()
    _strip_property_titles(schema.get("$defs"))
    SCHEMA_PATH.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")

    # Write via --output rather than capturing stdout: pnpm emits engine
    # warnings on stdout, and those would land inside the generated file.
    binary = REPO / "apps" / "web" / "node_modules" / ".bin" / "json2ts"
    result = subprocess.run(  # noqa: S603
        [
            str(binary),
            "--input",
            str(SCHEMA_PATH),
            "--output",
            str(TS_PATH),
            "--additionalProperties",
            "false",
            "--no-style.semi",
            "--bannerComment",
            "",
        ],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        return result.returncode

    TS_PATH.write_text(BANNER + TS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"wrote {SCHEMA_PATH.relative_to(REPO)}")
    print(f"wrote {TS_PATH.relative_to(REPO)}  ({len(_models())} models)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
