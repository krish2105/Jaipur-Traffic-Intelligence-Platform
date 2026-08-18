"""Vehicle detection. RT-DETRv2, Apache-2.0.

**Licence first, because it is a procurement blocker.** Ultralytics YOLO is
AGPL-3.0, which for a government deployment means either publishing the whole
service's source or buying a commercial licence — a decision a department
should make deliberately, not inherit from a library choice. RT-DETRv2 is
Apache-2.0 and ByteTrack via `supervision` is MIT, so nothing here constrains
how the department deploys it. CLAUDE.md bars Ultralytics from shippable code
for exactly this reason.

**People are discarded in the same function that produces them.** A COCO
detector can detect a person and there is no way to ask it not to look; what we
control is what happens next. `detect()` filters to countable vehicle classes
before returning, so no person box is ever handed to the tracker, no track is
opened, and no identifier is assigned. A detection discarded where it is made is
not tracking (docs/07, CLAUDE.md).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

import numpy as np

MODEL_ID: Final = "PekingU/rtdetr_v2_r18vd"
MODEL_LICENCE: Final = "Apache-2.0"

#: Below this, a box is noise. 0.5 rather than the usual 0.25: counting errors
#: only ever accumulate upward over a day, so a missed vehicle costs less than
#: a phantom one.
DEFAULT_CONFIDENCE: Final = 0.5


@dataclass(frozen=True)
class Detection:
    """One vehicle in one frame. Never a person — see the module docstring."""

    coco_id: int
    class_code: str
    confidence: float
    #: xyxy in pixels.
    box: tuple[float, float, float, float]

    @property
    def centroid(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.box
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    @property
    def foot_point(self) -> tuple[float, float]:
        """Bottom-centre of the box — where the vehicle meets the road.

        Used for line crossing rather than the centroid. A truck's centroid sits
        two metres above the carriageway and crosses a counting line drawn on
        the road noticeably before the truck does; on a low-mounted camera the
        error is large enough to assign a vehicle to the wrong signal phase.
        """
        x1, _, x2, y2 = self.box
        return ((x1 + x2) / 2, y2)


class VehicleDetector:
    """RT-DETRv2 wrapped to emit only countable vehicles.

    Loaded lazily: importing this module must not pull 20M parameters into
    memory for a process that only wants the counting logic, which is most of
    them — the API and the tests included.
    """

    def __init__(self, confidence: float = DEFAULT_CONFIDENCE) -> None:
        self.confidence = confidence
        self._model: Any = None
        self._processor: Any = None

    def _load(self) -> None:
        if self._model is not None:
            return
        from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

        self._processor = RTDetrImageProcessor.from_pretrained(MODEL_ID)
        self._model = RTDetrV2ForObjectDetection.from_pretrained(MODEL_ID)
        self._model.eval()

    def detect(self, image: Any) -> list[Detection]:
        """Detections for one frame, vehicles only.

        `image` is a PIL image or an HWC uint8 array.
        """
        import torch

        from .classes import class_for

        self._load()
        assert self._processor is not None and self._model is not None

        inputs = self._processor(images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = self._model(**inputs)

        height, width = (image.height, image.width) if hasattr(image, "height") else image.shape[:2]
        results = self._processor.post_process_object_detection(
            outputs,
            target_sizes=torch.tensor([[height, width]]),
            threshold=self.confidence,
        )[0]

        detections: list[Detection] = []
        for score, label, box in zip(
            results["scores"], results["labels"], results["boxes"], strict=True
        ):
            coco_id = int(label)
            # Filtered here, in the function that produced it. Nothing
            # downstream ever sees a person box.
            class_code = class_for(coco_id)
            if class_code is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in box.tolist())
            detections.append(
                Detection(
                    coco_id=coco_id,
                    class_code=class_code,
                    confidence=float(score),
                    box=(x1, y1, x2, y2),
                )
            )
        return detections

    @staticmethod
    def provenance() -> dict[str, str]:
        """What a procurement reviewer asks for."""
        return {
            "model": MODEL_ID,
            "licence": MODEL_LICENCE,
            "tracker": "ByteTrack via supervision (MIT)",
            "no_agpl": "No Ultralytics YOLO anywhere in shippable code",
            "privacy": "Person detections are discarded at the detector; no person is tracked",
        }


def to_supervision(detections: list[Detection]) -> Any:
    """Adapt to a `supervision.Detections` for ByteTrack.

    Kept as an adapter rather than making `Detection` a supervision type: the
    counting logic must stay testable without importing a tracking library.
    """
    import supervision as sv

    if not detections:
        return sv.Detections.empty()
    return sv.Detections(
        xyxy=np.array([d.box for d in detections], dtype=np.float32),
        confidence=np.array([d.confidence for d in detections], dtype=np.float32),
        class_id=np.array([d.coco_id for d in detections], dtype=int),
    )
