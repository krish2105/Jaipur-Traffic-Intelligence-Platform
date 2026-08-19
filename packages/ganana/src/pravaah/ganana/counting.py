"""Line-crossing counts from tracks.

A detector says what is in a frame. A counter says how many went past, which is
a different and harder question: the same vehicle appears in sixty consecutive
frames, and counting frames rather than crossings is the classic way a traffic
counter reports a jam as enormous flow — a stationary queue re-counted every
frame produces a number that rises as the road gets *worse*.

So counting here is **an event, not a state**. A vehicle is counted once, at the
moment its track crosses a line, in the direction it crossed. That gives the two
properties the rest of the platform depends on:

* a stopped vehicle contributes nothing, however long it sits;
* a vehicle that wobbles across the line does not contribute twice, because a
  track that has been counted is remembered.

Everything below is pure: it takes track positions and returns counts. No
model, no video, no clock. That is deliberate — the counting logic is where the
numbers come from, so it must be testable without a GPU.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final

from .classes import class_for, pcu_for

Point = tuple[float, float]

#: A track must be seen this many times before its crossings count. A detector
#: that flickers a false box for one or two frames would otherwise add a
#: vehicle to the day's total, and those errors only ever accumulate upward.
MIN_TRACK_LENGTH: Final = 3


def _side(line_a: Point, line_b: Point, point: Point) -> float:
    """Signed area of the triangle — which side of the line the point is on.

    The sign is what matters, not the magnitude: positive one side, negative the
    other, zero exactly on the line.
    """
    return (line_b[0] - line_a[0]) * (point[1] - line_a[1]) - (line_b[1] - line_a[1]) * (
        point[0] - line_a[0]
    )


def _segments_intersect(a1: Point, a2: Point, b1: Point, b2: Point) -> bool:
    """Whether segment a1a2 crosses segment b1b2.

    Checked against the counting LINE's extent as well as the track's, so a
    vehicle passing the line's extension — on a parallel carriageway beyond the
    end of the line — is not counted. Testing only the track's side of the
    comparison is a common bug that counts the opposite roadway.
    """
    d1 = _side(b1, b2, a1)
    d2 = _side(b1, b2, a2)
    d3 = _side(a1, a2, b1)
    d4 = _side(a1, a2, b2)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


@dataclass
class TrackState:
    """What the counter remembers about one track."""

    coco_id: int
    positions: list[Point] = field(default_factory=list)
    counted: bool = False

    @property
    def mature(self) -> bool:
        return len(self.positions) >= MIN_TRACK_LENGTH


@dataclass(frozen=True)
class Crossing:
    track_id: int
    class_code: str
    #: +1 crossed in the line's positive direction, -1 the other way. Direction
    #: is not decoration: an approach count that mixes both directions is
    #: useless for a signal plan, which times each approach separately.
    direction: int


@dataclass
class LineCounter:
    """Counts tracks crossing one line, once each, with direction.

    `line` is an ordered pair; "positive" is the side the cross-product calls
    positive, which is stable for a given line and is what `direction` reports.
    """

    line: tuple[Point, Point]
    tracks: dict[int, TrackState] = field(default_factory=dict)
    crossings: list[Crossing] = field(default_factory=list)

    def update(self, track_id: int, coco_id: int, position: Point) -> Crossing | None:
        """Feed one track's position for one frame. Returns a crossing if this
        is the frame it crossed, otherwise None."""
        state = self.tracks.get(track_id)
        if state is None:
            state = TrackState(coco_id=coco_id)
            self.tracks[track_id] = state

        state.positions.append(position)
        if state.counted or not state.mature or len(state.positions) < 2:
            return None

        previous = state.positions[-2]
        a, b = self.line
        if not _segments_intersect(previous, position, a, b):
            return None

        class_code = class_for(state.coco_id)
        if class_code is None:
            # Not a countable class. The track is marked counted anyway so it
            # is not re-examined every frame for the rest of its life.
            state.counted = True
            return None

        direction = 1 if _side(a, b, position) > 0 else -1
        crossing = Crossing(track_id=track_id, class_code=class_code, direction=direction)
        state.counted = True
        self.crossings.append(crossing)
        return crossing

    def totals(self) -> dict[str, int]:
        """Vehicles by class, both directions."""
        counts: dict[str, int] = {}
        for crossing in self.crossings:
            counts[crossing.class_code] = counts.get(crossing.class_code, 0) + 1
        return counts

    def totals_by_direction(self) -> dict[int, dict[str, int]]:
        counts: dict[int, dict[str, int]] = {1: {}, -1: {}}
        for crossing in self.crossings:
            bucket = counts[crossing.direction]
            bucket[crossing.class_code] = bucket.get(crossing.class_code, 0) + 1
        return counts

    def pcu(self) -> float:
        """Total PCU. The unit every capacity calculation actually uses."""
        return round(sum(pcu_for(c.class_code) for c in self.crossings), 2)

    def flow_per_hour(self, elapsed_seconds: float) -> float:
        """Vehicles per hour, extrapolated from the observed window.

        Raises on a zero window rather than returning infinity. A flow figure
        divided by no time is the bug that produced 408,000 veh/hr earlier in
        this project's history, and it should stop the process rather than
        reach a screen.
        """
        if elapsed_seconds <= 0:
            raise ValueError("elapsed_seconds must be positive to extrapolate a flow")
        return round(len(self.crossings) * 3600.0 / elapsed_seconds, 1)
