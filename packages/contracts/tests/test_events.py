"""The contract boundary is where bad data should die. These tests assert the
guarantees the rest of the platform is allowed to assume."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pravaah.contracts.enums import PCU_FACTORS, Direction, VehicleClass
from pravaah.contracts.events import (
    ClassCount,
    CountEvent,
    ForecastEvent,
    ViolationEvent,
)
from pydantic import ValidationError

NOW = datetime(2026, 8, 18, 8, 45, tzinfo=UTC)


def _counts() -> list[ClassCount]:
    # 8 x 2W (0.25) + 3 x car (1.0) + 1 x LCV (1.5) = 2.0 + 3.0 + 1.5 = 6.5 PCU
    # This is the worked example from docs/03 §4.
    return [
        ClassCount(class_code="2W", vehicle_count=8, pcu=2.0),
        ClassCount(class_code="CAR", vehicle_count=3, pcu=3.0),
        ClassCount(class_code="LCV", vehicle_count=1, pcu=1.5),
    ]


def _count_event(**overrides: object) -> CountEvent:
    base: dict[str, object] = {
        "event_id": "evt-1",
        "camera_id": 1,
        "link_id": 10,
        "bucket_start": NOW,
        "direction": Direction.NB,
        "counts": _counts(),
        "total_pcu": 6.5,
        "quality_score": 0.94,
        "model_version": "rtdetrv2-0.1.0",
        "edge_node_id": "node-tonk-01",
        "emitted_at": NOW,
    }
    return CountEvent(**(base | overrides))  # type: ignore[arg-type]


class TestPcuFactors:
    def test_every_vehicle_class_has_a_pcu_factor(self) -> None:
        """A class without a factor silently contributes zero to capacity maths."""
        missing = [c for c in VehicleClass if c not in PCU_FACTORS]
        assert missing == []

    def test_two_wheeler_factor_matches_irc(self) -> None:
        assert PCU_FACTORS[VehicleClass.TWO_WHEELER] == 0.25


class TestCountEvent:
    def test_accepts_the_docs_worked_example(self) -> None:
        assert _count_event().total_pcu == 6.5

    def test_rejects_total_that_disagrees_with_its_parts(self) -> None:
        with pytest.raises(ValidationError, match="total_pcu"):
            _count_event(total_pcu=99.0)

    def test_rejects_quality_score_out_of_range(self) -> None:
        with pytest.raises(ValidationError):
            _count_event(quality_score=1.4)

    def test_is_frozen(self) -> None:
        event = _count_event()
        with pytest.raises(ValidationError):
            event.camera_id = 2  # type: ignore[misc]

    def test_defaults_to_not_synthetic(self) -> None:
        """Synthetic must be opt-in and explicit — docs/02 rule 6 makes an
        unlabelled synthetic figure a project-ending mistake."""
        assert _count_event().is_synthetic is False


class TestViolationEvent:
    def _violation(self, **overrides: object) -> ViolationEvent:
        base: dict[str, object] = {
            "event_id": "v-1",
            "camera_id": 1,
            "occurred_at": NOW,
            "violation_type": "red_light",
            "plate_hash": "3f" * 32,
            "ocr_confidence": 0.91,
            "detection_confidence": 0.88,
            "evidence_uri": "s3://pravaah-evidence/v-1.jpg",
            "requires_review": False,
            "model_version": "parseq-0.1.0",
            "emitted_at": NOW,
        }
        return ViolationEvent(**(base | overrides))  # type: ignore[arg-type]

    def test_accepts_a_confident_read(self) -> None:
        assert self._violation().requires_review is False

    def test_low_confidence_must_be_routed_to_human_review(self) -> None:
        """docs/04 §4: the 0.85 gate is a hard threshold, not a tunable."""
        with pytest.raises(ValidationError, match="gate"):
            self._violation(ocr_confidence=0.62, requires_review=False)

    def test_low_confidence_is_fine_when_flagged_for_review(self) -> None:
        assert self._violation(ocr_confidence=0.62, requires_review=True).requires_review

    @pytest.mark.parametrize(
        "leaked",
        [
            "RJ14AB1234",  # the bare plate
            "RJ 14 AB 1234",  # spaced
            "RJ-14-AB-1234",  # hyphenated
            "3f" * 27 + "RJ14AB1234",  # smuggled into a hash-shaped field
        ],
    )
    def test_refuses_a_raw_registration_number(self, leaked: str) -> None:
        """docs/07 §3: the raw plate never appears on the bus, in logs, in
        metrics, or in any cache. This is the last line of defence, and it must
        catch a plate concatenated into an otherwise plausible field."""
        with pytest.raises(ValidationError, match="never put a raw registration number"):
            self._violation(plate_hash=leaked)

    @pytest.mark.parametrize("bad", ["short", "A" * 64, "3F" * 32, "z" * 64])
    def test_requires_a_lowercase_hex_hmac_digest(self, bad: str) -> None:
        with pytest.raises(ValidationError):
            self._violation(plate_hash=bad)

    def test_accepts_a_real_hmac_digest(self) -> None:
        import hashlib
        import hmac

        digest = hmac.new(b"edge-salt", b"RJ14AB1234", hashlib.sha256).hexdigest()
        assert self._violation(plate_hash=digest).plate_hash == digest


class TestForecastEvent:
    def test_rejects_a_point_estimate_outside_its_own_interval(self) -> None:
        with pytest.raises(ValidationError, match="80% interval"):
            ForecastEvent(
                event_id="f-1",
                link_id=10,
                issued_at=NOW,
                horizon_min=30,
                predicted_index=80.0,
                lower_80=10.0,
                upper_80=40.0,
                model_version="persistence-0.1.0",
            )

    def test_accepts_a_well_formed_forecast(self) -> None:
        f = ForecastEvent(
            event_id="f-2",
            link_id=10,
            issued_at=NOW,
            horizon_min=60,
            predicted_index=62.0,
            lower_80=48.0,
            upper_80=74.0,
            model_version="lightgbm-0.1.0",
        )
        assert f.horizon_min == 60
