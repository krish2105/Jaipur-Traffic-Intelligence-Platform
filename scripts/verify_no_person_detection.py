"""Prove, on real model output, that GANANA never returns a person.

    uv run python scripts/verify_no_person_detection.py

CLAUDE.md and docs/07 prohibit person detection and tracking outright. A unit
test with fabricated class ids shows the filter is wired; it does not show that
the filter holds against what the model actually emits on a real photograph.
This runs RT-DETRv2 over public COCO validation images, counts the people the
model finds, and asserts that our detector returned none of them.

It is a gate, not a demo: a non-zero person count exits non-zero.

Images are fetched from the public COCO validation set and cached in the
scratch directory. If the network is unavailable the script skips rather than
fails — an unreachable CDN is not a prohibition breach.
"""

from __future__ import annotations

import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

# Images chosen because they contain people. The point is to give the filter
# something real to refuse.
IMAGE_IDS = (
    "000000001000",
    "000000002153",
    "000000007816",
    "000000018380",
    "000000049759",
)
BASE = "http://images.cocodataset.org/val2017"

GREEN, RED, DIM, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def fetch(cache: Path, image_id: str) -> Path | None:
    path = cache / f"{image_id}.jpg"
    if path.exists() and path.stat().st_size > 1000:
        return path
    url = f"{BASE}/{image_id}.jpg"
    # BASE is a fixed https-free constant in this file and `image_id` comes from
    # the tuple above, so no caller-supplied scheme can reach here. Asserted
    # rather than assumed, because S310 is right that this is worth checking.
    if not url.startswith("http://images.cocodataset.org/"):
        return None
    try:
        with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310
            data = response.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    if not data.startswith(b"\xff\xd8"):  # not a JPEG
        return None
    path.write_bytes(data)
    return path


def main() -> int:
    import torch
    from PIL import Image
    from pravaah.ganana.classes import PERSON_CLASS_IDS
    from pravaah.ganana.detect import MODEL_ID, VehicleDetector
    from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

    cache = Path(tempfile.gettempdir()) / "pravaah-coco"
    cache.mkdir(exist_ok=True)

    paths = [p for i in IMAGE_IDS if (p := fetch(cache, i)) is not None]
    if not paths:
        print(f"{DIM}network unavailable — skipped{RESET}")
        return 0

    processor = RTDetrImageProcessor.from_pretrained(MODEL_ID)
    model = RTDetrV2ForObjectDetection.from_pretrained(MODEL_ID)
    model.eval()
    detector = VehicleDetector(confidence=0.5)

    persons_seen = 0
    persons_returned = 0
    vehicles_returned = 0

    print(f"\n  {'image':<18}{'model finds':>12}{'of those people':>17}{'we return':>11}")
    for path in paths:
        image = Image.open(path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        result = processor.post_process_object_detection(
            outputs,
            target_sizes=torch.tensor([[image.height, image.width]]),
            threshold=0.5,
        )[0]
        labels = [int(x) for x in result["labels"]]
        people = sum(1 for x in labels if x in PERSON_CLASS_IDS)

        ours = detector.detect(image)
        returned_people = sum(1 for d in ours if d.coco_id in PERSON_CLASS_IDS)

        persons_seen += people
        persons_returned += returned_people
        vehicles_returned += len(ours)
        print(f"  {path.stem:<18}{len(labels):>12}{people:>17}{len(ours):>11}")

    print()
    ok = persons_returned == 0 and persons_seen > 0
    if persons_seen == 0:
        print(f"  {DIM}no people in the sample — the test proved nothing{RESET}")
        return 1
    mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(
        f"  {mark}  the model found {persons_seen} people; GANANA returned "
        f"{persons_returned} of them"
    )
    print(f"  {DIM}{vehicles_returned} vehicles counted from the same frames{RESET}\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
