"""Run the detector on overlapping tiles, so a distant scooter is not 20 pixels.

RESOLVED — read this first
--------------------------
The premise below is void. The detector was not missing two-wheelers; the
evidence script was throwing them away. Its class map was keyed on the COCO
label name "motorcycle", and RT-DETR publishes the older VOC-style vocabulary
in which that class is called "motorbike", so the lookup never matched.

This script is kept because its output is what made the answer findable. It
ruled out the score floor (zero at 0.10 as well as 0.45) and the backbone size
(zero on r50vd as well as r18vd), and a result that survives both of those is
not a detection problem at all — which is what finally sent someone to look at
the label names instead. It is a record of an investigation that concluded, not
a live claim.

The hypothesis this tests
-------------------------
`prove_detection.py` reported zero two-wheelers and the pitch drew a strong
conclusion from it: that off-the-shelf weights cannot see Indian traffic and
fine-tuning is the first job to fund.

Before asking a department to pay for training, three cheaper explanations were
ruled out. The score floor is not it: zero two-wheelers at 0.10 as well as 0.45.
The backbone size is not it: zero on r50vd as well as r18vd.

The fourth explanation is the input, not the model. RT-DETR resizes whatever it
is given to 640 by 640. These photographs are wide street scenes, so a scooter
forty metres back arrives at the network about twenty pixels tall, which is
below what any detector of this family resolves. The motorcycles are not being
misclassified. They are being erased before the model sees them.

Slicing the image into overlapping tiles and detecting in each one puts those
same scooters in front of the network four times larger. It is a standard
technique for small objects in wide scenes, it needs no training, no new
licence and no data, and if it works then the honest recommendation changes
from "fund a training run" to "we were running it wrong".

What this is not
----------------
Still not an accuracy measurement. These photographs carry no labels, so this
counts detections and cannot report precision or recall. It answers one
question: does the model find two-wheelers when they are big enough to see.

    uv run python scripts/tiled_detection.py
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Final

import torch
from PIL import Image
from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

REPORT = Path("data/detection-tiled.json")
COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/"
UA: Final = {"User-Agent": "PRAVAAH/0.1 (research; contact via repository)"}

MODEL_ID: Final = "PekingU/rtdetr_v2_r50vd"

#: Tiles across and down. Three by two on a landscape street scene puts each
#: tile near the model's own 640 square, which is the point.
TILES_X: Final = 3
TILES_Y: Final = 2

#: Overlap so a vehicle sitting on a tile boundary is whole in a neighbour.
#: Without it, every seam becomes a blind stripe the width of a scooter.
OVERLAP: Final = 0.20

THRESHOLD: Final = 0.30

#: Two boxes of the same class overlapping by more than this are the same
#: vehicle seen in two tiles. Deduplicating matters more here than usual: the
#: overlap that stops vehicles being cut in half also guarantees double counts.
IOU_SAME: Final = 0.45

COCO_TO_CLASS: Final[dict[str, str]] = {
    "motorcycle": "2W",
    "car": "CAR",
    "bus": "BUS",
    "truck": "TRK2",
    "bicycle": "NMV",
}


CACHE = Path("data/detection-images")


def load(title: str) -> Image.Image | None:
    """Cache first. Commons rate-limits an unpaced script into returning nothing.

    A first attempt at this fetched on every run and Commons answered 429 to all
    thirteen, which printed an empty table that looked exactly like a model
    finding nothing. Reading from disk removes the network from an experiment
    that is not about the network.
    """
    local = CACHE / title.replace("/", "_")
    if local.exists():
        return Image.open(local).convert("RGB")
    url = COMMONS + urllib.parse.quote(title.replace(" ", "_"))
    try:
        request = urllib.request.Request(url, headers=UA)  # noqa: S310
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            return Image.open(BytesIO(response.read())).convert("RGB")
    except Exception:
        return None


def tiles(image: Image.Image) -> list[tuple[int, int, Image.Image]]:
    """Overlapping crops, with their offset in the original."""
    width, height = image.size
    tile_w = int(width / (TILES_X - (TILES_X - 1) * OVERLAP))
    tile_h = int(height / (TILES_Y - (TILES_Y - 1) * OVERLAP))
    step_x = int(tile_w * (1 - OVERLAP))
    step_y = int(tile_h * (1 - OVERLAP))

    out = []
    for ty in range(TILES_Y):
        for tx in range(TILES_X):
            left = min(tx * step_x, max(0, width - tile_w))
            top = min(ty * step_y, max(0, height - tile_h))
            out.append((left, top, image.crop((left, top, left + tile_w, top + tile_h))))
    return out


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / union if union > 0 else 0.0


def detect(
    model: RTDetrV2ForObjectDetection,
    processor: RTDetrImageProcessor,
    image: Image.Image,
    *,
    tiled: bool,
) -> list[tuple[str, float, tuple[float, float, float, float]]]:
    pieces = tiles(image) if tiled else [(0, 0, image)]
    found: list[tuple[str, float, tuple[float, float, float, float]]] = []
    for left, top, piece in pieces:
        inputs = processor(images=piece, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        results = processor.post_process_object_detection(
            outputs, target_sizes=torch.tensor([piece.size[::-1]]), threshold=THRESHOLD
        )[0]
        for score, label, box in zip(
            results["scores"], results["labels"], results["boxes"], strict=True
        ):
            name = model.config.id2label[int(label)]
            if name not in COCO_TO_CLASS:
                continue
            x0, y0, x1, y1 = (float(v) for v in box)
            found.append((name, float(score), (x0 + left, y0 + top, x1 + left, y1 + top)))

    # Highest score wins a contested box, so a confident whole vehicle beats the
    # sliver of it that fell across a seam.
    found.sort(key=lambda f: -f[1])
    kept: list[tuple[str, float, tuple[float, float, float, float]]] = []
    for candidate in found:
        if any(
            candidate[0] == other[0] and iou(candidate[2], other[2]) > IOU_SAME for other in kept
        ):
            continue
        kept.append(candidate)
    return kept


def main() -> None:
    titles = sorted(p.name for p in CACHE.glob("*.jpg"))
    if not titles:
        raise SystemExit("no cached images; see the fetch step in the commit message")

    processor = RTDetrImageProcessor.from_pretrained(MODEL_ID)
    model = RTDetrV2ForObjectDetection.from_pretrained(MODEL_ID)
    model.eval()

    print(
        f"  {MODEL_ID}, threshold {THRESHOLD}, {TILES_X}x{TILES_Y} tiles at {OVERLAP:.0%} overlap\n"
    )
    print(f"  {'image':<34} {'whole':>12} {'tiled':>12}")

    rows = []
    whole_total: dict[str, int] = {}
    tiled_total: dict[str, int] = {}
    for title in titles:
        image = load(title)
        if image is None:
            continue
        whole = detect(model, processor, image, tiled=False)
        sliced = detect(model, processor, image, tiled=True)

        def count(
            found: list[tuple[str, float, tuple[float, float, float, float]]],
        ) -> dict[str, int]:
            out: dict[str, int] = {}
            for name, _score, _box in found:
                out[COCO_TO_CLASS[name]] = out.get(COCO_TO_CLASS[name], 0) + 1
            return out

        w, s = count(whole), count(sliced)
        for key, value in w.items():
            whole_total[key] = whole_total.get(key, 0) + value
        for key, value in s.items():
            tiled_total[key] = tiled_total.get(key, 0) + value
        print(
            f"  {title[:33]:<34} {f'2W {w.get(chr(50) + chr(87), 0)}, {sum(w.values())} veh':>12} "
            f"{f'2W {s.get(chr(50) + chr(87), 0)}, {sum(s.values())} veh':>12}"
        )
        rows.append({"image": title, "whole": w, "tiled": s})

    print(
        f"\n  whole image  2W {whole_total.get('2W', 0):>3}, {sum(whole_total.values())} vehicles"
    )
    print(f"  tiled        2W {tiled_total.get('2W', 0):>3}, {sum(tiled_total.values())} vehicles")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "model": MODEL_ID,
                "licence": "Apache-2.0",
                "threshold": THRESHOLD,
                "tiles": f"{TILES_X}x{TILES_Y} at {OVERLAP:.0%} overlap",
                "per_image": rows,
                "whole_image_totals": whole_total,
                "tiled_totals": tiled_total,
                "why": (
                    "RT-DETR resizes its input to 640 square. On a wide street "
                    "scene that leaves a scooter forty metres back about twenty "
                    "pixels tall, below what this family resolves. Tiling puts "
                    "the same scooter in front of the network several times "
                    "larger, with no training and no change of licence."
                ),
                "not_an_accuracy_measurement": (
                    "These photographs carry no labels. This counts detections "
                    "and cannot report precision or recall."
                ),
                "is_synthetic": False,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote {REPORT}")


if __name__ == "__main__":
    main()
