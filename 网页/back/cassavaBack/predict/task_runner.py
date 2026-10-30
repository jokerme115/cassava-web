"""Bounded, database-backed prediction task submission."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import logging
import threading

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone


logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(
    max_workers=max(1, int(getattr(settings, 'PREDICTION_TASK_WORKERS', 1))),
    thread_name_prefix='cassava-prediction',
)


def _execute(task_id):
    from .services import TaskService

    close_old_connections()
    try:
        return TaskService.execute_prediction_task(task_id)
    finally:
        close_old_connections()


def submit_prediction_task(task_id):
    """Submit one persisted task; duplicate submissions are ignored on claim."""
    if getattr(settings, 'PREDICTION_TASKS_DISABLED', False):
        return None
    future = _executor.submit(_execute, task_id)
    def log_failure(result):
        error = result.exception()
        if error:
            logger.error(
                'prediction_task_runner_failed task_id=%s: %s',
                task_id, error, exc_info=(type(error), error, error.__traceback__),
            )

    future.add_done_callback(log_failure)
    return future


def recover_prediction_tasks():
    """Requeue pending jobs and jobs whose database heartbeat is stale."""
    if getattr(settings, 'PREDICTION_TASKS_DISABLED', False):
        return
    from .models import ProcessingTask

    stale_before = timezone.now() - timedelta(
        minutes=max(5, int(getattr(settings, 'PREDICTION_TASK_STALE_MINUTES', 30)))
    )
    ProcessingTask.objects.filter(
        type='prediction', status='running', updated_time__lt=stale_before,
    ).update(status='pending', error='任务运行超时，已自动重新排队')
    pending_ids = list(
        ProcessingTask.objects.filter(type='prediction', status='pending')
        .order_by('created_time').values_list('id', flat=True)[:100]
    )
    for task_id in pending_ids:
        submit_prediction_task(task_id)


def start_recovery_loop():
    """Start a lightweight scheduler; atomic task claims prevent duplicates."""
    if getattr(settings, 'PREDICTION_TASKS_DISABLED', False):
        return

    def poll():
        try:
            recover_prediction_tasks()
        except Exception:
            logger.debug('prediction_task_recovery_not_ready', exc_info=True)
        timer = threading.Timer(30, poll)
        timer.daemon = True
        timer.start()

    timer = threading.Timer(1, poll)
    timer.daemon = True
    timer.start()
