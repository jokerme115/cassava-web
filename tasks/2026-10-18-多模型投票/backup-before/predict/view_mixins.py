"""
视图层通用混入类模块

提供可复用的视图功能混入，包括权限检查、任务处理、响应格式化等通用逻辑，
遵循DRF的继承扩展模式，提高代码复用性和可维护性。
"""
from rest_framework import status
from rest_framework.response import Response
from django.apps import apps
import threading
import logging
from datetime import datetime
from .permissions import HasPermission, user_has_permission, user_has_role
from django.contrib.auth.models import User

# 设置日志记录器
logger = logging.getLogger(__name__)

class PermissionMixin:
    """
    权限处理混入类
    
    统一处理视图权限检查和错误响应，支持动态权限代码设置。
    支持基于角色的数据隔离。
    """
    permission_codename = None  # 需要在子类中设置具体权限代码
    permission_classes = [HasPermission]  # 默认使用自定义权限类
    
    def check_permission(self, request, permission_codename=None):
        """
        检查用户是否拥有指定权限
        """
        codename = permission_codename or self.permission_codename
        if not codename:
            return True
        return user_has_permission(request.user, codename)
    
    def ensure_permission(self, request, permission_codename=None):
        """
        确保用户拥有指定权限，如果没有则抛出权限错误
        """
        codename = permission_codename or self.permission_codename
        if not self.check_permission(request, codename):
            return Response(
                {'error': '权限不足', 'detail': f'需要权限: {codename}'},
                status=status.HTTP_403_FORBIDDEN
            )
        return True

    def filter_queryset_by_permission(self, queryset):
        """
        根据用户权限过滤查询集
        实现数据隔离：
        1. 超级用户/管理员：查看所有数据
        2. 普通用户：仅查看自己创建的数据
        3. 访客：无法查看任何数据列表
        """
        user = self.request.user
        
        # 访客无法查看列表数据 (除非视图重写了 get_queryset 并允许访客)
        # 注意：通常在 get_queryset 中已经处理了访客逻辑，这里是处理已认证用户的隔离
        if not user.is_authenticated:
            # 如果是访客，这里返回空，除非具体的ViewSet有特殊处理
            # 实际上，CassavaImageViewSet 已经在调用 filter_queryset_by_permission 之前
            # 处理了访客逻辑，所以这里不需要返回空，或者应该返回空以防万一
            return queryset.none()
            
        # 超级用户查看所有
        if user.is_superuser:
            return queryset
            
        # 管理员和普通用户查看自己的数据 (严格隔离)
        # 检查模型是否有 owner 字段
        if hasattr(queryset.model, 'owner'):
            allow_shared = False
            action = getattr(self, 'action', None)
            if action in ('retrieve', 'images', 'update', 'partial_update', 'destroy', 'add_images', 'delete_with_strategy'):
                allow_shared = True
            if self.request.query_params.get('include_shared') == '1':
                allow_shared = True

            if not allow_shared:
                return queryset.filter(owner=user)

            model_name = getattr(getattr(queryset.model, '_meta', None), 'model_name', '')
            resource_type = None
            if model_name == 'cassavaimage':
                resource_type = 'image'
            elif model_name == 'folder':
                resource_type = 'folder'

            if not resource_type:
                return queryset.filter(owner=user)

            from .services import ShareService
            q = ShareService.get_accessible_resources(user, resource_type)
            return queryset.filter(q)
            
        # 检查模型是否有 user 字段
        if hasattr(queryset.model, 'user'):
            return queryset.filter(user=user)
            
        # 如果是关联模型 (如 PredictionResult)，可能通过关联字段查找 owner
        # 这里需要具体模型具体分析，或者约定统一字段
        # 暂时只处理直接 owner/user 字段
        
        return queryset

class TaskProcessingMixin:
    """
    任务处理混入类
    
    提供创建任务、运行后台任务等通用功能。
    """
    def get_processing_task_model(self):
        """获取处理任务模型"""
        return apps.get_model('predict', 'ProcessingTask')
    
    def create_task(self, request, task_name, task_type, extra_params=None):
        """
        创建新任务的通用方法
        
        Args:
            request: HTTP请求对象
            task_name: 任务名称
            task_type: 任务类型
            extra_params: 额外参数
            
        Returns:
            ProcessingTask: 创建的任务对象
        """
        ProcessingTask = self.get_processing_task_model()
        task = ProcessingTask.objects.create(
            name=f"{task_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            type=task_type,
            status="running",
            progress=0,
            owner=request.user if request.user.is_authenticated else None,
            **(extra_params or {})
        )
        return task
    
    def run_background_task(self, task, process_func, *args):
        """
        运行后台任务的通用方法
        
        Args:
            task: 任务对象
            process_func: 处理函数
            *args: 传递给处理函数的参数
            
        Returns:
            threading.Thread: 后台线程对象
        """
        def execute():
            try:
                result = process_func(*args)
                task.status = "completed"
                task.progress = 100
                task.save()
                return result
            except Exception as e:
                task.status = "failed"
                task.error = str(e)
                task.save()
                logger.error(f"任务 {task.name} 失败: {e}")
                return None

        thread = threading.Thread(target=execute)
        thread.daemon = True
        thread.start()
        return thread

class ResponseFormatMixin:
    """
    响应格式化混入类
    
    提供标准化的成功和错误响应格式。
    """
    def success_response(self, data=None, message="操作成功", status_code=status.HTTP_200_OK):
        """
        成功响应
        
        Args:
            data: 响应数据
            message: 响应消息
            status_code: HTTP状态码
            
        Returns:
            Response: DRF响应对象
        """
        response_data = {
            'success': True,
            'message': message,
            'data': data
        }
        return Response(response_data, status=status_code)
    
    def error_response(self, error_message="操作失败", detail=None, status_code=status.HTTP_400_BAD_REQUEST):
        """
        错误响应
        
        Args:
            error_message: 错误消息
            detail: 详细错误信息
            status_code: HTTP状态码
            
        Returns:
            Response: DRF响应对象
        """
        response_data = {
            'success': False,
            'error': error_message
        }
        if detail:
            response_data['detail'] = detail
        return Response(response_data, status=status_code)

class FileUploadMixin:
    """
    文件上传混入类
    
    提供文件上传相关的通用功能。
    """
    def validate_file_upload(self, request, file_key='file'):
        """
        验证文件上传
        
        Args:
            request: HTTP请求对象
            file_key: 文件表单字段名称
            
        Returns:
            tuple: (file, error_response) 元组，如果验证失败，file为None，error_response包含错误信息
        """
        file = request.FILES.get(file_key)
        if not file:
            return None, self.error_response("未提供文件")
        
        # 检查文件大小
        max_size = 50 * 1024 * 1024  # 50MB
        if file.size > max_size:
            return None, self.error_response(f"文件大小超过限制，最大允许{max_size/1024/1024}MB")
        
        # 检查文件类型
        allowed_extensions = ['.jpg', '.jpeg', '.png', '.bmp']
        file_ext = file.name.lower().split('.')[-1] if '.' in file.name else ''
        if f'.{file_ext}' not in allowed_extensions:
            return None, self.error_response(f"不支持的文件类型，仅允许: {', '.join(allowed_extensions)}")
        
        return file, None
