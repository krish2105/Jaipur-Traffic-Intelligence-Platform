"""The class map must stay keyed on the COCO id, and never on the label name.

Why this file exists
--------------------
`scripts/prove_detection.py` once carried its own copy of this map, keyed on the
label *name*, with `"motorcycle"` as the two-wheeler key. RT-DETR's config does
not publish that name. It uses the older VOC-style vocabulary — `motorbike`, and
`pottedplant` for potted plant — so the key silently never matched. Every
two-wheeler in every photograph was detected by the model and then dropped by
the lookup, and the script reported zero of them.

That zero was published as a finding: that off-the-shelf weights cannot see
Indian traffic, and that a fine-tune had to be funded before anything else. It
was a defect in one dictionary. Re-run against the id, two-wheelers are 53% of
detections against a fleet that is about 61% two-wheelers.

Nothing failed loudly. `mypy` is happy with a `dict[str, str]` whose keys match
nothing, `ruff` has no opinion on it, and the counts it produced were plausible
enough to reason about for a long time. The only structural defence is that the
map is keyed on the id, because ids are stable across the naming conventions
these checkpoints ship with and names are not.

So this test asserts the shape, not the contents.
"""

from __future__ import annotations

from pravaah.ganana.classes import COCO_TO_CLASS, PERSON_CLASS_IDS


def test_class_map_is_keyed_on_the_coco_id_not_the_label_name() -> None:
    """A `str` key here is the exact bug described above, so it is a failure."""
    assert COCO_TO_CLASS, "the map must not be empty"
    for key in COCO_TO_CLASS:
        assert isinstance(key, int), (
            f"COCO_TO_CLASS is keyed on {key!r}, a {type(key).__name__}. Keying "
            "on the label name is what made prove_detection.py report zero "
            "two-wheelers: RT-DETR calls that class 'motorbike', not "
            "'motorcycle'. Key on the id."
        )


def test_person_ids_are_never_countable() -> None:
    """The prohibition is structural: a person id must not reach a vehicle class."""
    assert PERSON_CLASS_IDS
    assert not (PERSON_CLASS_IDS & COCO_TO_CLASS.keys()), (
        "a person id resolves to a vehicle class, which CLAUDE.md prohibits"
    )


def test_two_wheeler_id_is_coco_three() -> None:
    """Pinned because it is the class the whole fleet argument rests on.

    COCO id 3 is the two-wheeler in every checkpoint this project uses,
    whichever of the two names that checkpoint gives it.
    """
    assert COCO_TO_CLASS[3] == "2W"
