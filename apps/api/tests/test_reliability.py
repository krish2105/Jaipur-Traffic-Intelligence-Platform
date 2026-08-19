"""Travel time reliability: the arithmetic, and the refusals.

Two halves. The first checks the indices against numbers worked out by hand, so
a figure quoted to a department can be reproduced with a calculator rather than
by trusting this module. The second checks that it declines to produce a figure
at all when the history behind it is too thin or too narrow, which is the part
that will matter in the room.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pravaah.api import reliability

NOW = datetime(2026, 8, 19, 12, 0, tzinfo=UTC)


@pytest.fixture
def history(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Write a history file and point the module at it."""

    def write(rows: list[dict[str, Any]]) -> Path:
        path = tmp_path / "history.jsonl"
        path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        monkeypatch.setattr(reliability, "_find", lambda n: path if n == "history.jsonl" else None)
        return path

    return write


def sweeps(count: int, *, hours: int, link: str = "52", current: float = 100.0) -> list[dict]:
    """`count` sweeps spread across `hours` distinct clock hours."""
    rows = []
    for i in range(count):
        when = NOW - timedelta(days=1) + timedelta(hours=i % hours, minutes=i)
        rows.append({"t": when.isoformat(), "r": {link: [current, 60.0, 1.0]}})
    return rows


class TestPercentile:
    """Worked out by hand on [10, 20, 30, 40, 50]."""

    def test_p95_interpolates(self) -> None:
        # rank = (5-1) * 0.95 = 3.8 -> 40 + (50-40)*0.8 = 48
        assert reliability.percentile([10, 20, 30, 40, 50], 0.95) == pytest.approx(48.0)

    def test_p50_lands_on_a_sample(self) -> None:
        # rank = (5-1) * 0.5 = 2.0 -> exactly the third value
        assert reliability.percentile([10, 20, 30, 40, 50], 0.50) == pytest.approx(30.0)

    def test_order_does_not_matter(self) -> None:
        assert reliability.percentile([50, 10, 40, 20, 30], 0.95) == pytest.approx(48.0)

    def test_one_sample_is_its_own_percentile(self) -> None:
        assert reliability.percentile([17.0], 0.95) == pytest.approx(17.0)

    def test_no_samples_is_zero_not_a_crash(self) -> None:
        assert reliability.percentile([], 0.95) == 0.0


class TestIndices:
    def test_computed_against_hand_arithmetic(self, history) -> None:
        # Ten each of 10, 20, 30, 40, 50 against a 20s free flow: n = 50, not 5,
        # which is where a first pass at this test got its arithmetic wrong.
        #   mean  (10+20+30+40+50) / 5                     = 30
        #   p95   rank 49 x 0.95 = 46.55, and values 40..49 are all 50, so 50
        #   buffer index         (50 - 30) / 30            = 0.667
        #   planning time index   50 / 20                  = 2.5
        #   travel time index     30 / 20                  = 1.5
        rows = []
        for i in range(50):
            when = NOW - timedelta(days=1) + timedelta(hours=i % 10, minutes=i)
            rows.append(
                {"t": when.isoformat(), "r": {"52": [[10, 20, 30, 40, 50][i % 5], 20.0, 1.0]}}
            )
        history(rows)

        segment = reliability.by_segment(now=NOW)["segments"][0]
        assert segment["sufficient"] is True
        assert segment["mean_travel_time_s"] == pytest.approx(30.0)
        assert segment["p95_travel_time_s"] == pytest.approx(50.0)
        assert segment["buffer_index"] == pytest.approx(0.667)
        assert segment["planning_time_index"] == pytest.approx(2.5)
        assert segment["travel_time_index"] == pytest.approx(1.5)

    def test_a_perfectly_reliable_road_has_a_zero_buffer(self, history) -> None:
        # Every trip identical: no cushion is needed, whatever the delay is.
        history(sweeps(50, hours=10, current=100.0))
        segment = reliability.by_segment(now=NOW)["segments"][0]
        assert segment["buffer_index"] == pytest.approx(0.0)
        # But it is still slow against free flow, and that shows up separately.
        assert segment["travel_time_index"] > 1.0


class TestTheGate:
    """A figure withheld is cheaper than a figure that misleads."""

    def test_too_few_sweeps_is_refused(self, history) -> None:
        history(sweeps(reliability.MIN_SAMPLES - 1, hours=10))
        segment = reliability.by_segment(now=NOW)["segments"][0]
        assert segment["sufficient"] is False
        assert "1 more sweeps" in segment["needs"]
        assert "buffer_index" not in segment

    def test_enough_sweeps_from_too_few_hours_is_still_refused(self, history) -> None:
        # This is the failure the sample count alone would let through: plenty of
        # readings, all from one afternoon, describing that afternoon.
        history(sweeps(reliability.MIN_SAMPLES + 20, hours=2))
        segment = reliability.by_segment(now=NOW)["segments"][0]
        assert segment["sufficient"] is False
        assert "distinct hours" in segment["needs"]

    def test_low_confidence_samples_are_dropped_not_blended(self, history) -> None:
        # Below TomTom's floor it is reporting its own history. Averaging that
        # into a percentile would put a model inside a measured index.
        rows = sweeps(reliability.MIN_SAMPLES + 10, hours=10)
        for row in rows:
            row["r"]["52"][2] = 0.4
        history(rows)
        assert reliability.by_segment(now=NOW)["segments"] == []

    def test_the_gate_thresholds_are_both_enforced(self) -> None:
        assert reliability.MIN_SAMPLES >= 40
        assert reliability.MIN_DISTINCT_HOURS >= 8


class TestHistoryLoading:
    def test_a_half_written_line_is_skipped(self, history, tmp_path: Path) -> None:
        # The file is appended to by a cron; a truncated final line is normal.
        path = history(sweeps(3, hours=3))
        path.write_text(path.read_text() + '{"t":"2026-08-19T09:00')
        assert len(reliability.load_history(now=NOW)) == 3

    def test_sweeps_outside_the_window_are_excluded(self, history) -> None:
        old = NOW - timedelta(days=reliability.WINDOW_DAYS + 5)
        history([{"t": old.isoformat(), "r": {"52": [100.0, 60.0, 1.0]}}, *sweeps(2, hours=2)])
        assert len(reliability.load_history(now=NOW)) == 2

    def test_a_missing_file_is_empty_not_an_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(reliability, "_find", lambda _n: None)
        assert reliability.load_history() == []
        assert reliability.by_segment()["segments"] == []


class TestCorridorAggregation:
    def test_segments_are_summed_within_a_sweep(self, history) -> None:
        # Two segments of 100s each in every sweep. A corridor traverse is 200s.
        # Taking each segment's percentile and adding them would give the same
        # answer here on purpose: the point of this test is that the traverse is
        # 200 and not 100, so the summing happens at all.
        rows = []
        for i in range(50):
            when = NOW - timedelta(days=1) + timedelta(hours=i % 10, minutes=i)
            rows.append(
                {"t": when.isoformat(), "r": {"52": [100.0, 60.0, 1.0], "53": [100.0, 60.0, 1.0]}}
            )
        history(rows)
        corridor = reliability.by_corridor({"52": 1, "53": 1}, now=NOW)["corridors"][0]
        assert corridor["segments_sampled"] == 2
        assert corridor["mean_travel_time_s"] == pytest.approx(200.0)
        assert corridor["free_flow_travel_time_s"] == pytest.approx(120.0)

    def test_a_link_with_no_corridor_is_ignored(self, history) -> None:
        history(sweeps(50, hours=10, link="999"))
        assert reliability.by_corridor({"52": 1}, now=NOW)["corridors"] == []

    def test_the_traverse_approximation_is_disclosed(self, history) -> None:
        # The sampled segments do not tile the corridor end to end, and saying so
        # is the difference between an estimate and an overclaim.
        history(sweeps(3, hours=3))
        assert "do not tile it" in reliability.by_corridor({"52": 1}, now=NOW)["traverse_note"]
