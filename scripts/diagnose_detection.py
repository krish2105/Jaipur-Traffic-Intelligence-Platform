"""Why the detector found no two-wheelers, before anyone pays to retrain one.

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

The claim on record
-------------------
`prove_detection.py` ran a stock Apache-2.0 detector over openly licensed
photographs of Jaipur traffic and reported zero two-wheelers in a city whose
fleet is 61% two-wheelers. That went into the pitch as evidence that off-the-
shelf weights cannot see Indian traffic and that fine-tuning is the first job.

It might be true. It might also be two much cheaper things, and it would be
embarrassing to ask a department to fund training that a config change fixes:

  * **the score floor.** 0.45 is a reasonable default for a photo-tagging demo
    and a high bar for a small, half-occluded object in a dense stream.
  * **the model size.** The weights in use are `rtdetr_v2_r18vd`, the smallest
    variant in the family. A ResNet-18 backbone is exactly the wrong end of the
    range for small objects, and a scooter forty metres away is a small object.

This script separates those three explanations. It sweeps the threshold on the
model already in use, and runs the larger backbone at the same thresholds on
the same photographs, and prints what each finds.

It deliberately does not decide anything. It produces the numbers that let
someone decide, which is the difference between an experiment and a
justification.

    uv run python scripts/diagnose_detection.py
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Final

import torch
from PIL import Image
from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

REPORT = Path("data/detection-diagnosis.json")

#: The same images the original run used, so the comparison is like for like.
EVIDENCE = Path("apps/web/src/data/detection-evidence.json")

COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/"

#: Small enough to run on a laptop, wide enough to show where the answers change.
THRESHOLDS: Final = (0.10, 0.20, 0.30, 0.45)

#: The one in use, and the next size up. Both Apache-2.0, so both remain
#: shippable under the licence rule in CLAUDE.md.
MODELS: Final = ("PekingU/rtdetr_v2_r18vd", "PekingU/rtdetr_v2_r50vd")

UA: Final = {"User-Agent": "PRAVAAH/0.1 (research; contact via repository)"}


def image_titles() -> list[str]:
    if not EVIDENCE.exists():
        sys.exit("no detection-evidence.json; run scripts/prove_detection.py first")
    data = json.loads(EVIDENCE.read_text())
    titles = []
    for entry in data.get("images") or []:
        title = entry.get("title") if isinstance(entry, dict) else str(entry)
        if not title:
            continue
        # Ministerial press photographs are in the set and contain no traffic.
        # Keeping them would dilute the very thing being measured.
        if "Minister" in title or "Oscar Fernandes" in title:
            continue
        titles.append(title.removeprefix("File:"))
    return titles


def load(title: str) -> Image.Image | None:
    url = COMMONS + urllib.parse.quote(title.replace(" ", "_"))
    try:
        request = urllib.request.Request(url, headers=UA)  # noqa: S310
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            return Image.open(BytesIO(response.read())).convert("RGB")
    except Exception:
        return None


def main() -> None:
    titles = image_titles()
    print(f"  {len(titles)} traffic photographs, press photos excluded\n")

    images = []
    for title in titles:
        image = load(title)
        if image is not None:
            images.append((title, image))
    if not images:
        sys.exit("could not fetch any images")
    print(f"  fetched {len(images)}\n")

    rows: list[dict[str, object]] = []
    print(f"  {'model':<26} {'thresh':>7} {'2W':>5} {'car':>5} {'bus':>5} {'truck':>6}")
    for model_id in MODELS:
        processor = RTDetrImageProcessor.from_pretrained(model_id)
        model = RTDetrV2ForObjectDetection.from_pretrained(model_id)
        model.eval()

        for threshold in THRESHOLDS:
            counts = {"motorcycle": 0, "car": 0, "bus": 0, "truck": 0}
            for _title, image in images:
                inputs = processor(images=image, return_tensors="pt")
                with torch.no_grad():
                    outputs = model(**inputs)
                results = processor.post_process_object_detection(
                    outputs,
                    target_sizes=torch.tensor([image.size[::-1]]),
                    threshold=threshold,
                )[0]
                for label in results["labels"]:
                    name = model.config.id2label[int(label)]
                    if name in counts:
                        counts[name] += 1
            short = model_id.split("/")[-1]
            print(
                f"  {short:<26} {threshold:>7.2f} {counts['motorcycle']:>5} "
                f"{counts['car']:>5} {counts['bus']:>5} {counts['truck']:>6}"
            )
            rows.append({"model": model_id, "threshold": threshold, "counts": dict(counts)})

    best = max(rows, key=lambda r: r["counts"]["motorcycle"])  # type: ignore[index]
    print(
        f"\n  most two-wheelers: {best['counts']['motorcycle']} "  # type: ignore[index]
        f"at threshold {best['threshold']} on {str(best['model']).split('/')[-1]}"
    )

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "question": (
                    "Does the stock detector miss Indian two-wheelers because the "
                    "weights are wrong, because the score floor is too high, or "
                    "because the backbone is too small?"
                ),
                "images": len(images),
                "image_titles": [t for t, _ in images],
                "excluded": "ministerial press photographs, which contain no traffic",
                "runs": rows,
                "best_for_two_wheelers": best,
                "note": (
                    "Counts are detections, not accuracy. These photographs carry "
                    "no labels, so nothing here is precision or recall. It "
                    "separates three explanations and no more."
                ),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  wrote {REPORT}")


if __name__ == "__main__":
    main()
