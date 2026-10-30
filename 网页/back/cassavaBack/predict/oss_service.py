import logging
import os
from typing import Optional
from urllib.parse import urlparse

import oss2
from django.conf import settings
from django.core.files.storage import default_storage

logger = logging.getLogger(__name__)

OSS_ACCESS_KEY_ID = os.getenv('OSS_ACCESS_KEY_ID', getattr(settings, 'OSS_ACCESS_KEY_ID', ''))
OSS_ACCESS_KEY_SECRET = os.getenv('OSS_ACCESS_KEY_SECRET', getattr(settings, 'OSS_ACCESS_KEY_SECRET', ''))
OSS_ENDPOINT = os.getenv('OSS_ENDPOINT', getattr(settings, 'OSS_ENDPOINT', ''))
OSS_INTERNAL_ENDPOINT = os.getenv('OSS_INTERNAL_ENDPOINT', getattr(settings, 'OSS_INTERNAL_ENDPOINT', '')).strip()
OSS_BUCKET = os.getenv('OSS_BUCKET', getattr(settings, 'OSS_BUCKET', ''))
OSS_PUBLIC_BASE_URL = os.getenv('OSS_PUBLIC_BASE_URL', getattr(settings, 'OSS_PUBLIC_BASE_URL', '')).rstrip('/')
OSS_URL_ACCESS_MODE = os.getenv(
    'OSS_URL_ACCESS_MODE',
    getattr(settings, 'OSS_URL_ACCESS_MODE', 'signed')
).strip().lower()
OSS_SIGNED_URL_EXPIRE_SECONDS = int(
    os.getenv(
        'OSS_SIGNED_URL_EXPIRE_SECONDS',
        getattr(settings, 'OSS_SIGNED_URL_EXPIRE_SECONDS', 1800)
    )
)
OSS_SIGNED_URL_SLASH_SAFE = os.getenv(
    'OSS_SIGNED_URL_SLASH_SAFE',
    str(getattr(settings, 'OSS_SIGNED_URL_SLASH_SAFE', True))
).lower() == 'true'

def _strip_scheme(endpoint: str) -> str:
    return endpoint.replace('https://', '').replace('http://', '')


OSS_URL_PREFIX = ""
if OSS_PUBLIC_BASE_URL:
    OSS_URL_PREFIX = OSS_PUBLIC_BASE_URL
elif OSS_BUCKET and OSS_ENDPOINT:
    OSS_URL_PREFIX = f"https://{OSS_BUCKET}.{_strip_scheme(OSS_ENDPOINT)}"

bucket = None
signing_bucket = None


def _oss_credentials_configured() -> bool:
    return all([OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_ENDPOINT, OSS_BUCKET])


def _storage_backend() -> str:
    return os.getenv(
        'FILE_STORAGE_BACKEND',
        getattr(settings, 'FILE_STORAGE_BACKEND', 'local')
    ).strip().lower()


def _oss_read_fallback_enabled() -> bool:
    return os.getenv(
        'OSS_READ_FALLBACK',
        str(getattr(settings, 'OSS_READ_FALLBACK', True))
    ).lower() == 'true'


def check_oss_configured() -> bool:
    return _storage_backend() == 'oss' and _oss_credentials_configured()


def get_storage_backend() -> str:
    return _storage_backend()


def _get_bucket():
    global bucket
    if bucket is None:
        if not _oss_credentials_configured():
            error_msg = (
                "OSS configuration is incomplete: "
                f"OSS_ACCESS_KEY_ID={'set' if OSS_ACCESS_KEY_ID else 'empty'}, "
                f"OSS_ACCESS_KEY_SECRET={'set' if OSS_ACCESS_KEY_SECRET else 'empty'}, "
                f"OSS_ENDPOINT={OSS_ENDPOINT}, OSS_BUCKET={OSS_BUCKET}"
            )
            logger.error(error_msg)
            raise ValueError(error_msg)

        try:
            auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
            endpoint = OSS_INTERNAL_ENDPOINT or OSS_ENDPOINT
            bucket = oss2.Bucket(auth, endpoint, OSS_BUCKET)
        except Exception as exc:
            logger.error("Failed to initialize OSS bucket: %s", exc)
            raise

    return bucket


def _get_signing_bucket():
    global signing_bucket
    if signing_bucket is None:
        if not _oss_credentials_configured():
            error_msg = (
                "OSS configuration is incomplete: "
                f"OSS_ACCESS_KEY_ID={'set' if OSS_ACCESS_KEY_ID else 'empty'}, "
                f"OSS_ACCESS_KEY_SECRET={'set' if OSS_ACCESS_KEY_SECRET else 'empty'}, "
                f"OSS_ENDPOINT={OSS_ENDPOINT}, OSS_BUCKET={OSS_BUCKET}"
            )
            logger.error(error_msg)
            raise ValueError(error_msg)

        try:
            auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
            signing_bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)
        except Exception as exc:
            logger.error("Failed to initialize OSS signing bucket: %s", exc)
            raise

    return signing_bucket


def test_connection() -> dict:
    try:
        current_bucket = _get_bucket()
        current_bucket.get_bucket_info()
        return {'success': True, 'message': 'OSS connection successful'}
    except Exception as exc:
        return {'success': False, 'message': f'OSS connection failed: {exc}'}


def upload_file_to_oss(key: str, data: bytes, storage_class: Optional[str] = None, headers: Optional[dict] = None) -> dict:
    if _storage_backend() != 'oss':
        error = f"OSS upload skipped because FILE_STORAGE_BACKEND={_storage_backend()}"
        logger.warning(error)
        return {
            'status_code': 503,
            'error': error,
        }

    try:
        current_bucket = _get_bucket()
        request_headers = dict(headers or {})
        if storage_class:
            request_headers['x-oss-storage-class'] = str(storage_class)

        result = current_bucket.put_object(key, data, headers=request_headers or None)
        return {
            'status_code': result.status,
            'request_id': getattr(result, 'request_id', None),
            'etag': getattr(result, 'etag', None)
        }
    except ValueError as exc:
        return {
            'status_code': 503,
            'error': str(exc)
        }
    except Exception as exc:
        status_code = getattr(exc, 'status', None) or getattr(exc, 'code', None) or 500
        logger.error("Upload to OSS failed: %s", exc)
        return {
            'status_code': status_code,
            'error': str(exc)
        }


def get_file_from_oss(key: str) -> Optional[bytes]:
    try:
        current_bucket = _get_bucket()
        result = current_bucket.get_object(key)
        if result.status == 404:
            return None
        data = result.read()
        return data if data else None
    except ValueError:
        logger.error("OSS is not configured, cannot download file")
        return None
    except Exception as exc:
        status = getattr(exc, 'status', None)
        code = getattr(exc, 'code', None)
        if status == 404 or code == 'NoSuchKey':
            return None
        logger.error("Download from OSS failed: %s", exc)
        raise


def delete_file_from_oss(key: str) -> dict:
    try:
        current_bucket = _get_bucket()
        result = current_bucket.delete_object(key)
        return {
            'status_code': result.status,
            'request_id': getattr(result, 'request_id', None)
        }
    except ValueError as exc:
        return {
            'status_code': 503,
            'error': str(exc)
        }
    except Exception as exc:
        status_code = getattr(exc, 'status', None) or getattr(exc, 'code', None) or 500
        return {
            'status_code': status_code,
            'error': str(exc)
        }


def list_files_in_oss(prefix: str = '') -> list:
    files = []
    try:
        current_bucket = _get_bucket()
        for obj in oss2.ObjectIterator(current_bucket, prefix=prefix):
            files.append({
                'key': obj.key,
                'size': obj.size,
                'last_modified': obj.last_modified,
            })
        return files
    except Exception as exc:
        logger.error("List OSS files failed: %s", exc)
        return []


def _normalize_media_key(value: str) -> str:
    media_prefix = str(getattr(settings, 'MEDIA_URL', '/media/')).strip() or '/media/'
    media_prefix = media_prefix if media_prefix.startswith('/') else f'/{media_prefix}'

    raw_value = str(value).strip()
    if not raw_value:
        return ''

    if raw_value.startswith('http://') or raw_value.startswith('https://'):
        parsed = urlparse(raw_value)
        if parsed.path.startswith(media_prefix):
            raw_value = parsed.path[len(media_prefix):]
        else:
            return raw_value

    if raw_value.startswith(media_prefix):
        raw_value = raw_value[len(media_prefix):]

    return raw_value.lstrip('/')


def get_signed_file_url(key: str, expires_seconds: Optional[int] = None) -> str:
    normalized_key = _normalize_media_key(key)
    if not normalized_key:
        return ""

    if normalized_key.startswith('http://') or normalized_key.startswith('https://'):
        return normalized_key

    if not _oss_credentials_configured():
        return f"{settings.MEDIA_URL}{normalized_key}"

    try:
        current_bucket = _get_signing_bucket()
        return current_bucket.sign_url(
            'GET',
            normalized_key,
            expires_seconds or OSS_SIGNED_URL_EXPIRE_SECONDS,
            slash_safe=OSS_SIGNED_URL_SLASH_SAFE,
        )
    except Exception as exc:
        logger.error("Failed to generate signed OSS URL for %s: %s", normalized_key, exc)
        if OSS_URL_PREFIX:
            return f"{OSS_URL_PREFIX}/{normalized_key}"
        return ""


def get_file_url(key: str) -> str:
    if not key:
        return ""

    normalized_key = _normalize_media_key(key)
    if not normalized_key:
        return ""

    if normalized_key.startswith('http://') or normalized_key.startswith('https://'):
        return normalized_key

    if not check_oss_configured():
        if default_storage.exists(normalized_key):
            return f"{settings.MEDIA_URL}{normalized_key}"
        if _oss_read_fallback_enabled() and _oss_credentials_configured():
            return get_signed_file_url(normalized_key)
        return f"{settings.MEDIA_URL}{normalized_key}"

    if OSS_URL_ACCESS_MODE == 'public':
        if not OSS_URL_PREFIX:
            return ""
        return f"{OSS_URL_PREFIX}/{normalized_key}"

    return get_signed_file_url(normalized_key)
