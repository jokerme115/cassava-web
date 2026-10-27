"""Binary mask helpers shared by prediction persistence and manual correction."""

from io import BytesIO

import numpy as np
from django.conf import settings
from PIL import Image


def calculate_mask_metrics(cassava_mask, rotten_mask):
    cassava = np.asarray(cassava_mask).astype(bool)
    rotten = np.asarray(rotten_mask).astype(bool)
    if cassava.ndim != 2 or rotten.ndim != 2:
        raise ValueError('掩码必须是二维灰度图像')
    if cassava.shape != rotten.shape:
        raise ValueError('木薯掩码和腐烂掩码尺寸必须一致')

    effective_rotten = rotten & cassava
    cassava_pixels = int(np.count_nonzero(cassava))
    rotten_pixels = int(np.count_nonzero(effective_rotten))
    ppd_percent = (rotten_pixels / cassava_pixels * 100.0) if cassava_pixels else 0.0
    return cassava, effective_rotten, cassava_pixels, rotten_pixels, ppd_percent


def mask_to_png_bytes(mask):
    image = Image.fromarray((np.asarray(mask).astype(bool).astype('uint8') * 255), mode='L')
    buffer = BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def confidence_to_png_bytes(confidence):
    """将 0-1 逐像素置信度压缩为 8-bit 灰度 PNG，供编辑器按需加载。"""
    values = np.asarray(confidence, dtype=np.float32)
    if values.ndim != 2:
        raise ValueError('置信度图必须是二维数组')
    image = Image.fromarray((np.clip(values, 0.0, 1.0) * 255.0).round().astype('uint8'), mode='L')
    buffer = BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def load_mask_file(file_obj, expected_size=None):
    max_bytes = int(getattr(settings, 'CORRECTION_MASK_MAX_BYTES', 25 * 1024 * 1024))
    file_size = getattr(file_obj, 'size', None)
    if file_size is not None and file_size > max_bytes:
        raise ValueError(f'单张掩码不能超过 {max_bytes // (1024 * 1024)}MB')

    image = Image.open(file_obj)
    width, height = image.size
    max_pixels = int(getattr(settings, 'CORRECTION_MASK_MAX_PIXELS', 50_000_000))
    if width <= 0 or height <= 0 or width * height > max_pixels:
        raise ValueError('掩码尺寸超出允许范围')
    if expected_size and (width, height) != tuple(expected_size):
        raise ValueError(
            f'掩码尺寸必须与原始预测一致：{expected_size[0]} × {expected_size[1]}'
        )
    image.load()
    return np.asarray(image.convert('L')) > 127
