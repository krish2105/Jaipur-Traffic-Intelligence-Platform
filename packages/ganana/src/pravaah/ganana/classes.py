"""Detector classes, and the one that is refused.

GANANA counts vehicles. It does **not** detect, track, or count people — CLAUDE.md
and docs/07 prohibit person detection, tracking, gait and biometric analysis
outright, and that prohibition is worth more than a filter somewhere in a
pipeline that a future refactor can drop.

So the refusal is structural. `PERSON_CLASS_IDS` never appears in `COCO_TO_PCU`
or `COCO_TO_CLASS`, `is_countable` returns False for them, and
`assert_no_person_classes` raises rather than quietly dropping. A person that
reaches the counting stage is a bug that stops the process, not a row that is
silently skipped.

The subtlety worth being explicit about: a COCO detector *can* detect people,
and there is no way to ask RT-DETR not to look. What we control is what happens
next — nothing downstream ever receives a person box, no track is opened for
one, and no identifier is assigned. A detection that is discarded in the same
function that produced it is not tracking.
"""

from __future__ import annotations

from typing import Final

#: COCO ids the pipeline must never act on. Kept as a set so membership is the
#: check, and named so its purpose survives someone tidying the file.
PERSON_CLASS_IDS: Final[frozenset[int]] = frozenset({0})

#: COCO id -> PRAVAAH vehicle class. Only vehicles.
#:
#: COCO has no auto-rickshaw, which is the single most consequential gap for an
#: Indian city: autos are 6.2% of measured traffic on this corridor and 1.32% of
#: the registered fleet. An off-the-shelf COCO model reports them as `car` or
#: `motorcycle` depending on the angle, which is why docs/04 requires
#: fine-tuning on Indian data (IDD) before any count is published as an auto.
#: Until that fine-tune exists, `AUTO` is absent here rather than faked from a
#: COCO class, and the counts say so.
COCO_TO_CLASS: Final[dict[int, str]] = {
    1: "NMV",  # bicycle
    2: "CAR",
    3: "2W",  # motorcycle
    5: "BUS",
    7: "TRK2",  # truck
}

#: PCU factors, matching `vehicle_classes.pcu_factor` in the warehouse. A count
#: that is not converted to PCU cannot be compared with a capacity, and every
#: capacity figure in IRC:106 is in PCU.
CLASS_TO_PCU: Final[dict[str, float]] = {
    "2W": 0.25,
    "AUTO": 0.50,
    "ERIK": 0.50,
    "NMV": 0.50,
    "CAR": 1.00,
    "TAXI": 1.00,
    "LCV": 1.50,
    "MBUS": 2.00,
    "BUS": 3.00,
    "TRK2": 3.00,
    "TRAC": 4.00,
    "TRKM": 4.50,
}

#: Classes a COCO-pretrained detector cannot produce, and which therefore must
#: not appear in published counts until a fine-tune exists. Reported alongside
#: every count so the gap is visible rather than inferred from a zero.
UNAVAILABLE_WITHOUT_FINETUNE: Final[tuple[str, ...]] = (
    "AUTO",
    "ERIK",
    "LCV",
    "MBUS",
    "TRAC",
    "TRKM",
)


def is_countable(coco_id: int) -> bool:
    """Whether this detection may proceed to tracking and counting."""
    if coco_id in PERSON_CLASS_IDS:
        return False
    return coco_id in COCO_TO_CLASS


def class_for(coco_id: int) -> str | None:
    """PRAVAAH class for a COCO id, or None if it must not be counted."""
    if coco_id in PERSON_CLASS_IDS:
        return None
    return COCO_TO_CLASS.get(coco_id)


def pcu_for(class_code: str) -> float:
    """PCU factor. Raises on an unknown class rather than defaulting to 1.0.

    Defaulting would let an unrecognised class contribute a car's worth of road
    space to a capacity calculation, which is the kind of silent wrong number
    that survives for years.
    """
    try:
        return CLASS_TO_PCU[class_code]
    except KeyError as exc:
        raise KeyError(f"no PCU factor for class {class_code!r}") from exc


def assert_no_person_classes(coco_ids: object) -> None:
    """Fail loudly if a person id reaches the counting stage.

    Called at the boundary into tracking. Raising rather than filtering is the
    point: a person box arriving here means the detection stage stopped
    discarding them, and that is a prohibition breach to be fixed, not a row to
    drop and carry on.
    """
    for coco_id in coco_ids:  # type: ignore[attr-defined]
        if int(coco_id) in PERSON_CLASS_IDS:
            raise ValueError(
                "person detection reached the counting stage — "
                "GANANA must never track or count people (docs/07, CLAUDE.md)"
            )
