"""Acquire write intent before reading in transactions on SQLite.

SQLite ignores select_for_update; a deferred read-to-write upgrade can fail
immediately despite busy_timeout. PostgreSQL continues to use row locks.
"""
from django.contrib.auth.models import User
from django.db import connection
from django.db.models import F


def lock_owner(user):
    if not user:
        return
    user_id = user if isinstance(user, int) else user.pk
    if connection.vendor == 'sqlite':
        User.objects.filter(pk=user_id).update(last_login=F('last_login'))
    else:
        User.objects.select_for_update().get(pk=user_id)
