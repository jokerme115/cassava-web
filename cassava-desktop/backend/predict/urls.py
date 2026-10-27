"""
Desktop Mode: 精简版URL配置
删除了：分享、权限管理、访客、OSS等平台功能
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from django.views.decorators.csrf import csrf_exempt
from . import views
from . import auth_views
from . import backup_views
from . import model_views


# 创建默认路由器
router = DefaultRouter()
router.register(r'images', views.CassavaImageViewSet, basename='images')
router.register(r'folders', views.FolderViewSet, basename='folders')
router.register(r'segmentations', views.SegmentationResultViewSet, basename='segmentations')
router.register(r'predictions', views.PredictionResultViewSet, basename='predictions')
router.register(r'tasks', views.ProcessingTaskViewSet, basename='tasks')


urlpatterns = [
    # 图像上传
    path('images/upload-batch/', csrf_exempt(views.CassavaImageViewSet.as_view({'post': 'upload_batch'})), name='image-upload-batch'),
    path('images/upload-files/', csrf_exempt(views.CassavaImageViewSet.as_view({'post': 'upload_files'})), name='image-upload-files'),
    path('images/import-local-images/', csrf_exempt(views.CassavaImageViewSet.as_view({'post': 'import_local_images'})), name='image-import-local'),

    # 核心API
    path('', include(router.urls)),

    # 认证相关（桌面版仅保留只读用户接口）
    path('auth/user/', auth_views.current_user, name='current-user'),

    # 系统设置
    path('system/settings/', views.SystemSettingView.as_view(), name='system-settings'),
    path('system/settings/public/', views.public_settings, name='public-settings'),
    path('system/info/', views.system_info, name='system-info'),
    path('system/stats/', views.system_stats, name='system-stats'),

    # 图片索引重建
    path('system/rebuild-index/', views.rebuild_index, name='rebuild-index'),

    # 缓存管理
    path('system/cache/info/', views.cache_info, name='cache-info'),
    path('system/cache/clear/', views.clear_cache, name='cache-clear'),

    # 备份与恢复
    path('system/backup/info/', backup_views.backup_info, name='backup-info'),
    path('system/backup/create/', backup_views.create_backup, name='backup-create'),
    path('system/backup/restore/', backup_views.restore_backup, name='backup-restore'),

    # 模型管理
    path('system/models/', model_views.list_models, name='models-list'),
    path('system/models/info/', model_views.model_info, name='models-info'),
]
