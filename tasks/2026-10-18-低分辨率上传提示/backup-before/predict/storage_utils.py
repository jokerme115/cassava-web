from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from typing import Any

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from .oss_service import check_oss_configured, delete_file_from_oss, upload_file_to_oss

logger = logging.getLogger(__name__)


def build_preview_storage_key(folder: Any = None, extension: str = "jpg") -> str:
    folder_id = getattr(folder, "id", folder)
    folder_segment = str(folder_id).strip() if folder_id not in (None, "") else "root"
    ext = (extension or "jpg").lstrip(".") or "jpg"
    return f"previews/{folder_segment}/{uuid.uuid4().hex}.{ext}"


def save_storage_bytes(key: str, data: bytes, error_message: str = "文件保存失败") -> str:
    if check_oss_configured():
        result = upload_file_to_oss(key, data)
        if result.get("status_code") != 200:
            logger.error("Failed to upload storage key %s to OSS: %s", key, result)
            raise RuntimeError(f"{error_message}: {result.get('error') or result}")
        return key

    return default_storage.save(key, ContentFile(data))


def read_storage_bytes(key: str) -> bytes:
    normalized = normalize_storage_key(key)
    if not normalized:
        raise FileNotFoundError('存储路径为空')
    if check_oss_configured():
        from .oss_service import get_file_from_oss
        payload = get_file_from_oss(normalized)
        if payload is None:
            raise FileNotFoundError(normalized)
        return payload
    with default_storage.open(normalized, 'rb') as stored_file:
        return stored_file.read()


def normalize_storage_key(value: Any) -> str | None:
    if value is None:
        return None

    if hasattr(value, "name"):
        value = getattr(value, "name", value)

    normalized = str(value).strip().replace("\\", "/")
    if not normalized or normalized.lower() in {"none", "null"}:
        return None

    if normalized.startswith(("http://", "https://")):
        return None

    media_url = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    if media_url.startswith("/") and normalized.startswith(media_url):
        normalized = normalized[len(media_url):]

    return normalized.lstrip("/") or None


def iter_storage_keys(value: Any) -> Iterable[str]:
    if value is None:
        return

    if isinstance(value, dict):
        for nested_value in value.values():
            yield from iter_storage_keys(nested_value)
        return

    if isinstance(value, (list, tuple, set)):
        for nested_value in value:
            yield from iter_storage_keys(nested_value)
        return

    normalized = normalize_storage_key(value)
    if normalized:
        yield normalized


def unique_storage_keys(*values: Any, exclude: Any = None) -> list[str]:
    excluded = {key for key in iter_storage_keys(exclude)}
    unique_keys: list[str] = []
    seen: set[str] = set()

    for value in values:
        for key in iter_storage_keys(value):
            if key in excluded or key in seen:
                continue
            seen.add(key)
            unique_keys.append(key)

    return unique_keys


def collect_cassava_image_storage_keys(instance: Any) -> list[str]:
    return unique_storage_keys(
        getattr(instance, "oss_key", None),
        getattr(instance, "preview_oss_key", None),
    )


def collect_segmentation_storage_keys(instance: Any) -> list[str]:
    return unique_storage_keys(getattr(instance, "oss_key", None))


def collect_prediction_storage_keys(instance: Any) -> list[str]:
    original_image = getattr(instance, "original_image", None)
    segmentation = getattr(instance, "segmentation", None)
    segmentation_original = getattr(segmentation, "original_image", None)

    protected_keys = unique_storage_keys(
        getattr(original_image, "oss_key", None),
        getattr(segmentation, "oss_key", None),
        getattr(segmentation_original, "oss_key", None),
    )

    vis_images = getattr(instance, "vis_images", None) or {}
    owned_vis_images = {
        key: value
        for key, value in vis_images.items()
        if str(key).startswith("pred_")
    } if isinstance(vis_images, dict) else vis_images

    candidate_keys = unique_storage_keys(
        getattr(instance, "oss_key", None),
        getattr(instance, "result_image", None),
        getattr(instance, "cassava_mask_key", None),
        getattr(instance, "rotten_mask_key", None),
        getattr(instance, "confidence_map_key", None),
        owned_vis_images,
        exclude=protected_keys,
    )

    owned_keys: list[str] = []
    result_image_key = normalize_storage_key(getattr(getattr(instance, "result_image", None), "name", getattr(instance, "result_image", None)))

    for key in candidate_keys:
        if key.startswith(("predictions/", "prediction_masks/", "prediction_confidence/")):
            owned_keys.append(key)
            continue
        if result_image_key and key == result_image_key and key not in protected_keys:
            owned_keys.append(key)

    return unique_storage_keys(owned_keys)


def collect_correction_storage_keys(instance: Any) -> list[str]:
    return unique_storage_keys(
        getattr(instance, 'cassava_mask_key', None),
        getattr(instance, 'rotten_mask_key', None),
    )


def delete_storage_keys(keys: Any) -> list[str]:
    deleted_keys: list[str] = []
    use_oss = check_oss_configured()

    for key in unique_storage_keys(keys):
        try:
            if use_oss:
                result = delete_file_from_oss(key)
                status_code = result.get("status_code")
                if status_code and int(status_code) >= 400:
                    logger.warning("Failed to delete OSS key %s: %s", key, result)
                    continue
            else:
                default_storage.delete(key)
            deleted_keys.append(key)
        except Exception as exc:
            logger.warning("Failed to delete storage key %s: %s", key, exc)

    return deleted_keys


def collect_database_storage_keys() -> set[str]:
    from .models import CassavaImage, PredictionCorrection, PredictionResult, SegmentationResult

    keys: set[str] = set()

    for oss_key, preview_key in CassavaImage.objects.values_list("oss_key", "preview_oss_key"):
        keys.update(iter_storage_keys((oss_key, preview_key)))

    for (oss_key,) in SegmentationResult.objects.values_list("oss_key"):
        keys.update(iter_storage_keys(oss_key))

    for values in PredictionResult.objects.values_list(
        "oss_key", "result_image", "vis_images", "cassava_mask_key", "rotten_mask_key", "confidence_map_key"
    ):
        keys.update(iter_storage_keys(values))

    for values in PredictionCorrection.objects.values_list("cassava_mask_key", "rotten_mask_key"):
        keys.update(iter_storage_keys(values))

    return keys
