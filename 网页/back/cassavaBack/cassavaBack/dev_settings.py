"""本地开发默认配置（2026-10-27 新增）。

定位：`settings.py` 是**生产基线**（读 `.env`，缺 SECRET_KEY 直接报错）；
本文件在其之上只改「本地必须不同、且带外部副作用」的那几项。

为什么要有这个文件：
`.env` 是生产配置（远程 PG、OSS 密钥、163 邮箱）。直接在本机跑 `settings.py`
会拿生产密钥去连生产资源——本地点一次「注册」就真发一封邮件、上传一次就进生产桶。
这里把副作用全部归零，而不是靠人记得别点。

差异清单：
- 数据库：sqlite 本地文件，不碰生产 PostgreSQL；
- 密钥：固定本地专用 SECRET_KEY，不复用生产密钥；
- 邮件：console 后端，验证码打到终端，不发信；
- 存储：强制本地磁盘并清空 OSS 凭据，不写生产桶；
- HTTPS：关闭强制跳转与 Secure Cookie，本地 HTTP 可用；
- 预测任务：默认不执行（单元测试需要），交互式调试用 `dev_runtime_settings`。
"""

from .settings import *  # noqa: F401,F403

DEBUG = True

# 仅本地使用；与生产密钥刻意不同，避免本地 cookie/token 泄漏到线上可用。
SECRET_KEY = 'django-insecure-local-dev-only'

ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        'OPTIONS': {'timeout': 60},
    }
}

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'cassava-local-dev',
    }
}

# 本地 HTTP，不能被生产环境的 HTTPS 跳转拦截。
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SECURE_HSTS_SECONDS = 0

# 外部副作用归零
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
DEFAULT_FROM_EMAIL = 'dev@localhost'
FILE_STORAGE_BACKEND = 'local'
OSS_ACCESS_KEY_ID = ''
OSS_ACCESS_KEY_SECRET = ''

# 单元测试与纯前端联调默认不起预测 worker。
PREDICTION_TASKS_DISABLED = True

# Windows cannot rotate one log file while the import worker also holds it open.
from copy import deepcopy
LOGGING = deepcopy(LOGGING)
for handler in LOGGING.get('handlers', {}).values():
    if handler.get('filename'):
        log_file = Path(handler['filename'])
        handler['filename'] = str(log_file.with_name(f'{log_file.stem}.local-{os.getpid()}{log_file.suffix}'))
