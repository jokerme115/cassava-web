from __future__ import annotations

from pathlib import Path
from typing import Iterable

import cv2
import logging
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from django.conf import settings


MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)
NUM_CLASSES = 2
DEFAULT_PATCH_SIZE = (512, 512)
DEFAULT_STRIDE = (256, 256)
logger = logging.getLogger(__name__)
MIN_CROSS_SECTION_RATIO = 0.15


def _imread_unicode(path: Path, flags: int) -> np.ndarray | None:
    data = np.fromfile(str(path), dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, flags)


def _post_process_mask(
    mask: np.ndarray,
    min_area: int = 100,
    morph_kernel_size: int = 5,
    morph_iterations: int = 1,
) -> np.ndarray:
    binary_mask = mask.astype(np.uint8)

    if min_area > 0:
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary_mask, connectivity=8)
        for idx in range(1, num_labels):
            if stats[idx, cv2.CC_STAT_AREA] < min_area:
                binary_mask[labels == idx] = 0

    if morph_kernel_size > 0 and morph_iterations > 0:
        kernel = np.ones((morph_kernel_size, morph_kernel_size), np.uint8)
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel, iterations=morph_iterations)
        binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel, iterations=morph_iterations)

    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled_mask = np.zeros_like(binary_mask)
    cv2.drawContours(filled_mask, contours, -1, 1, -1)
    return filled_mask


def _bool_from_value(value, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _largest_contour_near_center(contours, width: int, height: int):
    center_x = width / 2.0
    center_y = height / 2.0

    def score(contour) -> float:
        area = cv2.contourArea(contour)
        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            return area
        cx = moments["m10"] / moments["m00"]
        cy = moments["m01"] / moments["m00"]
        distance = ((cx - center_x) ** 2 + (cy - center_y) ** 2) ** 0.5
        return area - distance * 300.0

    return max(contours, key=score)


def _detect_cross_section_mask(
    image_bgr: np.ndarray,
    boundary_trim_pixels: int = 4,
) -> np.ndarray | None:
    """Detect the visible cut-surface region and exclude side bark from scoring."""
    height, width = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 7)

    min_side = min(height, width)
    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=max(min_side // 4, 1),
        param1=80,
        param2=50,
        minRadius=max(int(min_side * 0.25), 1),
        maxRadius=max(int(min_side * 0.55), 2),
    )
    if circles is None:
        return None

    circle = np.round(circles[0][0]).astype(int)
    center_x, center_y, radius = int(circle[0]), int(circle[1]), int(circle[2])
    if radius <= 0:
        return None

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    _, saturation, value = cv2.split(hsv)
    lightness, _, _ = cv2.split(lab)

    # The white/yellow cut ring is the most stable cue for separating the
    # real cross-section from the slanted outer bark.
    white_ring = ((value > 145) & (saturation < 75) & (lightness > 145)).astype(np.uint8)
    search_limit = np.zeros((height, width), dtype=np.uint8)
    cv2.circle(search_limit, (center_x, center_y), int(radius * 1.02), 1, -1)
    white_ring &= search_limit

    for kernel_size in (21, 41, 61):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        white_ring = cv2.morphologyEx(white_ring, cv2.MORPH_CLOSE, kernel, iterations=1)
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    white_ring = cv2.morphologyEx(white_ring, cv2.MORPH_OPEN, open_kernel, iterations=1)

    contours, _ = cv2.findContours(white_ring, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = _largest_contour_near_center(contours, width, height)
    if cv2.contourArea(contour) < height * width * MIN_CROSS_SECTION_RATIO:
        return None

    mask = np.zeros((height, width), dtype=np.uint8)
    hull = cv2.convexHull(contour)
    cv2.drawContours(mask, [hull], -1, 1, -1)

    trim = max(int(boundary_trim_pixels), 0)
    if trim > 0:
        trim_size = trim * 2 + 1
        trim_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (trim_size, trim_size))
        mask = cv2.erode(mask, trim_kernel, iterations=1)

    if np.count_nonzero(mask) < height * width * MIN_CROSS_SECTION_RATIO:
        return None
    return mask


class M6BestPredictor:
    _force_device: str | None = None  # Class-level override for device

    def __init__(self) -> None:
        self.device = self._resolve_device()
        self._models: dict[str, torch.nn.Module] = {}

    @classmethod
    def force_device(cls, device: str | None) -> None:
        """Force a specific device. None to auto-detect."""
        cls._force_device = device
        logger.info(f"M6BestPredictor device forced to: {device or 'auto-detect'}")

    @staticmethod
    def _resolve_device() -> torch.device:
        import os
        # Check class-level override first
        if M6BestPredictor._force_device is not None:
            if M6BestPredictor._force_device == 'cpu':
                logger.info("USE_CPU_ONLY forced, using CPU")
                return torch.device("cpu")
            elif M6BestPredictor._force_device == 'cuda':
                if torch.cuda.is_available():
                    try:
                        torch.zeros(1, device="cuda")
                        return torch.device("cuda")
                    except Exception:
                        logger.warning("CUDA forced but not available, falling back to CPU")
                return torch.device("cpu")
        # Default: auto-detect
        if os.environ.get('USE_CPU_ONLY', '').lower() in ('1', 'true', 'yes'):
            return torch.device("cpu")
        if torch.cuda.is_available():
            try:
                torch.zeros(1, device="cuda")
                return torch.device("cuda")
            except Exception:
                pass
        return torch.device("cpu")

    @staticmethod
    def _normalize_hw(value, default_hw: tuple[int, int]) -> tuple[int, int]:
        if isinstance(value, str):
            cleaned = value.replace("x", ",").replace("X", ",")
            parts = [part.strip() for part in cleaned.split(",") if part.strip()]
            if len(parts) == 2:
                return max(int(parts[0]), 1), max(int(parts[1]), 1)
        if isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray, str)):
            parts = list(value)
            if len(parts) == 2:
                return max(int(parts[0]), 1), max(int(parts[1]), 1)
        return default_hw

    @staticmethod
    def _checkpoint_path() -> Path:
        configured_path = getattr(settings, "M6_BEST_MODEL_PATH", None)
        if configured_path:
            path = Path(configured_path)
            if path.exists():
                return path
        raise FileNotFoundError(f"M6 checkpoint not found: {configured_path}")

    def _build_model(self, checkpoint_path: Path) -> torch.nn.Module:
        cache_key = str(checkpoint_path.resolve())
        if cache_key in self._models:
            return self._models[cache_key]

        import segmentation_models_pytorch as smp

        model = smp.DeepLabV3Plus(
            encoder_name="resnet101",
            encoder_weights=None,
            classes=NUM_CLASSES,
            activation=None,
        )
        state_dict = torch.load(str(checkpoint_path), map_location="cpu", weights_only=False)
        if isinstance(state_dict, dict) and "state_dict" in state_dict:
            state_dict = state_dict["state_dict"]
        if isinstance(state_dict, dict):
            normalized_state_dict = {}
            for key, value in state_dict.items():
                normalized_key = key[6:] if key.startswith("model.") else key
                normalized_state_dict[normalized_key] = value
            state_dict = normalized_state_dict
        model.load_state_dict(state_dict)
        model.to(self.device)
        model.eval()
        self._models[cache_key] = model
        return model

    @staticmethod
    def _preprocess_image(image_bgr: np.ndarray) -> torch.Tensor:
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        image_float = image_rgb.astype(np.float32) / 255.0
        image_norm = (image_float - MEAN) / STD
        chw = np.transpose(image_norm, (2, 0, 1))
        return torch.from_numpy(chw).float()

    def _sliding_window_predict(
        self,
        model: torch.nn.Module,
        image_tensor: torch.Tensor,
        patch_size: tuple[int, int],
        stride: tuple[int, int],
        batch_size: int = 8,
    ) -> np.ndarray:
        _, height, width = image_tensor.shape
        pad_h = (16 - height % 16) % 16
        pad_w = (16 - width % 16) % 16

        padded = image_tensor
        if pad_h > 0 or pad_w > 0:
            padded = F.pad(
                image_tensor.unsqueeze(0),
                (0, pad_w, 0, pad_h),
                mode="constant",
                value=0,
            ).squeeze(0)

        _, padded_h, padded_w = padded.shape
        patch_h = min(patch_size[0], padded_h)
        patch_w = min(patch_size[1], padded_w)
        stride_h, stride_w = stride

        prob_map = torch.zeros((NUM_CLASSES, padded_h, padded_w), dtype=torch.float32, device=self.device)
        count_map = torch.zeros((1, padded_h, padded_w), dtype=torch.float32, device=self.device)

        ys = list(range(0, max(padded_h - patch_h + 1, 1), stride_h))
        xs = list(range(0, max(padded_w - patch_w + 1, 1), stride_w))
        if ys[-1] != padded_h - patch_h:
            ys.append(padded_h - patch_h)
        if xs[-1] != padded_w - patch_w:
            xs.append(padded_w - patch_w)

        # 收集所有patch位置
        positions = [(y, x) for y in ys for x in xs]

        with torch.no_grad():
            # 批量处理patches
            for batch_start in range(0, len(positions), batch_size):
                batch_positions = positions[batch_start:batch_start + batch_size]
                # 准备batch tensor
                batch_tensors = []
                for y, x in batch_positions:
                    patch = padded[:, y : y + patch_h, x : x + patch_w]
                    batch_tensors.append(patch)
                batch_input = torch.stack(batch_tensors).to(self.device)
                # 批量推理
                batch_logits = model(batch_input)
                batch_probs = torch.softmax(batch_logits, dim=1)
                # 累加到prob_map
                for idx, (y, x) in enumerate(batch_positions):
                    prob_map[:, y : y + patch_h, x : x + patch_w] += batch_probs[idx]
                    count_map[:, y : y + patch_h, x : x + patch_w] += 1.0

        prob_map = prob_map / count_map.clamp_min(1.0)
        prob_map = prob_map[:, :height, :width]
        return prob_map[1].cpu().numpy()

    @staticmethod
    def _make_overlay(image_bgr: np.ndarray, pred_mask: np.ndarray, alpha: float = 0.45) -> Image.Image:
        overlay = image_bgr.copy()
        overlay[pred_mask > 0] = (0, 0, 255)
        blended = cv2.addWeighted(image_bgr, 1.0 - alpha, overlay, alpha, 0)
        return Image.fromarray(cv2.cvtColor(blended, cv2.COLOR_BGR2RGB))

    def predict(
        self,
        image_path: str | Path,
        confidence_threshold: float = 0.5,
        min_area: int = 100,
        morph_kernel_size: int = 5,
        morph_iterations: int = 1,
        patch_size: tuple[int, int] | list[int] | str | None = None,
        stride: tuple[int, int] | list[int] | str | None = None,
        overlay_opacity: float = 0.45,
        batch_size: int = 8,
        enable_cross_section_filter: bool | str | int | None = True,
        cross_section_trim_pixels: int = 4,
    ) -> dict:
        checkpoint_path = self._checkpoint_path()
        model = self._build_model(checkpoint_path)

        image_path = Path(image_path)
        image_bgr = _imread_unicode(image_path, cv2.IMREAD_COLOR)
        if image_bgr is None:
            raise ValueError(f"Unable to read image: {image_path}")

        image_tensor = self._preprocess_image(image_bgr)
        actual_patch_size = self._normalize_hw(patch_size, DEFAULT_PATCH_SIZE)
        actual_stride = self._normalize_hw(stride, DEFAULT_STRIDE)
        disease_prob = self._sliding_window_predict(
            model=model,
            image_tensor=image_tensor,
            patch_size=actual_patch_size,
            stride=actual_stride,
            batch_size=batch_size,
        )
        pred_mask = (disease_prob > float(confidence_threshold)).astype(np.uint8)
        pred_mask = _post_process_mask(
            pred_mask,
            min_area=int(min_area),
            morph_kernel_size=int(morph_kernel_size),
            morph_iterations=int(morph_iterations),
        )
        raw_pred_mask = pred_mask.copy()
        cross_section_mask = None
        cross_section_filter_applied = False
        if _bool_from_value(enable_cross_section_filter, default=True):
            cross_section_mask = _detect_cross_section_mask(
                image_bgr=image_bgr,
                boundary_trim_pixels=int(cross_section_trim_pixels),
            )
            if cross_section_mask is not None and cross_section_mask.shape == pred_mask.shape:
                pred_mask = (pred_mask * cross_section_mask).astype(np.uint8)
                cross_section_filter_applied = True

        positive_pixels = int(np.count_nonzero(pred_mask))
        cross_section_pixels = int(np.count_nonzero(cross_section_mask)) if cross_section_mask is not None else 0

        return {
            "mask": pred_mask,
            "raw_mask": raw_pred_mask,
            "cross_section_mask": cross_section_mask,
            "cross_section_filter_applied": cross_section_filter_applied,
            "disease_prob": disease_prob,
            "positive_ratio": float(pred_mask.mean()),
            "positive_ratio_in_cross_section": (
                float(positive_pixels / cross_section_pixels)
                if cross_section_filter_applied and cross_section_pixels > 0
                else None
            ),
            "positive_pixels": positive_pixels,
            "raw_positive_pixels": int(np.count_nonzero(raw_pred_mask)),
            "excluded_positive_pixels": int(np.count_nonzero(raw_pred_mask) - positive_pixels),
            "cross_section_pixels": cross_section_pixels,
            "overlay_image": self._make_overlay(
                image_bgr=image_bgr,
                pred_mask=pred_mask,
                alpha=float(overlay_opacity),
            ),
            "patch_size": actual_patch_size,
            "stride": actual_stride,
        }


m6_best_predictor = M6BestPredictor()
