"""Live area accumulation: the joins, and the ways it must decline.

This endpoint answers the question the project has been asked most, which makes
it the one most worth attacking. Four things could go wrong quietly:

  * a stale sweep could keep an area shown as saturated after it cleared
  * an estimate could be summed into a field that means "a camera counted this"
  * capacity could be taken over the whole catchment while traffic is taken over
    a handful of links, which would show every area permanently clear
  * a link could be assigned to the wrong catchment and move traffic between
    two areas without changing the total, so no sanity check would catch it

One test each.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pravaah.api import accumulation_live, probe

# Two stations far enough apart that nearest-station assignment is unambiguous.
AREAS = {
    "thanas": [
        {"name": "North Thana", "station": {"lon": 75.80, "lat": 26.95}},
        {"name": "South Thana", "station": {"lon": 75.80, "lat": 26.80}},
    ],
    "cordon_plan": [{"area": "North Thana", "cordon_links": 7}],
}

SEGMENTS = {
    "link_points": {
        # Sits beside the northern station.
        "1": {
            "name": "North Road",
            "corridor_id": 1,
            "lon": 75.80,
            "lat": 26.949,
            "free_flow_kmh": 50.0,
            "lanes": 4,
            "length_km": 1.0,
        },
        # Beside the southern one.
        "2": {
            "name": "South Road",
            "corridor_id": 2,
            "lon": 75.80,
            "lat": 26.801,
            "free_flow_kmh": 50.0,
            "lanes": 2,
            "length_km": 2.0,
        },
    }
}


def reading(speed: float, free_flow: float = 50.0, measured: bool = True) -> dict[str, Any]:
    return {"speed_kmh": speed, "free_flow_kmh": free_flow, "is_measured": measured}


@pytest.fixture
def wired(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point the module's file loader at fixtures we control."""

    def setup(readings: dict[str, Any], areas: dict[str, Any] | None = None) -> None:
        files = {
            ("data", "probe", "segments.json"): SEGMENTS,
            ("apps", "web", "src", "data", "areas.json"): areas if areas is not None else AREAS,
        }

        def fake_load(*parts: str) -> dict[str, Any]:
            return files.get(tuple(parts), {})

        monkeypatch.setattr(accumulation_live, "_load", fake_load)
        monkeypatch.setattr(accumulation_live.probe, "readings", lambda *a, **k: readings)
        monkeypatch.setattr(
            accumulation_live.probe,
            "coverage",
            lambda: {"captured_at": "2026-08-19T09:00:00+00:00"},
        )

    return setup


class TestItDeclines:
    def test_no_fresh_sweep_means_no_answer(self, wired) -> None:
        # A stale accumulation is worse than none: an area that cleared twenty
        # minutes ago would still read saturated and someone might hold a cordon.
        wired({})
        result = accumulation_live.live()
        assert result["available"] is False
        assert result["areas"] == []
        assert "stale" in result["reason"]

    def test_a_reading_below_the_confidence_floor_is_not_used(self, wired) -> None:
        wired({"1": reading(20.0, measured=False)})
        assert accumulation_live.live()["areas"] == []

    def test_a_missing_network_cache_is_not_a_crash(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(accumulation_live, "_load", lambda *_p: {})
        monkeypatch.setattr(probe, "readings", lambda *a, **k: {"1": reading(20.0)})
        assert accumulation_live.live()["available"] is False


class TestAssignment:
    def test_links_land_in_the_nearest_catchment(self, wired) -> None:
        wired({"1": reading(20.0), "2": reading(20.0)})
        areas = {a["area"]: a for a in accumulation_live.live()["areas"]}
        assert set(areas) == {"North Thana", "South Thana"}
        assert areas["North Thana"]["links_estimated"] == 1
        assert areas["South Thana"]["links_estimated"] == 1

    def test_an_area_with_no_sampled_link_is_absent_not_zero(self, wired) -> None:
        # Absent means unmeasured. A zero would read as an empty area, which is
        # the same mistake `mean_congestion: null` was introduced to avoid.
        wired({"1": reading(20.0)})
        result = accumulation_live.live()
        assert [a["area"] for a in result["areas"]] == ["North Thana"]
        assert result["areas_with_estimate"] == 1
        assert result["areas_total"] == 2
        assert "not the same as clear" in result["coverage_note"]


class TestCapacityIsLikeForLike:
    def test_critical_covers_only_the_links_that_contributed(self, wired) -> None:
        # North is 4 lanes x 1 km = 4 lane-km -> 32 * 4 = 128 critical.
        # South is 2 lanes x 2 km = 4 lane-km -> the same. Equal capacity from
        # different geometry is the point: it is lane-km that holds vehicles.
        wired({"1": reading(20.0), "2": reading(20.0)})
        areas = {a["area"]: a for a in accumulation_live.live()["areas"]}
        assert areas["North Thana"]["critical_accumulation"] == 128
        assert areas["South Thana"]["critical_accumulation"] == 128

    def test_capacity_shrinks_when_fewer_links_report(self, wired) -> None:
        # If capacity were taken over the whole catchment regardless, dropping a
        # link would leave critical unchanged and the area would look clearer
        # than it is. It must fall with the coverage.
        wired({"1": reading(20.0), "2": reading(20.0)})
        both = accumulation_live.live()["areas"]
        wired({"1": reading(20.0)})
        one = accumulation_live.live()["areas"]
        assert sum(a["critical_accumulation"] for a in one) < sum(
            a["critical_accumulation"] for a in both
        )


class TestTheNumbers:
    def test_slower_traffic_means_more_vehicles(self, wired) -> None:
        wired({"1": reading(45.0)})
        light = accumulation_live.live()["areas"][0]["vehicles_estimated"]
        wired({"1": reading(12.0)})
        heavy = accumulation_live.live()["areas"][0]["vehicles_estimated"]
        assert heavy > light

    def test_every_area_carries_a_band(self, wired) -> None:
        wired({"1": reading(20.0)})
        area = accumulation_live.live()["areas"][0]
        assert area["vehicles_low"] <= area["vehicles_estimated"] <= area["vehicles_high"]

    def test_free_flow_speed_is_an_empty_area_not_a_missing_one(self, wired) -> None:
        wired({"1": reading(50.0)})
        area = accumulation_live.live()["areas"][0]
        assert area["vehicles_estimated"] == 0
        assert area["regime"] == "free"

    def test_areas_are_ordered_worst_first(self, wired) -> None:
        wired({"1": reading(10.0), "2": reading(48.0)})
        areas = accumulation_live.live()["areas"]
        assert areas[0]["saturation"] >= areas[-1]["saturation"]

    def test_clamped_links_are_counted_and_reported(self, wired) -> None:
        # Below the model's floor the clamp answers, not Underwood. An area
        # leaning on clamped links should be visibly doing so.
        wired({"1": reading(0.4)})
        assert accumulation_live.live()["areas"][0]["links_clamped"] == 1


class TestProvenance:
    def test_it_is_labelled_estimated_never_measured(self, wired) -> None:
        wired({"1": reading(20.0)})
        result = accumulation_live.live()
        assert result["provenance"] == "estimated"
        assert result["method"]["provenance"] == "estimated"
        # The field name itself carries the caveat, so a consumer that ignores
        # the provenance block still cannot read it as a count.
        assert "vehicles_estimated" in result["areas"][0]
        assert "vehicles_per_hour" not in result["areas"][0]

    def test_perimeter_control_stays_advisory(self, wired) -> None:
        # CLAUDE.md prohibition: no direct model-to-signal actuation. Naming
        # gates to hold is the closest this platform comes to it.
        wired({"1": reading(20.0)})
        result = accumulation_live.live()
        assert "Advisory" in result["method"]["actuation"]
        assert "officer" in result["areas"][0]["gates"]["note"]

    def test_the_payload_is_not_flagged_synthetic(self, wired) -> None:
        # The speeds behind it are genuinely measured. Estimated is not the same
        # as synthetic and the badge must not say the wrong one.
        wired({"1": reading(20.0)})
        assert accumulation_live.live()["is_synthetic"] is False


def test_the_real_areas_file_still_has_stations() -> None:
    """The fixtures above stub the file. This checks the real one still fits.

    A rebuild of areas.json that dropped `station` would leave every catchment
    unassignable, and every test here would still pass.
    """
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "apps" / "web" / "src" / "data" / "areas.json"
        if candidate.exists():
            thanas = json.loads(candidate.read_text())["thanas"]
            assert all(t.get("station") for t in thanas)
            return
    pytest.skip("areas.json not found from this directory")
