import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps
from paddleocr import PaddleOCR


def normalize_token(text: str) -> str:
    token = (text or "").upper().strip()
    token = token.replace(" ", "")
    token = token.replace(";", ":").replace(",", ":").replace("_", ":").replace("-", ":").replace("=", ":")
    token = token.replace("O", "0")
    return token


def token_center_y(box) -> float:
    if not box:
        return 0.0
    return sum(point[1] for point in box) / len(box)


def make_variants(image: Image.Image):
    width, height = image.size
    lower_start = max(0, int(height * 0.42))
    lower = image.crop((0, lower_start, width, height))

    grayscale = ImageOps.grayscale(image)
    lower_grayscale = ImageOps.grayscale(lower)

    return [
        (
            "full_thresh_x4",
            ImageOps.autocontrast(ImageEnhance.Contrast(grayscale).enhance(2.4))
            .point(lambda value: 255 if value > 168 else 0)
            .resize((width * 4, height * 4), Image.Resampling.NEAREST),
        ),
        (
            "lower_thresh_x4",
            ImageOps.autocontrast(ImageEnhance.Contrast(lower_grayscale).enhance(2.6))
            .point(lambda value: 255 if value > 165 else 0)
            .resize((max(1, lower.width * 4), max(1, lower.height * 4)), Image.Resampling.NEAREST),
        ),
    ]


def parse_variant_result(texts, boxes, variant_name):
    mesa_candidates = []
    chair_candidates = []

    sorted_items = sorted(zip(texts, boxes), key=lambda item: (token_center_y(item[1]), item[1][0][0] if item[1] else 0))
    joined = " ".join(normalize_token(text) for text, _ in sorted_items if text)

    mesa_matches = list(re.finditer(r"M[:]?(\d{1,3})", joined))
    chair_matches = list(re.finditer(r"S[:]?(\d{1,2})", joined))

    for match in mesa_matches:
        mesa_value = int(match.group(1))
        if mesa_value > 0:
            mesa_candidates.append({"value": mesa_value, "source": variant_name, "weight": 14})

    for match in chair_matches:
        chair_value = int(match.group(1))
        if chair_value > 0:
            chair_candidates.append({"value": chair_value, "source": variant_name, "weight": 16})

    for raw_text, box in sorted_items:
        token = normalize_token(raw_text)
        center_y = token_center_y(box)

        mesa_match = re.search(r"M[:]?(\d{1,3})", token)
        if mesa_match:
            mesa_value = int(mesa_match.group(1))
            if mesa_value > 0:
                mesa_candidates.append({"value": mesa_value, "source": variant_name, "weight": 20})

        chair_match = re.search(r"S[:]?(\d{1,2})", token)
        if chair_match:
            chair_value = int(chair_match.group(1))
            if chair_value > 0:
                chair_candidates.append({"value": chair_value, "source": variant_name, "weight": 22})
                continue

        if variant_name.startswith("lower_"):
            if "M" in token:
                continue

            loose_chair_match = re.fullmatch(r"[:]?(\d{1,2})", token)
            if loose_chair_match:
                chair_value = int(loose_chair_match.group(1))
                if chair_value > 0:
                    chair_candidates.append({"value": chair_value, "source": variant_name, "weight": 9})
        elif center_y > 0:
            if "M" in token or "S" in token:
                continue

            loose_match = re.search(r"(\d{1,3})", token)
            if loose_match:
                numeric_value = int(loose_match.group(1))
                if center_y < 120 and numeric_value > 0:
                    mesa_candidates.append({"value": numeric_value, "source": variant_name, "weight": 4})
                elif center_y >= 120 and numeric_value > 0:
                    chair_candidates.append({"value": numeric_value, "source": variant_name, "weight": 3})

    return mesa_candidates, chair_candidates


def choose_best_candidate(candidates, minimum_value, maximum_value):
    score_by_value = {}

    for candidate in candidates:
        value = candidate["value"]
        if value < minimum_value or value > maximum_value:
            continue
        score_by_value[value] = score_by_value.get(value, 0) + candidate["weight"]

    if not score_by_value:
        return None, []

    ordered = sorted(score_by_value.items(), key=lambda item: (-item[1], item[0]))
    values = [value for value, _ in ordered]
    return values[0], values


def run_ocr_on_crop(ocr, image: Image.Image):
    variant_results = []

    for variant_name, variant_image in make_variants(image):
        result_iter = list(ocr.predict(np.array(variant_image.convert("RGB"))))
        if not result_iter:
            continue

        json_payload = result_iter[0].json["res"]
        texts = json_payload.get("rec_texts") or []
        boxes = json_payload.get("dt_polys") or []
        mesa_candidates, chair_candidates = parse_variant_result(texts, boxes, variant_name)
        variant_results.append(
            {
                "variant": variant_name,
                "texts": texts,
                "mesa_candidates": mesa_candidates,
                "chair_candidates": chair_candidates,
            }
        )

    mesa_pool = [candidate for result in variant_results for candidate in result["mesa_candidates"]]
    chair_pool = [candidate for result in variant_results for candidate in result["chair_candidates"]]

    numero, numero_candidates = choose_best_candidate(mesa_pool, 1, 500)
    chair_count, chair_candidates = choose_best_candidate(chair_pool, 1, 24)

    return {
        "numero": numero,
        "chairCount": chair_count,
        "numeroCandidates": numero_candidates,
        "chairCandidates": chair_candidates,
        "variants": [
            {
                "variant": result["variant"],
                "texts": result["texts"][:8],
            }
            for result in variant_results
        ],
    }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: paddle-plan-ocr.py <image-path> <regions-json-path>")

    image_path = Path(sys.argv[1])
    regions_path = Path(sys.argv[2])

    image = Image.open(image_path).convert("RGB")
    regions = json.loads(regions_path.read_text(encoding="utf-8-sig"))

    ocr = PaddleOCR(
        lang="en",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="en_PP-OCRv5_mobile_rec",
    )

    results = []
    for region in regions:
        x = max(0, int(region["x"]))
        y = max(0, int(region["y"]))
        width = max(1, int(region["width"]))
        height = max(1, int(region["height"]))
        cropped = image.crop((x, y, x + width, y + height))
        parsed = run_ocr_on_crop(ocr, cropped)
        results.append(
            {
                "index": region.get("index"),
                "numero": parsed["numero"],
                "chairCount": parsed["chairCount"],
                "numeroCandidates": parsed["numeroCandidates"],
                "chairCandidates": parsed["chairCandidates"],
                "variants": parsed["variants"],
            }
        )

    print(json.dumps({"results": results}, ensure_ascii=True))


if __name__ == "__main__":
    main()
