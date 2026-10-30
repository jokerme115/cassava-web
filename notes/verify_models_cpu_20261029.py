"""CPU smoke and frozen-tensor equivalence on the user-supplied cassava photo.

Not an accuracy evaluation and no training/test-set selection.
"""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'网页/back/cassavaBack'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cassavaBack.dev_settings')
import django
django.setup()
import numpy as np
import torch
from PIL import Image, ImageOps
from torchvision.transforms import functional as TF
from predict.modern_predictor import native_tensor, predict_roi, load_member
from predict.model_registry import members
from predict.deeplab_service import deeplabv3plus_service


def main():
    torch.set_num_threads(8)
    raw = Path('C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-97fb62cf-9a48-4fca-8cf6-bd434d7a9883.png')
    image = Image.open(raw).convert('RGB').crop((20, 20, 620, 620))
    rgb = np.asarray(image)
    roi = deeplabv3plus_service.get_cassava_area_mask(rgb).astype(bool)
    masked = rgb.copy(); masked[~roi] = 0
    padded = ImageOps.expand(Image.fromarray(masked), (0, 0, (-image.width)%16, (-image.height)%16), fill=0)
    reference_tensor = TF.normalize(TF.to_tensor(padded), [.485,.456,.406], [.229,.224,.225]).unsqueeze(0)
    tensor = native_tensor(masked)
    assert torch.equal(tensor, reference_tensor), 'Frozen normalization/padding differs'
    results = []
    for key in ['pbt_c512', 'hrnet_w48', 'mask2former_swin_t']:
        start = time.perf_counter()
        actual = predict_roi(masked, key) & roi
        elapsed = time.perf_counter()-start
        votes = np.zeros(roi.shape, np.uint8)
        with torch.inference_mode():
            for entry in members(key):
                model = load_member(key, entry['file'], entry['sha256'])
                votes += model(reference_tensor).argmax(1)[0,:image.height,:image.width].numpy().astype(np.uint8)
        reference = (votes >= len(members(key))//2+1) & roi
        assert np.array_equal(actual, reference), key + ' frozen forward differs'
        item = {'model': key, 'seconds': round(elapsed, 3), 'pixels_equal': True, 'image_shape': list(roi.shape),
                'roi_pixels': int(roi.sum()), 'lesion_pixels': int(actual.sum()), 'ppd_percent': float(actual.sum()/max(1,roi.sum())*100)}
        results.append(item); print(json.dumps(item), flush=True)
    from predict.m6_predictor import m6_best_predictor
    path = ROOT/'output/upgrade-cpu-cassava-input.png'; image.save(path)
    start = time.perf_counter()
    output = m6_best_predictor.predict(str(path), confidence_threshold=.5, min_area=100,
        morph_kernel_size=5, morph_iterations=1, patch_size=(512,512), stride=(256,256), overlay_opacity=.3)
    assert output['mask'].shape == roi.shape
    results.append({'model': 'm6_best', 'seconds': round(time.perf_counter()-start,3), 'shape_ok': True,
                    'comparison': 'historical predictor reused unchanged; not a new accuracy evaluation'})
    (ROOT/'output/cpu-model-verification.json').write_text(json.dumps({'device':'cpu','training_runs':0,
        'source':'user-supplied reference image, first panel', 'results':results}, ensure_ascii=False, indent=2),encoding='utf-8')
    print('CPU verification complete', flush=True)


if __name__ == '__main__':
    main()
