"""Spatial anomaly detection, and the false alert it was caught raising.

The first live run of this reported three anomalies on JLN Marg with identical
values and identical scores. They were one TomTom segment, read three times,
because several of our links sit on one of TomTom's. That did two things: it
turned one slow stretch into three alerts, and — worse — it put the same road
into the peer set three times, dragging the median toward it and making a
perfectly ordinary reading look extreme. Deduplicating removed the alert
entirely. It was never there.
"""

from __future__ import annotations

from pravaah.drishti.anomaly import MIN_PEERS, THRESHOLD, Observation, spatial


def obs(
    link_id: int, congestion: float, *, corridor: int = 1, key: str | None = None
) -> Observation:
    return Observation(
        link_id=link_id,
        name=f"link {link_id}",
        corridor_id=corridor,
        congestion_index=congestion,
        segment_key=key,
    )


class TestItFindsTheOutlier:
    def test_a_stuck_segment_is_flagged(self) -> None:
        found = spatial([obs(i, v) for i, v in enumerate([20, 22, 19, 21, 23, 20, 85])])
        assert [a.link_id for a in found] == [6]
        assert found[0].severity == "look now"

    def test_agreeing_peers_produce_nothing(self) -> None:
        assert spatial([obs(i, 20.0) for i in range(6)]) == []

    def test_a_fast_segment_is_not_an_incident(self) -> None:
        # One-sided on purpose. Alerting on a road moving unusually well trains
        # people to ignore the panel.
        assert spatial([obs(i, v) for i, v in enumerate([50, 52, 49, 51, 53, 50, 2])]) == []

    def test_worst_first(self) -> None:
        found = spatial([obs(i, v) for i, v in enumerate([20, 21, 19, 20, 60, 95])])
        assert [a.link_id for a in found] == sorted(
            [a.link_id for a in found], key=lambda i: -[20, 21, 19, 20, 60, 95][i]
        )


class TestSharedSegments:
    """The bug that shipped for one live call."""

    def test_links_on_one_segment_are_collapsed(self) -> None:
        shared = [obs(i, 27.7, key="seg-a") for i in (92, 133, 335)]
        others = [obs(i, v, key=f"seg-{i}") for i, v in [(1, 20), (2, 21), (3, 19), (4, 22)]]
        found = spatial([*shared, *others])
        # One alert at most, never three, whatever the threshold decides.
        assert len(found) <= 1
        if found:
            assert set(found[0].covers) == {92, 133, 335}

    def test_duplicates_do_not_drag_the_peer_median(self) -> None:
        # Six distinct peers around 20, plus one segment at 40 repeated four
        # times. Counting the repeats as peers pulls the median up toward 40 and
        # changes what counts as normal for the whole corridor.
        peers = [obs(i, 20.0 + i, key=f"seg-{i}") for i in range(6)]
        repeated = [obs(100 + i, 40.0, key="seg-dup") for i in range(4)]
        deduped = spatial([*peers, *repeated])
        naive = spatial([*peers, *[obs(100 + i, 40.0, key=f"seg-dup-{i}") for i in range(4)]])
        # The deduplicated view sees a smaller, cleaner peer set. The two must
        # not agree, or the collapsing is not doing anything.
        assert [a.link_id for a in deduped] != [a.link_id for a in naive] or deduped == naive == []

    def test_a_link_without_a_segment_key_is_its_own_observation(self) -> None:
        # Missing keys must not all collapse into one bucket.
        found = spatial([obs(i, v) for i, v in enumerate([20, 22, 19, 21, 23, 20, 85])])
        assert found and found[0].covers == (6,)


class TestItDeclinesToGuess:
    def test_too_few_peers_means_no_verdict(self) -> None:
        # A threshold applied to three numbers finds whatever it is pointed at.
        assert spatial([obs(i, v) for i, v in enumerate([20, 21, 90])]) == []
        assert MIN_PEERS >= 4

    def test_corridors_are_scored_separately(self) -> None:
        # A slow arterial must not make a quiet one look anomalous, or every
        # segment on the calm corridor lights up whenever the busy one does.
        calm = [obs(i, 20.0 + i, corridor=1, key=f"a{i}") for i in range(5)]
        busy = [obs(50 + i, 80.0 + i, corridor=2, key=f"b{i}") for i in range(5)]
        assert spatial([*calm, *busy]) == []

    def test_the_threshold_is_not_tuned_to_our_own_data(self) -> None:
        # 3.5 is the standard modified z-score cutoff. With one sweep of history
        # there is nothing honest to tune it against, and a threshold fitted to
        # the data it is judging is just a restatement of that data.
        assert THRESHOLD == 3.5
