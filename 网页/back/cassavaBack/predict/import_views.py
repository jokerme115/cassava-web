import threading
_upload_lock = threading.RLock()
import hashlib
import shutil
from pathlib import PurePosixPath
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import ImportJob, ImportItem, Folder, ProcessingTask
from .permissions import HasPermission
from .import_pipeline import (safe_relative, item_path, staging_root, CHUNK_SIZE, MAX_SOURCE_BYTES,
                              MAX_ENTRIES, ARCHIVES, IMAGES)
from .recycling import unique_name


def job_data(job, detailed=True):
    items = job.items.order_by('pk')
    fields = ['id', 'relative_path', 'size', 'offset', 'state', 'error', 'image_id']
    if detailed:
        fields += ['sha256', 'chunk_hashes']
    else:
        items = items.exclude(error='')
    return {'id': job.pk, 'task_id': job.task_id, 'state': job.state, 'error': job.error,
            'summary': job.summary, 'options': {key: value for key, value in job.options.items() if key != 'directory_map'},
            'target_folder': job.target_folder_id,
            'destination_folder': job.options.get('directory_map', {}).get('/' + job.options.get('resolved_name', ''), job.target_folder_id),
            'items': list(items.values(*fields)), 'created_at': job.created_at.isoformat()}


class ImportJobViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, HasPermission]
    permission_codename = 'upload_image'
    queryset = ImportJob.objects.select_related('owner', 'target_folder')

    def get_queryset(self):
        return self.queryset.filter(owner=self.request.user).order_by('-pk')

    def list(self, request):
        return Response([job_data(job, detailed=False) for job in self.get_queryset()[:30]])

    def retrieve(self, request, pk=None):
        return Response(job_data(self.get_object()))

    @transaction.atomic
    def create(self, request):
        from .resource_lock import lock_owner
        lock_owner(request.user)
        manifest = request.data.get('files', [])
        if not isinstance(manifest, list) or not 1 <= len(manifest) <= MAX_ENTRIES:
            raise ValidationError('文件列表为空或超过20000项')
        paths, total, items = set(), 0, []
        for entry in manifest:
            try:
                path = safe_relative(entry['path']); size = int(entry['size'])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValidationError('无效文件列表') from exc
            if path.casefold() in paths or size < 0 or PurePosixPath(path).suffix.lower() not in IMAGES | ARCHIVES:
                raise ValidationError(f'重复路径或不支持的文件：{path}')
            paths.add(path.casefold()); total += size
            items.append((path, size))
        if total > MAX_SOURCE_BYTES:
            raise ValidationError('每批源文件总量不能超过5GB')
        # Streaming archive extraction needs source + extracted data; never reserve RAM.
        from django.conf import settings
        reserve = getattr(settings, 'IMPORT_MIN_FREE_BYTES', 512 * 1024**2)
        if shutil.disk_usage(staging_root()).free < total * 2 + reserve:
            raise ValidationError('本地磁盘剩余空间不足')
        target = None
        if request.data.get('target_folder'):
            target = Folder.objects.filter(pk=request.data['target_folder'], owner=request.user).first()
            if not target:
                raise ValidationError('目标目录不可写或已删除')
        options = request.data.get('options', {})
        if not isinstance(options, dict):
            raise ValidationError('无效导入设置')
        mode = options.get('mode', 'existing')
        if mode not in ('existing', 'new', 'custom'):
            raise ValidationError('无效目录策略')
        options = {k: options[k] for k in ('mode', 'name', 'preserve_hierarchy', 'check_duplicate', 'source_kind') if k in options}
        options['mode'] = mode
        if mode != 'existing':
            from django.contrib.auth.models import User
            User.objects.select_for_update().get(pk=request.user.pk)
            name = str(options.get('name') or PurePosixPath(items[0][0]).parts[0])
            name = PurePosixPath(name).stem if len(items) == 1 and PurePosixPath(name).suffix.lower() in ARCHIVES else name
            if not name.strip() or '/' in name or '\\' in name or name in ('.', '..'):
                raise ValidationError('无效目录名称')
            name = unique_name(Folder.objects.filter(owner=request.user, parent=target), name[:200])
            folder = Folder.objects.create(owner=request.user, parent=target, name=name)
            options['resolved_name'] = name
            options['directory_map'] = {'/' + name: folder.pk}
        task = ProcessingTask.objects.create(owner=request.user, name='导入 · ' + str(options.get('resolved_name') or '当前目录'),
            type='upload', status='pending')
        job = ImportJob.objects.create(owner=request.user, task=task, target_folder=target, options=options)
        ImportItem.objects.bulk_create([ImportItem(owner=request.user, job=job, relative_path=p, size=n) for p, n in items])
        task.parameters = {'import_job_id': job.pk, 'import_state': 'uploading'}; task.save(update_fields=['parameters'])
        return Response(job_data(job), status=201)

    @action(detail=True, methods=['post'], url_path=r'items/(?P<item_id>\d+)/chunk')
    def chunk(self, request, pk=None, item_id=None):
        job = self.get_object()
        payload = request.FILES.get('chunk')
        if payload is None or payload.size > CHUNK_SIZE:
            raise ValidationError('分块缺失或超过8MiB')
        try:
            offset = int(request.data.get('offset', -1))
        except (TypeError, ValueError) as exc:
            raise ValidationError('无效分块位置') from exc
        with _upload_lock, transaction.atomic():
            from .resource_lock import lock_owner
            lock_owner(request.user)
            item = ImportItem.objects.select_for_update().get(pk=item_id, job=job)
            if job.state != 'uploading' or item.archive_item:
                raise ValidationError('任务不在上传阶段')
            if offset != item.offset:
                return Response({'offset': item.offset, 'detail': '请从服务器已接收位置续传'}, status=409)
            if item.offset + payload.size > item.size:
                raise ValidationError('分块超过预期文件大小')
            path = item_path(item)
            with path.open('r+b' if path.exists() else 'wb') as stream:
                stream.seek(offset)
                for chunk in payload.chunks():
                    stream.write(chunk)
                stream.truncate()
                stream.flush()
                import os
                os.fsync(stream.fileno())
            item.offset += payload.size
            payload.seek(0)
            hashes = list(item.chunk_hashes or [])
            hashes.append({'offset': offset, 'size': payload.size, 'sha256': hashlib.sha256(payload.read()).hexdigest()})
            item.chunk_hashes = hashes
            item.save(update_fields=['offset', 'chunk_hashes'])
        return Response({'offset': item.offset})

    @action(detail=True, methods=['post'])
    def finalize(self, request, pk=None):
        job = self.get_object()
        if job.state in ('queued', 'running', 'completed', 'partial'):
            return Response(job_data(job))
        if job.state != 'uploading':
            raise ValidationError('任务不能提交')
        for item in job.items.all():
            path = item_path(item)
            if item.offset != item.size or not path.is_file() or path.stat().st_size != item.size:
                raise ValidationError(f'文件尚未传完整：{item.relative_path}')
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(CHUNK_SIZE), b''):
                    digest.update(chunk)
            item.sha256, item.state = digest.hexdigest(), 'ready'
            item.save(update_fields=['sha256', 'state'])
        ImportJob.objects.filter(pk=job.pk, state='uploading').update(state='queued', heartbeat=timezone.now())
        job.refresh_from_db()
        return Response(job_data(job))

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        job = self.get_object()
        job.state = 'cancelled'; job.save(update_fields=['state'])
        ProcessingTask.all_objects.filter(pk=job.task_id).update(status='cancelled')
        return Response(job_data(job))

    @action(detail=True, methods=['post'])
    def retry(self, request, pk=None):
        job = self.get_object()
        if job.state not in ('partial', 'failed'):
            raise ValidationError('只有失败或部分失败任务可重试')
        job.items.filter(state='failed').update(state='ready', error='')
        job.state, job.error = 'queued', ''; job.save(update_fields=['state', 'error'])
        ProcessingTask.all_objects.filter(pk=job.task_id).update(status='pending', error='')
        return Response(job_data(job))
