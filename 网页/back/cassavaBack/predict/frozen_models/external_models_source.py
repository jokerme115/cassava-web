"""外部对比模型（D1，第五轮修订）：U-Net-ResNet34 与 SegFormer-B0。

来源与忠实性
------------
模型结构复刻自我们自己的重写包 ``~/project/sim/MSCD_revision_DCU/mscd/models.py``
（2026-08 返修实验所用，结构逐字一致，仅删除本文件用不到的
ASPP / CBAM / DeepLabV3Plus / HRNet 类）。不 ``import`` 旧包、
不修改作者 ``network/`` 下任何文件 —— 作者源码零改动原则不变。

预训练（关键：旧包的教训）
--------------------------
旧包 ``load_pretrained(strict=False)`` 曾把键名不匹配的文件当"预训练成功"，
实际全部随机初始化。本文件的做法是**显式键名映射**：

* ``unet_resnet34``：骨干是自定义 ResNet34（OS16 dilated），权重形状与
  torchvision resnet34 完全兼容（dilation 只影响前向、不影响张量形状）。
  键名映射 ``_UNET_KEYMAP`` 把 torchvision ``conv1/bn1/layer*`` 对到
  自定义 ``encoder.stem.0.0 / encoder.stem.0.1 / encoder.layer*``。
  **骨干 ImageNet 覆盖率必须 = 1.0**，否则抛错；UNet 解码器随机初始化。
* ``segformer_b0``：MiT-B0 主干，加载 HuggingFace ``nvidia/mit-b0``
  的 ``pytorch_model.bin``（键名映射 ``_SEGFORMER_KEYMAP``；官方的
  key/value 两个 Linear 拼接为自定义的单个 ``kv`` Linear）。
  分割头（projections/decode）随机初始化。
  权重文件缺失时**允许**随机初始化训练，但 report 必须如实标注
  ``loaded: False``，论文表格须注明该行 backbone = random init。

覆盖率的口径与 ``rigor/pretrained.py`` 不同：这里只统计**骨干子树**
（解码器/分割头本来就没有 ImageNet 权重可加载）。
"""
from __future__ import annotations

import math
import os
from collections import OrderedDict
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

from rigor.common import sha256_file  # noqa: E402

# ==========================================================================
# 以下模型类复刻自 sim/MSCD_revision_DCU/mscd/models.py（结构逐字一致）
# ==========================================================================


class ConvBNAct(nn.Sequential):
    def __init__(self, in_ch: int, out_ch: int, kernel: int = 3, stride: int = 1,
                 padding: int | None = None, dilation: int = 1, groups: int = 1,
                 activation: bool = True) -> None:
        if padding is None:
            padding = (kernel // 2) * dilation
        modules: list[nn.Module] = [
            nn.Conv2d(in_ch, out_ch, kernel, stride, padding, dilation=dilation,
                      groups=groups, bias=False),
            nn.BatchNorm2d(out_ch),
        ]
        if activation:
            modules.append(nn.ReLU(inplace=True))
        super().__init__(*modules)


class BasicBlock(nn.Module):
    expansion = 1

    def __init__(self, in_ch: int, out_ch: int, stride: int = 1, dilation: int = 1) -> None:
        super().__init__()
        self.conv1 = ConvBNAct(in_ch, out_ch, 3, stride, dilation=dilation)
        self.conv2 = ConvBNAct(out_ch, out_ch, 3, 1, dilation=dilation, activation=False)
        self.down = None if stride == 1 and in_ch == out_ch else ConvBNAct(
            in_ch, out_ch, 1, stride, 0, activation=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = x if self.down is None else self.down(x)
        return F.relu(self.conv2(self.conv1(x)) + identity, inplace=True)


class Bottleneck(nn.Module):
    expansion = 4

    def __init__(self, in_ch: int, planes: int, stride: int = 1, dilation: int = 1) -> None:
        super().__init__()
        out_ch = planes * self.expansion
        self.conv1 = ConvBNAct(in_ch, planes, 1, 1, 0)
        self.conv2 = ConvBNAct(planes, planes, 3, stride, dilation=dilation)
        self.conv3 = ConvBNAct(planes, out_ch, 1, 1, 0, activation=False)
        self.down = None if stride == 1 and in_ch == out_ch else ConvBNAct(
            in_ch, out_ch, 1, stride, 0, activation=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = x if self.down is None else self.down(x)
        return F.relu(self.conv3(self.conv2(self.conv1(x))) + identity, inplace=True)


class ResNetEncoder(nn.Module):
    """自定义 ResNet 编码器（34/101），OS16/8 dilated，返回多尺度特征。"""

    def __init__(self, depth: int = 101, output_stride: int = 16) -> None:
        super().__init__()
        specs = {34: (BasicBlock, [3, 4, 6, 3]), 101: (Bottleneck, [3, 4, 23, 3])}
        if depth not in specs:
            raise ValueError(f"Unsupported ResNet depth: {depth}")
        block, layers = specs[depth]
        self.stem = nn.Sequential(
            ConvBNAct(3, 64, 7, 2, 3),
            nn.MaxPool2d(3, 2, 1),
        )
        self.in_ch = 64
        self.layer1 = self._make(block, 64, layers[0], 1, 1)
        self.layer2 = self._make(block, 128, layers[1], 2, 1)
        if output_stride == 16:
            self.layer3 = self._make(block, 256, layers[2], 2, 1)
            self.layer4 = self._make(block, 512, layers[3], 1, 2)
        elif output_stride == 8:
            self.layer3 = self._make(block, 256, layers[2], 1, 2)
            self.layer4 = self._make(block, 512, layers[3], 1, 4)
        else:
            raise ValueError("output_stride must be 8 or 16")
        self.low_channels = 64 * block.expansion
        self.out_channels = 512 * block.expansion
        self._initialize()

    def _make(self, block, planes: int, count: int, stride: int, dilation: int) -> nn.Sequential:
        modules = [block(self.in_ch, planes, stride, dilation)]
        self.in_ch = planes * block.expansion
        modules.extend(block(self.in_ch, planes, 1, dilation) for _ in range(1, count))
        return nn.Sequential(*modules)

    def _initialize(self) -> None:
        for module in self.modules():
            if isinstance(module, nn.Conv2d):
                nn.init.kaiming_normal_(module.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(module, nn.BatchNorm2d):
                nn.init.ones_(module.weight)
                nn.init.zeros_(module.bias)

    def forward(self, x: torch.Tensor):
        stem = self.stem(x)
        low = self.layer1(stem)
        x2 = self.layer2(low)
        x3 = self.layer3(x2)
        out = self.layer4(x3)
        return low, out, [stem, low, x2, x3, out]


class UNetResNet34(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.encoder = ResNetEncoder(34, output_stride=16)
        channels = [512, 256, 128, 64, 64]
        skips = [256, 128, 64, 64]
        self.up_blocks = nn.ModuleList()
        current = channels[0]
        for skip, out in zip(skips, channels[1:]):
            self.up_blocks.append(nn.Sequential(ConvBNAct(current + skip, out),
                                                ConvBNAct(out, out)))
            current = out
        self.head = nn.Conv2d(current, 2, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        size = x.shape[-2:]
        _, _, features = self.encoder(x)
        stem, low, x2, x3, out = features
        value = out
        for block, skip in zip(self.up_blocks, [x3, x2, low, stem]):
            value = F.interpolate(value, size=skip.shape[-2:], mode="bilinear",
                                  align_corners=False)
            value = block(torch.cat([value, skip], dim=1))
        return F.interpolate(self.head(value), size=size, mode="bilinear",
                             align_corners=False)


class OverlapPatchEmbed(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, kernel: int, stride: int) -> None:
        super().__init__()
        self.proj = nn.Conv2d(in_ch, out_ch, kernel, stride, kernel // 2)
        self.norm = nn.LayerNorm(out_ch)

    def forward(self, x: torch.Tensor):
        x = self.proj(x)
        h, w = x.shape[-2:]
        x = self.norm(x.flatten(2).transpose(1, 2))
        return x, h, w


class MixFFN(nn.Module):
    def __init__(self, dim: int, ratio: int = 4) -> None:
        super().__init__()
        hidden = dim * ratio
        self.fc1 = nn.Linear(dim, hidden)
        self.dw = nn.Conv2d(hidden, hidden, 3, padding=1, groups=hidden)
        self.fc2 = nn.Linear(hidden, dim)

    def forward(self, x: torch.Tensor, h: int, w: int) -> torch.Tensor:
        x = self.fc1(x)
        b, _, c = x.shape
        x = self.dw(x.transpose(1, 2).reshape(b, c, h, w)).flatten(2).transpose(1, 2)
        return self.fc2(F.gelu(x))


class EfficientAttention(nn.Module):
    def __init__(self, dim: int, heads: int, sr_ratio: int) -> None:
        super().__init__()
        self.heads = heads
        self.scale = (dim // heads) ** -0.5
        self.q = nn.Linear(dim, dim)
        self.kv = nn.Linear(dim, dim * 2)
        self.sr = nn.Conv2d(dim, dim, sr_ratio, sr_ratio) if sr_ratio > 1 else None
        self.norm = nn.LayerNorm(dim) if sr_ratio > 1 else nn.Identity()
        self.proj = nn.Linear(dim, dim)

    def forward(self, x: torch.Tensor, h: int, w: int) -> torch.Tensor:
        b, n, c = x.shape
        q = self.q(x).reshape(b, n, self.heads, c // self.heads).transpose(1, 2)
        reduced = x
        if self.sr is not None:
            reduced = self.sr(x.transpose(1, 2).reshape(b, c, h, w)).flatten(2).transpose(1, 2)
            reduced = self.norm(reduced)
        kv = self.kv(reduced).reshape(b, -1, 2, self.heads, c // self.heads).permute(2, 0, 3, 1, 4)
        key, value = kv[0], kv[1]
        attention = (q @ key.transpose(-2, -1) * self.scale).softmax(dim=-1)
        out = (attention @ value).transpose(1, 2).reshape(b, n, c)
        return self.proj(out)


class MixBlock(nn.Module):
    def __init__(self, dim: int, heads: int, sr: int) -> None:
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = EfficientAttention(dim, heads, sr)
        self.norm2 = nn.LayerNorm(dim)
        self.ffn = MixFFN(dim)

    def forward(self, x: torch.Tensor, h: int, w: int) -> torch.Tensor:
        x = x + self.attn(self.norm1(x), h, w)
        return x + self.ffn(self.norm2(x), h, w)


class SegFormerMiT(nn.Module):
    """SegFormer encoder with a compact all-MLP decoder.

    B0 keeps the exact architecture used by Wave 3.  B2 changes only the
    encoder width/depth and decoder capacity required by that wider encoder.
    """

    SPECS = {
        "b0": {"dims": [32, 64, 160, 256], "depths": [2, 2, 2, 2],
               "heads": [1, 2, 5, 8], "projection": 128, "decoder": 256},
        "b2": {"dims": [64, 128, 320, 512], "depths": [3, 4, 6, 3],
               "heads": [1, 2, 5, 8], "projection": 256, "decoder": 256},
    }

    def __init__(self, variant: str = "b0") -> None:
        super().__init__()
        if variant not in self.SPECS:
            raise ValueError(f"unsupported SegFormer MiT variant: {variant}")
        spec = self.SPECS[variant]
        self.variant = variant
        dims = spec["dims"]
        depths = spec["depths"]
        heads = spec["heads"]
        srs = [8, 4, 2, 1]
        self.patches = nn.ModuleList([
            OverlapPatchEmbed(3, dims[0], 7, 4),
            OverlapPatchEmbed(dims[0], dims[1], 3, 2),
            OverlapPatchEmbed(dims[1], dims[2], 3, 2),
            OverlapPatchEmbed(dims[2], dims[3], 3, 2),
        ])
        self.blocks = nn.ModuleList([
            nn.ModuleList([MixBlock(dim, head, sr) for _ in range(depth)])
            for dim, depth, head, sr in zip(dims, depths, heads, srs)])
        self.norms = nn.ModuleList([nn.LayerNorm(dim) for dim in dims])
        projection = spec["projection"]
        decoder = spec["decoder"]
        self.projections = nn.ModuleList(
            [nn.Conv2d(dim, projection, 1) for dim in dims])
        self.decode = nn.Sequential(
            ConvBNAct(4 * projection, decoder, 1, 1, 0), nn.Dropout(0.1),
            nn.Conv2d(decoder, 2, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        input_size = x.shape[-2:]
        features: list[torch.Tensor] = []
        value = x
        for patch, blocks, norm in zip(self.patches, self.blocks, self.norms):
            tokens, h, w = patch(value)
            for block in blocks:
                tokens = block(tokens, h, w)
            tokens = norm(tokens)
            value = tokens.transpose(1, 2).reshape(tokens.shape[0], -1, h, w)
            features.append(value)
        target = features[0].shape[-2:]
        projected = [F.interpolate(proj(feat), target, mode="bilinear",
                                   align_corners=False)
                     for proj, feat in zip(self.projections, features)]
        output = self.decode(torch.cat(projected, dim=1))
        return F.interpolate(output, input_size, mode="bilinear", align_corners=False)


# ==========================================================================
# 预训练：显式键名映射（strict 覆盖率守门，绝不静默降级）
# ==========================================================================

class SegFormerB0(SegFormerMiT):
    """Backward-compatible name so all Wave 3 checkpoints still load."""

    def __init__(self) -> None:
        super().__init__("b0")


class SegFormerB2(SegFormerMiT):
    def __init__(self) -> None:
        super().__init__("b2")


class ConvNeXtTinyFPN(nn.Module):
    """ImageNet ConvNeXt-Tiny encoder with a compact four-level FPN head."""

    def __init__(self, num_classes: int = 2) -> None:
        super().__init__()
        from torchvision.models import convnext_tiny
        self.backbone = convnext_tiny(weights=None).features
        channels = (96, 192, 384, 768)
        self.projections = nn.ModuleList([
            nn.Conv2d(channel, 128, 1) for channel in channels
        ])
        self.decode = nn.Sequential(
            ConvBNAct(512, 256, 3),
            ConvBNAct(256, 128, 3),
            nn.Conv2d(128, num_classes, 1),
        )

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        input_size = value.shape[-2:]
        features = []
        for index, layer in enumerate(self.backbone):
            value = layer(value)
            if index in (1, 3, 5, 7):
                features.append(value)
        if len(features) != 4:
            raise RuntimeError(f"ConvNeXt feature contract changed: {len(features)} levels")
        target = features[0].shape[-2:]
        projected = [F.interpolate(proj(feature), size=target, mode="bilinear",
                                   align_corners=False)
                     for proj, feature in zip(self.projections, features)]
        logits = self.decode(torch.cat(projected, dim=1))
        return F.interpolate(logits, size=input_size, mode="bilinear", align_corners=False)


class DINOv2SmallDetailSegmenter(nn.Module):
    """DINOv2 ViT-S/14 semantic features fused with a shallow RGB detail path."""

    def __init__(self, num_classes: int = 2) -> None:
        super().__init__()
        import timm
        self.patch_size = 14
        self.backbone = timm.create_model(
            "vit_small_patch14_dinov2", pretrained=False, num_classes=0,
            dynamic_img_size=True)
        self.intermediate_indices = (2, 5, 8, 11)
        self.projections = nn.ModuleList([
            nn.Sequential(nn.Conv2d(384, 96, 1, bias=False),
                          nn.GroupNorm(12, 96), nn.GELU())
            for _ in self.intermediate_indices
        ])
        self.semantic_fuse = nn.Sequential(
            nn.Conv2d(384, 192, 3, padding=1, bias=False),
            nn.GroupNorm(12, 192),
            nn.GELU(),
        )
        self.detail = nn.Sequential(
            nn.Conv2d(3, 32, 3, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.GELU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.GELU(),
        )
        self.decode = nn.Sequential(
            nn.Conv2d(256, 128, 3, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.GELU(),
            nn.Conv2d(128, 64, 3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.GELU(),
            nn.Conv2d(64, num_classes, 1),
        )

    def _pad_to_patch_grid(self, value: torch.Tensor) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
        height, width = value.shape[-2:]
        padded_h = ((height + self.patch_size - 1) // self.patch_size) * self.patch_size
        padded_w = ((width + self.patch_size - 1) // self.patch_size) * self.patch_size
        pad_h, pad_w = padded_h - height, padded_w - width
        top, left = pad_h // 2, pad_w // 2
        bottom, right = pad_h - top, pad_w - left
        return F.pad(value, (left, right, top, bottom)), (left, right, top, bottom)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        input_h, input_w = value.shape[-2:]
        padded, (left, right, top, bottom) = self._pad_to_patch_grid(value)
        intermediate = self.backbone.get_intermediate_layers(
            padded, n=self.intermediate_indices, reshape=True, norm=True)
        projected = [proj(feature) for proj, feature in zip(self.projections, intermediate)]
        semantic = self.semantic_fuse(torch.cat(projected, dim=1))
        detail = self.detail(padded)
        semantic = F.interpolate(semantic, size=detail.shape[-2:], mode="bilinear",
                                 align_corners=False)
        logits = self.decode(torch.cat((semantic, detail), dim=1))
        logits = F.interpolate(logits, size=padded.shape[-2:], mode="bilinear",
                               align_corners=False)
        return logits[..., top:top + input_h, left:left + input_w]


class DINOv2SmallTissuePrototypeSegmenter(DINOv2SmallDetailSegmenter):
    """Reparameterize each DINO depth relative to its own tissue prototype.

    PPD is expressed as a local departure from the dominant appearance of the
    same root cross-section.  Absolute DINO features, however, also encode
    accession colour, illumination and background.  Before the existing
    decoder fuses its four transformer depths, this model estimates a
    per-image prototype *inside the image-derived tissue ROI* and rewrites the
    feature as an absolute-plus-relative representation::

        F'_l = F_l + tanh(g_l) * tanh((F_l - mu_l) / (3 sigma_l))

    ``g_l`` is one learned scalar per DINO depth and is initialized to zero,
    making the complete network exactly equivalent to the parent decoder at
    initialization.  In robust mode, a first-pass prototype supplies detached
    Gaussian-kernel weights so minority lesions do not pull the tissue
    reference toward themselves.  The operation changes the internal feature
    coordinates; it does not add a parallel prediction branch or auxiliary
    loss.
    """

    requires_roi = True
    mask_loss_outside_roi = False

    def __init__(self, num_classes: int = 2, robust: bool = True) -> None:
        super().__init__(num_classes=num_classes)
        self.robust_prototype = bool(robust)
        # Zero initialization preserves the exact parent-model forward pass.
        self.prototype_gate = nn.Parameter(torch.zeros(len(self.intermediate_indices)))
        self.prototype_eps = 1e-4
        self.method_report = {
            "name": "hierarchical_tissue_referenced_prototype_reparameterization_v1",
            "reference": "per-image dominant tissue prototype at four DINOv2 depths",
            "robust_reference": self.robust_prototype,
            "roi_source": "image-derived tissue mask; no segmentation labels",
            "fusion": "F + tanh(gate) * bounded standardized tissue residual",
            "gate_count": len(self.intermediate_indices),
            "gate_initialization": "zero; exact parent-model equivalence",
            "prediction_branches_added": 0,
        }

    def _tissue_reparameterize(self, feature: torch.Tensor, roi: torch.Tensor,
                               depth_index: int) -> torch.Tensor:
        mask = F.interpolate(
            roi.to(device=feature.device, dtype=feature.dtype),
            size=feature.shape[-2:], mode="area").clamp(0.0, 1.0)
        count = mask.sum(dim=(-2, -1), keepdim=True).clamp_min(1.0)
        first = (feature * mask).sum(dim=(-2, -1), keepdim=True) / count

        if self.robust_prototype:
            distance = (feature - first).square().mean(dim=1, keepdim=True)
            scale = ((distance * mask).sum(dim=(-2, -1), keepdim=True) /
                     count).clamp_min(self.prototype_eps)
            # The weights define a robust reference set, not a shortcut for
            # driving every feature toward the mean.  Detaching them prevents
            # the network from winning by manipulating the weights themselves.
            weights = (mask * torch.exp(
                -distance.detach() / (2.0 * scale.detach()))).detach()
        else:
            weights = mask

        robust_count = weights.sum(dim=(-2, -1), keepdim=True).clamp_min(1.0)
        prototype = ((feature * weights).sum(dim=(-2, -1), keepdim=True) /
                     robust_count)
        centered = feature - prototype
        variance = ((centered.square() * weights).sum(dim=(-2, -1), keepdim=True) /
                    robust_count).clamp_min(self.prototype_eps)
        relative = torch.tanh(centered / torch.sqrt(variance) / 3.0) * mask
        gate = torch.tanh(self.prototype_gate[depth_index])
        return feature + gate * relative

    def forward(self, value: torch.Tensor,
                roi: torch.Tensor | None = None) -> torch.Tensor:
        if roi is None:
            raise ValueError("tissue-prototype DINOv2 requires an image-derived ROI")
        if roi.ndim == 3:
            roi = roi.unsqueeze(1)
        if roi.ndim != 4 or roi.shape[1] != 1 or roi.shape[-2:] != value.shape[-2:]:
            raise ValueError(
                f"ROI shape {tuple(roi.shape)} does not match image {tuple(value.shape)}")

        input_h, input_w = value.shape[-2:]
        padded, (left, right, top, bottom) = self._pad_to_patch_grid(value)
        padded_roi = F.pad(roi, (left, right, top, bottom))
        intermediate = self.backbone.get_intermediate_layers(
            padded, n=self.intermediate_indices, reshape=True, norm=True)
        projected = [proj(feature) for proj, feature in
                     zip(self.projections, intermediate)]
        projected = [
            self._tissue_reparameterize(feature, padded_roi, index)
            for index, feature in enumerate(projected)
        ]
        semantic = self.semantic_fuse(torch.cat(projected, dim=1))
        detail = self.detail(padded)
        semantic = F.interpolate(semantic, size=detail.shape[-2:], mode="bilinear",
                                 align_corners=False)
        logits = self.decode(torch.cat((semantic, detail), dim=1))
        logits = F.interpolate(logits, size=padded.shape[-2:], mode="bilinear",
                               align_corners=False)
        return logits[..., top:top + input_h, left:left + input_w]
class DINOv2SmallSubpixelBoundarySegmenter(DINOv2SmallDetailSegmenter):
    """Sub-pixel boundary refinement on top of the shared DINOv2 detail decoder.

    PPD lesions are geometrically tiny: the dev split has 5387 components whose
    median minimum side is 6 px, and 65.5% are narrower than 8 px.  Bilinear
    upsampling from the 1/4-resolution decoder head therefore quantises the
    lesion boundary to roughly one output pixel, and the geometric bound for a
    6 px lesion at 1 px displacement is IoU 0.53.  Boundary alignment, not
    feature semantics, is the binding constraint.

    This head predicts a bounded sub-pixel displacement field and a boundary
    gate from the full-resolution-context features, then resamples the lesion
    logit channel at continuous coordinates::

        p' = (1 - a) * p + a * bilinear_sample(p, grid + d * s)

    ``a`` is a tanh gate read from zero-initialised layers, so it is exactly zero at
    initialization and the network reproduces the parent decoder bit for bit.  The
    displacement field would then receive no gradient at all through ``a``, so it is
    routed separately through a straight-through term that is numerically zero in the
    forward pass but differentiable in the backward pass.  The module adds no prediction branch and no auxiliary loss: it
    re-parameterises where the existing logits are read from.
    """

    def __init__(self, num_classes: int = 2, max_shift: float = 1.5) -> None:
        super().__init__(num_classes=num_classes)
        self.max_shift = float(max_shift)
        self.boundary_features = nn.Sequential(
            nn.Conv2d(256, 64, 3, padding=1, bias=False),
            nn.GroupNorm(8, 64),
            nn.GELU(),
        )
        # Zero-initialised: identity at init, learned afterwards.
        self.boundary_gate = nn.Conv2d(64, 1, 3, padding=1)
        self.boundary_offset = nn.Conv2d(64, 2, 3, padding=1)
        nn.init.zeros_(self.boundary_gate.weight)
        nn.init.zeros_(self.boundary_gate.bias)
        nn.init.zeros_(self.boundary_offset.weight)
        nn.init.zeros_(self.boundary_offset.bias)
        self.method_report = {
            "name": "subpixel_boundary_refinement_v1",
            "motivation": "lesion median width 6 px; 1 px alignment error caps IoU at 0.53",
            "mechanism": "bounded displacement field + boundary gate, resample lesion logit",
            "max_shift_px": self.max_shift,
            "gate_initialization": "zero; exact parent-model equivalence",
            "displacement_gradient_path": "straight-through (forward-zero, backward-live)",
            "prediction_branches_added": 0,
            "auxiliary_losses_added": 0,
        }

    def _sample_at(self, tensor: torch.Tensor, grid: torch.Tensor) -> torch.Tensor:
        return F.grid_sample(tensor, grid, mode="bilinear",
                             padding_mode="border", align_corners=False)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        input_h, input_w = value.shape[-2:]
        padded, (left, right, top, bottom) = self._pad_to_patch_grid(value)
        intermediate = self.backbone.get_intermediate_layers(
            padded, n=self.intermediate_indices, reshape=True, norm=True)
        projected = [proj(feature) for proj, feature in zip(self.projections, intermediate)]
        semantic = self.semantic_fuse(torch.cat(projected, dim=1))
        detail = self.detail(padded)
        semantic = F.interpolate(semantic, size=detail.shape[-2:], mode="bilinear",
                                 align_corners=False)
        fused = torch.cat((semantic, detail), dim=1)
        logits = self.decode(fused)

        boundary = self.boundary_features(fused)
        # tanh, not sigmoid: tanh(0) == 0 keeps the head a true identity at init.
        gate = torch.tanh(self.boundary_gate(boundary))
        offset = torch.tanh(self.boundary_offset(boundary)) * self.max_shift

        # Normalised sampling grid in the decoder-head resolution.
        height, width = logits.shape[-2:]
        base = torch.stack(torch.meshgrid(
            torch.linspace(-1.0, 1.0, height, device=logits.device, dtype=logits.dtype),
            torch.linspace(-1.0, 1.0, width, device=logits.device, dtype=logits.dtype),
            indexing="ij"), dim=-1).unsqueeze(0)
        step = torch.tensor([2.0 / max(height - 1, 1), 2.0 / max(width - 1, 1)],
                            device=logits.device, dtype=logits.dtype).view(1, 1, 1, 2)
        grid = (base + offset.permute(0, 2, 3, 1) * step).clamp(-1.0, 1.0)

        lesion = logits[:, 1:2]
        refined = self._sample_at(lesion, grid)
        # Straight-through gradient path for the displacement field.
        #
        # A zero-initialised gate multiplied into anything kills that thing's
        # initial gradient: with gate = 0 the output is exactly ``lesion`` and
        # is independent of ``offset``, so d(loss)/d(offset) = 0 and the
        # displacement field never starts learning.  ``refined - refined.detach()``
        # is numerically zero in the forward pass, so the output stays exactly
        # equal to the parent decoder, while the backward pass still routes
        # d(refined)/d(offset) into the displacement head.  The gate below then
        # controls how much of the refined read is actually used.
        lesion = lesion + (refined - refined.detach()) + gate * (refined - lesion)
        logits = torch.cat((logits[:, 0:1], lesion), dim=1)

        logits = F.interpolate(logits, size=padded.shape[-2:], mode="bilinear",
                               align_corners=False)
        return logits[..., top:top + input_h, left:left + input_w]


class DINOv2SmallSubpixelBoundarySegmenterV2(DINOv2SmallSubpixelBoundarySegmenter):
    """Corrected, true-gradient sub-pixel readout for Wave 17-v2.

    Version 1 used ``(y, x)`` coordinates with an ``(x, y)`` API and placed
    the identity grid at align-corners locations despite passing
    ``align_corners=False``.  Once its gate opened, that operation was a
    spatial warp rather than a bounded boundary displacement.  This version
    uses pixel-centre ``(x, y)`` coordinates and scales displacements in the
    decoder lattice correctly.

    The offset starts at zero and the gate at a small non-zero value.  The
    initial forward pass is numerically the parent decoder because sampling at
    zero offset is the identity, while the non-zero gate gives the offset head
    a real gradient without a straight-through surrogate.
    """

    def __init__(self, num_classes: int = 2,
                 max_shift_input_px: float = 1.5,
                 decoder_scale: float = 4.0,
                 initial_gate: float = 0.05) -> None:
        if not 0.0 < float(initial_gate) < 1.0:
            raise ValueError("initial_gate must be in (0, 1)")
        if float(decoder_scale) <= 0.0:
            raise ValueError("decoder_scale must be positive")
        max_shift_decoder_px = float(max_shift_input_px) / float(decoder_scale)
        super().__init__(num_classes=num_classes, max_shift=max_shift_decoder_px)
        self.max_shift_input_px = float(max_shift_input_px)
        self.decoder_scale = float(decoder_scale)
        self.initial_gate = float(initial_gate)
        with torch.no_grad():
            self.boundary_gate.weight.zero_()
            self.boundary_gate.bias.fill_(math.atanh(self.initial_gate))
            self.boundary_offset.weight.zero_()
            self.boundary_offset.bias.zero_()
        self.method_report = {
            "name": "subpixel_boundary_refinement_v2",
            "mechanism": "pixel-centre xy grid + bounded true-gradient displacement",
            "max_shift_input_px": self.max_shift_input_px,
            "max_shift_decoder_px": self.max_shift,
            "decoder_scale": self.decoder_scale,
            "gate_initialization": self.initial_gate,
            "offset_initialization": "zero; identity sampling at initialization",
            "displacement_gradient_path": "exact forward derivative; no straight-through term",
            "prediction_branches_added": 0,
            "auxiliary_losses_added": 0,
        }

    @staticmethod
    def _identity_grid(tensor: torch.Tensor) -> torch.Tensor:
        """Return an align_corners=False identity grid in API order (x, y)."""
        batch, _, height, width = tensor.shape
        y = (torch.arange(height, device=tensor.device, dtype=tensor.dtype) + 0.5)
        y = y * (2.0 / float(height)) - 1.0
        x = (torch.arange(width, device=tensor.device, dtype=tensor.dtype) + 0.5)
        x = x * (2.0 / float(width)) - 1.0
        grid_y, grid_x = torch.meshgrid(y, x, indexing="ij")
        return torch.stack((grid_x, grid_y), dim=-1).unsqueeze(0).expand(
            batch, -1, -1, -1)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        input_h, input_w = value.shape[-2:]
        padded, (left, right, top, bottom) = self._pad_to_patch_grid(value)
        intermediate = self.backbone.get_intermediate_layers(
            padded, n=self.intermediate_indices, reshape=True, norm=True)
        projected = [proj(feature) for proj, feature in zip(self.projections, intermediate)]
        semantic = self.semantic_fuse(torch.cat(projected, dim=1))
        detail = self.detail(padded)
        semantic = F.interpolate(semantic, size=detail.shape[-2:], mode="bilinear",
                                 align_corners=False)
        fused = torch.cat((semantic, detail), dim=1)
        logits = self.decode(fused)

        boundary = self.boundary_features(fused)
        gate = torch.tanh(self.boundary_gate(boundary))
        # Channel 0 is dx and channel 1 is dy, both measured in decoder pixels.
        offset = torch.tanh(self.boundary_offset(boundary)) * self.max_shift
        height, width = logits.shape[-2:]
        base = self._identity_grid(logits)
        step = logits.new_tensor([2.0 / float(width), 2.0 / float(height)]).view(
            1, 1, 1, 2)
        grid = (base + offset.permute(0, 2, 3, 1) * step).clamp(-1.0, 1.0)

        lesion = logits[:, 1:2]
        refined = self._sample_at(lesion, grid)
        lesion = lesion + gate * (refined - lesion)
        logits = torch.cat((logits[:, 0:1], lesion), dim=1)

        logits = F.interpolate(logits, size=padded.shape[-2:], mode="bilinear",
                               align_corners=False)
        return logits[..., top:top + input_h, left:left + input_w]


class TissueReferencedPatchEmbed(nn.Module):
    """A timm PatchEmbed whose output is referenced to local tissue.

    ``T = W(X) + gamma_c * W(X - mu_ref)``

    ``mu_ref`` is a low-frequency tissue reference: a box average over
    ``kernel`` pixels, or the whole image when ``kernel <= 0`` (global
    reference).  Two properties make this a lesion detector rather than a
    generic high-pass filter:

    * in a uniform region -- background or healthy tissue interior --
      ``X - mu_ref`` is ~0, so the extra term self-masks exactly where there
      is nothing to segment; and
    * both terms pass through the *same* projection, so no convolution, no
      prediction head and no auxiliary loss is added.

    ``gamma`` is zero-initialised per channel, which makes the module exactly
    the wrapped projection at initialisation.  Because ``W(X - mu_ref)`` does
    not depend on ``gamma``, the gate receives a real gradient from the first
    step; a zero-initialised gate multiplied into a sampled quantity would not
    (that deadlock is what Wave 17 hit).
    """

    def __init__(self, inner: nn.Module, kernel: int) -> None:
        super().__init__()
        self.inner = inner
        self.kernel = int(kernel)
        self.gamma = nn.Parameter(torch.zeros(inner.proj.out_channels))

    def __getattr__(self, name: str):
        # nn.Module resolves parameters/buffers/submodules first; only fall back
        # to the wrapped module for the rest (img_size, grid_size, output_fmt,
        # ...), which the backbone's positional-embedding code reads.
        # Going through the module table directly keeps this from recursing.
        try:
            return super().__getattr__(name)
        except AttributeError:
            pass
        inner = self.__dict__.get("_modules", {}).get("inner")
        if inner is None:
            raise AttributeError(name)
        return getattr(inner, name)

    def reference(self, value: torch.Tensor) -> torch.Tensor:
        if self.kernel <= 0:
            return value.mean(dim=(-2, -1), keepdim=True)
        total = self.kernel - 1
        left, right = total // 2, total - total // 2   # even kernels stay centred
        padded = F.pad(value, (left, right, left, right), mode="replicate")
        return F.avg_pool2d(padded, kernel_size=self.kernel, stride=1)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        base = self.inner(value)
        residual = self.inner(value - self.reference(value))
        if getattr(self.inner, "output_fmt", "NCHW") == "NHWC":
            gamma = self.gamma.view(1, 1, 1, -1)
        else:
            gamma = self.gamma.view(1, -1, 1, 1)
        return base + gamma * residual


class DINOv2SmallTissueRefPatchSegmenter(DINOv2SmallDetailSegmenter):
    """DINOv2 detail segmenter whose patch embedding is tissue-referenced.

    Motivation: most PPD lesions are smaller than DINOv2's 14x14 patch.  If the
    lesion signal is diluted before it ever enters the transformer, no amount of
    decoder-side reparameterisation can recover it -- which is the reading of
    the Wave-16 negative result.  This arm therefore moves the reference
    mechanism to the encoder *entrance* rather than the deep features.

    Only the encoder entry point changes.  Decoder, loss, sampling, threshold
    and the training budget are untouched; the official DINOv2 projection
    weights are shared, not duplicated.
    """

    def __init__(self, num_classes: int = 2, reference_kernel: int = 42) -> None:
        super().__init__(num_classes=num_classes)
        self.reference_kernel = int(reference_kernel)
        self.backbone.patch_embed = TissueReferencedPatchEmbed(
            self.backbone.patch_embed, kernel=self.reference_kernel)
        self.method_report = {
            "mechanism": "local tissue-referenced patch embedding (LTRPE)",
            "formula": "T = W(X) + gamma_c * W(X - mu_ref)",
            "reference": self.tissue_reference,
            "reference_kernel_px": self.reference_kernel,
            "gate": "per-channel, zero-initialised; shared projection weights",
            "gate_initialization": "zero (exact identity at initialisation)",
            "added_parameters": int(self.backbone.patch_embed.gamma.numel()),
            "prediction_branches_added": 0,
            "auxiliary_losses_added": 0,
        }

    @property
    def tissue_reference(self) -> str:
        if self.reference_kernel <= 0:
            return "global"
        return "local_%d" % self.reference_kernel


class DINOv2SmallSemanticGatedDetailSegmenter(DINOv2SmallDetailSegmenter):
    """Zero-initialized full-resolution correction gated by semantic belief.

    The Wave-12 high-resolution decoder could create texture-driven false
    positives everywhere in the image.  This variant retains the proven
    Wave-11 path unchanged and lets a shallow RGB branch make only a residual
    correction, scaled by the detached coarse foreground probability.  The
    final convolution is zero initialized, so the model is exactly the
    Wave-11 architecture at initialization and cannot be degraded by a random
    residual on the first optimizer step.
    """

    def __init__(self, num_classes: int = 2) -> None:
        super().__init__(num_classes=num_classes)
        self.semantic_gated_detail = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1, bias=False),
            nn.BatchNorm2d(16),
            nn.GELU(),
            nn.Conv2d(16, 16, 3, padding=1, groups=16, bias=False),
            nn.BatchNorm2d(16),
            nn.GELU(),
            nn.Conv2d(16, num_classes, 1),
        )
        nn.init.zeros_(self.semantic_gated_detail[-1].weight)
        nn.init.zeros_(self.semantic_gated_detail[-1].bias)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        coarse_logits = super().forward(value)
        foreground_probability = torch.softmax(coarse_logits, dim=1)[:, 1:2].detach()
        residual = self.semantic_gated_detail(value)
        return coarse_logits + foreground_probability * residual


class DINOv2SmallHiResDetailSegmenter(DINOv2SmallDetailSegmenter):
    """DINOv2 semantic features refined with a full-resolution RGB branch.

    The Wave 11 decoder only fused RGB details at 1/4 resolution before one
    bilinear upsampling step.  This variant keeps the same pretrained semantic
    backbone but performs the final prediction at full resolution, where a
    lightweight depthwise RGB branch can preserve narrow lesions and edges.
    """

    def __init__(self, num_classes: int = 2) -> None:
        super().__init__(num_classes=num_classes)
        self.decode = nn.Sequential(
            nn.Conv2d(256, 128, 3, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.GELU(),
            nn.Conv2d(128, 48, 3, padding=1, bias=False),
            nn.BatchNorm2d(48),
            nn.GELU(),
        )
        self.full_detail = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1, bias=False),
            nn.BatchNorm2d(16),
            nn.GELU(),
            nn.Conv2d(16, 16, 3, padding=1, groups=16, bias=False),
            nn.BatchNorm2d(16),
            nn.GELU(),
        )
        self.full_refine = nn.Sequential(
            nn.Conv2d(64, 32, 3, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.GELU(),
            nn.Conv2d(32, 16, 3, padding=1, bias=False),
            nn.BatchNorm2d(16),
            nn.GELU(),
            nn.Conv2d(16, num_classes, 1),
        )

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        input_h, input_w = value.shape[-2:]
        padded, (left, right, top, bottom) = self._pad_to_patch_grid(value)
        intermediate = self.backbone.get_intermediate_layers(
            padded, n=self.intermediate_indices, reshape=True, norm=True)
        projected = [proj(feature) for proj, feature in zip(self.projections, intermediate)]
        semantic = self.semantic_fuse(torch.cat(projected, dim=1))
        quarter_detail = self.detail(padded)
        semantic = F.interpolate(semantic, size=quarter_detail.shape[-2:], mode="bilinear",
                                 align_corners=False)
        coarse_features = self.decode(torch.cat((semantic, quarter_detail), dim=1))
        coarse_features = F.interpolate(coarse_features, size=padded.shape[-2:],
                                        mode="bilinear", align_corners=False)
        logits = self.full_refine(torch.cat((coarse_features, self.full_detail(padded)), dim=1))
        return logits[..., top:top + input_h, left:left + input_w]


MODEL_REGISTRY = (
    "unet_resnet34", "segformer_b0", "segformer_b2",
    "convnext_tiny_fpn", "dinov2_vits14_detail", "dinov2_vits14_hires_detail",
    "dinov2_vits14_semantic_gated_detail",
    "dinov2_vits14_tissue_prototype_mean",
    "dinov2_vits14_tissue_prototype_robust",
    "dinov2_vits14_subpixel_boundary",
    "dinov2_vits14_subpixel_boundary_v2",
    "dinov2_vits14_tissue_ref_patch_global",
    "dinov2_vits14_tissue_ref_patch_local",
    # Wave 20: lesion/token scale mismatch (see rigor/wave20_models.py)
    "dinov2_vits14_guided_upsample",
    "dinov2_vits14_overlap_patch",
)


# --------------------------------------------------------------------------
# optimizer 参数组：与作者协议对齐（骨干 0.1×lr，头部全速）
# --------------------------------------------------------------------------
def backbone_module(model: nn.Module) -> nn.Module | None:
    """返回可施加 BN-momentum 技巧的骨干模块；SegFormer 主干是 LayerNorm，返回 None。"""
    if isinstance(model, UNetResNet34):
        return model.encoder
    if isinstance(model, ConvNeXtTinyFPN):
        return model.backbone
    return None


def param_groups(model: nn.Module, lr: float, backbone_lr_mult: float = 0.1,
                 layer_decay: float = 1.0) -> list:
    """Return complete, non-overlapping optimizer groups.

    ``layer_decay < 1`` is supported only for DINOv2.  The last transformer
    block uses ``backbone_lr_mult * lr`` and progressively earlier layers use
    smaller rates; the segmentation and tissue-color heads keep the full LR.
    """
    if not 0.0 < float(layer_decay) <= 1.0:
        raise ValueError("layer_decay must be in (0,1]")
    if isinstance(model, UNetResNet34):
        bb = model.encoder
        bb_ids = {id(p) for p in bb.parameters()}
        head = [p for p in model.parameters() if id(p) not in bb_ids]
        return [{"params": list(bb.parameters()), "lr": backbone_lr_mult * lr},
                {"params": head, "lr": lr}]
    if isinstance(model, SegFormerMiT):
        # 主干 = patch embedding + transformer blocks + stage LayerNorm
        bb_mods = (list(model.patches)
                   + [b for stage in model.blocks for b in stage]
                   + list(model.norms))
        bb_params = [p for m in bb_mods for p in m.parameters()]
        bb_ids = {id(p) for p in bb_params}
        head = [p for p in model.parameters() if id(p) not in bb_ids]
        return [{"params": bb_params, "lr": backbone_lr_mult * lr},
                {"params": head, "lr": lr}]
    if isinstance(model, DINOv2SmallDetailSegmenter) and layer_decay < 1.0:
        # ViT-S has 12 blocks.  Patch/positional parameters are layer 0,
        # block i is layer i+1, and the final norm shares the top-block rate.
        max_layer = len(model.backbone.blocks)
        buckets: dict[int, list[nn.Parameter]] = {i: [] for i in range(max_layer + 1)}
        for name, parameter in model.backbone.named_parameters():
            if name.startswith("blocks."):
                layer_id = min(int(name.split(".")[1]) + 1, max_layer)
            elif name.startswith("norm."):
                layer_id = max_layer
            else:
                layer_id = 0
            buckets[layer_id].append(parameter)
        groups = []
        for layer_id in range(max_layer + 1):
            if not buckets[layer_id]:
                continue
            scale = backbone_lr_mult * (float(layer_decay) ** (max_layer - layer_id))
            groups.append({"params": buckets[layer_id], "lr": scale * lr,
                           "name": f"backbone_layer_{layer_id}", "lr_scale": scale})
        bb_ids = {id(p) for p in model.backbone.parameters()}
        head = [p for p in model.parameters() if id(p) not in bb_ids]
        groups.append({"params": head, "lr": lr, "name": "head", "lr_scale": 1.0})
        return groups
    if layer_decay < 1.0:
        raise ValueError("layer_decay < 1 is currently supported only for DINOv2")
    if isinstance(model, (ConvNeXtTinyFPN, DINOv2SmallDetailSegmenter)):
        bb_params = list(model.backbone.parameters())
        bb_ids = {id(p) for p in bb_params}
        head = [p for p in model.parameters() if id(p) not in bb_ids]
        return [{"params": bb_params, "lr": backbone_lr_mult * lr},
                {"params": head, "lr": lr}]
    return [{"params": list(model.parameters()), "lr": lr}]

# torchvision resnet34 → 自定义 encoder。Bottleneck 不涉及（depth=34）。
# ConvBNAct 是 Sequential(Conv2d, BN[, ReLU])，因此 conv 权重带 ".0."、bn 带 ".1."。
_UNET_KEYMAP = [
    ("conv1.weight", "encoder.stem.0.0.weight"),
    ("bn1.weight", "encoder.stem.0.1.weight"),
    ("bn1.bias", "encoder.stem.0.1.bias"),
    ("bn1.running_mean", "encoder.stem.0.1.running_mean"),
    ("bn1.running_var", "encoder.stem.0.1.running_var"),
]
_NUM_BLOCKS = {"layer1": 3, "layer2": 4, "layer3": 6, "layer4": 3}
for _lname, _n in _NUM_BLOCKS.items():
    for _i in range(_n):
        _src, _dst = f"{_lname}.{_i}", f"encoder.{_lname}.{_i}"
        _UNET_KEYMAP += [
            (f"{_src}.conv1.weight", f"{_dst}.conv1.0.weight"),
            (f"{_src}.bn1.weight", f"{_dst}.conv1.1.weight"),
            (f"{_src}.bn1.bias", f"{_dst}.conv1.1.bias"),
            (f"{_src}.bn1.running_mean", f"{_dst}.conv1.1.running_mean"),
            (f"{_src}.bn1.running_var", f"{_dst}.conv1.1.running_var"),
            (f"{_src}.conv2.weight", f"{_dst}.conv2.0.weight"),
            (f"{_src}.bn2.weight", f"{_dst}.conv2.1.weight"),
            (f"{_src}.bn2.bias", f"{_dst}.conv2.1.bias"),
            (f"{_src}.bn2.running_mean", f"{_dst}.conv2.1.running_mean"),
            (f"{_src}.bn2.running_var", f"{_dst}.conv2.1.running_var"),
            # layer1 无 downsample；layer2-4 首块有 → 映射表多余项自然 miss
            (f"{_src}.downsample.0.weight", f"{_dst}.down.0.weight"),
            (f"{_src}.downsample.1.weight", f"{_dst}.down.1.weight"),
            (f"{_src}.downsample.1.bias", f"{_dst}.down.1.bias"),
            (f"{_src}.downsample.1.running_mean", f"{_dst}.down.1.running_mean"),
            (f"{_src}.downsample.1.running_var", f"{_dst}.down.1.running_var"),
        ]

# HuggingFace nvidia/mit-b0 / mit-b2（SegformerForImageClassification，键前缀
# `segformer.encoder.*`）→ 自定义 SegFormerMiT。
# blocks[i][j]：官方 block.{i}.{j}；深度由对应 MiT 配置显式给出。
# 注意官方 key/value 两个 Linear → 自定义 kv 单个 Linear(dim, 2*dim)，需拼接。
def _segformer_keymap(depths: list[int]) -> list:
    keymap = []
    for _i in range(4):
        keymap += [
        (f"segformer.encoder.patch_embeddings.{_i}.proj.weight", f"patches.{_i}.proj.weight"),
        (f"segformer.encoder.patch_embeddings.{_i}.proj.bias", f"patches.{_i}.proj.bias"),
        (f"segformer.encoder.patch_embeddings.{_i}.layer_norm.weight", f"patches.{_i}.norm.weight"),
        (f"segformer.encoder.patch_embeddings.{_i}.layer_norm.bias", f"patches.{_i}.norm.bias"),
        (f"segformer.encoder.layer_norm.{_i}.weight", f"norms.{_i}.weight"),
        (f"segformer.encoder.layer_norm.{_i}.bias", f"norms.{_i}.bias"),
        ]
        for _j in range(depths[_i]):
            _src, _dst = f"segformer.encoder.block.{_i}.{_j}", f"blocks.{_i}.{_j}"
            keymap += [
            (f"{_src}.layer_norm_1.weight", f"{_dst}.norm1.weight"),
            (f"{_src}.layer_norm_1.bias", f"{_dst}.norm1.bias"),
            (f"{_src}.attention.self.query.weight", f"{_dst}.attn.q.weight"),
            (f"{_src}.attention.self.query.bias", f"{_dst}.attn.q.bias"),
            (f"{_src}.attention.output.dense.weight", f"{_dst}.attn.proj.weight"),
            (f"{_src}.attention.output.dense.bias", f"{_dst}.attn.proj.bias"),
            (f"{_src}.layer_norm_2.weight", f"{_dst}.norm2.weight"),
            (f"{_src}.layer_norm_2.bias", f"{_dst}.norm2.bias"),
            (f"{_src}.mlp.dense1.weight", f"{_dst}.ffn.fc1.weight"),
            (f"{_src}.mlp.dense1.bias", f"{_dst}.ffn.fc1.bias"),
            (f"{_src}.mlp.dense2.weight", f"{_dst}.ffn.fc2.weight"),
            (f"{_src}.mlp.dense2.bias", f"{_dst}.ffn.fc2.bias"),
            ]
            # attention.self.key/value → attn.kv（拼接）；sr/ln 依 stage 而定，单独处理
            keymap += [
            (f"{_src}.attention.self.key.weight", f"__KV__/0/{_dst}.attn.kv.weight"),
            (f"{_src}.attention.self.key.bias", f"__KV__/0/{_dst}.attn.kv.bias"),
            (f"{_src}.attention.self.value.weight", f"__KV__/1/{_dst}.attn.kv.weight"),
            (f"{_src}.attention.self.value.bias", f"__KV__/1/{_dst}.attn.kv.bias"),
            ]
            if _i < 3:  # sr_ratio > 1 的 stage 才有 sr 卷积与其 LayerNorm
                keymap += [
                (f"{_src}.attention.self.sr.weight", f"{_dst}.attn.sr.weight"),
                (f"{_src}.attention.self.sr.bias", f"{_dst}.attn.sr.bias"),
                (f"{_src}.attention.self.layer_norm.weight", f"{_dst}.attn.norm.weight"),
                (f"{_src}.attention.self.layer_norm.bias", f"{_dst}.attn.norm.bias"),
                ]
            # dwconv：官方 mlp.dwconv.dwconv.{weight,bias} → 自定义 ffn.dw.{weight,bias}
            keymap += [
            (f"{_src}.mlp.dwconv.dwconv.weight", f"{_dst}.ffn.dw.weight"),
            (f"{_src}.mlp.dwconv.dwconv.bias", f"{_dst}.ffn.dw.bias"),
            ]
    return keymap


_SEGFORMER_KEYMAP = _segformer_keymap([2, 2, 2, 2])


def _mapped_state_dict(raw: dict, keymap, source_desc: str) -> tuple[OrderedDict, list, list]:
    """按 keymap 生成目标 state_dict；返回 (sd, 缺失的映射项, 源里多余的键)。"""
    sd: OrderedDict = OrderedDict()
    pending_kv: dict = {}
    misses, used_src = [], set()
    for src_key, dst_key in keymap:
        if src_key not in raw:
            misses.append(src_key)
            continue
        used_src.add(src_key)
        if dst_key.startswith("__KV__/"):
            # __KV__/<0|1>/<dst>：把 key(0)/value(1) 拼到 kv 的前/后半
            _, half, real_dst = dst_key.split("/", 2)
            pending_kv.setdefault(real_dst, {})[int(half)] = raw[src_key]
            continue
        sd[dst_key] = raw[src_key]
    for real_dst, halves in pending_kv.items():
        sd[real_dst] = torch.cat([halves[0], halves[1]], dim=0)
    leftover = [k for k in raw if k not in used_src]
    return sd, misses, leftover


def _param_named(model: nn.Module, name: str):
    obj = model
    for part in name.split("."):
        if part.isdigit():
            obj = obj[int(part)]
        else:
            obj = getattr(obj, part, None)
            if obj is None:
                return None
    return obj


def _report_for(model: nn.Module, sd: dict, misses: list, leftover: list,
                weight_path: str, scope: str, decoder_random: str) -> dict:
    """只统计骨干子树（scope 前缀）的覆盖率；解码器随机初始化为已知事实。"""
    total = matched = 0
    mismatched = []
    own = model.state_dict()
    for name, tensor in sd.items():
        if not name.startswith(scope):
            continue
        ref = own.get(name)
        if ref is None:
            mismatched.append(name)
            continue
        total += 1
        if tuple(ref.shape) == tuple(tensor.shape):
            matched += 1
        else:
            mismatched.append(f"{name}{tuple(ref.shape)}!={tuple(tensor.shape)}")
    coverage = matched / total if total else 0.0
    return {
        "loaded": bool(sd) and coverage == 1.0 and not mismatched,
        "coverage": round(coverage, 4),
        "matched_tensors": matched, "total_backbone_tensors": total,
        "backbone_scope": scope, "decoder_init": decoder_random,
        "weight_path": weight_path,
        "weight_sha256": sha256_file(weight_path) if weight_path and os.path.exists(weight_path) else None,
        "missing_from_source": misses[:12],
        "source_tensors_not_used": leftover[:12],
        "shape_mismatch": mismatched[:12],
    }


def load_unet_imagenet(model: UNetResNet34, weight_path: str) -> dict:
    """torchvision resnet34 ImageNet-1k → 自定义 encoder（骨干覆盖率必须 1.0）。"""
    raw = torch.load(weight_path, map_location="cpu")
    if isinstance(raw, dict) and "state_dict" in raw:
        raw = raw["state_dict"]
    sd, misses, leftover = _mapped_state_dict(raw, _UNET_KEYMAP, "torchvision resnet34")
    report = _report_for(model, sd, misses, leftover, weight_path,
                         scope="encoder.", decoder_random="random(kaiming, by ResNetEncoder._initialize; decoder by PyTorch default)")
    if not report["loaded"]:
        raise RuntimeError(
            f"[external_models] U-Net 骨干 ImageNet 覆盖率不足或形状不符："
            f"coverage={report['coverage']} mismatch={report['shape_mismatch']}"
            f"missing={report['missing_from_source'][:4]} —— 拒绝静默降级（旧包教训）")
    result = model.load_state_dict(sd, strict=False)
    if result.unexpected_keys:
        raise RuntimeError(f"[external_models] U-Net 映射产生未使用键 {result.unexpected_keys[:6]}")
    return report


def load_segformer_mit(model: SegFormerMiT, weight_path: str) -> dict:
    """HuggingFace nvidia/mit-b{0,2} → 自定义 MiT 主干。"""
    raw = torch.load(weight_path, map_location="cpu")
    if isinstance(raw, dict) and "state_dict" in raw:
        raw = raw["state_dict"]
    depths = SegFormerMiT.SPECS[model.variant]["depths"]
    source = f"nvidia/mit-{model.variant}"
    sd, misses, leftover = _mapped_state_dict(
        raw, _segformer_keymap(depths), source)
    # 过滤官方 classifier/decode_head（本实现的分割头结构不同，随机初始化）
    leftover = [k for k in leftover if not k.startswith(("decode_head", "classifier"))]
    backbone_prefixes = ("patches.", "blocks.", "norms.")
    own = model.state_dict()
    expected = [name for name in own if name.startswith(backbone_prefixes)]
    matched = [name for name in expected
               if name in sd and tuple(own[name].shape) == tuple(sd[name].shape)]
    mismatched = [name for name in expected
                  if name in sd and tuple(own[name].shape) != tuple(sd[name].shape)]
    coverage = len(matched) / len(expected) if expected else 0.0
    report = {
        "loaded": coverage == 1.0 and not misses and not mismatched,
        "coverage": round(coverage, 4),
        "matched_tensors": len(matched),
        "total_backbone_tensors": len(expected),
        "backbone_scope": list(backbone_prefixes),
        "decoder_init": "random (projections/decode head)",
        "weight_path": weight_path,
        "weight_sha256": sha256_file(weight_path),
        "missing_from_source": misses[:12],
        "source_tensors_not_used": leftover[:12],
        "shape_mismatch": mismatched[:12],
        "variant": model.variant,
    }
    if not report["loaded"]:
        raise RuntimeError(
            f"[external_models] SegFormer-{model.variant.upper()} 主干覆盖率不足或形状不符："
            f"coverage={report['coverage']} mismatch={report['shape_mismatch']}"
            f"missing={report['missing_from_source'][:4]} —— 拒绝静默降级（旧包教训）")
    result = model.load_state_dict(sd, strict=False)
    if result.unexpected_keys:
        raise RuntimeError(f"[external_models] SegFormer 映射产生未使用键 {result.unexpected_keys[:6]}")
    return report


def load_convnext_tiny(model: ConvNeXtTinyFPN, weight_path: str) -> dict:
    """Load the official torchvision ConvNeXt-Tiny ImageNet-1K encoder."""
    raw = torch.load(weight_path, map_location="cpu", weights_only=False)
    if isinstance(raw, dict) and "state_dict" in raw:
        raw = raw["state_dict"]
    own = model.state_dict()
    sd = OrderedDict()
    expected = [name for name in own if name.startswith("backbone.")]
    for source_name, tensor in raw.items():
        if source_name.startswith("features."):
            sd["backbone." + source_name[len("features."):]] = tensor
    matched = [name for name in expected
               if name in sd and tuple(own[name].shape) == tuple(sd[name].shape)]
    mismatched = [name for name in expected
                  if name in sd and tuple(own[name].shape) != tuple(sd[name].shape)]
    coverage = len(matched) / len(expected) if expected else 0.0
    report = {
        "loaded": coverage == 1.0 and not mismatched,
        "coverage": round(coverage, 4),
        "matched_tensors": len(matched),
        "total_backbone_tensors": len(expected),
        "backbone_scope": "backbone (torchvision ConvNeXt-Tiny features)",
        "decoder_init": "random (four-level FPN)",
        "weight_path": weight_path,
        "weight_sha256": sha256_file(weight_path),
        "shape_mismatch": mismatched[:12],
        "source_tensors_not_used": [
            name for name in raw if not name.startswith("features.")][:12],
    }
    if not report["loaded"]:
        raise RuntimeError(f"ConvNeXt-Tiny encoder coverage failed: {report}")
    result = model.load_state_dict(sd, strict=False)
    if result.unexpected_keys:
        raise RuntimeError(f"ConvNeXt mapping produced unexpected keys: {result.unexpected_keys[:8]}")
    return report


def load_dinov2_small(model: DINOv2SmallDetailSegmenter, weight_path: str) -> dict:
    """Load the official Meta DINOv2 ViT-S/14 backbone with strict coverage."""
    raw = torch.load(weight_path, map_location="cpu", weights_only=False)
    if isinstance(raw, dict) and "state_dict" in raw:
        raw = raw["state_dict"]
    # LTRPE keeps the official projection inside a wrapper, so pretrained keys
    # gain an "inner." segment and the zero-initialised gate shows up as a new
    # tensor by construction.  Re-align the source keys and account for the gate
    # explicitly instead of relaxing the coverage contract.
    wrapped_projection = [k for k in model.backbone.state_dict()
                          if k.startswith("patch_embed.inner.")]
    new_by_design: tuple = ()
    if wrapped_projection:
        raw = {("patch_embed.inner." + k[len("patch_embed."):]
                if k.startswith("patch_embed.") else k): v
               for k, v in raw.items()}
        # Drop any stale wrapped key the source happened to carry, so the gate
        # can only ever come from its declared zero initialisation.
        raw = {k: v for k, v in raw.items()
               if not k.startswith("patch_embed.inner.inner.")}
        new_by_design = ("patch_embed.gamma",)
    result = model.backbone.load_state_dict(raw, strict=False)
    unexpected = list(result.unexpected_keys)
    allowed_unexpected = {"mask_token"}
    disallowed = [name for name in unexpected if name not in allowed_unexpected]
    expected = list(model.backbone.state_dict())
    missing = [k for k in result.missing_keys if k not in new_by_design]
    countable = len(expected) - len(new_by_design)
    coverage = (countable - len(missing)) / countable
    if new_by_design:
        gate = model.backbone.patch_embed.gamma
        if float(gate.detach().abs().max()) != 0.0:
            raise RuntimeError(
                "LTRPE gate must start at exactly zero, got max|gamma|="
                f"{float(gate.detach().abs().max())}")
    report = {
        "loaded": coverage == 1.0 and not disallowed,
        "coverage": round(coverage, 4),
        "matched_tensors": countable - len(missing),
        "total_backbone_tensors": len(expected),
        "new_tensors_by_design": list(new_by_design),
        "backbone_scope": "backbone (timm ViT-S/14 DINOv2)",
        "decoder_init": "random (multi-layer semantic + RGB detail decoder)",
        "weight_path": weight_path,
        "weight_sha256": sha256_file(weight_path),
        "missing_from_source": missing,
        "source_tensors_not_used": unexpected,
        "shape_mismatch": [],
    }
    if not report["loaded"]:
        raise RuntimeError(f"DINOv2 ViT-S/14 encoder coverage failed: {report}")
    return report


# 官方权重位置（服务器 weights/，离线；训练不联网）
WEIGHT_FILES = {
    "unet_resnet34": "weights/resnet34-333f7ec4.pth",
    "segformer_b0": "weights/mit_b0_pytorch_model.bin",
    "segformer_b2": "weights/mit_b2_pytorch_model.bin",
    "convnext_tiny_fpn": "weights/convnext_tiny-983f1562.pth",
    "dinov2_vits14_detail": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_hires_detail": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_semantic_gated_detail": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_tissue_prototype_mean": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_tissue_prototype_robust": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_subpixel_boundary": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_subpixel_boundary_v2": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_tissue_ref_patch_global": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_tissue_ref_patch_local": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_guided_upsample": "weights/dinov2_vits14_pretrain.pth",
    "dinov2_vits14_overlap_patch": "weights/dinov2_vits14_pretrain.pth",
}


def build(name: str, num_classes: int = 2) -> nn.Module:
    if name == "unet_resnet34":
        return UNetResNet34()
    if name == "segformer_b0":
        return SegFormerB0()
    if name == "segformer_b2":
        return SegFormerB2()
    if name == "convnext_tiny_fpn":
        return ConvNeXtTinyFPN(num_classes=num_classes)
    if name == "dinov2_vits14_detail":
        return DINOv2SmallDetailSegmenter(num_classes=num_classes)
    if name == "dinov2_vits14_hires_detail":
        return DINOv2SmallHiResDetailSegmenter(num_classes=num_classes)
    if name == "dinov2_vits14_semantic_gated_detail":
        return DINOv2SmallSemanticGatedDetailSegmenter(num_classes=num_classes)
    if name == "dinov2_vits14_tissue_prototype_mean":
        return DINOv2SmallTissuePrototypeSegmenter(
            num_classes=num_classes, robust=False)
    if name == "dinov2_vits14_tissue_prototype_robust":
        return DINOv2SmallTissuePrototypeSegmenter(
            num_classes=num_classes, robust=True)
    if name == "dinov2_vits14_subpixel_boundary":
        return DINOv2SmallSubpixelBoundarySegmenter(num_classes=num_classes)
    if name == "dinov2_vits14_subpixel_boundary_v2":
        return DINOv2SmallSubpixelBoundarySegmenterV2(num_classes=num_classes)
    if name == "dinov2_vits14_tissue_ref_patch_global":
        return DINOv2SmallTissueRefPatchSegmenter(num_classes=num_classes,
                                                 reference_kernel=0)
    if name == "dinov2_vits14_tissue_ref_patch_local":
        return DINOv2SmallTissueRefPatchSegmenter(num_classes=num_classes,
                                                 reference_kernel=42)
    if name == "dinov2_vits14_guided_upsample":
        # deferred import: wave20_models imports this module for the base class
        from rigor.wave20_models import DINOv2SmallGuidedUpsampleSegmenter
        return DINOv2SmallGuidedUpsampleSegmenter(num_classes=num_classes)
    if name == "dinov2_vits14_overlap_patch":
        from rigor.wave20_models import DINOv2SmallOverlapPatchSegmenter
        return DINOv2SmallOverlapPatchSegmenter(num_classes=num_classes)
    raise ValueError(f"未知外部模型 {name!r}（可选：{MODEL_REGISTRY}）")


def build_with_pretrained(name: str, num_classes: int = 2,
                          weights_dir: str = "") -> tuple[nn.Module, dict]:
    """构造外部模型并按协议加载 ImageNet 权重；返回 (model, pretrained_report)。

    权重文件缺失：unet_resnet34 直接抛错（权重已知存在，缺失说明环境坏了）；
    SegFormer 允许随机初始化，但 report.loaded=False 且带显式 reason，
    由 freeze_protocol/gate 与论文表格如实标注。
    """
    model = build(name, num_classes)
    rel = WEIGHT_FILES[name]
    path = os.path.join(weights_dir, rel) if weights_dir else rel
    if os.path.exists(path):
        if name == "unet_resnet34":
            return model, load_unet_imagenet(model, path)
        if name in ("segformer_b0", "segformer_b2"):
            return model, load_segformer_mit(model, path)
        if name == "convnext_tiny_fpn":
            return model, load_convnext_tiny(model, path)
        if name in ("dinov2_vits14_detail", "dinov2_vits14_hires_detail",
                    "dinov2_vits14_semantic_gated_detail",
                    "dinov2_vits14_tissue_prototype_mean",
                    "dinov2_vits14_tissue_prototype_robust",
                    "dinov2_vits14_subpixel_boundary",
                    "dinov2_vits14_subpixel_boundary_v2",
                    "dinov2_vits14_tissue_ref_patch_global",
                    "dinov2_vits14_tissue_ref_patch_local",
                    "dinov2_vits14_guided_upsample",
                    "dinov2_vits14_overlap_patch"):
            return model, load_dinov2_small(model, path)
    if name in ("unet_resnet34", "convnext_tiny_fpn", "dinov2_vits14_detail",
                "dinov2_vits14_hires_detail", "dinov2_vits14_semantic_gated_detail",
                "dinov2_vits14_tissue_prototype_mean",
                "dinov2_vits14_tissue_prototype_robust",
                "dinov2_vits14_subpixel_boundary",
                "dinov2_vits14_subpixel_boundary_v2",
                "dinov2_vits14_tissue_ref_patch_global",
                "dinov2_vits14_tissue_ref_patch_local",
                "dinov2_vits14_guided_upsample",
                "dinov2_vits14_overlap_patch"):
        raise FileNotFoundError(
            f"[external_models] 找不到 {path} —— {name} 必须有真预训练骨干，"
            f"禁止随机初始化冒充（旧包教训）")
    return model, {
        "loaded": False, "coverage": 0.0,
        "reason": f"权重文件缺失：{path}（{name} MiT 主干以随机初始化训练，"
                  f"论文表格须标注 backbone=random init）",
        "decoder_init": "random (projections/decode head)",
    }
