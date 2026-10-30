"""Check the actual browser-downloaded archive across masks, tables and metadata."""
import csv
import json
from io import BytesIO, StringIO
from pathlib import Path
from zipfile import ZipFile
import numpy as np
from PIL import Image
from openpyxl import load_workbook

root = Path(__file__).resolve().parents[1]
with ZipFile(root/'output/qa-browser-mobile-download.zip') as package:
    assert package.testzip() is None
    manifest = json.loads(package.read('manifest.json'))
    item = manifest['results'][0]
    csv_row = list(csv.DictReader(StringIO(package.read('results.csv').decode('utf-8-sig'))))[0]
    workbook = load_workbook(BytesIO(package.read('results.xlsx')), read_only=True, data_only=True)
    rows = list(workbook.worksheets[0].values)
    xlsx_row = dict(zip(rows[0], rows[1]))
    prefix = f"results/{item['result_id']}"
    cassava = np.asarray(Image.open(BytesIO(package.read(prefix+'/final_cassava_mask.png'))).convert('L')) > 127
    lesion = np.asarray(Image.open(BytesIO(package.read(prefix+'/final_rotten_mask.png'))).convert('L')) > 127
    cp, rp = int(cassava.sum()), int((lesion & cassava).sum())
    expected = rp/cp*100
    for value in [item['final_ppd'], float(csv_row['最终PPD(%)']), float(xlsx_row['最终PPD(%)'])]:
        assert abs(value-expected) < 1e-10, (value, expected)
    for cut in item['segments']:
        assert abs(cut['ppd_percent']-cut['rotten_pixels']/cut['cassava_pixels']*100) < 1e-10
    assert abs(sum(cut['rotten_pixels'] for cut in item['segments'])/sum(cut['cassava_pixels'] for cut in item['segments'])*100-expected) < 1e-10
    figure = package.read(prefix+'/PPD_contours.png')
    (root/'output/qa-export-final.png').write_bytes(figure)
    report = {'result_id': item['result_id'], 'version': item['correction_version'], 'review_status': item['review_status'],
        'cassava_pixels': cp, 'lesion_pixels': rp, 'ppd_percent': expected, 'cut_count': len(item['segments']),
        'figure_size': Image.open(BytesIO(figure)).size,
        'checks': ['ZIP CRC', 'PNG mask pixels = CSV = XLSX = manifest', 'each cut pixel ratio', 'area weighted whole image']}
    (root/'output/export-contract-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
