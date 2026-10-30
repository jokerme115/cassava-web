"""
木薯疾病预测系统API URL配置

该模块定义了所有API端点的URL路由，采用Django REST Framework的路由器自动生成标准RESTful接口，
支持木薯图像管理、分割结果查询、预测结果获取和任务进度监控等功能。
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from django.views.decorators.csrf import ensure_csrf_cookie
from django.http import JsonResponse
from django.middleware.csrf import get_token
from . import views
from . import permission_views
from . import auth_views
from .import_views import ImportJobViewSet

# 创建默认路由器并注册视图集
router = DefaultRouter()
router.register(r'imports', ImportJobViewSet, basename='imports')
router.register(r'images', views.CassavaImageViewSet, basename='images')          # 木薯图像管理接口
router.register(r'folders', views.FolderViewSet, basename='folders')              # 文件夹管理接口
router.register(r'segmentations', views.SegmentationResultViewSet, basename='segmentations')  # 分割结果查询接口
router.register(r'predictions', views.PredictionResultViewSet, basename='predictions')      # 预测结果查询接口
router.register(r'tasks', views.ProcessingTaskViewSet, basename='tasks')          # 任务进度监控接口
router.register(r'shares', views.ShareViewSet, basename='shares')                # 资源共享接口

# 权限管理路由器
permission_router = DefaultRouter()
permission_router.register(r'permissions', permission_views.PermissionViewSet, basename='permissions')
permission_router.register(r'roles', permission_views.RoleViewSet, basename='roles')
permission_router.register(r'user-roles', permission_views.UserRoleViewSet, basename='user-roles')
permission_router.register(r'user-permissions', permission_views.UserPermissionViewSet, basename='user-permissions')
permission_router.register(r'users', permission_views.UserManagementViewSet, basename='users')
permission_router.register(r'audit-logs', permission_views.AuditLogViewSet, basename='audit-logs')
permission_router.register(r'guest-resources', permission_views.GuestResourceViewSet, basename='guest-resources')
permission_router.register(r'permission-templates', permission_views.PermissionTemplateViewSet, basename='permission-templates')

# CSRF Token视图
@ensure_csrf_cookie
def get_csrf_token(request):
    token = get_token(request)
    return JsonResponse({'csrftoken': token})

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

@api_view(['GET'])
@permission_classes([AllowAny])
def model_catalogue(request):
    from .model_registry import catalogue
    return Response(catalogue())

urlpatterns = [
    path('models/', model_catalogue, name='model-catalogue'),
    # 2026-10-27：DRF 的 APIView.as_view() 内部已统一包 csrf_exempt
    # （rest_framework/views.py:144 `return csrf_exempt(view)`），此前的显式 csrf_exempt 是冗余包装，
    # 反而让人误以为「这些端点靠豁免 CSRF 才通」。真实防护是 token 鉴权 + 权限类，
    # 因此这里去掉冗余装饰器，行为不变、语义变清楚。
    path('images/upload-batch/', views.CassavaImageViewSet.as_view({'post': 'upload_batch'}), name='image-upload-batch'),
    path('images/upload-files/', views.CassavaImageViewSet.as_view({'post': 'upload_files'}), name='image-upload-files'),

    path('', include(router.urls)),  # 包含路由器生成的所有API端点
    path('permissions/', include(permission_router.urls)),  # 权限管理API端点
    
    # 用户登录路由
    path('auth/login/', auth_views.user_login, name='user-login'),
    path('auth/guest/', auth_views.guest_session, name='guest-session'),
    path('auth/register/', auth_views.user_register, name='user-register'),
    path('auth/email/code/', auth_views.send_email_code, name='email-code'),
    path('auth/logout/', auth_views.user_logout, name='user-logout'),
    path('auth/user/', auth_views.current_user, name='current-user'),
    path('auth/profile/update/', auth_views.update_profile, name='update-profile'),
    path('auth/password/change/', auth_views.change_password, name='change-password'),
    path('auth/csrf/', get_csrf_token, name='csrf-token'),

    # OSS对象存储API（权限与归属校验见 predict/views.py 的 OssObjectView / _oss_key_owned_by）
    path('oss/', views.OssObjectView.as_view(), name='oss-object'),

    path('system/settings/', views.SystemSettingView.as_view(), name='system-settings'),
    path('system/settings/public/', views.public_settings, name='public-settings'),
]
