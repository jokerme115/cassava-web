"""Single model catalogue for task validation, execution and browser selection."""
import hashlib
import importlib.util
import json
from pathlib import Path
from django.conf import settings

MODERN_KEYS = ('pbt_c512', 'pbt_c384', 'hrnet_w48', 'mask2former_swin_t')
LABELS = {'pbt_c512': 'PBT SegFormer-B2 · c512 五种子', 'pbt_c384': 'PBT SegFormer-B2 · c384 五种子（对照）',
          'hrnet_w48': 'HRNet-W48 · seed101', 'mask2former_swin_t': 'Mask2Former Swin-T · seed42',
          'm6_best': 'M6 半监督 · fold1（历史部署版）', 'resnet101': 'DeepLabV3+ ResNet-101（历史）',
          'resnet50': 'DeepLabV3+ ResNet-50（历史）', 'mobilenet': 'DeepLabV3+ MobileNet（历史）',
          'ensemble': 'DeepLab-R101 + M6 双模型投票（历史）'}


def assets_root():
    return Path(getattr(settings, 'MODERN_MODEL_ASSETS', settings.BASE_DIR / 'model_assets'))


def members(key):
    path = assets_root() / 'manifest.json'
    return [entry for entry in json.loads(path.read_text(encoding='utf-8')) if entry['key'] == key] if path.exists() else []


def unavailable_reason(key):
    if key not in LABELS:
        return '不支持的模型'
    if key in MODERN_KEYS:
        entries = members(key)
        expected = 5 if key.startswith('pbt_') else 1
        if len(entries) != expected or any(not (assets_root() / entry['file']).is_file() for entry in entries):
            return '冻结权重尚未准备完整'
        if key == 'mask2former_swin_t' and importlib.util.find_spec('transformers') is None:
            return '缺少transformers依赖'
        return None
    if key == 'ensemble':
        return unavailable_reason('resnet101') or unavailable_reason('m6_best')
    if key == 'm6_best':
        path = getattr(settings, 'M6_BEST_MODEL_PATH', '')
    else:
        path = (getattr(settings, 'DEEPLAB_MODEL_CONFIGS', {}).get(key) or {}).get('path', '')
    return None if path and Path(path).is_file() else '权重文件缺失'


def catalogue():
    return [{'id': key, 'label': label, 'available': not unavailable_reason(key), 'reason': unavailable_reason(key),
             'default': key == 'pbt_c512', 'advanced': key == 'pbt_c384',
             'legacy': key in ('resnet101', 'resnet50', 'mobilenet', 'ensemble'), 'device': 'cpu',
             'weight_source': '冻结实验记录' if key in MODERN_KEYS else '历史部署权重',
             'members': [{k: entry[k] for k in ('file', 'seed', 'sha256')} for entry in members(key)],
             'protocol': 'two-yolo-0.5/roi-black/native-pad16/argmax/no-postprocess' if key in MODERN_KEYS else 'historical-deployment',
             'note': 'M6 fold1有部署证据；没有同协议证据证明当前最优' if key == 'm6_best' else ''}
            for key, label in LABELS.items()]
