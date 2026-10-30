"""Generate review copies from existing local results without changing business records."""
import os
import sys
import json
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '网页/back/cassavaBack'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'cassavaBack.test_settings_sqlite'
import django
django.setup()

from django.db.models import Prefetch
from predict.models import PredictionResult, PredictionCorrection
from predict.result_export import export_response

out = Path(__file__).parent / 'verified-exports-final'
out.mkdir(exist_ok=True)
queryset = PredictionResult.objects.select_related('original_image__folder', 'processing_task').prefetch_related(
    Prefetch('corrections', queryset=PredictionCorrection.objects.select_related('owner').order_by('-version'), to_attr='_ordered_corrections'))
summaries = {}
for file_type in ['csv', 'xlsx', 'zip']:
    response = export_response(queryset, file_type)
    target = out / f'cassava_results_verified.{file_type}'
    with target.open('wb') as output:
        for chunk in response.streaming_content:
            output.write(chunk)
    summaries[file_type] = {'count': int(response['X-Export-Count']), 'warnings': int(response['X-Export-Warnings']), 'bytes': target.stat().st_size}
    response.close()
with ZipFile(out / 'cassava_results_verified.zip') as package:
    assert package.testzip() is None
    manifest = json.loads(package.read('manifest.json'))
    for item in manifest['results']:
        for file in item['files'].values():
            assert file in package.namelist()
    summaries['package'] = {'results': manifest['count'], 'segments': sum(len(item['segments']) for item in manifest['results']),
                            'resource_errors': [item for item in manifest['results'] if item['errors']]}
with ZipFile(out / 'cassava_results_verified.xlsx') as workbook:
    assert workbook.testzip() is None
(out / 'verification.json').write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summaries, ensure_ascii=True, indent=2))
