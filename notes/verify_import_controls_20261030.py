"""Real HTTP chunk resume, cancellation and failed-only retry on isolated QA data."""
from verify_http_workflow_20261029 import request, wait_job, ROOT, png
import hashlib
import json
import time
from io import BytesIO
import numpy as np
from PIL import Image

run = str(int(time.time()))
buffer = BytesIO()
Image.fromarray(np.random.default_rng(42).integers(0,256,(2048,2048,3),dtype=np.uint8)).save(buffer, format='PNG')
raw = buffer.getvalue()
job = request('POST','/imports/',json={'files':[{'path':'resume.png','size':len(raw)}], 'options':{'mode':'custom','name':'续传验收-'+run}}).json()
item = job['items'][0]; chunk = 8*1024**2
request('POST',f"/imports/{job['id']}/items/{item['id']}/chunk/", data={'offset':'0'}, files={'chunk':('chunk.bin',raw[:chunk])})
restored = request('GET',f"/imports/{job['id']}/").json()['items'][0]
assert restored['offset']==chunk
assert restored['chunk_hashes'][0]['sha256']==hashlib.sha256(raw[:chunk]).hexdigest()
request('POST',f"/imports/{job['id']}/items/{item['id']}/chunk/", data={'offset':str(restored['offset'])},files={'chunk':('chunk.bin',raw[chunk:])})
request('POST',f"/imports/{job['id']}/finalize/")
completed = wait_job(job['id']); assert completed['summary']['success']==1
image_id = next(item['image_id'] for item in completed['items'] if item['image_id'])
image = request('GET',f'/images/{image_id}/').json()
assert image['content_sha256']==hashlib.sha256(raw).hexdigest()

raw = png('yellow')
cancel_job = request('POST','/imports/',json={'files':[{'path':f'{i}.png','size':len(raw)} for i in range(100)], 'options':{'mode':'custom','name':'取消验收-'+run}}).json()
for item in cancel_job['items']:
    request('POST',f"/imports/{cancel_job['id']}/items/{item['id']}/chunk/",data={'offset':'0'},files={'chunk':('chunk.bin',raw)})
request('POST',f"/imports/{cancel_job['id']}/finalize/")
request('POST',f"/imports/{cancel_job['id']}/cancel/")
time.sleep(2)
cancelled = request('GET',f"/imports/{cancel_job['id']}/").json()
assert cancelled['state']=='cancelled'
counts = cancelled['summary']
time.sleep(1)
assert request('GET',f"/imports/{cancel_job['id']}/").json()['summary']==counts

before = request('GET','/imports/15/').json()
kept = {item['id']:item['image_id'] for item in before['items'] if item['state'] in ('success','skipped')}
request('POST','/imports/15/retry/')
after = wait_job(15)
assert after['summary']['success']==before['summary']['success']
assert all(next(item for item in after['items'] if item['id']==pk)['image_id']==image_id for pk,image_id in kept.items())
report = {'resume':{'job_id':job['id'],'source_bytes':len(buffer.getvalue()),'restored_offset':chunk,'image_id':image_id,'original_sha256_verified':True},
          'cancel':{'job_id':cancel_job['id'],'state':cancelled['state'],'summary_stable':True},
          'retry':{'job_id':15,'preserved_success_items':len(kept),'summary':after['summary']}}
(ROOT/'output/import-controls-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
