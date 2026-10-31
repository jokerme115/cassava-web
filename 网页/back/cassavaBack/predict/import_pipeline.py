"""Bounded, restartable import pipeline. No archive paths are extracted onto disk."""
import hashlib
import os
import shutil
import subprocess
import uuid
from datetime import timedelta
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.core.files import File
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import ImportJob, ImportItem, Folder, ProcessingTask
from .services.image import ImageService
from .recycling import unique_name

CHUNK_SIZE = 8 * 1024 * 1024
MAX_SOURCE_BYTES = 5 * 1024**3
MAX_EXPANDED_BYTES = 20 * 1024**3
MAX_ENTRIES = 20000
MAX_IMAGE_BYTES = 128 * 1024**2
ARCHIVES = {'.zip', '.7z', '.rar'}
IMAGES = {'.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff', '.mpo'}


def report_progress(job, stage, current_file='', completed=0, total=None, **extra):
    progress = {'stage': stage, 'current_file': current_file, 'completed': completed,
                'total': total, 'updated_at': timezone.now().isoformat(), **extra}
    job.summary = {**job.summary, 'progress': progress}
    query = ImportJob.objects.filter(pk=job.pk, state__in=['uploading', 'queued', 'running'])
    if job.lease:
        query = query.filter(lease=job.lease)
    query.update(summary=job.summary, heartbeat=timezone.now())


def staging_root():
    root = Path(getattr(settings, 'IMPORT_STAGING_ROOT', settings.BASE_DIR / 'import_staging'))
    root.mkdir(parents=True, exist_ok=True)
    return root


def item_path(item):
    root = staging_root() / str(item.job.token)
    root.mkdir(parents=True, exist_ok=True)
    return root / f'{item.pk}.upload'


def safe_relative(value):
    value = str(value).replace('\\', '/')
    path = PurePosixPath(value)
    if not value or len(value) > 900 or path.is_absolute() or ':' in value or '\x00' in value or any(p in ('..', '.') for p in value.split('/')):
        raise ValueError('无效相对路径')
    return str(path)


def archive_runtime():
    path = Path(getattr(settings, 'SEVEN_ZIP_PATH', settings.BASE_DIR / 'runtime' / '7zip' / '7z.exe'))
    if not path.is_file():
        raise ValueError('压缩包运行时尚未准备：请运行本地准备脚本')
    return str(path)


def archive_entries(path):
    result = subprocess.run([archive_runtime(), 'l', '-slt', '-sccUTF-8', '-p', '--', str(path)],
                            capture_output=True, timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('压缩包无法读取；不支持加密或损坏的压缩包')
    text = result.stdout.decode('utf-8', errors='replace').replace('\r\n', '\n')
    if '----------' not in text:
        raise ValueError('无法解析压缩包目录')
    header, body = text.split('----------', 1)
    if any(line.startswith('Volumes = ') and int(line.split(' = ')[1]) > 1 for line in header.splitlines()) or 'Multivolume = +' in header or 'Encrypted = +' in text:
        raise ValueError('暂不支持加密包或分卷包，请在本机解压后上传目录')
    entries, names, total = [], set(), 0
    for block in body.strip().split('\n\n'):
        fields = dict(line.split(' = ', 1) for line in block.splitlines() if ' = ' in line)
        if not fields.get('Path'):
            continue
        name = safe_relative(fields['Path'])
        if fields.get('Folder') == '+' or fields.get('Attributes', '').startswith('D'):
            continue
        if any(fields.get(key) not in (None, '', '-', '0') for key in ('Symbolic Link', 'Hard Link', 'Copy Link', 'Reparse')):
            raise ValueError('不接受包含链接的压缩包')
        if name.casefold() in names:
            raise ValueError('压缩包包含重复路径')
        names.add(name.casefold())
        size = int(fields.get('Size', '0'))
        total += size
        if total > MAX_EXPANDED_BYTES or len(names) > MAX_ENTRIES:
            raise ValueError('解压总量超过20GB或条目数超过20000')
        if PurePosixPath(name).suffix.lower() in IMAGES:
            if size > MAX_IMAGE_BYTES:
                raise ValueError(f'单图超过128MB：{name}')
            entries.append((name, size))
    return entries


@transaction.atomic
def resolve_folder(job, relative, root_name=None):
    """Freeze directory mapping before importing; retries use exactly the same IDs."""
    from .resource_lock import lock_owner
    lock_owner(job.owner_id)
    opts = dict(job.options)
    mapping = dict(opts.get('directory_map', {}))
    parent = job.target_folder
    components = list(PurePosixPath(relative).parts[:-1])
    if root_name:
        components = [root_name] + components
    if not opts.get('preserve_hierarchy', True):
        components = components[:1] if root_name else []
    key = ''
    for part in components:
        key += '/' + part
        if key in mapping:
            parent = Folder.objects.get(pk=mapping[key])
            continue
        parent, _ = Folder.objects.get_or_create(owner=job.owner, parent=parent, name=part)
        mapping[key] = parent.pk
        opts['directory_map'] = mapping
        job.options = opts
        job.save(update_fields=['options'])
    return parent


def sync_progress(job):
    from django.db.models import Count
    counts = dict(job.items.exclude(state='container').values('state').annotate(n=Count('pk')).values_list('state', 'n'))
    total = sum(counts.values())
    done = sum(counts.get(state, 0) for state in ('success', 'skipped', 'failed'))
    job.summary = {**job.summary, 'total': total, 'success': counts.get('success', 0), 'skipped': counts.get('skipped', 0),
                   'failed': counts.get('failed', 0), 'finished': done}
    if job.summary.get('progress', {}).get('stage') == 'importing':
        job.summary['progress'].update(completed=done, total=total, updated_at=timezone.now().isoformat())
    job.heartbeat = timezone.now()
    job.save(update_fields=['summary', 'heartbeat'])
    ProcessingTask.all_objects.filter(pk=job.task_id).update(progress=int(100 * done / max(total, 1)),
        parameters={'import_job_id': job.pk, 'import_state': job.state, **job.summary})


def process_job(job_id, lease):
    job = ImportJob.objects.select_related('owner', 'target_folder').get(pk=job_id, lease=lease)
    try:
        job.state = 'running'; job.save(update_fields=['state'])
        ProcessingTask.all_objects.filter(pk=job.task_id).update(status='running')
        for item in job.items.filter(state='ready').order_by('pk'):
            job.refresh_from_db()
            if job.state == 'cancelled' or job.lease != lease:
                return
            try:
                if PurePosixPath(item.relative_path).suffix.lower() in ARCHIVES and not item.archive_item:
                    report_progress(job, 'scanning', item.relative_path)
                    entries = archive_entries(item_path(item))
                    if not entries:
                        raise ValueError('压缩包中没有支持的图片')
                    common = PurePosixPath(entries[0][0]).parts[0]
                    strip_outer = all(len(PurePosixPath(n).parts) > 1 and PurePosixPath(n).parts[0] == common for n, _ in entries)
                    for index, (original, size) in enumerate(entries):
                        report_progress(job, 'extracting', original, index, len(entries), archive=item.relative_path)
                        reserve = getattr(settings, 'IMPORT_MIN_FREE_BYTES', 512 * 1024**2)
                        if shutil.disk_usage(staging_root()).free < size * 2 + reserve:
                            raise ValueError('磁盘可用空间不足，请释放空间后重试失败项')
                        job.refresh_from_db()
                        if job.state == 'cancelled' or job.lease != lease: return
                        ImportJob.objects.filter(pk=job.pk, lease=lease).update(heartbeat=timezone.now())
                        internal = '/'.join(PurePosixPath(original).parts[1:]) if strip_outer else original
                        relative = safe_relative(f'{PurePosixPath(item.relative_path).stem}/{internal}')
                        child, created = ImportItem.objects.get_or_create(job=job, relative_path=relative, defaults={
                            'size': size, 'owner': job.owner, 'archive_item': True, 'state': 'extracting'})
                        if child.state in ('success', 'skipped', 'ready'):
                            continue
                        with item_path(child).open('wb') as stream:
                            proc = subprocess.Popen([archive_runtime(), 'x', '-so', '-spd', '-sccUTF-8', '-p', '--', str(item_path(item)), original],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                            written = 0
                            try:
                                while True:
                                    chunk = proc.stdout.read(1024**2)
                                    if not chunk:
                                        break
                                    written += len(chunk)
                                    if written > size or written > MAX_IMAGE_BYTES:
                                        raise ValueError('压缩条目展开大小不符')
                                    stream.write(chunk)
                                if proc.wait(timeout=30) or written != size:
                                    raise ValueError('压缩条目读取失败')
                            finally:
                                if proc.poll() is None:
                                    proc.kill(); proc.wait()
                        child.offset = size; child.state = 'ready'; child.error = ''
                        child.save(update_fields=['offset', 'state', 'error'])
                        report_progress(job, 'extracting', original, index + 1, len(entries), archive=item.relative_path)
                    # Container is not an image outcome; keep a stable scan marker.
                    item.state = 'container'; item.save(update_fields=['state'])
                else:
                    report_progress(job, 'importing', item.relative_path,
                        job.summary.get('finished', 0), job.summary.get('total'))
                    relative = item.relative_path
                    parts = PurePosixPath(relative).parts
                    if job.options.get('mode') in ('new', 'custom') and parts:
                        relative = '/'.join(parts[1:]) if len(parts) > 1 else relative
                        root_name = job.options.get('resolved_name')
                    else:
                        root_name = None
                        if (item.archive_item or job.options.get('source_kind') == 'folder') and len(parts) > 1:
                            relative = '/'.join(parts[1:])
                    folder = resolve_folder(job, relative, root_name)
                    with item_path(item).open('rb') as stream:
                        uploaded, error = ImageService.upload_image(File(stream, name=PurePosixPath(relative).name),
                            folder_id=folder.pk if folder else None, check_duplicate=job.options.get('check_duplicate', True), user=job.owner)
                    if error:
                        item.state = 'skipped' if error[0] == 'DUPLICATE_CONTENT' else 'failed'
                        item.error = error[1]
                    else:
                        item.state, item.image = 'success', uploaded
                    item.save(update_fields=['state', 'image', 'error'])
            except Exception as exc:
                item.state, item.error = 'failed', str(exc)
                item.save(update_fields=['state', 'error'])
            sync_progress(job)
        # Expanded archive items are handled on the next pass, using the same durable job.
        job.refresh_from_db()
        if job.state == 'cancelled' or job.lease != lease:
            return
        if job.items.filter(state='ready').exists():
            return process_job(job.pk, lease)
        sync_progress(job)
        job.state = ('partial' if job.summary.get('success', 0) + job.summary.get('skipped', 0) else 'failed') if job.summary.get('failed') else 'completed'
        job.error = (job.items.filter(state='failed').order_by('pk').values_list('error', flat=True).first() or '') if job.summary.get('failed') else ''
        job.save(update_fields=['state', 'error'])
        sync_progress(job)
        ProcessingTask.all_objects.filter(pk=job.task_id).update(status='failed' if job.state == 'failed' else 'completed', progress=100,
            error=f'{job.summary.get("failed", 0)} 个文件失败：{job.error}' if job.summary.get('failed') else '')
    except Exception as exc:
        if ImportJob.objects.filter(pk=job.pk, state='cancelled').exists():
            return
        job.state, job.error = 'failed', str(exc)
        job.save(update_fields=['state', 'error'])
        ProcessingTask.all_objects.filter(pk=job.task_id).update(status='failed', error=str(exc))


def claim_next_job():
    expiry = timezone.now() - timedelta(minutes=5)
    candidates = ImportJob.objects.filter(Q(state='queued') | Q(state='running', heartbeat__lt=expiry)).order_by('pk')
    for job in candidates:
        lease = uuid.uuid4()
        if ImportJob.objects.filter(pk=job.pk, state=job.state, lease=job.lease).update(
                state='running', lease=lease, heartbeat=timezone.now()):
            process_job(job.pk, lease)
            return True
    return False
