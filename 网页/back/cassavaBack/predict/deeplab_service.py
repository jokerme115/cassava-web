"""木薯采后腐烂面积预测 —— 模型推理层。

批次6 第一步从 `services.py` 拆出（原 2333 行）：模型权重定位/校验、DeepLabV3+
推理服务、TTA、掩膜后处理、模型来源说明、失败原因翻译。业务服务类（图片/任务/
权限等）仍在 `services.py`，通过 `from .deeplab_service import ...` 复用本模块。

拆分原则：代码逻辑一字未改，只搬位置；公开名字全部保留，调用方无需调整。
"""

import hashlib
import logging
import os
import shutil
import tempfile
import uuid
from collections import OrderedDict
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

@lru_cache(maxsize=16)
def _weight_digest(path, size, modified):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def describe_prediction_failure(exc):
    """把后台异常翻译成用户能读懂的一句话。

    任务失败原来统一写「请重试或联系管理员」，用户既不知道是自己选错了模型、
    内存不够，还是文件坏了；真实原因只留在服务端日志里。
    """
    message = str(exc).strip() or exc.__class__.__name__
    lowered = message.lower()
    if isinstance(exc, MemoryError) or 'out of memory' in lowered or 'cannot allocate' in lowered:
        return '任务执行失败：内存不足，请减少单次提交的图片数量后重试'
    if isinstance(exc, ValueError):
        return f'任务执行失败：{message}'
    if isinstance(exc, FileNotFoundError) or 'no such file' in lowered:
        return f'任务执行失败：找不到所需的文件（{message}），请检查图片或模型权重是否还在'
    return f'任务执行失败（{exc.__class__.__name__}）：{message[:180]}'


def prediction_provenance(model_name):
    from .model_registry import MODERN_KEYS, members, assets_root
    if model_name in MODERN_KEYS:
        entries = members(model_name)
        if len(entries) != (5 if model_name.startswith('pbt_') else 1):
            raise ValueError('冻结模型成员不完整')
        files = []
        for entry in entries:
            path = assets_root() / entry['file']
            actual = _weight_digest(str(path), path.stat().st_size, path.stat().st_mtime_ns)
            if actual != entry['sha256']:
                raise ValueError('冻结权重哈希不一致')
            files.append({'file': path.name, 'sha256': actual, 'seed': entry['seed']})
        for name in ('yolov11(1).pt', 'yolov11(2).pt'):
            path = settings.BASE_DIR.parent / 'model' / name
            if not path.is_file():
                raise ValueError('定位权重缺失')
            files.append({'file': name, 'sha256': _weight_digest(str(path), path.stat().st_size, path.stat().st_mtime_ns)})
        return files
    if model_name == 'ensemble':
        files = [item for member in MEMBERS for item in prediction_provenance(member)]
        return list({item['file']: item for item in files}.values())
    if model_name == 'm6_best':
        path = getattr(settings, 'M6_BEST_MODEL_PATH', None)
    else:
        config = getattr(settings, 'DEEPLAB_MODEL_CONFIGS', {}).get(model_name)
        if not config:
            raise ValueError('不支持的预测模型')
        path = config.get('path')
    resolved = resolve_existing_model_path(path)
    if not resolved:
        raise ValueError('所选模型权重不存在，无法开始任务')
    paths = [Path(resolved), settings.BASE_DIR.parent / 'model' / 'yolov11(1).pt',
             settings.BASE_DIR.parent / 'model' / 'yolov11(2).pt']
    return [{'file': item.name, 'sha256': _weight_digest(str(item), item.stat().st_size, item.stat().st_mtime_ns)}
            for item in paths if item.is_file()]


def post_process_mask(mask, min_area=100, morph_kernel_size=5, morph_iterations=1):
    """
    对预测掩码进行后处理，提高分割结果的准确性和可用性

    执行以下操作序列：
    1. 二值化转换确保掩码为0-1值
    2. 连通区域分析并移除小于最小面积阈值的区域
    3. 形态学闭运算填充区域内部小孔
    4. 形态学开运算去除小噪点
    5. 填充剩余孔洞确保区域完整性

    Args:
        mask (np.ndarray): 输入二值掩码，0表示背景，1表示目标区域
        min_area (int): 最小连通区域面积阈值（像素），小于此值的区域将被移除，默认100
        morph_kernel_size (int): 形态学操作内核大小，默认5
        morph_iterations (int): 形态学操作迭代次数，默认1

    Returns:
        np.ndarray: 后处理完成的二值掩码，0表示背景，1表示目标区域
    """
    # 转换为二值掩码确保数据类型正确
    binary_mask = mask.astype(np.uint8)
    
    # 去除小区域
    if min_area > 0:
        # 标记连通区域
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_mask, connectivity=8)

        # 对每个连通区域进行检查（跳过背景，即标签0）
        for i in range(1, num_labels):
            if stats[i, cv2.CC_STAT_AREA] < min_area:
                binary_mask[labels == i] = 0

    # 形态学操作
    if morph_kernel_size > 0 and morph_iterations > 0:
        kernel = np.ones((morph_kernel_size, morph_kernel_size), np.uint8)
        # 先闭运算（填充小孔）
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel, iterations=morph_iterations)
        # 再开运算（移除小噪点）
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel, iterations=morph_iterations)
    
    return binary_mask


# TTA预测函数
def tta_predict(model, image, device):
    """
    使用测试时增强（TTA）进行预测
    
    Args:
        model: 深度学习模型
        image: 输入图像张量
        device: 计算设备
        
    Returns:
        增强后的预测结果
    """
    # 原始预测
    outputs = model(image)
    
    # 水平翻转
    flipped = torch.flip(image, dims=[3])
    outputs_flipped = model(flipped)
    outputs_flipped = torch.flip(outputs_flipped, dims=[3])
    
    # 垂直翻转
    v_flipped = torch.flip(image, dims=[2])
    outputs_v_flipped = model(v_flipped)
    outputs_v_flipped = torch.flip(outputs_v_flipped, dims=[2])
    
    # 合并预测结果（平均）
    outputs_combined = (outputs + outputs_flipped + outputs_v_flipped) / 3.0
    
    return outputs_combined

def resolve_existing_model_path(model_path):
    """
    解析模型路径并返回真实存在的绝对路径。

    Args:
        model_path (str): 初始模型文件路径

    Returns:
        str or None: 有效模型权重文件的绝对路径，若不存在则返回None
    """
    if not model_path:
        return None

    candidate_paths = []
    if os.path.isabs(model_path):
        candidate_paths.append(model_path)
    else:
        candidate_paths.append(model_path)
        candidate_paths.append(os.path.abspath(model_path))

    model_filename = os.path.basename(model_path)
    if model_filename:
        candidate_paths.append(os.path.join(settings.BASE_DIR.parent, 'model', model_filename))

    seen_paths = set()
    for candidate in candidate_paths:
        if not candidate:
            continue
        normalized_candidate = os.path.abspath(candidate)
        if normalized_candidate in seen_paths:
            continue
        seen_paths.add(normalized_candidate)
        if os.path.exists(normalized_candidate):
            return normalized_candidate

    return None


def check_model_path(model_path, fallback_paths=None):
    """
    获取模型权重文件路径，并在需要时按给定候选路径安全回退。

    注意：
    - 该函数只做“路径存在性解析”，不会把一种模型架构错误回退到另一种架构。
    - DeepLab 的模型选择逻辑在 DeepLabV3PlusService 内部统一处理。
    """
    resolved_path = resolve_existing_model_path(model_path)
    if resolved_path:
        logger.info(f"模型文件存在: {resolved_path}")
        return resolved_path

    if model_path:
        logger.error(f"模型文件不存在: {model_path}")
    else:
        logger.error("模型文件不存在: None")

    for fallback_path in fallback_paths or []:
        resolved_fallback = resolve_existing_model_path(fallback_path)
        if resolved_fallback:
            logger.warning(f"请求模型不可用，已回退到备用模型: {resolved_fallback}")
            return resolved_fallback

    return None

class DeepLabV3PlusService:
    """
    DeepLabV3+模型服务类，负责木薯疾病图像分割的核心逻辑实现

    支持多种骨干网络架构(ResNet50, ResNet101, MobileNet)，提供模型加载、预测
    及结果处理的完整功能。采用模型缓存机制确保资源高效利用，并支持多模型集成。
    """
    def __init__(self):
        """
        初始化DeepLabV3+模型服务实例

        自动选择可用计算设备(GPU/CPU)，初始化模型缓存字典，并根据硬件环境
        优化设置批处理大小：GPU环境下为4，CPU环境下为2以保证处理效率。
        """
        self.device = self._resolve_device()
        self.models = {}
        
        # 设置批处理大小
        if self.device.type == 'cuda':
            self.batch_size = 4
        else:
            self.batch_size = 2

    @staticmethod
    def _resolve_device():
        if torch.cuda.is_available():
            try:
                torch.zeros(1, device='cuda')
                return torch.device('cuda')
            except Exception:
                logger.warning("CUDA 当前不可用，预测服务自动回退到 CPU。")
        return torch.device('cpu')

    @staticmethod
    def _normalize_deeplab_model_key(value):
        normalized = (value or '').strip().lower()
        if 'mobilenet' in normalized:
            return 'mobilenet'
        if 'resnet101' in normalized:
            return 'resnet101'
        if 'resnet50' in normalized:
            return 'resnet50'
        return normalized

    @classmethod
    def _get_deeplab_model_configs(cls):
        configs = getattr(settings, 'DEEPLAB_MODEL_CONFIGS', None)
        if isinstance(configs, dict) and configs:
            return configs
        return {
            'resnet50': {
                'path': getattr(settings, 'DEEPLABV3_RESNET50_PATH', None),
                'model_type': 'deeplabv3plus_resnet50',
            },
            'resnet101': {
                'path': getattr(settings, 'DEEPLABV3_RESNET101_PATH', None),
                'model_type': 'deeplabv3plus_resnet101',
            },
            'mobilenet': {
                'path': getattr(settings, 'DEEPLABV3_MOBILENET_PATH', None),
                'model_type': 'deeplabv3plus_mobilenet',
            },
        }

    @classmethod
    def _resolve_deeplab_model_choice(cls, requested_key=None, model_path=None):
        configs = cls._get_deeplab_model_configs()
        normalized_key = cls._normalize_deeplab_model_key(requested_key)
        default_key = cls._normalize_deeplab_model_key(
            getattr(settings, 'DEFAULT_DEEPLAB_MODEL_KEY', 'resnet101')
        )
        if default_key not in configs:
            default_key = 'resnet101'

        path_to_key = {}
        for key, config in configs.items():
            resolved_config_path = resolve_existing_model_path(config.get('path'))
            if resolved_config_path:
                path_to_key[resolved_config_path] = key

        requested_resolved_path = resolve_existing_model_path(model_path)
        if requested_resolved_path:
            matched_key = path_to_key.get(requested_resolved_path)
            return {
                'key': matched_key or (normalized_key if normalized_key in configs else default_key),
                'path': requested_resolved_path,
            }

        fallback_keys = []
        for key in [normalized_key, default_key, 'resnet101', 'resnet50', 'mobilenet']:
            if key in configs and key not in fallback_keys:
                fallback_keys.append(key)
        for key in configs.keys():
            if key not in fallback_keys:
                fallback_keys.append(key)

        for key in fallback_keys:
            resolved_fallback = resolve_existing_model_path(configs[key].get('path'))
            if resolved_fallback:
                if normalized_key and normalized_key != key:
                    logger.warning(f"请求的 DeepLab 模型 {normalized_key} 不可用，已回退到 {key}: {resolved_fallback}")
                return {
                    'key': key,
                    'path': resolved_fallback,
                }

        return {
            'key': normalized_key if normalized_key in configs else default_key,
            'path': None,
        }

    def _run_yolo_inference(self, model, image_path, confidence_threshold=0.5):
        preferred_device = 0 if self.device.type == 'cuda' else 'cpu'
        try:
            return model(image_path, conf=confidence_threshold, save=False, device=preferred_device)
        except Exception as exc:
            if preferred_device != 'cpu':
                logger.warning(f"YOLO GPU 推理失败，自动回退 CPU: {exc}")
                return model(image_path, conf=confidence_threshold, save=False, device='cpu')
            raise

    @staticmethod
    def _resolve_yolo_class():
        try:
            from ultralytics import YOLO  # type: ignore
            return YOLO
        except ModuleNotFoundError:
            import sys
            fallback_roots = [
                Path(r"C:\Users\Administrator\Desktop\work\02_农业研究\木薯图像分割\结果\对比实验\yolov12-main\yolov12-main"),
            ]
            for root in fallback_roots:
                ultralytics_dir = root / "ultralytics"
                if root.exists() and ultralytics_dir.exists():
                    root_str = str(root)
                    if root_str not in sys.path:
                        sys.path.insert(0, root_str)
                    try:
                        from ultralytics import YOLO  # type: ignore
                        logger.warning(f"ultralytics 未安装，已回退到本地 YOLO 代码目录: {root_str}")
                        return YOLO
                    except ModuleNotFoundError:
                        continue
            raise

    @staticmethod
    def _compute_iou(box_a, box_b):
        x1 = max(box_a[0], box_b[0])
        y1 = max(box_a[1], box_b[1])
        x2 = min(box_a[2], box_b[2])
        y2 = min(box_a[3], box_b[3])
        inter_w = max(0.0, x2 - x1)
        inter_h = max(0.0, y2 - y1)
        inter_area = inter_w * inter_h
        if inter_area <= 0:
            return 0.0

        area_a = max(0.0, box_a[2] - box_a[0]) * max(0.0, box_a[3] - box_a[1])
        area_b = max(0.0, box_b[2] - box_b[0]) * max(0.0, box_b[3] - box_b[1])
        union_area = area_a + area_b - inter_area
        if union_area <= 0:
            return 0.0
        return inter_area / union_area

    def _deduplicate_boxes(self, boxes, iou_threshold=0.50):
        sorted_boxes = sorted(boxes, key=lambda item: item[4], reverse=True)
        kept = []
        for candidate in sorted_boxes:
            if all(self._compute_iou(candidate[:4], existing[:4]) < iou_threshold for existing in kept):
                kept.append(candidate)
        return kept

    @staticmethod
    def _clip_box_to_image(box, width, height):
        x1, y1, x2, y2 = box[:4]
        x1 = max(0, int(round(x1)))
        y1 = max(0, int(round(y1)))
        x2 = min(width, int(round(x2)))
        y2 = min(height, int(round(y2)))
        if x2 <= x1 or y2 <= y1:
            return None
        return [x1, y1, x2, y2]

    @staticmethod
    def _save_rgb_crop(crop_rgb, output_dir, prefix):
        filename = f"{prefix}_{uuid.uuid4()}.png"
        filepath = os.path.join(output_dir, filename)
        cv2.imwrite(filepath, cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR))
        return filepath

    def _build_full_image_segment(self, image_path, output_dir):
        full_img_filename = f"seg1_full_{os.path.basename(image_path)}"
        full_img_path = os.path.join(output_dir, full_img_filename)
        shutil.copy2(image_path, full_img_path)
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError("无法读取图片")
        height, width = img.shape[:2]
        return {
            "id": "full_image",
            "image_path": full_img_path,
            "bbox": [0, 0, width, height],
            "crop_bbox": [0, 0, width, height],
            "confidence": 1.0,
        }

    @staticmethod
    def _is_probable_single_subimage(stage1_segments, image_shape):
        if not stage1_segments:
            return False
        if len(stage1_segments) != 1:
            return False

        height, width = image_shape[:2]
        bbox = stage1_segments[0].get("bbox") or [0, 0, width, height]
        box_w = max(1, bbox[2] - bbox[0])
        box_h = max(1, bbox[3] - bbox[1])
        area_ratio = (box_w * box_h) / max(1, width * height)
        width_ratio = box_w / max(1, width)
        height_ratio = box_h / max(1, height)
        return area_ratio >= 0.45 or width_ratio >= 0.65 or height_ratio >= 0.65
    
    def load_yolo_model(self, model_path):
        """
        加载YOLOv11模型
        
        Args:
            model_path: 模型权重文件路径
            
        Returns:
            加载的YOLOv11模型
        """
        try:
            YOLO = self._resolve_yolo_class()
            # 检查模型路径
            model_path = check_model_path(model_path)
            if not model_path or not os.path.exists(model_path):
                logger.error(f"模型文件不存在: {model_path}")
                return None
            
            # 加载模型
            model = YOLO(model_path)
            logger.info(f"成功加载YOLO模型: {model_path}")
            return model
        except ModuleNotFoundError:
            logger.error(
                "加载YOLO模型失败: No module named 'ultralytics'。"
                "请安装 back/requirements.txt，或确保本地 YOLO 代码目录可用。"
            )
            return None
        except Exception as e:
            logger.error(f"加载YOLO模型失败: {e}")
            return None
    
    @staticmethod
    def _model_cache_key(model_path):
        """模型缓存键 = 路径 + mtime + 文件大小。

        只用路径做键时，替换权重文件必须重启进程才会生效；把 mtime 与大小
        带上，下一次预测就会自动加载新权重。
        """
        try:
            stat = os.stat(model_path)
            return (model_path, stat.st_mtime_ns, stat.st_size)
        except OSError:
            return (model_path, None, None)

    def load_model(self, model_path, model_type='deeplabv3plus_resnet50'):
        """
        加载DeepLabV3+模型，支持多种骨干网络架构

        实现智能模型加载机制，包括：
        1. 路径验证与自动查找
        2. 模型架构自动识别
        3. 权重兼容性检查与修复
        4. 设备迁移与评估模式设置
        5. 批归一化层优化处理

        Args:
            model_path (str): 模型权重文件路径
            model_type (str): 模型类型标识，决定骨干网络架构

        Returns:
            torch.nn.Module: 加载并初始化完成的模型实例

        Raises:
            FileNotFoundError: 模型文件不存在
            Exception: 模型加载过程中的其他错误

        Note:
            - 支持resnet50/resnet101/mobilenet等多种骨干网络
            - 自动处理权重键名不匹配问题
            - 优化批归一化层以提升推理稳定性
        """
        try:
            model_choice = self._resolve_deeplab_model_choice(
                requested_key=self._normalize_deeplab_model_key(model_type),
                model_path=model_path,
            )
            model_path = model_choice['path']
            if not model_path or not os.path.exists(model_path):
                raise FileNotFoundError(f"模型文件不存在: {model_path}")

            # 检查模型是否已缓存（键里带 mtime 与大小，替换权重后会自动重新加载）
            cache_key = self._model_cache_key(model_path)
            if cache_key in self.models:
                logger.info(f"从缓存加载模型: {model_path}")
                return self.models[cache_key]

            lower_path = model_path.lower()
            if 'resnet50' in lower_path:
                model_type = 'deeplabv3plus_resnet50' if 'plus' in model_type else 'deeplabv3_resnet50'
            elif 'resnet101' in lower_path:
                model_type = 'deeplabv3plus_resnet101' if 'plus' in model_type else 'deeplabv3_resnet101'
            elif 'resnet18' in lower_path:
                model_type = 'deeplabv3plus_resnet18' if 'plus' in model_type else 'deeplabv3_resnet50'
            elif 'resnet34' in lower_path:
                model_type = 'deeplabv3plus_resnet34' if 'plus' in model_type else 'deeplabv3_resnet50'
            elif 'resnet152' in lower_path:
                model_type = 'deeplabv3plus_resnet152' if 'plus' in model_type else 'deeplabv3_resnet101'
            elif 'mobilenet' in lower_path:
                model_type = 'deeplabv3plus_mobilenet' if 'plus' in model_type else 'deeplabv3_mobilenet'
            elif 'xception' in lower_path:
                model_type = 'deeplabv3plus_xception' if 'plus' in model_type else 'deeplabv3_xception'

            logger.info(f"开始加载模型: {model_path}")

            checkpoint = torch.load(model_path, map_location='cpu', weights_only=False)
            checkpoint_state = checkpoint.get("model_state", checkpoint)
            use_attention = any('cbam' in key.lower() for key in checkpoint_state.keys())
            if use_attention:
                logger.info("检测到 CBAM 权重，自动启用注意力版 DeepLab 架构。")
            
            # 确定模型架构参数
            if 'resnet18' in model_type:
                from network.backbone import resnet
                backbone = resnet.resnet18(pretrained=False)
                inplanes = 512
                low_level_planes = 64
            elif 'resnet34' in model_type:
                from network.backbone import resnet
                backbone = resnet.resnet34(pretrained=False)
                inplanes = 512
                low_level_planes = 64
            elif 'resnet50' in model_type:
                from network.backbone import resnet
                backbone = resnet.resnet50(pretrained=False)
                inplanes = 2048
                low_level_planes = 256
            elif 'resnet101' in model_type:
                from network.backbone import resnet
                backbone = resnet.resnet101(pretrained=False)
                inplanes = 2048
                low_level_planes = 256
            elif 'resnet152' in model_type:
                from network.backbone import resnet
                backbone = resnet.resnet152(pretrained=False)
                inplanes = 2048
                low_level_planes = 256
            elif 'mobilenet' in model_type:
                from network.backbone import mobilenetv2
                backbone = mobilenetv2.mobilenet_v2(pretrained=False)
                inplanes = 1280
                low_level_planes = 24
            elif 'hrnetv2' in model_type:
                from network.backbone import hrnetv2
                backbone_name = model_type.split('_')[-1]  # 获取hrnetv2_32中的32
                backbone = hrnetv2.__dict__[f'hrnetv2_{backbone_name}'](pretrained=False)
                hrnet_channels = int(backbone_name)
                inplanes = 15 * hrnet_channels
                low_level_planes = 256
            elif 'xception' in model_type:
                from network.backbone import xception
                backbone = xception.xception(pretrained=False)
                inplanes = 2048
                low_level_planes = 128
            else:
                # 默认使用ResNet-50
                from network.backbone import resnet
                backbone = resnet.resnet50(pretrained=False)
                inplanes = 2048
                low_level_planes = 256
            
            from network import modeling
            if 'plus' in model_type:
                if 'resnet50' in model_type:
                    model = modeling.deeplabv3plus_resnet50(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'resnet18' in model_type:
                    model = modeling.deeplabv3plus_resnet18(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'resnet34' in model_type:
                    model = modeling.deeplabv3plus_resnet34(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'resnet152' in model_type:
                    model = modeling.deeplabv3plus_resnet152(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'mobilenet' in model_type:
                    model = modeling.deeplabv3plus_mobilenet(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'xception' in model_type:
                    model = modeling.deeplabv3plus_xception(num_classes=2, output_stride=16, use_attention=use_attention)
                else:
                    model = modeling.deeplabv3plus_resnet101(num_classes=2, output_stride=16, use_attention=use_attention)
            else:
                if 'resnet50' in model_type:
                    model = modeling.deeplabv3_resnet50(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'mobilenet' in model_type:
                    model = modeling.deeplabv3_mobilenet(num_classes=2, output_stride=16, use_attention=use_attention)
                elif 'xception' in model_type:
                    model = modeling.deeplabv3_xception(num_classes=2, output_stride=16, use_attention=use_attention)
                else:
                    model = modeling.deeplabv3_resnet101(num_classes=2, output_stride=16, use_attention=use_attention)
            
            # 尝试加载模型权重，如果出现键不匹配则忽略严格模式
            try:
                model.load_state_dict(checkpoint_state, strict=True)
            except Exception as e:
                logger.warning(f"严格模式加载模型权重失败: {e}")
                logger.info("尝试非严格模式加载模型权重...")
                try:
                    model.load_state_dict(checkpoint_state, strict=False)
                    logger.info("非严格模式加载模型权重成功")
                except Exception as e2:
                    logger.error(f"非严格模式加载模型权重也失败: {e2}")
                    raise
            
            model.to(self.device)
            model.eval()
            
            # 修复批归一化层
            for m in model.modules():
                if isinstance(m, nn.BatchNorm2d):
                    m.eval()
                    m.track_running_stats = False
            
            # 缓存模型
            self.models[cache_key] = model
            
            logger.info(f"成功加载模型: {model_path}")
            return model
            
        except Exception as e:
            logger.error(f"加载模型失败: {e}")
            raise
    
    def load_ensemble_models(self, model_paths=None):
        """
        加载多个DeepLabV3+模型用于集成学习

        Args:
            model_paths (List[str], optional): 要加载的模型路径列表，默认为None时使用设置中的模型列表

        Returns:
            List[torch.nn.Module]: 加载好的模型列表，按指定顺序排列
        """
        if model_paths is None:
            model_paths = getattr(settings, 'ENSEMBLE_MODELS', None)
            if not model_paths:
                model_paths = [
                    settings.DEEPLABV3_RESNET50_PATH,
                    settings.DEEPLABV3_RESNET101_PATH,
                    settings.DEEPLABV3_MOBILENET_PATH
                ]

        resolved_choices = []
        seen_paths = set()
        for path in model_paths or []:
            model_choice = self._resolve_deeplab_model_choice(model_path=path)
            resolved_path = model_choice['path']
            if not resolved_path:
                if path:
                    logger.warning(f"跳过不存在的集成模型: {path}")
                continue
            if resolved_path in seen_paths:
                logger.info(f"跳过重复的集成模型: {resolved_path}")
                continue
            seen_paths.add(resolved_path)
            resolved_choices.append(model_choice)

        if not resolved_choices:
            raise FileNotFoundError("没有可用的 DeepLab 集成模型")

        # 清理已存在的模型（缓存键是 (路径, mtime, 大小) 三元组，按路径比对）
        for cache_key in list(self.models.keys()):
            cached_path = cache_key[0] if isinstance(cache_key, tuple) else cache_key
            if cached_path not in seen_paths:
                # 从缓存中移除不需要的模型
                del self.models[cache_key]
        
        loaded_models = []
        # 加载所有模型
        for choice in resolved_choices:
            model_type = self._get_deeplab_model_configs().get(
                choice['key'],
                {}
            ).get('model_type', 'deeplabv3plus_resnet101')

            # 加载模型
            model = self.load_model(choice['path'], model_type=model_type)
            loaded_models.append(model)
        
        return loaded_models
    
    def preprocess_image(self, image_path):
        """
        图像预处理流水线，将原始图像转换为模型输入格式

        执行完整的预处理步骤：
        1. 图像读取：支持文件路径和字节流两种输入方式
        2. 色彩空间标准化：转换为RGB格式并保留原始图像副本
        3. 尺寸调整：统一缩放到513x513标准输入尺寸
        4. 像素值标准化：应用ImageNet均值和标准差进行归一化
        5. 张量转换：转换为PyTorch张量格式并添加批次维度

        Args:
            image_path (Union[str, BytesIO]): 图像输入源，可以是文件路径字符串或字节流对象

        Returns:
            Tuple[torch.Tensor, np.ndarray]:
                - 预处理后的图像张量，形状为(1, 3, 513, 513)，已移至指定计算设备
                - 原始RGB图像数组，保持输入图像的原始尺寸和色彩信息

        Raises:
            IOError: 当图像读取失败时抛出
            Exception: 预处理过程中发生的其他错误

        Note:
            - 采用双线性插值进行尺寸调整，平衡质量与效率
            - 标准化参数与训练时保持一致(ImageNet均值和标准差)
            - 所有预处理操作在CPU上执行以节省GPU内存
        """
        try:
            # 读取图像，支持文件路径和字节流两种输入
            if isinstance(image_path, str):
                image = ImageOps.exif_transpose(Image.open(image_path)).convert('RGB')
                original_image = np.array(image)
            else:
                # 处理BytesIO对象（如上传文件）
                image = ImageOps.exif_transpose(Image.open(image_path)).convert('RGB')
                original_image = np.array(image)
            
            # 转换为numpy数组进行后续处理
            image_np = np.array(image)
            
            # 创建预处理转换管道
            transform = A.Compose([
                A.Resize(height=513, width=513, interpolation=cv2.INTER_LINEAR),  # 调整尺寸至模型输入大小
                A.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225))  # ImageNet标准化参数
            ])
            
            # 应用转换
            augmented = transform(image=image_np)
            # 转换为PyTorch张量格式 (B, C, H, W)
            image_tensor = torch.from_numpy(augmented['image']).permute(2, 0, 1).unsqueeze(0).float()
            
            # 将张量移至指定计算设备并返回
            return image_tensor.to(self.device), original_image
            
        except Exception as e:
            logger.error(f"图像预处理失败: {e}", exc_info=True)
            raise
    
    def perform_segmentation(self, model, image_path, confidence_threshold=0.5, use_tta=False):
        """
        执行木薯叶片图像分割预测，支持测试时数据增强(TTA)以提升结果稳健性

        完整处理流程：
        1. 图像预处理：标准化、尺寸调整和张量转换
        2. 推理执行：根据use_tta标志选择普通推理或TTA增强推理
        3. 输出后处理：置信度阈值过滤、二值化和尺寸恢复
        4. 结果返回：生成最终分割掩码和原始图像

        Args:
            model: DeepLabV3Plus模型实例，已加载权重并设置为评估模式
            image_path (Union[str, BytesIO]): 图像路径或字节流对象
            confidence_threshold (float): 分割置信度阈值，默认0.5
            use_tta (bool): 是否启用测试时数据增强，默认False
                            TTA通过水平翻转、垂直翻转组合提升预测稳定性

        Returns:
            Tuple[np.ndarray, np.ndarray]: 
                - 二值分割掩码，0表示背景，1表示病变区域，尺寸与输入图像一致
                - 原始图像的numpy数组，保持输入图像的尺寸和通道信息

        Note:
            - TTA模式下推理时间约增加3倍，但可提升分割边界准确性约5-8%
            - 所有操作均在torch.no_grad()上下文下执行以减少内存占用
            - 输出掩码自动匹配输入图像尺寸，采用最近邻插值法进行大小调整
        """
        try:
            # 图像预处理：标准化、维度调整和设备迁移
            image_tensor, original_image = self.preprocess_image(image_path)
            
            # 推理阶段：禁用梯度计算以优化性能
            with torch.no_grad():
                if use_tta:
                    # TTA推理：多变换组合预测提升结果稳健性
                    output = tta_predict(model, image_tensor, self.device)
                else:
                    # 常规推理：单次前向传播
                    output = model(image_tensor)
                
                # 概率计算：应用softmax获取类别概率分布
                prob = torch.softmax(output, dim=1)
                # 提取目标类别概率图（腐烂类）并转换为numpy数组
                prob_rot = prob[0, 1].cpu().numpy()
                
                # 阈值处理：应用置信度阈值生成二值掩码
                pred = (prob_rot > confidence_threshold).astype(np.uint8)
            
            # 尺寸恢复：将掩码调整为原始图像尺寸
            h, w = original_image.shape[:2]
            pred_resized = cv2.resize(pred, (w, h), interpolation=cv2.INTER_NEAREST)
            
            return pred_resized, original_image
            
        except Exception as e:
            logger.error(f"执行分割失败: {e}")
            raise
    
    def first_segmentation(self, model, image_path, output_dir, confidence_threshold=0.5, roi_padding=0.10, iou_threshold=0.50):
        """
        执行第一次分割
        
        Args:
            model: YOLO模型或DeepLabV3+模型
            image_path: 图像路径
            output_dir: 输出目录
            confidence_threshold: 置信度阈值
            
        Returns:
            dict: 分割结果
        """
        try:
            # 确保输出目录存在
            os.makedirs(output_dir, exist_ok=True)
            
            # 使用YOLO进行第一次分割
            results = self._run_yolo_inference(model, image_path, confidence_threshold)
            
            segments = []
            if results and len(results) > 0:
                boxes = results[0].boxes
                img = cv2.imread(image_path)
                if img is None:
                    logger.error(f"读取图片失败: {image_path}")
                    return {"error": "无法读取图片"}
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                height, width = img_rgb.shape[:2]

                raw_boxes = []
                if boxes is not None:
                    for i, box in enumerate(boxes.xyxy):
                        x1, y1, x2, y2 = [float(v) for v in box.cpu().numpy()]
                        raw_boxes.append([x1, y1, x2, y2, float(boxes.conf[i].cpu().numpy())])

                dedup_boxes = self._deduplicate_boxes(raw_boxes, iou_threshold=iou_threshold)

                for x1, y1, x2, y2, conf in dedup_boxes:
                    clipped_box = self._clip_box_to_image([x1, y1, x2, y2], width, height)
                    if not clipped_box:
                        continue

                    raw_x1, raw_y1, raw_x2, raw_y2 = clipped_box
                    box_w = raw_x2 - raw_x1
                    box_h = raw_y2 - raw_y1
                    pad_x = box_w * roi_padding
                    pad_y = box_h * roi_padding

                    crop_box = self._clip_box_to_image(
                        [raw_x1 - pad_x, raw_y1 - pad_y, raw_x2 + pad_x, raw_y2 + pad_y],
                        width,
                        height,
                    )
                    if not crop_box:
                        continue

                    crop_x1, crop_y1, crop_x2, crop_y2 = crop_box
                    cut_img = img_rgb[crop_y1:crop_y2, crop_x1:crop_x2].copy()
                    if cut_img.size == 0:
                        logger.warning(f"第一次分割得到空子图: {image_path}")
                        continue

                    filepath = self._save_rgb_crop(cut_img, output_dir, "seg1")
                    segments.append({
                        "id": str(uuid.uuid4()),
                        "image_path": filepath,
                        "bbox": [raw_x1, raw_y1, raw_x2, raw_y2],
                        "crop_bbox": [crop_x1, crop_y1, crop_x2, crop_y2],
                        "confidence": conf
                    })
            
            return {
                "segments": segments,
                "count": len(segments)
            }
            
        except Exception as e:
            logger.error(f"第一次分割失败: {e}")
            return {"error": str(e)}
    
    def second_segmentation(self, model, image_path, output_dir, confidence_threshold=0.5, min_area=100):
        """
        执行第二次分割
        
        Args:
            model: YOLO模型
            image_path: 图像路径
            output_dir: 输出目录
            confidence_threshold: 置信度阈值
            min_area: 最小区域面积
            
        Returns:
            dict: 分割结果
        """
        try:
            # 确保输出目录存在
            os.makedirs(output_dir, exist_ok=True)
            
            # 使用YOLO进行第二次分割
            results = self._run_yolo_inference(model, image_path, confidence_threshold)
            
            segments = []
            if results and len(results) > 0:
                boxes = results[0].boxes
                # 读取图像
                img = cv2.imread(image_path)
                if img is None:
                    logger.error(f"读取图片失败: {image_path}")
                    return {"error": "无法读取图片"}
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                
                for i, box in enumerate(boxes.xyxy):
                    x1, y1, x2, y2 = map(int, box.cpu().numpy())
                    # 确保坐标在图像范围内
                    x1, x2 = max(0, x1), min(img_rgb.shape[1], x2)
                    y1, y2 = max(0, y1), min(img_rgb.shape[0], y2)
                    
                    # 裁剪图像
                    cut_img = img_rgb[y1:y2, x1:x2].copy()
                    if cut_img.size == 0:
                        logger.warning(f"第二次分割得到空子图: {image_path}")
                        continue
                    
                    # 检查区域大小
                    area = (x2 - x1) * (y2 - y1)
                    if area >= min_area:
                        # 保存裁剪后的图像
                        filename = f"seg2_{uuid.uuid4()}.png"
                        filepath = os.path.join(output_dir, filename)
                        cv2.imwrite(filepath, cv2.cvtColor(cut_img, cv2.COLOR_RGB2BGR))
                        
                        segments.append({
                            "id": str(uuid.uuid4()),
                            "image_path": filepath,
                            "bbox": [x1, y1, x2, y2],
                            "confidence": float(boxes.conf[i].cpu().numpy()),
                            "area": area
                        })
            
            return {
                "segments": segments,
                "count": len(segments)
            }
            
        except Exception as e:
            logger.error(f"第二次分割失败: {e}")
            return {"error": str(e)}
    
    def _run_second_stage_pass(self, image_rgb, stage1_segments, model, confidence_threshold=0.25, roi_padding=0.10, iou_threshold=0.50):
        height, width = image_rgb.shape[:2]
        global_boxes = []

        for seg1_result in stage1_segments:
            bbox = seg1_result.get("bbox")
            if not bbox or len(bbox) < 4:
                continue

            x1, y1, x2, y2 = bbox[:4]
            box_w = x2 - x1
            box_h = y2 - y1
            pad_x = box_w * roi_padding
            pad_y = box_h * roi_padding
            crop_box = self._clip_box_to_image(
                [x1 - pad_x, y1 - pad_y, x2 + pad_x, y2 + pad_y],
                width,
                height,
            )
            if not crop_box:
                continue

            crop_x1, crop_y1, crop_x2, crop_y2 = crop_box
            crop = image_rgb[crop_y1:crop_y2, crop_x1:crop_x2]
            if crop.size == 0:
                continue

            results = self._run_yolo_inference(model, crop, confidence_threshold)
            if not results or len(results) == 0 or results[0].boxes is None:
                continue

            for fine_box in results[0].boxes:
                fx1, fy1, fx2, fy2 = [float(v) for v in fine_box.xyxy[0].tolist()]
                conf = float(fine_box.conf[0])
                global_boxes.append({
                    "parent_id": seg1_result.get("id"),
                    "box": [fx1 + crop_x1, fy1 + crop_y1, fx2 + crop_x1, fy2 + crop_y1, conf],
                })

        deduped = []
        for candidate in sorted(global_boxes, key=lambda item: item["box"][4], reverse=True):
            if all(
                self._compute_iou(candidate["box"][:4], existing["box"][:4]) < iou_threshold
                for existing in deduped
            ):
                deduped.append(candidate)
        return deduped

    def refine_second_segmentation(
        self,
        model,
        original_image_path,
        stage1_segments,
        output_dir,
        confidence_threshold=0.25,
        min_area=100,
        roi_padding=0.10,
        fallback_roi_padding=0.70,
        expected_count=0,
        iou_threshold=0.50,
    ):
        try:
            os.makedirs(output_dir, exist_ok=True)
            img = cv2.imread(original_image_path)
            if img is None:
                return {"error": "无法读取图片"}
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            height, width = img_rgb.shape[:2]

            base_candidates = self._run_second_stage_pass(
                image_rgb=img_rgb,
                stage1_segments=stage1_segments,
                model=model,
                confidence_threshold=confidence_threshold,
                roi_padding=roi_padding,
                iou_threshold=iou_threshold,
            )
            final_candidates = base_candidates

            if stage1_segments and len(base_candidates) < max(1, expected_count) and fallback_roi_padding > roi_padding:
                fallback_candidates = self._run_second_stage_pass(
                    image_rgb=img_rgb,
                    stage1_segments=stage1_segments,
                    model=model,
                    confidence_threshold=confidence_threshold,
                    roi_padding=fallback_roi_padding,
                    iou_threshold=iou_threshold,
                )
                if len(fallback_candidates) >= len(base_candidates):
                    final_candidates = fallback_candidates

            suspected_single = self._is_probable_single_subimage(stage1_segments, img_rgb.shape)
            if suspected_single and len(final_candidates) >= 2:
                suspected_single = False
            if suspected_single and len(final_candidates) > 1:
                final_candidates = sorted(final_candidates, key=lambda item: item["box"][4], reverse=True)[:1]
            elif expected_count and len(final_candidates) > expected_count:
                final_candidates = sorted(final_candidates, key=lambda item: item["box"][4], reverse=True)[:expected_count]

            segments = []
            for item in final_candidates:
                x1, y1, x2, y2, conf = item["box"]
                clipped_box = self._clip_box_to_image([x1, y1, x2, y2], width, height)
                if not clipped_box:
                    continue
                crop_x1, crop_y1, crop_x2, crop_y2 = clipped_box
                area = (crop_x2 - crop_x1) * (crop_y2 - crop_y1)
                if area < min_area:
                    continue
                cut_img = img_rgb[crop_y1:crop_y2, crop_x1:crop_x2].copy()
                if cut_img.size == 0:
                    continue
                filepath = self._save_rgb_crop(cut_img, output_dir, "seg2")
                segments.append({
                    "id": str(uuid.uuid4()),
                    "image_path": filepath,
                    "bbox": [crop_x1, crop_y1, crop_x2, crop_y2],
                    "confidence": conf,
                    "area": area,
                    "parent_id": item.get("parent_id"),
                })

            if not segments:
                fallback_segments = []
                for seg1_result in stage1_segments:
                    seg1_image_path = seg1_result.get("image_path")
                    if not seg1_image_path or not os.path.exists(seg1_image_path):
                        continue
                    fallback_img = cv2.imread(seg1_image_path)
                    if fallback_img is None:
                        continue
                    fh, fw = fallback_img.shape[:2]
                    fallback_segments.append({
                        "id": str(uuid.uuid4()),
                        "image_path": seg1_image_path,
                        "bbox": seg1_result.get("bbox") or [0, 0, fw, fh],
                        "confidence": float(seg1_result.get("confidence", 1.0)),
                        "area": fw * fh,
                        "parent_id": seg1_result.get("id"),
                    })

                if suspected_single and len(fallback_segments) > 1:
                    fallback_segments = sorted(fallback_segments, key=lambda item: item["confidence"], reverse=True)[:1]
                elif expected_count and len(fallback_segments) > expected_count:
                    fallback_segments = sorted(fallback_segments, key=lambda item: item["confidence"], reverse=True)[:expected_count]

                segments = fallback_segments

            return {
                "segments": segments,
                "count": len(segments),
                "suspected_single": suspected_single,
            }

        except Exception as e:
            logger.error(f"第二次分割增强流程失败: {e}")
            return {"error": str(e)}

    def predict_ppd(self, models, image_path, confidence_threshold=0.5, min_area=100, morph_kernel_size=5, morph_iterations=1, use_ensemble=True, ensemble_method='average', ensemble_weights=None, return_masks=False, use_post_processing=True, use_tta=False):
        """
        多模型集成推理，移植ensemble_utils.py的ensemble_predict逻辑，保证与本地一致。
        """
        import torch
        from torchvision import transforms as T
        from PIL import Image as PILImage
        import numpy as np
        # 1. 读取图片并transform
        img = ImageOps.exif_transpose(PILImage.open(image_path)).convert('RGB')
        transform = T.Compose([
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        img_tensor = transform(img).unsqueeze(0)
        # 健壮模型类型判断
        if isinstance(models, dict):
            device = next(iter(models.values())).device
        elif isinstance(models, (list, tuple)):
            device = next(iter(models)).device
            models = {f'model{i+1}': m for i, m in enumerate(models)}
        elif hasattr(models, 'module'):
            # DataParallel
            device = next(models.parameters()).device
            models = {'model1': models}
        else:
            device = next(models.parameters()).device
            models = {'model1': models}
        img_tensor = img_tensor.to(device)
        # 2. 集成推理
        with torch.no_grad():
            # ensemble_predict核心逻辑
            all_outputs = []
            model_keys = list(models.keys())
            for model_key in model_keys:
                output = tta_predict(models[model_key], img_tensor, device) if use_tta else models[model_key](img_tensor)
                # 处理不同模型返回格式的情况
                if isinstance(output, dict):
                    # 如果输出是字典，尝试获取'seg'或'out'键的值
                    if 'seg' in output:
                        output = output['seg']
                    elif 'out' in output:
                        output = output['out']
                    else:
                        # 如果没有找到期望的键，使用第一个值
                        output = next(iter(output.values()))
                elif isinstance(output, (list, tuple)) and len(output) > 0:
                    # 如果输出是列表或元组，使用第一个元素
                    output = output[0]
                elif isinstance(output, OrderedDict):
                    # 如果输出是OrderedDict，尝试获取第一个值
                    output = next(iter(output.values()))
                all_outputs.append(output)
            
            # 确保所有输出都是张量
            processed_outputs = []
            for output in all_outputs:
                if isinstance(output, dict):
                    # 如果仍然有字典，尝试获取'seg'或'out'键的值
                    if 'seg' in output:
                        output = output['seg']
                    elif 'out' in output:
                        output = output['out']
                    else:
                        # 如果没有找到期望的键，使用第一个值
                        output = next(iter(output.values()))
                elif isinstance(output, (list, tuple)) and len(output) > 0:
                    # 如果输出是列表或元组，使用第一个元素
                    output = output[0]
                elif isinstance(output, OrderedDict):
                    # 如果输出是OrderedDict，尝试获取第一个值
                    output = next(iter(output.values()))
                
                # 确保输出是张量
                if not isinstance(output, torch.Tensor):
                    raise TypeError(f"模型输出必须是张量，但得到的是 {type(output)}")
                
                processed_outputs.append(output)
            
            # 单模型（或未启用集成）只有一个输出，直接使用，不走集成方法分支
            if not use_ensemble or len(processed_outputs) == 1:
                ensemble_output = processed_outputs[0]
            elif ensemble_method == 'average':
                ensemble_output = torch.zeros_like(processed_outputs[0])
                for output in processed_outputs:
                    ensemble_output += output
                ensemble_output /= len(processed_outputs)
            elif ensemble_method == 'weighted_average':
                weights = ensemble_weights or [1.0] * len(processed_outputs)
                if len(weights) < len(processed_outputs):
                    weights = weights + [1.0] * (len(processed_outputs) - len(weights))
                elif len(weights) > len(processed_outputs):
                    weights = weights[:len(processed_outputs)]
                weights_sum = sum(weights)
                weights = [w / weights_sum for w in weights]
                ensemble_output = torch.zeros_like(processed_outputs[0])
                for i, output in enumerate(processed_outputs):
                    ensemble_output += output * weights[i]
            elif ensemble_method == 'max_voting':
                preds = []
                for output in processed_outputs:
                    pred = output.max(1)[1]
                    preds.append(pred)
                stacked_preds = torch.stack(preds, dim=0)
                ensemble_pred = torch.mode(stacked_preds, dim=0)[0]
                num_classes = processed_outputs[0].size(1)
                ensemble_output = torch.nn.functional.one_hot(ensemble_pred, num_classes=num_classes).permute(0, 3, 1, 2).float()
            else:
                raise ValueError(f'不支持的集成方法: {ensemble_method}')
            # 后处理
            prob = torch.softmax(ensemble_output, dim=1)
            prob_rot = prob[0, 1].cpu().numpy()
            pred = (prob_rot > confidence_threshold).astype(np.uint8)
            if use_post_processing:
                pred = post_process_mask(pred, min_area=min_area, morph_kernel_size=morph_kernel_size, morph_iterations=morph_iterations)
            total_pixels = pred.size
            rot_pixels = np.sum(pred == 1)
            
            # 参考predict.py中的方法，使用OpenCV从原始图像中获取木薯区域
            img_array = np.array(img)
            # 获取木薯区域mask
            cassava_mask = self.get_cassava_area_mask(img_array)
            # 调整大小以匹配预测结果
            if cassava_mask.shape != pred.shape:
                cassava_mask_img = PILImage.fromarray(cassava_mask)
                cassava_mask_img = cassava_mask_img.resize(pred.shape[::-1], PILImage.Resampling.NEAREST)
                cassava_mask = np.array(cassava_mask_img)
            
            # 只计算在木薯区域内的预测腐烂区域
            pred_rotten_in_cassava = pred * cassava_mask
            
            # 计算面积
            cassava_pixels = np.count_nonzero(cassava_mask)
            pred_rotten_pixels = np.count_nonzero(pred_rotten_in_cassava)
            
            # 计算PPD值（预测腐烂面积/木薯面积）
            if cassava_pixels == 0:
                ppd = 0.0
                logger.info("PPD skipped because cassava area is zero: image=%s rotten=%s total=%s", image_path, rot_pixels, total_pixels)
            else:
                ppd = (pred_rotten_pixels / cassava_pixels) * 100
                logger.info("PPD calculated: image=%s rotten=%s cassava=%s total=%s ppd=%.4f", image_path, pred_rotten_pixels, cassava_pixels, total_pixels, ppd)
            
            # 可视化
            mask = pred == 1
            img_array = np.array(img)
            overlay_img = img_array.copy()
            
            # 确保即使没有掩码也返回有效的overlay图像
            if np.any(mask):
                overlay_img[mask] = overlay_img[mask] * 0.7 + np.array([255, 0, 0]) * 0.3
            else:
                # 如果没有检测到腐烂区域，仍然返回原始图像
                logger.info("未检测到腐烂区域，返回原始图像作为 overlay")
            
            # 确保overlay_img不为None
            if overlay_img is None:
                overlay_img = img_array.copy()
                logger.warning("overlay_img 为 None，使用原始图像替代")
            
            from PIL import Image as PILImage
            overlay_image = PILImage.fromarray(overlay_img)
            if return_masks:
                return ppd, overlay_image, cassava_mask.astype(np.uint8), pred_rotten_in_cassava.astype(np.uint8), prob_rot.astype(np.float32)
            return ppd, overlay_image

    def predict_ppd_m6(self, image_path, confidence_threshold=0.5, min_area=100, morph_kernel_size=5, morph_iterations=1, patch_size=(512, 512), stride=(256, 256), overlay_opacity=0.45, return_masks=False, use_post_processing=True, use_tta=False):
        """
        使用 M6 模型执行最终 PPD 预测。
        前置两次 YOLO 裁切流程保持不变，这里只替换最后的分割模型。
        """
        result = m6_best_predictor.predict(
            image_path=image_path,
            confidence_threshold=confidence_threshold,
            min_area=min_area,
            morph_kernel_size=morph_kernel_size,
            morph_iterations=morph_iterations,
            patch_size=patch_size,
            stride=stride,
            overlay_opacity=overlay_opacity,
            use_post_processing=use_post_processing,
            use_tta=use_tta,
        )

        mask = result["mask"]
        img = ImageOps.exif_transpose(Image.open(image_path)).convert('RGB')
        img_array = np.array(img)

        cassava_mask = self.get_cassava_area_mask(img_array)
        if cassava_mask.shape != mask.shape:
            cassava_mask_img = Image.fromarray(cassava_mask)
            cassava_mask_img = cassava_mask_img.resize(mask.shape[::-1], Image.Resampling.NEAREST)
            cassava_mask = np.array(cassava_mask_img)

        _, pred_rotten_in_cassava, cassava_pixels, pred_rotten_pixels, ppd = calculate_mask_metrics(cassava_mask, mask)
        if return_masks:
            return ppd, result["overlay_image"], cassava_mask.astype(np.uint8), pred_rotten_in_cassava.astype(np.uint8), result.get("disease_prob")
        return ppd, result["overlay_image"]
    
    def predict_ppd_voting(self, model, image_path, confidence_threshold=0.5,
                           min_area=100, morph_kernel_size=5, morph_iterations=1,
                           patch_size=(512, 512), stride=(256, 256), overlay_opacity=0.45,
                           use_post_processing=True, use_tta=False):
        # Both members see the exact same detected crop. Fuse probabilities before filtering.
        first = self.predict_ppd(model, image_path, confidence_threshold=confidence_threshold,
            return_masks=True, use_post_processing=False, use_tta=use_tta)
        second = self.predict_ppd_m6(image_path, confidence_threshold=confidence_threshold,
            patch_size=patch_size, stride=stride, return_masks=True,
            use_post_processing=False, use_tta=use_tta)
        rgb = np.asarray(ImageOps.exif_transpose(Image.open(image_path)).convert('RGB'))
        h, w = rgb.shape[:2]
        probabilities = [cv2.resize(np.asarray(item[4], dtype=np.float32), (w, h),
                                   interpolation=cv2.INTER_LINEAR) for item in (first, second)]
        voted, mean, disagreement = vote_probabilities(probabilities, confidence_threshold)
        cassava = self.get_cassava_area_mask(rgb) > 0

        def filtered(mask):
            if use_post_processing:
                mask = post_process_mask(mask, min_area, morph_kernel_size, morph_iterations)
            return ((mask > 0) & cassava).astype(np.uint8)

        rotten = filtered(voted)
        member_masks = {name: filtered((probability > confidence_threshold).astype(np.uint8))
                        for name, probability in zip(MEMBERS, probabilities)}
        _, rotten, _, _, ppd = calculate_mask_metrics(cassava, rotten)
        overlay = rgb.copy()
        lesion = rotten > 0
        overlay[lesion] = rgb[lesion] * (1 - overlay_opacity) + np.array([255, 0, 0]) * overlay_opacity
        details = voting_summary(cassava, member_masks, disagreement)
        return (ppd, Image.fromarray(overlay), cassava.astype(np.uint8), rotten.astype(np.uint8), mean,
                {'summary': details, 'member_masks': member_masks, 'disagreement': disagreement})

    def get_cassava_area_mask(self, image):
        """
        从原始图像中获取木薯区域mask
        使用OpenCV和多种颜色空间来更准确地确定木薯区域
        参考自模型/DeepLabV3Plus-Pytorch-master/predict.py中的get_cassava_area_mask函数
        """
        import cv2
        import numpy as np
        from PIL import Image as PILImage
        
        # 如果输入是PIL图像，转换为numpy数组
        if isinstance(image, PILImage.Image):
            img_bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        else:
            # 假设输入是numpy数组，且已经是BGR格式
            img_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR) if len(image.shape) == 3 and image.shape[2] == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        
        # 转换到不同的颜色空间以更好地分离木薯区域
        # A spatially uniform frame cannot define a measurable specimen boundary.
        if int(np.max(np.ptp(img_bgr, axis=(0, 1)))) < 4:
            return np.zeros(img_bgr.shape[:2], dtype=np.uint8)

        img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
        img_lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
        img_ycrcb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb)
        
        # 在不同颜色空间中定义木薯的颜色范围
        # HSV范围 (木薯通常呈黄色到棕色)
        lower_hsv = np.array([10, 30, 30])
        upper_hsv = np.array([40, 255, 255])
        mask_hsv = cv2.inRange(img_hsv, lower_hsv, upper_hsv)
        
        # Lab范围 (木薯在Lab空间中有特定的范围)
        lower_lab = np.array([120, 90, 120])
        upper_lab = np.array([240, 150, 180])
        mask_lab = cv2.inRange(img_lab, lower_lab, upper_lab)
        
        # YCrCb范围 (木薯在YCrCb空间中的范围)
        lower_ycrcb = np.array([70, 50, 120])
        upper_ycrcb = np.array([230, 140, 190])
        mask_ycrcb = cv2.inRange(img_ycrcb, lower_ycrcb, upper_ycrcb)
        
        # 基于RGB的额外检测方法（作为备选方案）
        # 木薯通常呈黄色/棕色，R和G值较高，B值中等到较低
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        r_channel = img_rgb[:,:,0]
        g_channel = img_rgb[:,:,1]
        b_channel = img_rgb[:,:,2]
        
        # 宽松的RGB阈值
        mask_rgb = ((r_channel > 40) & (r_channel < 255) &
                    (g_channel > 40) & (g_channel < 255) &
                    (b_channel > 20) & (b_channel < 230)).astype(np.uint8) * 255
        
        # 结合不同颜色空间的掩码
        combined_mask = cv2.bitwise_or(mask_hsv, mask_lab)
        combined_mask = cv2.bitwise_or(combined_mask, mask_ycrcb)
        combined_mask = cv2.bitwise_or(combined_mask, mask_rgb)
        
        # 使用形态学操作清理掩码
        # 创建椭圆形结构元素
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        small_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        
        # 开运算去除小的噪声点
        combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, small_kernel, iterations=1)
        
        # 闭运算填充区域内的小孔
        combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        
        # 膨胀操作使区域稍微扩大，确保包含完整的木薯
        combined_mask = cv2.dilate(combined_mask, kernel, iterations=1)
        
        # 查找轮廓并选择最大的几个轮廓（假设木薯是主要对象）
        contours, _ = cv2.findContours(combined_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # 创建新的掩码只保留大的轮廓
        final_mask = np.zeros_like(combined_mask)
        if contours:
            # 根据轮廓面积排序
            contours = sorted(contours, key=cv2.contourArea, reverse=True)
            
            # 计算总面积阈值（至少占图像0.5%的面积）
            min_area = img_bgr.shape[0] * img_bgr.shape[1] * 0.005
            # 最多处理前10个最大的轮廓
            for i, contour in enumerate(contours[:10]):
                area = cv2.contourArea(contour)
                if area > min_area:
                    cv2.fillPoly(final_mask, [contour], 255)
                elif i == 0:  # 如果最大的轮廓都不够大，但还是要保留它
                    cv2.fillPoly(final_mask, [contour], 255)
        
        # 如果上述方法没有检测到足够大的区域，使用更宽松的方法
        if np.count_nonzero(final_mask) < (img_bgr.shape[0] * img_bgr.shape[1] * 0.01):
            # 使用更宽松的RGB阈值
            mask_relaxed = ((r_channel > 20) & (r_channel < 255) &
                           (g_channel > 20) & (g_channel < 255) &
                           (b_channel > 10) & (b_channel < 240)).astype(np.uint8) * 255
            
            # 简单的形态学操作
            kernel_large = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
            mask_relaxed = cv2.morphologyEx(mask_relaxed, cv2.MORPH_CLOSE, kernel_large, iterations=2)
            mask_relaxed = cv2.morphologyEx(mask_relaxed, cv2.MORPH_OPEN, small_kernel, iterations=1)
            
            # 查找并保留最大的轮廓
            contours, _ = cv2.findContours(mask_relaxed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                # 保留最大的轮廓
                largest_contour = max(contours, key=cv2.contourArea)
                cv2.fillPoly(final_mask, [largest_contour], 255)
        
        # 最后的形态学优化
        final_mask = cv2.morphologyEx(final_mask, cv2.MORPH_CLOSE, kernel, iterations=1)
        
        # 转换为uint8类型并返回 (0和1值)
        result = (final_mask > 0).astype(np.uint8)
        
        return result
    
    def batch_predict_ppd(self, model, image_paths, confidence_threshold=0.5, min_area=100, morph_kernel_size=5, morph_iterations=1, use_ensemble=False, ensemble_method='weighted_average', ensemble_weights=None):
        """
        批量预测PPD值
        
        Args:
            model: DeepLabV3Plus模型或模型列表
            image_paths: 图像路径列表
            confidence_threshold: 置信度阈值
            min_area: 最小区域面积
            morph_kernel_size: 形态学操作的内核大小
            morph_iterations: 形态学操作的迭代次数
            use_ensemble: 是否使用集成模型
            ensemble_method: 集成方法
            ensemble_weights: 集成权重
            
        Returns:
            PPD值列表和可视化结果列表
        """
        try:
            # 如果使用集成模型，先加载所有模型
            if use_ensemble:
                if not isinstance(model, list):
                    models = self.load_ensemble_models()
                else:
                    models = model
                
                if not models:
                    raise ValueError("没有可用的集成模型")
            else:
                models = None
            
            results = []
            
            # 分批处理
            for i in range(0, len(image_paths), self.batch_size):
                batch_paths = image_paths[i:i+self.batch_size]
                
                # 处理每个图像
                for image_path in batch_paths:
                    ppd, result_image = self.predict_ppd(
                        models if use_ensemble else model, 
                        image_path, 
                        confidence_threshold, 
                        min_area, 
                        morph_kernel_size, 
                        morph_iterations,
                        use_ensemble,
                        ensemble_method,
                        ensemble_weights
                    )
                    
                    results.append({
                        'image_path': image_path,
                        'ppd': ppd,
                        'result_image': result_image
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"批量预测PPD值失败: {e}")
            raise

    def integrated_prediction(self, image_path, output_dir, 
                            confidence_threshold=0.5, 
                            min_area=100, 
                            morph_kernel_size=5, 
                            morph_iterations=1,
                            use_ensemble=False, 
                            ensemble_method=METHOD, 
                            ensemble_weights=None,
                            single_model_type='resnet101',
                            patch_size=(512, 512),
                            stride=(256, 256),
                            overlay_opacity=0.45,
                            stage1_confidence=None,
                            stage2_confidence=None,
                            roi_padding=0.10,
                            fallback_roi_padding=0.70,
                            expected_count=0,
                            stage_box_iou=0.50,
                            use_post_processing=True,
                            use_tta=False):
        """
        集成处理函数：执行第一次分割、第二次分割和PPD预测的完整流程
        
        Args:
            image_path (str): 原始图像路径
            output_dir (str): 输出目录
            confidence_threshold (float): 置信度阈值
            min_area (int): 最小连通区域面积
            morph_kernel_size (int): 形态学操作核大小
            morph_iterations (int): 形态学操作迭代次数
            use_ensemble (bool): 是否使用集成模型
            ensemble_method (str): 集成方法
            ensemble_weights (list): 集成权重
            
        Returns:
            dict: 包含预测结果的字典
        """
        try:
            if not os.path.exists(image_path):
                return {"error": "原始图片不存在"}
            # 加载第一次分割模型
            seg1_model_path = os.path.join(settings.BASE_DIR.parent, 'model', 'yolov11(2).pt')
            seg1_model = self.load_yolo_model(seg1_model_path)
            if seg1_model is None:
                return {"error": "无法加载第一次分割模型"}
                
            # 创建临时目录
            seg1_output_dir = os.path.join(output_dir, 'seg1_temp')
            os.makedirs(seg1_output_dir, exist_ok=True)
            
            # 执行第一次分割
            seg1_confidence = min(max(stage1_confidence if stage1_confidence is not None else confidence_threshold, 0.01), 1.0)
            seg2_confidence = min(max(stage2_confidence if stage2_confidence is not None else confidence_threshold, 0.01), 1.0)

            seg1_results = self.first_segmentation(
                seg1_model,
                image_path,
                seg1_output_dir,
                seg1_confidence,
                roi_padding=roi_padding,
                iou_threshold=stage_box_iou,
            )
            
            if not isinstance(seg1_results, dict):
                logger.warning(f"第一次分割返回格式异常: {type(seg1_results)}")
                seg1_results = {"segments": []}
            seg1_segments = seg1_results.get("segments")
            if not seg1_results or ("error" in seg1_results and not seg1_segments):
                logger.warning(f"第一次分割返回: {seg1_results}")
                
            # 加载第二次分割模型
            seg2_model_path = os.path.join(settings.BASE_DIR.parent, 'model', 'yolov11(1).pt')
            seg2_model = self.load_yolo_model(seg2_model_path)
            if seg2_model is None:
                return {"error": "无法加载第二次分割模型"}
                
            # 创建临时目录
            seg2_output_dir = os.path.join(output_dir, 'seg2_temp')
            os.makedirs(seg2_output_dir, exist_ok=True)
            
            # 对每个第一次分割结果执行第二次分割
            all_seg2_results = []
            
            # 如果第一次分割没有结果，使用原图作为输入
            if not seg1_segments:
                logger.info("第一次分割未检测到目标，使用原图作为第二次分割输入")
                seg1_results = {
                    "segments": [self._build_full_image_segment(image_path, seg1_output_dir)]
                }

            seg2_results = self.refine_second_segmentation(
                model=seg2_model,
                original_image_path=image_path,
                stage1_segments=seg1_results["segments"],
                output_dir=seg2_output_dir,
                confidence_threshold=seg2_confidence,
                min_area=min_area,
                roi_padding=roi_padding,
                fallback_roi_padding=fallback_roi_padding,
                expected_count=expected_count,
                iou_threshold=stage_box_iou,
            )
            seg2_segments = seg2_results.get("segments") if isinstance(seg2_results, dict) else None
            if seg2_segments:
                all_seg2_results.extend(seg2_segments)
            
            if not all_seg2_results:
                return {"error": "第二次分割未产生有效结果"}
                
            # Voting uses both configured real checkpoints; never silently drops a member.
            if use_ensemble:
                if ensemble_method != METHOD:
                    raise ValueError('不支持的投票方法')
                path = resolve_existing_model_path(getattr(settings, 'DEEPLABV3_RESNET101_PATH', None))
                if not path:
                    raise ValueError('有监督模型权重不存在，不能生成投票模型结果')
                model = self.load_model(path, model_type='deeplabv3plus_resnet101')
            elif single_model_type == 'm6_best':
                model = 'm6_best'
            else:
                model_path_map = {
                    'resnet50': getattr(settings, 'DEEPLABV3_RESNET50_PATH', None),
                    'resnet101': getattr(settings, 'DEEPLABV3_RESNET101_PATH', None),
                    'mobilenet': getattr(settings, 'DEEPLABV3_MOBILENET_PATH', None)
                }
                model_type_map = {
                    'resnet50': 'deeplabv3plus_resnet50',
                    'resnet101': 'deeplabv3plus_resnet101',
                    'mobilenet': 'deeplabv3plus_mobilenet'
                }
                if single_model_type not in model_path_map:
                    raise ValueError('不支持的预测模型')
                model_key = single_model_type
                model_path = resolve_existing_model_path(model_path_map.get(model_key))
                if not model_path:
                    raise ValueError('所选模型权重不存在，未自动替换为其他模型')
                model_type = model_type_map.get(model_key, 'deeplabv3plus_resnet101')
                model = self.load_model(model_path, model_type=model_type)
                
            if model is None:
                return {"error": "无法加载PPD预测模型"}
                
            # 执行PPD预测
            all_predictions = []
            for seg2_result in all_seg2_results:
                seg2_image_path = seg2_result["image_path"]
                
                try:
                    voting = None
                    if use_ensemble:
                        prediction_output = self.predict_ppd_voting(
                            model, seg2_image_path, confidence_threshold, min_area,
                            morph_kernel_size, morph_iterations, patch_size, stride,
                            overlay_opacity, use_post_processing, use_tta)
                        voting = prediction_output[5]
                    elif single_model_type == 'm6_best':
                        prediction_output = self.predict_ppd_m6(
                            image_path=seg2_image_path,
                            confidence_threshold=confidence_threshold,
                            min_area=min_area,
                            morph_kernel_size=morph_kernel_size,
                            morph_iterations=morph_iterations,
                            patch_size=patch_size,
                            stride=stride,
                            overlay_opacity=overlay_opacity,
                            return_masks=True,
                            use_post_processing=use_post_processing,
                            use_tta=use_tta,
                        )
                    else:
                        prediction_output = self.predict_ppd(
                            model,
                            seg2_image_path,
                            confidence_threshold,
                            min_area,
                            morph_kernel_size,
                            morph_iterations,
                            use_ensemble,
                            ensemble_method,
                            ensemble_weights,
                            return_masks=True,
                            use_post_processing=use_post_processing,
                            use_tta=use_tta,
                        )
                    if len(prediction_output) >= 5:
                        ppd, overlay_image, cassava_mask, rotten_mask, confidence_map = prediction_output[:5]
                    elif len(prediction_output) >= 4:
                        ppd, overlay_image, cassava_mask, rotten_mask = prediction_output
                        confidence_map = None
                    else:
                        ppd, overlay_image = prediction_output
                        cassava_mask = None
                        rotten_mask = None
                        confidence_map = None
                except Exception as e:
                    logger.error(f"PPD预测失败: {e}")
                    continue
                
                # 构建预测结果字典
                prediction = {
                    "voting": voting,
                    "ppd": ppd,
                    "overlay_image": overlay_image, # PIL Image object
                    "cassava_mask": cassava_mask,
                    "rotten_mask": rotten_mask,
                    "confidence_map": confidence_map,
                    "segment_info": {
                        "seg1_id": seg2_result.get("parent_id"),
                        "seg2_id": seg2_result.get("id"),
                        # 传递文件路径以便后续处理
                        "seg2_image_path": seg2_image_path
                    }
                }
                all_predictions.append(prediction)
            
            # 将各子图掩码按原图坐标合成为可编辑的完整图像掩码。
            original_width, original_height = ImageOps.exif_transpose(Image.open(image_path)).size
            full_cassava_mask = np.zeros((original_height, original_width), dtype=np.uint8)
            full_rotten_mask = np.zeros((original_height, original_width), dtype=np.uint8)
            full_confidence_map = np.zeros((original_height, original_width), dtype=np.float32)
            full_member_masks = {name: np.zeros_like(full_rotten_mask) for name in MEMBERS} if use_ensemble else {}
            full_disagreement = np.zeros_like(full_rotten_mask) if use_ensemble else None
            has_confidence_map = False
            seg2_by_id = {str(item.get('id')): item for item in all_seg2_results}
            for prediction in all_predictions:
                cassava_mask = prediction.get('cassava_mask')
                rotten_mask = prediction.get('rotten_mask')
                confidence_map = prediction.get('confidence_map')
                seg2_id = str(prediction.get('segment_info', {}).get('seg2_id'))
                segment = seg2_by_id.get(seg2_id)
                bbox = segment.get('bbox') if segment else None
                if cassava_mask is None or rotten_mask is None or not bbox:
                    continue
                x1, y1, x2, y2 = [int(value) for value in bbox[:4]]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(original_width, x2), min(original_height, y2)
                if x2 <= x1 or y2 <= y1:
                    continue
                target_size = (x2 - x1, y2 - y1)
                if use_ensemble:
                    voting = prediction['voting']
                    for name, mask in {**voting['member_masks'], '_disagreement': voting['disagreement']}.items():
                        resized = cv2.resize(mask.astype(np.uint8), target_size, interpolation=cv2.INTER_NEAREST)
                        full = full_disagreement if name == '_disagreement' else full_member_masks[name]
                        full[y1:y2, x1:x2] = np.maximum(full[y1:y2, x1:x2], resized)
                cassava_crop = np.asarray(Image.fromarray(cassava_mask.astype(np.uint8)).resize(target_size, Image.Resampling.NEAREST)) > 0
                rotten_crop = np.asarray(Image.fromarray(rotten_mask.astype(np.uint8)).resize(target_size, Image.Resampling.NEAREST)) > 0
                full_cassava_mask[y1:y2, x1:x2] |= cassava_crop.astype(np.uint8)
                full_rotten_mask[y1:y2, x1:x2] |= rotten_crop.astype(np.uint8)
                if confidence_map is not None:
                    confidence_crop = cv2.resize(
                        np.asarray(confidence_map, dtype=np.float32),
                        target_size,
                        interpolation=cv2.INTER_LINEAR,
                    )
                    full_confidence_map[y1:y2, x1:x2] = np.maximum(
                        full_confidence_map[y1:y2, x1:x2], confidence_crop
                    )
                    has_confidence_map = True
            _, full_rotten_mask, full_cassava_pixels, full_rotten_pixels, full_ppd = calculate_mask_metrics(full_cassava_mask, full_rotten_mask)
            if not all_predictions or not full_cassava_pixels:
                raise ValueError("未获得有效木薯范围，不能将失败识别记录为0% PPD")

            # 计算完整原图的 PPD，子图 PPD 仍保留在 predictions 中供展示。
            if all_predictions:
                ppd_values = [pred.get("ppd", 0) for pred in all_predictions]
                avg_ppd = full_ppd if full_cassava_pixels else (sum(ppd_values) / len(ppd_values) if ppd_values else 0)
            else:
                avg_ppd = 0
                
            ensemble_details = voting_summary(full_cassava_mask, full_member_masks, full_disagreement) if use_ensemble else {}
            if use_ensemble:
                ensemble_details['segments'] = [p['voting']['summary'] for p in all_predictions]
            return {
                "ensemble_details": ensemble_details,
                "disagreement_mask": ((full_disagreement > 0) & (full_cassava_mask > 0)).astype(np.uint8) if use_ensemble else None,
                "member_masks": full_member_masks,
                "success": True,
                "original_image": image_path,
                "segments_count": len(all_seg2_results),
                "predictions_count": len(all_predictions),
                "predictions": all_predictions,
                "average_ppd": avg_ppd,
                "warning": "部分切面分析失败，请复核" if len(all_predictions) < len(all_seg2_results) else None,
                "cassava_mask": full_cassava_mask,
                "rotten_mask": full_rotten_mask,
                "confidence_map": full_confidence_map if has_confidence_map else None,
                # 返回中间结果以便保存
                "seg1_results": seg1_results.get("segments", []),
                "seg2_results": all_seg2_results
            }
            
        except Exception as e:
            logger.error(f"集成预测过程中出错: {str(e)}")
            return {"error": f"集成预测失败: {str(e)}"}

    def predict_ppd_with_yolo(self, image_path, confidence_threshold=0.5, min_area=100, morph_kernel_size=5, morph_iterations=1, use_ensemble=False, ensemble_method='weighted_average', ensemble_weights=None, save_vis_dir=None, single_model_type='resnet101'):
        """
        新增：single_model_type参数，支持'resnet50'、'resnet101'、'mobilenet'三种主模型选择，默认'resnet101'。
        """
        try:
            import cv2
            from PIL import Image as PILImage
            import numpy as np
            import os
            import torch
            import torch.nn as nn
            from torchvision import transforms as T
            import matplotlib.pyplot as plt
            import traceback
            import tempfile
            import shutil
            import sys
            from django.conf import settings
            
            # 添加项目根目录到Python路径
            project_root = settings.BASE_DIR.parent
            back_dir = str(settings.BASE_DIR)
            
            # 确保network模块可以被导入
            network_path = os.path.join(back_dir, 'network')
            utils_path = os.path.join(back_dir, 'utils')
            
            # 将必要的路径添加到sys.path开头以确保优先级
            for path in [network_path, utils_path, back_dir]:
                if path not in sys.path:
                    sys.path.insert(0, path)
            
            def load_deeplab_model():
                model_path_map = {
                    'resnet50': getattr(settings, 'DEEPLABV3_RESNET50_PATH', None),
                    'resnet101': getattr(settings, 'DEEPLABV3_RESNET101_PATH', None),
                    'mobilenet': getattr(settings, 'DEEPLABV3_MOBILENET_PATH', None)
                }
                model_type_map = {
                    'resnet50': 'deeplabv3plus_resnet50',
                    'resnet101': 'deeplabv3plus_resnet101',
                    'mobilenet': 'deeplabv3plus_mobilenet'
                }
                if single_model_type not in model_path_map:
                    raise ValueError('不支持的预测模型')
                model_key = single_model_type
                model_path = model_path_map.get(model_key)
                model_type = model_type_map.get(model_key, 'deeplabv3plus_resnet101')
                model = self.load_model(model_path, model_type=model_type)
                return model, self.device

            def get_deeplab_transform():
                """获取DeepLabV3的预处理变换"""
                transform = T.Compose([
                    T.ToTensor(),
                    T.Normalize(mean=[0.485, 0.456, 0.406],
                               std=[0.229, 0.224, 0.225]),
                ])
                return transform

            def predict_with_deeplab(model, image, device, transform):
                """使用DeepLabV3模型进行预测"""
                with torch.no_grad():
                    # 预处理图像
                    img_tensor = transform(image).unsqueeze(0)  # 添加批次维度
                    img_tensor = img_tensor.to(device)
                    
                    # 模型推理
                    pred = model(img_tensor).max(1)[1].cpu().numpy()[0]  # HW
                    
                return pred

            def overlay_predictions_on_image(original_image, prediction_mask, color=(0, 255, 0), alpha=0.3):
                """在原始图像上叠加预测结果"""
                # 将PIL图像转换为numpy数组
                if isinstance(original_image, PILImage.Image):
                    image_array = np.array(original_image)
                else:
                    image_array = original_image
                
                # 确保图像是RGB格式
                if len(image_array.shape) == 2:
                    image_array = cv2.cvtColor(image_array, cv2.COLOR_GRAY2RGB)
                elif image_array.shape[2] == 4:
                    image_array = cv2.cvtColor(image_array, cv2.COLOR_RGBA2RGB)
                
                # 创建彩色mask
                color_mask = np.zeros_like(image_array)
                color_mask[prediction_mask == 1] = color  # 绿色表示腐烂区域
                
                # 叠加mask到原始图像
                overlay = cv2.addWeighted(image_array, 1-alpha, color_mask, alpha, 0)
                
                # 在腐烂区域周围绘制轮廓
                mask_uint8 = (prediction_mask * 255).astype(np.uint8)
                contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                
                # 过滤小面积轮廓
                filtered_contours = [cnt for cnt in contours if cv2.contourArea(cnt) >= min_area]
                cv2.drawContours(overlay, filtered_contours, -1, color, 2)
                
                return overlay

            def get_cassava_area_mask(image):
                """
                从原始图像中获取木薯区域mask
                使用OpenCV和多种颜色空间来更准确地确定木薯区域
                """
                # 如果输入是PIL图像，转换为numpy数组
                if isinstance(image, PILImage.Image):
                    img_bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
                else:
                    # 假设输入是numpy数组，且已经是BGR格式
                    img_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR) if len(image.shape) == 3 and image.shape[2] == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                
                # 转换到不同的颜色空间以更好地分离木薯区域
                img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
                img_lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
                img_ycrcb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb)
                
                # 在不同颜色空间中定义木薯的颜色范围
                # HSV范围 (木薯通常呈黄色到棕色)
                lower_hsv = np.array([10, 30, 30])
                upper_hsv = np.array([40, 255, 255])
                mask_hsv = cv2.inRange(img_hsv, lower_hsv, upper_hsv)
                
                # Lab范围 (木薯在Lab空间中有特定的范围)
                lower_lab = np.array([120, 90, 120])
                upper_lab = np.array([240, 150, 180])
                mask_lab = cv2.inRange(img_lab, lower_lab, upper_lab)
                
                # YCrCb范围 (木薯在YCrCb空间中的范围)
                lower_ycrcb = np.array([70, 50, 120])
                upper_ycrcb = np.array([230, 140, 190])
                mask_ycrcb = cv2.inRange(img_ycrcb, lower_ycrcb, upper_ycrcb)
                
                # 基于RGB的额外检测方法（作为备选方案）
                # 木薯通常呈黄色/棕色，R和G值较高，B值中等到较低
                img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
                r_channel = img_rgb[:,:,0]
                g_channel = img_rgb[:,:,1]
                b_channel = img_rgb[:,:,2]
                
                # 宽松的RGB阈值
                mask_rgb = ((r_channel > 40) & (r_channel < 255) &
                            (g_channel > 40) & (g_channel < 255) &
                            (b_channel > 20) & (b_channel < 230)).astype(np.uint8) * 255
                
                # 结合不同颜色空间的掩码
                combined_mask = cv2.bitwise_or(mask_hsv, mask_lab)
                combined_mask = cv2.bitwise_or(combined_mask, mask_ycrcb)
                combined_mask = cv2.bitwise_or(combined_mask, mask_rgb)
                
                # 使用形态学操作清理掩码
                # 创建椭圆形结构元素
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
                small_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
                
                # 开运算去除小的噪声点
                combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, small_kernel, iterations=1)
                
                # 闭运算填充区域内的小孔
                combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
                
                # 膨胀操作使区域稍微扩大，确保包含完整的木薯
                combined_mask = cv2.dilate(combined_mask, kernel, iterations=1)
                
                # 查找轮廓并选择最大的几个轮廓（假设木薯是主要对象）
                contours, _ = cv2.findContours(combined_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                
                # 创建新的掩码只保留大的轮廓
                final_mask = np.zeros_like(combined_mask)
                if contours:
                    # 根据轮廓面积排序
                    contours = sorted(contours, key=cv2.contourArea, reverse=True)
                    
                    # 计算总面积阈值（至少占图像0.5%的面积）
                    min_area_threshold = img_bgr.shape[0] * img_bgr.shape[1] * 0.005
                    # 最多处理前10个最大的轮廓
                    for i, contour in enumerate(contours[:10]):
                        area = cv2.contourArea(contour)
                        if area > min_area_threshold and area >= min_area:
                            cv2.fillPoly(final_mask, [contour], 255)
                        elif i == 0 and area >= min_area:  # 如果最大的轮廓都不够大，但还是要保留它
                            cv2.fillPoly(final_mask, [contour], 255)
                
                # 如果上述方法没有检测到足够大的区域，使用更宽松的方法
                if np.count_nonzero(final_mask) < (img_bgr.shape[0] * img_bgr.shape[1] * 0.01):
                    # 使用更宽松的RGB阈值
                    mask_relaxed = ((r_channel > 20) & (r_channel < 255) &
                                   (g_channel > 20) & (g_channel < 255) &
                                   (b_channel > 10) & (b_channel < 240)).astype(np.uint8) * 255
                    
                    # 简单的形态学操作
                    kernel_large = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                    mask_relaxed = cv2.morphologyEx(mask_relaxed, cv2.MORPH_CLOSE, kernel_large, iterations=2)
                    mask_relaxed = cv2.morphologyEx(mask_relaxed, cv2.MORPH_OPEN, small_kernel, iterations=1)
                    
                    # 查找并保留最大的轮廓
                    contours, _ = cv2.findContours(mask_relaxed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    if contours:
                        # 保留最大的轮廓
                        largest_contour = max(contours, key=cv2.contourArea)
                        if cv2.contourArea(largest_contour) >= min_area:
                            cv2.fillPoly(final_mask, [largest_contour], 255)
                
                # 最后的形态学优化
                final_mask = cv2.morphologyEx(final_mask, cv2.MORPH_CLOSE, kernel, iterations=1)
                
                # 转换为uint8类型并返回 (0和1值)
                result = (final_mask > 0).astype(np.uint8)
                
                return result

            def create_visualization(file_name, original_image, sub_images, predictions):
                """创建组合可视化图像：第一行原始图像，第二行子图，第三行预测结果"""
                # 限制最多显示3个子图
                sub_images = sub_images[:3]
                predictions = predictions[:3]
                
                # 设置非交互式后端，避免在非主线程中使用GUI
                import matplotlib
                matplotlib.use('Agg')  # 使用非交互式后端
                import matplotlib.pyplot as plt
                
                # 创建图表
                fig = plt.figure(figsize=(18, 15))
                
                # 第一行：原始图像
                ax1 = plt.subplot(3, 3, (1, 3))  # 占据前3个位置
                ax1.imshow(original_image)
                ax1.set_title('Original Image')
                ax1.axis('off')
                
                # 第二行：子图（最多3个）
                for i, sub_img in enumerate(sub_images):
                    ax = plt.subplot(3, 3, 4+i)  # 位置4, 5, 6
                    ax.imshow(sub_img)
                    ax.set_title(f'Sub-image {i+1}')
                    ax.axis('off')
                
                # 第三行：预测结果（最多3个）
                for i, (sub_img, pred_img, pred_mask) in enumerate(predictions):
                    ax = plt.subplot(3, 3, 7+i)  # 位置7, 8, 9
                    
                    # 计算PPD（参考predict.py中的方法，只计算木薯区域作为分母）
                    # 使用OpenCV从原始图像中获取木薯区域
                    cassava_mask = get_cassava_area_mask(sub_img)
                    # 调整大小以匹配预测结果
                    if cassava_mask.shape != pred_mask.shape:
                        # 确保cassava_mask是二维数组
                        if len(cassava_mask.shape) > 2:
                            cassava_mask = cassava_mask[:, :, 0] if cassava_mask.shape[2] > 1 else cassava_mask[:, :, 0]
                        cassava_mask_img = PILImage.fromarray(cassava_mask)
                        cassava_mask_img = cassava_mask_img.resize(pred_mask.shape[::-1], PILImage.Resampling.NEAREST)
                        cassava_mask = np.array(cassava_mask_img)
                    
                    # 只计算在木薯区域内的预测腐烂区域
                    pred_rotten_in_cassava = pred_mask * cassava_mask
                    
                    # 计算面积
                    cassava_pixels = np.count_nonzero(cassava_mask)
                    pred_rotten_pixels = np.count_nonzero(pred_rotten_in_cassava)
                    
                    # 计算PPD值（预测腐烂面积/木薯面积）
                    ppd = pred_rotten_pixels / cassava_pixels if cassava_pixels > 0 else 0.0
                    
                    # 在预测图像上用红色勾勒出木薯区域边界
                    pred_img_array = np.array(pred_img)
                    # 将cassava_mask转换为uint8格式
                    cassava_mask_uint8 = (cassava_mask * 255).astype(np.uint8)
                    # 查找轮廓
                    contours, _ = cv2.findContours(cassava_mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    # 在图像上绘制红色轮廓
                    cv2.drawContours(pred_img_array, contours, -1, (255, 0, 0), 2)  # 红色轮廓，线宽为2
                    
                    # 显示带有红色轮廓的图像
                    ax.imshow(pred_img_array)
                    
                    # 计算整体像素点、红色区域像素点和绿色区域像素点
                    total_pixels = pred_mask.size
                    red_area_pixels = cassava_pixels
                    green_area_pixels = pred_rotten_pixels
                    
                    ax.set_title(f'Prediction {i+1}\nPPD: {ppd:.4f}\n'
                                f'Total: {total_pixels}\n'
                                f'Red: {red_area_pixels}\n'
                                f'Green: {green_area_pixels}')
                    ax.axis('off')
                
                plt.tight_layout()
                combined_path = os.path.join(save_vis_dir, f'{file_name}_combined_visualization.png') if save_vis_dir else f'{file_name}_combined_visualization.png'
                if save_vis_dir:
                    plt.savefig(combined_path, dpi=300, bbox_inches='tight')
                else:
                    plt.savefig(f'{file_name}_combined_visualization.png', dpi=300, bbox_inches='tight')
                plt.close()
                logger.info('已保存组合可视化图像: %s', combined_path)
                return combined_path

            # 1. 加载yolov11(2).pt做第一次分割
            seg1_model_path = os.path.join(project_root, 'model', 'yolov11(2).pt')
            seg1_model = self.load_yolo_model(seg1_model_path)
            if seg1_model is None:
                return {'sub_ppd_values': [], 'avg_ppd': None, 'error_code': 'SEG1_MODEL_LOAD_FAIL', 'error_message': '无法加载第一次分割模型'}
            # 读取图片
            img = cv2.imread(image_path)
            if img is None:
                return {'sub_ppd_values': [], 'avg_ppd': None, 'error_code': 'IMG_READ_FAIL', 'error_message': f'无法读取图片: {image_path}'}
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            original_pil = PILImage.fromarray(img_rgb)
            
            # 获取文件名（不含扩展名）
            file_name = os.path.splitext(os.path.basename(image_path))[0]
            
            # 保存原图
            vis_paths = {}
            if save_vis_dir:
                os.makedirs(save_vis_dir, exist_ok=True)
            
            # 第一次分割
            detections1 = seg1_model(image_path, conf=confidence_threshold, save=False)
            cut_imgs = []
            if detections1 and len(detections1) > 0:
                boxes = detections1[0].boxes
                logger.info('第一次分割检测到的目标数: %s', len(boxes))
                for i, box in enumerate(boxes.xyxy):
                    x1, y1, x2, y2 = map(int, box.cpu().numpy())
                    # 确保坐标在图像范围内
                    x1, x2 = max(0, x1), min(img_rgb.shape[1], x2)
                    y1, y2 = max(0, y1), min(img_rgb.shape[0], y2)
                    
                    cut_img = img_rgb[y1:y2, x1:x2].copy()
                    cut_imgs.append(cut_img)
                    if save_vis_dir:
                        cut1_path = os.path.join(save_vis_dir, f'result_cut1_{i+1}.jpg')
                        PILImage.fromarray(cut_img).save(cut1_path)
                        vis_paths[f'cut1_{i+1}'] = cut1_path
            else:
                logger.warning('第一次分割未检测到任何目标')
                # 如果没有检测到目标，使用整个图像
                cut_imgs.append(img_rgb)
                if save_vis_dir:
                    cut1_path = os.path.join(save_vis_dir, 'result_cut1_1.jpg')
                    PILImage.fromarray(img_rgb).save(cut1_path)
                    vis_paths['cut1_1'] = cut1_path
            
            # 2. 加载yolov11(1).pt做第二次分割
            seg2_model_path = os.path.join(project_root, 'model', 'yolov11(1).pt')
            seg2_model = self.load_yolo_model(seg2_model_path)
            if seg2_model is None:
                return {'sub_ppd_values': [], 'avg_ppd': None, 'error_code': 'SEG2_MODEL_LOAD_FAIL', 'error_message': '无法加载第二次分割模型'}
            
            # 存储第二次分割的结果
            sub_images = []
            
            # 创建临时目录用于保存中间图像
            temp_dir = tempfile.gettempdir()
            
            # 第二次分割
            for idx, cut_img in enumerate(cut_imgs):
                # 保存临时图像用于YOLO推理
                temp_path = os.path.join(temp_dir, f'temp_cut1_{idx+1}.png')
                cv2.imwrite(temp_path, cv2.cvtColor(cut_img, cv2.COLOR_RGB2BGR))
                
                detections2 = seg2_model(temp_path, conf=confidence_threshold, save=False)
                if detections2 and len(detections2) > 0:
                    boxes2 = detections2[0].boxes
                    logger.info('第二次分割（第%s个区域）检测到的目标数: %s', idx + 1, len(boxes2))
                    for j, box2 in enumerate(boxes2.xyxy):
                        x1, y1, x2, y2 = map(int, box2.cpu().numpy())
                        # 确保坐标在图像范围内
                        x1, x2 = max(0, x1), min(cut_img.shape[1], x2)
                        y1, y2 = max(0, y1), min(cut_img.shape[0], y2)
                        
                        sub_img = cut_img[y1:y2, x1:x2].copy()
                        sub_images.append(sub_img)
                        if save_vis_dir:
                            subimg_path = os.path.join(save_vis_dir, f'result_cut2_{len(sub_images)}.jpg')
                            PILImage.fromarray(sub_img).save(subimg_path)
                            vis_paths[f'cut2_{len(sub_images)}'] = subimg_path
                else:
                    logger.warning('第二次分割（第%s个区域）未检测到任何目标', idx + 1)
                    # 如果没有检测到目标，使用整个切割图像
                    sub_images.append(cut_img)
                    if save_vis_dir:
                        subimg_path = os.path.join(save_vis_dir, f'result_cut2_{len(sub_images)}.jpg')
                        PILImage.fromarray(cut_img).save(subimg_path)
                        vis_paths[f'cut2_{len(sub_images)}'] = subimg_path
            
            # 3. 加载DeepLabV3模型
            deeplab_model, device = load_deeplab_model()
            transform = get_deeplab_transform()
            
            # 使用DeepLabV3对子图进行预测
            predictions = []
            sub_ppd_values = []
            overlay_imgs = []
            
            for i, sub_img in enumerate(sub_images[:3]):  # 最多处理3个子图
                try:
                    # 转换为PIL图像
                    sub_pil = PILImage.fromarray(sub_img)
                    
                    # 获取木薯区域mask
                    cassava_mask = get_cassava_area_mask(sub_img)
                    
                    # 应用mask到图像上，将背景区域设为黑色
                    masked_sub_img = sub_img.copy()
                    masked_sub_img[cassava_mask == 0] = [0, 0, 0]
                    masked_sub_pil = PILImage.fromarray(masked_sub_img)
                    
                    # 使用DeepLabV3进行预测
                    pred = predict_with_deeplab(deeplab_model, masked_sub_pil, device, transform)
                    
                    # 在子图上叠加预测结果
                    overlay = overlay_predictions_on_image(masked_sub_pil, pred)
                    overlay_pil = PILImage.fromarray(overlay)
                    
                    predictions.append((masked_sub_pil, overlay_pil, pred))
                    overlay_imgs.append(overlay_pil)
                    
                    # 计算PPD值
                    # 调整大小以匹配预测结果
                    if cassava_mask.shape != pred.shape:
                        cassava_mask_img = PILImage.fromarray(cassava_mask)
                        cassava_mask_img = cassava_mask_img.resize(pred.shape[::-1], PILImage.Resampling.NEAREST)
                        cassava_mask = np.array(cassava_mask_img)
                    
                    # 只计算在木薯区域内的预测腐烂区域
                    pred_rotten_in_cassava = pred * cassava_mask
                    
                    # 计算面积
                    cassava_pixels = np.count_nonzero(cassava_mask)
                    pred_rotten_pixels = np.count_nonzero(pred_rotten_in_cassava)
                    
                    # 计算PPD值（预测腐烂面积/木薯面积）
                    ppd = pred_rotten_pixels / cassava_pixels if cassava_pixels > 0 else 0.0
                    sub_ppd_values.append(ppd)
                    
                    if save_vis_dir:
                        overlay_path = os.path.join(save_vis_dir, f'result_pred_{i+1}.jpg')
                        overlay_pil.save(overlay_path)
                        vis_paths[f'pred_{i+1}'] = overlay_path
                        
                except Exception as e:
                    logger.exception("处理第 %s 张子图时失败: %s", i + 1, e)
                    traceback.print_exc()
                    # 即使某个子图处理失败，也继续处理其他子图
                    sub_ppd_values.append(0.0)
                    # 创建默认overlay
                    if isinstance(sub_img, np.ndarray):
                        overlay = PILImage.fromarray(sub_img)
                    else:
                        overlay = PILImage.new('RGB', (256, 256), (0,0,0))
                    overlay_imgs.append(overlay)
                    if save_vis_dir:
                        overlay_path = os.path.join(save_vis_dir, f'result_pred_{i+1}.jpg')
                        overlay.save(overlay_path)
                        vis_paths[f'pred_{i+1}'] = overlay_path
                    continue
            
            # 确保有三个PPD值
            while len(sub_ppd_values) < 3:
                sub_ppd_values.append(0.0)
            
            # 计算平均PPD值
            avg_ppd = sum(sub_ppd_values) / len(sub_ppd_values) if sub_ppd_values else 0
            
            # 创建组合可视化图像
            if save_vis_dir and predictions:
                try:
                    combined_path = create_visualization(file_name, original_pil, sub_images, predictions)
                    vis_paths['combined'] = combined_path
                except Exception as e:
                    logger.exception("创建组合可视化图像时出错: %s", e)
                    traceback.print_exc()
            
            return {'sub_ppd_values': sub_ppd_values, 'avg_ppd': avg_ppd, 'error_code': None, 'error_message': None, 'vis_paths': vis_paths}
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'sub_ppd_values': [], 'avg_ppd': None, 'error_code': 'UNKNOWN', 'error_message': str(e)}

# 创建服务实例
deeplabv3plus_service = DeepLabV3PlusService()
