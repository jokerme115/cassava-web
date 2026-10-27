"""本地交互式服务配置：dev_settings + 真实执行预测任务。

用于 `runserver` 端到端联调（上传 → 预测 → 结果 → 导出）。
其余外部副作用（邮件、OSS、生产库）仍按 `dev_settings` 归零。
"""

from .dev_settings import *  # noqa: F401,F403

PREDICTION_TASKS_DISABLED = False
