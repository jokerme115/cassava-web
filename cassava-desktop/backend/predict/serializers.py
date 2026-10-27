"""
Desktop Mode: 精简版Serializers
"""
from django.db import OperationalError, ProgrammingError
from rest_framework import serializers
from .models import (
    CassavaImage, SegmentationResult, PredictionResult,
    ProcessingTask, Folder, UserProfile, SystemSetting, Tag
)
from django.contrib.auth.models import User
from django.utils import timezone


class BigIntCharField(serializers.CharField):
    def to_representation(self, value):
        if value is None:
            return None
        return str(value)


class TagSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)

    class Meta:
        model = Tag
        fields = ['id', 'name', 'color', 'created_at']


class FolderListSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Folder.objects.all(),
        allow_null=True,
        required=False,
        pk_field=BigIntCharField(),
    )
    image_count = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = ['id', 'name', 'parent', 'description', 'image_count', 'created_at', 'updated_at']

    def get_image_count(self, obj):
        return obj.images.count() if hasattr(obj, 'images') else 0


class FolderDetailSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Folder.objects.all(),
        allow_null=True,
        required=False,
        pk_field=BigIntCharField(),
    )
    images = serializers.SerializerMethodField()
    image_count = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = ['id', 'name', 'parent', 'description', 'images', 'image_count', 'created_at', 'updated_at']

    def get_images(self, obj):
        images = obj.images.all()[:20]
        return CassavaImageListSerializer(images, many=True).data

    def get_image_count(self, obj):
        return obj.images.count()


class CassavaImageListSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    folder = serializers.PrimaryKeyRelatedField(
        queryset=Folder.objects.all(),
        allow_null=True,
        required=False,
        pk_field=BigIntCharField(),
    )
    folder_name = serializers.CharField(source='folder.name', read_only=True, default='')
    tags = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()

    class Meta:
        model = CassavaImage
        fields = [
            'id', 'name', 'image', 'image_url', 'preview_url',
            'folder', 'folder_name', 'status',
            'size', 'width', 'height', 'created_at', 'updated_at', 'tags',
            'preview_oss_key', 'source_path', 'storage_mode', 'file_status',
        ]

    def get_tags(self, obj):
        try:
            return TagSerializer(obj.tags.all(), many=True).data
        except (OperationalError, ProgrammingError):
            return []

    def get_image_url(self, obj):
        source = getattr(obj, 'source_path', None) or ''
        if source:
            return f'/local-image/?id={obj.id}'
        if obj.image:
            return getattr(obj.image, 'url', None) or ''
        return ''

    def get_preview_url(self, obj):
        preview_key = getattr(obj, 'preview_oss_key', None) or ''
        if preview_key and not preview_key.startswith('http'):
            return f'/media/{preview_key}'
        if obj.image:
            return getattr(obj.image, 'url', None) or ''
        return ''


class CassavaImageDetailSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    folder = serializers.PrimaryKeyRelatedField(
        queryset=Folder.objects.all(),
        allow_null=True,
        required=False,
        pk_field=BigIntCharField(),
    )
    folder_name = serializers.CharField(source='folder.name', read_only=True, default='')
    tags = serializers.SerializerMethodField()
    prediction_results = serializers.SerializerMethodField()

    class Meta:
        model = CassavaImage
        fields = [
            'id', 'name', 'image', 'folder', 'folder_name', 'status',
            'size', 'width', 'height', 'created_at', 'updated_at',
            'tags', 'prediction_results', 'preview_oss_key',
            'source_path', 'storage_mode', 'file_status',
        ]

    def get_tags(self, obj):
        try:
            return TagSerializer(obj.tags.all(), many=True).data
        except (OperationalError, ProgrammingError):
            return []

    def get_prediction_results(self, obj):
        try:
            results = obj.prediction_results.all()
            return PredictionResultSerializer(results, many=True).data
        except (OperationalError, ProgrammingError):
            return []


class SegmentationResultSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    image = serializers.PrimaryKeyRelatedField(read_only=True, pk_field=BigIntCharField())
    image_name = serializers.CharField(source='image.name', read_only=True)

    class Meta:
        model = SegmentationResult
        fields = [
            'id', 'image', 'image_name', 'result_mask', 'algorithm',
            'parameters', 'status', 'metrics', 'created_at', 'updated_at'
        ]


class PredictionResultSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    image = serializers.PrimaryKeyRelatedField(read_only=True, pk_field=BigIntCharField())
    task = serializers.PrimaryKeyRelatedField(read_only=True, pk_field=BigIntCharField())
    image_name = serializers.CharField(source='image.name', read_only=True, default='')
    task_name = serializers.CharField(source='task.name', read_only=True, default='')
    # 桌面模式：添加 task_id 和原始图片 URL
    task_id = BigIntCharField(source='task.id', read_only=True, default=None)
    original_image_url = serializers.SerializerMethodField()
    result_image_url = serializers.CharField(source='result_image.url', read_only=True, default='')
    # 外部引用图片的原始路径
    original_image_source_path = serializers.CharField(source='image.source_path', read_only=True, default='')
    original_image_storage_mode = serializers.CharField(source='image.storage_mode', read_only=True, default='')

    class Meta:
        model = PredictionResult
        fields = [
            'id', 'image', 'image_name', 'task', 'task_id', 'task_name',
            'original_image_url', 'result_image_url',
            'original_image_source_path', 'original_image_storage_mode',
            'result_image', 'ppd_value', 'sub_ppd_values', 'confidence',
            'algorithm', 'status', 'error_message', 'processing_time',
            'parameters', 'vis_images', 'split_count', 'created_at', 'updated_at'
        ]

    def get_original_image_url(self, obj):
        source = getattr(obj.image, 'source_path', None) or ''
        if source:
            return f'/local-image/?id={obj.image.id}'
        if obj.image and obj.image.image:
            return getattr(obj.image.image, 'url', None) or ''
        return ''


class PredictionResultListSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    image = serializers.PrimaryKeyRelatedField(read_only=True, pk_field=BigIntCharField())
    image_name = serializers.CharField(source='image.name', read_only=True, default='')

    class Meta:
        model = PredictionResult
        fields = [
            'id', 'image', 'image_name', 'ppd_value', 'confidence',
            'algorithm', 'status', 'processing_time', 'created_at'
        ]


class ProcessingTaskListSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = ProcessingTask
        fields = [
            'id', 'name', 'task_type', 'status', 'owner', 'owner_name',
            'progress', 'total_images', 'processed_images', 'failed_images',
            'result_summary', 'created_at', 'updated_at'
        ]


class ProcessingTaskDetailSerializer(serializers.ModelSerializer):
    id = BigIntCharField(read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = ProcessingTask
        fields = [
            'id', 'name', 'task_type', 'status', 'owner', 'owner_name',
            'image_ids', 'parameters', 'progress', 'total_images',
            'processed_images', 'failed_images', 'result_summary',
            'error_message', 'started_at', 'completed_at', 'created_at', 'updated_at'
        ]


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['id', 'username', 'email', 'avatar', 'phone', 'bio', 'last_activity']


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'is_superuser']


class SystemSettingSerializer(serializers.ModelSerializer):
    max_display_images = serializers.IntegerField(required=False)
    max_display_results = serializers.IntegerField(required=False)
    site_title = serializers.CharField(required=False, allow_blank=True)
    site_announcement = serializers.CharField(required=False, allow_blank=True)
    announcement_level = serializers.CharField(required=False, allow_blank=True)
    enable_guest_access = serializers.BooleanField(required=False)
    allow_registration = serializers.BooleanField(required=False)
    maintenance_mode = serializers.BooleanField(required=False)
    upload_size_limit_mb = serializers.IntegerField(required=False)
    guest_data_retention_days = serializers.IntegerField(required=False)
    audit_log_retention_days = serializers.IntegerField(required=False)

    class Meta:
        model = SystemSetting
        fields = [
            'id', 'updated_at', 'updated_by',
            'max_display_images', 'max_display_results', 'site_title',
            'site_announcement', 'announcement_level', 'enable_guest_access',
            'allow_registration', 'maintenance_mode', 'upload_size_limit_mb',
            'guest_data_retention_days', 'audit_log_retention_days',
        ]
        read_only_fields = ['id', 'updated_at', 'updated_by']


# Aliases for backward compatibility with views.py
# 注意：ProcessingTaskSerializer 使用 DetailSerializer 以支持 image_ids, folder_ids, parameters
CassavaImageSerializer = CassavaImageListSerializer
FolderSerializer = FolderListSerializer
ProcessingTaskSerializer = ProcessingTaskDetailSerializer


# Placeholder serializers for removed models (to maintain import compatibility)
class ResourceShareSerializer(serializers.Serializer):
    """Placeholder - shares not supported in desktop mode"""
    pass
