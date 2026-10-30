"""公共工具：路径、随机种子、清单数据集、统一指标口径、运行元数据。

设计约束
--------
1. 不改动作者任何模型 / 损失 / 增强代码，只在外部驱动层提供脚手架。
2. 数据划分来自审计后的 `data/split_manifest.csv`（材料级 group_id 分层），
   不再使用 `datasets/data/train_aug.txt` / `val.txt` 的随机 568/66 划分。
3. 指标同时给出 pooled（全局像素池化）与 per-image mean 两套口径，
   直接回应 R6-11「未说明是逐图平均还是全局池化」。
4. 增强管线逐项复刻作者 `utils/dataset_utils.py::get_dataset`，
   不使用任何自创增强，保证与论文方法学一致。

第二轮修订（针对外部审核的 8 条阻断问题）
------------------------------------------
* `run_dir()` / `GROUPS`：训练产物按 main / ablation / pilot 隔离，不再混目录。
* `read_history()`：续跑时读取旧 history.csv 并追加，不再覆盖。
* `manifest_fingerprint()` / `sha256_file()`：冻结门禁与结果溯源用。
* `build_train_transform_with_sampling()`：copy-paste 增强位置改回作者的
  `insert(0, ...)`（在随机缩放与裁剪**之前**），此前误放在其后。
* `base_steps_per_epoch()`：采样消融与基线使用同一个 optimizer step 预算。
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import random
import sys
import time

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)

DATA_ROOT = os.environ.get("MSCD_DATA_ROOT", os.path.join(REPO, "data"))
MANIFEST = os.path.join(DATA_ROOT, "split_manifest.csv")
OUTPUT_ROOT = os.environ.get("MSCD_OUTPUT_ROOT", os.path.join(REPO, "outputs"))
# ImageNet 预训练权重放在仓库内的 weights/（键名与作者 resnet.py 一致的真 torchvision 权重）。
# 用环境变量 MSCD_PRETRAINED_DIR 可覆盖。
PRETRAINED_DIR = os.environ.get("MSCD_PRETRAINED_DIR", os.path.join(REPO, "weights"))

NORM_MEAN = [0.485, 0.456, 0.406]
NORM_STD = [0.229, 0.224, 0.225]

# 运行产物分组：主实验 / 消融 / 试点（严禁混写，见审核意见第 2 条）
GROUPS = ("main", "ablation", "pilot")

# --------------------------------------------------------------------------
# 跨脚本列名契约（第三轮修订，审核意见第 1 条）
# --------------------------------------------------------------------------
# 逐图 CSV 里"来自审计清单的 PPD 占比"这一列（分母 = 整张矩形图像像素）。
# `evaluate_test` 写出、`stats_clustered` 读取，两边必须引用同一个常量。
# 此前 evaluate_test 写 `ppd_pixel_ratio_manifest`、stats_clustered 读
# `ppd_pixel_ratio`，靠字符串字面量各自为政，跑 33 个任务后会在统计阶段
# 直接 KeyError。现在集中定义 + 提供兼容读取函数。
MANIFEST_RATIO_COL = "ppd_pixel_ratio_manifest"
MANIFEST_RATIO_ALIASES = ("ppd_pixel_ratio_manifest", "ppd_pixel_ratio", "ratio_manifest")

# history.csv 中需要还原为数值的列
_NUMERIC_HISTORY_KEYS = {
    "epoch", "global_step", "train_loss", "lr_cls",
    "val_ppd_dice", "val_ppd_iou", "val_group_ppd_dice", "val_macro_miou", "val_precision",
    "val_recall", "val_overall_accuracy", "val_specificity",
    "val_fp", "val_fn", "elapsed_s",
}


# --------------------------------------------------------------------------
# 种子与目录
# --------------------------------------------------------------------------
def set_seed(seed: int) -> None:
    """固定所有随机源。用于多种子重复实验。"""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


def make_worker_init(seed: int):
    """DataLoader worker 的确定性种子。

    作者增强代码内部使用全局 `random`，多 worker 下若不定种子则不可复现。
    注意：调用方会传 `seed*10_000 + epoch` 这类大数，内层再 ×1000 后
    可能超出 numpy 的 32 位种子上限（seed=2026 时 202.6 亿 > 2^32-1，
    会直接 ValueError），因此这里统一对 2^32 取模——既保证合法，
    又保证同一 (seed, worker) 组合依然映射到同一随机流。
    """
    def _init(worker_id: int) -> None:
        import random as _random
        s = (int(seed) * 1000 + int(worker_id)) % (2 ** 32)
        _random.seed(s)
        np.random.seed(s)
    return _init


def make_dataloader_generator(seed: int, epoch: int = 0) -> torch.Generator:
    generator = torch.Generator()
    generator.manual_seed(int(seed) * 1_000_003 + int(epoch))
    return generator


def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def run_dir(out_root: str, group: str, run_name: str) -> str:
    """训练产物目录：outputs/<group>/<run_name>。

    group ∈ GROUPS，避免主实验与消融写进同一个目录（审核意见第 2 条）。
    """
    if group not in GROUPS:
        raise ValueError(f"group 必须是 {GROUPS} 之一，收到 {group!r}")
    return ensure_dir(os.path.join(out_root, group, run_name))


def json_dump(obj, path: str) -> None:
    ensure_dir(os.path.dirname(os.path.abspath(path)))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def json_load(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_csv(rows, path: str) -> None:
    if not rows:
        return
    ensure_dir(os.path.dirname(os.path.abspath(path)))
    keys = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def read_history(path: str) -> list:
    """读取已有 history.csv，数值列还原为 float/int。

    续跑时先读旧历史再追加，**不再把 history 置空覆盖**（审核意见第 1 条）。
    """
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            row = {}
            for k, v in r.items():
                if k in _NUMERIC_HISTORY_KEYS:
                    if v in ("", None):
                        continue
                    try:
                        row[k] = int(v) if k in ("epoch", "global_step", "val_fp", "val_fn") else float(v)
                    except ValueError:
                        row[k] = v
                else:
                    row[k] = v
            rows.append(row)
    return rows


def sha256_of(obj) -> str:
    blob = json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def sha256_file(path: str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def manifest_fingerprint() -> dict:
    """审计清单指纹：文件哈希 + 行数 + 分组统计。写进冻结门禁。"""
    rows = read_manifest()
    groups = {}
    for r in rows:
        groups.setdefault(r["split"], set()).add(r["group_id"])
    return {
        "manifest_path": MANIFEST,
        "manifest_sha256": sha256_file(MANIFEST) if os.path.exists(MANIFEST) else None,
        "images": len(rows),
        "materials": len({r["group_id"] for r in rows}),
        "split_images": {k: sum(1 for r in rows if r["split"] == k) for k in ("train", "val", "test")},
        "split_materials": {k: len(v) for k, v in sorted(groups.items())},
    }


# --------------------------------------------------------------------------
# 清单数据集
# --------------------------------------------------------------------------
_MANIFEST_CACHE = None


def read_manifest() -> list:
    """读取审计清单，剔除被排除样本。"""
    global _MANIFEST_CACHE
    if _MANIFEST_CACHE is None:
        if not os.path.exists(MANIFEST):
            raise FileNotFoundError(
                f"找不到审计清单 {MANIFEST}；应先建立 data -> 审计数据目录 的软链"
            )
        rows = []
        with open(MANIFEST, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if (r.get("exclusion_reason") or "").strip():
                    continue
                rows.append(r)
        _MANIFEST_CACHE = rows
    return _MANIFEST_CACHE


def manifest_rows(split: str) -> list:
    rows = [r for r in read_manifest() if r["split"] == split]
    if not rows:
        raise RuntimeError(f"split={split!r} 在清单中为空")
    return rows


class ManifestSegDataset(Dataset):
    """审计划分上的 PPD 二值分割数据集。

    返回 ``(img_tensor, lbl_uint8_tensor)``，与作者
    ``datasets/cassava_rot.py::CassavaRotDataset`` 完全一致，
    因此作者的训练循环可直接套用。

    与作者实现的唯一区别：样本集合由固定清单决定（材料级分层），不是随机划分。
    掩膜阈值取 ``>0``，对 0/1 与 0/255 两种编码都成立。
    """

    def __init__(self, split: str, transform=None, data_root: str | None = None,
                 rows: list[dict] | None = None,
                 return_roi: bool = False, tissue_copy_paste: bool = False,
                 copy_paste_probability: float = 0.8,
                 copy_paste_max_instances: int = 3):
        self.data_root = data_root or DATA_ROOT
        self.transform = transform
        self.split = split
        self.return_roi = bool(return_roi)
        self.tissue_copy_paste = bool(tissue_copy_paste)
        if self.tissue_copy_paste and split != "train":
            raise ValueError("tissue copy-paste is training-only")
        if self.tissue_copy_paste:
            from rigor.ppd_wave4 import TissueLesionCopyPaste
            self.copy_paste = TissueLesionCopyPaste(
                probability=copy_paste_probability,
                max_instances=copy_paste_max_instances)
        else:
            self.copy_paste = None
        self.rows = list(rows) if rows is not None else manifest_rows(split)
        if not self.rows:
            raise ValueError(f"split={split!r} received no rows")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        r = self.rows[index]
        img = Image.open(os.path.join(self.data_root, r["image_relpath"])).convert("RGB")
        mask = np.array(Image.open(os.path.join(self.data_root, r["mask_relpath"])))
        target = (mask > 0).astype(np.uint8)
        target_roi = None
        if self.copy_paste is not None:
            from rigor.roi import cassava_tissue_mask
            target_roi, _ = cassava_tissue_mask(img)
            donor_index = random.randrange(len(self.rows) - 1)
            if donor_index >= index:
                donor_index += 1
            donor_row = self.rows[donor_index]
            donor_img = Image.open(os.path.join(
                self.data_root, donor_row["image_relpath"])).convert("RGB")
            donor_mask = np.array(Image.open(os.path.join(
                self.data_root, donor_row["mask_relpath"]))) > 0
            img, target, _ = self.copy_paste(
                img, target, target_roi, donor_img, donor_mask)
        if self.return_roi:
            # Encode target and image-derived tissue ROI into one PIL mask so every
            # geometric transform is applied identically to both. Values are:
            # 0=outside/background, 1=PPD outside detected ROI, 2=healthy tissue,
            # 3=PPD inside tissue. Decoding happens after the transform.
            if target_roi is None:
                from rigor.roi import cassava_tissue_mask
                target_roi, _ = cassava_tissue_mask(img)
            roi = target_roi
            encoded = target + 2 * roi.astype(np.uint8)
            lbl = Image.fromarray(encoded.astype(np.uint8))
        else:
            lbl = Image.fromarray(target)
        if img.size != lbl.size:
            lbl = lbl.resize(img.size, Image.NEAREST)
        if self.transform is not None:
            img, lbl = self.transform(img, lbl)
        if self.return_roi:
            encoded = lbl if torch.is_tensor(lbl) else torch.from_numpy(np.asarray(lbl))
            target_tensor = torch.bitwise_and(encoded.to(torch.uint8), 1)
            roi_tensor = (encoded >= 2).to(torch.float32)
            return img, target_tensor, roi_tensor
        return img, lbl

    def sample_ids(self) -> list:
        return [r["sample_id"] for r in self.rows]

    def group_ids(self) -> list:
        return [r["group_id"] for r in self.rows]

    def ppd_ratios(self) -> np.ndarray:
        return np.array([float(r["ppd_pixel_ratio"]) for r in self.rows], dtype=np.float64)

    def describe(self) -> dict:
        g = self.group_ids()
        return {
            "split": self.split,
            "images": len(self.rows),
            "materials": len(set(g)),
            "ppd_ratio_mean": float(self.ppd_ratios().mean()),
            "ppd_ratio_median": float(np.median(self.ppd_ratios())),
        }


# --------------------------------------------------------------------------
# 数据增强（逐项复刻作者 utils/dataset_utils.py::get_dataset）
# --------------------------------------------------------------------------
class LesionAwareScaleCrop:
    """在保留原始分辨率的前提下，提高训练 patch 的 PPD 监督密度。

    选点仅使用 train 标签：60% 病斑像素、25% 病斑边界、15% 随机上下文。
    中心加随机偏移，避免每次把病斑放在 patch 正中造成位置偏置。
    """

    def __init__(self, size: int = 512, scale_range=(0.8, 1.25),
                 positive_prob: float = 0.60, boundary_prob: float = 0.25,
                 end_positive_prob: float | None = None):
        self.size = int(size)
        self.scale_range = tuple(float(x) for x in scale_range)
        self.start_positive_prob = float(positive_prob)
        self.end_positive_prob = (
            self.start_positive_prob if end_positive_prob is None
            else float(end_positive_prob))
        self.positive_prob = self.start_positive_prob
        self.boundary_prob = float(boundary_prob)
        if min(self.start_positive_prob, self.end_positive_prob) < 0 \
                or self.boundary_prob < 0 \
                or max(self.start_positive_prob,
                       self.end_positive_prob) + self.boundary_prob > 1:
            raise ValueError("采样概率必须非负且之和 <= 1")

    def set_epoch(self, epoch: int, max_epochs: int) -> None:
        """Linearly anneal lesion-centered crops without touching val/test."""
        if max_epochs <= 1:
            fraction = 1.0
        else:
            fraction = min(max((int(epoch) - 1) / (int(max_epochs) - 1), 0.0), 1.0)
        self.positive_prob = (
            self.start_positive_prob
            + fraction * (self.end_positive_prob - self.start_positive_prob))

    def _pick_scale(self, lbl) -> float:
        """Incumbent rule: the zoom factor does not depend on the lesion.

        Wave 20 subclasses this to drive the factor from the measured
        lesion scale; the body below is the original draw, so every
        existing sampling mode keeps its exact behaviour.
        """
        import random
        return random.uniform(*self.scale_range)

    @staticmethod
    def _boundary(mask: np.ndarray) -> np.ndarray:
        m = mask.astype(bool)
        if not m.any():
            return m
        interior = m.copy()
        interior[1:, :] &= m[:-1, :]
        interior[:-1, :] &= m[1:, :]
        interior[:, 1:] &= m[:, :-1]
        interior[:, :-1] &= m[:, 1:]
        return m & ~interior

    def __call__(self, img, lbl):
        import random
        from PIL import Image as _PILImage, ImageOps

        scale = self._pick_scale(lbl)
        w, h = img.size
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        img = img.resize((nw, nh), _PILImage.BILINEAR)
        lbl = lbl.resize((nw, nh), _PILImage.NEAREST)

        # 对称 pad，避免小图时所有有效组织偏向左上角。
        pad_w, pad_h = max(0, self.size - nw), max(0, self.size - nh)
        if pad_w or pad_h:
            border = (pad_w // 2, pad_h // 2,
                      pad_w - pad_w // 2, pad_h - pad_h // 2)
            img = ImageOps.expand(img, border=border, fill=0)
            lbl = ImageOps.expand(lbl, border=border, fill=0)
            nw, nh = img.size

        mask = np.asarray(lbl) > 0
        roll = random.random()
        candidates = None
        if roll < self.positive_prob and mask.any():
            candidates = np.argwhere(mask)
        elif roll < self.positive_prob + self.boundary_prob and mask.any():
            candidates = np.argwhere(self._boundary(mask))

        max_x, max_y = nw - self.size, nh - self.size
        if candidates is not None and len(candidates):
            cy, cx = candidates[random.randrange(len(candidates))]
            jitter = max(1, self.size // 4)
            left = int(cx) - self.size // 2 + random.randint(-jitter, jitter)
            top = int(cy) - self.size // 2 + random.randint(-jitter, jitter)
            left, top = min(max(left, 0), max_x), min(max(top, 0), max_y)
        else:
            left = random.randint(0, max_x) if max_x else 0
            top = random.randint(0, max_y) if max_y else 0
        box = (left, top, left + self.size, top + self.size)
        return img.crop(box), lbl.crop(box)


COLOR_JITTER_PRESETS = {
    "author": (0.5, 0.5, 0.5, 0.2),
    # PPD is expressed partly as tissue discoloration.  This milder setting
    # keeps illumination robustness without freely changing lesion hue.
    "mild": (0.2, 0.2, 0.2, 0.05),
    "none": (0.0, 0.0, 0.0, 0.0),
}


class FullImageLetterbox:
    """Resize a complete image to a square canvas without geometry distortion.

    The previous validation transform used a fixed center crop and discarded
    13.4% of validation PPD pixels. This transform preserves the entire cassava
    cross-section, keeps aspect ratio, and pads only the short side.
    """

    def __init__(self, size: int, image_fill=(0, 0, 0), label_fill: int = 0):
        self.size = int(size)
        self.image_fill = tuple(image_fill)
        self.label_fill = int(label_fill)
        if self.size <= 0:
            raise ValueError("letterbox size must be positive")

    def __call__(self, img, lbl=None):
        from PIL import Image as _PILImage, ImageOps

        w, h = img.size
        scale = self.size / float(max(w, h))
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        img = img.resize((nw, nh), _PILImage.BILINEAR)
        left, top = (self.size - nw) // 2, (self.size - nh) // 2
        border = (left, top, self.size - nw - left, self.size - nh - top)
        img = ImageOps.expand(img, border=border, fill=self.image_fill)
        if lbl is None:
            return img
        lbl = lbl.resize((nw, nh), _PILImage.NEAREST)
        lbl = ImageOps.expand(lbl, border=border, fill=self.label_fill)
        return img, lbl

    def __repr__(self) -> str:
        return f"{type(self).__name__}(size={self.size})"


# 原生分辨率全图评估用的对齐倍数。取 16 与 `rigor.area_quant.pad_to_multiple`
# 一致（DeepLabV3+ output_stride=16 的下采样网格）；DINOv2 系列还会在自己的
# `_pad_to_patch_grid` 里再补到 14 的倍数，因此 16 的倍数同样是它的合法输入。
FULL_IMAGE_EVAL_MULT = 16


class NativeFullImagePad:
    """把整图补到 stride 的整数倍——**不缩放、不裁剪**——用于评估。

    这是训练期随机裁剪在评估侧的对应物，但刻意不做任何重采样：每个模型都在
    同一批**原生像素**上评分，因此"用 384 训练的模型"和"用 512 训练的模型"
    第一次变成真正同口径可比，病斑的有效像素尺度也不再随裁剪尺寸漂移。

    补边只加在右/下侧、填充为 0，与 `rigor.area_quant.pad_to_multiple` 完全一致
    （论文的定量表就是走那条路径，两边对齐后分割表与定量表同口径）。

    注意：补边会把零值边缘带进张量，指标必须在**原始 width/height** 上计算，
    否则零边会被计成真负例。裁回由 `crop_padded_pair` 负责。
    """

    def __init__(self, mult: int = FULL_IMAGE_EVAL_MULT):
        self.mult = int(mult)
        if self.mult <= 0:
            raise ValueError("mult must be positive")

    def __call__(self, img, lbl=None):
        from PIL import ImageOps

        w, h = img.size
        pw = (self.mult - w % self.mult) % self.mult
        ph = (self.mult - h % self.mult) % self.mult
        if pw or ph:
            img = ImageOps.expand(img, border=(0, 0, pw, ph), fill=0)
            if lbl is not None:
                lbl = ImageOps.expand(lbl, border=(0, 0, pw, ph), fill=0)
        if lbl is None:
            return img
        return img, lbl

    def __repr__(self) -> str:
        return f"{type(self).__name__}(mult={self.mult})"


def crop_padded_pair(pred: np.ndarray, gt: np.ndarray, width: int, height: int):
    """把补过边的全图预测/标签裁回原始尺寸。

    与 `rigor.area_quant.infer_full_image` 的 ``pred[:h0, :w0]`` 同一约定：
    对齐用的零边不参与任何指标。
    """
    height, width = int(height), int(width)
    if pred.shape[-2] < height or pred.shape[-1] < width:
        raise ValueError(
            f"张量 {pred.shape[-2:]} 小于原始尺寸 {(height, width)}，无法裁回")
    return pred[:height, :width], gt[:height, :width]


def _color_jitter_transform(preset: str):
    from utils import ext_transforms as et
    if preset not in COLOR_JITTER_PRESETS:
        raise ValueError(
            f"unknown color_jitter={preset!r}; expected {sorted(COLOR_JITTER_PRESETS)}")
    return et.ExtColorJitter(*COLOR_JITTER_PRESETS[preset])


def build_transforms(crop_size: int = 384, train: bool = True, resize_full: int = 0,
                     color_jitter: str = "author", letterbox_full: int = 0,
                     full_image_eval: bool = False):
    """构造增强管线，参数与作者 `get_dataset` 完全相同。

    resize_full > 0 时为 pilot 整图模式：Resize 到 (resize_full, resize_full)，
    不做 RandomScale/RandomCrop（仅用于整图训练试点，正式协议不受影响）。

    full_image_eval=True 时为**评估专用**的原生分辨率全图协议：只把图像补到
    stride 的整数倍，不缩放、不裁剪。训练管线完全不受该开关影响（传 train=True
    会直接报错），因此它可以叠加在任意采样策略之上，让不同 crop_size 训练的模型
    落到同一批原生像素上评分。

    作者训练管线（`utils/dataset_utils.py` L146-163）：
        ExtRandomScale((0.5, 2.0)) ->
        ExtRandomCrop((crop, crop), pad_if_needed=True) ->
        ExtRandomHorizontalFlip() -> ExtRandomVerticalFlip() ->
        ExtColorJitter(0.5, 0.5, 0.5, 0.2) -> ExtToTensor() -> ExtNormalize()
    作者验证管线（L167-172）：
        ExtCenterCrop((crop, crop)) -> ExtToTensor() -> ExtNormalize()

    注意：代码中的增强集合与论文正文所述（随机缩放 0.8-1.2、随机旋转 ±15°、
    水平翻转、色彩抖动）并不一致 —— 代码有垂直翻转、缩放范围 0.5-2.0，
    但**没有任何旋转**。该差异记录在 docs/REVIEWER_MAP.md，不在本层"补齐"。
    """
    from utils import ext_transforms as et

    if resize_full > 0 and letterbox_full > 0:
        raise ValueError("resize_full and letterbox_full are mutually exclusive")
    if full_image_eval and (resize_full > 0 or letterbox_full > 0):
        raise ValueError(
            "full_image_eval 不与 resize_full/letterbox_full 组合："
            "它按原生分辨率评估，不做任何缩放")
    if full_image_eval and train:
        raise ValueError(
            "full_image_eval 是评估专用开关；训练管线的行为必须保持不变")

    if full_image_eval:
        return et.ExtCompose(
            [
                NativeFullImagePad(FULL_IMAGE_EVAL_MULT),
                et.ExtToTensor(),
                et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
            ]
        )

    if letterbox_full > 0:
        layers = [FullImageLetterbox(letterbox_full)]
        if train:
            layers += [
                et.ExtRandomHorizontalFlip(),
                et.ExtRandomVerticalFlip(),
                _color_jitter_transform(color_jitter),
            ]
        layers += [
            et.ExtToTensor(),
            et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
        ]
        return et.ExtCompose(layers)

    if resize_full > 0:
        n = int(resize_full)

        class _PilotFullResize:
            """整图缩放（rigor 层自有实现，作者 ExtResize 在 py3.10 下不可用）。

            img 双线性、lbl 最近邻（避免重采样出非 0/1 灰度值）。
            """
            def __call__(self, img, lbl):
                from PIL import Image as _PILImage
                img = img.resize((n, n), _PILImage.BILINEAR)
                lbl = lbl.resize((n, n), _PILImage.NEAREST)
                return img, lbl

        if train:
            return et.ExtCompose(
                [
                    _PilotFullResize(),
                    et.ExtRandomHorizontalFlip(),
                    et.ExtRandomVerticalFlip(),
                    _color_jitter_transform(color_jitter),
                    et.ExtToTensor(),
                    et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
                ]
            )
        return et.ExtCompose(
            [
                _PilotFullResize(),
                et.ExtToTensor(),
                et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
            ]
        )

    if train:
        return et.ExtCompose(
            [
                et.ExtRandomScale((0.5, 2.0)),
                et.ExtRandomCrop(size=(crop_size, crop_size), pad_if_needed=True),
                et.ExtRandomHorizontalFlip(),
                et.ExtRandomVerticalFlip(),
                _color_jitter_transform(color_jitter),
                et.ExtToTensor(),
                et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
            ]
        )
    return et.ExtCompose(
        [
            et.ExtCenterCrop(size=(crop_size, crop_size)),
            et.ExtToTensor(),
            et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
        ]
    )


def build_train_transform_with_sampling(crop_size: int, sampling: str,
                                        color_jitter: str = "author",
                                        lesion_schedule: str = "fixed",
                                        lesion_positive_start: float = 0.60,
                                        lesion_positive_end: float | None = None,
                                        lesion_boundary_prob: float = 0.25):
    """训练增强。none/repeat 用作者原增强；copy_paste 额外插入作者病斑复制增强。

    顺序**必须与作者一致**：作者在 `dataset_utils.get_dataset` 里执行的是
        train_transform_list.insert(0, RotPercentageEnhancer(...))
    即病斑复制粘贴作用在**原图（未缩放、未裁剪）**上，排在 ExtRandomScale 之前。
    第一轮实现误将其放在裁剪之后，与作者不一致（审核意见第 8 条）。
    """
    from utils import ext_transforms as et

    layers = []
    if sampling == "copy_paste":
        # 作者 utils/rot_enhancement.py 的实现：把病斑区域复制粘贴到随机位置，
        # 直到病斑像素占比达到 target_percentage。原样调用，不修改其内部逻辑。
        from utils.rot_enhancement import RotPercentageEnhancer
        layers.append(RotPercentageEnhancer(target_percentage=2.0))
    if sampling in ("lesion_aware_scale_linear",
                    "lesion_aware_scale_target"):
        # Wave 20, direction 1 (lesion-scale-driven zoom).  Same crop
        # policy as lesion_aware: only the rule that picks the zoom
        # factor changes, from a fixed uniform draw to a map from the
        # measured lesion diameter.
        #
        #   linear: support [0.8, 1.25] (identical to the incumbent)
        #   target: scale = clip(21 / diameter, 1.0, 2.5)
        from rigor.scale_adaptive import ScaleAdaptiveLesionCrop
        if lesion_schedule not in ("fixed", "decay"):
            raise ValueError("lesion_schedule must be fixed or decay")
        if lesion_positive_end is None:
            lesion_positive_end = (
                0.30 if lesion_schedule == "decay" else lesion_positive_start)
        if sampling == "lesion_aware_scale_linear":
            scale_mode, scale_min, scale_max = "linear", 0.8, 1.25
        else:
            scale_mode, scale_min, scale_max = "target", 1.0, 2.5
        layers.append(ScaleAdaptiveLesionCrop(
            size=crop_size, scale_mode=scale_mode,
            scale_min=scale_min, scale_max=scale_max,
            positive_prob=lesion_positive_start,
            end_positive_prob=lesion_positive_end,
            boundary_prob=lesion_boundary_prob))
    elif sampling in ("lesion_aware", "group_balanced_lesion_aware"):
        if lesion_schedule not in ("fixed", "decay"):
            raise ValueError("lesion_schedule must be fixed or decay")
        if lesion_positive_end is None:
            lesion_positive_end = (
                0.30 if lesion_schedule == "decay" else lesion_positive_start)
        layers.append(LesionAwareScaleCrop(
            size=crop_size,
            positive_prob=lesion_positive_start,
            end_positive_prob=lesion_positive_end,
            boundary_prob=lesion_boundary_prob))
    else:
        layers += [
            et.ExtRandomScale((0.5, 2.0)),
            et.ExtRandomCrop(size=(crop_size, crop_size), pad_if_needed=True),
        ]
    layers += [
        et.ExtRandomHorizontalFlip(),
        et.ExtRandomVerticalFlip(),
        _color_jitter_transform(color_jitter),
        et.ExtToTensor(),
        et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
    ]
    return et.ExtCompose(layers)


def set_transform_epoch(transform, epoch: int, max_epochs: int) -> None:
    """Propagate an epoch to schedule-aware transforms before workers spawn."""
    if hasattr(transform, "set_epoch"):
        transform.set_epoch(epoch, max_epochs)
    for child in getattr(transform, "transforms", []):
        set_transform_epoch(child, epoch, max_epochs)


def expand_index_for_repeat(rows: list) -> tuple:
    """复刻作者 `CassavaRotDataset._apply_default_oversampling` 的语义。

    作者公式（`datasets/cassava_rot.py` L165-184）：
        target_rot_count = int(n_normal * 0.3 / 0.7)
        repeat_factor    = max(1, target_rot_count // n_rot)
    然后把"含病斑图"整图重复 (repeat_factor-1) 份追加到训练集末尾。
    这里等价地用索引列表表达。

    注意：论文把这一策略称为 RDSO（Rotation Degree Stratified Oversampling，
    "按腐烂程度分层过采样，把 PPD 占比 <5% 的样本增强到 5%-8%"），
    但代码里既没有旋转、也没有 5%-8% 目标区间，只有整图重复采样。
    该命名与实现的错位记录在 docs/REVIEWER_MAP.md。
    """
    ratios = np.array([float(r["ppd_pixel_ratio"]) for r in rows], dtype=np.float64)
    rot_idx = [i for i, r in enumerate(ratios) if r > 0]
    normal_idx = [i for i, r in enumerate(ratios) if r <= 0]
    n_rot, n_normal = len(rot_idx), len(normal_idx)
    if n_rot > 0 and n_normal > 0:
        target_rot_count = int(n_normal * 0.3 / 0.7)
        repeat_factor = max(1, target_rot_count // n_rot)
    else:
        repeat_factor = 3
    idx = list(range(len(rows)))
    for _ in range(repeat_factor - 1):
        idx.extend(rot_idx)
    return idx, {
        "repeat_factor": int(repeat_factor),
        "n_rot": n_rot,
        "n_normal": n_normal,
        "samples_per_epoch": len(idx),
    }


def base_steps_per_epoch(n_train_images: int, batch_size: int) -> int:
    """基线 optimizer step 预算（不含任何过采样）。

    作者 `DataLoader(drop_last=True)` 下，none 配置每 epoch 的 step 数 =
    floor(n_train / batch)。采样消融必须复用同一个 step 数，
    否则 repeat 会多跑 3 倍优化步数，与基线不可比（审核意见第 6 条）。
    """
    return max(1, int(n_train_images) // int(batch_size))


def repeat_coverage(n_images: int, repeat_factor: int, draw: int) -> dict:
    """固定 step 预算后，repeat 每个 epoch 实际覆盖多少张**不同**原图。

    这是第三轮审核指出的一个关键事实（审核意见"其他重要问题"第 2 条）：
    step 预算固定为 `draw` 次抽样后，repeat 是在 `n_images * repeat_factor`
    个 token 里**不放回**地抽 `draw` 个，等价于对原图**有放回**抽样，
    因此每轮都会有一批原图完全不出现。

    数学：某个原图一次都没被抽到的概率
        P = C(n - m, k) / C(n, k),  n = n_images * repeat_factor, m = repeat_factor, k = draw
    """
    from math import comb

    n = int(n_images) * int(repeat_factor)
    k = min(int(draw), n)
    if n <= 0 or k <= 0 or n - repeat_factor < k:
        p_missing = 0.0
    else:
        p_missing = comb(n - repeat_factor, k) / comb(n, k)
    return {
        "n_images": int(n_images),
        "repeat_factor": int(repeat_factor),
        "token_pool": n,
        "draws_per_epoch": k,
        "p_image_absent": round(float(p_missing), 6),
        "expected_distinct_images": round(float(n_images * (1.0 - p_missing)), 2),
        "expected_absent_images": round(float(n_images * p_missing), 2),
        "coverage_fraction": round(float(1.0 - p_missing), 6),
        "note": "repeat 在本数据上既不改变像素级类分布（409 图全部含病斑，"
                "n_normal=0），也不提高每轮图像覆盖，只等价于对原图有放回抽样。",
    }


def stable_seed(*parts, bits: int = 32) -> int:
    """由任意可序列化片段派生一个**跨进程稳定**的整数种子。

    不要用内建 `hash()`：它对 int/float 稳定，但对 str/bytes 受 `PYTHONHASHSEED`
    影响；用 `hashlib` 可以保证无论在哪个进程、哪台机器上都得到同一个值。
    用于扰动算子等需要"逐图不同、但完全可复现"的场景。
    """
    blob = "|".join(str(p) for p in parts).encode("utf-8")
    digest = hashlib.blake2b(blob, digest_size=8).digest()
    return int.from_bytes(digest, "big") % (2 ** int(bits))


def pick_manifest_ratio_col(columns) -> str:
    """在 DataFrame / dict 的列名里找出"清单 PPD 占比"列，避免列名漂移。"""
    cols = set(columns)
    for name in MANIFEST_RATIO_ALIASES:
        if name in cols:
            return name
    raise KeyError(
        f"找不到清单 PPD 占比列；期望 {MANIFEST_RATIO_COL}（兼容 "
        f"{MANIFEST_RATIO_ALIASES[1:]}），实际列为 {sorted(cols)}"
    )


# --------------------------------------------------------------------------
# accession（材料）级聚合：统计口径必须与置换检验一致
# --------------------------------------------------------------------------
def accession_means(frame, metric: str, group: str = "group_id"):
    """把逐图指标先聚合到材料（accession）级均值。

    bootstrap 与配对置换检验必须用**同一个估计量**，否则两个统计量在估计
    不同的东西（审核意见"其他重要问题"第 3 条）：
      · 图像加权：先把所有像素/图拉平再平均 → 图多的材料权重更大；
      · accession 级：先算每个材料的均值，再对材料平均 → 每个材料等权。
    论文正文用后者，因为独立观测单元是材料而不是图。
    """
    import pandas as pd  # 局部导入，避免非统计脚本被迫依赖 pandas

    if isinstance(frame, pd.DataFrame):
        return frame.groupby(group)[metric].mean()
    raise TypeError("accession_means 需要 pandas.DataFrame")


# --------------------------------------------------------------------------
# 统一指标口径
# --------------------------------------------------------------------------
def binary_hist(gt: np.ndarray, pred: np.ndarray) -> np.ndarray:
    """二值混淆矩阵，布局 hist[gt, pred]，与作者 StreamSegMetrics._fast_hist 一致。"""
    gt = np.asarray(gt).astype(np.int64).ravel()
    pred = np.asarray(pred).astype(np.int64).ravel()
    m = (gt >= 0) & (gt < 2)
    return np.bincount(2 * gt[m] + pred[m], minlength=4).reshape(2, 2).astype(np.float64)


def metrics_from_hist(hist: np.ndarray) -> dict:
    """由混淆矩阵导出全部指标。

    PPD 为前景类（标签 1）。Precision / Recall 均针对 PPD 类，
    与作者 StreamSegMetrics 中 Class Precision / Class Sensitivity 的定义一致。
    """
    h = np.asarray(hist, dtype=np.float64)
    tn, fp, fn, tp = h[0, 0], h[0, 1], h[1, 0], h[1, 1]
    total = h.sum()

    def d(a, b):
        return float(a / b) if b > 0 else 0.0

    prec = d(tp, tp + fp)
    rec = d(tp, tp + fn)
    iou_fg = d(tp, tp + fp + fn)
    iou_bg = d(tn, tn + fp + fn)
    return {
        "ppd_dice": d(2 * tp, 2 * tp + fp + fn),
        "ppd_iou": iou_fg,
        "precision": prec,
        "recall": rec,
        "specificity": d(tn, tn + fp),
        "macro_miou": 0.5 * (iou_fg + iou_bg),
        "overall_accuracy": d(tp + tn, total),
        "tp": float(tp),
        "fp": float(fp),
        "fn": float(fn),
        "tn": float(tn),
    }


@torch.no_grad()
def predict_binary(model, images: torch.Tensor) -> np.ndarray:
    """统一的前向口径：argmax over classes，二值预测。"""
    logits = model(images)
    return logits.detach().max(dim=1)[1].cpu().numpy().astype(np.uint8)


@torch.no_grad()
def per_image_metrics(model, loader, device, postprocess=None) -> list:
    """逐图推理，返回每张图的指标 + 元数据 + 混淆矩阵。

    后处理 `postprocess` 为可调用对象 ``f(pred_uint8) -> pred_uint8``，
    默认 None（raw argmax，等价于作者 predict 流程里未做后处理的情形）。
    """
    model.eval()
    rows = []
    for images, labels in loader:
        images = images.to(device, dtype=torch.float32, non_blocking=True)
        preds = predict_binary(model, images)
        gts = labels.numpy()
        for i in range(preds.shape[0]):
            pred = preds[i]
            if postprocess is not None:
                pred = postprocess(pred)
            h = binary_hist(gts[i], pred)
            row = metrics_from_hist(h)
            row["_hist"] = h
            rows.append(row)
    model.train()
    return rows


def pooled_and_mean_stats(per_image: list, keys=("ppd_dice", "ppd_iou", "macro_miou",
                                                 "precision", "recall", "specificity",
                                                 "overall_accuracy")) -> dict:
    """由逐图结果汇总 pooled（全局像素池化）与 per-image mean 两套口径。"""
    pooled_hist = np.zeros((2, 2), dtype=np.float64)
    for row in per_image:
        pooled_hist += row["_hist"]
    pooled = metrics_from_hist(pooled_hist)

    out = {"n_images": len(per_image), "pooled": {}, "per_image_mean": {}, "per_image_std": {}}
    for k in keys:
        out["pooled"][k] = pooled[k]
        vals = np.array([row[k] for row in per_image], dtype=np.float64)
        out["per_image_mean"][k] = float(vals.mean())
        out["per_image_std"][k] = float(vals.std(ddof=1)) if len(vals) > 1 else 0.0
    out["pooled_confusion_matrix"] = pooled_hist.tolist()
    return out


# --------------------------------------------------------------------------
# 运行元数据
# --------------------------------------------------------------------------
def git_rev() -> dict:
    def _run(cmd):
        try:
            return os.popen(f'git -C "{REPO}" {cmd} 2>/dev/null').read().strip()
        except Exception:
            return ""
    return {
        "git_commit": _run("rev-parse HEAD"),
        "git_subject": _run("log -1 --pretty=%s"),
        "git_dirty": bool(_run("status --porcelain")),
    }


def run_metadata(extra: dict | None = None) -> dict:
    meta = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "repo": REPO,
        "torch": torch.__version__,
        "cuda_available": bool(torch.cuda.is_available()),
        "device_count": int(torch.cuda.device_count()),
        "python": sys.version.split()[0],
    }
    meta.update(git_rev())
    if torch.cuda.is_available():
        meta["device_name"] = torch.cuda.get_device_name(0)
    if extra:
        meta.update(extra)
    return meta


__all__ = [
    "REPO", "DATA_ROOT", "MANIFEST", "OUTPUT_ROOT", "PRETRAINED_DIR", "GROUPS",
    "NORM_MEAN", "NORM_STD",
    "MANIFEST_RATIO_COL", "MANIFEST_RATIO_ALIASES",
    "set_seed", "make_worker_init", "make_dataloader_generator", "stable_seed",
    "ensure_dir", "run_dir", "json_dump", "json_load", "write_csv", "read_history",
    "sha256_of", "sha256_file", "manifest_fingerprint", "pick_manifest_ratio_col",
    "accession_means",
    "read_manifest", "manifest_rows", "ManifestSegDataset",
    "COLOR_JITTER_PRESETS", "build_transforms", "build_train_transform_with_sampling",
    "set_transform_epoch",
    "expand_index_for_repeat",
    "base_steps_per_epoch", "repeat_coverage",
    "binary_hist", "metrics_from_hist", "predict_binary",
    "per_image_metrics", "pooled_and_mean_stats", "run_metadata", "git_rev",
    "build_train_transform_full_native", "pad_batch_collate",
    "MeanPadToSize", "build_train_transform_mean_pad",
]


def build_train_transform_full_native(color_jitter: str = "mild"):
    """训练期原生分辨率整图管线：**不缩放、不裁剪**，只补到 stride 的整数倍。

    动机：把训练输入的有效像素尺度固定在 1.0（每个病斑占它本来的像素数），
    与作者管线的 ``ExtRandomScale((0.5,2.0)) -> ExtRandomCrop(512)`` 相对。
    几何增强仍保留作者的水平/垂直翻转，颜色抖动预设不变。
    补边只加在右/下侧、填 0，与 `NativeFullImagePad` 评估侧完全一致。
    """
    from utils import ext_transforms as et

    return et.ExtCompose([
        NativeFullImagePad(FULL_IMAGE_EVAL_MULT),
        et.ExtRandomHorizontalFlip(),
        et.ExtRandomVerticalFlip(),
        _color_jitter_transform(color_jitter),
        et.ExtToTensor(),
        et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
    ])


def _padded_black_value(dtype):
    """归一化之后"黑色像素 0"对应的张量取值，用于补边而不引入假信号。"""
    import torch

    return torch.tensor([(0.0 - m) / s for m, s in zip(NORM_MEAN, NORM_STD)],
                        dtype=dtype).view(-1, 1, 1)


class MeanPadToSize:
    """在校验裁剪前把短边补到 ``size``，填充用中性灰而不是黑。

    动机：作者管线是 ``ExtRandomScale((0.5,2.0)) -> ExtRandomCrop(512, pad_if_needed=True)``，
    小图/缩小后的图会被填 0（黑）并同时把该区域标签设为背景。若黑边被当成"背景证据"，
    模型会学到"暗区=背景"，从而系统性压低低对比病斑的召回。
    本变换只改填充值（中性灰，归一化后≈0），其余几何/颜色顺序与作者一致。
    """

    def __init__(self, size: int, image_fill=(128, 128, 128), label_fill: int = 0):
        self.size = int(size)
        self.image_fill = tuple(image_fill)
        self.label_fill = int(label_fill)

    def __call__(self, img, lbl):
        from PIL import ImageOps

        w, h = img.size
        pw, ph = max(0, self.size - w), max(0, self.size - h)
        if not pw and not ph:
            return img, lbl
        border = (pw // 2, ph // 2, pw - pw // 2, ph - ph // 2)
        img = ImageOps.expand(img, border=border, fill=self.image_fill)
        lbl = ImageOps.expand(lbl, border=border, fill=self.label_fill)
        return img, lbl


def build_train_transform_mean_pad(crop_size: int = 512, color_jitter: str = "mild"):
    """作者几何管线 + 中性灰填充：只把"黑边"换成灰边，用于分离"补边污染"这一机制。"""
    from utils import ext_transforms as et

    return et.ExtCompose([
        et.ExtRandomScale((0.5, 2.0)),
        MeanPadToSize(crop_size),
        et.ExtRandomCrop(size=(crop_size, crop_size), pad_if_needed=True),
        et.ExtRandomHorizontalFlip(),
        et.ExtRandomVerticalFlip(),
        _color_jitter_transform(color_jitter),
        et.ExtToTensor(),
        et.ExtNormalize(mean=NORM_MEAN, std=NORM_STD),
    ])


def pad_batch_collate(batch):
    """把一批**不同尺寸**的原生全图补到本批最大尺寸（16 的倍数）后堆叠。

    图像补边填""归一化后的黑色"，标签补 0（背景）；补边区域在训练损失里
    等价于真实的背景像素，不做 ignore。ROI 分支同样补 0（不在组织内）。
    """
    import torch

    images = [b[0] for b in batch]
    labels = [b[1] for b in batch]
    has_roi = len(batch[0]) > 2
    h = max(int(i.shape[-2]) for i in images)
    w = max(int(i.shape[-1]) for i in images)
    h = -(-h // FULL_IMAGE_EVAL_MULT) * FULL_IMAGE_EVAL_MULT
    w = -(-w // FULL_IMAGE_EVAL_MULT) * FULL_IMAGE_EVAL_MULT

    def _pad_img(t):
        ph, pw = h - int(t.shape[-2]), w - int(t.shape[-1])
        if not ph and not pw:
            return t
        out = _padded_black_value(t.dtype).expand(t.shape[0], h, w).clone()
        out[:, :t.shape[-2], :t.shape[-1]] = t
        return out

    def _pad_lbl(t):
        ph, pw = h - int(t.shape[-2]), w - int(t.shape[-1])
        if not ph and not pw:
            return t
        out = torch.zeros((h, w), dtype=t.dtype)
        out[:t.shape[-2], :t.shape[-1]] = t
        return out

    stacked = (torch.stack([_pad_img(i) for i in images]),
               torch.stack([_pad_lbl(l) for l in labels]))
    if has_roi:
        rois = [b[2] for b in batch]
        return stacked + (torch.stack([_pad_lbl(r) for r in rois]).float(),)
    return stacked
