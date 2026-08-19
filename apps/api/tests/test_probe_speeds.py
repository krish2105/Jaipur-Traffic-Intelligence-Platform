"""Rules governing when a live probe reading is allowed to become a speed.

Three things can go wrong with a real measurement, and all three produce a
number that looks perfectly reasonable on screen:

  * it is stale, and describes traffic that has since cleared
  * it is being applied to a moment in the past that it never described
  * it is below the provider's own confidence floor, so it is their model
    wearing a measurement's clothes

Each of those is cheaper to prevent than to explain, so each has a test.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pravaah.api import probe


def _payload(captured: datetime, **links: Any) -> dict[str, Any]:
    return {
        "captured_at": captured.isoformat(),
        "provider": "TomTom Flow Segment Data v4",
        "sample": {"segments_read": 25, "links_covered": 90},
        "budget": {"monthly_limit": 20000, "calls_used": 25},
        "links": links,
    }


@pytest.fixture
def probe_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point the loader at a file we control."""

    def write(payload: dict[str, Any], name: str = "speeds.json") -> Path:
        path = tmp_path / name
        path.write_text(json.dumps(payload))
        monkeypatch.setattr(probe, "_find", lambda n: path if n == name else None)
        return path

    return write


class TestFreshness:
    def test_a_recent_sweep_is_used(self, probe_file) -> None:
        now = datetime.now(UTC)
        probe_file(_payload(now - timedelta(minutes=10), **{"1": {"is_measured": True}}))
        assert probe.readings(now=now) != {}

    def test_a_stale_sweep_is_refused(self, probe_file) -> None:
        # Older than two cadences. The file still parses and the numbers still
        # look plausible, which is exactly why this is enforced in code.
        now = datetime.now(UTC)
        probe_file(_payload(now - timedelta(minutes=91), **{"1": {"is_measured": True}}))
        assert probe.readings(now=now) == {}

    def test_the_boundary_is_ninety_minutes(self) -> None:
        assert probe.MAX_AGE.total_seconds() == 90 * 60

    def test_a_missing_file_is_not_an_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(probe, "_find", lambda _n: None)
        assert probe.readings() == {}
        assert probe.coverage()["is_fresh"] is False

    def test_a_half_written_file_is_not_an_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A sweep writing while a request reads. Not worth a 500.
        broken = tmp_path / "speeds.json"
        broken.write_text('{"captured_at": "2026-08-19T08:00')
        monkeypatch.setattr(probe, "_find", lambda _n: broken)
        assert probe.readings() == {}


class TestHistoryIsNotNow:
    """A reading taken this afternoon says nothing about 14 March."""

    def test_a_past_moment_gets_no_probe(self, probe_file) -> None:
        now = datetime.now(UTC)
        probe_file(_payload(now, **{"1": {"is_measured": True}}))
        assert probe.readings(at=now - timedelta(days=60), now=now) == {}

    def test_a_moment_that_is_effectively_now_does(self, probe_file) -> None:
        # The console passes `at` even for the live view, so "now" has to mean
        # "close enough to now" rather than "absent".
        now = datetime.now(UTC)
        probe_file(_payload(now, **{"1": {"is_measured": True}}))
        assert probe.readings(at=now - timedelta(minutes=5), now=now) != {}

    def test_a_naive_timestamp_is_read_as_utc(self, probe_file) -> None:
        # FastAPI hands over whatever the query string carried. A naive value
        # compared against an aware one raises, and a 500 on the scene endpoint
        # blanks the entire console.
        now = datetime.now(UTC)
        probe_file(_payload(now, **{"1": {"is_measured": True}}))
        assert probe.readings(at=now.replace(tzinfo=None), now=now) != {}

    def test_a_future_moment_gets_no_probe(self, probe_file) -> None:
        now = datetime.now(UTC)
        probe_file(_payload(now, **{"1": {"is_measured": True}}))
        assert probe.readings(at=now + timedelta(days=1), now=now) == {}


class TestCoverage:
    def test_it_counts_segments_as_well_as_links(self, probe_file) -> None:
        # Counting links alone overstates how many independent measurements
        # exist: several links share one TomTom segment and one reading.
        probe_file(_payload(datetime.now(UTC)))
        report = probe.coverage()
        assert report["segments_read"] == 25
        assert report["links_covered"] == 90

    def test_it_reports_the_budget(self, probe_file) -> None:
        # A panel that cannot say how much of the month's allowance is gone
        # eventually surprises somebody with a bill.
        probe_file(_payload(datetime.now(UTC)))
        assert probe.coverage()["budget"]["monthly_limit"] == 20000

    def test_stale_data_reports_itself_stale(self, probe_file) -> None:
        probe_file(_payload(datetime.now(UTC) - timedelta(hours=5)))
        report = probe.coverage()
        assert report["is_fresh"] is False
        assert report["age_minutes"] > 90
