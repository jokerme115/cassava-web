"""
Desktop Mode: 精简版模型
保留了核心功能：图像管理、文件夹、任务、结果
删除了：分享、访客、审计日志、邮件验证等平台功能
"""
from django.db import models
from django.db import connection
from django.contrib.auth.models import User
import uuid
import os


# ==================== 占位符：已删除模型的替代品 ====================
# 这些类仅用于保持导入兼容性，实际功能已禁用

class ResourceShare(models.Model):
    """资源共享 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'predict_resourceshare'
        managed = False  # 不创建表


class GuestUsage(models.Model):
    """访客使用 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_guestusage'
        managed = False


class AuditLog(models.Model):
    """审计日志 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_auditlog'
        managed = False


class GuestAccessibleResource(models.Model):
    """访客可访问资源 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_guestaccessibleresource'
        managed = False


class EmailVerificationCode(models.Model):
    """邮箱验证码 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_emailverificationcode'
        managed = False


class PermissionTemplate(models.Model):
    """权限模板 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_permissiontemplate'
        managed = False


class Role(models.Model):
    """角色 - 桌面版已禁用（仅保留超级用户）"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_role'
        managed = False


class UserRole(models.Model):
    """用户角色关联 - 桌面版已禁用"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_userrole'
        managed = False


def get_image_upload_path(instance, filename):
    """图像上传路径"""
    if hasattr(instance, 'folder') and instance.folder:
        folder_id = instance.folder.id if instance.folder else 'unassigned'
        return os.path.join('images', str(folder_id), filename)
    return os.path.join('images', 'unassigned', filename)


def get_result_upload_path(instance, filename):
    """结果图像上传路径：时间目录 + UUID保证唯一性"""
    import uuid
    name, ext = os.path.splitext(filename)
    unique_name = f"{name}_{uuid.uuid4().hex[:8]}{ext}"
    return os.path.join('results', '%Y', '%m', '%d', unique_name)


def get_segmentation_upload_path(instance, filename):
    """分割结果上传路径：时间目录 + UUID保证唯一性"""
    import uuid
    name, ext = os.path.splitext(filename)
    unique_name = f"{name}_{uuid.uuid4().hex[:8]}{ext}"
    return os.path.join('segmentations', '%Y', '%m', '%d', unique_name)


def get_avatar_upload_path(instance, filename):
    """头像上传路径"""
    return os.path.join('avatars', str(instance.user.id), filename)


# ==================== 基础模型 ====================

class BaseModel(models.Model):
    """基础模型，包含通用字段"""
    id = models.BigAutoField(primary_key=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

    @staticmethod
    def _uses_legacy_char_pk(table_name: str) -> bool:
        try:
            with connection.cursor() as cursor:
                rows = cursor.execute(f"PRAGMA table_info('{table_name}')").fetchall()
            for row in rows:
                # row: (cid, name, type, notnull, dflt_value, pk)
                if row[1] == 'id':
                    column_type = (row[2] or '').lower()
                    return 'char' in column_type or 'text' in column_type
        except Exception:
            return False
        return False

    @staticmethod
    def _generate_legacy_pk() -> int:
        # sqlite accepts this value even if the underlying legacy column is char/text.
        return (uuid.uuid4().int % 9_000_000_000_000_000) + 1_000_000_000_000_000

    def save(self, *args, **kwargs):
        # Compatibility bridge:
        # some legacy desktop databases still define id as char(32) without default.
        # In that case auto field generation does not happen at DB level, so we seed a pk.
        if self.pk is None:
            table_name = getattr(self._meta, 'db_table', '')
            if table_name and self._uses_legacy_char_pk(table_name):
                self.pk = self._generate_legacy_pk()
        super().save(*args, **kwargs)


class Folder(BaseModel):
    """文件夹/目录"""
    name = models.CharField(max_length=255)
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children'
    )
    description = models.TextField(blank=True, default='')
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='folders',
        null=True,
        blank=True
    )

    class Meta:
        db_table = 'predict_folder'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner', '-created_at']),
        ]

    def __str__(self):
        return self.name


class CassavaImage(BaseModel):
    """木薯图像"""
    STATUS_CHOICES = [
        ('pending', '待处理'),
        ('processing', '处理中'),
        ('completed', '已完成'),
        ('failed', '失败'),
    ]

    image = models.ImageField(upload_to=get_image_upload_path, max_length=500)
    # Legacy desktop databases still require the old oss_key column.
    oss_key = models.CharField(max_length=500, blank=True, default='')
    name = models.CharField(max_length=255, blank=True)
    folder = models.ForeignKey(
        Folder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='images'
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    size = models.BigIntegerField(default=0)
    capture_time = models.DateTimeField(null=True, blank=True)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    days = models.IntegerField(default=0)
    type = models.CharField(max_length=100, default='image')
    description = models.TextField(blank=True, default='')
    preview_oss_key = models.CharField(max_length=500, blank=True, default='')
    source_path = models.CharField(max_length=1000, blank=True, default='',
        help_text='本地原图绝对路径（直接引用模式）')
    STORAGE_MODE_CHOICES = [
        ('managed', '已复制到应用库'),
        ('external', '外部引用'),
    ]
    FILE_STATUS_CHOICES = [
        ('valid', '文件有效'),
        ('missing', '原文件已失效'),
        ('unknown', '未检测'),
    ]
    storage_mode = models.CharField(max_length=20, choices=STORAGE_MODE_CHOICES, default='managed')
    file_status = models.CharField(max_length=20, choices=FILE_STATUS_CHOICES, default='valid')
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='images',
        null=True,
        blank=True
    )
    tags = models.ManyToManyField('Tag', blank=True, related_name='images')

    class Meta:
        db_table = 'predict_cassavaimage'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['folder', '-created_at']),
            models.Index(fields=['owner', '-created_at']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return self.name or f"Image {self.id}"

    def save(self, *args, **kwargs):
        # 确保默认值
        if self.description is None:
            self.description = ''
        if not self.type:
            self.type = 'image'

        # 桌面版兼容：如果设置了 image 但 oss_key 为空，从 image 同步
        # 注意：不再反向同步（oss_key -> image），避免混淆
        if self.pk is None:  # 仅新建时同步
            image_name = str(self.image or '').strip()
            oss_key = (self.oss_key or '').strip()
            if image_name and not oss_key:
                self.oss_key = image_name

        super().save(*args, **kwargs)


class Tag(models.Model):
    """图像标签"""
    name = models.CharField(max_length=100, unique=True)
    color = models.CharField(max_length=20, default='#1890ff')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'predict_tag'
        ordering = ['name']

    def __str__(self):
        return self.name


class PredictionResult(BaseModel):
    """预测结果"""
    STATUS_CHOICES = [
        ('pending', '待处理'),
        ('processing', '处理中'),
        ('completed', '已完成'),
        ('failed', '失败'),
    ]

    image = models.ForeignKey(
        CassavaImage,
        on_delete=models.CASCADE,
        related_name='prediction_results'
    )
    task = models.ForeignKey(
        'ProcessingTask',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='results'
    )
    result_image = models.ImageField(upload_to=get_result_upload_path, null=True, blank=True)
    ppd_value = models.FloatField(default=0.0)
    sub_ppd_values = models.JSONField(default=list)
    confidence = models.FloatField(default=0.0)
    algorithm = models.CharField(max_length=50, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    error_message = models.TextField(blank=True, default='')
    processing_time = models.FloatField(default=0.0)
    parameters = models.JSONField(default=dict)
    vis_images = models.JSONField(default=dict)
    split_count = models.IntegerField(default=0)

    class Meta:
        db_table = 'predict_predictionresult'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['image', '-created_at']),
            models.Index(fields=['task', '-created_at']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"Result {self.id}"


class SegmentationResult(BaseModel):
    """分割结果"""
    image = models.ForeignKey(
        CassavaImage,
        on_delete=models.CASCADE,
        related_name='segmentation_results'
    )
    result_mask = models.ImageField(upload_to=get_segmentation_upload_path, null=True, blank=True)
    algorithm = models.CharField(max_length=50, default='segment_anything')
    parameters = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default='pending')
    metrics = models.JSONField(default=dict)

    class Meta:
        db_table = 'predict_segmentationresult'
        ordering = ['-created_at']

    def __str__(self):
        return f"Segmentation {self.id}"


class ProcessingTask(BaseModel):
    """处理任务"""
    STATUS_CHOICES = [
        ('pending', '等待中'),
        ('running', '运行中'),
        ('completed', '已完成'),
        ('failed', '失败'),
        ('cancelled', '已取消'),
    ]

    TASK_TYPE_CHOICES = [
        ('prediction', '预测'),
        ('segmentation', '分割'),
        ('batch_prediction', '批量预测'),
        ('first_segmentation', '第一阶段分割'),
        ('second_segmentation', '第二阶段分割'),
    ]

    name = models.CharField(max_length=255)
    task_type = models.CharField(max_length=20, choices=TASK_TYPE_CHOICES, default='prediction')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='tasks',
        null=True,
        blank=True
    )
    image_ids = models.JSONField(default=list)
    parameters = models.JSONField(default=dict)
    progress = models.IntegerField(default=0)
    total_images = models.IntegerField(default=0)
    processed_images = models.IntegerField(default=0)
    failed_images = models.IntegerField(default=0)
    result_summary = models.JSONField(default=dict)
    error_message = models.TextField(blank=True, default='')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'predict_processingtask'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner', '-created_at']),
            models.Index(fields=['status']),
            models.Index(fields=['task_type']),
        ]

    def __str__(self):
        return f"Task {self.id} - {self.name}"

    @property
    def type(self):
        return self.task_type

    @type.setter
    def type(self, value):
        self.task_type = value

    @property
    def error(self):
        return self.error_message

    @error.setter
    def error(self, value):
        self.error_message = value or ''

    @property
    def created_time(self):
        return self.created_at

    @property
    def updated_time(self):
        return self.updated_at

    @property
    def folder_ids(self):
        return self.parameters.get('folder_ids', []) if isinstance(self.parameters, dict) else []


# ==================== 用户相关（简化版） ====================

class UserProfile(models.Model):
    """用户扩展信息"""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.ImageField(upload_to=get_avatar_upload_path, null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True, default='')
    bio = models.TextField(blank=True, default='')
    last_activity = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'predict_userprofile'

    def __str__(self):
        return f"Profile of {self.user.username}"


class SystemSetting(models.Model):
    """系统设置（本地化）"""
    DEFAULT_VALUES = {
        'max_display_images': 200,
        'max_display_results': 100,
        'site_title': 'CassavaSeg',
        'site_announcement': '',
        'announcement_level': 'info',
        'enable_guest_access': False,
        'allow_registration': False,
        'maintenance_mode': False,
        'upload_size_limit_mb': 50,
        'guest_data_retention_days': 7,
        'audit_log_retention_days': 30,
    }
    max_display_images = models.PositiveIntegerField(default=DEFAULT_VALUES['max_display_images'])
    max_display_results = models.PositiveIntegerField(default=DEFAULT_VALUES['max_display_results'])
    site_title = models.CharField(max_length=200, default=DEFAULT_VALUES['site_title'])
    site_announcement = models.TextField(blank=True, null=True, default=DEFAULT_VALUES['site_announcement'])
    announcement_level = models.CharField(max_length=20, default=DEFAULT_VALUES['announcement_level'])
    enable_guest_access = models.BooleanField(default=DEFAULT_VALUES['enable_guest_access'])
    allow_registration = models.BooleanField(default=DEFAULT_VALUES['allow_registration'])
    maintenance_mode = models.BooleanField(default=DEFAULT_VALUES['maintenance_mode'])
    upload_size_limit_mb = models.PositiveIntegerField(default=DEFAULT_VALUES['upload_size_limit_mb'])
    guest_data_retention_days = models.PositiveIntegerField(default=DEFAULT_VALUES['guest_data_retention_days'])
    audit_log_retention_days = models.PositiveIntegerField(default=DEFAULT_VALUES['audit_log_retention_days'])
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )

    class Meta:
        db_table = 'predict_systemsetting'

    def __str__(self):
        return self.site_title or 'System Setting'

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(
            id=1,
            defaults=cls.DEFAULT_VALUES.copy(),
        )
        dirty_fields = []
        for field, default_value in cls.DEFAULT_VALUES.items():
            current_value = getattr(obj, field, None)
            if current_value is None or current_value == '':
                setattr(obj, field, default_value)
                dirty_fields.append(field)
        if dirty_fields:
            obj.save(update_fields=dirty_fields + ['updated_at'])
        return obj
