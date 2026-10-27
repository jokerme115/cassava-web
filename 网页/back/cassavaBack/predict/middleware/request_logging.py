import logging
import time
import uuid


request_logger = logging.getLogger('django.request')


def _client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


def _user_id(request):
    user = getattr(request, 'user', None)
    if getattr(user, 'is_authenticated', False):
        return user.pk
    return 'anonymous'


class RequestLoggingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get('X-Request-ID') or uuid.uuid4().hex
        request.request_id = request_id
        start_time = time.perf_counter()

        try:
            response = self.get_response(request)
        except Exception:
            duration_ms = (time.perf_counter() - start_time) * 1000
            request_logger.exception(
                'request_failed request_id=%s method=%s path=%s duration_ms=%.2f user_id=%s ip=%s',
                request_id,
                request.method,
                request.get_full_path(),
                duration_ms,
                _user_id(request),
                _client_ip(request),
            )
            raise

        duration_ms = (time.perf_counter() - start_time) * 1000
        response['X-Request-ID'] = request_id
        status_code = getattr(response, 'status_code', 0)
        log_level = logging.WARNING if status_code >= 400 else logging.INFO

        request_logger.log(
            log_level,
            'request_finished request_id=%s method=%s path=%s status=%s duration_ms=%.2f user_id=%s ip=%s content_length=%s',
            request_id,
            request.method,
            request.get_full_path(),
            status_code,
            duration_ms,
            _user_id(request),
            _client_ip(request),
            request.META.get('CONTENT_LENGTH') or 0,
        )
        return response
