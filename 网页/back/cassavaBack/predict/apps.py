from django.apps import AppConfig
from django.conf import settings
import os
import sys


class PredictConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'predict'

    def ready(self):
        if getattr(settings, 'PREDICTION_TASKS_DISABLED', False):
            return
        is_runserver_parent = (
            settings.DEBUG
            and 'runserver' in sys.argv
            and '--noreload' not in sys.argv
            and os.environ.get('RUN_MAIN') not in {'true', '1'}
        )
        if is_runserver_parent:
            return
        from .task_runner import start_recovery_loop
        start_recovery_loop()
