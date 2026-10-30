"""Run real frozen CPU inference without writing application database records."""
import argparse
import json
import os
from pathlib import Path
import resource
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--backend', required=True)
parser.add_argument('--image', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
sys.path.insert(0, args.backend)
import django
django.setup()
import numpy as np
import torch
from PIL import Image, ImageOps
from torchvision.transforms import functional as TF
from predict.modern_predictor import native_tensor, predict_roi, load_member, run_pipeline
from predict.model_registry import members
from predict.deeplab_service import deeplabv3plus_service

out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(2)
image = Image.open(args.image).convert('RGB')
if image.width > 1000 and image.width > image.height * 2:
    image = image.crop((20, 20, 620, 620))
image.save(out / 'input.png')
rgb = np.array(image)
roi = deeplabv3plus_service.get_cassava_area_mask(rgb).astype(bool)
masked = rgb.copy()
masked[~roi] = 0
padded = ImageOps.expand(Image.fromarray(masked), (0, 0, (-image.width) % 16, (-image.height) % 16))
reference_tensor = TF.normalize(TF.to_tensor(padded), [.485, .456, .406], [.229, .224, .225]).unsqueeze(0)
assert torch.equal(native_tensor(masked), reference_tensor)
report = []
for key in ('pbt_c512', 'hrnet_w48', 'mask2former_swin_t'):
    start = time.perf_counter()
    actual = predict_roi(masked, key) & roi
    votes = np.zeros(roi.shape, np.uint8)
    with torch.inference_mode():
        for entry in members(key):
            model = load_member(key, entry['file'], entry['sha256'])
            votes += model(reference_tensor).argmax(1)[0, :image.height, :image.width].numpy().astype(np.uint8)
    assert np.array_equal(actual, (votes >= len(members(key)) // 2 + 1) & roi)
    item = {'model': key, 'seconds': round(time.perf_counter()-start, 3), 'frozen_pixels_equal': True,
            'peak_rss_mib': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}
    report.append(item)
    (out / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(item), flush=True)
from predict.m6_predictor import m6_best_predictor
start = time.perf_counter()
result = m6_best_predictor.predict(str(out/'input.png'), confidence_threshold=.5, min_area=100,
    morph_kernel_size=5, morph_iterations=1, patch_size=(512,512), stride=(256,256), overlay_opacity=.3)
assert result['mask'].shape == roi.shape
report.append({'model': 'm6_best', 'seconds': round(time.perf_counter()-start,3), 'shape_ok': True,
               'peak_rss_mib': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,1)})
(out/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report[-1]),flush=True)
