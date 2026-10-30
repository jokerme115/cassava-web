"""Whole-image resolution screening; never inferred from thumbnail dimensions."""
from io import BytesIO
from PIL import Image

MIN_LONG_EDGE = 1024
MIN_SHORT_EDGE = 512


def image_dimensions(content):
    with Image.open(BytesIO(content)) as image:
        width, height = image.size
        if image.getexif().get(274) in (5, 6, 7, 8):
            width, height = height, width
    return width, height


def resolution_info(width, height):
    known = bool(width and height and width > 0 and height > 0)
    low = (max(width, height) < MIN_LONG_EDGE or min(width, height) < MIN_SHORT_EDGE) if known else None
    return {
        'status': 'low' if low else ('screened' if known else 'unknown'),
        'low_resolution': low,
        'warning': (f'低分辨率：{width}×{height}像素，可能遗漏细小病斑，建议使用相机原图；仍可上传。' if low else None),
        'rule': {'min_long_edge': MIN_LONG_EDGE, 'min_short_edge': MIN_SHORT_EDGE},
    }
