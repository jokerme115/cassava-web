"""One measurement definition for result pages, corrections and exported artifacts."""
import json
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps

from .mask_utils import calculate_mask_metrics
from .storage_utils import read_storage_bytes


def latest_correction(prediction):
    prefetched = getattr(prediction, '_ordered_corrections', None)
    if prefetched is not None:
        return prefetched[0] if prefetched else None
    return prediction.corrections.order_by('-version').first()


_LATEST = object()

def measurement_info(prediction, correction=_LATEST):
    correction = latest_correction(prediction) if correction is _LATEST else correction
    value = correction.ppd_percent if correction else prediction.ppd_value
    if not correction and prediction.ppd_unit == 'ratio':
        value *= 100
    valid = bool(correction) or (prediction.ppd_unit in ('percent', 'ratio') and not prediction.error_code)
    legacy = (prediction.ensemble_details or {}).get('legacy_measurement', {})
    return {
        'protocol': 'area_weighted' if correction or not legacy else legacy.get('protocol'),
        'legacy_raw_value': legacy.get('raw_value'),
        'legacy_unit': legacy.get('unit'),
        'final_ppd': value if valid else None,
        'measurement_status': 'manual-corrected' if correction else ('model-only' if valid else 'needs-review'),
        'measurement_source': 'manual' if correction else 'model',
        'correction_version': correction.version if correction else 0,
        'corrected_by': correction.owner.username if correction and correction.owner else None,
        'corrected_at': correction.created_at.isoformat() if correction else None,
        'correction_note': correction.note if correction else '',
        'review_status': 'reviewed' if prediction.reviewed_version == (correction.version if correction else 0) else 'unreviewed',
        'reviewed_by': prediction.reviewed_by.username if prediction.reviewed_by else None,
        'reviewed_at': prediction.reviewed_at.isoformat() if prediction.reviewed_at else None,
        'execution_warning': ('历史任务选择与结果模型记录不一致，建议重新预测'
            if prediction.processing_task and prediction.processing_task.single_model_type
            and prediction.processing_task.single_model_type != prediction.single_model_type else None),
    }


def selected_correction(prediction, version='latest'):
    if version in ('latest', None, ''):
        return latest_correction(prediction)
    if str(version) in ('0', 'model'):
        return None
    try:
        return prediction.corrections.get(version=int(version))
    except (ValueError, TypeError, prediction.corrections.model.DoesNotExist) as exc:
        raise ValueError(f'结果{prediction.pk}不存在所选人工修订版本') from exc


def measurement_masks(prediction, correction=None):
    source = correction or prediction
    cassava = np.asarray(Image.open(BytesIO(read_storage_bytes(source.cassava_mask_key))).convert('L')) > 127
    rotten = np.asarray(Image.open(BytesIO(read_storage_bytes(source.rotten_mask_key))).convert('L')) > 127
    return calculate_mask_metrics(cassava, rotten)


def segment_measurements(prediction, cassava, rotten):
    from .models import SegmentationResult
    keys = [(key, value) for key, value in (prediction.vis_images or {}).items() if key.startswith('cut2_')]
    keys.sort(key=lambda item: int(item[0].split('_')[-1]))
    segments = {s.oss_key: s for s in SegmentationResult.objects.filter(oss_key__in=[value for _, value in keys])}
    h, w = cassava.shape
    output = []
    for name, key in keys:
        segment = segments.get(key)
        try:
            bbox = json.loads(segment.description).get('bbox') if segment else None
            if not bbox or len(bbox) != 4:
                continue
            x1, y1, x2, y2 = [int(n) for n in bbox]
            x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                continue
            _, _, cp, rp, ppd = calculate_mask_metrics(cassava[y1:y2, x1:x2], rotten[y1:y2, x1:x2])
            output.append({'segment': name, 'bbox': [x1, y1, x2, y2], 'cassava_pixels': cp,
                           'rotten_pixels': rp, 'ppd_percent': ppd if cp else None})
        except (ValueError, TypeError):
            continue
    return output


def saved_rotation(correction):
    data = getattr(correction, 'edit_data', None) or {}
    value = data.get('rotation_degrees', 0)
    return value if type(value) is int and value in (0, 90, 180, 270) else 0


def overlay_png(prediction, correction=None):
    if not prediction.original_image or not prediction.original_image.oss_key:
        raise ValueError('原图不可用，无法生成校正叠加图')
    original = ImageOps.exif_transpose(Image.open(BytesIO(read_storage_bytes(prediction.original_image.oss_key)))).convert('RGB')
    cassava, rotten, _, _, _ = measurement_masks(prediction, correction)
    if original.size != (cassava.shape[1], cassava.shape[0]):
        raise ValueError('原图与掩码尺寸不一致')
    colors = np.zeros((*cassava.shape, 4), dtype=np.uint8)
    colors[cassava] = [20, 184, 166, 55]
    colors[rotten] = [244, 63, 94, 150]
    image = Image.alpha_composite(original.convert('RGBA'), Image.fromarray(colors)).convert('RGB')
    image = image.rotate(-saved_rotation(correction), expand=True)
    buffer = BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()
