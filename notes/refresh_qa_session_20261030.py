"""Refresh only the isolated local acceptance account's browser state."""
import os
import sys
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'网页/back/cassavaBack'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'cassavaBack.dev_settings'
import django
django.setup()
from django.contrib.auth.models import User
from predict.models import LoginSession
from django.utils import timezone

user = User.objects.get(username='upgrade_qa_20261029')
session = LoginSession.objects.create(user=user, last_seen=timezone.now())
path = root/'output/qa-browser-state.json'
state = json.loads(path.read_text(encoding='utf-8'))
for origin in state['origins']:
    for item in origin['localStorage']:
        if item['name'] in ('token', 'authToken', 'access_token', 'cassava_token'):
            item['value'] = session.key
path.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
print('Isolated QA browser state refreshed; keys:', [item['name'] for item in state['origins'][0]['localStorage']])
