"""A key in .env must reach the code that reads os.environ.

Settings reads .env into itself. The source adapters are a standalone package
and read os.environ directly, so for a while a credential written by
scripts/set_keys.sh was loaded, parsed, and never seen by anything that could
use it. The readiness panel stayed amber for a key sitting in the file, which
looks exactly like a key that was never set.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


def test_settings_import_exports_dotenv_to_the_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dotenv import load_dotenv

    env = tmp_path / ".env"
    env.write_text("PRAVAAH_TEST_ONLY_KEY=reached\n")
    monkeypatch.delenv("PRAVAAH_TEST_ONLY_KEY", raising=False)
    load_dotenv(env, override=False)
    assert os.environ.get("PRAVAAH_TEST_ONLY_KEY") == "reached"


def test_a_real_environment_wins_over_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Deployments set real environment variables. A checked-out .env must never
    # override them, which is what override=False buys.
    from dotenv import load_dotenv

    env = tmp_path / ".env"
    env.write_text("PRAVAAH_TEST_ONLY_KEY=from-file\n")
    monkeypatch.setenv("PRAVAAH_TEST_ONLY_KEY", "from-deployment")
    load_dotenv(env, override=False)
    assert os.environ.get("PRAVAAH_TEST_ONLY_KEY") == "from-deployment"


def test_settings_module_loads_the_file_at_import() -> None:
    # The mechanism, not just the library: if this call is ever removed from
    # core.settings, every adapter silently stops seeing set_keys.sh output.
    source = Path("apps/api/src/pravaah/api/core/settings.py").read_text()
    assert "load_dotenv(" in source, "core.settings must export .env to os.environ"
    assert "override=False" in source, "a real environment must win over the file"
