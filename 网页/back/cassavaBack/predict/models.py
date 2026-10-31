from django.db import models
import os
import secrets
from django.contrib.auth.models import User, Group
from django.utils import timezone
from django.core.cache import cache

def get_segmentation_upload_path(instance, filename):
    return os.path.join('segmentation_results', filename)


def get_avatar_upload_path(instance, filename):
    """
    头像文件上传路径生成函数
    """
    return os.path.join('avatars', str(instance.user.id), filename)


def get_image_upload_path(instance, filename):
    """
    图像文件上传路径生成函数
    
    根据文件夹名称或任务ID生成对应的存储路径，实现文件的分类存储
    """
    if hasattr(instance, 'folder') and instance.folder:
        return os.path.join('images', str(instance.folder.id), filename)
    elif hasattr(instance, 'task_id') and instance.task_id:
        return os.path.join('uploads', str(instance.task_id), filename)
    return os.path.join('images', filename)


# 自定义管理器
class ActiveResourceManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class FolderManager(ActiveResourceManager):
    """
    文件夹自定义管理器
    """
    def get_active_folders(self):
        """获取所有活跃的文件夹"""
        return self.all()
    
    def get_folder_with_images(self, folder_id):
        """获取指定文件夹及其包含的图像数量"""
        return self.select_related().prefetch_related('images').get(id=folder_id)

class CassavaImageManager(ActiveResourceManager):
    """
    木薯图像自定义管理器
    """
    def get_images_by_days(self, days):
        """根据天数筛选图像"""
        return self.filter(days=days).order_by('-created_at')
    
    def get_images_by_folder(self, folder_id):
        """获取指定文件夹中的图像"""
        return self.filter(folder_id=folder_id).order_by('-created_at')
    
    def get_images_without_segmentation(self):
        """获取尚未进行第一次分割的图像"""
        return self.exclude(segmentations__segmentation_type='first').order_by('-created_at')

class SegmentationResultManager(models.Manager):
    """
    分割结果自定义管理器
    """
    def get_first_segmentations(self):
        """获取所有第一次分割结果"""
        return self.filter(type='first').order_by('-created_at')
    
    def get_second_segmentations(self):
        """获取所有第二次分割结果"""
        return self.filter(type='second').order_by('-created_at')
    
    def get_segmentations_by_image(self, image_id):
        """获取指定图像的所有分割结果"""
        return self.filter(original_image_id=image_id).order_by('-created_at')

class ProcessingTaskManager(ActiveResourceManager):
    """
    处理任务自定义管理器
    """
    def get_running_tasks(self):
        """获取所有运行中的任务"""
        return self.filter(status='running').order_by('-created_at')
    
    def get_completed_tasks(self, limit=10):
        """获取最近完成的任务"""
        return self.filter(status='completed').order_by('-updated_at')[:limit]
    
    def get_user_tasks(self, user_id):
        """获取指定用户的所有任务"""
        return self.filter(owner_id=user_id).order_by('-created_at')

class BaseModel(models.Model):
    """
    基础抽象模型
    提供所有模型共享的字段和方法
    """
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")
    owner = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        verbose_name="所有者",
        related_name="%(class)s_owned", # 动态生成反向关联名称
        null=True, # 允许为空以兼容旧数据
        blank=True
    )
    
    class Meta:
        abstract = True  # 抽象模型，不生成数据库表


class ResourceShare(BaseModel):
    """
    资源共享模型
    
    记录用户之间的资源共享关系，支持不同级别的权限（查看/编辑/管理）。
    """
    RESOURCE_TYPES = (('image', '图像'), ('folder', '文件夹'))
    PERMISSIONS = (('view', '仅查看'), ('edit', '可编辑'), ('manage', '完全管理'))
    
    resource_type = models.CharField(choices=RESOURCE_TYPES, max_length=20, verbose_name="资源类型")
    resource_id = models.IntegerField(verbose_name="资源ID")
    shared_by = models.ForeignKey(User, related_name='shares_given', on_delete=models.CASCADE, verbose_name="分享者")
    shared_with = models.ForeignKey(User, related_name='shares_received', on_delete=models.CASCADE, verbose_name="接收者")
    permission = models.CharField(choices=PERMISSIONS, max_length=20, verbose_name="权限级别")
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name="过期时间")
    
    class Meta:
        verbose_name = "资源共享"
        verbose_name_plural = "资源共享"
        indexes = [
            models.Index(fields=['resource_type', 'resource_id', 'shared_with']),
        ]

    def __str__(self):
        return f"{self.shared_by.username} shared {self.resource_type} {self.resource_id} with {self.shared_with.username}"


class RecyclableModel(BaseModel):
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name='%(class)s_recycled')
    deletion_batch = models.UUIDField(null=True, blank=True, db_index=True)
    all_objects = models.Manager()

    class Meta:
        abstract = True


class Folder(RecyclableModel):
    """
    文件夹数据模型

    用于组织和管理木薯图像，支持将图像分类到不同的文件夹中，
    便于批量处理和管理相关图像。支持多级文件夹结构。
    """
    name = models.CharField(max_length=255, verbose_name="文件夹名称")
    description = models.TextField(blank=True, verbose_name="描述")
    parent = models.ForeignKey(
        'self', 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True, 
        related_name='children',
        verbose_name="父文件夹"
    )
    
    objects = FolderManager()  # 使用自定义管理器

    class Meta:
        verbose_name = "文件夹"
        verbose_name_plural = "文件夹"
        ordering = ['-created_at']
        # 确保同一父文件夹下的子文件夹名称唯一
        constraints = [models.UniqueConstraint(fields=['owner', 'parent', 'name'],
            condition=models.Q(deleted_at__isnull=True), name='active_folder_name')]

    def __str__(self):
        return str(self.name)

    @property
    def image_count(self):
        """返回文件夹中的图像数量"""
        return self.images.count()




class CassavaImage(RecyclableModel):
    """
    木薯图像数据模型

    存储木薯图像的基本信息和原始文件，作为后续分割和预测任务的数据源。
    支持按天数和种类对图像进行分类管理，便于批量处理和查询。
    """
    name = models.CharField(max_length=255, verbose_name="图像名称")
    oss_key = models.CharField(max_length=255, verbose_name="OSS存储路径")  # 使用OSS存储
    preview_oss_key = models.CharField(max_length=255, verbose_name="预览图OSS存储路径", blank=True, null=True)
    pixel_width = models.PositiveIntegerField(null=True, blank=True, verbose_name="原图像素宽度")
    pixel_height = models.PositiveIntegerField(null=True, blank=True, verbose_name="原图像素高度")
    days = models.IntegerField(default=0, verbose_name="天数")
    type = models.CharField(max_length=100, blank=True, verbose_name="种类")
    description = models.TextField(blank=True, verbose_name="描述")
    capture_time = models.DateTimeField(null=True, blank=True, verbose_name="拍摄时间")
    capture_time_source = models.CharField(max_length=16, default='unknown')
    capture_time_history = models.JSONField(default=list, blank=True)
    content_sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    
    objects = CassavaImageManager()  # 使用自定义管理器
    folder = models.ForeignKey(
        Folder,
        on_delete=models.SET_NULL,
        related_name="images",
        null=True,
        blank=True,
        verbose_name="所属文件夹"
    )
    size = models.BigIntegerField(default=0)

    class Meta:
        verbose_name = "木薯图像"
        verbose_name_plural = "木薯图像"
        ordering = ['-created_at']

    def __str__(self):
        return str(self.name)


class SegmentationResult(BaseModel):
    """
    图像分割结果数据模型

    存储木薯图像分割处理的结果，支持多级分割（第一次粗分割和第二次精细分割）。
    通过外键关联原始图像和父级分割结果，形成分割结果的层级结构。
    """
    SEGMENTATION_TYPES = (
        ('first', '第一次分割'),  # 粗分割，使用YOLO模型
        ('second', '第二次分割'),  # 精细分割，使用YOLO模型
    )
    
    name = models.CharField(max_length=255, verbose_name="分割结果名称")
    
    objects = SegmentationResultManager()  # 使用自定义管理器
    original_image = models.ForeignKey(
        CassavaImage, 
        on_delete=models.CASCADE, 
        related_name='segmentations',
        null=True,
        blank=True,
        verbose_name="原始图像"
    )
    parent_segmentation = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        related_name='child_segmentations',
        null=True,
        blank=True,
        verbose_name="父级分割结果"
    )
    segmentation_type = models.CharField(
        max_length=10, 
        choices=SEGMENTATION_TYPES,
        verbose_name="分割类型"
    )
    oss_key = models.CharField(max_length=255, verbose_name="OSS存储路径")  # 使用OSS存储
    description = models.TextField(blank=True, verbose_name="描述")
    created_time = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        verbose_name = "分割结果"
        verbose_name_plural = "分割结果"
        ordering = ['-created_time']  # 按创建时间降序排列

    def __str__(self):
        return str(self.name)


class PredictionResult(BaseModel):
    """
    预测结果数据模型

    存储基于分割结果的PPD（病变比例密度）计算结果，支持单模型和集成模型预测。
    记录预测所使用的模型类型、参数和可视化结果，便于结果追溯和模型评估。
    """
    result_image = models.ImageField(upload_to=get_segmentation_upload_path, verbose_name='分割结果图像')
    segmentation = models.ForeignKey(
        SegmentationResult,
        on_delete=models.CASCADE,
        related_name='predictions',
        verbose_name="分割结果",
        null=True, blank=True
    )
    ppd_value = models.FloatField(verbose_name="PPD值")
    ppd_unit = models.CharField(max_length=20, default='unknown', verbose_name="PPD单位")
    oss_key = models.CharField(max_length=255, verbose_name="OSS存储路径", null=True, blank=True)  # 使用OSS存储
    cassava_mask_key = models.CharField(max_length=255, null=True, blank=True, verbose_name="木薯主体掩码路径")
    rotten_mask_key = models.CharField(max_length=255, null=True, blank=True, verbose_name="腐烂区域掩码路径")
    confidence_map_key = models.CharField(max_length=255, null=True, blank=True, verbose_name="腐烂置信度图路径")
    prediction_time = models.DateTimeField(auto_now_add=True, verbose_name="预测时间")
    model_type = models.CharField(max_length=50, default='YOLOv11', verbose_name="模型类型")
    is_ensemble = models.BooleanField(default=False, verbose_name="是否使用集成模型")
    ensemble_method = models.CharField(max_length=50, blank=True, null=True, verbose_name="集成方法")
    ensemble_details = models.JSONField(default=dict, blank=True, verbose_name="多模型投票明细")
    error_code = models.CharField(max_length=50, blank=True, null=True, verbose_name="错误码")
    error_message = models.TextField(blank=True, null=True, verbose_name="错误信息")
    sub_ppd_values = models.JSONField(blank=True, null=True, verbose_name="子图PPD值列表")
    vis_images = models.JSONField(blank=True, null=True, verbose_name="可视化图片OSS key字典")
    
    # 预测参数字段，用于记录和展示
    confidence_threshold = models.FloatField(default=0.5, verbose_name="置信度阈值")
    min_area = models.IntegerField(default=100, verbose_name="最小区域大小")
    morph_kernel_size = models.IntegerField(default=3, verbose_name="形态学核大小")
    morph_iterations = models.IntegerField(default=1, verbose_name="形态学迭代次数")
    single_model_type = models.CharField(max_length=50, default='resnet101', verbose_name="单模型类型")
    split_count = models.IntegerField(default=1, verbose_name="图像分割数量")
    algorithm = models.CharField(max_length=50, blank=True, null=True, verbose_name="算法类型")
    overlap = models.FloatField(default=0.2, verbose_name="重叠度")
    reviewed_version = models.PositiveIntegerField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='reviewed_predictions')
    
    processing_task = models.ForeignKey(
        'ProcessingTask',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='prediction_results',
        verbose_name='所属任务'
    )
    original_image = models.ForeignKey(
        'CassavaImage',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='prediction_results',
        verbose_name='原始图片'
    )

    class Meta:
        verbose_name = "预测结果"
        verbose_name_plural = "预测结果"
        ordering = ['-prediction_time']  # 按预测时间降序排列

    def __str__(self):
        if self.segmentation:
            return str(f"{self.segmentation.name} - PPD: {self.ppd_value:.3f}")
        return str(f"Prediction - PPD: {self.ppd_value:.3f}")


class PredictionCorrection(BaseModel):
    """人工校正后的预测版本，不修改原始模型预测结果。"""

    prediction = models.ForeignKey(
        PredictionResult,
        on_delete=models.CASCADE,
        related_name='corrections',
        verbose_name="原始预测结果",
    )
    version = models.PositiveIntegerField(verbose_name="校正版本")
    cassava_mask_key = models.CharField(max_length=255, verbose_name="木薯主体掩码路径")
    rotten_mask_key = models.CharField(max_length=255, verbose_name="腐烂区域掩码路径")
    width = models.PositiveIntegerField(verbose_name="掩码宽度")
    height = models.PositiveIntegerField(verbose_name="掩码高度")
    cassava_pixels = models.PositiveIntegerField(default=0, verbose_name="木薯像素面积")
    rotten_pixels = models.PositiveIntegerField(default=0, verbose_name="腐烂像素面积")
    ppd_percent = models.FloatField(default=0, verbose_name="校正后PPD百分比")
    edit_data = models.JSONField(default=dict, blank=True, verbose_name="编辑操作数据")
    note = models.TextField(blank=True, verbose_name="校正备注")

    class Meta:
        verbose_name = "预测人工校正版本"
        verbose_name_plural = "预测人工校正版本"
        ordering = ['-version']
        constraints = [
            models.UniqueConstraint(fields=['prediction', 'version'], name='unique_prediction_correction_version')
        ]


class PermissionTemplate(BaseModel):
    """
    权限配置模板
    用于快速应用一组权限设置
    """
    name = models.CharField(max_length=100, unique=True, verbose_name="模板名称")
    description = models.TextField(blank=True, verbose_name="描述")
    permissions = models.ManyToManyField(
        'Permission',
        related_name='templates',
        verbose_name="包含权限",
        blank=True
    )
    
    class Meta:
        verbose_name = "权限模板"
        verbose_name_plural = "权限模板"
        ordering = ['name']

    def __str__(self):
        return self.name


class ProcessingTask(RecyclableModel):
    """
    处理任务数据模型

    跟踪系统中所有长时间运行的处理任务，包括批量上传、图像分割和模型预测等。
    记录任务状态、进度和时间戳，支持前端实时监控任务执行情况。
    """
    TASK_STATUS_CHOICES = (
        ('pending', '等待中'),
        ('running', '运行中'),
        ('completed', '已完成'),
        ('failed', '失败'),
        ('cancelled', '已取消'),
    )

    TASK_TYPE_CHOICES = (
        ('upload', '上传任务'),
        ('segmentation', '第一次分割'),
        ('second_segmentation', '第二次分割'),
        ('prediction', 'PPD预测'),
        ('ensemble_segmentation', '集成分割'),
    )

    name = models.CharField(max_length=255, verbose_name="任务名称")
    
    objects = ProcessingTaskManager()  # 使用自定义管理器
    type = models.CharField(max_length=50, choices=TASK_TYPE_CHOICES, verbose_name="任务类型")
    status = models.CharField(max_length=50, choices=TASK_STATUS_CHOICES, default='pending', verbose_name="任务状态")
    progress = models.IntegerField(default=0, verbose_name="进度", help_text="任务进度百分比，范围0-100")
    created_time = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_time = models.DateTimeField(auto_now=True, verbose_name="更新时间")
    error = models.TextField(blank=True, null=True, verbose_name="错误信息")

    # 任务输入和输出关联字段
    image_ids = models.JSONField(blank=True, null=True, verbose_name="输入图像ID列表")
    segmentation_ids = models.JSONField(blank=True, null=True, verbose_name="输入分割结果ID列表")
    folder_ids = models.JSONField(blank=True, null=True, verbose_name="输入文件夹ID列表")

    # 任务参数字段
    algorithm = models.CharField(max_length=50, blank=True, null=True, verbose_name="算法")
    threshold = models.FloatField(blank=True, null=True, verbose_name="阈值")
    min_size = models.IntegerField(blank=True, null=True, verbose_name="最小区域大小")
    split_count = models.IntegerField(blank=True, null=True, verbose_name="分割数量")
    method = models.CharField(max_length=50, blank=True, null=True, verbose_name="方法")
    overlap = models.FloatField(blank=True, null=True, verbose_name="重叠度")
    single_model_type = models.CharField(max_length=32, blank=True, null=True, verbose_name="单模型类型")
    parameters = models.JSONField(default=dict, blank=True, verbose_name="任务完整参数")
    guest_token = models.CharField(max_length=64, blank=True, null=True, verbose_name="访客标识", db_index=True)

    class Meta:
        verbose_name = "处理任务"
        verbose_name_plural = "处理任务"
        ordering = ['-created_time']  # 按创建时间降序排列

    def __str__(self):
        status_dict = dict(self.TASK_STATUS_CHOICES)
        status_display = status_dict.get(self.status, self.status)
        return str(f"{self.name} - {status_display}")


# 权限管理模型
class Permission(BaseModel):
    """
    系统功能权限模型

    定义系统中每个可控制的功能权限点，包括权限名称、描述和唯一标识符。
    """
    name = models.CharField(max_length=100, unique=True, verbose_name="权限名称")
    codename = models.CharField(max_length=100, unique=True, verbose_name="权限代码")
    description = models.TextField(blank=True, verbose_name="权限描述")
    category = models.CharField(max_length=50, verbose_name="权限类别")  # 如：图像管理、任务管理等

    class Meta:
        verbose_name = "功能权限"
        verbose_name_plural = "功能权限"
        ordering = ['category', 'name']

    def __str__(self):
        return str(f"{self.category} - {self.name}")


class Role(BaseModel):
    """
    用户角色模型

    定义系统中的用户角色，每个角色可以拥有多个权限。
    """
    name = models.CharField(max_length=100, unique=True, verbose_name="角色名称")
    description = models.TextField(blank=True, verbose_name="角色描述")
    permissions = models.ManyToManyField(
        Permission,
        blank=True,
        related_name='roles',
        verbose_name="权限"
    )
    is_active = models.BooleanField(default=True, verbose_name="是否激活")

    class Meta:
        verbose_name = "用户角色"
        verbose_name_plural = "用户角色"
        ordering = ['name']

    def __str__(self):
        return str(self.name)


class UserRole(BaseModel):
    """
    用户角色关联模型

    记录用户与其角色的关联关系，支持一个用户拥有多个角色。
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='user_roles', verbose_name="用户")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='user_roles', verbose_name="角色")

    class Meta:
        verbose_name = "用户角色关联"
        verbose_name_plural = "用户角色关联"
        unique_together = ('user', 'role')

    def __str__(self):
        if hasattr(self, 'user') and hasattr(self, 'role'):
            return str(f"{self.user.username} - {self.role.name}")
        return str("UserRole")

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.user_id:
            cache.delete(f"user_perms_{self.user_id}")

    def delete(self, *args, **kwargs):
        user_id = self.user_id
        result = super().delete(*args, **kwargs)
        if user_id:
            cache.delete(f"user_perms_{user_id}")
        return result


class UserPermission(BaseModel):
    """
    用户自定义权限模型

    允许为特定用户分配或撤销特定权限，覆盖角色权限。
    """
    PERMISSION_ACTION_CHOICES = (
        ('grant', '授权'),
        ('revoke', '撤销'),
    )

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='custom_permissions', verbose_name="用户")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name='custom_user_permissions', verbose_name="权限")
    action = models.CharField(max_length=10, choices=PERMISSION_ACTION_CHOICES, verbose_name="操作类型")

    class Meta:
        verbose_name = "用户自定义权限"
        verbose_name_plural = "用户自定义权限"
        unique_together = ('user', 'permission')

    def __str__(self):
        action_dict = dict(self.PERMISSION_ACTION_CHOICES)
        action_display = action_dict.get(self.action, self.action)
        if hasattr(self, 'user') and hasattr(self, 'permission'):
            return str(f"{self.user.username} - {self.permission.name} - {action_display}")
        return str("UserPermission")

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.user_id:
            cache.delete(f"user_perms_{self.user_id}")

    def delete(self, *args, **kwargs):
        user_id = self.user_id
        result = super().delete(*args, **kwargs)
        if user_id:
            cache.delete(f"user_perms_{user_id}")
        return result

class AuditLog(BaseModel):
    """
    审计日志模型
    记录用户操作日志
    """
    ACTION_CHOICES = (
        ('LOGIN', '用户登录'),
        ('LOGOUT', '用户登出'),
        ('CREATE', '创建资源'),
        ('UPDATE', '更新资源'),
        ('DELETE', '删除资源'),
        ('VIEW', '查看资源'),
        ('OTHER', '其他操作'),
        # Permission related
        ('PERMISSION_CHECK', '权限检查'),
        ('ACCESS_DENIED', '访问被拒绝'),
        ('ROLE_ASSIGN', '分配角色'),
        ('ROLE_REMOVE', '移除角色'),
        ('PERMISSION_GRANT', '授予权限'),
        ('PERMISSION_REVOKE', '撤销权限'),
    )
    
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="用户")
    username = models.CharField(max_length=150, blank=True, verbose_name="用户名") # Store username in case user is deleted
    action = models.CharField(max_length=50, verbose_name="操作类型")
    resource = models.CharField(max_length=100, blank=True, verbose_name="资源")
    resource_id = models.CharField(max_length=100, blank=True, null=True, verbose_name="资源ID")
    details = models.JSONField(blank=True, null=True, verbose_name="详情")
    ip_address = models.GenericIPAddressField(blank=True, null=True, verbose_name="IP地址")
    success = models.BooleanField(default=True, verbose_name="是否成功")

    class Meta:
        verbose_name = "审计日志"
        verbose_name_plural = "审计日志"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.username} - {self.action} - {self.created_at}"

    def save(self, *args, **kwargs):
        if self.user and not self.username:
            self.username = self.user.username
        super().save(*args, **kwargs)


class SystemSetting(models.Model):
    # General Settings
    site_title = models.CharField(default="Cassava System", max_length=200, verbose_name="站点标题")
    site_announcement = models.TextField(blank=True, null=True, verbose_name="系统公告")
    announcement_level = models.CharField(
        default="info", max_length=20, 
        choices=[('info', 'Info'), ('warning', 'Warning'), ('error', 'Error')],
        verbose_name="公告级别"
    )

    # Display Settings
    max_display_images = models.PositiveIntegerField(default=200, verbose_name="最大展示图片数量")
    max_display_results = models.PositiveIntegerField(default=100, verbose_name="最大展示结果数量")

    # Access & Security
    enable_guest_access = models.BooleanField(default=True, verbose_name="允许访客访问")
    allow_registration = models.BooleanField(default=True, verbose_name="开放注册")
    maintenance_mode = models.BooleanField(default=False, verbose_name="维护模式")
    
    # Storage & Retention
    upload_size_limit_mb = models.PositiveIntegerField(default=50, verbose_name="上传文件大小限制(MB)")
    guest_data_retention_days = models.PositiveIntegerField(default=7, verbose_name="访客数据保留天数")
    audit_log_retention_days = models.PositiveIntegerField(default=180, verbose_name="审计日志保留天数")

    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="system_settings_updated",
        verbose_name="更新人",
    )

    class Meta:
        verbose_name = "系统设置"
        verbose_name_plural = "系统设置"

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if obj:
            return obj
        return cls.objects.create()



class UserProfile(BaseModel):
    """
    用户扩展信息模型
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile', verbose_name="用户")
    avatar = models.ImageField(upload_to=get_avatar_upload_path, null=True, blank=True, verbose_name="头像")
    employee_id = models.CharField(max_length=50, blank=True, verbose_name="工号")
    department = models.CharField(max_length=100, blank=True, verbose_name="部门")
    phone = models.CharField(max_length=20, blank=True, verbose_name="手机号")
    bio = models.TextField(blank=True, verbose_name="个人简介")
    
    # 安全设置
    two_factor_enabled = models.BooleanField(default=False, verbose_name="开启双重认证")
    two_factor_secret = models.CharField(max_length=100, blank=True, verbose_name="2FA密钥")
    
    # 偏好设置
    theme = models.CharField(max_length=20, default='light', verbose_name="主题")
    notification_settings = models.JSONField(default=dict, verbose_name="通知设置")

    # 状态追踪
    last_activity = models.DateTimeField(null=True, blank=True, verbose_name="最后活跃时间")

    class Meta:
        verbose_name = "用户配置"
        verbose_name_plural = "用户配置"

    def __str__(self):
        return f"{self.user.username}'s profile"

class EmailVerificationCode(models.Model):
    PURPOSE_CHOICES = [
        ('register', '注册'),
        ('login', '登录'),
        ('reset', '重置密码'),
    ]

    email = models.EmailField(db_index=True, verbose_name="邮箱")
    code = models.CharField(max_length=20, verbose_name="验证码")
    purpose = models.CharField(max_length=20, choices=PURPOSE_CHOICES, default='register', verbose_name="用途")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    expires_at = models.DateTimeField(verbose_name="过期时间")
    used_at = models.DateTimeField(null=True, blank=True, verbose_name="使用时间")
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name="IP地址")

    class Meta:
        verbose_name = "邮箱验证码"
        verbose_name_plural = "邮箱验证码"
        indexes = [
            models.Index(fields=['email', 'purpose', 'created_at']),
        ]

    def __str__(self):
        return f"{self.email} {self.purpose}"

class GuestUsage(models.Model):
    """
    访客使用记录模型
    记录未登录访客的每日使用情况，用于限制使用次数
    """
    guest_token = models.CharField(max_length=64, verbose_name="访客标识", db_index=True, default='legacy_user')
    ip_address = models.GenericIPAddressField(verbose_name="IP地址", null=True, blank=True)
    date = models.DateField(auto_now_add=True, verbose_name="日期")
    count = models.IntegerField(default=0, verbose_name="使用次数")
    
    class Meta:
        verbose_name = "访客使用记录"
        verbose_name_plural = "访客使用记录"
        unique_together = ('guest_token', 'date')
        indexes = [
            models.Index(fields=['guest_token', 'date']),
        ]

    def __str__(self):
        return f"{self.guest_token} - {self.date} - {self.count}"

class GuestAccessibleResource(BaseModel):
    """
    访客可访问资源白名单配置
    """
    RESOURCE_TYPE_CHOICES = [
        ('image', '图片'),
        ('folder', '文件夹'),
    ]
    
    resource_type = models.CharField(max_length=20, choices=RESOURCE_TYPE_CHOICES, verbose_name="资源类型")
    resource_id = models.IntegerField(verbose_name="资源ID")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, verbose_name="配置人")
    
    class Meta:
        verbose_name = "访客资源白名单"
        verbose_name_plural = "访客资源白名单"
        unique_together = ('resource_type', 'resource_id')
        indexes = [
            models.Index(fields=['resource_type', 'resource_id', 'is_active']),
        ]

    def __str__(self):
        return f"Guest Access: {self.resource_type} {self.resource_id}"

# Signal to create UserProfile when User is created
from django.db.models.signals import post_delete, post_save, pre_delete
from django.dispatch import receiver
from .storage_utils import (
    collect_cassava_image_storage_keys,
    collect_correction_storage_keys,
    collect_prediction_storage_keys,
    collect_segmentation_storage_keys,
    delete_storage_keys,
)

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    if hasattr(instance, 'profile'):
        instance.profile.save()
    else:
        UserProfile.objects.create(user=instance)


@receiver(pre_delete, sender=CassavaImage)
def prepare_cassava_image_storage_cleanup(sender, instance, **kwargs):
    instance._storage_cleanup_keys = collect_cassava_image_storage_keys(instance)


@receiver(post_delete, sender=CassavaImage)
def cleanup_cassava_image_storage(sender, instance, **kwargs):
    delete_storage_keys(getattr(instance, '_storage_cleanup_keys', []))


@receiver(pre_delete, sender=SegmentationResult)
def prepare_segmentation_storage_cleanup(sender, instance, **kwargs):
    instance._storage_cleanup_keys = collect_segmentation_storage_keys(instance)


@receiver(post_delete, sender=SegmentationResult)
def cleanup_segmentation_storage(sender, instance, **kwargs):
    delete_storage_keys(getattr(instance, '_storage_cleanup_keys', []))


@receiver(pre_delete, sender=PredictionResult)
def prepare_prediction_storage_cleanup(sender, instance, **kwargs):
    instance._storage_cleanup_keys = collect_prediction_storage_keys(instance)


@receiver(post_delete, sender=PredictionResult)
def cleanup_prediction_storage(sender, instance, **kwargs):
    delete_storage_keys(getattr(instance, '_storage_cleanup_keys', []))


@receiver(pre_delete, sender=PredictionCorrection)
def prepare_correction_storage_cleanup(sender, instance, **kwargs):
    instance._storage_cleanup_keys = collect_correction_storage_keys(instance)


@receiver(post_delete, sender=PredictionCorrection)
def cleanup_correction_storage(sender, instance, **kwargs):
    delete_storage_keys(getattr(instance, '_storage_cleanup_keys', []))

class LoginSession(models.Model):
    """按会话签发的登录令牌。

    DRF 自带 Token 的 user 字段是一对一，同一账号只能存在一个令牌，
    导致「手机登录把电脑踢下线」。这里改为多令牌模型：每次登录签发一个，
    接口仍以 `Authorization: Token <key>` 传递，前端与小程序无需改动。

    key 采用与 DRF Token 相同的 40 位十六进制字符串，长度与外观保持一致。
    """

    key = models.CharField(max_length=40, primary_key=True, serialize=False, verbose_name='令牌')
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='login_sessions',
        verbose_name='用户',
    )
    created = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    last_seen = models.DateTimeField(null=True, blank=True, verbose_name='最近活跃')
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name='记住登录到期时间')

    class Meta:
        db_table = 'predict_login_session'
        verbose_name = '登录会话'
        verbose_name_plural = '登录会话'
        ordering = ['-created']
        indexes = [models.Index(fields=['user', '-created'], name='login_sess_user_created_idx')]

    def __str__(self):
        return f'{self.user_id}:{self.key[:8]}'

    def save(self, *args, **kwargs):
        if not self.key:
            self.key = secrets.token_hex(20)
        return super().save(*args, **kwargs)


# Register durable import models after shared resource classes are defined.
from .import_models import ImportJob, ImportItem  # noqa: E402,F401
