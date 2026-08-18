"""Network construction, and the two properties that make it a corridor."""

from pravaah.setu.network import VEHICLE_TYPES, Link, build_plain_xml, node_id


def _link(lid: int, shape: list[tuple[float, float]], lanes: int = 2) -> Link:
    return Link(link_id=lid, name=f"l{lid}", lanes=lanes, speed_kmh=50, shape=shape)


def test_coincident_endpoints_become_one_node() -> None:
    # Without this the network is a set of disconnected stubs and vehicles
    # vanish at every link boundary.
    a = _link(1, [(75.80, 26.88), (75.81, 26.87)])
    b = _link(2, [(75.81, 26.87), (75.82, 26.86)])
    nodes, _, _ = build_plain_xml([a, b])
    assert nodes.count("<node ") == 3  # not 4


def test_endpoints_agreeing_to_a_centimetre_still_snap() -> None:
    # PostGIS endpoints agree to about a centimetre, not exactly. Requiring
    # exact float equality would leave the corridor in pieces.
    a = _link(1, [(75.80, 26.88), (75.8100000, 26.8700000)])
    b = _link(2, [(75.8100001, 26.8700001), (75.82, 26.86)])
    assert node_id(75.8100000, 26.8700000) == node_id(75.8100001, 26.8700001)
    nodes, _, _ = build_plain_xml([a, b])
    assert nodes.count("<node ") == 3


def test_interior_geometry_survives_so_a_flyover_curves() -> None:
    # Without the shape attribute every link is a straight line and the turning
    # movements at its ends are wrong.
    curved = _link(1, [(75.80, 26.88), (75.805, 26.876), (75.81, 26.87)])
    _, edges, _ = build_plain_xml([curved])
    assert 'shape="' in edges


def test_a_degenerate_link_is_skipped_not_collapsed() -> None:
    # A link whose ends coincide cannot be an edge. Emitting it would create a
    # self-loop that netconvert rejects, taking the whole network with it.
    _, edges, _ = build_plain_xml([_link(1, [(75.80, 26.88), (75.80, 26.88)])])
    assert "<edge " not in edges


def test_two_wheelers_are_motorcycles_and_can_filter() -> None:
    # A 61%-two-wheeler fleet simulated as cars queues one per lane and the
    # queue lengths come out roughly double.
    _, _, types = build_plain_xml([_link(1, [(75.80, 26.88), (75.81, 26.87)])])
    assert 'vClass="motorcycle"' in types
    assert 'latAlignment="arbitrary"' in types


def test_pcu_factors_match_the_warehouse() -> None:
    by_id = {vt.id: vt.pcu for vt in VEHICLE_TYPES}
    assert by_id["2W"] == 0.25
    assert by_id["CAR"] == 1.00
    assert by_id["BUS"] == 3.00
