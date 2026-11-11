"""Explicit reversible removal; physical deletion is a separate confirmed operation."""
import uuid
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response


def descendants(folder):
    from .models import Folder
    ids, pending = set(), [folder.pk]
    while pending:
        current = pending.pop()
        if current in ids:
            continue
        ids.add(current)
        pending.extend(Folder.all_objects.filter(parent_id=current).values_list('pk', flat=True))
    return ids


def unique_name(queryset, name, exclude=None):
    from pathlib import PurePath
    if exclude:
        queryset = queryset.exclude(pk=exclude)
    candidate, index = name, 1
    path = PurePath(name)
    while queryset.filter(name=candidate).exists():
        candidate = f'{path.stem} ({index}){path.suffix}'
        index += 1
    return candidate


def recycle(instance, user):
    from .models import Folder, CassavaImage, ProcessingTask
    now, batch = timezone.now(), uuid.uuid4()
    fields = dict(deleted_at=now, deleted_by=user, deletion_batch=batch)
    with transaction.atomic():
        from .resource_lock import lock_owner
        lock_owner(user)
        if isinstance(instance, Folder):
            ids = descendants(instance)
            CassavaImage.objects.filter(folder_id__in=ids).update(**fields)
            Folder.objects.filter(pk__in=ids).update(**fields)
        else:
            if isinstance(instance, ProcessingTask) and instance.status in ('running', 'pending'):
                raise ValidationError('请先取消任务，再移入回收站')
            type(instance).all_objects.filter(pk=instance.pk, deleted_at__isnull=True).update(**fields)


def restore(instance):
    from .models import Folder, CassavaImage
    with transaction.atomic():
        from .resource_lock import lock_owner
        lock_owner(instance.owner_id)
        if isinstance(instance, Folder):
            if instance.parent_id and not Folder.objects.filter(pk=instance.parent_id).exists():
                instance.parent = None
            instance.name = unique_name(Folder.objects.filter(owner=instance.owner, parent=instance.parent), instance.name)
            instance.save(update_fields=['name', 'parent'])
            batch = instance.deletion_batch
            # Restore only records removed by the same operation; older trash stays in trash.
            ids = descendants(instance)
            for image in CassavaImage.all_objects.filter(folder_id__in=ids, deletion_batch=batch):
                image.name = unique_name(CassavaImage.objects.filter(owner=image.owner, folder=image.folder), image.name)
                image.deleted_at = image.deleted_by = image.deletion_batch = None
                image.save(update_fields=['name', 'deleted_at', 'deleted_by', 'deletion_batch'])
            Folder.all_objects.filter(pk__in=ids, deletion_batch=batch).update(
                deleted_at=None, deleted_by=None, deletion_batch=None)
        else:
            if isinstance(instance, CassavaImage):
                if instance.folder_id and not Folder.objects.filter(pk=instance.folder_id).exists():
                    instance.folder = None
                instance.name = unique_name(CassavaImage.objects.filter(owner=instance.owner, folder=instance.folder), instance.name)
            instance.deleted_at = instance.deleted_by = instance.deletion_batch = None
            instance.save()


class RecyclingActions:
    def _owned_recycled(self):
        obj = self.get_object()
        if not self.request.user.is_authenticated or (not self.request.user.is_superuser and obj.owner_id != self.request.user.pk):
            raise PermissionDenied('仅所有者可恢复或永久清除')
        if not obj.deleted_at:
            raise ValidationError('该内容不在回收站')
        return obj

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        restore(self._owned_recycled())
        return Response({'restored': True})

    @action(detail=True, methods=['get'], url_path='deletion-impact')
    def deletion_impact(self, request, pk=None):
        from .models import Folder, CassavaImage, PredictionResult, PredictionCorrection, ProcessingTask
        obj = self._owned_recycled()
        images = CassavaImage.all_objects.none()
        if isinstance(obj, Folder):
            images = CassavaImage.all_objects.filter(folder_id__in=descendants(obj))
        elif isinstance(obj, CassavaImage):
            images = CassavaImage.all_objects.filter(pk=obj.pk)
        from django.db.models import Q
        predictions = PredictionResult.objects.filter(Q(original_image__in=images) | Q(segmentation__original_image__in=images))
        if isinstance(obj, ProcessingTask):
            predictions = PredictionResult.objects.filter(processing_task=obj)
        return Response({'images': images.count(), 'predictions': predictions.distinct().count(),
                         'corrections': PredictionCorrection.objects.filter(prediction__in=predictions).count()})

    @action(detail=True, methods=['post'])
    def purge(self, request, pk=None):
        obj = self._owned_recycled()
        if request.data.get('confirm') != 'PERMANENT_DELETE':
            raise ValidationError('必须查看影响并确认永久清除')
        from .models import Folder, CassavaImage
        with transaction.atomic():
            if isinstance(obj, Folder):
                CassavaImage.all_objects.filter(folder_id__in=descendants(obj)).delete()
            obj.delete()
        return Response({'purged': True})
