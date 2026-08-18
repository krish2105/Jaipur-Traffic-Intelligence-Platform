"""The seed profile must reproduce the published Jaipur measurements.

docs/02 rule 6 allows synthetic data and requires it to be labelled. docs/05 §5
goes further: the *shapes* must be honest, derived from real TomTom-measured
Jaipur profiles, so a traffic engineer looking at the demo sees a plausible day.

These tests are the guard on that claim. If someone tunes the curve and the
published numbers stop coming out, the build fails.
"""

from __future__ import annotations

from datetime import date

import pytest
from pravaah.adapters import profiles as P

WEEKDAY = date(2026, 8, 17)  # a Monday


class TestPublishedAnchors:
    """Every figure here is quoted in docs/01 §2 from TomTom Traffic Index 2025."""

    def test_travel_weighted_mean_congestion_is_58_7(self) -> None:
        assert P.travel_weighted_mean_congestion() == pytest.approx(58.7, abs=0.05)

    def test_morning_peak_is_73_9(self) -> None:
        assert P.congestion_index(10, 0, WEEKDAY) == pytest.approx(73.9, abs=0.05)

    def test_evening_peak_is_94_9(self) -> None:
        assert P.congestion_index(19, 0, WEEKDAY) == pytest.approx(94.9, abs=0.05)

    def test_rush_hour_mean_speed_is_17_5_kmh(self) -> None:
        assert P.rush_hour_mean_speed() == pytest.approx(17.5, abs=0.05)

    def test_worst_day_of_2025_averages_90_percent(self) -> None:
        assert P.day_mean_congestion(P.WORST_DAY_2025) == pytest.approx(90.0, abs=0.1)


class TestShape:
    def test_evening_peak_exceeds_morning_peak(self) -> None:
        """94.9 vs 73.9 — the evening bulge is the bigger one, and the gnomon
        arc is supposed to make that readable at a glance (docs/06 §1)."""
        assert P.congestion_index(19, 0, WEEKDAY) > P.congestion_index(10, 0, WEEKDAY)

    def test_night_is_quiet(self) -> None:
        assert P.congestion_index(3, 0, WEEKDAY) < 15

    def test_morning_builds_rather_than_jumping(self) -> None:
        """07:00 must show real build-up, not a night-floor value."""
        early = P.congestion_index(7, 0, WEEKDAY)
        assert 20 < early < 55

    def test_sunday_is_materially_quieter_than_a_weekday(self) -> None:
        assert P.day_mean_congestion(date(2026, 8, 16)) < 0.75 * P.day_mean_congestion(WEEKDAY)

    def test_index_never_leaves_the_schema_range(self) -> None:
        """link_congestion.congestion_index has a CHECK 0..100 — the generator
        must never produce a row the database would refuse."""
        for day in (WEEKDAY, P.WORST_DAY_2025, date(2026, 8, 16)):
            for hour in range(24):
                for minute in (0, 17, 30, 59):
                    assert 0.0 <= P.congestion_index(hour, minute, day) <= 100.0

    def test_speed_falls_as_congestion_rises(self) -> None:
        speeds = [P.speed_kmh(i, 40.0) for i in range(0, 101, 10)]
        assert speeds == sorted(speeds, reverse=True)


class TestFleetComposition:
    def test_class_shares_sum_to_one(self) -> None:
        assert sum(P.CLASS_SHARE.values()) == pytest.approx(1.0, abs=1e-9)

    def test_fleet_is_two_wheeler_dominant(self) -> None:
        """docs/04 §2: 'Two-wheeler performance is the whole ballgame.' If this
        share ever drifts below a majority the demo stops representing Jaipur."""
        assert P.CLASS_SHARE["2W"] > 0.55

    def test_hour_weights_sum_to_one(self) -> None:
        assert sum(P.hour_weight(h) for h in range(24)) == pytest.approx(1.0, abs=1e-9)


class TestQualityDegradesHonestly:
    def test_night_bins_are_flagged_and_scored_lower(self) -> None:
        day_score, day_flags = P.quality_score(13, is_wet=False)
        night_score, night_flags = P.quality_score(2, is_wet=False)
        assert night_score < day_score
        assert "low_light" in night_flags
        assert day_flags == [] or "low_light" not in day_flags

    def test_rain_degrades_quality(self) -> None:
        dry, _ = P.quality_score(13, is_wet=False)
        wet, flags = P.quality_score(13, is_wet=True)
        assert wet < dry
        assert "rain" in flags

    def test_worst_case_still_within_zero_one(self) -> None:
        score, _ = P.quality_score(3, is_wet=True)
        assert 0.0 <= score <= 1.0
