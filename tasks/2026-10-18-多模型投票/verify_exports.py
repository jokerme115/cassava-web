"""Read-only checks of the UI-created task and its portable exports."""
import os
os.environ['NO_ALBUMENTATIONS_UPDATE'] = '1'
import sys
import json
import csv
import sqlite3
from io import BytesIO, StringIO
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / '网页/back/cassavaBack'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'cassavaBack.test_settings_sqlite'
import django
django.setup()
import numpy as np
from PIL import Image
from rest_framework.test import APIClient
from predict.models import ProcessingTask
from predict.storage_utils import read_storage_bytes

out = Path(__file__).parent / 'exports'
out.mkdir(exist_ok=True)
task = ProcessingTask.objects.get(name='双模型投票验收-20261018')
assert task.status == 'completed'
assert len(task.parameters['_execution']['weights']) == 4
client = APIClient(HTTP_HOST='127.0.0.1')
client.force_authenticate(user=task.owner)
results = []
for prediction in task.prediction_results.all():
    response = client.get(f'/api/predictions/{prediction.id}/')
    assert response.status_code == 200
    details = response.data['ensemble_details']
    support = np.asarray(Image.open(BytesIO(read_storage_bytes(prediction.cassava_mask_key)))) > 0
    lesion = np.asarray(Image.open(BytesIO(read_storage_bytes(prediction.rotten_mask_key)))) > 0
    disagreement = np.asarray(Image.open(BytesIO(read_storage_bytes(prediction.vis_images['disagreement'])))) > 0
    assert abs(100 * np.count_nonzero(support & lesion) / support.sum() - prediction.ppd_value) < 1e-8
    assert details['disagreement_pixels'] == np.count_nonzero(support & disagreement)
    for member in details['members']:
        mask = np.asarray(Image.open(BytesIO(read_storage_bytes(prediction.vis_images['member_' + member['model']])))) > 0
        assert abs(100 * np.count_nonzero(support & mask) / support.sum() - member['ppd_percent']) < 1e-8
    results.append({'id': prediction.id, 'ppd': prediction.ppd_value, 'details': details})

export_checks = {}
for kind in ['csv', 'xlsx', 'zip']:
    response = client.get('/api/predictions/export/', {'file_type': kind, 'task_id': task.id})
    assert response.status_code == 200, response.status_code
    payload = b''.join(response.streaming_content)
    (out / f'voting-task-37.{kind}').write_bytes(payload)
    assert int(response['X-Export-Count']) == 2
    assert int(response['X-Export-Warnings']) == 0
    if kind == 'csv':
        rows = list(csv.DictReader(StringIO(payload.decode('utf-8-sig'))))
        assert len(rows) == 2
        assert {r['模型'] for r in rows} == {'V1.0 + V1.1 投票'}
        assert all(json.loads(r['投票明细'])['method'] == 'pixel_vote_probability_tiebreak' for r in rows)
    if kind == 'xlsx':
        with ZipFile(BytesIO(payload)) as book:
            sheet = ElementTree.fromstring(book.read('xl/worksheets/sheet1.xml'))
            assert len(sheet.findall('.//{*}row')) == 3
    if kind == 'zip':
        with ZipFile(BytesIO(payload)) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            assert manifest['count'] == 2
            for item in manifest['results']:
                assert not item['errors']
                assert len(item['ensemble_details']['members']) == 2
                for name in ['disagreement.png', 'member_resnet101.png', 'member_m6_best.png']:
                    Image.open(BytesIO(archive.read(item['files'][name]))).verify()
    export_checks[kind] = {'count': 2, 'bytes': len(payload), 'warnings': 0}

# Compare every old business field, omitting only the newly added JSON column.
before = sqlite3.connect(str(Path(__file__).parent / 'database-before.sqlite3'))
current = sqlite3.connect(str(root / '网页/back/cassavaBack/db.sqlite3'))
preservation = {}
for table in ['predict_predictionresult', 'predict_predictioncorrection', 'predict_processingtask', 'predict_cassavaimage']:
    columns = [row[1] for row in before.execute(f'PRAGMA table_info({table})')]
    rows = before.execute(f'SELECT {",".join(columns)} FROM {table} ORDER BY id').fetchall()
    expected = {row[columns.index('id')]: row for row in rows}
    actual = {row[columns.index('id')]: row for row in current.execute(f'SELECT {",".join(columns)} FROM {table} ORDER BY id')}
    assert all(actual.get(key) == row for key, row in expected.items()), table
    preservation[table] = {'old_rows_unchanged': len(rows), 'new_rows': len(actual) - len(rows)}

summary = {'task_id': task.id, 'results': results, 'exports': export_checks, 'preservation': preservation}
(out / 'verification.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'task_id': task.id, 'exports': export_checks, 'preservation': preservation}, indent=2))
