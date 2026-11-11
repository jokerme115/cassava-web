"""Real local HTTP import, CPU prediction, correction and export acceptance.

Uses the isolated upgrade QA account only. Existing images/results are not edited.
"""
import json
import time
import sys
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8000/api'
state = json.loads((ROOT/'output/qa-browser-state.json').read_text(encoding='utf-8'))
token = state['origins'][0]['localStorage'][0]['value']
session = requests.Session(); session.headers['Authorization'] = 'Token ' + token
RUN = str(int(time.time()))
report = {'run': RUN, 'imports': [], 'predictions': [], 'checks': []}


def request(method, path, **kwargs):
    response = session.request(method, BASE + path, timeout=180, **kwargs)
    if response.status_code >= 400:
        raise RuntimeError(f'{path}: {response.status_code} {response.text[:400]}')
    return response


def wait_job(job_id):
    for _ in range(1200):
        job = request('GET', f'/imports/{job_id}/').json()
        if job['state'] in ('completed', 'partial', 'failed', 'cancelled'):
            return job
        time.sleep(.5)
    raise RuntimeError('Import timed out')


def upload(files, name, **options):
    response = request('POST', '/imports/', json={'files': [{'path': key, 'size': len(data)} for key, data in files.items()],
        'options': {'mode': 'custom', 'name': f'{name}-{RUN}', 'preserve_hierarchy': True, **options}}).json()
    started = time.perf_counter()
    def transfer(item):
        data = files[item['relative_path']]
        for offset in range(0, len(data), 8*1024**2):
            answer = request('POST', f'/imports/{response["id"]}/items/{item["id"]}/chunk/',
                data={'offset': str(offset)}, files={'chunk': ('chunk.bin', data[offset:offset+8*1024**2])})
            assert answer.json()['offset'] == min(len(data), offset+8*1024**2)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(transfer, response['items']))
    request('POST', f'/imports/{response["id"]}/finalize/')
    job = wait_job(response['id'])
    entry = {'name': name, 'job_id': job['id'], 'state': job['state'], 'summary': job['summary'],
             'seconds': round(time.perf_counter()-started,3), 'source_bytes': sum(map(len,files.values()))}
    report['imports'].append(entry); (ROOT/'output/http-workflow-progress.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps(entry, ensure_ascii=False), flush=True)
    return job


def png(color):
    buffer = BytesIO(); Image.new('RGB', (32,24), color).save(buffer,format='PNG'); return buffer.getvalue()


def main():
    if '--reuse-imports' in sys.argv:
        jobs = request('GET', '/imports/').json()
        image_job = next(job for job in jobs if job['state']=='completed' and job['options'].get('resolved_name','').startswith('模型与复检验收'))
        image_job = request('GET', f"/imports/{image_job['id']}/").json()
        image_id = next(item['image_id'] for item in image_job['items'] if item['image_id'])
        previous_run = image_job['options']['resolved_name'].rsplit('-', 1)[1]
        report['imports'] = [{'job_id': job['id'], 'state':job['state'], 'summary':job['summary'], 'name':job['options'].get('resolved_name')} for job in jobs if job['options'].get('resolved_name','').endswith(previous_run)]
        assert any(job['summary'].get('success')==1000 and job['state']=='completed' for job in report['imports'])
    else:
        fixtures = ROOT/'output/qa-import-sources'
        for ext in ['zip','7z','rar']:
            job = upload({f'sample.{ext}': (fixtures/f'sample.{ext}').read_bytes()}, f'格式验收-{ext}')
            assert job['state']=='completed' and job['summary']['success']==2 and job['summary']['total']==2, job
        mixed = upload({'混合/a.png': png('green'), '混合/同内容.png': png('green'), '混合/坏图.png': b'broken'}, '混合验收', source_kind='folder')
        assert mixed['summary']['success']==1 and mixed['summary']['skipped']==1 and mixed['summary']['failed']==1
        large = upload({f'大批次/第{i//100:02d}组/img-{i:04d}.png': png((i%256,i//256,100)) for i in range(1000)}, '千图验收', source_kind='folder')
        assert large['summary']['success']==1000 and large['summary']['total']==1000
        reference = (ROOT/'网页/front/cassava_front/public/cases/ppd-example.png').read_bytes()
        job = upload({'reference-cassava.png': reference}, '模型与复检验收')
        image_id = next(item['image_id'] for item in job['items'] if item['image_id'])
    import psutil
    if '--camera' in sys.argv:
        camera = ROOT/'网页/back/cassavaBack/media/images/11/00094c202d56489a8084ff8c3b2b12d0.jpg'
        job = upload({'camera-cassava.jpg': camera.read_bytes()}, '相机原图模型与复检验收')
        image_id = next(item['image_id'] for item in job['items'] if item['image_id'])
    backend_pid = next(connection.pid for connection in psutil.net_connections(kind='tcp') if connection.laddr.port==8000 and connection.status=='LISTEN')
    backend = psutil.Process(backend_pid)
    pbt_result = None
    if '--reuse-predictions' in sys.argv:
        previous=json.loads((ROOT/'output/http-workflow-progress.json').read_text(encoding='utf-8'))
        report['predictions']=previous['predictions']
        pbt_result=request('GET',f"/predictions/{previous['predictions'][0]['result_id']}/").json()
        image_id=pbt_result.get('original_image', image_id)
    for key in ([] if pbt_result else ['pbt_c512','hrnet_w48','mask2former_swin_t','m6_best']):
        started = time.perf_counter()
        cpu_start = sum(backend.cpu_times()[:2])
        task = request('POST','/tasks/',json={'name': f'CPU验收-{key}-{RUN}', 'type':'prediction',
            'algorithm':key,'single_model_type':key,'image_ids':[image_id], 'parameters':{}}).json()
        task_id = task['id'] if 'id' in task else task['data']['id']
        for _ in range(1200):
            status = request('GET',f'/tasks/{task_id}/').json()
            if status['status'] in ('completed','failed','cancelled'):break
            time.sleep(.5)
        result = request('GET','/predictions/',params={'task_id':task_id}).json()
        assert status['status']=='completed' and result['count']==1, (status,result)
        output = result['results'][0]
        assert not output['error_code'], output
        entry = {'model':key,'task_id':task_id,'result_id':output['id'],'seconds':round(time.perf_counter()-started,3),
            'ppd_percent':output['measurement']['final_ppd'],'segments':len(output['sub_ppd_values']), 'process_cpu_seconds':round(sum(backend.cpu_times()[:2])-cpu_start,3), 'process_peak_working_set_mb':round(getattr(backend.memory_info(),'peak_wset',backend.memory_info().rss)/1024**2,1)}
        report['predictions'].append(entry); (ROOT/'output/http-workflow-progress.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(entry),flush=True)
        if key=='pbt_c512':pbt_result=output
    prediction_id=pbt_result['id']
    original_cassava=np.asarray(Image.open(BytesIO(session.get(urljoin(BASE,pbt_result['cassava_mask_url']),timeout=30).content)).convert('L'))
    original_rotten=np.asarray(Image.open(BytesIO(session.get(urljoin(BASE,pbt_result['rotten_mask_url']),timeout=30).content)).convert('L')).copy()
    indices=np.argwhere(original_rotten>127);assert len(indices)>0
    original_rotten[indices[0][0],indices[0][1]]=0
    def mask_bytes(mask):
        buffer=BytesIO();Image.fromarray(mask).save(buffer,format='PNG');return buffer.getvalue()
    correction=request('POST',f'/predictions/{prediction_id}/corrections/',data={'base_version':'0','note':'自动化验收修订，非人工真值'},
        files={'cassava_mask':('cassava.png',mask_bytes(original_cassava),'image/png'), 'rotten_mask':('rotten.png',mask_bytes(original_rotten),'image/png')}).json()
    correction=correction.get('data',correction)
    assert correction['version']==1
    request('POST',f'/predictions/{prediction_id}/review/',json={'version':1})
    current=request('GET',f'/predictions/{prediction_id}/').json()
    assert current['measurement']['review_status']=='reviewed'
    for version in ['latest','model']:
        response=request('GET','/predictions/export/',params={'file_type':'zip','result_ids':str(prediction_id),'version':version})
        destination=ROOT/f'output/qa-export-{version}-{RUN}.zip';destination.write_bytes(response.content)
        with ZipFile(BytesIO(response.content)) as archive:
            assert archive.testzip() is None
            manifest=json.loads(archive.read('manifest.json'))
            row=manifest['results'][0]
            assert row['correction_version']==(1 if version=='latest' else 0)
            png_data=archive.read(f'results/{prediction_id}/PPD_contours.png')
            preview=request('GET',f'/predictions/{prediction_id}/figure/',params={'version':version}).content
            assert png_data==preview, 'preview/export version or rendering mismatch'
            image=Image.open(BytesIO(png_data));assert image.width>600 and image.height>600
    custom={'cassava_color':'#2255ff','rotten_color':'#ff7700','cassava_fill':True,'rotten_fill':True,
            'cassava_opacity':.15,'rotten_opacity':.6,'cassava_line_width':4,'rotten_line_width':3,'columns':2,'collage':True}
    response=request('GET','/predictions/export/',params={'file_type':'zip','result_ids':str(prediction_id),'style':json.dumps(custom)})
    with ZipFile(BytesIO(response.content)) as archive:
        assert 'PPD_collage.png' in archive.namelist()
        assert json.loads(archive.read('manifest.json'))['style']['rotten_opacity']==.6
    report['checks'] += ['ZIP/7Z/RAR real import', '1000 images real transfer/import', 'mixed partial failure',
        'four model real HTTP CPU tasks', 'saved correction and version-bound review', 'model/latest export snapshot',
        'preview equals packaged PNG byte-for-byte', 'custom fill/colors/opacity/strokes/collage']
    report['qa_image_id']=image_id; report['qa_prediction_id']=prediction_id
    (ROOT/'output/http-workflow-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('HTTP acceptance complete',flush=True)


if __name__=='__main__':
    main()
