from __future__ import annotations

from pathlib import Path
from typing import Iterable

import cv2
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

    return binary_mask


class M6BestPredictor:
    def __init__(self) -> None:
        self.device = self._resolve_device()
        self._models: dict[str, torch.nn.Module] = {}

    @staticmethod
    def _resolve_device() -> torch.device:
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
        stat = checkpoint_path.stat()
        cache_key = (str(checkpoint_path.resolve()), stat.st_size, stat.st_mtime_ns)
        if cache_key in self._models:
            return self._models[cache_key]

        import segmentation_models_pytorch as smp

        model = smp.DeepLabV3Plus(
            encoder_name="resnet101",
            encoder_weights=None,
            classes=NUM_CLASSES,
            activation=None,
        )
        state_dict = torch.load(str(checkpoint_path), map_location="cpu")
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
        self._models.clear()
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
        use_tta: bool = False,
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
        stride_h, stride_w = min(stride[0], patch_h), min(stride[1], patch_w)

        prob_map = torch.zeros((NUM_CLASSES, padded_h, padded_w), dtype=torch.float32, device=self.device)
        count_map = torch.zeros((1, padded_h, padded_w), dtype=torch.float32, device=self.device)

        ys = list(range(0, max(padded_h - patch_h + 1, 1), stride_h))
        xs = list(range(0, max(padded_w - patch_w + 1, 1), stride_w))
        if ys[-1] != padded_h - patch_h:
            ys.append(padded_h - patch_h)
        if xs[-1] != padded_w - patch_w:
            xs.append(padded_w - patch_w)

        with torch.no_grad():
            for y in ys:
                for x in xs:
                    patch = padded[:, y : y + patch_h, x : x + patch_w].unsqueeze(0).to(self.device)
                    logits = model(patch)
                    if use_tta:
                        logits = (logits + torch.flip(model(torch.flip(patch, [3])), [3])
                                  + torch.flip(model(torch.flip(patch, [2])), [2])) / 3.0
                    probs = torch.softmax(logits, dim=1)[0]
                    prob_map[:, y : y + patch_h, x : x + patch_w] += probs
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
        use_post_processing: bool = True,
        use_tta: bool = False,
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
            use_tta=use_tta,
        )
        pred_mask = (disease_prob > float(confidence_threshold)).astype(np.uint8)
        if use_post_processing:
            pred_mask = _post_process_mask(
                pred_mask,
                min_area=int(min_area),
                morph_kernel_size=int(morph_kernel_size),
                morph_iterations=int(morph_iterations),
            )

        return {
            "mask": pred_mask,
            "disease_prob": disease_prob,
            "positive_ratio": float(pred_mask.mean()),
            "overlay_image": self._make_overlay(
                image_bgr=image_bgr,
                pred_mask=pred_mask,
                alpha=float(overlay_opacity),
            ),
            "patch_size": actual_patch_size,
            "stride": actual_stride,
        }


m6_best_predictor = M6BestPredictor()
