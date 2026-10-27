"""兼容别名（2026-10-27）：内容已迁到 `dev_settings.py`。

历史脚本与文档用的是这个名字，保留以免破坏既有命令。
新代码请用 `--settings=cassavaBack.dev_settings`。
"""

from .dev_settings import *  # noqa: F401,F403
