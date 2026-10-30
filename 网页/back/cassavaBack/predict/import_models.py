"""Durable upload manifests and per-file outcomes, independent from prediction queue."""
import uuid
from django.db import models
from .models import BaseModel, Folder, CassavaImage, ProcessingTask


class ImportJob(BaseModel):
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    task = models.OneToOneField(ProcessingTask, on_delete=models.CASCADE, related_name='import_job')
    target_folder = models.ForeignKey(Folder, null=True, blank=True, on_delete=models.SET_NULL)
    options = models.JSONField(default=dict)
    state = models.CharField(max_length=20, default='uploading', db_index=True)
    heartbeat = models.DateTimeField(null=True)
    lease = models.UUIDField(null=True)
    summary = models.JSONField(default=dict)
    error = models.TextField(blank=True)


class ImportItem(BaseModel):
    job = models.ForeignKey(ImportJob, on_delete=models.CASCADE, related_name='items')
    relative_path = models.CharField(max_length=1024)
    size = models.BigIntegerField()
    offset = models.BigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True)
    chunk_hashes = models.JSONField(default=list)
    state = models.CharField(max_length=20, default='uploading')
    error = models.TextField(blank=True)
    image = models.ForeignKey(CassavaImage, null=True, on_delete=models.SET_NULL)
    archive_item = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['job', 'relative_path'], name='import_unique_relative_path')]
