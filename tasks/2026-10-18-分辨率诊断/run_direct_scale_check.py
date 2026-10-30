"""Direct-size inference complements fixed-size degradation; no application writes."""
import os
os.environ['NO_ALBUMENTATIONS_UPDATE'] = '1'
import sys
import json
import time
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
from predict.services import deeplabv3plus_service as service, post_process_mask
from predict.ensemble import vote_probabilities
from predict.m6_predictor import m6_best_predictor

torch.set_num_threads(4)
cv2.setNumThreads(2)
inventory = json.loads((OUT / 'inventory.json').read_text(encoding='utf-8'))
model = service.load_model(settings.DEEPLABV3_RESNET101_PATH, model_type='deeplabv3plus_resnet101')
records = []
levels = [96, 128, 192, 256, 384, 512, 'native']
manifest = {'type': 'direct-size supplementary sensitivity check', 'image_ids': [43, 44, 46],
            'crops': 'middle section', 'long_edge_levels': levels,
            'reason': 'separate information loss at fixed input size from actual input-scale and pixel-filter effects',
            'accuracy_ground_truth': None, 'threshold': .5, 'postprocess': [100, 5, 1]}
(OUT / 'direct-scale-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
for item in inventory:
    if item['image_id'] not in [43, 44, 46]:
        continue
    crop = item['latest_crops'][1]
    rgb = np.asarray(Image.open(crop['path']).convert('RGB'))
    height, width = rgb.shape[:2]
    support = service.get_cassava_area_mask(rgb) > 0
    for level in levels:
        resized = rgb if level == 'native' else cv2.resize(rgb,
            (max(1, round(width * level / max(width, height))), max(1, round(height * level / max(width, height)))),
            interpolation=cv2.INTER_AREA if level < max(width, height) else cv2.INTER_LINEAR)
        stem = f'direct-{item["image_id"]}-{level}'
        path = OUT / 'inputs' / f'{stem}.png'
        Image.fromarray(resized).save(path)
        started = time.perf_counter()
        first = service.predict_ppd(model, str(path), use_ensemble=False, return_masks=True, use_post_processing=False)
        second = m6_best_predictor.predict(path, use_post_processing=False)
        probabilities = [first[4], second['disease_prob']]
        _, mean, _ = vote_probabilities(probabilities, .5)
        scaled_support = cv2.resize(support.astype(np.uint8), (resized.shape[1], resized.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
        for name, probability in [('resnet101', probabilities[0]), ('m6_best', probabilities[1]), ('ensemble', mean)]:
            # Real-size fixed pixel filtering versus original-coordinate filtering.
            binary = (probability > .5).astype(np.uint8)
            actual_mask = post_process_mask(binary, 100, 5, 1)
            restored = cv2.resize(probability, (width, height), interpolation=cv2.INTER_LINEAR)
            comparable_mask = post_process_mask((restored > .5).astype(np.uint8), 100, 5, 1)
            records.append({'image_id': item['image_id'], 'crop': crop['key'], 'level': str(level), 'model': name,
                'input_width': resized.shape[1], 'input_height': resized.shape[0],
                'actual_scale_raw_ppd': 100 * int(np.count_nonzero((binary > 0) & scaled_support)) / int(scaled_support.sum()),
                'actual_scale_filtered_ppd': 100 * int(np.count_nonzero((actual_mask > 0) & scaled_support)) / int(scaled_support.sum()),
                'original_coordinate_filtered_ppd': 100 * int(np.count_nonzero((comparable_mask > 0) & support)) / int(support.sum())})
        (OUT / 'direct-scale-progress.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
        print(json.dumps({'done': stem, 'seconds': round(time.perf_counter() - started, 2),
                         'ppd': {r['model']: round(r['actual_scale_filtered_ppd'], 3) for r in records[-3:]}}), flush=True)
(OUT / 'direct-scale-results.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
