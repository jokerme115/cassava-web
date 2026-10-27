"""Export task 61 as cross-section contour images with PPD as the only text."""

from __future__ import annotations

import csv
import json
import re
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "网页" / "back" / "cassavaBack"
MEDIA = BACKEND / "media"
TASK_ID = 61
EXPECTED_COUNT = 30


def media_path(key: str) -> Path:
    path = (MEDIA / key).resolve()
    if not path.is_relative_to(MEDIA.resolve()) or not path.is_file():
        raise ValueError(f"Missing or invalid media key: {key}")
    return path


def mask_array(key: str, expected_size: tuple[int, int]) -> np.ndarray:
    with Image.open(media_path(key)) as image:
        if image.size != expected_size:
            raise ValueError(f"Mask size mismatch: {key}: {image.size} != {expected_size}")
        return np.asarray(image.convert("L")) > 0


def draw_contours(image: Image.Image, mask: np.ndarray, color: tuple[int, int, int]) -> Image.Image:
    rgb = np.asarray(image.convert("RGB")).copy()
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(rgb, contours, -1, color, 3, lineType=cv2.LINE_AA)
    return Image.fromarray(rgb)


def safe_stem(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", Path(name).stem)


def main() -> None:
    connection = sqlite3.connect(BACKEND / "db.sqlite3")
    connection.row_factory = sqlite3.Row
    task = connection.execute("SELECT id, name, status FROM predict_processingtask WHERE id=?", (TASK_ID,)).fetchone()
    if task is None or task["status"] != "completed" or "2026/10/24 21:27:16" not in task["name"]:
        raise ValueError("The expected completed prediction task was not found")
    records = connection.execute(
        """
        SELECT p.id prediction_id, p.ppd_value, p.ppd_unit, p.cassava_mask_key,
               p.rotten_mask_key, p.vis_images, i.id image_id, i.name image_name
        FROM predict_predictionresult p
        JOIN predict_cassavaimage i ON i.id = p.original_image_id
        WHERE p.processing_task_id=?
        ORDER BY i.id
        """,
        (TASK_ID,),
    ).fetchall()
    if len(records) != EXPECTED_COUNT or len({r["image_id"] for r in records}) != EXPECTED_COUNT:
        raise ValueError(f"Expected {EXPECTED_COUNT} unique images, found {len(records)} results")
    correction_count = connection.execute(
        """SELECT COUNT(*) FROM predict_predictioncorrection
           WHERE prediction_id IN (SELECT id FROM predict_predictionresult WHERE processing_task_id=?)""",
        (TASK_ID,),
    ).fetchone()[0]
    if correction_count:
        raise ValueError("Corrections exist; this exporter must be updated to use corrected masks")

    # Validate every record before creating any output files.
    prepared = []
    for record in records:
        segment_key = json.loads(record["vis_images"])["cut2_1"]
        segment = connection.execute(
            "SELECT description FROM predict_segmentationresult WHERE oss_key=? AND original_image_id=?",
            (segment_key, record["image_id"]),
        ).fetchone()
        if segment is None:
            raise ValueError(f"Missing segment metadata for prediction {record['prediction_id']}")
        x1, y1, x2, y2 = json.loads(segment["description"])["bbox"]
        with Image.open(media_path(segment_key)) as cut:
            cut_size = cut.size
        if cut_size != (x2 - x1, y2 - y1):
            raise ValueError(f"Crop bounds do not match cut {segment_key}")
        with Image.open(media_path(record["cassava_mask_key"])) as full_mask:
            full_size = full_mask.size
        cassava = mask_array(record["cassava_mask_key"], full_size)
        rotten = mask_array(record["rotten_mask_key"], full_size)
        if not np.all(~rotten | cassava):
            raise ValueError(f"Rotten mask exceeds cassava mask: {record['prediction_id']}")
        cassava_pixels = int(cassava.sum())
        if not cassava_pixels:
            raise ValueError(f"Empty cassava mask: {record['prediction_id']}")
        computed_ppd = 100 * int(rotten.sum()) / cassava_pixels
        stored_ppd = float(record["ppd_value"])
        if record["ppd_unit"] != "percent" or abs(computed_ppd - stored_ppd) > 0.005:
            raise ValueError(f"PPD does not match masks: {record['prediction_id']}: {computed_ppd} != {stored_ppd}")
        if cassava[:y1].any() or cassava[y2:].any() or cassava[:, :x1].any() or cassava[:, x2:].any():
            raise ValueError(f"Cassava mask extends beyond crop: {record['prediction_id']}")
        prepared.append((record, segment_key, (x1, y1, x2, y2), stored_ppd))

    output = ROOT / "docs" / f"预测任务-20261024-212716_PPD轮廓交付_{datetime.now():%Y%m%d_%H%M%S}"
    output.mkdir(parents=True, exist_ok=False)
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 44)
    csv_rows = []
    for number, (record, segment_key, box, ppd) in enumerate(prepared, 1):
        x1, y1, x2, y2 = box
        with Image.open(media_path(segment_key)) as cut:
            panel = cut.convert("RGB")
        with Image.open(media_path(record["cassava_mask_key"])) as mask:
            cassava_crop = np.asarray(mask.crop(box).convert("L")) > 0
        with Image.open(media_path(record["rotten_mask_key"])) as mask:
            rotten_crop = np.asarray(mask.crop(box).convert("L")) > 0
        panel = draw_contours(panel, cassava_crop, (45, 212, 191))
        panel = draw_contours(panel, rotten_crop, (255, 83, 114))
        canvas = Image.new("RGB", (panel.width, panel.height + 84), "white")
        canvas.paste(panel, (0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.text((28, panel.height + 16), f"PPD = {ppd:.2f}%", font=font, fill=(21, 37, 54))
        filename = f"{number:02d}_{safe_stem(record['image_name'])}.png"
        canvas.save(output / filename, dpi=(300, 300), optimize=True)
        csv_rows.append((number, record["image_name"], record["image_id"], record["prediction_id"], f"{ppd:.6f}", filename))
    with (output / "PPD数值.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("序号", "原图文件名", "图像ID", "预测ID", "PPD(%)", "交付图"))
        writer.writerows(csv_rows)
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for file in sorted(output.iterdir()):
            zipped.write(file, file.name)
    connection.close()
    print(json.dumps({"task_id": TASK_ID, "images": len(csv_rows), "corrections": correction_count,
                      "output": str(output), "archive": str(archive)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
