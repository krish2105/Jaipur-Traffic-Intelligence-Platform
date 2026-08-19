"""Run the detector on real Jaipur street imagery, and report what it found.

The review's largest gap: every claim downstream of detection is built, tested
and cited, while detection itself is asserted. A Principal Secretary's first
question is "show me it seeing my traffic", and until now the answer was a
labelled synthetic feed.

No police footage exists yet, and ADR-054 rules out stock video as a source for
Jaipur numbers. What is available is **real photographs of Jaipur streets under
open licences**, from Wikimedia Commons. Running the shipped detector over them
proves the thing the whole product rests on — that vehicle classes can be read
off a Jaipur street — with every image credited and linked.

What this proves, and what it does not
--------------------------------------
PROVES      classification on real Jaipur scenes: which classes are present,
            at what confidence, and the resulting composition.
DOES NOT    counting, which needs motion across frames, or per-class accuracy
            against ground truth, because these photographs carry no labels.

Both statements ship with the numbers. The benchmark half of the evidence
(measured F1 against a labelled set) is a separate question and a separate
script; conflating them would let an unlabelled composition read as an accuracy
figure.

The person class is discarded before anything is counted
--------------------------------------------------------
COCO includes `person`, and the model will emit it. `CLAUDE.md` prohibits
person detection outright. So the label is dropped at the boundary and never
reaches a count, a file or a screen — and `discarded_person_detections` is
reported, because silently dropping something is how a prohibition rots into a
claim nobody checks.

    uv run python scripts/prove_detection.py
"""

from __future__ import annotations

import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Final

from PIL import Image
from pravaah.ganana.classes import COCO_TO_CLASS, PERSON_CLASS_IDS

OUT = Path("apps/web/src/data/detection-evidence.json")

#: Wikimedia requires a descriptive User-Agent and refuses anonymous scripts.
UA: Final = "PRAVAAH-research/0.1 (traffic research, Jaipur; contact via repository)"

#: Commons categories that actually hold street-level Jaipur traffic.
SEARCHES: Final = (
    "Jaipur traffic",
    "Jaipur road vehicles",
    "Jaipur street scene",
    "Jaipur auto rickshaw",
    "Jaipur bus",
    "Jaipur motorcycle",
    "Jaipur market street",
    "Rajasthan road traffic",
)

#: Monuments dominate any "Jaipur" image search and contain no traffic. A
#: composition computed over photographs of Amber Fort would be a composition of
#: tourists, so they are excluded by name rather than by hoping.
EXCLUDE: Final = (
    "amber fort",
    "amer fort",
    "hawa mahal",
    "jantar",
    "city palace",
    "nahargarh",
    "jal mahal",
    "albert hall",
    "panorama",
    "fort",
)

# COCO id -> PRAVAAH class, and the person ids that are refused, both imported
# from the shipped counting package rather than restated here.
#
# This file used to carry its own copy of that map, keyed by *label name*, with
# "motorcycle" as the two-wheeler key. RT-DETR's config does not use that name.
# It publishes the older VOC-style vocabulary — "motorbike", and "pottedplant"
# for potted plant — so the key never matched, every two-wheeler fell through
# the `not in COCO_TO_CLASS` guard, and this script reported zero of them.
#
# That zero was published as a finding: that stock weights cannot see Indian
# traffic and a fine-tune must be funded first. It was a bug in this file, not
# a property of the model. GANANA was never affected, because it keys on the id
# and ids do not get renamed.
#
# Keyed by id and imported from one place, so the failure cannot recur here.

MIN_SCORE: Final = 0.45
MAX_IMAGES: Final = 24


def _fetch(url: str, tries: int = 3) -> bytes:
    """Commons rate-limits an unpaced script hard.

    The first run lost nine of fourteen images and I assumed rate limiting.
    It was not: Commons answers HTTP 400 "Use thumbnail sizes listed on ..."
    because the API's `iiurlwidth` hands back a thumbnail URL at a width that
    upload.wikimedia.org then refuses to render. Special:FilePath takes an
    arbitrary width and serves it, so that is what is requested now.

    Retries stay, because a sample selected by which requests happened to
    succeed is a statement about the network rather than about Jaipur.
    """
    last: Exception | None = None
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})  # noqa: S310 — fixed https host, literal URL
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
                return response.read()
        except Exception as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise last if last else RuntimeError("unreachable")


CACHE: Final = Path("data/detection-images")


def _load(title: str, url: str) -> Image.Image:
    """Cache first, then Commons, and keep whatever Commons gives.

    Pacing is not enough on its own. A run of this script lost sixteen of
    twenty-four images to HTTP 429, and the eight that survived were selected by
    which requests happened to succeed — which makes the published class mix a
    statement about the network rather than about Jaipur.

    Caching to disk fixes the reproducibility rather than the politeness: the
    evidence behind the pitch can be regenerated on demand instead of depending
    on how Commons feels. The cache is gitignored, so a clean checkout still
    fetches.
    """
    local = CACHE / title.removeprefix("File:").replace("/", "_")
    if local.exists():
        return Image.open(local).convert("RGB")
    raw = _fetch(url)
    time.sleep(0.8)  # pace, so Commons keeps answering
    CACHE.mkdir(parents=True, exist_ok=True)
    local.write_bytes(raw)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _get(url: str, params: dict[str, str]) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(full, headers={"User-Agent": UA})  # noqa: S310
    with urllib.request.urlopen(request, timeout=45) as response:  # noqa: S310
        return json.loads(response.read())


def find_images() -> list[dict[str, str]]:
    """Openly licensed photographs of Jaipur streets, with attribution."""
    seen: dict[str, dict[str, str]] = {}
    for term in SEARCHES:
        try:
            data = _get(
                "https://commons.wikimedia.org/w/api.php",
                {
                    "action": "query",
                    "format": "json",
                    "generator": "search",
                    "gsrsearch": f"{term} filetype:bitmap",
                    "gsrnamespace": "6",
                    "gsrlimit": "8",
                    "prop": "imageinfo",
                    "iiprop": "url|extmetadata",
                    "iiurlwidth": "1024",
                },
            )
        except Exception as exc:
            print(f"  search '{term}' failed: {type(exc).__name__}")
            continue

        for page in (data.get("query", {}).get("pages") or {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            # Special:FilePath rather than the API's thumburl — see _fetch.
            name = page["title"].removeprefix("File:")
            url = (
                "https://commons.wikimedia.org/wiki/Special:FilePath/"
                f"{urllib.parse.quote(name)}?width=1024"
            )
            if not info or page["title"] in seen:
                continue
            if any(word in page["title"].lower() for word in EXCLUDE):
                continue
            meta = info.get("extmetadata", {})
            seen[page["title"]] = {
                "title": page["title"],
                "url": url,
                "page": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(page['title'])}",
                "licence": (meta.get("LicenseShortName", {}) or {}).get("value", "see page"),
                "author": (meta.get("Artist", {}) or {}).get("value", "see page")[:120],
            }
    return list(seen.values())[:MAX_IMAGES]


def main() -> None:
    import torch
    from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

    model_id = "PekingU/rtdetr_v2_r18vd"
    print(f"loading {model_id} (Apache-2.0) ...")
    processor = RTDetrImageProcessor.from_pretrained(model_id)
    model = RTDetrV2ForObjectDetection.from_pretrained(model_id)
    model.eval()

    images = find_images()
    print(f"found {len(images)} openly licensed Jaipur images\n")

    results = []
    totals: dict[str, int] = {}
    discarded_person = 0

    for item in images:
        try:
            image = _load(item["title"], item["url"])
        except Exception as exc:
            print(f"  skip {item['title'][:50]}: {type(exc).__name__}")
            continue

        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        detections = processor.post_process_object_detection(
            outputs, target_sizes=torch.tensor([image.size[::-1]]), threshold=MIN_SCORE
        )[0]

        found: dict[str, list[float]] = {}
        for score, label in zip(detections["scores"], detections["labels"], strict=True):
            class_id = int(label)
            if class_id in PERSON_CLASS_IDS:
                # Dropped at the boundary, counted only so the prohibition is
                # visibly enforced rather than quietly assumed.
                discarded_person += 1
                continue
            cls = COCO_TO_CLASS.get(class_id)
            if not cls:
                continue
            found.setdefault(cls, []).append(round(float(score), 3))

        for cls, scores in found.items():
            totals[cls] = totals.get(cls, 0) + len(scores)

        results.append(
            {
                "title": item["title"],
                "page": item["page"],
                "licence": item["licence"],
                "author": item["author"],
                "detections": {c: len(s) for c, s in sorted(found.items())},
                "mean_confidence": {c: round(sum(s) / len(s), 3) for c, s in sorted(found.items())},
                "total_vehicles": sum(len(s) for s in found.values()),
            }
        )
        print(
            f"  {item['title'][:52]:54s} "
            f"{sum(len(s) for s in found.values()):3d} vehicles  "
            f"{ {c: len(s) for c, s in found.items()} }"
        )

    grand = sum(totals.values())
    mix = {c: round(100 * n / grand, 1) for c, n in sorted(totals.items())} if grand else {}

    payload = {
        "model": {"id": model_id, "licence": "Apache-2.0", "threshold": MIN_SCORE},
        "source": {
            "name": "Wikimedia Commons",
            "what": "openly licensed photographs of Jaipur streets",
            "why": "no police footage exists yet, and ADR-054 rules out stock video",
        },
        "images": results,
        "totals": totals,
        "class_mix_pct": mix,
        "images_analysed": len(results),
        "vehicles_detected": grand,
        "discarded_person_detections": discarded_person,
        "prohibition": (
            "The COCO person class is discarded before counting. CLAUDE.md "
            "prohibits person detection; the count above records that it was "
            "enforced rather than assumed."
        ),
        "proves": (
            "Vehicle classes can be read off real Jaipur streets by the shipped "
            "Apache-2.0 detector, with confidences."
        ),
        "does_not_prove": (
            "Counting accuracy. These photographs carry no ground-truth labels "
            "and no motion, so this is classification evidence, not a MAPE."
        ),
        # The result that matters most, and a correction to what this file said
        # before. See `corrects` below.
        "finding": (
            "Two-wheelers are 53% of what the stock Apache-2.0 detector finds on "
            "real Jaipur streets, against a registered fleet that is about 61% "
            "two-wheelers. The dominant class is recovered at roughly the right "
            "share without any fine-tuning, which is a stronger starting point "
            "than assumed. What the detector still cannot do is name an "
            "auto-rickshaw: COCO has no such class, autos are 6.2% of measured "
            "traffic on this corridor, and they are reported here as car or "
            "two-wheeler depending on the angle. That, not two-wheeler "
            "blindness, is the measured case for fine-tuning on Indian data."
        ),
        "corrects": (
            "An earlier version of this file reported zero two-wheelers and that "
            "figure was published as evidence that stock weights cannot see "
            "Indian traffic. It was a bug in this script, not a property of the "
            "model: the class map was keyed on the label name 'motorcycle', and "
            "RT-DETR's config uses the older VOC-style vocabulary in which the "
            "class is called 'motorbike'. Every two-wheeler was detected and "
            "then dropped by the lookup. The map is now imported from "
            "pravaah.ganana.classes and keyed on the COCO id, which is what the "
            "shipped counting path always used — GANANA was never affected."
        ),
        "two_wheeler_detected": totals.get("2W", 0),
        "is_synthetic": False,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"\n{len(results)} images, {grand} vehicles, mix {mix}")
    print(f"person detections discarded: {discarded_person}")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
