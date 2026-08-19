"""Counting behaviour, and the prohibition.

Each test pins a decision that a plausible refactor would reverse, and every
reversal here produces a wrong number on a government screen.
"""

import pytest
from pravaah.ganana.classes import (
    PERSON_CLASS_IDS,
    UNAVAILABLE_WITHOUT_FINETUNE,
    assert_no_person_classes,
    class_for,
    is_countable,
    pcu_for,
)
from pravaah.ganana.counting import LineCounter

LINE = ((0.0, 5.0), (10.0, 5.0))


def _drive(counter: LineCounter, track_id: int, coco_id: int, ys: list[float]) -> None:
    for y in ys:
        counter.update(track_id, coco_id, (5.0, y))


# ── the prohibition ──────────────────────────────────────────────────────────


def test_a_person_is_never_countable() -> None:
    for pid in PERSON_CLASS_IDS:
        assert not is_countable(pid)
        assert class_for(pid) is None


def test_a_person_reaching_the_counter_raises_rather_than_being_dropped() -> None:
    # Silently filtering would let the prohibition rot: the day detection stops
    # discarding people, nothing would tell us.
    with pytest.raises(ValueError, match="person detection"):
        assert_no_person_classes([2, 3, 0])


def test_a_person_crossing_the_line_produces_no_count() -> None:
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 0, [1.0, 3.0, 4.0, 6.0, 8.0])
    assert counter.crossings == []
    assert counter.totals() == {}


# ── counting is an event, not a state ────────────────────────────────────────


def test_a_vehicle_is_counted_once_however_many_frames_it_appears_in() -> None:
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 2, [1.0, 2.0, 3.0, 4.0, 6.0, 7.0, 8.0, 9.0])
    assert len(counter.crossings) == 1


def test_a_stopped_vehicle_contributes_nothing() -> None:
    # The failure this prevents: counting per frame makes a jam look like
    # enormous flow, so the number rises as the road gets worse.
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 2, [3.0] * 40)
    assert counter.crossings == []


def test_a_vehicle_wobbling_over_the_line_is_not_counted_twice() -> None:
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 2, [3.0, 4.0, 4.5, 6.0, 4.5, 6.0, 4.5, 6.0])
    assert len(counter.crossings) == 1


def test_a_flickering_one_frame_detection_never_counts() -> None:
    # Detector noise only ever accumulates upward, so immature tracks are
    # ignored entirely.
    counter = LineCounter(line=LINE)
    counter.update(9, 2, (5.0, 4.0))
    counter.update(9, 2, (5.0, 6.0))
    assert counter.crossings == []


# ── geometry ─────────────────────────────────────────────────────────────────


def test_direction_is_recorded_and_opposite_directions_differ() -> None:
    # An approach count that mixes directions is useless for a signal plan.
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 2, [1.0, 2.0, 3.0, 8.0])
    _drive(counter, 2, 2, [9.0, 8.0, 7.0, 1.0])
    directions = {c.track_id: c.direction for c in counter.crossings}
    assert directions[1] == -directions[2]


def test_a_vehicle_beyond_the_line_s_extent_is_not_counted() -> None:
    # Passing the line's *extension* — a parallel carriageway past its end —
    # must not count. Testing only the track's side of the intersection is a
    # common bug that counts the opposite roadway.
    counter = LineCounter(line=LINE)
    for y in [1.0, 2.0, 3.0, 8.0]:
        counter.update(1, 2, (25.0, y))
    assert counter.crossings == []


# ── aggregation ──────────────────────────────────────────────────────────────


def test_pcu_uses_the_class_factor_not_a_vehicle_count() -> None:
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 3, [1.0, 2.0, 3.0, 8.0])  # motorcycle, 0.25
    _drive(counter, 2, 7, [1.0, 2.0, 3.0, 8.0])  # truck, 3.00
    assert counter.totals() == {"2W": 1, "TRK2": 1}
    assert counter.pcu() == pytest.approx(3.25)


def test_an_unknown_class_has_no_pcu_rather_than_defaulting_to_a_car() -> None:
    # Defaulting to 1.0 would let an unrecognised class contribute a car's
    # worth of road space to a capacity calculation.
    with pytest.raises(KeyError):
        pcu_for("NOT_A_CLASS")


def test_flow_refuses_a_zero_window_instead_of_returning_infinity() -> None:
    # The 408,000 veh/hr bug in this project's history was a flow divided by
    # the wrong window. It should stop the process, not reach a screen.
    counter = LineCounter(line=LINE)
    _drive(counter, 1, 2, [1.0, 2.0, 3.0, 8.0])
    with pytest.raises(ValueError):
        counter.flow_per_hour(0)
    assert counter.flow_per_hour(60) == 60.0


def test_classes_a_coco_model_cannot_produce_are_declared() -> None:
    # An auto-rickshaw is 6.2% of this corridor and has no COCO class. A zero
    # must be explainable as "cannot detect" rather than read as "none present".
    assert "AUTO" in UNAVAILABLE_WITHOUT_FINETUNE
    assert class_for(2) == "CAR"
