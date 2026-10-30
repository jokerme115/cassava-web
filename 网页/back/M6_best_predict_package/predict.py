from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from model import DeepLabV3Plus


MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)
NUM_CLASSES = 2
PATCH_SIZE = (512, 512)
STRIDE = (256, 256)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Standalone predictor for the best M6 semi-supervised model."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to one image or a directory of images.",
    )
    parser.add_argument(
        "--output",
        default="outputs",
        help="Directory used to save masks, overlays, and optional probabilities.",
    )
    parser.add_argument(
        "--model",
        default="models/m6_best_fold1.pth",
        help="Checkpoint path.",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cuda", "cpu"],
        help="Inference device.",
    )
    parser.add_argument(
        "--save-prob",
        action="store_true",
        help="Also save class-1 probability maps as grayscale PNG files.",
    )
    parser.add_argument(
        "--suffix",
        default="_pred",
        help="Suffix appended to saved file names.",
    )
    return parser.parse_args()


def resolve_device(device_name: str) -> torch.device:
    if device_name == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is not available.")
        return torch.device("cuda")
    if device_name == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def collect_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    if not input_path.is_dir():
        raise FileNotFoundError(f"Input path does not exist: {input_path}")
    image_paths = sorted(
        p for p in input_path.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not image_paths:
        raise FileNotFoundError(f"No images found under: {input_path}")
    return image_paths


def build_model(checkpoint_path: Path, device: torch.device) -> torch.nn.Module:
    model = DeepLabV3Plus(num_classes=NUM_CLASSES, encoder_name="resnet101", encoder_weights=None)
    state_dict = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    return model


def imread_unicode(path: Path, flags: int) -> np.ndarray | None:
    data = np.fromfile(str(path), dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, flags)


def imwrite_unicode(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower() or ".png"
    ok, encoded = cv2.imencode(suffix, image)
    if not ok:
        raise RuntimeError(f"Failed to encode image for saving: {path}")
    encoded.tofile(str(path))


def preprocess_image(image_bgr: np.ndarray) -> torch.Tensor:
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    image_float = image_rgb.astype(np.float32) / 255.0
    image_norm = (image_float - MEAN) / STD
    chw = np.transpose(image_norm, (2, 0, 1))
    return torch.from_numpy(chw).float()


def sliding_window_predict(
    model: torch.nn.Module,
    image_tensor: torch.Tensor,
    device: torch.device,
    patch_size: tuple[int, int] = PATCH_SIZE,
    stride: tuple[int, int] = STRIDE,
    num_classes: int = NUM_CLASSES,
) -> tuple[np.ndarray, np.ndarray]:
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

    prob_map = torch.zeros((num_classes, padded_h, padded_w), dtype=torch.float32, device=device)
    count_map = torch.zeros((1, padded_h, padded_w), dtype=torch.float32, device=device)

    ys = list(range(0, max(padded_h - patch_h + 1, 1), stride_h))
    xs = list(range(0, max(padded_w - patch_w + 1, 1), stride_w))
    if ys[-1] != padded_h - patch_h:
        ys.append(padded_h - patch_h)
    if xs[-1] != padded_w - patch_w:
        xs.append(padded_w - patch_w)

    with torch.no_grad():
        for y in ys:
            for x in xs:
                patch = padded[:, y : y + patch_h, x : x + patch_w].unsqueeze(0).to(device)
                logits = model(patch)
                probs = torch.softmax(logits, dim=1)[0]
                prob_map[:, y : y + patch_h, x : x + patch_w] += probs
                count_map[:, y : y + patch_h, x : x + patch_w] += 1.0

    prob_map = prob_map / count_map.clamp_min(1.0)
    prob_map = prob_map[:, :height, :width]
    pred_mask = torch.argmax(prob_map, dim=0).byte().cpu().numpy()
    disease_prob = prob_map[1].cpu().numpy()
    return pred_mask, disease_prob


def make_overlay(image_bgr: np.ndarray, pred_mask: np.ndarray, alpha: float = 0.45) -> np.ndarray:
    overlay = image_bgr.copy()
    disease_pixels = pred_mask > 0
    overlay[disease_pixels] = (0, 0, 255)
    blended = cv2.addWeighted(image_bgr, 1.0 - alpha, overlay, alpha, 0)
    return blended


def ensure_dirs(output_dir: Path) -> tuple[Path, Path, Path]:
    mask_dir = output_dir / "masks"
    overlay_dir = output_dir / "overlays"
    prob_dir = output_dir / "probabilities"
    mask_dir.mkdir(parents=True, exist_ok=True)
    overlay_dir.mkdir(parents=True, exist_ok=True)
    prob_dir.mkdir(parents=True, exist_ok=True)
    return mask_dir, overlay_dir, prob_dir


def save_outputs(
    image_path: Path,
    image_bgr: np.ndarray,
    pred_mask: np.ndarray,
    disease_prob: np.ndarray,
    mask_dir: Path,
    overlay_dir: Path,
    prob_dir: Path,
    suffix: str,
    save_prob: bool,
) -> None:
    stem = image_path.stem
    mask_path = mask_dir / f"{stem}{suffix}.png"
    overlay_path = overlay_dir / f"{stem}{suffix}_overlay.png"
    imwrite_unicode(mask_path, pred_mask.astype(np.uint8) * 255)
    imwrite_unicode(overlay_path, make_overlay(image_bgr, pred_mask))
    if save_prob:
        prob_path = prob_dir / f"{stem}{suffix}_prob.png"
        prob_uint8 = np.clip(disease_prob * 255.0, 0, 255).astype(np.uint8)
        imwrite_unicode(prob_path, prob_uint8)


def main() -> None:
    args = parse_args()
    root_dir = Path(__file__).resolve().parent
    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output)
    if not output_dir.is_absolute():
        output_dir = (Path.cwd() / output_dir).resolve()
    checkpoint_path = Path(args.model)
    if not checkpoint_path.is_absolute():
        checkpoint_path = (root_dir / checkpoint_path).resolve()
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    device = resolve_device(args.device)
    image_paths = collect_images(input_path)
    model = build_model(checkpoint_path, device)
    mask_dir, overlay_dir, prob_dir = ensure_dirs(output_dir)

    print(f"Using device: {device}")
    print(f"Checkpoint: {checkpoint_path}")
    print(f"Found {len(image_paths)} image(s).")

    for index, image_path in enumerate(image_paths, start=1):
        image_bgr = imread_unicode(image_path, cv2.IMREAD_COLOR)
        if image_bgr is None:
            print(f"[{index}/{len(image_paths)}] Skip unreadable image: {image_path}")
            continue

        image_tensor = preprocess_image(image_bgr)
        pred_mask, disease_prob = sliding_window_predict(model, image_tensor, device)
        save_outputs(
            image_path=image_path,
            image_bgr=image_bgr,
            pred_mask=pred_mask,
            disease_prob=disease_prob,
            mask_dir=mask_dir,
            overlay_dir=overlay_dir,
            prob_dir=prob_dir,
            suffix=args.suffix,
            save_prob=args.save_prob,
        )
        positive_ratio = float((pred_mask > 0).mean())
        print(
            f"[{index}/{len(image_paths)}] Done: {image_path.name} | "
            f"positive_ratio={positive_ratio:.4f}"
        )

    print(f"Saved masks to: {mask_dir}")
    print(f"Saved overlays to: {overlay_dir}")
    if args.save_prob:
        print(f"Saved probabilities to: {prob_dir}")


if __name__ == "__main__":
    main()
