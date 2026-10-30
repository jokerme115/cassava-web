"""Read-only database/mask audit and isolated synthetic checks. No Django setup."""
import ast
import json
import sqlite3
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BACK = ROOT / '网页/back/cassavaBack'
MEDIA = BACK / 'media'


def extract_function(path, name):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    node.decorator_list = []
    namespace = {'np': np, 'cv2': cv2}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace[name]


def metrics(cassava, rotten):
    c = int(np.count_nonzero(cassava))
    r = int(np.count_nonzero(np.asarray(cassava, bool) & np.asarray(rotten, bool)))
    return {'cassava_pixels': c, 'rotten_pixels': r, 'ppd': r / c * 100 if c else 0}


db = sqlite3.connect((BACK / 'db.sqlite3').as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
rows = [dict(r) for r in db.execute('''SELECT p.id,p.ppd_value,p.ppd_unit,p.model_type,
 p.single_model_type,p.cassava_mask_key,p.rotten_mask_key,p.confidence_map_key,
 p.original_image_id,p.processing_task_id,i.name,i.oss_key FROM predict_predictionresult p
 LEFT JOIN predict_cassavaimage i ON i.id=p.original_image_id ORDER BY p.id''')]
corrections = [dict(r) for r in db.execute('SELECT * FROM predict_predictioncorrection')]
tasks = [dict(r) for r in db.execute('SELECT id,single_model_type,parameters FROM predict_processingtask')]
db.close()

area_mask = extract_function(BACK / 'predict/services.py', 'get_cassava_area_mask')
post_process = extract_function(BACK / 'predict/m6_predictor.py', '_post_process_mask')
parse_params = extract_function(BACK / 'predict/services.py', '_parse_prediction_params')
task_checks = []
for task in tasks:
    parsed = parse_params(json.loads(task['parameters']) if task['parameters'] else {})
    task_checks.append({'task_id': task['id'], 'selected_model': task['single_model_type'],
                        'resolved_model': parsed['single_model_type'], 'resolved_label': parsed['model_label']})
mask_checks = []
color_checks = []
seen = set()
for row in rows:
    cp, rp = MEDIA / (row['cassava_mask_key'] or ''), MEDIA / (row['rotten_mask_key'] or '')
    entry = {'id': row['id'], 'name': row['name'], 'stored_ppd': row['ppd_value'],
             'model_type': row['model_type'], 'single_model_type': row['single_model_type']}
    if cp.is_file() and rp.is_file():
        c, r = np.asarray(Image.open(cp)) > 127, np.asarray(Image.open(rp)) > 127
        entry.update(metrics(c, r))
        entry.update(width=c.shape[1], height=c.shape[0], outside_rotten=int(np.count_nonzero(r & ~c)))
        entry['difference_pp'] = entry['ppd'] - row['ppd_value']
    else:
        entry['missing_mask_file'] = True
    mask_checks.append(entry)
    ip = MEDIA / (row['oss_key'] or '')
    if row['original_image_id'] not in seen and ip.is_file():
        seen.add(row['original_image_id'])
        with Image.open(ip) as im:
            im = im.convert('RGB')
            rgb = np.asarray(im)
            direct = area_mask(None, rgb)
            canonical = area_mask(None, im)
            color_checks.append({'image_id': row['original_image_id'], 'name': row['name'],
                                 'differing_pixels': int(np.count_nonzero(direct != canonical)),
                                 'direct_pixels': int(direct.sum()), 'canonical_pixels': int(canonical.sum())})

correction_checks = []
for correction in corrections:
    cp, rp = MEDIA / correction['cassava_mask_key'], MEDIA / correction['rotten_mask_key']
    item = {k: correction[k] for k in ['prediction_id', 'version', 'ppd_percent', 'width', 'height']}
    if cp.is_file() and rp.is_file():
        item.update(metrics(np.asarray(Image.open(cp)) > 127, np.asarray(Image.open(rp)) > 127))
        item['difference_pp'] = item['ppd'] - correction['ppd_percent']
    else:
        item['missing_mask_file'] = True
    correction_checks.append(item)

small = np.zeros((100, 100), np.uint8)
small[10:18, 10:18] = 1
line = np.zeros((100, 100), np.uint8)
line[40:42, 10:80] = 1
ring = np.zeros((100, 100), np.uint8)
cv2.circle(ring, (50, 50), 30, 1, 3)
synthetic = []
for name, mask in [('small_64px', small), ('thin_140px', line), ('ring', ring)]:
    out = post_process(mask.copy())
    synthetic.append({'case': name, 'before_pixels': int(mask.sum()), 'after_pixels': int(out.sum())})
filled = post_process(ring.copy(), min_area=0, morph_kernel_size=0, morph_iterations=0)
synthetic.append({'case': 'ring_fill_only', 'before_pixels': int(ring.sum()), 'after_pixels': int(filled.sum())})
probe = {'confidenceThreshold': 0.91, 'minArea': 7, 'single_model_type': 'm6_best', 'useTTA': True,
         'usePostProcessing': False, 'patchSize': [256, 256], 'stride': [128, 128]}
synthetic.append({'case': 'flat_advanced_parameters', 'input': probe, 'parsed': parse_params(probe)})
gray = np.full((100, 100, 3), 120, np.uint8)
synthetic.append({'case': 'no_cassava_uniform_gray', 'cassava_pixels': int(area_mask(None, gray).sum())})

payload = {'prediction_count': len(rows), 'zero_predictions': sum(r['ppd_value'] == 0 for r in rows),
           'correction_count': len(corrections), 'mask_checks': mask_checks,
           'correction_checks': correction_checks, 'rgb_bgr_checks': color_checks, 'synthetic_checks': synthetic,
           'task_checks': task_checks}
latest = {}
for correction in sorted(corrections, key=lambda q: q['version']):
    latest[correction['prediction_id']] = correction['ppd_percent']
effective, displayed = [], []
for row in rows:
    value = latest.get(row['id'], row['ppd_value'])
    effective.append(value)
    h = 2166136261
    for char in f"{row['name'] or ''}|{row['processing_task_id'] or ''}":
        h = ((h ^ ord(char)) * 16777619) & 0xffffffff
    displayed.append(value if value > 0 else round(0.42 + (h % 306) / 100, 2))
task_by_id = {q['id']: q for q in tasks}
actual_mismatches = [r['id'] for r in rows if r['processing_task_id'] in task_by_id
                    and task_by_id[r['processing_task_id']]['single_model_type'] != r['single_model_type']]
payload['summary'] = {'latest_corrected_mean': sum(effective) / len(effective),
                      'displayed_mean': sum(displayed) / len(displayed),
                      'affected_zero_entries_after_corrections': sum(v == 0 for v in effective),
                      'actual_task_model_mismatch_result_ids': actual_mismatches}
output = Path(__file__).with_name('evidence.json')
output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'prediction_count': len(rows), 'zero_predictions': payload['zero_predictions'],
                  'correction_count': len(corrections), 'missing_masks': sum('missing_mask_file' in r for r in mask_checks),
                  'ppd_mismatches': [r for r in mask_checks if abs(r.get('difference_pp', 0)) > 1e-6],
                  'correction_mismatches': [r for r in correction_checks if abs(r.get('difference_pp', 0)) > 1e-6],
                  'task_model_mismatches': [r for r in task_checks if r['selected_model'] != r['resolved_model']],
                  'color_differences': color_checks, 'synthetic_checks': synthetic,
                  'output': str(output)}, ensure_ascii=False, indent=2))
