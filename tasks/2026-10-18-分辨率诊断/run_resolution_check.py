"""Exploratory inference only: fixed crops, no DB writes or threshold tuning."""
import os
os.environ['NO_ALBUMENTATIONS_UPDATE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
import sys
import json
import csv
import time
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent
sys.path.insert(0, str(ROOT / '网页/back/cassavaBack'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'cassavaBack.test_settings_sqlite'
import django
django.setup()
import cv2
import numpy as np
import torch
from PIL import Image
from django.conf import settings
from predict.services import deeplabv3plus_service as service, post_process_mask, prediction_provenance
from predict.m6_predictor import m6_best_predictor
from predict.ensemble import vote_probabilities

torch.set_num_threads(4)
cv2.setNumThreads(2)
inventory = json.loads((OUT / 'inventory.json').read_text(encoding='utf-8'))
manifest = {
    'purpose': 'resolution sensitivity, not accuracy or validation-set model selection',
    'high_resolution_images': [43, 44, 46], 'high_resolution_crops': 9,
    'information_levels_long_edge': [96, 128, 192, 256, 384, 512, 'native'],
    'high_arm': 'downsample INTER_AREA, restore to native crop size INTER_LINEAR; hold geometry and support fixed',
    'low_resolution_images': [48, 52, 54], 'low_crops': 'middle detected section of each image',
    'input_scale_levels_long_edge': ['native', 256, 512, 768],
    'low_arm': 'interpolate existing low resolution crop; does not acquire new image detail',
    'models': ['resnet101', 'm6_best'], 'threshold': 0.5,
    'postprocessing': {'min_area': 100, 'morph_kernel_size': 5, 'morph_iterations': 1},
    'tta': False, 'm6_patch': [512, 512], 'm6_stride': [256, 256],
    'hardware': {'device': str(service.device), 'torch_threads': 4},
    'accuracy_ground_truth': None,
    'weights': prediction_provenance('ensemble'),
}
(OUT / 'experiment-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
weights = service.load_model(settings.DEEPLABV3_RESNET101_PATH, model_type='deeplabv3plus_resnet101')
records = []
masks = OUT / 'probability-maps'
masks.mkdir(exist_ok=True)
inputs = OUT / 'inputs'
inputs.mkdir(exist_ok=True)


def resize_long(rgb, long_edge):
    h, w = rgb.shape[:2]
    shape = (max(1, round(w * long_edge / max(h, w))), max(1, round(h * long_edge / max(h, w))))
    return cv2.resize(rgb, shape, interpolation=cv2.INTER_AREA if long_edge < max(h, w) else cv2.INTER_LINEAR)


def ppd(mask, support):
    return 100 * int(np.count_nonzero((mask > 0) & support)) / int(np.count_nonzero(support))


def run(rgb, support, arm, image_id, crop_name, level, native_shape, information_size):
    stem = f'{arm}-{image_id}-{crop_name}-{level}'
    path = inputs / (stem + '.png')
    Image.fromarray(rgb).save(path)
    started = time.perf_counter()
    maps = []
    for name in ['resnet101', 'm6_best']:
        if name == 'resnet101':
            prob = service.predict_ppd(weights, str(path), confidence_threshold=.5,
                use_ensemble=False, return_masks=True, use_post_processing=False)[4]
        else:
            prob = m6_best_predictor.predict(path, use_post_processing=False, use_tta=False)['disease_prob']
        maps.append(prob)
    vote, mean, different = vote_probabilities(maps, .5)
    entries = [('resnet101', maps[0]), ('m6_best', maps[1]), ('ensemble', mean)]
    for name, probability in entries:
        original_probability = cv2.resize(probability, (native_shape[1], native_shape[0]), interpolation=cv2.INTER_LINEAR)
        raw = (original_probability > .5).astype(np.uint8)
        filtered = post_process_mask(raw, 100, 5, 1)
        # All comparable metrics use the original specimen support and original coordinate filter size.
        native_mask = support.astype(np.uint8)
        np.savez_compressed(masks / f'{stem}-{name}.npz', probability=original_probability,
                            support=native_mask, raw=raw, filtered=filtered)
        rec = {'arm': arm, 'image_id': image_id, 'crop': crop_name, 'level': str(level), 'model': name,
               'native_width': native_shape[1], 'native_height': native_shape[0],
               'information_width': information_size[0], 'information_height': information_size[1],
               'input_width': rgb.shape[1], 'input_height': rgb.shape[0],
               'cassava_pixels': int(support.sum()), 'raw_ppd': ppd(raw, support),
               'filtered_ppd': ppd(filtered, support), 'prob_max': float(original_probability[support].max()),
               'map_path': str(masks / f'{stem}-{name}.npz')}
        records.append(rec)
    (OUT / 'results-progress.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
    print(json.dumps({'done': stem, 'seconds': round(time.perf_counter() - started, 2),
                      'ppd': {r['model']: round(r['filtered_ppd'], 3) for r in records[-3:]}}), flush=True)


for item in inventory:
    if item['image_id'] not in [43, 44, 46, 48, 52, 54]:
        continue
    is_high = item['image_id'] in [43, 44, 46]
    selected = item['latest_crops'] if is_high else item['latest_crops'][1:2]
    for crop in selected:
        rgb = np.asarray(Image.open(crop['path']).convert('RGB'))
        support = service.get_cassava_area_mask(rgb) > 0
        if not support.any():
            raise ValueError('Empty specimen support')
        for level in ([96, 128, 192, 256, 384, 512, 'native'] if is_high else ['native', 256, 512, 768]):
            low = rgb.copy() if level == 'native' else resize_long(rgb, level)
            information_size = (low.shape[1], low.shape[0]) if is_high else (rgb.shape[1], rgb.shape[0])
            model_input = cv2.resize(low, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR) if is_high else low
            run(model_input, support, 'degrade_restore' if is_high else 'upsample_only',
                item['image_id'], crop['key'], level, rgb.shape[:2], information_size)

(OUT / 'results.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
with (OUT / 'results.csv').open('w', newline='', encoding='utf-8-sig') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(records[0]))
    writer.writeheader()
    writer.writerows(records)
print(json.dumps({'completed_rows': len(records), 'forward_pair_runs': len(records) // 3}), flush=True)
