from pathlib import Path
import os, json, secrets
os.environ['DJANGO_SETTINGS_MODULE']='cassavaBack.dev_settings'
import django
django.setup()
from django.contrib.auth.models import User
from predict.models import LoginSession,ProcessingTask,PredictionResult,ImportJob
root=User.objects.filter(is_superuser=True,is_active=True).first()
session=LoginSession.objects.create(user=root)
Path('output/profile-redesign-20261101/browser-auth.private.json').write_text(json.dumps({'token':session.key,'user_id':root.pk}),encoding='utf-8')
Path('output/profile-redesign-20261101/data-before.json').write_text(json.dumps({'users':User.objects.count(),'tasks':ProcessingTask.objects.count(),'results':PredictionResult.objects.count(),'imports':ImportJob.objects.count()}),encoding='utf-8')
print('Temporary local browser session created; data counts recorded')
