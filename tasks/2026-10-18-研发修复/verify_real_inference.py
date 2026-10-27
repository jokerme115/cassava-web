"""Real model smoke check on one existing image; writes artifacts, never business results."""
import os
os.environ['NO_ALBUMENTATIONS_UPDATE'] = '1'
import sys
import time
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '网页/back/cassavaBack'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'cassavaBack.test_settings_sqlite'
import django
django.setup()
import numpy as np
import torch
from PIL import Image
from predict.models import CassavaImage
from predict.services import deeplabv3plus_service, PredictionService
from predict.mask_utils import mask_to_png_bytes

torch.set_num_threads(4)
image = CassavaImage.objects.get(id=55)
image_path = ROOT / '网页/back/cassavaBack/media' / image.oss_key
out = Path(__file__).parent / 'real-inference'
out.mkdir(exist_ok=True)
summaries = []
for model in ['resnet101', 'm6_best']:
    model_dir = out / model
    model_dir.mkdir(exist_ok=True)
    parameters = PredictionService._parse_prediction_params({'single_model_type': model,
        'parameters': {'confidenceThreshold': .5, 'minArea': 100, 'usePostProcessing': True,
                       'useTTA': False, 'expectedCount': 0}})
    started = time.perf_counter()
    result = deeplabv3plus_service.integrated_prediction(str(image_path), str(model_dir),
        single_model_type=parameters['single_model_type'], confidence_threshold=parameters['confidence'],
        min_area=parameters['min_area'], use_post_processing=parameters['use_post_processing'],
        use_tta=parameters['use_tta'], expected_count=parameters['expected_count'], stage1_confidence=.25, stage2_confidence=.25)
    if result.get('error'):
        raise RuntimeError(f'{model}: {result["error"]}')
    for name in ['cassava_mask', 'rotten_mask']:
        (model_dir / f'{name}.png').write_bytes(mask_to_png_bytes(result[name]))
    summary = {'model': model, 'image_id': image.id, 'seconds': time.perf_counter() - started,
               'ppd_percent': result['average_ppd'], 'segments': result['segments_count'],
               'prediction_count': result['predictions_count'], 'device': str(deeplabv3plus_service.device),
               'cassava_pixels': int(np.count_nonzero(result['cassava_mask'])),
               'rotten_pixels': int(np.count_nonzero(result['rotten_mask']))}
    summaries.append(summary)
    print(json.dumps(summary), flush=True)
(out / 'smoke-results.json').write_text(json.dumps(summaries, indent=2), encoding='utf-8')
