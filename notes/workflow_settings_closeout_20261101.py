import os,json,urllib.request
from pathlib import Path
os.environ['DJANGO_SETTINGS_MODULE']='cassavaBack.dev_settings'
import django
django.setup()
from django.contrib.auth.models import User
from predict.models import UserProfile,ProcessingTask,PredictionResult,ImportJob,CassavaImage
base=Path('output/workflow-settings-20261101')
before=json.loads((base/'data-before.json').read_text(encoding='utf-8'))
user=User.objects.get(username='import-ui-qa')
(base/'qa-preferences-tested.json').write_text(json.dumps(user.profile.preferences,ensure_ascii=False,indent=2),encoding='utf-8')
UserProfile.objects.filter(user=user).update(preferences=before['qa_preferences'])
state=json.loads((base/'browser.private.json').read_text(encoding='utf-8'))
token=state['origins'][0]['localStorage'][0]['value']
req=urllib.request.Request('http://127.0.0.1:8000/api/auth/logout/',data=b'{}',headers={'Authorization':'Token '+token,'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=15) as reply: print('Temporary verification session revoked:',reply.status)
after={'users':User.objects.count(),'tasks':ProcessingTask.objects.count(),'results':PredictionResult.objects.count(),'imports':ImportJob.objects.count()}
unchanged=all(after[key]==before[key] for key in after)
after['original_counts_unchanged']=unchanged
after['images']=CassavaImage.objects.count()
after['pending_tasks']=list(ProcessingTask.objects.exclude(status__in=['completed','failed','cancelled']).values('id','status'))
after['qa_preferences_restored']=UserProfile.objects.get(user=user).preferences==before['qa_preferences']
(base/'data-after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf-8')
print('Data verification:',json.dumps(after,ensure_ascii=True))
if not unchanged or not after['qa_preferences_restored']: raise RuntimeError('Baseline mismatch')
p=Path(r'C:\Users\Administrator\Desktop\work\INDEX.md')
lines=p.read_text(encoding='utf-8').splitlines()
for i,line in enumerate(lines):
    if line.startswith('| [CAS-WEB '):
        fields=line.split('|')
        fields[2]=fields[2].rstrip()+'；2026-11-01 本地设置归并已实施：列表/导入默认值、版本化预测预设、账号导出模板及快捷导出、连续复检偏好与快捷键速查；偏好分类合并及ETag冲突保护、请求合并/空闲轮询已接通；前端79/后端114项、构建与类型检查通过，96条分页及真实切面导出预览已验；6账号/39任务/141结果/22导入保留，QA偏好恢复；未推送或部署。见tasks/2026-11-01-设置归并与连续工作流实施.md。 '
        fields[3]=' 本地审阅 /profile 新设置、预测预设和快捷导出；快捷键自定义、命名视图及性能基准列为后续项，后续发布另行确定，原运维待办保持记录。 '
        fields[4]=' 2026-11-01（设置归并与连续工作流实施） '
        lines[i]='|'.join(fields);break
else: raise RuntimeError('CAS-WEB missing')
p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
