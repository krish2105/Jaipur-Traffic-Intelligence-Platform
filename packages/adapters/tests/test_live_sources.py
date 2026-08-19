"""The two adapters that turn amber rows green, and the rule that governs them.

The rule is the point of this file. `/meta/sources` used to decide "live" from
the presence of an environment variable, and there was no TomTom adapter and no
VAHAN adapter behind either key. Setting one would have turned the badge green
and changed no number on the screen. These tests exist so that cannot come back.
"""

from __future__ import annotations

import pytest
from pravaah.adapters import tomtom, vahan


class TestReadinessRule:
    """A credential alone must never make a source claim to be live."""

    def test_unavailable_without_a_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
        monkeypatch.delenv("DATA_GOV_IN_API_KEY", raising=False)
        assert tomtom.available() is False
        assert vahan.available() is False

    def test_available_with_a_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TOMTOM_API_KEY", "k")
        monkeypatch.setenv("DATA_GOV_IN_API_KEY", "k")
        assert tomtom.available() is True
        assert vahan.available() is True

    def test_whitespace_is_not_a_credential(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # An empty value left in a .env file is the classic way a deployment
        # ends up claiming a source it does not have.
        monkeypatch.setenv("TOMTOM_API_KEY", "   ")
        assert tomtom.available() is False

    def test_every_gated_source_exposes_available(self) -> None:
        # The readiness endpoint calls `available()` by duck-typing. A new
        # adapter that forgets it would silently never go live.
        for module in (tomtom, vahan):
            assert callable(getattr(module, "available", None))


class TestFlowSegment:
    def test_congestion_from_the_delay_ratio(self) -> None:
        # 200s where free flow is 75s: 125s of 200s is lost.
        segment = tomtom.FlowSegment(18.0, 48.0, 200, 75, 0.95, False)
        assert segment.congestion_index == pytest.approx(62.5)

    def test_free_flow_is_zero_congestion(self) -> None:
        segment = tomtom.FlowSegment(48.0, 48.0, 75, 75, 0.9, False)
        assert segment.congestion_index == 0.0

    def test_missing_free_flow_does_not_divide_by_zero(self) -> None:
        segment = tomtom.FlowSegment(0.0, 0.0, 0, 0, 0.0, False)
        assert segment.congestion_index == 0.0

    def test_low_confidence_is_not_a_measurement(self) -> None:
        # Below 0.7 TomTom is largely reporting its historical model, and
        # calling that a probe reading is the error this project accuses probe
        # products of making.
        assert tomtom.FlowSegment(18.0, 48.0, 200, 75, 0.95, False).is_measured is True
        assert tomtom.FlowSegment(18.0, 48.0, 200, 75, 0.40, False).is_measured is False

    def test_a_closed_road_is_not_a_measurement(self) -> None:
        assert tomtom.FlowSegment(0.0, 48.0, 999, 75, 0.99, True).is_measured is False


class TestFleetMix:
    def test_shares_and_two_wheeler_figure(self) -> None:
        mix = vahan.FleetMix(
            district="Jaipur",
            counts={"2W": 610, "CAR": 240, "AUTO": 100, "BUS": 50},
            total=1000,
            unmapped=0,
            source="test",
        )
        assert mix.two_wheeler_share == pytest.approx(0.61)
        assert sum(mix.shares.values()) == pytest.approx(1.0)

    def test_coverage_reports_what_the_mapping_dropped(self) -> None:
        # A mapping that silently drops a third of the fleet produces a
        # confident, wrong composition, so coverage is reported alongside it.
        mix = vahan.FleetMix("Jaipur", {"2W": 600}, total=600, unmapped=400, source="t")
        assert mix.coverage == pytest.approx(0.6)

    def test_empty_fleet_has_no_shares(self) -> None:
        mix = vahan.FleetMix("Jaipur", {}, total=0, unmapped=0, source="t")
        assert mix.shares == {}
        assert mix.coverage == 0.0

    def test_class_map_only_targets_known_platform_classes(self) -> None:
        known = {
            "2W", "CAR", "AUTO", "ERIK", "LCV", "BUS",
            "TRK2", "NMV", "TAXI", "MBUS", "TRKM", "TRAC",
        }
        assert set(vahan.CLASS_MAP.values()) <= known


class TestDegradation:
    """No key means no data, never a guess."""

    @pytest.mark.asyncio
    async def test_flow_returns_none_without_a_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
        assert await tomtom.flow_at(26.9124, 75.7873) is None

    @pytest.mark.asyncio
    async def test_fleet_returns_none_without_a_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("DATA_GOV_IN_API_KEY", raising=False)
        assert await vahan.fleet("Jaipur") is None


class TestVerification:
    """A key that upstream refuses must not turn a badge green.

    `available()` says a credential and code both exist. `verified()` says the
    upstream actually accepts it. Only the second is safe to show as live: a
    typo'd or expired key would otherwise report live while every reading fell
    back to modelled, which is the same lie the adapter check was built to stop,
    one level deeper.
    """

    @pytest.mark.asyncio
    async def test_no_key_is_never_verified(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
        monkeypatch.delenv("DATA_GOV_IN_API_KEY", raising=False)
        tomtom._REACHABLE = None
        vahan._REACHABLE = None
        assert await tomtom.verified() is False
        assert await vahan.verified() is False

    @pytest.mark.asyncio
    async def test_refused_key_is_available_but_not_verified(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("TOMTOM_API_KEY", "definitely-not-a-real-key")
        tomtom._REACHABLE = None
        # available() is true — there IS a key and there IS code.
        assert tomtom.available() is True
        # verified() is false, because the upstream will not take it.
        assert await tomtom.verified() is False

    @pytest.mark.asyncio
    async def test_failures_are_cached(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # An upstream refusing us should not be re-asked on every console render.
        monkeypatch.setenv("TOMTOM_API_KEY", "nope")
        tomtom._REACHABLE = None
        first = await tomtom.verified()
        calls = {"n": 0}

        async def counting(_client: object) -> bool:
            calls["n"] += 1
            return True

        monkeypatch.setattr(tomtom, "_probe", counting)
        second = await tomtom.verified()
        assert first is False
        assert second is False, "cached failure should be reused"
        assert calls["n"] == 0, "probe should not run again inside the TTL"
