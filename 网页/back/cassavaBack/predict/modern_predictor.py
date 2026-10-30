"""CPU inference using frozen architectures and original-resolution protocol."""
import gc
import hashlib
import threading
from functools import lru_cache
from pathlib import Path
import numpy as np
import torch
from PIL import Image, ImageOps
from torch.nn import functional as F
from .model_registry import members, assets_root, unavailable_reason
from .mask_utils import calculate_mask_metrics

_lock = threading.RLock()


@lru_cache(maxsize=1)
def load_member(key, filename, expected_hash):
    path = assets_root() / filename
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected_hash:
        raise ValueError('模型权重哈希不符，已停止推理')
    if key.startswith('pbt_'):
        from .frozen_models.external_models import SegFormerB2
        model = SegFormerB2()
    elif key == 'hrnet_w48':
        from .frozen_models.modern import HRNet
        model = HRNet()
    else:
        from .frozen_models.modern import Mask2Former
        model = Mask2Former()
    state = torch.load(path, map_location='cpu', weights_only=False)
    model.load_state_dict(state['model_state'], strict=True)
    model.eval(); del state
    return model


def native_tensor(rgb):
    height, width = rgb.shape[:2]
    # The frozen implementation pads raw black RGB before ImageNet normalization.
    padded = np.pad(rgb, ((0, (-height) % 16), (0, (-width) % 16), (0, 0)))
    tensor = torch.from_numpy(np.ascontiguousarray(padded.transpose(2, 0, 1))).float().div_(255)
    return ((tensor - torch.tensor([.485, .456, .406])[:, None, None]) /
            torch.tensor([.229, .224, .225])[:, None, None]).unsqueeze(0)


def predict_roi(rgb, key, stop_check=None):
    reason = unavailable_reason(key)
    if reason:
        raise ValueError(reason)
    height, width = rgb.shape[:2]
    tile, stride = 1536, 1152
    ys = list(range(0, max(height-tile, 0)+1, stride)); xs = list(range(0, max(width-tile, 0)+1, stride))
    if ys[-1] != max(height-tile, 0): ys.append(max(height-tile, 0))
    if xs[-1] != max(width-tile, 0): xs.append(max(width-tile, 0))
    output = np.zeros((height, width), dtype=bool)
    with _lock, torch.inference_mode():
        torch.set_num_threads(min(8, max(1, torch.get_num_threads())))
        for y in ys:
            for x in xs:
                crop = rgb[y:y+tile, x:x+tile]; tensor = native_tensor(crop)
                votes = np.zeros(crop.shape[:2], dtype=np.uint8)
                for entry in members(key):
                    if callable(stop_check) and stop_check():
                        raise RuntimeError('任务已取消')
                    model = load_member(key, entry['file'], entry['sha256'])
                    logits = model(tensor)
                    if not torch.isfinite(logits).all():
                        raise ValueError('模型产生非有限数值')
                    votes += logits.argmax(1)[0, :crop.shape[0], :crop.shape[1]].numpy().astype(np.uint8)
                output[y:y+crop.shape[0], x:x+crop.shape[1]] |= votes >= (len(members(key)) // 2 + 1)
    return output


def run_pipeline(image_path, output_dir, key, stop_check=None):
    from django.conf import settings
    from .deeplab_service import deeplabv3plus_service as service
    rgb = np.asarray(ImageOps.exif_transpose(Image.open(image_path)).convert('RGB'))
    height, width = rgb.shape[:2]
    first = service.load_yolo_model(str(settings.BASE_DIR.parent / 'model' / 'yolov11(2).pt'))
    second = service.load_yolo_model(str(settings.BASE_DIR.parent / 'model' / 'yolov11(1).pt'))
    if first is None or second is None:
        raise ValueError('两级定位权重不可用')
    def boxes(model, image):
        result = model(np.ascontiguousarray(image[:, :, ::-1]), conf=.5, save=False, verbose=False, device='cpu')
        output = []
        if result and result[0].boxes is not None:
            for box in result[0].boxes.xyxy.cpu().numpy():
                x1, y1, x2, y2 = [int(value) for value in box]
                x1, y1 = max(0, x1), max(0, y1); x2, y2 = min(image.shape[1], x2), min(image.shape[0], y2)
                if x2-x1 >= 16 and y2-y1 >= 16: output.append((x1, y1, x2, y2))
        return output
    stage1, stage2, predictions = [], [], []
    full_cassava = np.zeros((height, width), dtype=bool); full_rotten = full_cassava.copy()
    directory = Path(output_dir); directory.mkdir(exist_ok=True, parents=True)
    for index, (x1, y1, x2, y2) in enumerate(boxes(first, rgb), 1):
        block = rgb[y1:y2, x1:x2]; path = directory / f'modern_stage1_{index}.png'; Image.fromarray(block).save(path)
        stage1.append({'id': f'first_{index}', 'image_path': str(path), 'bbox': [x1, y1, x2, y2], 'confidence': .5})
        for inner in boxes(second, block):
            a, b, c, d = inner; crop = block[b:d, a:c]
            roi = service.get_cassava_area_mask(crop).astype(bool)
            masked = crop.copy(); masked[~roi] = 0
            lesion = predict_roi(masked, key, stop_check) & roi
            _, _, cp, rp, ppd = calculate_mask_metrics(roi, lesion)
            if not cp: raise ValueError('切面主体面积为0，请人工检查原图')
            number = len(stage2)+1; crop_path = directory/f'modern_stage2_{number}.png'; Image.fromarray(crop).save(crop_path)
            stage2.append({'id': f'second_{number}', 'image_path': str(crop_path), 'bbox': [x1+a, y1+b, x1+c, y1+d], 'parent_id': f'first_{index}', 'confidence': .5})
            overlay = crop.copy(); overlay[lesion] = (.6*overlay[lesion] + .4*np.array([255, 91, 127])).astype(np.uint8)
            predictions.append({'ppd': ppd, 'overlay_image': Image.fromarray(overlay), 'cassava_mask': roi, 'rotten_mask': lesion,
                'segment_info': {'seg1_id': f'first_{index}', 'seg2_id': f'second_{number}', 'seg2_image_path': str(crop_path)}})
            full_cassava[y1+b:y1+d, x1+a:x1+c] |= roi; full_rotten[y1+b:y1+d, x1+a:x1+c] |= lesion
    if not predictions:
        raise ValueError('两级定位未检出有效切面，未自动替换为全图预测')
    _, _, _, _, ppd = calculate_mask_metrics(full_cassava, full_rotten)
    return {'success': True, 'predictions': predictions, 'seg1_results': stage1, 'seg2_results': stage2,
            'cassava_mask': full_cassava, 'rotten_mask': full_rotten, 'average_ppd': ppd,
            'ensemble_details': {'kind': 'frozen-supervised', 'device': 'cpu', 'model': key,
                'protocol': 'two-yolo-0.5/roi-black/native-pad16/argmax/no-postprocess',
                'members': members(key), 'aggregation': 'area-weighted-original-mask'}}
