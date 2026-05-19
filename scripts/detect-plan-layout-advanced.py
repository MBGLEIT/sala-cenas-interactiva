import json
import os
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps
from paddleocr import PaddleOCR

try:
    from paddleocr import PPStructureV3
except Exception:
    PPStructureV3 = None

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None


os.environ.setdefault("ULTRALYTICS_CONFIG_DIR", str(Path.cwd() / ".ultralytics"))


def normalize_token(text: str) -> str:
    token = (text or "").upper().strip()
    token = token.replace(" ", "")
    token = token.replace(";", ":").replace(",", ":").replace("_", ":").replace("-", ":").replace("=", ":")
    token = token.replace("O", "0").replace("I", "1").replace("L", "1").replace("$", "S")
    return token


def token_center(box):
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return float(sum(xs) / len(xs)), float(sum(ys) / len(ys))


def parse_token(text: str):
    token = normalize_token(text)
    mesa_match = re.search(r"M[:]?(\d{1,3})", token)
    if mesa_match:
        return ("mesa", int(mesa_match.group(1)))
    silla_match = re.search(r"S[:]?(\d{1,2})", token)
    if silla_match:
        return ("silla", int(silla_match.group(1)))
    return None


def build_variants(image: Image.Image):
    grayscale = ImageOps.grayscale(image)
    threshold = (
        ImageOps.autocontrast(ImageEnhance.Contrast(grayscale).enhance(2.2))
        .point(lambda value: 255 if value > 172 else 0)
        .convert("RGB")
    )
    contrast = ImageEnhance.Contrast(image).enhance(1.7)
    return [
        ("original", image.convert("RGB")),
        ("threshold", threshold),
        ("contrast", contrast.convert("RGB")),
    ]


def run_paddle_tokens(image: Image.Image):
    with redirect_stdout(sys.stderr):
        ocr = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="en_PP-OCRv5_mobile_rec",
        )
    tokens = []
    for variant_name, variant in build_variants(image):
        with redirect_stdout(sys.stderr):
            result_iter = list(ocr.predict(np.array(variant)))
        if not result_iter:
            continue
        payload = result_iter[0].json.get("res", {})
        texts = payload.get("rec_texts") or []
        boxes = payload.get("dt_polys") or []
        scores = payload.get("rec_scores") or []
        for index, raw_text in enumerate(texts):
            parsed = parse_token(raw_text)
            if not parsed or index >= len(boxes):
                continue
            center_x, center_y = token_center(boxes[index])
            width = max(point[0] for point in boxes[index]) - min(point[0] for point in boxes[index])
            height = max(point[1] for point in boxes[index]) - min(point[1] for point in boxes[index])
            score = float(scores[index]) if index < len(scores) else 0.0
            tokens.append(
                {
                    "kind": parsed[0],
                    "value": parsed[1],
                    "x": center_x,
                    "y": center_y,
                    "width": width,
                    "height": height,
                    "score": score + (0.05 if variant_name == "threshold" else 0.0),
                }
            )
    deduped = {}
    for token in tokens:
        key = (
            token["kind"],
            token["value"],
            round(token["x"] / 12),
            round(token["y"] / 12),
        )
        previous = deduped.get(key)
        if not previous or token["score"] > previous["score"]:
            deduped[key] = token
    return list(deduped.values())


def run_pp_structure(image: Image.Image):
    if PPStructureV3 is None:
        return {"used": False, "boxes": []}
    try:
        with redirect_stdout(sys.stderr):
            engine = PPStructureV3()
            result_iter = list(engine.predict(np.array(image.convert("RGB"))))
        boxes = []
        for item in result_iter:
            payload = getattr(item, "json", {}) or {}
            regions = payload.get("res") if isinstance(payload, dict) else None
            if not isinstance(regions, list):
                continue
            for region in regions:
                bbox = region.get("bbox") or region.get("box")
                if isinstance(bbox, list) and len(bbox) >= 4:
                    boxes.append(bbox[:4])
        return {"used": True, "boxes": boxes[:200]}
    except Exception:
        return {"used": False, "boxes": []}


def run_yolo_boxes(image: Image.Image):
    model_path = os.environ.get("PLAN_IMPORT_YOLO_MODEL", "").strip()
    if YOLO is None or not model_path or not Path(model_path).exists():
        return {"used": False, "boxes": []}
    try:
        with redirect_stdout(sys.stderr):
            model = YOLO(model_path)
            results = model.predict(np.array(image.convert("RGB")), verbose=False)
        boxes = []
        for result in results:
            xyxy = getattr(getattr(result, "boxes", None), "xyxy", None)
            if xyxy is None:
                continue
            for row in xyxy.tolist():
                if len(row) >= 4:
                    boxes.append(row[:4])
        return {"used": True, "boxes": boxes}
    except Exception:
        return {"used": False, "boxes": []}


def run_opencv_candidates(image: Image.Image):
    image_bgr = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    threshold = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        41,
        4,
    )
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 450 or area > 12000:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        ratio = width / max(1, height)
        if ratio < 0.72 or ratio > 1.35:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        circularity = 4 * np.pi * area / (perimeter * perimeter)
        if circularity < 0.18:
            continue
        candidates.append(
            {
                "x": x + width / 2.0,
                "y": y + height / 2.0,
                "width": width,
                "height": height,
                "area": area,
            }
        )
    return candidates


def spatial_sort(items):
    if not items:
        return []
    heights = [item.get("height", 48) for item in items]
    tolerance = max(26, int(np.median(heights) * 1.2))
    ordered = sorted(items, key=lambda item: (item["y"], item["x"]))
    rows = []
    for item in ordered:
        if not rows:
            rows.append([item])
            continue
        row = rows[-1]
        anchor = sum(entry["y"] for entry in row) / len(row)
        if abs(item["y"] - anchor) <= tolerance:
            row.append(item)
        else:
            rows.append([item])
    return [entry for row in rows for entry in sorted(row, key=lambda item: item["x"])]


def assign_chairs(mesa_tokens, silla_tokens):
    ordered_tables = spatial_sort(mesa_tokens)
    for mesa in ordered_tables:
        chair_pool = []
        for silla in silla_tokens:
            dx = abs(silla["x"] - mesa["x"])
            dy = silla["y"] - mesa["y"]
            if dx > max(mesa["width"] * 1.6, 120):
                continue
            if abs(dy) > max(mesa["height"] * 1.8, 130):
                continue
            score = silla["score"] - dx * 0.003 - abs(dy) * 0.002
            if dy >= 0:
                score += 0.08
            chair_pool.append((score, silla["value"]))
        chair_pool.sort(key=lambda item: (-item[0], item[1]))
        mesa["chairCount"] = chair_pool[0][1] if chair_pool else None
    return ordered_tables


def merge_with_opencv(tables, cv_candidates):
    if not tables or not cv_candidates:
        return tables
    cv_sorted = spatial_sort(cv_candidates)
    tables_sorted = spatial_sort(tables)
    limit = min(len(cv_sorted), len(tables_sorted))
    merged = []
    for index in range(limit):
        merged.append(
            {
                "numero": tables_sorted[index]["value"],
                "chairCount": tables_sorted[index].get("chairCount"),
                "x": cv_sorted[index]["x"],
                "y": cv_sorted[index]["y"],
            }
        )
    return merged


def to_entries(tables):
    entries = []
    for table in tables:
        chair_count = table.get("chairCount")
        if chair_count is None:
            chair_count = 8
        entries.append(
            {
                "numero": int(table["numero"] if "numero" in table else table["value"]),
                "chairCount": int(chair_count),
                "x": int(round(table["x"])),
                "y": int(round(table["y"])),
            }
        )
    return entries


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: detect-plan-layout-advanced.py <image-path> <hints-json-path>")

    image_path = Path(sys.argv[1])
    hints_path = Path(sys.argv[2])
    hints = json.loads(hints_path.read_text(encoding="utf-8"))
    image = Image.open(image_path).convert("RGB")

    paddle_tokens = run_paddle_tokens(image)
    mesa_tokens = [token for token in paddle_tokens if token["kind"] == "mesa"]
    silla_tokens = [token for token in paddle_tokens if token["kind"] == "silla"]
    pp_structure = run_pp_structure(image)
    yolo = run_yolo_boxes(image)
    cv_candidates = run_opencv_candidates(image)

    tables = assign_chairs(mesa_tokens, silla_tokens)
    entries = merge_with_opencv(tables, cv_candidates)
    if not entries:
        entries = [
            {
                "numero": token["value"],
                "chairCount": 8,
                "x": token["x"],
                "y": token["y"],
            }
            for token in spatial_sort(mesa_tokens)
        ]

    print(
        json.dumps(
            {
                "tables": to_entries(entries),
                "meta": {
                    "paddleTableCount": len(mesa_tokens),
                    "paddleChairCount": len(silla_tokens),
                    "opencvCandidateCount": len(cv_candidates),
                    "ppStructureUsed": pp_structure["used"],
                    "ppStructureBoxCount": len(pp_structure["boxes"]),
                    "yoloUsed": yolo["used"],
                    "yoloBoxCount": len(yolo["boxes"]),
                    "expectedTableCount": hints.get("expectedTableCount"),
                    "imageWidth": image.size[0],
                    "imageHeight": image.size[1],
                },
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    main()
