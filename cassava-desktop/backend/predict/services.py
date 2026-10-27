import logging
import os
import shutil
import tempfile
import uuid
from collections import OrderedDict
from io import BytesIO
from pathlib import Path
from typing import Union, List, Tuple

import albumentations as A
import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from django.conf import settings

from .m6_predictor import m6_best_predictor

# 设置日志
logger = logging.getLogger(__name__)

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
    
    # 填充孔洞
    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled_mask = np.zeros_like(binary_mask)
    cv2.drawContours(filled_mask, contours, -1, 1, -1)  # -1 means fill
    
    return filled_mask


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

    # 路径遍历保护：拒绝包含 .. 或危险字符的路径
    if '..' in model_path or model_path.replace('\\', '/').startswith('/'):
        logger.warning(f"Model path rejected (potential path traversal): {model_path}")
        return None

    # 检查文件名安全（不能包含路径分隔符）
    if '/' in model_path or '\\' in model_path:
        # 如果传入的是路径，提取文件名部分
        basename = os.path.basename(model_path)
        if not basename or '..' in basename:
            logger.warning(f"Model path rejected (invalid filename): {model_path}")
            return None
        model_filename = basename
    else:
        model_filename = model_path

    candidate_paths = []
    if os.path.isabs(model_path):
        candidate_paths.append(model_path)
    else:
        candidate_paths.append(model_path)
        candidate_paths.append(os.path.abspath(model_path))

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
        if os.environ.get('USE_CPU_ONLY', '').lower() in ('1', 'true', 'yes'):
            logger.info("USE_CPU_ONLY=1，强制使用 CPU 进行推理。")
            return torch.device('cpu')
        if torch.cuda.is_available():
            try:
                torch.zeros(1, device='cuda')
                return torch.device('cuda')
            except Exception:
                logger.warning("CUDA 不可用，自动回退到 CPU。")
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
            configured_root = os.getenv("ULTRALYTICS_SOURCE_DIR", "").strip()
            fallback_roots = [Path(configured_root)] if configured_root else []
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
            raise ModuleNotFoundError(
                "No module named 'ultralytics'. "
                "请在打包环境安装 ultralytics，或设置 ULTRALYTICS_SOURCE_DIR 指向本地源码目录。"
            )

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
        """
        使用非极大值抑制（NMS）风格的算法去重检测框。
        优化：按置信度排序后，使用网格空间分区减少IoU计算次数。
        时间复杂度：O(n * k) 其中 k 是平均每个位置的邻居数量，远小于 n。
        """
        if not boxes:
            return []

        sorted_boxes = sorted(boxes, key=lambda item: item[4], reverse=True)
        if len(sorted_boxes) <= 1:
            return sorted_boxes

        # 计算所有框的边界用于网格分区
        all_coords = [(box[0], box[1], box[2], box[3]) for box in sorted_boxes]
        min_x = min(c[0] for c in all_coords)
        min_y = min(c[1] for c in all_coords)
        max_x = max(c[2] for c in all_coords)
        max_y = max(c[3] for c in all_coords)

        # 网格大小：基于平均框大小的2倍
        avg_width = (max_x - min_x) / max(len(boxes), 1)
        avg_height = (max_y - min_y) / max(len(boxes), 1)
        grid_size = max(avg_width, avg_height, 1) * 2 or 1

        def get_grid_cells(x1, y1, x2, y2):
            """获取框覆盖的所有网格单元"""
            cells = set()
            cell_x1 = max(0, int(x1 / grid_size))
            cell_y1 = max(0, int(y1 / grid_size))
            cell_x2 = max(0, int(x2 / grid_size))
            cell_y2 = max(0, int(y2 / grid_size))
            for cx in range(cell_x1, cell_x2 + 1):
                for cy in range(cell_y1, cell_y2 + 1):
                    cells.add((cx, cy))
            return cells

        # 构建网格索引：cell -> [box_indices]
        grid = {}
        for idx, box in enumerate(sorted_boxes):
            x1, y1, x2, y2 = box[0], box[1], box[2], box[3]
            for cell in get_grid_cells(x1, y1, x2, y2):
                if cell not in grid:
                    grid[cell] = []
                grid[cell].append(idx)

        kept = []
        kept_indices = set()

        for idx, candidate in enumerate(sorted_boxes):
            if idx in kept_indices:
                continue

            x1, y1, x2, y2 = candidate[0], candidate[1], candidate[2], candidate[3]
            candidate_cells = get_grid_cells(x1, y1, x2, y2)

            # 收集邻居候选框（只检查同网格或相邻网格的框）
            neighbor_indices = set()
            for cell in candidate_cells:
                # 检查当前cell及相邻的8个cell
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        neighbor_cell = (cell[0] + dx, cell[1] + dy)
                        if neighbor_cell in grid:
                            neighbor_indices.update(grid[neighbor_cell])

            # 只与更高置信度的框（排在前面的，已在kept中的）比较
            should_keep = True
            for neighbor_idx in neighbor_indices:
                if neighbor_idx in kept_indices:
                    existing = sorted_boxes[neighbor_idx]
                    if self._compute_iou(candidate[:4], existing[:4]) >= iou_threshold:
                        should_keep = False
                        break

            if should_keep:
                kept.append(candidate)
                kept_indices.add(idx)

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

            # 检查模型是否已缓存
            if model_path in self.models:
                logger.info(f"从缓存加载模型: {model_path}")
                return self.models[model_path]

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
            self.models[model_path] = model
            
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

        # 清理已存在的模型
        for path in list(self.models.keys()):
            if path not in seen_paths:
                # 从缓存中移除不需要的模型
                del self.models[path]
        
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
                image = Image.open(image_path).convert('RGB')
                original_image = np.array(image)
            else:
                # 处理BytesIO对象（如上传文件）
                image = Image.open(image_path).convert('RGB')
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
        expected_count=3,
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

    def predict_ppd(self, models, image_path, confidence_threshold=0.5, min_area=100, morph_kernel_size=5, morph_iterations=1, use_ensemble=True, ensemble_method='average', ensemble_weights=None):
        """
        多模型集成推理，移植ensemble_utils.py的ensemble_predict逻辑，保证与本地一致。
        """
        import torch
        from torchvision import transforms as T
        from PIL import Image as PILImage
        import numpy as np
        # 1. 读取图片并transform
        img = PILImage.open(image_path).convert('RGB')
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
                output = models[model_key](img_tensor)
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
            
            if ensemble_method == 'average':
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
                print(f"PPD计算日志: 图片={image_path}, 腐烂面积(rot_pixels)={rot_pixels}, 木薯心面积=0，图片总面积(total_pixels)={total_pixels}, PPD=0（木薯心面积为0，跳过计算）")
            else:
                ppd = (pred_rotten_pixels / cassava_pixels) * 100
                print(f"PPD计算日志: 图片={image_path}, 腐烂面积(rot_pixels)={pred_rotten_pixels}, 木薯心面积={cassava_pixels}, 图片总面积(total_pixels)={total_pixels}, PPD={ppd:.4f}")
            
            # 可视化
            mask = pred == 1
            img_array = np.array(img)
            overlay_img = img_array.copy()
            
            # 确保即使没有掩码也返回有效的overlay图像
            if np.any(mask):
                overlay_img[mask] = overlay_img[mask] * 0.7 + np.array([255, 0, 0]) * 0.3
            else:
                # 如果没有检测到腐烂区域，仍然返回原始图像
                print("未检测到腐烂区域，返回原始图像作为overlay")
            
            # 确保overlay_img不为None
            if overlay_img is None:
                overlay_img = img_array.copy()
                print("overlay_img为None，使用原始图像替代")
            
            from PIL import Image as PILImage
            overlay_image = PILImage.fromarray(overlay_img)
            return ppd, overlay_image

    def predict_ppd_m6(self, image_path, confidence_threshold=0.5, min_area=100, morph_kernel_size=5, morph_iterations=1, patch_size=(512, 512), stride=(256, 256), overlay_opacity=0.45):
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
        )

        mask = result["mask"]
        img = Image.open(image_path).convert('RGB')
        img_array = np.array(img)

        cassava_mask = self.get_cassava_area_mask(img_array)
        if cassava_mask.shape != mask.shape:
            cassava_mask_img = Image.fromarray(cassava_mask)
            cassava_mask_img = cassava_mask_img.resize(mask.shape[::-1], Image.Resampling.NEAREST)
            cassava_mask = np.array(cassava_mask_img)

        pred_rotten_in_cassava = mask * cassava_mask
        cassava_pixels = np.count_nonzero(cassava_mask)
        pred_rotten_pixels = np.count_nonzero(pred_rotten_in_cassava)
        ppd = (pred_rotten_pixels / cassava_pixels) * 100 if cassava_pixels > 0 else 0.0
        return ppd, result["overlay_image"]
    
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
            img_bgr = image if len(image.shape) == 3 and image.shape[2] == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        
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
                            ensemble_method='weighted_average', 
                            ensemble_weights=None,
                            single_model_type='resnet101',
                            patch_size=(512, 512),
                            stride=(256, 256),
                            overlay_opacity=0.45,
                            stage1_confidence=None,
                            stage2_confidence=None,
                            roi_padding=0.10,
                            fallback_roi_padding=0.70,
                            expected_count=3,
                            stage_box_iou=0.50):
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
            seg1_model_path = str(
                getattr(settings, 'YOLO_STAGE1_MODEL_PATH', os.path.join(settings.BASE_DIR.parent, 'model', 'yolov11(2).pt'))
            )
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
            seg2_model_path = str(
                getattr(settings, 'YOLO_STAGE2_MODEL_PATH', os.path.join(settings.BASE_DIR.parent, 'model', 'yolov11(1).pt'))
            )
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
                
            # 加载PPD预测模型
            if single_model_type == 'm6_best':
                model = 'm6_best'
            elif use_ensemble:
                model_paths = getattr(settings, 'ENSEMBLE_MODELS', None)
                if not model_paths:
                    model_paths = [
                        getattr(settings, 'DEEPLABV3_RESNET50_PATH', None),
                        getattr(settings, 'DEEPLABV3_RESNET101_PATH', None),
                        getattr(settings, 'DEEPLABV3_MOBILENET_PATH', None)
                    ]
                model_paths = [p for p in model_paths if p]
                model = self.load_ensemble_models(model_paths)
                if len(model) == 1:
                    logger.warning("仅检测到 1 个可用 DeepLab 模型，集成预测自动回退为单模型推理。")
                    model = model[0]
                    use_ensemble = False
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
                model_key = single_model_type if single_model_type in model_path_map else 'resnet101'
                model_path = model_path_map.get(model_key)
                model_type = model_type_map.get(model_key, 'deeplabv3plus_resnet101')
                model = self.load_model(model_path, model_type=model_type)
                
            if model is None:
                return {"error": "无法加载PPD预测模型"}
                
            # 执行PPD预测
            all_predictions = []
            for seg2_result in all_seg2_results:
                seg2_image_path = seg2_result["image_path"]
                
                try:
                    if single_model_type == 'm6_best':
                        ppd, overlay_image = self.predict_ppd_m6(
                            image_path=seg2_image_path,
                            confidence_threshold=confidence_threshold,
                            min_area=min_area,
                            morph_kernel_size=morph_kernel_size,
                            morph_iterations=morph_iterations,
                            patch_size=patch_size,
                            stride=stride,
                            overlay_opacity=overlay_opacity,
                        )
                    else:
                        ppd, overlay_image = self.predict_ppd(
                            model,
                            seg2_image_path,
                            confidence_threshold,
                            min_area,
                            morph_kernel_size,
                            morph_iterations,
                            use_ensemble,
                            ensemble_method,
                            ensemble_weights
                        )
                except Exception as e:
                    logger.error(f"PPD预测失败: {e}")
                    continue
                
                # 构建预测结果字典
                prediction = {
                    "ppd": ppd,
                    "overlay_image": overlay_image, # PIL Image object
                    "segment_info": {
                        "seg1_id": seg2_result.get("parent_id"),
                        "seg2_id": seg2_result.get("id"),
                        # 传递文件路径以便后续处理
                        "seg2_image_path": seg2_image_path
                    }
                }
                all_predictions.append(prediction)
            
            # 计算平均PPD值
            if all_predictions:
                ppd_values = [pred.get("ppd", 0) for pred in all_predictions]
                avg_ppd = sum(ppd_values) / len(ppd_values) if ppd_values else 0
            else:
                avg_ppd = 0
                
            return {
                "success": True,
                "original_image": image_path,
                "segments_count": len(all_seg2_results),
                "predictions_count": len(all_predictions),
                "predictions": all_predictions,
                "average_ppd": avg_ppd,
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
                model_key = single_model_type if single_model_type in model_path_map else 'resnet101'
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
                    img_bgr = image if len(image.shape) == 3 and image.shape[2] == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                
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
                if os.getenv("DESKTOP_DEBUG_VIS", "0").strip().lower() not in ("1", "true", "yes", "on"):
                    return None

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
                print(f'已保存组合可视化图像: {combined_path}')
                return combined_path

            # 1. 加载yolov11(2).pt做第一次分割
            seg1_model_path = str(
                getattr(settings, 'YOLO_STAGE1_MODEL_PATH', os.path.join(project_root, 'model', 'yolov11(2).pt'))
            )
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
                print(f'第一次分割检测到的目标数: {len(boxes)}')
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
                print('第一次分割未检测到任何目标')
                # 如果没有检测到目标，使用整个图像
                cut_imgs.append(img_rgb)
                if save_vis_dir:
                    cut1_path = os.path.join(save_vis_dir, 'result_cut1_1.jpg')
                    PILImage.fromarray(img_rgb).save(cut1_path)
                    vis_paths['cut1_1'] = cut1_path
            
            # 2. 加载yolov11(1).pt做第二次分割
            seg2_model_path = str(
                getattr(settings, 'YOLO_STAGE2_MODEL_PATH', os.path.join(project_root, 'model', 'yolov11(1).pt'))
            )
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
                    print(f'第二次分割（第{idx+1}个区域）检测到的目标数: {len(boxes2)}')
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
                    print(f'第二次分割（第{idx+1}个区域）未检测到任何目标')
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
                    print(f"[ERROR] Exception in processing sub image {i+1}: {e}")
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
                    if combined_path:
                        vis_paths['combined'] = combined_path
                except Exception as e:
                    print(f"创建组合可视化图像时出错: {e}")
                    traceback.print_exc()
            
            return {'sub_ppd_values': sub_ppd_values, 'avg_ppd': avg_ppd, 'error_code': None, 'error_message': None, 'vis_paths': vis_paths}
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'sub_ppd_values': [], 'avg_ppd': None, 'error_code': 'UNKNOWN', 'error_message': str(e)}

# 创建惰性代理：避免 torch 模型在 services.py 导入时就加载
# 只有真正调用 integrated_prediction 等方法时才实例化 DeepLabV3PlusService
class _LazyServiceProxy:
    _instance = None

    def __getattr__(self, name):
        if _LazyServiceProxy._instance is None:
            _LazyServiceProxy._instance = DeepLabV3PlusService()
        return getattr(_LazyServiceProxy._instance, name)

    def __dir__(self):
        if _LazyServiceProxy._instance is None:
            _LazyServiceProxy._instance = DeepLabV3PlusService()
        return dir(_LazyServiceProxy._instance)

deeplabv3plus_service = _LazyServiceProxy()


# 以下是新增的业务服务类，用于业务逻辑处理


class BaseService:
    """
    基础服务类，提供通用功能
    """
    @classmethod
    def get_model(cls, model_name):
        """
        获取指定的模型类
        
        Args:
            model_name: 模型名称
            
        Returns:
            Model: Django模型类
        """
        from django.apps import apps
        return apps.get_model('predict', model_name)


class ImageService(BaseService):
    """
    图像服务类，处理图像相关的业务逻辑
    """

    SUPPORTED_UPLOAD_FORMATS = {'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF'}
    CONVERTIBLE_UPLOAD_FORMATS = {'MPO'}

    @staticmethod
    def _normalize_uploaded_image_bytes(image_data):
        verifier = Image.open(BytesIO(image_data))
        verifier.verify()
        image_format = verifier.format

        image = Image.open(BytesIO(image_data))
        if image_format in ImageService.SUPPORTED_UPLOAD_FORMATS:
            return {
                'content': image_data,
                'image': image,
                'format': image_format,
                'converted': False,
                'suggested_extension': None,
            }

        if image_format in ImageService.CONVERTIBLE_UPLOAD_FORMATS:
            try:
                image.seek(0)
            except EOFError:
                pass

            converted = image.convert('RGB')
            output = BytesIO()
            converted.save(output, format='JPEG', quality=95)
            return {
                'content': output.getvalue(),
                'image': image,
                'format': 'JPEG',
                'converted': True,
                'suggested_extension': '.jpg',
            }

        raise Exception(f"Unsupported image format: {image_format}")
    
    @staticmethod
    def upload_image(file, folder_id=None, check_duplicate=True, force=False, user=None):
        """
        上传图像文件
        
        Args:
            file: 文件对象
            folder_id: 文件夹ID
            check_duplicate: 是否检查重复
            force: 是否强制覆盖
            user: 上传用户
            
        Returns:
            tuple: (image_obj, error) 元组，image_obj为创建的图像对象，error为错误信息
        """
        from .storage_utils import build_preview_storage_key
        from django.db import transaction
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        import uuid
        from PIL.ExifTags import TAGS
        import io
        from datetime import datetime
        
        CassavaImage = ImageService.get_model('CassavaImage')
        Folder = ImageService.get_model('Folder')
        
        name = file.name
        folder = None
        if folder_id:
            try:
                folder = Folder.objects.get(id=folder_id)
            except Folder.DoesNotExist:
                folder = None
        
        if folder and user and (not user.is_superuser) and folder.owner_id != user.id:
            if not ShareService.check_permission(user, 'folder', folder, 'edit'):
                return None, ('PERMISSION_DENIED', '无权上传到该文件夹')
        
        # 检查重名
        qs = CassavaImage.objects.filter(name=name)
        if user:
            qs = qs.filter(owner=user)
            
        if folder:
            qs = qs.filter(folder=folder)
        else:
            qs = qs.filter(folder=None)
        
        if qs.exists():
            if force:
                # 覆盖：删除原图片（含OSS）
                for img in qs:
                    img.delete()
            elif check_duplicate:
                return None, ('DUPLICATE_NAME', '文件重名')
            else:
                # 自动重命名
                base, ext = name.rsplit('.', 1) if '.' in name else (name, '')
                i = 1
                new_name = f"{base}({i}).{ext}" if ext else f"{base}({i})"
                
                # 检查新名字是否重复
                check_qs = CassavaImage.objects.filter(name=new_name, folder=folder)
                if user:
                    check_qs = check_qs.filter(owner=user)
                else:
                    # 如果没有用户，且是旧数据兼容，可能不filter owner
                    # 但为了安全，如果不传user，默认只查自己的？或者全局？
                    # 假设不传user就是系统级或公开，或者不检查owner
                    pass

                while check_qs.exists():
                    i += 1
                    new_name = f"{base}({i}).{ext}" if ext else f"{base}({i})"
                    check_qs = CassavaImage.objects.filter(name=new_name, folder=folder)
                    if user:
                        check_qs = check_qs.filter(owner=user)
                name = new_name
        
        # 验证图片有效性并尝试获取EXIF
        capture_time = None
        normalized_upload = None
        try:
            # 重置文件指针
            file.seek(0)
            image_data = file.read()

            normalized_upload = ImageService._normalize_uploaded_image_bytes(image_data)
            image_data = normalized_upload['content']
            image = normalized_upload['image']
            
            # 获取EXIF数据
            exif_data = image.getexif()
            if exif_data:
                # 优先检查的标签列表
                # 36867: DateTimeOriginal (拍摄时间)
                # 36868: DateTimeDigitized (数字化时间)
                # 306: DateTime (修改时间)
                date_tags = [36867, 36868, 306]
                
                for tag_id in date_tags:
                    if tag_id in exif_data:
                        date_str = exif_data[tag_id]
                        try:
                            # 尝试解析EXIF日期时间字符串 "YYYY:MM:DD HH:MM:SS"
                            # 有些设备可能会在字符串末尾包含null字符或其他非标准格式
                            clean_date_str = str(date_str).strip().replace('\x00', '')
                            capture_time = datetime.strptime(clean_date_str, '%Y:%m:%d %H:%M:%S')
                            if capture_time:
                                break
                        except (ValueError, TypeError):
                            continue
            
            # 重置文件指针以供后续使用
            file.seek(0)
        except Exception as e:
            logger.warning(f"无效图片文件: {e}")
            return None, ('INVALID_IMAGE', f"Invalid image file: {str(e)}")
        
        import os
        _, ext = os.path.splitext(name)
        safe_ext = normalized_upload.get('suggested_extension') or (ext or '').lower()
        if folder:
            storage_key = f"images/{folder.id}/{uuid.uuid4().hex}{safe_ext}"
        else:
            storage_key = f"images/{uuid.uuid4().hex}{safe_ext}"
        data = image_data
        saved_path = default_storage.save(storage_key, ContentFile(data))

        preview_oss_key = None
        try:
            preview_image = image.copy()
            if preview_image.mode in ('RGBA', 'P'):
                preview_image = preview_image.convert('RGB')

            preview_image.thumbnail((600, 600))
            thumb_io = io.BytesIO()
            preview_image.save(thumb_io, format='JPEG', quality=60)
            preview_content = thumb_io.getvalue()
            preview_path = build_preview_storage_key(folder=folder)

            preview_oss_key = default_storage.save(preview_path, ContentFile(preview_content))
        except Exception as exc:
            logger.warning(f"预览图生成失败: {exc}")
        
        # 创建图像记录
        real_size = len(data)
        image = CassavaImage.objects.create(
            name=name,
            image=saved_path,
            preview_oss_key=preview_oss_key,
            size=real_size,
            folder=folder,
            capture_time=capture_time,
            owner=user
        )
        
        return image, None
    
    @staticmethod
    def upload_single_image(file, folder_id=None, check_duplicate=True, force=False, user=None):
        image, error = ImageService.upload_image(
            file=file,
            folder_id=folder_id,
            check_duplicate=check_duplicate,
            force=force,
            user=user
        )
        if error:
            code, message = error
            if code == 'DUPLICATE_NAME':
                return ('DUPLICATE_NAME', message)
            raise Exception(message)
        return image
    
    @staticmethod
    def batch_upload_images(files, folder_id=None, check_duplicate=True, force=False, user=None):
        results = []
        success_count = 0
        for file in files:
            try:
                image, error = ImageService.upload_image(
                    file=file,
                    folder_id=folder_id,
                    check_duplicate=check_duplicate,
                    force=force,
                    user=user
                )
                if error:
                    code, message = error
                    results.append({
                        "name": getattr(file, "name", ""),
                        "success": False,
                        "code": code,
                        "message": message
                    })
                else:
                    success_count += 1
                    results.append({
                        "name": image.name,
                        "success": True,
                        "id": image.id
                    })
            except Exception as e:
                results.append({
                    "name": getattr(file, "name", ""),
                    "success": False,
                    "code": "ERROR",
                    "message": str(e)
                })
        return {
            "success_count": success_count,
            "total": len(files),
            "results": results
        }
    
    @staticmethod
    def batch_upload_from_request(request, user=None):
        """
        从请求中批量上传图片，支持ZIP或多文件
        """
        files = request.FILES.getlist('files')
        if not files and 'file' in request.FILES:
            files = [request.FILES['file']]
        if not files:
            raise Exception("未提供文件")
        folder_id = request.data.get('folder_id')
        check_duplicate = request.data.get('check_duplicate', '1') == '1'
        force = request.data.get('force', '0') == '1'
        return ImageService.batch_upload_images(
            files=files,
            folder_id=folder_id,
            check_duplicate=check_duplicate,
            force=force,
            user=user
        )
    
    @staticmethod
    def delete_image(image_id):
        """
        删除图像
        
        Args:
            image_id: 图像ID
            
        Returns:
            tuple: (success, error) 元组
        """
        CassavaImage = ImageService.get_model('CassavaImage')
        try:
            image = CassavaImage.objects.get(id=image_id)
            # 删除数据库记录
            image.delete()
            return True, None
        except CassavaImage.DoesNotExist:
            return False, ('NOT_FOUND', '图像不存在')
        except Exception as e:
            logger.error(f"删除图像失败: {e}")
            return False, ('ERROR', str(e))
    
    @staticmethod
    def delete_image_with_file(image):
        """
        根据实例删除图像及其在OSS中的文件
        """
        try:
            image.delete()
            return True
        except Exception as e:
            logger.error(f"删除图像失败: {e}")
            return False
    
    @staticmethod
    def get_image_details(image_id):
        """
        获取图像详细信息
        
        Args:
            image_id: 图像ID
            
        Returns:
            CassavaImage对象或None
        """
        CassavaImage = ImageService.get_model('CassavaImage')
        try:
            return CassavaImage.objects.get(id=image_id)
        except CassavaImage.DoesNotExist:
            return None


class SegmentationService(BaseService):
    """
    分割服务类，处理图像分割相关的业务逻辑
    """
    
    @staticmethod
    def create_segmentation_result(original_image, result_image_path, result_data, segmentation_type):
        """
        创建分割结果记录
        
        Args:
            original_image: 原始图像对象
            result_image_path: 结果图像路径
            result_data: 分割结果数据
            segmentation_type: 分割类型 ('first' 或 'second')
            
        Returns:
            SegmentationResult对象
        """
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage

        SegmentationResult = SegmentationService.get_model('SegmentationResult')

        result_storage_key = f"segmentations/{uuid.uuid4()}.png"
        with open(result_image_path, 'rb') as f:
            result_data_bytes = f.read()
        saved_path = default_storage.save(result_storage_key, ContentFile(result_data_bytes))
        
        # 创建分割结果记录
        description = ""
        if result_data is not None:
            try:
                import json
                description = json.dumps(result_data, ensure_ascii=False)
            except Exception:
                description = str(result_data)
        
        result = SegmentationResult.objects.create(
            image=original_image,
            result_mask=saved_path,
            algorithm=str(segmentation_type or 'segment_anything'),
            parameters=result_data or {},
            status='completed',
            metrics={},
        )
        
        return result
    
    @staticmethod
    def get_segmentations_by_image(image_id):
        """
        获取指定图像的所有分割结果
        
        Args:
            image_id: 图像ID
            
        Returns:
            SegmentationResult查询集
        """
        SegmentationResult = SegmentationService.get_model('SegmentationResult')
        return SegmentationResult.objects.filter(image_id=image_id)
    
    @staticmethod
    def get_segmentation_results(segmentation_type=None, original_image_id=None, parent_segmentation_id=None, user=None):
        SegmentationResult = SegmentationService.get_model('SegmentationResult')
        qs = SegmentationResult.objects.all()
        
        # 权限过滤：只能查看自己拥有的图片的分割结果，或者共享给自己的
        # 目前简化为：如果图片的owner是自己
        if user and not user.is_superuser:
            qs = qs.filter(image__owner=user)
            
        if segmentation_type:
            qs = qs.filter(algorithm=segmentation_type)
        if original_image_id:
            qs = qs.filter(image_id=original_image_id)
        return qs.order_by('-created_at')
    
    @staticmethod
    def delete_segmentation_result(segmentation):
        segmentation.delete()


class PredictionService(BaseService):
    """
    预测服务类，处理PPD预测相关的业务逻辑
    """
    
    @staticmethod
    def create_prediction_result(segmentation_result, prediction_value, result_image_path, model_info):
        """
        创建预测结果记录
        
        Args:
            segmentation_result: 分割结果对象
            prediction_value: 预测值
            result_image_path: 结果图像路径
            model_info: 模型信息
            
        Returns:
            PredictionResult对象
        """
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage

        PredictionResult = PredictionService.get_model('PredictionResult')

        result_storage_key = f"predictions/{uuid.uuid4()}.png"
        with open(result_image_path, 'rb') as f:
            result_data_bytes = f.read()
        saved_path = default_storage.save(result_storage_key, ContentFile(result_data_bytes))
        
        # 创建预测结果记录
        model_type = model_info
        if isinstance(model_info, dict):
            model_type = model_info.get('model_type') or model_info.get('model') or 'YOLOv11'
        result = PredictionResult.objects.create(
            image=segmentation_result.image,
            ppd_value=prediction_value,
            result_image=saved_path,
            algorithm=str(model_type),
            status='completed',
        )
        
        return result

    @staticmethod
    def _parse_prediction_params(params=None):
        params = params or {}
        advanced = params.get('parameters') if isinstance(params.get('parameters'), dict) else {}
        raw_model = str(
            params.get('single_model_type') or params.get('modelType') or params.get('algorithm') or 'yolo_m6_best'
        ).strip().lower()

        pipeline = 'direct'
        single_model_type = raw_model
        model_label = raw_model
        if raw_model in ('yolo', 'yolo_m6', 'yolo_m6_best', 'yolov11', 'yolo11'):
            pipeline = 'yolo'
            single_model_type = 'm6_best'
            model_label = 'YOLO 两阶段 + M6 Best'
        elif raw_model in ('yolo_resnet101', 'resnet101', 'deeplabv3plus_resnet101'):
            pipeline = 'yolo'
            single_model_type = 'resnet101'
            model_label = 'YOLO 两阶段 + DeepLabV3+ ResNet101'
        elif raw_model in ('yolo_resnet50', 'resnet50', 'deeplabv3plus_resnet50'):
            pipeline = 'yolo'
            single_model_type = 'resnet50'
            model_label = 'YOLO 两阶段 + DeepLabV3+ ResNet50'
        elif raw_model in ('yolo_mobilenet', 'mobilenet', 'deeplabv3plus_mobilenet'):
            pipeline = 'yolo'
            single_model_type = 'mobilenet'
            model_label = 'YOLO 两阶段 + DeepLabV3+ MobileNet'
        elif raw_model in ('m6_best', 'm6_direct'):
            single_model_type = 'm6_best'
            model_label = 'M6 Best'

        def read_hw(*values, default=None):
            for value in values:
                if value in (None, '', []):
                    continue
                return value
            return default

        def read_bool(*values, default=False):
            for value in values:
                if value is None:
                    continue
                if isinstance(value, bool):
                    return value
                if isinstance(value, str):
                    return value.strip().lower() in ('1', 'true', 'yes', 'on')
                return bool(value)
            return default

        return {
            'confidence': float(advanced.get('confidenceThreshold', params.get('confidence', 0.5))),
            'use_ensemble': read_bool(
                params.get('use_ensemble'),
                params.get('predictionMode') == 'ensemble',
                default=False
            ),
            'single_model_type': str(
                single_model_type
            ),
            'model_label': str(
                model_label
            ),
            'pipeline': pipeline,
            'min_area': int(advanced.get('minArea', params.get('min_area', 100))),
            'morph_kernel_size': int(advanced.get('morphKernelSize', params.get('morph_kernel_size', 5))),
            'morph_iterations': int(advanced.get('morphIterations', params.get('morph_iterations', 1))),
            'use_post_processing': read_bool(
                advanced.get('usePostProcessing'),
                params.get('use_post_processing'),
                default=True
            ),
            'use_tta': read_bool(
                advanced.get('useTTA'),
                params.get('use_tta'),
                default=False
            ),
            'overlap': float(params.get('overlap', 0.2)),
            'algorithm': params.get('algorithm') or raw_model,
            'patch_size': read_hw(
                advanced.get('patchSize'),
                params.get('patch_size'),
                default=(512, 512)
            ),
            'stride': read_hw(
                advanced.get('stride'),
                params.get('stride'),
                default=(256, 256)
            ),
            'overlay_opacity': float(
                advanced.get('overlayOpacity', params.get('overlay_opacity', 0.45))
            ),
            'save_probability': read_bool(
                advanced.get('saveProbability'),
                params.get('save_probability'),
                default=False
            ),
            'stage1_confidence': float(
                advanced.get('stage1Confidence', params.get('stage1_confidence', min(float(advanced.get('confidenceThreshold', params.get('confidence', 0.5))), 0.25)))
            ),
            'stage2_confidence': float(
                advanced.get('stage2Confidence', params.get('stage2_confidence', min(float(advanced.get('confidenceThreshold', params.get('confidence', 0.5))), 0.25)))
            ),
            'roi_padding': float(
                advanced.get('roiPadding', params.get('roi_padding', 0.10))
            ),
            'fallback_roi_padding': float(
                advanced.get('fallbackRoiPadding', params.get('fallback_roi_padding', 0.70))
            ),
            'expected_count': int(
                advanced.get('expectedCount', params.get('expected_count', 3))
            ),
            'stage_box_iou': float(
                advanced.get('stageBoxIou', params.get('stage_box_iou', 0.50))
            ),
            'batch_size': int(
                advanced.get('batchSize', params.get('batch_size', 8))
            ),
            'enable_cross_section_filter': read_bool(
                advanced.get('enableCrossSectionFilter'),
                params.get('enable_cross_section_filter'),
                default=True
            ),
            'cross_section_trim_pixels': int(
                advanced.get('crossSectionTrimPixels', params.get('cross_section_trim_pixels', 4))
            ),
        }

    @staticmethod
    def _save_mask_image(mask_array, image_name, work_dir):
        mask_filename = f"{Path(str(image_name)).stem}_m6_mask.png"
        mask_path = os.path.join(work_dir, mask_filename)
        mask_uint8 = mask_array.astype(np.uint8) * 255
        ok, encoded = cv2.imencode('.png', mask_uint8)
        if not ok:
            raise RuntimeError(f"Unable to encode M6 mask for {image_name}")
        encoded.tofile(mask_path)
        return mask_path

    @staticmethod
    def _run_m6_prediction(local_image_path, prediction_params, work_dir):
        m6_result = m6_best_predictor.predict(
            image_path=local_image_path,
            confidence_threshold=prediction_params['confidence'],
            min_area=prediction_params['min_area'],
            morph_kernel_size=prediction_params['morph_kernel_size'],
            morph_iterations=prediction_params['morph_iterations'],
            patch_size=prediction_params.get('patch_size'),
            stride=prediction_params.get('stride'),
            overlay_opacity=prediction_params.get('overlay_opacity', 0.45),
            batch_size=prediction_params.get('batch_size', 8),
            enable_cross_section_filter=prediction_params.get('enable_cross_section_filter', True),
            cross_section_trim_pixels=prediction_params.get('cross_section_trim_pixels', 4),
        )

        image_name = os.path.basename(str(local_image_path))
        mask_path = PredictionService._save_mask_image(
            mask_array=m6_result['mask'],
            image_name=image_name,
            work_dir=work_dir,
        )
        height, width = m6_result['mask'].shape[:2]

        return {
            'success': True,
            'original_image': local_image_path,
            'segments_count': 1,
            'predictions_count': 1,
            'predictions': [{
                'ppd': m6_result['positive_ratio'],
                'overlay_image': m6_result['overlay_image'],
                'segment_info': {
                    'seg1_id': None,
                    'seg2_id': 'm6_full_image',
                    'seg2_image_path': mask_path,
                }
            }],
            'average_ppd': m6_result['positive_ratio'],
            'seg1_results': [],
            'seg2_results': [{
                'id': 'm6_full_image',
                'image_path': mask_path,
                'bbox': [0, 0, width, height],
                'confidence': 1.0,
                'area': int(np.count_nonzero(m6_result['mask'])),
                'parent_id': None,
            }]
        }

    @staticmethod
    def _resolve_local_image_path(image, work_dir):
        if not image:
            return None
        # 直接引用模式：使用 source_path
        source_path = getattr(image, 'source_path', None) or ''
        if source_path and os.path.isfile(source_path):
            return source_path
        if not getattr(image, 'image', None):
            return None
        image_field = image.image
        try:
            if image_field and getattr(image_field, 'path', None) and os.path.exists(image_field.path):
                return image_field.path
        except Exception:
            pass
        image_name = getattr(image_field, 'name', image_field)
        if not image_name:
            return None
        full_path = os.path.join(settings.MEDIA_ROOT, str(image_name))
        return full_path if os.path.exists(full_path) else None

    @staticmethod
    def _store_overlay_image(overlay_image):
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage

        overlay_key = f"predictions/{uuid.uuid4()}.jpg"
        image_buffer = BytesIO()
        overlay_image.save(image_buffer, format='JPEG')
        overlay_bytes = image_buffer.getvalue()

        return default_storage.save(overlay_key, ContentFile(overlay_bytes))

    @staticmethod
    def _create_prediction_result_for_image(image, result, prediction_params, processing_task=None, owner=None):
        PredictionResult = PredictionService.get_model('PredictionResult')

        seg1_map = {}
        for seg1_data in result.get("seg1_results", []):
            seg1_path = seg1_data.get("image_path")
            if not seg1_path or not os.path.exists(seg1_path):
                logger.warning(f"第一次分割结果文件不存在: {seg1_path}")
                continue

            seg1_obj = SegmentationService.create_segmentation_result(
                original_image=image,
                result_image_path=seg1_path,
                result_data={
                    "bbox": seg1_data.get("bbox"),
                    "confidence": seg1_data.get("confidence")
                },
                segmentation_type='first'
            )
            seg1_map[seg1_data.get("id")] = seg1_obj

        vis_images = {}
        seg2_results_list = result.get("seg2_results", [])

        for idx, seg2_data in enumerate(seg2_results_list):
            seg2_path = seg2_data.get("image_path")
            if not seg2_path or not os.path.exists(seg2_path):
                logger.warning(f"第二次分割结果文件不存在: {seg2_path}")
                continue

            seg2_obj = SegmentationService.create_segmentation_result(
                original_image=image,
                result_image_path=seg2_path,
                result_data={
                    "bbox": seg2_data.get("bbox"),
                    "confidence": seg2_data.get("confidence"),
                    "area": seg2_data.get("area")
                },
                segmentation_type='second'
            )

            if idx < 3:
                vis_images[f"cut2_{idx + 1}"] = str(seg2_obj.result_mask)

        sub_ppd_values = []
        predictions = result.get("predictions", [])
        main_result_image = None

        for idx, pred_data in enumerate(predictions):
            ppd = pred_data.get("ppd")
            overlay_image = pred_data.get("overlay_image")
            if ppd is not None:
                sub_ppd_values.append(ppd)

            if overlay_image is None:
                continue

            overlay_key = PredictionService._store_overlay_image(overlay_image)
            if not overlay_key:
                continue

            if idx == 0:
                main_result_image = overlay_key
            if idx < 3:
                vis_images[f"pred_{idx + 1}"] = overlay_key

        if not main_result_image:
            main_result_image = getattr(getattr(image, 'image', None), 'name', '')

        return PredictionResult.objects.create(
            image=image,
            ppd_value=result.get("average_ppd", 0),
            sub_ppd_values=sub_ppd_values,
            result_image=main_result_image,
            vis_images=vis_images,
            task=processing_task,
            split_count=len(seg2_results_list),
            algorithm=prediction_params.get('model_label', 'YOLOv11'),
            confidence=prediction_params.get('confidence', 0.5),
            status='completed',
            parameters=prediction_params,
        )

    @staticmethod
    def run_predictions_for_images(
        image_ids,
        params=None,
        owner=None,
        processing_task=None,
        stop_check=None,
        progress_callback=None
    ):
        CassavaImage = PredictionService.get_model('CassavaImage')
        normalized_ids = []
        for image_id in image_ids or []:
            try:
                parsed_id = int(image_id)
            except (TypeError, ValueError):
                continue
            if parsed_id > 0:
                normalized_ids.append(parsed_id)

        images_by_id = {
            str(image.id): image for image in CassavaImage.objects.filter(id__in=normalized_ids)
        }
        images = [images_by_id[str(image_id)] for image_id in normalized_ids if str(image_id) in images_by_id]

        prediction_params = PredictionService._parse_prediction_params(params)
        results = []
        errors = []
        processed_count = 0
        requested_count = len(normalized_ids)

        if not images:
            return {
                'results': [],
                'errors': [{'image_id': None, 'message': '没有可处理的图片'}],
                'processed_count': 0,
                'requested_count': requested_count,
            }

        work_dir = tempfile.mkdtemp()
        try:
            total_images = len(images)
            for image in images:
                # 增强取消检查：图片级别开始时检查
                if callable(stop_check) and stop_check():
                    return {
                        'results': results,
                        'errors': errors,
                        'processed_count': processed_count,
                        'requested_count': requested_count,
                        'cancelled': True,
                    }

                try:
                    local_image_path = PredictionService._resolve_local_image_path(image, work_dir)
                    if not local_image_path:
                        errors.append({'image_id': image.id, 'message': f'无法获取图片文件: {image.name}'})
                        # 图片路径解析后检查一次
                        if callable(stop_check) and stop_check():
                            return {
                                'results': results,
                                'errors': errors,
                                'processed_count': processed_count,
                                'requested_count': requested_count,
                                'cancelled': True,
                            }
                        continue

                    # 预测前再次检查（因为预测可能耗时较长）
                    if callable(stop_check) and stop_check():
                        return {
                            'results': results,
                            'errors': errors,
                            'processed_count': processed_count,
                            'requested_count': requested_count,
                            'cancelled': True,
                        }

                    if prediction_params.get('pipeline') == 'yolo':
                        prediction_result = deeplabv3plus_service.integrated_prediction(
                            local_image_path,
                            work_dir,
                            confidence_threshold=prediction_params['confidence'],
                            min_area=prediction_params['min_area'],
                            morph_kernel_size=prediction_params['morph_kernel_size'],
                            morph_iterations=prediction_params['morph_iterations'],
                            use_ensemble=prediction_params['use_ensemble'],
                            single_model_type=prediction_params['single_model_type'],
                            patch_size=prediction_params.get('patch_size', (512, 512)),
                            stride=prediction_params.get('stride', (256, 256)),
                            overlay_opacity=prediction_params.get('overlay_opacity', 0.45),
                            stage1_confidence=prediction_params.get('stage1_confidence'),
                            stage2_confidence=prediction_params.get('stage2_confidence'),
                            roi_padding=prediction_params.get('roi_padding', 0.10),
                            fallback_roi_padding=prediction_params.get('fallback_roi_padding', 0.70),
                            expected_count=prediction_params.get('expected_count', 3),
                            stage_box_iou=prediction_params.get('stage_box_iou', 0.50),
                        )
                    else:
                        m6_result = m6_best_predictor.predict(
                            local_image_path,
                            confidence_threshold=prediction_params['confidence'],
                            min_area=prediction_params['min_area'],
                            morph_kernel_size=prediction_params['morph_kernel_size'],
                            morph_iterations=prediction_params['morph_iterations'],
                            patch_size=prediction_params.get('patch_size', (512, 512)),
                            stride=prediction_params.get('stride', (256, 256)),
                            overlay_opacity=prediction_params.get('overlay_opacity', 0.45),
                            batch_size=prediction_params.get('batch_size', 8),
                        )

                        prediction_result = {
                            'seg1_results': [],
                            'seg2_results': [],
                            'predictions': [{'ppd': m6_result.get('positive_ratio', 0), 'overlay_image': m6_result.get('overlay_image')}],
                            'average_ppd': m6_result.get('positive_ratio', 0),
                            'vis_images': {},
                            'split_count': 0,
                        }

                        if "error" in m6_result:
                            message = m6_result.get('error') or '预测失败'
                            logger.error(f"预测失败 {image.name}: {message}")
                            errors.append({'image_id': image.id, 'message': str(message)})
                            continue

                    # 预测后检查（防止长图片预测后的延迟）
                    if callable(stop_check) and stop_check():
                        return {
                            'results': results,
                            'errors': errors,
                            'processed_count': processed_count,
                            'requested_count': requested_count,
                            'cancelled': True,
                        }

                    if "error" in prediction_result:
                        message = prediction_result.get('error') or '预测失败'
                        logger.error(f"预测失败 {image.name}: {message}")
                        errors.append({'image_id': image.id, 'message': str(message)})
                        continue

                    created_result = PredictionService._create_prediction_result_for_image(
                        image=image,
                        result=prediction_result,
                        prediction_params=prediction_params,
                        processing_task=processing_task,
                        owner=owner
                    )
                    results.append(created_result)
                except Exception as exc:
                    logger.error(f"处理图片 {image.id} 出错: {exc}", exc_info=True)
                    errors.append({'image_id': image.id, 'message': str(exc)})
                finally:
                    processed_count += 1
                    if callable(progress_callback):
                        progress_callback(processed_count, total_images)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        return {
            'results': results,
            'errors': errors,
            'processed_count': processed_count,
            'requested_count': requested_count,
        }
    
    @staticmethod
    def get_prediction_results(model_type=None, min_ppd=None, max_ppd=None, is_ensemble=None, segmentation_id=None, user=None):
        PredictionResult = PredictionService.get_model('PredictionResult')
        qs = PredictionResult.objects.all()
        
        # 权限过滤
        if user and not user.is_superuser:
            # 预测结果关联的原始图片的owner是当前用户
            # 或者关联的任务的owner是当前用户
            from django.db.models import Q
            qs = qs.filter(
                Q(image__owner=user) |
                Q(task__owner=user)
            )
        
        if model_type:
            qs = qs.filter(algorithm=model_type)
        if min_ppd is not None:
            qs = qs.filter(ppd_value__gte=min_ppd)
        if max_ppd is not None:
            qs = qs.filter(ppd_value__lte=max_ppd)
        if segmentation_id:
            qs = qs.filter(image__segmentation_results__id=segmentation_id)
        return qs.order_by('-prediction_time')
    
    @staticmethod
    def delete_prediction_result(prediction):
        prediction.delete()


class TaskService(BaseService):
    """
    任务服务类，处理后台任务相关的业务逻辑
    """

    @staticmethod
    def _friendly_error(message):
        raw_message = str(message or '').strip()
        lower_message = raw_message.lower()
        if not raw_message:
            return '任务执行失败。请检查图片、模型和运行环境后重试。'
        if '没有可处理的图片' in raw_message or '没有待处理的图片' in raw_message:
            return '未找到可处理的图片。请确认已选择有效图片，且外部引用图片没有被移动或删除。'
        if '无法获取图片文件' in raw_message or '无法读取图片' in raw_message or 'no such file' in lower_message:
            return '图片文件无法读取。请确认原图仍在本地、路径有效，且文件没有被占用或删除。'
        if '无法加载' in raw_message or '模型' in raw_message or 'checkpoint' in lower_message or 'model' in lower_message:
            return '模型文件未准备好或加载失败。请在模型管理中确认当前模型可用后重试。'
        if 'cuda' in lower_message or 'out of memory' in lower_message or '显存' in raw_message:
            return 'GPU 资源不足或 CUDA 环境不可用。请切换为 CPU 后重试。'
        if 'logger' in raw_message:
            return '预测服务内部配置异常。请重启桌面端后重试，若仍失败请联系维护人员。'
        if len(raw_message) > 180:
            return '任务执行失败。请检查图片、模型和运行环境后重试。'
        return raw_message

    @staticmethod
    def _format_execution_errors(errors):
        messages = []
        for error in errors[:3]:
            friendly = TaskService._friendly_error(error.get('message', '预测失败'))
            if friendly not in messages:
                messages.append(friendly)
        return '；'.join(messages) or '任务执行失败。请检查图片、模型和运行环境后重试。'
    
    @staticmethod
    def create_task(user, task_name, task_type, extra_params=None):
        """
        创建新任务
        
        Args:
            user: 用户对象
            task_name: 任务名称
            task_type: 任务类型
            extra_params: 额外参数
            
        Returns:
            ProcessingTask对象
        """
        from datetime import datetime
        
        ProcessingTask = TaskService.get_model('ProcessingTask')
        
        task = ProcessingTask.objects.create(
            name=f"{task_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            task_type=task_type,
            status="running",
            progress=0,
            owner=user if user and user.is_authenticated else None,
            **(extra_params or {})
        )
        
        return task
    
    @staticmethod
    def update_task_status(task_id, status, progress=None, error=None):
        """
        更新任务状态
        
        Args:
            task_id: 任务ID
            status: 新状态
            progress: 进度百分比
            error: 错误信息
            
        Returns:
            bool: 是否更新成功
        """
        ProcessingTask = TaskService.get_model('ProcessingTask')
        try:
            task = ProcessingTask.objects.get(id=task_id)
            task.status = status
            if progress is not None:
                task.progress = progress
            if error:
                task.error = error
            task.save()
            return True
        except ProcessingTask.DoesNotExist:
            return False
    
    @staticmethod
    def get_user_tasks(user, limit=None):
        """
        获取用户的任务列表
        
        Args:
            user: 用户对象
            limit: 返回数量限制
            
        Returns:
            ProcessingTask查询集
        """
        ProcessingTask = TaskService.get_model('ProcessingTask')
        queryset = ProcessingTask.objects.filter(owner_id=user.id).order_by('-created_at')
        if limit:
            return queryset[:limit]
        return queryset
    
    @staticmethod
    def get_tasks():
        ProcessingTask = TaskService.get_model('ProcessingTask')
        return ProcessingTask.objects.all().order_by('-created_at')
    
    @staticmethod
    def cancel_task(task):
        if task.status == 'running':
            task.status = 'cancelled'
            task.save()
            return {'success': True}
        return {'success': False, 'message': '任务当前状态不可取消'}
    
    @staticmethod
    def delete_task(task):
        task.delete()

    @staticmethod
    def execute_prediction_task(task_id, params=None):
        """
        执行预测任务（后台运行）
        """
        from django.db import close_old_connections
        
        ProcessingTask = TaskService.get_model('ProcessingTask')
        CassavaImage = TaskService.get_model('CassavaImage')
        
        close_old_connections()

        try:
            task = ProcessingTask.objects.get(id=task_id)
        except ProcessingTask.DoesNotExist:
            return {"error": "任务不存在"}
            
        try:
            task.refresh_from_db(fields=['status'])
            if task.status == 'cancelled':
                return {"cancelled": True}

            task.status = 'running'
            task.progress = 0
            task.error = None
            task.save()

            # 设置 GPU/CPU 模式
            use_gpu = params.get('use_gpu', True) if params else True
            from .m6_predictor import M6BestPredictor
            M6BestPredictor.force_device('cuda' if use_gpu else 'cpu')

            image_ids = []
            if task.image_ids:
                image_ids = list(task.image_ids)
            elif task.folder_ids:
                image_ids = list(
                    CassavaImage.objects.filter(folder_id__in=task.folder_ids).values_list('id', flat=True)
                )

            # 预过滤：排除文件已失效的图片（仅针对外部引用模式）
            valid_ids = [
                img_id for img_id in image_ids
                if not CassavaImage.objects.filter(id=img_id, storage_mode='external', file_status='missing').exists()
            ]
            skipped_count = len(image_ids) - len(valid_ids)
            if skipped_count > 0:
                logger.info(f"[Task {task_id}] Skipped {skipped_count} missing external images")

            if not valid_ids:
                friendly_error = TaskService._friendly_error("没有待处理的图片")
                task.status = 'failed'
                task.error = friendly_error
                task.save()
                return {"error": friendly_error}

            def stop_check():
                task.refresh_from_db(fields=['status'])
                return task.status == 'cancelled'

            def progress_callback(processed_count, total_count):
                progress = int((processed_count / total_count) * 100) if total_count else 0
                task.progress = progress
                task.save(update_fields=['progress', 'updated_at'])

            execution = PredictionService.run_predictions_for_images(
                image_ids=valid_ids,
                params=params,
                owner=task.owner if getattr(task, 'owner_id', None) else None,
                processing_task=task,
                stop_check=stop_check,
                progress_callback=progress_callback
            )

            if execution.get('cancelled'):
                return {"cancelled": True, "processed": execution.get('processed_count', 0)}

            if not execution.get('results'):
                task.status = 'failed'
                task.error = TaskService._format_execution_errors(execution.get('errors', []))
                task.save()
                return {"error": task.error}

            task.status = 'completed'
            task.progress = 100
            task.error = None
            task.save()
            return {
                "success": True,
                "processed": execution.get('processed_count', 0),
                "result_count": len(execution.get('results', [])),
                "errors": execution.get('errors', []),
            }
            
        except Exception as e:
            friendly_error = TaskService._friendly_error(e)
            try:
                task.status = 'failed'
                task.error = friendly_error
                task.save()
            except Exception as save_err:
                logger.error(f"任务执行失败，但状态保存失败: task_id={task_id}, error={e}, save_error={save_err}")
            logger.error(f"任务执行失败: {e}", exc_info=True)
            return {"error": friendly_error}


class FolderService(BaseService):
    """
    文件夹服务类，处理文件夹相关的业务逻辑
    """
    
    @staticmethod
    def get_user_folders(user):
        """
        获取用户的文件夹列表（包括自己拥有的和分享给自己的）
        """
        Folder = FolderService.get_model('Folder')
        if user and user.is_authenticated:
            # 使用ShareService获取可访问的资源过滤条件
            share_service = ShareService()
            q_filter = share_service.get_accessible_resources(user, 'folder')
            return Folder.objects.filter(q_filter).order_by('-created_at')
        return Folder.objects.none()
    
    @staticmethod
    def create_folder(user, name, description=""):
        """
        创建新文件夹
        
        Args:
            user: 用户对象
            name: 文件夹名称
            description: 描述
            
        Returns:
            Folder对象
        """
        Folder = FolderService.get_model('Folder')
        folder = Folder.objects.create(
            name=name,
            description=description,
            owner=user if user and user.is_authenticated else None
        )
        return folder
    
    @staticmethod
    def delete_folder(folder):
        """
        删除文件夹
        """
        from django.db import transaction
        CassavaImage = ImageService.get_model('CassavaImage')
        with transaction.atomic():
            CassavaImage.objects.filter(folder=folder).update(folder=None)
            folder.delete()
        return True
    
    @staticmethod
    def add_images_to_folder(folder, image_ids, user=None):
        """
        将图像添加到文件夹
        
        Args:
            folder: 文件夹实例
            image_ids: 图像ID列表
            user: 用户对象
            
        Returns:
            dict: 结果信息
        """
        from django.db import transaction
        
        CassavaImage = ImageService.get_model('CassavaImage')
        
        with transaction.atomic():
            updated_count = CassavaImage.objects.filter(
                id__in=image_ids
            ).update(folder=folder)
        return {
            "updated_count": updated_count
        }
    
    @staticmethod
    def remove_images_from_folder(folder, image_ids):
        """
        将图像从文件夹移除
        
        Args:
            folder: 文件夹实例
            image_ids: 图像ID列表
            
        Returns:
            dict: 结果信息
        """
        from django.db import transaction
        CassavaImage = ImageService.get_model('CassavaImage')
        with transaction.atomic():
            updated_count = CassavaImage.objects.filter(
                id__in=image_ids,
                folder=folder
            ).update(folder=None)
        return {
            "updated_count": updated_count
        }


class AuditService(BaseService):
    """
    审计日志服务类
    """
    @staticmethod
    def log_action(user, action, resource_type, resource_id, details=None, success=True, request=None):
        """
        记录操作日志
        """
        AuditLog = AuditService.get_model('AuditLog')
        
        ip_address = None
        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0]
            else:
                ip_address = request.META.get('REMOTE_ADDR')
        
        try:
            AuditLog.objects.create(
                user=user if user and user.is_authenticated else None,
                username=user.username if user and user.is_authenticated else 'Anonymous',
                action=action,
                resource=resource_type,
                resource_id=str(resource_id) if resource_id else None,
                details=details,
                success=success,
                ip_address=ip_address
            )
        except Exception as e:
            logger.error(f"记录审计日志失败: {e}")


class ShareService(BaseService):
    """
    资源共享服务类
    """
    
    @staticmethod
    def share_resource(owner, resource_type, resource_id, shared_with_username, permission='view', expires_at=None):
        """
        分享资源
        """
        from django.contrib.auth.models import User
        from django.utils import timezone
        
        ResourceShare = ShareService.get_model('ResourceShare')
        
        # 1. 验证被分享用户是否存在
        try:
            shared_with = User.objects.get(username=shared_with_username)
        except User.DoesNotExist:
            return None, "目标用户不存在"
            
        if owner.id == shared_with.id:
            return None, "不能分享给自己"
            
        # 2. 验证资源是否存在且属于当前用户
        if resource_type == 'image':
            Model = ShareService.get_model('CassavaImage')
        elif resource_type == 'folder':
            Model = ShareService.get_model('Folder')
        else:
            return None, "不支持的资源类型"
            
        try:
            resource = Model.objects.get(id=resource_id)
            if (not getattr(owner, 'is_superuser', False)) and resource.owner != owner:
                return None, "您没有权限分享此资源"
        except Model.DoesNotExist:
            return None, "资源不存在"
            
        # 3. 创建或更新分享记录
        share, created = ResourceShare.objects.update_or_create(
            resource_type=resource_type,
            resource_id=resource_id,
            shared_with=shared_with,
            defaults={
                'shared_by': owner,
                'permission': permission,
                'expires_at': expires_at
            }
        )
        
        # 清除缓存
        from django.core.cache import cache
        cache_key = f"user_shared_ids:{shared_with.id}:{resource_type}"
        cache.delete(cache_key)
        
        # 记录审计日志
        AuditService.log_action(
            user=owner,
            action='SHARE_RESOURCE',
            resource_type=resource_type,
            resource_id=resource_id,
            details={
                'shared_with': shared_with.username,
                'permission': permission,
                'expires_at': str(expires_at) if expires_at else None
            }
        )
        
        return share, None

    @staticmethod
    def revoke_share(owner, share_id):
        """
        撤销分享
        """
        ResourceShare = ShareService.get_model('ResourceShare')
        try:
            share = ResourceShare.objects.get(id=share_id)
            # 只有资源所有者或分享者可以撤销
            if share.shared_by != owner:
                return False, "无权撤销此分享"
            
            # 清除缓存
            from django.core.cache import cache
            cache_key = f"user_shared_ids:{share.shared_with.id}:{share.resource_type}"
            cache.delete(cache_key)

            # 记录审计日志
            AuditService.log_action(
                user=owner,
                action='REVOKE_SHARE',
                resource_type=share.resource_type,
                resource_id=share.resource_id,
                details={
                    'shared_with': share.shared_with.username,
                    'permission': share.permission
                }
            )
            
            share.delete()
            return True, None
        except ResourceShare.DoesNotExist:
            return False, "分享记录不存在"

    @staticmethod
    def get_my_shares(user):
        """
        获取我分享出去的资源
        """
        ResourceShare = ShareService.get_model('ResourceShare')
        return ResourceShare.objects.filter(shared_by=user).order_by('-created_at')

    @staticmethod
    def get_shared_with_me(user):
        """
        获取分享给我的资源
        """
        ResourceShare = ShareService.get_model('ResourceShare')
        from django.utils import timezone
        from django.db.models import Q
        
        now = timezone.now()
        return ResourceShare.objects.filter(
            shared_with=user
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        ).order_by('-created_at')

    @staticmethod
    def get_accessible_resources(user, resource_type):
        """
        获取用户有权访问的所有资源ID列表（包括自己的和分享给自己的）
        """
        from django.db.models import Q
        from django.utils import timezone
        from django.core.cache import cache
        
        # 尝试从缓存获取分享给该用户的资源ID列表
        cache_key = f"user_shared_ids:{user.id}:{resource_type}"
        shared_ids = cache.get(cache_key)
        
        if shared_ids is None:
            ResourceShare = ShareService.get_model('ResourceShare')
            now = timezone.now()
            
            # 1. 分享给我的资源ID
            shared_ids = list(ResourceShare.objects.filter(
                shared_with=user,
                resource_type=resource_type
            ).filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=now)
            ).values_list('resource_id', flat=True))
            
            # 缓存结果，有效期5分钟
            cache.set(cache_key, shared_ids, 300)
        
        # 2. 返回查询条件
        return Q(owner=user) | Q(id__in=shared_ids)

    @staticmethod
    def check_permission(user, resource_type, resource, required_permission):
        """
        检查用户对资源是否有指定权限
        
        Args:
            user: 用户对象
            resource_type: 资源类型 ('image' or 'folder')
            resource: 资源对象
            required_permission: 需要的权限 ('view', 'edit', 'manage')
            
        Returns:
            bool: 是否有权限
        """
        # 1. 如果是所有者，拥有所有权限
        if resource.owner == user:
            return True
            
        # 2. 如果是超级管理员，拥有所有权限
        if user.is_superuser:
            return True
            
        # 3. 检查分享权限
        ResourceShare = ShareService.get_model('ResourceShare')
        from django.utils import timezone
        from django.db.models import Q
        
        now = timezone.now()
        
        # 获取该用户对此资源的有效分享
        shares = ResourceShare.objects.filter(
            shared_with=user,
            resource_type=resource_type,
            resource_id=resource.id
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        )
        
        if not shares.exists():
            return False
            
        # 检查权限级别
        # 权限级别：manage > edit > view
        permission_levels = {'view': 1, 'edit': 2, 'manage': 3}
        required_level = permission_levels.get(required_permission, 1)
        
        for share in shares:
            share_level = permission_levels.get(share.permission, 1)
            if share_level >= required_level:
                return True
                
        return False


# Desktop mode: Share service disabled
class ShareService:
    """资源共享服务 - 桌面版已禁用"""
    @staticmethod
    def get_accessible_resources(user, resource_type):
        from django.db.models import Q
        return Q(owner=user)

    @staticmethod
    def check_permission(user, resource_type, resource, required_permission):
        if not user or not getattr(user, 'is_authenticated', False):
            return False
        if getattr(user, 'is_superuser', False):
            return True
        return getattr(resource, 'owner_id', None) == user.id

    @staticmethod
    def get_my_shares(user):
        ResourceShare = ShareService.get_model('ResourceShare')
        return ResourceShare.objects.none()

    @staticmethod
    def get_shared_with_me(user):
        ResourceShare = ShareService.get_model('ResourceShare')
        return ResourceShare.objects.none()

    @staticmethod
    def share_resource(owner, resource_type, resource_id, shared_with_username, permission='view', expires_at=None):
        return None, "桌面版暂不支持资源共享"

    @staticmethod
    def revoke_share(owner, share_id):
        return False, "桌面版暂不支持资源共享"
