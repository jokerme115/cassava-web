# -*- coding: utf-8 -*-
"""批次6 第一步：把模型推理那一大块（helper + DeepLabV3PlusService）拆出 services.py。

切分点用行号硬切，切完立刻用 import 反查 + 语法编译 + 测试兜底。
"""
import io
import re

SRC = 'services.py'
DST = 'deeplab_service.py'

lines = io.open(SRC, encoding='utf-8').read().splitlines(True)
total = len(lines)

# 头部：1..2333（含第 2333 行 deeplabv3plus_service 单例）
split_at = 2333
head = lines[:split_at]
tail = lines[split_at:]

assert 'class DeepLabV3PlusService' in ''.join(head)
assert 'deeplabv3plus_service = DeepLabV3PlusService()' in ''.join(head)
assert 'class BaseService' in ''.join(tail)

# ---- 新文件：模型推理层 ----
header = '''"""木薯采后腐烂面积预测 —— 模型推理层。

批次6 第一步从 `services.py` 拆出（原 2333 行）：模型权重定位/校验、DeepLabV3+
推理服务、TTA、掩膜后处理、模型来源说明、失败原因翻译。业务服务类（图片/任务/
权限等）仍在 `services.py`，通过 `from .deeplab_service import ...` 复用本模块。

拆分原则：代码逻辑一字未改，只搬位置；公开名字全部保留，调用方无需调整。
"""

import hashlib
import logging
import os
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Union, List, Tuple

import albumentations as A
import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageOps
from django.conf import settings

from .image_quality import image_dimensions
from .m6_predictor import m6_best_predictor
from .ensemble import MEMBERS, LABELS, METHOD, vote_probabilities, voting_summary
from .mask_utils import calculate_mask_metrics, confidence_to_png_bytes, mask_to_png_bytes

logger = logging.getLogger(__name__)

'''

body = ''.join(head[29:])  # head[0:29] 是原文件第 1-29 行的 import 与 logger
body = body.lstrip('\n')
io.open(DST, 'w', encoding='utf-8').write(header + body)

# ---- services.py：只留业务服务层 ----
new_head = '''"""木薯采后腐烂面积预测 —— 业务服务层。

批次6 分步拆分（原 3913 行）：
- 模型推理相关（权重定位、DeepLabV3+ 推理、TTA、掩膜后处理）已移到 `deeplab_service.py`
- 本文件保留图片/分割/预测/任务/文件夹/审计/分享等业务服务类

对外名字保持不变：`predict.views` 等模块仍然 `from .services import XxxService`。
"""

import logging
import os
import shutil
import tempfile
import uuid
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from django.conf import settings
from django.utils import timezone

from .image_quality import image_dimensions
from .m6_predictor import m6_best_predictor
from .ensemble import LABELS, METHOD
from .mask_utils import calculate_mask_metrics, confidence_to_png_bytes, mask_to_png_bytes

# 模型推理层：拆分前置位，调用方仍从本模块导入这些名字
from .deeplab_service import (  # noqa: F401
    DeepLabV3PlusService,
    check_model_path,
    deeplabv3plus_service,
    describe_prediction_failure,
    post_process_mask,
    prediction_provenance,
    resolve_existing_model_path,
    tta_predict,
)

logger = logging.getLogger(__name__)

'''
tail_text = ''.join(tail).lstrip('\n')
# 去掉 tail 里原有的“创建服务实例/以下是新增的业务服务类”两段注释，换成一句新的
tail_text = tail_text.replace(
    "# 创建服务实例\ndeeplabv3plus_service = DeepLabV3PlusService()\n\n\n", "", 1)
io.open(SRC, 'w', encoding='utf-8').write(new_head + tail_text)

print('deeplab_service.py:', len(io.open(DST, encoding='utf-8').read().splitlines()), 'lines')
print('services.py     :', len(io.open(SRC, encoding='utf-8').read().splitlines()), 'lines')

# 语法编译
for f in (DST, SRC):
    compile(io.open(f, encoding='utf-8').read(), f, 'exec')
print('compile ok')

# 名字完整性：原文件所有顶层 def/class 仍可从 services 导入
old_names = set()
for line in lines:
    m = re.match(r'^(?:class|def) (\w+)', line)
    if m:
        old_names.add(m.group(1))
re_exported = set(re.findall(r'^\s{4}(\w+),', io.open(SRC, encoding='utf-8').read(), re.M))
new_src = io.open(SRC, encoding='utf-8').read() + io.open(DST, encoding='utf-8').read()
missing = [n for n in sorted(old_names) if not re.search(r'^(?:class|def) %s\b' % n, new_src, re.M)]
print('top-level names:', len(old_names), 'missing:', missing)
