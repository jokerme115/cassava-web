from __future__ import annotations

import torch.nn as nn
import segmentation_models_pytorch as smp


class DeepLabV3Plus(nn.Module):
    def __init__(
        self,
        num_classes: int = 2,
        encoder_name: str = "resnet101",
        encoder_weights: str | None = None,
    ) -> None:
        super().__init__()
        self.model = smp.DeepLabV3Plus(
            encoder_name=encoder_name,
            encoder_weights=encoder_weights,
            classes=num_classes,
            activation=None,
        )

    def forward(self, x):
        return self.model(x)
