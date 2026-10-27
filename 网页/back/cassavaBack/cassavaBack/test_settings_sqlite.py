from .settings import *

# 本地 runserver 需要由 Django 提供媒体文件服务。
DEBUG = True

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'unique-snowflake',
    }
}

# 本地 runserver 使用 HTTP，避免被生产环境的 HTTPS 强制跳转拦截。
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Unit tests validate task creation independently from model inference.
PREDICTION_TASKS_DISABLED = True
