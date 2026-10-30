from rest_framework import serializers
from .models import (
    CassavaImage, SegmentationResult, PredictionResult, 
    ProcessingTask, Folder, Permission, Role, UserRole, UserPermission, AuditLog, ResourceShare, UserProfile,
    PermissionTemplate, GuestAccessibleResource, SystemSetting, PredictionCorrection
)
from django.contrib.auth.models import User
from django.utils import timezone
import datetime
import os


class ResourceShareSerializer(serializers.ModelSerializer):
    shared_with_username = serializers.CharField(source='shared_with.username', read_only=True)
    shared_by_username = serializers.CharField(source='shared_by.username', read_only=True)
    resource_details = serializers.SerializerMethodField()
    
    class Meta:
        model = ResourceShare
        fields = ['id', 'resource_type', 'resource_id', 'shared_by', 'shared_by_username', 
                  'shared_with', 'shared_with_username', 'permission', 'expires_at', 'created_at', 'resource_details']
    
    def get_resource_details(self, obj):
        if obj.resource_type == 'image':
            try:
                image = CassavaImage.objects.get(id=obj.resource_id)
                return CassavaImageListSerializer(image).data
            except CassavaImage.DoesNotExist:
                return None
        elif obj.resource_type == 'folder':
            try:
                folder = Folder.objects.get(id=obj.resource_id)
                return FolderSerializer(folder).data
            except Folder.DoesNotExist:
                return None
        return None


class CassavaImageListSerializer(serializers.ModelSerializer):
    preview_url = serializers.SerializerMethodField()
    resolution = serializers.SerializerMethodField()
    
    class Meta:
        model = CassavaImage
        fields = [
            'id', 'name', 'folder', 'owner', 'size', 'days', 'type',
            'description', 'capture_time', 'created_at', 'updated_at',
            'preview_url', 'pixel_width', 'pixel_height', 'resolution',
            'capture_time_source', 'capture_time_history', 'content_sha256', 'deleted_at',
        ]
        read_only_fields = ['capture_time_source', 'capture_time_history', 'content_sha256', 'deleted_at']

    # Dimensions come from decoded original files, never client edits or previews.
    pixel_width = serializers.IntegerField(read_only=True)
    pixel_height = serializers.IntegerField(read_only=True)

    def get_resolution(self, obj):
        from .image_quality import resolution_info
        return resolution_info(obj.pixel_width, obj.pixel_height)

    def get_preview_url(self, obj):
        # 生成预览图的访问URL
        from .oss_service import get_file_url

        if obj.preview_oss_key:
            return get_file_url(obj.preview_oss_key)
        # 如果没有预览图，返回原图URL
        if obj.oss_key:
            return get_file_url(obj.oss_key)
        return None


class CassavaImageSerializer(CassavaImageListSerializer):
    image_url = serializers.SerializerMethodField()
    
    class Meta(CassavaImageListSerializer.Meta):
        fields = CassavaImageListSerializer.Meta.fields + ['image_url']

    def update(self, instance, validated_data):
        if 'capture_time' in validated_data and validated_data['capture_time'] != instance.capture_time:
            history = list(instance.capture_time_history or [])
            user = getattr(self.context.get('request'), 'user', None)
            history.append({'before': instance.capture_time.isoformat() if instance.capture_time else None,
                            'after': validated_data['capture_time'].isoformat() if validated_data['capture_time'] else None,
                            'at': timezone.now().isoformat(), 'by': getattr(user, 'pk', None)})
            validated_data['capture_time_history'] = history
            validated_data['capture_time_source'] = 'manual' if validated_data['capture_time'] else 'unknown'
        if 'folder' in validated_data or 'name' in validated_data:
            from .recycling import unique_name
            validated_data['name'] = unique_name(CassavaImage.objects.filter(owner=instance.owner,
                folder=validated_data.get('folder', instance.folder)), validated_data.get('name', instance.name), instance.pk)
        return super().update(instance, validated_data)

    def get_image_url(self, obj):
        # 生成OSS文件的访问URL
        if obj.oss_key:
            from .oss_service import get_file_url
            return get_file_url(obj.oss_key)
        return None
    
    def get_has_segmentation(self, obj):
        # 检查是否有分割结果
        return obj.segmentations.exists()


class SegmentationResultSerializer(serializers.ModelSerializer):
    original_image_name = serializers.CharField(source='original_image.name', read_only=True)
    result_image_url = serializers.SerializerMethodField()
    has_prediction = serializers.SerializerMethodField()
    result_image = serializers.CharField(source='oss_key', read_only=True)
    result_data = serializers.SerializerMethodField()
    type = serializers.CharField(source='segmentation_type', read_only=True)
    
    class Meta:
        model = SegmentationResult
        fields = ['id', 'name', 'original_image', 'original_image_name', 
                  'result_image', 'result_image_url', 'result_data', 'type',
                  'has_prediction', 'created_at', 'updated_at']
    
    def get_result_image_url(self, obj):
        # 生成结果图像的访问URL
        if obj.oss_key:
            from .oss_service import get_file_url
            return get_file_url(obj.oss_key)
        return None
    
    def get_has_prediction(self, obj):
        # 检查是否有预测结果
        return obj.predictions.exists()

    def get_result_data(self, obj):
        if not obj.description:
            return None
        try:
            import json
            return json.loads(obj.description)
        except Exception:
            return obj.description


class PredictionResultSerializer(serializers.ModelSerializer):
    result_image = serializers.SerializerMethodField()
    original_image_url = serializers.SerializerMethodField()
    original_image_name = serializers.SerializerMethodField()
    original_image_folder_id = serializers.SerializerMethodField()
    original_image_folder_name = serializers.SerializerMethodField()
    result_image_url = serializers.SerializerMethodField()
    vis_images = serializers.SerializerMethodField()
    cassava_mask_url = serializers.SerializerMethodField()
    rotten_mask_url = serializers.SerializerMethodField()
    confidence_map_url = serializers.SerializerMethodField()
    measurement = serializers.SerializerMethodField()
    latest_correction = serializers.SerializerMethodField()
    has_correction = serializers.SerializerMethodField()
    latest_correction_ppd = serializers.SerializerMethodField()
    class Meta:
        model = PredictionResult
        fields = ['id', 'result_image', 'segmentation', 'ppd_value', 'oss_key', 
                  'prediction_time', 'model_type', 'is_ensemble', 'ensemble_method', 'ensemble_details',
                  'error_code', 'error_message', 'sub_ppd_values', 'vis_images', 'result_image_url',
                  'ppd_unit', 'cassava_mask_url', 'rotten_mask_url', 'confidence_map_url', 'has_correction', 'latest_correction_ppd', 'measurement', 'latest_correction',
                  'processing_task', 'original_image', 'original_image_url', 'original_image_name',
                  'original_image_folder_id', 'original_image_folder_name',
                  # 新增预测参数字段
                  'confidence_threshold', 'min_area', 'morph_kernel_size', 
                  'morph_iterations', 'single_model_type', 'split_count', 'algorithm', 
                  'overlap']

    def _build_public_result_url(self, obj):
        from .oss_service import get_file_url

        if obj.oss_key:
            return get_file_url(obj.oss_key)

        if obj.result_image:
            return get_file_url(str(getattr(obj.result_image, 'name', obj.result_image)))

        return None

    def get_result_image(self, obj):
        return self._build_public_result_url(obj)
    
    def get_original_image_url(self, obj):
        if obj.original_image and obj.original_image.oss_key:
            from .oss_service import get_file_url
            return get_file_url(obj.original_image.oss_key)
        return None

    def get_original_image_name(self, obj):
        if obj.original_image:
            return obj.original_image.name
        return None

    def get_original_image_folder_id(self, obj):
        if obj.original_image and obj.original_image.folder:
            return obj.original_image.folder_id
        return None

    def get_original_image_folder_name(self, obj):
        if obj.original_image and obj.original_image.folder:
            return obj.original_image.folder.name
        return None

    def get_result_image_url(self, obj):
        try:
            return self._build_public_result_url(obj)
        except Exception:
            return None

    def get_vis_images(self, obj):
        vis = obj.vis_images or {}
        try:
            from .oss_service import get_file_url
            mapped = {}
            for k, v in vis.items():
                if not v:
                    continue
                mapped[k] = get_file_url(str(v))
            return mapped
        except Exception:
            return vis

    def get_cassava_mask_url(self, obj):
        return self._get_storage_url(obj.cassava_mask_key)

    def get_rotten_mask_url(self, obj):
        return self._get_storage_url(obj.rotten_mask_key)

    def get_confidence_map_url(self, obj):
        return self._get_storage_url(obj.confidence_map_key)

    def _get_storage_url(self, key):
        if not key:
            return None
        try:
            from .oss_service import get_file_url
            return get_file_url(str(key))
        except Exception:
            return str(key)

    def get_measurement(self, obj):
        from .measurement import measurement_info
        return measurement_info(obj)

    def get_latest_correction(self, obj):
        from .measurement import latest_correction
        correction = latest_correction(obj)
        return PredictionCorrectionSerializer(correction, context=self.context).data if correction else None

    def get_has_correction(self, obj):
        prefetched = getattr(obj, '_ordered_corrections', None)
        return bool(prefetched) if prefetched is not None else obj.corrections.exists()

    def get_latest_correction_ppd(self, obj):
        prefetched = getattr(obj, '_ordered_corrections', None)
        correction = prefetched[0] if prefetched else (
            None if prefetched is not None else obj.corrections.order_by('-version').first()
        )
        return correction.ppd_percent if correction else None


class PredictionCorrectionSerializer(serializers.ModelSerializer):
    cassava_mask_url = serializers.SerializerMethodField()
    rotten_mask_url = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = PredictionCorrection
        fields = [
            'id', 'prediction', 'version', 'cassava_mask_url', 'rotten_mask_url',
            'width', 'height', 'cassava_pixels', 'rotten_pixels', 'ppd_percent',
            'edit_data', 'note', 'created_at', 'created_by_username',
        ]
        read_only_fields = [
            'id', 'prediction', 'version', 'cassava_mask_url', 'rotten_mask_url',
            'cassava_pixels', 'rotten_pixels', 'ppd_percent', 'created_at', 'created_by_username',
        ]

    def _url(self, key):
        if not key:
            return None
        try:
            from .oss_service import get_file_url
            return get_file_url(str(key))
        except Exception:
            return str(key)

    def get_cassava_mask_url(self, obj):
        return self._url(obj.cassava_mask_key)

    def get_rotten_mask_url(self, obj):
        return self._url(obj.rotten_mask_key)


from .model_registry import LABELS as _PREDICTION_MODEL_LABELS, unavailable_reason as _missing_model_weight


class ProcessingTaskSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    status_display = serializers.SerializerMethodField()
    image_count = serializers.SerializerMethodField()
    result_count = serializers.SerializerMethodField()
    queue_position = serializers.SerializerMethodField()
    
    # 兼容旧字段名
    created_by = serializers.PrimaryKeyRelatedField(source='owner', read_only=True)
    created_by_username = serializers.CharField(source='owner.username', read_only=True)
    
    class Meta:
        model = ProcessingTask
        fields = ['id', 'name', 'type', 'status', 'status_display', 'progress',
                  'owner', 'owner_username', 'created_by', 'created_by_username',
                  'error', 'image_ids', 'segmentation_ids', 'folder_ids',
                  'algorithm', 'threshold', 'min_size', 'split_count', 'method',
                  'overlap', 'single_model_type', 'image_count', 'result_count', 'parameters',
                  'queue_position',
                  'created_time', 'updated_time']
                  
    def get_status_display(self, obj):
        # 任务状态的中文显示
        status_mapping = {
            'running': '运行中',
            'completed': '已完成',
            'failed': '失败',
            'pending': '等待中',
            'cancelled': '已取消'
        }
        return status_mapping.get(obj.status, obj.status)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        task_type = attrs.get('type', getattr(self.instance, 'type', 'prediction'))
        if task_type != 'prediction':
            return attrs
        if not self.instance and not attrs.get('single_model_type') and not attrs.get('algorithm'):
            attrs.update(single_model_type='pbt_c512', algorithm='pbt_c512')
        for field in ('algorithm', 'single_model_type'):
            if field in attrs:
                attrs[field] = self._validate_model_key(field, attrs[field])
        from .model_registry import MODERN_KEYS, members
        key = attrs.get('single_model_type') or attrs.get('algorithm')
        if key in MODERN_KEYS:
            params = dict(attrs.get('parameters') or {})
            params.update(confidenceThreshold=.5, minArea=0, usePostProcessing=False, useTTA=False,
                stage1Confidence=.5, stage2Confidence=.5, morphKernelSize=0, morphIterations=0,
                model_version={'id': key, 'device': 'cpu', 'members': members(key),
                    'protocol': 'two-yolo-0.5/roi-black/native-pad16/argmax/no-postprocess'})
            attrs.update(parameters=params, threshold=.5, min_size=0, method='')
        return attrs

    @staticmethod
    def _validate_model_key(field, raw_value):
        if raw_value in (None, ''):
            return raw_value
        key = str(raw_value).strip().lower()
        if key not in _PREDICTION_MODEL_LABELS:
            options = '、'.join(f'{code}（{label}）' for code, label in _PREDICTION_MODEL_LABELS.items())
            raise serializers.ValidationError({
                field: f'不支持的预测模型「{raw_value}」。可选：{options}'
            })
        missing = _missing_model_weight(key)
        if missing:
            raise serializers.ValidationError({
                field: f'模型「{_PREDICTION_MODEL_LABELS[key]}」的权重文件缺失（{missing}），请先上传权重或改选其它模型'
            })
        return key

    def get_image_count(self, obj):
        if obj.type == 'upload':
            return (obj.parameters or {}).get('total', 0)
        # 文件夹任务提交时 image_ids 为空列表，此时应按 folder_ids 现算，
        # 否则任务中心会把「100 张的文件夹任务」显示成 0 张。
        if isinstance(obj.image_ids, list) and obj.image_ids:
            return len(obj.image_ids)
        if isinstance(obj.folder_ids, list) and obj.folder_ids:
            # 历史脏数据里可能出现 'undefined' 之类非数字 id，直接丢给数据库会抛 ValueError
            valid_ids = []
            for folder_id in obj.folder_ids:
                try:
                    valid_ids.append(int(folder_id))
                except (TypeError, ValueError):
                    continue
            if valid_ids:
                return CassavaImage.objects.filter(folder_id__in=valid_ids).count()
        return 0

    def get_result_count(self, obj):
        """已完成任务实际产出的结果条数，用于对照 image_count 识别部分失败。"""
        if obj.pk is None:
            return 0
        annotated = getattr(obj, '_result_count', None)
        if annotated is not None:
            return annotated
        return obj.prediction_results.count()

    def get_queue_position(self, obj):
        """
        排队位置：仅对等待中的任务有意义，1 表示下一个执行。
        只统计正在等待的任务，避免已取消/已完成的任务干扰顺序。
        """
        if obj.status != 'pending' or obj.pk is None or obj.created_time is None:
            return None
        return ProcessingTask.objects.filter(
            status='pending', created_time__lt=obj.created_time
        ).count() + 1

class FolderSerializer(serializers.ModelSerializer):
    image_count = serializers.SerializerMethodField()
    is_guest_accessible = serializers.SerializerMethodField()
    
    class Meta:
        model = Folder
        fields = ['id', 'name', 'description', 'parent', 'image_count', 'created_at', 'updated_at', 'is_guest_accessible']
        validators = []

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        owner = user if getattr(user, 'is_authenticated', False) else None

        name = attrs.get('name', getattr(self.instance, 'name', None))
        parent = attrs.get('parent', getattr(self.instance, 'parent', None))

        cursor, seen = parent, set()
        while cursor:
            if cursor.pk in seen or (self.instance and cursor.pk == self.instance.pk):
                raise serializers.ValidationError({'parent': '不能将文件夹移入自身或其子目录'})
            seen.add(cursor.pk)
            cursor = cursor.parent

        if owner and name:
            qs = Folder.objects.filter(owner=owner, parent=parent, name=name)
            if self.instance:
                qs = qs.exclude(id=self.instance.id)
            if qs.exists():
                raise serializers.ValidationError({'name': '同级目录下已存在同名文件夹'})

        return attrs
    
    def get_is_guest_accessible(self, obj):
        guest_folder_ids = self.context.get('guest_folder_ids')
        if guest_folder_ids is not None:
            return obj.id in guest_folder_ids
        from .models import GuestAccessibleResource
        return GuestAccessibleResource.objects.filter(resource_type='folder', resource_id=obj.id, is_active=True).exists()
    
    def get_image_count(self, obj):
        count_map = self.context.get('folder_image_counts')
        if count_map is not None:
            return count_map.get(obj.id, 0)
        from collections import deque
        
        folder_ids = []
        seen = set()
        queue = deque()
        
        queue.append(obj.id)
        seen.add(obj.id)
        
        while queue:
            current_id = queue.popleft()
            folder_ids.append(current_id)
            
            child_ids = Folder.objects.filter(parent_id=current_id).values_list('id', flat=True)
            for cid in child_ids:
                if cid not in seen:
                    seen.add(cid)
                    queue.append(cid)
        
        return CassavaImage.objects.filter(folder_id__in=folder_ids).count()


# 权限管理序列化器
class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ['id', 'name', 'codename', 'category', 'description', 'created_at', 'updated_at']


class PermissionTemplateSerializer(serializers.ModelSerializer):
    permissions_count = serializers.SerializerMethodField()
    permission_ids = serializers.PrimaryKeyRelatedField(
        source='permissions',
        many=True, 
        read_only=True
    )
    
    class Meta:
        model = PermissionTemplate
        fields = ['id', 'name', 'description', 'permissions_count', 'permission_ids', 'created_at', 'updated_at']
        
    def get_permissions_count(self, obj):
        return obj.permissions.count()


class RoleSerializer(serializers.ModelSerializer):
    permissions_count = serializers.SerializerMethodField()
    permission_ids = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Role
        fields = ['id', 'name', 'description', 'is_active', 'permissions_count', 
                  'permission_ids', 'created_at', 'updated_at']

    def get_permissions_count(self, obj):
        return obj.permissions.count()


class UserRoleSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)

    class Meta:
        model = UserRole
        fields = ['id', 'user', 'user_username', 'role', 'role_name', 'created_at', 'updated_at']


class UserPermissionSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    permission_name = serializers.CharField(source='permission.name', read_only=True)
    permission_codename = serializers.CharField(source='permission.codename', read_only=True)
    permission_category = serializers.CharField(source='permission.category', read_only=True)

    class Meta:
        model = UserPermission
        fields = ['id', 'user', 'user_username', 'permission', 'permission_name', 
                  'permission_codename', 'permission_category', 'created_at', 'updated_at']


class UserProfileSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()
    
    class Meta:
        model = UserProfile
        fields = ['avatar', 'avatar_url', 'employee_id', 'department', 'phone', 'bio', 'two_factor_enabled', 'theme', 'notification_settings']
        extra_kwargs = {
            'avatar': {'write_only': True},
            'two_factor_enabled': {'read_only': True}
        }

    def get_avatar_url(self, obj):
        if obj.avatar:
            try:
                return obj.avatar.url
            except Exception:
                return None
        return None


class UserSerializer(serializers.ModelSerializer):
    role_names = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    role_ids = serializers.ListField(
        child=serializers.IntegerField(), 
        write_only=True, 
        required=False
    )
    profile = UserProfileSerializer(read_only=True)
    is_online = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_active', 'is_superuser', 'password', 'role_names', 'roles', 'role_ids', 'profile', 'is_online', 'last_login']
        extra_kwargs = {
            'password': {'write_only': True}
        }
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # If updating, password is not required
        if self.instance:
            self.fields['password'].required = False
        else:
            self.fields['password'].required = True
    
    def get_is_online(self, obj):
        if hasattr(obj, 'profile') and obj.profile.last_activity:
            now = timezone.now()
            # If last activity was within 5 minutes, consider online
            return (now - obj.profile.last_activity) < datetime.timedelta(minutes=5)
        return False
    
    def get_role_names(self, obj):
        # 只返回角色名称列表，避免嵌套序列化带来的性能问题
        # obj.user_roles is the related name for UserRole model
        return [ur.role.name for ur in obj.user_roles.all()]

    def get_roles(self, obj):
        # 返回角色ID列表，供前端使用
        return [ur.role.id for ur in obj.user_roles.all()]
    
    def validate_password(self, value):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value

    def create(self, validated_data):
        password = validated_data.pop('password')
        role_ids = validated_data.pop('role_ids', [])
        
        user = User.objects.create_user(**validated_data)
        user.set_password(password)
        user.save()
        
        # Assign roles
        if role_ids:
            for role_id in role_ids:
                try:
                    role = Role.objects.get(id=role_id)
                    UserRole.objects.create(user=user, role=role)
                except Role.DoesNotExist:
                    pass
        
        return user

    def update(self, instance, validated_data):
        role_ids = validated_data.pop('role_ids', None)
        password = validated_data.pop('password', None)
        
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
            
        if password:
            instance.set_password(password)
            
        instance.save()
        
        if role_ids is not None:
            # Update roles
            UserRole.objects.filter(user=instance).delete()
            for role_id in role_ids:
                try:
                    role = Role.objects.get(id=role_id)
                    UserRole.objects.create(user=instance, role=role)
                except Role.DoesNotExist:
                    pass
                    
        return instance


class SimpleUserSerializer(serializers.ModelSerializer):
    """简单的用户序列化器，用于分享时的用户搜索"""
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']

class PermissionHierarchySerializer(serializers.Serializer):
    """权限层级结构序列化器"""
    
    def to_representation(self, instance):
        """
        将权限层级字典转换为序列化格式
        
        Args:
            instance: 权限层级字典 {category: [permission1, permission2, ...]}
            
        Returns:
            dict: 序列化后的权限层级
        """
        result = {}
        for category, permissions in instance.items():
            permission_serializer = PermissionSerializer(permissions, many=True)
            result[category] = permission_serializer.data
        return result

class UserDetailSerializer(serializers.ModelSerializer):
    """用户详情序列化器，包含角色和权限信息"""
    roles = RoleSerializer(many=True, read_only=True)
    permissions = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_active', 'is_superuser', 'roles', 'permissions']
    
    def get_permissions(self, obj):
        """获取用户的权限列表"""
        from .permissions import get_user_permissions
        return get_user_permissions(obj)

class RoleDetailSerializer(serializers.ModelSerializer):
    """角色详情序列化器，包含权限和用户信息"""
    permissions = serializers.SerializerMethodField()
    user_info = serializers.SerializerMethodField()
    
    class Meta:
        model = Role
        fields = ['id', 'name', 'description', 'is_active', 'created_at', 'updated_at', 'permissions', 'user_info']
    
    def get_permissions(self, obj):
        """获取角色拥有的权限列表，返回简单的权限信息"""
        return [{
            'id': perm.id,
            'name': perm.name,
            'codename': perm.codename,
            'category': perm.category
        } for perm in obj.permissions.all()]
    
    def get_user_info(self, obj):
        """获取拥有该角色的用户信息列表"""
        from .models import UserRole
        user_roles = UserRole.objects.filter(role=obj).select_related('user')
        return [{
            'id': user_role.user.id,
            'username': user_role.user.username,
            'email': user_role.user.email
        } for user_role in user_roles]

class AuditLogSerializer(serializers.ModelSerializer):
    """审计日志序列化器"""
    timestamp = serializers.DateTimeField(source='created_at', read_only=True)
    userId = serializers.CharField(source='user.id', read_only=True)
    resourceType = serializers.CharField(source='resource', read_only=True)
    resourceId = serializers.CharField(source='resource_id', read_only=True)
    resourceName = serializers.CharField(source='resource', read_only=True) # Assuming resource name is the same as resource type or you want to map it differently?
    # In frontend: resourceName is optional.
    
    class Meta:
        model = AuditLog
        fields = ['id', 'timestamp', 'username', 'userId', 'action', 'resourceType', 'resourceId', 'resourceName', 'success', 'details']

class GuestAccessibleResourceSerializer(serializers.ModelSerializer):
    """访客可访问资源序列化器"""
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    resource_details = serializers.SerializerMethodField()
    
    class Meta:
        model = GuestAccessibleResource
        fields = ['id', 'resource_type', 'resource_id', 'is_active', 'created_by', 'created_by_username', 'created_at', 'resource_details']
        read_only_fields = ['created_by', 'created_at']
        
    def get_resource_details(self, obj):
        if obj.resource_type == 'image':
            try:
                image = CassavaImage.objects.get(id=obj.resource_id)
                return {'name': image.name, 'oss_key': image.oss_key}
            except CassavaImage.DoesNotExist:
                return None
        elif obj.resource_type == 'folder':
            try:
                folder = Folder.objects.get(id=obj.resource_id)
                return {'name': folder.name}
            except Folder.DoesNotExist:
                return None
        return None


class SystemSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSetting
        fields = [
            'site_title',
            'site_announcement',
            'announcement_level',
            'max_display_images',
            'max_display_results',
            'enable_guest_access',
            'allow_registration',
            'maintenance_mode',
            'upload_size_limit_mb',
            'guest_data_retention_days',
            'audit_log_retention_days',
            'updated_at',
            'updated_by',
        ]
        read_only_fields = ['updated_at', 'updated_by']

    def validate_max_display_images(self, value):
        try:
            v = int(value)
        except Exception:
            raise serializers.ValidationError("Invalid value")
        if v < 1:
            raise serializers.ValidationError("Must be >= 1")
        if v > 1000:
            raise serializers.ValidationError("Must be <= 1000")
        return v

    def validate_max_display_results(self, value):
        try:
            v = int(value)
        except Exception:
            raise serializers.ValidationError("Invalid value")
        if v < 1:
            raise serializers.ValidationError("Must be >= 1")
        if v > 2000: # Slightly higher limit for results maybe?
            raise serializers.ValidationError("Must be <= 2000")
        return v

    def validate_upload_size_limit_mb(self, value):
        try:
            v = int(value)
        except Exception:
            raise serializers.ValidationError("Invalid value")
        if v < 1:
            raise serializers.ValidationError("Must be >= 1")
        if v > 500: # Max 500MB
            raise serializers.ValidationError("Must be <= 500")
        return v

    def validate_guest_data_retention_days(self, value):
        try:
            v = int(value)
        except Exception:
            raise serializers.ValidationError("Invalid value")
        if v < 1:
            raise serializers.ValidationError("Must be >= 1")
        if v > 365:
            raise serializers.ValidationError("Must be <= 365")
        return v

    def validate_audit_log_retention_days(self, value):
        try:
            v = int(value)
        except Exception:
            raise serializers.ValidationError("Invalid value")
        if v < 30:
            raise serializers.ValidationError("Must be >= 30")
        if v > 3650:
            raise serializers.ValidationError("Must be <= 3650")
        return v
