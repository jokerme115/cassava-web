from functools import lru_cache
from django.urls import get_resolver, URLResolver


@lru_cache(maxsize=1)
def bound_permission_codes():
    codes = set()

    def add(value):
        if isinstance(value, str):
            codes.add(value)
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                add(item)

    def walk(patterns):
        for pattern in patterns:
            if isinstance(pattern, URLResolver):
                walk(pattern.url_patterns)
                continue
            callback = pattern.callback
            view = getattr(callback, 'cls', None) or getattr(callback, 'view_class', None)
            if not view:
                continue
            for value in getattr(view, 'perms_map', {}).values():
                add(value)
            add(getattr(view, 'permission_codename', None))
            add(getattr(view, 'required_permissions', []))

    walk(get_resolver().url_patterns)
    return frozenset(codes)
